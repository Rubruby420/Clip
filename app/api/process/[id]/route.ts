import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadPresignedUrl, uploadBuffer } from "@/lib/r2";
import { transcribeAudio, sliceWords } from "@/lib/whisper";
import { detectHighlights, type Highlight } from "@/lib/assemblyai";
import { detectHighlightsFromTranscript, selectBestSegment } from "@/lib/highlights";
import { evaluateClip } from "@/lib/coach";
import { extractAudio, extractThumbnail, generatePreviewProxy, tmpPath } from "@/lib/ffmpeg";
import fs from "fs";
import https from "https";
import http from "http";
import { randomUUID } from "crypto";

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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Smart Import settings (from the upload page). Off unless explicitly enabled.
  const body = await req.json().catch(() => ({}));
  const smartImport = body.smartImport === true;
  const minLen = Math.max(10, Math.min(90, Number(body.minLen) || 15));
  const maxLen = Math.max(minLen, Math.min(90, Number(body.maxLen) || 60));

  await db.project.update({ where: { id }, data: { status: "processing" } });

  // Run async — don't await so we return immediately
  (async () => {
    const videoPath = tmpPath(`${id}.mp4`);
    const audioPath = tmpPath(`${id}.mp3`);
    const proxyPath = tmpPath(`${id}_proxy.mp4`);

    try {
      // 1. Download video from R2
      const downloadUrl = await getDownloadPresignedUrl(project.originalKey);
      await downloadFile(downloadUrl, videoPath);

      // 2. Extract audio
      await extractAudio(videoPath, audioPath);

      // 2b. Generate a 720p proxy mp4 for smooth editor playback (4K sources
      //     stutter when decoded for the small preview). Failure here is
      //     non-fatal — the editor falls back to the original URL.
      try {
        await generatePreviewProxy(videoPath, proxyPath);
        if (fs.existsSync(proxyPath)) {
          const proxyBuffer = fs.readFileSync(proxyPath);
          const proxyKey = `proxies/${id}.mp4`;
          const proxyUrl = await uploadBuffer(proxyKey, proxyBuffer, "video/mp4");
          await db.project.update({
            where: { id },
            data: { proxyUrl, proxyKey },
          });
        }
      } catch (err) {
        console.error("Proxy generation failed (non-fatal):", err);
      }

      // 3. Transcribe with Whisper
      const transcription = await transcribeAudio(audioPath);

      // 4. Detect highlights — AssemblyAI chapters first, then LLM transcript
      //    analysis as a fallback so clips always get real, specific titles.
      let highlights: Highlight[] = [];
      try {
        highlights = await detectHighlights(downloadUrl);
      } catch (err) {
        console.error("AssemblyAI highlight detection failed:", err);
      }

      if (highlights.length === 0) {
        console.warn("No AssemblyAI chapters — using LLM highlight detection.");
        highlights = await detectHighlightsFromTranscript(transcription).catch((err) => {
          console.error("LLM highlight detection failed:", err);
          return [];
        });
      }

      // Last resort: fixed 60s segments (only if both detectors fail).
      if (highlights.length === 0 && transcription.duration > 0) {
        const segDuration = 60;
        for (let t = 0; t < transcription.duration; t += segDuration) {
          const end = Math.min(t + segDuration, transcription.duration);
          highlights.push({
            title: `Clip ${Math.floor(t / segDuration) + 1}`,
            start: t,
            end,
            score: 0.5,
            summary: "",
          });
        }
      }

      // 5. Store transcription
      await db.project.update({
        where: { id },
        data: {
          transcription: JSON.stringify(transcription),
          duration: transcription.duration,
        },
      });

      // 6. Create clip records + thumbnails
      for (const h of highlights.slice(0, 12)) {
        const clipId = randomUUID();

        // Smart Import: tighten each clip to its best segment within the
        // requested length window before saving it.
        let clipStart = h.start;
        let clipEnd = h.end;
        if (smartImport) {
          const roughWords = sliceWords(transcription.words, h.start, h.end);
          const seg = await selectBestSegment(roughWords, h.end - h.start, {
            minLen,
            maxLen,
          }).catch((err) => {
            console.error("Smart Import trim failed for a clip:", err);
            return null;
          });
          if (seg) {
            clipStart = h.start + seg.start;
            clipEnd = h.start + seg.end;
          }
        }

        const thumbPath = tmpPath(`${clipId}_thumb.jpg`);
        await extractThumbnail(videoPath, thumbPath, clipStart + 1).catch(() => null);

        let thumbnailUrl = "";
        if (fs.existsSync(thumbPath)) {
          const thumbBuffer = fs.readFileSync(thumbPath);
          const thumbKey = `thumbnails/${clipId}.jpg`;
          thumbnailUrl = await uploadBuffer(thumbKey, thumbBuffer, "image/jpeg");
          fs.unlinkSync(thumbPath);
        }

        const words = sliceWords(transcription.words, clipStart, clipEnd);

        // Virality Coach — auto-check each clip so weak ones are flagged.
        const clipTranscript = words.map((w) => w.word).join(" ").trim();
        const report = await evaluateClip({
          title: h.title,
          transcript: clipTranscript,
          durationSec: clipEnd - clipStart,
        }).catch((err) => {
          console.error("Coach auto-check failed for a clip:", err);
          return null;
        });

        await db.clip.create({
          data: {
            id: clipId,
            projectId: id,
            title: h.title,
            startTime: clipStart,
            endTime: clipEnd,
            score: h.score,
            words: JSON.stringify(words),
            thumbnailUrl,
            coachData: report
              ? JSON.stringify({ report, videos: [], generatedAt: new Date().toISOString() })
              : null,
          },
        });
      }

      await db.project.update({ where: { id }, data: { status: "ready" } });
    } catch (err) {
      console.error("Processing error:", err);
      await db.project.update({ where: { id }, data: { status: "error" } }).catch(() => null);
    } finally {
      [videoPath, audioPath, proxyPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
    }
  })();

  return NextResponse.json({ message: "Processing started" });
}
