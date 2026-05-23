import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadPresignedUrl } from "@/lib/r2";
import { extractAudio, tmpPath } from "@/lib/ffmpeg";
import { generatePeaks } from "@/lib/waveform";
import fs from "fs";
import https from "https";
import http from "http";

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

// On-demand waveform generation for projects uploaded before the
// waveform column existed. Mirrors the proxy endpoint pattern.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const videoPath = tmpPath(`${id}_wf_src.mp4`);
  const audioPath = tmpPath(`${id}_wf.mp3`);
  try {
    const downloadUrl = await getDownloadPresignedUrl(project.originalKey);
    await downloadFile(downloadUrl, videoPath);
    await extractAudio(videoPath, audioPath);
    const peaks = await generatePeaks(audioPath);
    if (peaks.length === 0) {
      return NextResponse.json({ error: "No audio detected — couldn't compute peaks" }, { status: 500 });
    }
    const updated = await db.project.update({
      where: { id },
      data: { waveform: JSON.stringify(peaks) },
    });
    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("Manual waveform generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Waveform generation failed" },
      { status: 500 }
    );
  } finally {
    [videoPath, audioPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
  }
}
