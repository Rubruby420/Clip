import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transcribeAudio, sliceWords } from "@/lib/whisper";
import { detectHighlights, type Highlight } from "@/lib/assemblyai";
import { detectHighlightsFromTranscript, selectBestSegment } from "@/lib/highlights";
import { detectTalkSegments } from "@/lib/silence";
import { evaluateClip } from "@/lib/coach";
import { extractAudio, extractThumbnail, generatePreviewProxy, getVideoDuration, tmpPath } from "@/lib/ffmpeg";
import { generatePeaks } from "@/lib/waveform";
import {
  resolveStorage,
  ensureDirFor,
  projectProxyPath,
  clipThumbPath,
} from "@/lib/storage";
import fs from "fs";
import fsp from "fs/promises";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Upload-page settings.
  const body = await req.json().catch(() => ({}));
  // `mode` decides the whole shape of the pipeline:
  //   "manual" — light prep only (waveform + 720p proxy). No Whisper, no
  //              AssemblyAI, no LLM, no Coach. The source editor lets the
  //              user cut clips by hand; finalize later runs Coach.
  //   "ai"     — full pipeline: transcript + highlight detection + per-clip Coach.
  // The old `autoDetect` flag is translated for back-compat with any caller still
  // posting the previous shape.
  const mode: "manual" | "ai" =
    body.mode === "manual" || body.mode === "ai"
      ? body.mode
      : body.autoDetect === true ? "ai" : "manual";
  const smartImport = body.smartImport === true;
  const minLen = Math.max(10, Math.min(90, Number(body.minLen) || 15));
  const maxLen = Math.max(minLen, Math.min(90, Number(body.maxLen) || 60));

  await db.project.update({ where: { id }, data: { status: "processing" } });

  // Run async — don't await so we return immediately
  (async () => {
    // Source video already lives on disk at <STORAGE>/<id>/source.<ext> —
    // no download step needed. Audio + proxy are intermediates in .tmp/
    // (the proxy gets moved into the project folder on success).
    const videoPath = resolveStorage(project.originalUrl);
    const audioPath = tmpPath(`${id}.mp3`);
    const proxyPath = tmpPath(`${id}_proxy.mp4`);

    // Flip the project to "ready" as soon as clips exist, THEN build the
    // optional 720p editor proxy. The proxy runs LAST and is hard-timeout-
    // bounded (lib/ffmpeg.generatePreviewProxy), so a slow/huge 4K source can
    // never wedge the pipeline the way a 15 GB DJI upload once did — the editor
    // just falls back to the original URL if the proxy never lands.
    const finishWithProxy = async () => {
      await db.project.update({ where: { id }, data: { status: "ready" } });
      try {
        await generatePreviewProxy(videoPath, proxyPath);
        if (fs.existsSync(proxyPath)) {
          const proxyRel = projectProxyPath(id);
          const proxyAbs = resolveStorage(proxyRel);
          await ensureDirFor(proxyAbs);
          await fsp.copyFile(proxyPath, proxyAbs);
          await db.project.update({
            where: { id },
            data: { proxyUrl: proxyRel, proxyKey: proxyRel },
          });
        }
      } catch (err) {
        console.error("Proxy generation failed (non-fatal):", err);
      }
    };

    try {

      // 1a. Probe the source duration up front so the /source editor can
      //     mount the timeline and player correctly without waiting on the
      //     video element's loadedmetadata. AI mode overwrites this later
      //     with the Whisper-reported duration (they agree to within a
      //     frame). Non-fatal — if probe fails, the player still works
      //     once <video> loads its own metadata.
      // Retained for manual-mode clip detection below (talk-segment cutting
      // needs the source duration and the waveform peaks).
      let sourceDuration = 0;
      try {
        const probed = await getVideoDuration(videoPath);
        if (probed > 0) {
          sourceDuration = probed;
          await db.project.update({ where: { id }, data: { duration: probed } });
        }
      } catch (err) {
        console.error("Source duration probe failed (non-fatal):", err);
      }

      // 2. Extract audio
      await extractAudio(videoPath, audioPath);

      // 2a. Generate the audio waveform peaks for the new editor's
      //     timeline. Non-fatal — the editor falls back to a flat bar if
      //     this is missing and offers a button to regenerate later.
      //     Retained for manual-mode talk-segment detection below.
      let peaks: number[] = [];
      try {
        peaks = await generatePeaks(audioPath);
        if (peaks.length > 0) {
          await db.project.update({
            where: { id },
            data: { waveform: JSON.stringify(peaks) },
          });
        }
      } catch (err) {
        console.error("Waveform generation failed (non-fatal):", err);
      }

      // (720p proxy generation moved to finishWithProxy(), run AFTER clips
      //  are created so it can never block clip detection — see above.)

      // 3. Manual mode: no Whisper/LLM/Coach, but we DO detect talking
      //    segments from the waveform here (server-side) and create one clip
      //    per segment with a thumbnail — so the clips live on the project
      //    grid as their own screen, independent of the source editor. The
      //    editor is then just the per-clip / "make more clips" surface.
      //    Coach scoring stays deferred to /api/projects/[id]/finalize.
      if (mode === "manual") {
        try {
          const segments =
            peaks.length > 0 && sourceDuration > 0
              ? detectTalkSegments(peaks, sourceDuration)
              : [];
          let n = 0;
          for (const seg of segments) {
            const clipId = randomUUID();
            const thumbRel = clipThumbPath(id, clipId);
            const thumbAbs = resolveStorage(thumbRel);
            await ensureDirFor(thumbAbs);
            await extractThumbnail(videoPath, thumbAbs, seg.start + 1).catch(() => null);
            const thumbnailUrl = fs.existsSync(thumbAbs) ? thumbRel : "";
            await db.clip.create({
              data: {
                id: clipId,
                projectId: id,
                title: `Clip ${++n}`,
                startTime: seg.start,
                endTime: seg.end,
                score: null,
                words: "[]",
                thumbnailUrl,
              },
            });
          }
        } catch (err) {
          console.error("Manual clip detection failed (non-fatal):", err);
        }
        await finishWithProxy();
        return;
      }

      // 4. AI mode: full transcription via Whisper (powers highlight
      //    detection, captions, Coach).
      const transcription = await transcribeAudio(audioPath);
      await db.project.update({
        where: { id },
        data: {
          transcription: JSON.stringify(transcription),
          duration: transcription.duration,
        },
      });

      // Detect highlights — AssemblyAI chapters first, then LLM transcript
      // analysis as a fallback so clips always get real, specific titles.
      // Pass the local audio path; the SDK uploads to AssemblyAI's
      // /upload endpoint since our storage is local-only.
      let highlights: Highlight[] = [];
      try {
        highlights = await detectHighlights(audioPath);
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

        const thumbRel = clipThumbPath(id, clipId);
        const thumbAbs = resolveStorage(thumbRel);
        await ensureDirFor(thumbAbs);
        await extractThumbnail(videoPath, thumbAbs, clipStart + 1).catch(() => null);
        const thumbnailUrl = fs.existsSync(thumbAbs) ? thumbRel : "";

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

      await finishWithProxy();
    } catch (err) {
      console.error("Processing error:", err);
      await db.project.update({ where: { id }, data: { status: "error" } }).catch(() => null);
    } finally {
      // videoPath is the real source file in D:/clip — leave it alone.
      // Only the .tmp/ intermediates get cleaned up.
      [audioPath, proxyPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
    }
  })();

  return NextResponse.json({ message: "Processing started" });
}
