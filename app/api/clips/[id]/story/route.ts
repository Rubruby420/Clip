import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateStoryPlan } from "@/lib/story";

interface ClipWord { word: string; start: number; end: number }

// GET — return the cached story plan for this clip (if any).
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  let story = null;
  if (clip.storyData) {
    try { story = JSON.parse(clip.storyData); } catch {}
  }
  return NextResponse.json({ story, clipStart: clip.startTime });
}

// POST — generate a fresh story plan for this clip.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id }, include: { project: true } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  try {
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}

    // Whole-video transcript for context, so the story stays accurate.
    let fullTranscript = "";
    if (clip.project.transcription) {
      try {
        fullTranscript = JSON.parse(clip.project.transcription).text || "";
      } catch {}
    }

    const transcriptEnd = words.length > 0 ? words[words.length - 1].end : 0;
    const clipDuration = Math.max(clip.endTime - clip.startTime, transcriptEnd);

    const plan = await generateStoryPlan({
      clipTitle: clip.title,
      words,
      fullTranscript,
      clipDuration,
    });

    await db.clip.update({ where: { id }, data: { storyData: JSON.stringify(plan) } });

    return NextResponse.json({ story: plan, clipStart: clip.startTime });
  } catch (err) {
    console.error("Story generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Story generation failed" },
      { status: 500 }
    );
  }
}
