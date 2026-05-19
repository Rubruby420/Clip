import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { evaluateClip } from "@/lib/coach";
import { generateSearchQueries } from "@/lib/remix";
import { searchViralVideos } from "@/lib/youtube";

interface ClipWord { word: string; start: number; end: number }

// GET — return the cached coach report for this clip (if any).
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  let coach = null;
  if (clip.coachData) {
    try { coach = JSON.parse(clip.coachData); } catch {}
  }
  return NextResponse.json({ coach });
}

// POST — run a full coach check: evaluate the clip and, when it isn't
// viral-ready, pull reference viral videos to compare against.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  try {
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const transcript = words.map((w) => w.word).join(" ").trim();

    const report = await evaluateClip({
      title: clip.title,
      transcript,
      durationSec: clip.endTime - clip.startTime,
    });

    // For weak clips, pull reference viral videos to compare against.
    let videos: Awaited<ReturnType<typeof searchViralVideos>> = [];
    if (!report.viralReady) {
      try {
        const queries = await generateSearchQueries(clip.title, transcript);
        if (queries.length === 0) queries.push(clip.title);
        videos = (await searchViralVideos(queries)).slice(0, 5);
      } catch (err) {
        console.error("Coach reference-video fetch failed:", err);
      }
    }

    const coach = { report, videos, generatedAt: new Date().toISOString() };
    await db.clip.update({ where: { id }, data: { coachData: JSON.stringify(coach) } });
    return NextResponse.json({ coach });
  } catch (err) {
    console.error("Coach evaluation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Coach evaluation failed" },
      { status: 500 }
    );
  }
}
