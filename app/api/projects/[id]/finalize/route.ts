import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transcribeAudio } from "@/lib/whisper";
import { evaluateClip } from "@/lib/coach";
import { extractAudioSegment, extractThumbnail, tmpPath } from "@/lib/ffmpeg";
import {
  resolveStorage,
  ensureDirFor,
  clipThumbPath,
} from "@/lib/storage";
import fs from "fs";

// Triggered when the user hits "No — finalize" in the source editor after
// authoring clips by hand. For each saved clip that hasn't been scored
// yet, transcribe its audio segment with Whisper, generate a thumbnail,
// and run Coach. We do NOT touch the clip boundaries — the user's cuts
// are the source of truth here.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only act on clips that haven't already been scored.
  const pending = await db.clip.findMany({
    where: { projectId: id, coachData: null },
  });
  if (pending.length === 0) {
    return NextResponse.json({ message: "Nothing to finalize" });
  }

  await db.project.update({ where: { id }, data: { status: "processing" } });

  (async () => {
    const videoPath = resolveStorage(project.originalUrl);

    try {
      for (const clip of pending) {
        const audioPath = tmpPath(`${clip.id}_seg.mp3`);

        try {
          await extractAudioSegment(videoPath, audioPath, clip.startTime, clip.endTime);
          const transcription = await transcribeAudio(audioPath).catch((err) => {
            console.error(`Whisper failed for clip ${clip.id}:`, err);
            return null;
          });

          let thumbnailUrl = clip.thumbnailUrl ?? "";
          if (!thumbnailUrl) {
            const thumbRel = clipThumbPath(id, clip.id);
            const thumbAbs = resolveStorage(thumbRel);
            await ensureDirFor(thumbAbs);
            await extractThumbnail(videoPath, thumbAbs, clip.startTime + 1).catch(() => null);
            if (fs.existsSync(thumbAbs)) thumbnailUrl = thumbRel;
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
          try { fs.unlinkSync(audioPath); } catch {}
        }
      }

      await db.project.update({ where: { id }, data: { status: "ready" } });
    } catch (err) {
      console.error("Finalize error:", err);
      await db.project.update({ where: { id }, data: { status: "error" } }).catch(() => null);
    }
  })();

  return NextResponse.json({ message: "Finalizing started", pending: pending.length });
}
