import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectTalkSegments } from "@/lib/silence";
import { extractThumbnail } from "@/lib/ffmpeg";
import { resolveStorage, ensureDirFor, clipThumbPath } from "@/lib/storage";
import fs from "fs";
import { randomUUID } from "crypto";

// "Detect Speakers" — opt-in talking-segment detection. Reads the waveform
// peaks generated during prep, finds the talking segments, and creates one
// clip per segment (with a thumbnail). This used to run automatically in
// Manual mode; it's now an explicit button on the project page so "Manual"
// stays hands-off until the user asks for it.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!project.waveform) {
    return NextResponse.json(
      { error: "The waveform isn't ready yet — give prep a moment, then try again." },
      { status: 409 },
    );
  }

  let peaks: number[] = [];
  try { peaks = JSON.parse(project.waveform); } catch {}
  const duration = project.duration ?? 0;

  const segments = peaks.length > 0 && duration > 0 ? detectTalkSegments(peaks, duration) : [];
  if (segments.length === 0) {
    return NextResponse.json({ created: 0, message: "No clear talking segments found." });
  }

  const videoPath = resolveStorage(project.originalUrl);
  // Number new clips after any that already exist so titles stay sequential.
  let n = await db.clip.count({ where: { projectId: id } });

  const created = [];
  for (const seg of segments) {
    const clipId = randomUUID();
    const thumbRel = clipThumbPath(id, clipId);
    const thumbAbs = resolveStorage(thumbRel);
    await ensureDirFor(thumbAbs);
    await extractThumbnail(videoPath, thumbAbs, seg.start + 1).catch(() => null);
    const thumbnailUrl = fs.existsSync(thumbAbs) ? thumbRel : "";
    const clip = await db.clip.create({
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
    created.push(clip);
  }

  return NextResponse.json({ created: created.length, clips: created });
}
