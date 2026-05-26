import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractAudio, tmpPath } from "@/lib/ffmpeg";
import { generatePeaks } from "@/lib/waveform";
import { resolveStorage } from "@/lib/storage";
import fs from "fs";

// On-demand waveform generation for projects that don't have one yet.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const videoPath = resolveStorage(project.originalUrl);
  const audioPath = tmpPath(`${id}_wf.mp3`);
  try {
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
    try { fs.unlinkSync(audioPath); } catch {}
  }
}
