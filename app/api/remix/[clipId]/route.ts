import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchViralVideos } from "@/lib/youtube";
import { generateSearchQueries } from "@/lib/remix";

interface ClipWord { word: string; start: number; end: number }

// GET — return the cached remix state for this clip (candidates + optional recipe).
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

// POST — find 10 viral reference candidates for this clip. The user then
// picks which ones they want to clone the style of (handled by the /clone
// subroute), so this stage no longer produces a recipe.
export async function POST(_: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  const clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  try {
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const transcript = words.map((w) => w.word).join(" ").trim();

    const queries = await generateSearchQueries(clip.title, transcript);
    if (queries.length === 0) queries.push(clip.title);

    const videos = await searchViralVideos(queries);
    if (videos.length === 0) {
      return NextResponse.json(
        { error: "No viral reference videos found for this topic. Try editing the clip title to be more specific." },
        { status: 422 }
      );
    }

    const remix = {
      candidates: videos.slice(0, 10),
      queries,
      recipe: null,
      generatedAt: new Date().toISOString(),
    };

    await db.clip.update({ where: { id: clipId }, data: { remixData: JSON.stringify(remix) } });

    return NextResponse.json({ remix });
  } catch (err) {
    console.error("Remix search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to find references" },
      { status: 500 }
    );
  }
}
