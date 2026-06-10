import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { exportClip, exportSplicedClip, generateSRT, generateOverlayAss, tmpPath } from "@/lib/ffmpeg";
import {
  resolveStorage,
  ensureDirFor,
  clipExportPath,
  projectLogoPath,
} from "@/lib/storage";
import fs from "fs";
import https from "https";
import http from "http";
import { randomUUID } from "crypto";

// Background music tracks still come from Jamendo as remote URLs.
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
  const { aspectRatio = "9:16", blurBackground = true } = await req.json();

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const clip = await db.clip.findUnique({ where: { id }, include: { project: true } });
      if (!clip) {
        send({ error: "Clip not found" });
        controller.close();
        return;
      }

      const exportId = randomUUID();
      const videoPath = resolveStorage(clip.project.originalUrl);
      const outPath = tmpPath(`export_out_${exportId}.mp4`);
      const srtPath = tmpPath(`export_${exportId}.srt`);
      const hookPath = tmpPath(`export_hook_${exportId}.ass`);
      const musicPath = tmpPath(`export_music_${exportId}.mp3`);

      const ar = aspectRatio as "9:16" | "16:9" | "1:1";

      try {
        const splicedSegments = clip.segments
          ? (JSON.parse(clip.segments) as Array<{ start: number; end: number }>)
          : null;

        if (Array.isArray(splicedSegments) && splicedSegments.length > 0) {
          // Spliced clip — report progress per segment.
          const total = splicedSegments.length;
          await exportSplicedClip({
            inputPath: videoPath,
            outputPath: outPath,
            segments: splicedSegments,
            aspectRatio: ar,
            blurBackground,
            onSegmentProgress: (segIdx, segPct) => {
              const overall = Math.round(((segIdx + segPct / 100) / total) * 99);
              send({ pct: overall });
            },
          });
        } else {
          // Standard clip — stream FFmpeg progress.
          const words = JSON.parse(clip.words) as Array<{ word: string; start: number; end: number }>;
          if (words.length > 0) {
            const srt = await generateSRT(words, clip.captionStyle);
            fs.writeFileSync(srtPath, srt);
          }

          let overlayText = "";
          let overlayDuration = 3;
          let musicUrl = "";
          let musicVolume = 0.25;
          let logoStoragePath = "";
          let logoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" = "bottom-right";
          let logoSize = 15;
          let logoOpacity = 0.9;
          type Beat = { text: string; emoji: string; start: number; end: number; position: "top" | "center" | "bottom" };
          let beats: Beat[] = [];
          try {
            const lc = clip.layoutConfig ? JSON.parse(clip.layoutConfig) : {};
            overlayText = lc.overlayEnabled === false ? "" : String(lc.overlayText || "").trim();
            overlayDuration = Number(lc.overlayDuration) || 3;
            musicUrl = lc.musicEnabled === false ? "" : String(lc.musicUrl || "").trim();
            musicVolume = Number(lc.musicVolume ?? 0.25);
            logoStoragePath = String(lc.logoUrl || "").trim();
            logoPosition = (["top-left","top-right","bottom-left","bottom-right"].includes(lc.logoPosition)
              ? lc.logoPosition : "bottom-right") as typeof logoPosition;
            logoSize = Number(lc.logoSize) || 15;
            logoOpacity = Number(lc.logoOpacity ?? 0.9);
            if (lc.beatOverlaysEnabled !== false && Array.isArray(lc.beatOverlays)) {
              beats = lc.beatOverlays
                .map((b: Record<string, unknown>) => ({
                  text: String(b.text ?? ""),
                  emoji: String(b.emoji ?? ""),
                  start: Number(b.start ?? 0),
                  end: Number(b.end ?? 0),
                  position: (b.position === "top" || b.position === "bottom" ? b.position : "center") as "top" | "center" | "bottom",
                }))
                .filter((b: Beat) => (b.text || b.emoji) && b.end > b.start);
            }
          } catch {}

          if (musicUrl) {
            try { await downloadFile(musicUrl, musicPath); } catch (e) { console.warn("Music download failed:", e); }
          }

          const w = ar === "16:9" ? 1920 : 1080;
          const h = ar === "16:9" ? 1080 : ar === "9:16" ? 1920 : 1080;
          if (overlayText || beats.length > 0) {
            fs.writeFileSync(
              hookPath,
              generateOverlayAss({ hookText: overlayText, hookDuration: overlayDuration, beats, videoW: w, videoH: h })
            );
          }

          // Resolve logo to absolute path if set; skip if the file doesn't exist.
          const resolvedLogoPath = (() => {
            if (!logoStoragePath) return undefined;
            try {
              const abs = resolveStorage(logoStoragePath);
              return fs.existsSync(abs) ? abs : undefined;
            } catch { return undefined; }
          })();

          await exportClip({
            inputPath: videoPath,
            outputPath: outPath,
            startTime: clip.startTime,
            endTime: clip.endTime,
            aspectRatio: ar,
            subtitlePath: fs.existsSync(srtPath) ? srtPath : undefined,
            hookOverlayAssPath: fs.existsSync(hookPath) ? hookPath : undefined,
            musicPath: fs.existsSync(musicPath) ? musicPath : undefined,
            musicVolume,
            blurBackground,
            logoPath: resolvedLogoPath,
            logoPosition,
            logoSize,
            logoOpacity,
            onProgress: (pct) => send({ pct }),
          });
        }

        // Move finished mp4 into the clip's storage folder.
        const exportRel = clipExportPath(clip.projectId, clip.id);
        const exportAbs = resolveStorage(exportRel);
        await ensureDirFor(exportAbs);
        fs.copyFileSync(outPath, exportAbs);

        const updated = await db.clip.update({
          where: { id },
          data: { exportUrl: exportRel, exportKey: exportRel },
        });

        send({ done: true, exportUrl: exportRel, clip: updated });
      } catch (err) {
        console.error("Export error:", err);
        send({ error: String(err) });
      } finally {
        void exportId;
        [outPath, srtPath, hookPath, musicPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
