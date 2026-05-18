import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchViralVideos } from "@/lib/youtube";
import { generateSearchQueries, generateRemixRecipe } from "@/lib/remix";

interface ClipWord { word: string; start: number; end: number }

// GET — return the cached remix for this clip (if any).
export async function GET(_: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  const clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  let remix = null;
  if (clip.remixData) {
    try { remix = JSON.parse(clip.remixData); } catch {}
  }
  return NextResponse.json({ remix });
}

// POST — generate a fresh viral-remix recipe for this clip.
export async function POST(_: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  const clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  try {
    // Build the clip transcript from its word timestamps.
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const transcript = words.map((w) => w.word).join(" ").trim();

    // 1. Decide what to search for.
    const queries = await generateSearchQueries(clip.title, transcript);
    if (queries.length === 0) queries.push(clip.title);

    // 2. Find viral reference videos.
    const videos = await searchViralVideos(queries);
    if (videos.length === 0) {
      return NextResponse.json(
        { error: "No viral reference videos found for this topic. Try editing the clip title to be more specific." },
        { status: 422 }
      );
    }

    // 3. Turn the references into a remix recipe for this clip.
    const recipe = await generateRemixRecipe({
      title: clip.title,
      transcript,
      durationSec: clip.endTime - clip.startTime,
      videos,
    });

    const remix = {
      recipe,
      videos: videos.slice(0, 6),
      queries,
      generatedAt: new Date().toISOString(),
    };

    await db.clip.update({ where: { id: clipId }, data: { remixData: JSON.stringify(remix) } });

    return NextResponse.json({ remix });
  } catch (err) {
    console.error("Remix error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate remix" },
      { status: 500 }
    );
  }
}
