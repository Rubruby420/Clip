import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exportClip, exportSplicedClip, generateSRT, generateOverlayAss, tmpPath } from "@/lib/ffmpeg";
import {
  resolveStorage,
  ensureDirFor,
  clipExportPath,
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

  const clip = await db.clip.findUnique({ where: { id }, include: { project: true } });
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const exportId = randomUUID();
  // Source comes straight off disk now.
  const videoPath = resolveStorage(clip.project.originalUrl);
  // Render to .tmp first, then copy into the project folder once FFmpeg
  // is done so a partial file never appears at the public path.
  const outPath = tmpPath(`export_out_${exportId}.mp4`);
  const srtPath = tmpPath(`export_${exportId}.srt`);
  const hookPath = tmpPath(`export_hook_${exportId}.ass`);
  const musicPath = tmpPath(`export_music_${exportId}.mp3`);

  // Per-segment temp parts for the spliced-concat path are cleaned in finally.
  const ar = aspectRatio as "9:16" | "16:9" | "1:1";

  try {
    // Spliced clip: an ordered list of source segments stitched into one
    // video. v1 renders video+audio only (no captions/overlays/music — those
    // would need remapping onto the stitched timeline; deferred).
    const splicedSegments = clip.segments
      ? (JSON.parse(clip.segments) as Array<{ start: number; end: number }>)
      : null;
    if (Array.isArray(splicedSegments) && splicedSegments.length > 0) {
      await exportSplicedClip({
        inputPath: videoPath,
        outputPath: outPath,
        segments: splicedSegments,
        aspectRatio: ar,
        blurBackground,
      });
    } else {
    // Generate SRT captions
    const words = JSON.parse(clip.words) as Array<{ word: string; start: number; end: number }>;
    if (words.length > 0) {
      const srt = await generateSRT(words, clip.captionStyle);
      fs.writeFileSync(srtPath, srt);
    }

    // Build the unified overlay ASS — hook + every beat overlay — so the
    // exported mp4 matches what the user previewed in the editor.
    let overlayText = "";
    let overlayDuration = 3;
    let musicUrl = "";
    let musicVolume = 0.25;
    type Beat = { text: string; emoji: string; start: number; end: number; position: "top" | "center" | "bottom" };
    let beats: Beat[] = [];
    try {
      const lc = clip.layoutConfig ? JSON.parse(clip.layoutConfig) : {};
      overlayText = lc.overlayEnabled === false ? "" : String(lc.overlayText || "").trim();
      overlayDuration = Number(lc.overlayDuration) || 3;
      musicUrl = lc.musicEnabled === false ? "" : String(lc.musicUrl || "").trim();
      musicVolume = Number(lc.musicVolume ?? 0.25);
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

    // Download the background music track if one was picked.
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

    // Render with FFmpeg
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
    });
    }

    // Move the finished mp4 into the clip's storage folder.
    const exportRel = clipExportPath(clip.projectId, clip.id);
    const exportAbs = resolveStorage(exportRel);
    await ensureDirFor(exportAbs);
    fs.copyFileSync(outPath, exportAbs);

    const updated = await db.clip.update({
      where: { id },
      data: { exportUrl: exportRel, exportKey: exportRel },
    });

    return NextResponse.json({ clip: updated, exportUrl: exportRel });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    // videoPath is the real source file — leave it. Only tmp files get
    // cleaned. (`exportId` is unused otherwise; keep it referenced.)
    void exportId;
    [outPath, srtPath, hookPath, musicPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
  }
}
