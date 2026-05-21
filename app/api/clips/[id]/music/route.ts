import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchMusicByVibe } from "@/lib/music";

// POST — pick a Jamendo track matching the clip's music vibe (from the AI
// remix recipe) and return it. The editor saves it into the clip's
// layoutConfig so it plays in preview and bakes into export.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { vibe?: string };

  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  // Prefer the explicit vibe from the request; fall back to the recipe stored
  // on the clip's remixData; final fallback is a generic upbeat search.
  let vibe = body.vibe?.trim();
  if (!vibe && clip.remixData) {
    try {
      const remix = JSON.parse(clip.remixData) as { recipe?: { musicVibe?: string } };
      if (remix?.recipe?.musicVibe) vibe = String(remix.recipe.musicVibe);
    } catch {}
  }
  if (!vibe) vibe = "upbeat background";

  const clipLen = Math.max(1, clip.endTime - clip.startTime);
  try {
    const track = await searchMusicByVibe(vibe, Math.round(clipLen));
    if (!track) {
      return NextResponse.json(
        { error: "No matching tracks found on Jamendo for that vibe." },
        { status: 404 }
      );
    }
    return NextResponse.json({ track });
  } catch (err) {
    console.error("Music search error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to find music" },
      { status: 500 }
    );
  }
}
