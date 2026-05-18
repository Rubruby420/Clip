import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateClipTitle } from "@/lib/highlights";

interface ClipWord { word: string; start: number; end: number }

// POST — regenerate titles for a project's clips that still have a generic
// "Clip N" (or empty) title, using each clip's own transcript.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await db.project.findUnique({
    where: { id },
    include: { clips: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const isGeneric = (t: string) => !t.trim() || /^clip\s*\d+$/i.test(t.trim());

  const results: { id: string; title: string }[] = [];
  for (const clip of project.clips) {
    if (!isGeneric(clip.title)) continue;

    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const text = words.map((w) => w.word).join(" ").trim();
    if (!text) continue;

    const title = await generateClipTitle(text).catch(() => "");
    if (title) {
      await db.clip.update({ where: { id: clip.id }, data: { title } });
      results.push({ id: clip.id, title });
    }
  }

  return NextResponse.json({ updated: results.length, clips: results });
}
