import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateCloneRecipe } from "@/lib/remix";
import type { ViralVideo } from "@/lib/youtube";

interface ClipWord { word: string; start: number; end: number }

// POST — given a set of videoIds the user picked from the candidates returned
// by /api/remix/[clipId], generate a beat-by-beat clone recipe that reshapes
// the user's clip in those references' style. Updates the cached remix.
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await params;
  const { videoIds } = (await req.json()) as { videoIds?: string[] };

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one reference video to clone." },
      { status: 400 }
    );
  }

  const clip = await db.clip.findUnique({ where: { id: clipId } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  // The candidates were saved on the clip when /api/remix was last called.
  let remix: { candidates?: ViralVideo[]; queries?: string[] } = {};
  try { remix = clip.remixData ? JSON.parse(clip.remixData) : {}; } catch {}
  const candidates = remix.candidates || [];
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "No reference candidates cached. Find references first." },
      { status: 409 }
    );
  }

  const picks = candidates.filter((v) => videoIds.includes(v.videoId)).slice(0, 5);
  if (picks.length === 0) {
    return NextResponse.json(
      { error: "Picked videos are not among the cached candidates." },
      { status: 400 }
    );
  }

  try {
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const transcript = words.map((w) => w.word).join(" ").trim();

    const recipe = await generateCloneRecipe({
      title: clip.title,
      transcript,
      durationSec: clip.endTime - clip.startTime,
      picks,
    });

    const updated = {
      candidates,
      queries: remix.queries || [],
      recipe,
      pickedIds: picks.map((p) => p.videoId),
      generatedAt: new Date().toISOString(),
    };

    await db.clip.update({ where: { id: clipId }, data: { remixData: JSON.stringify(updated) } });

    return NextResponse.json({ remix: updated });
  } catch (err) {
    console.error("Clone recipe error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build clone recipe" },
      { status: 500 }
    );
  }
}
