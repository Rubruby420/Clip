import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadPresignedUrl, uploadBuffer } from "@/lib/r2";
import { exportClip, generateSRT, tmpPath } from "@/lib/ffmpeg";
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
  const { aspectRatio = "9:16", blurBackground = true } = await req.json();

  const clip = await db.clip.findUnique({ where: { id }, include: { project: true } });
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const exportId = randomUUID();
  const videoPath = tmpPath(`export_src_${exportId}.mp4`);
  const outPath = tmpPath(`export_out_${exportId}.mp4`);
  const srtPath = tmpPath(`export_${exportId}.srt`);

  try {
    // Download source video
    const downloadUrl = await getDownloadPresignedUrl(clip.project.originalKey);
    await downloadFile(downloadUrl, videoPath);

    // Generate SRT captions
    const words = JSON.parse(clip.words) as Array<{ word: string; start: number; end: number }>;
    if (words.length > 0) {
      const srt = await generateSRT(words, clip.captionStyle);
      fs.writeFileSync(srtPath, srt);
    }

    // Render with FFmpeg
    await exportClip({
      inputPath: videoPath,
      outputPath: outPath,
      startTime: clip.startTime,
      endTime: clip.endTime,
      aspectRatio: aspectRatio as "9:16" | "16:9" | "1:1",
      subtitlePath: fs.existsSync(srtPath) ? srtPath : undefined,
      blurBackground,
    });

    // Upload to R2
    const buffer = fs.readFileSync(outPath);
    const exportKey = `exports/${exportId}.mp4`;
    const exportUrl = await uploadBuffer(exportKey, buffer, "video/mp4");

    // Store in DB
    const updated = await db.clip.update({
      where: { id },
      data: { exportUrl, exportKey },
    });

    return NextResponse.json({ clip: updated, exportUrl });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    [videoPath, outPath, srtPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
  }
}
