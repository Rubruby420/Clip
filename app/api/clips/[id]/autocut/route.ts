import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { selectBestSegment } from "@/lib/highlights";

interface ClipWord { word: string; start: number; end: number }

// POST — let AI choose the best part of a clip. Returns suggested absolute
// start/end times; it does not save them (the editor applies the choice).
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  let words: ClipWord[] = [];
  try { words = JSON.parse(clip.words || "[]"); } catch {}

  // Clip word timestamps are relative to the clip's start. Use the span the
  // transcript actually covers so the AI can trim the full rough clip.
  const transcriptEnd = words.length > 0 ? words[words.length - 1].end : 0;
  const duration = Math.max(clip.endTime - clip.startTime, transcriptEnd);

  const seg = await selectBestSegment(words, duration).catch((err) => {
    console.error("AI auto-cut failed:", err);
    return null;
  });
  if (!seg) {
    return NextResponse.json(
      { error: "Not enough transcript to auto-cut this clip — trim it manually." },
      { status: 422 }
    );
  }

  // Convert clip-relative times to absolute video times for the editor.
  return NextResponse.json({
    startTime: clip.startTime + seg.start,
    endTime: clip.startTime + seg.end,
    reason: seg.reason,
  });
}
