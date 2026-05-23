import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadPresignedUrl, uploadBuffer } from "@/lib/r2";
import { transcribeAudio } from "@/lib/whisper";
import { evaluateClip } from "@/lib/coach";
import { extractAudioSegment, extractThumbnail, tmpPath } from "@/lib/ffmpeg";
import fs from "fs";
import https from "https";
import http from "http";

// Triggered when the user hits "No — finalize" in the source editor after
// authoring clips by hand. For each saved clip that hasn't been scored
// yet, transcribe its audio segment with Whisper, generate a thumbnail,
// and run Coach. We do NOT touch the clip boundaries — the user's cuts
// are the source of truth here.
async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only act on clips that haven't already been scored, so a second
  // finalize pass (after the user comes back to make more) doesn't redo
  // work or run up the OpenAI bill.
  const pending = await db.clip.findMany({
    where: { projectId: id, coachData: null },
  });
  if (pending.length === 0) {
    return NextResponse.json({ message: "Nothing to finalize" });
  }

  await db.project.update({ where: { id }, data: { status: "processing" } });

  (async () => {
    const videoPath = tmpPath(`${id}_finalize.mp4`);

    try {
      const downloadUrl = await getDownloadPresignedUrl(project.originalKey);
      await downloadFile(downloadUrl, videoPath);

      for (const clip of pending) {
        const audioPath = tmpPath(`${clip.id}_seg.mp3`);
        const thumbPath = tmpPath(`${clip.id}_thumb.jpg`);

        try {
          await extractAudioSegment(videoPath, audioPath, clip.startTime, clip.endTime);
          const transcription = await transcribeAudio(audioPath).catch((err) => {
            console.error(`Whisper failed for clip ${clip.id}:`, err);
            return null;
          });

          let thumbnailUrl = clip.thumbnailUrl ?? "";
          if (!thumbnailUrl) {
            await extractThumbnail(videoPath, thumbPath, clip.startTime + 1).catch(() => null);
            if (fs.existsSync(thumbPath)) {
              const buf = fs.readFileSync(thumbPath);
              thumbnailUrl = await uploadBuffer(`thumbnails/${clip.id}.jpg`, buf, "image/jpeg");
            }
          }

          const transcriptText = transcription
            ? transcription.words.map((w) => w.word).join(" ").trim()
            : "";

          const report = await evaluateClip({
            title: clip.title,
            transcript: transcriptText,
            durationSec: clip.endTime - clip.startTime,
          }).catch((err) => {
            console.error(`Coach failed for clip ${clip.id}:`, err);
            return null;
          });

          await db.clip.update({
            where: { id: clip.id },
            data: {
              words: transcription
                ? JSON.stringify(transcription.words.map((w) => ({
                    word: w.word,
                    // sliceWords-style: relative to the clip start. The
                    // segment audio already starts at 0, so the Whisper
                    // timestamps are clip-local — store them as-is.
                    start: w.start,
                    end: w.end,
                  })))
                : clip.words,
              thumbnailUrl: thumbnailUrl || clip.thumbnailUrl,
              coachData: report
                ? JSON.stringify({ report, videos: [], generatedAt: new Date().toISOString() })
                : null,
            },
          });
        } finally {
          [audioPath, thumbPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
        }
      }

      await db.project.update({ where: { id }, data: { status: "ready" } });
    } catch (err) {
      console.error("Finalize error:", err);
      await db.project.update({ where: { id }, data: { status: "error" } }).catch(() => null);
    } finally {
      try { fs.unlinkSync(videoPath); } catch {}
    }
  })();

  return NextResponse.json({ message: "Finalizing started", pending: pending.length });
}
