import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { WordTimestamp } from "@/lib/whisper";

// Razor-tool split: replace one saved clip with two adjacent clips that
// meet at `at`. Atomic — either both halves land or the original survives.
//
// Body: { at: number } where `at` is in source-video seconds (same units
// as Clip.startTime / endTime).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const at = Number(body.at);
  if (!Number.isFinite(at) || at <= clip.startTime || at >= clip.endTime) {
    return NextResponse.json(
      { error: "Split point must lie strictly between the clip's start and end" },
      { status: 400 }
    );
  }

  const relAt = at - clip.startTime;

  let allWords: WordTimestamp[] = [];
  try {
    const parsed = JSON.parse(clip.words || "[]");
    if (Array.isArray(parsed)) allWords = parsed as WordTimestamp[];
  } catch {}

  const wordsA = allWords.filter((w) => w.end <= relAt);
  const wordsB = allWords
    .filter((w) => w.start >= relAt)
    .map((w) => ({ ...w, start: w.start - relAt, end: w.end - relAt }));

  function deriveTitle(words: WordTimestamp[], fallback: string): string {
    const snippet = words.slice(0, 5).map((w) => w.word).join(" ").trim();
    if (!snippet) return fallback;
    return snippet.length > 60 ? snippet.slice(0, 57) + "…" : snippet;
  }

  const titleB = deriveTitle(wordsB, `${clip.title} (cont.)`);

  // Atomic: delete original + create two halves. Prisma's $transaction with
  // an array runs each statement in a single DB transaction (SQLite).
  const [, a, b] = await db.$transaction([
    db.clip.delete({ where: { id } }),
    db.clip.create({
      data: {
        projectId: clip.projectId,
        title: clip.title,
        startTime: clip.startTime,
        endTime: at,
        score: clip.score,
        words: JSON.stringify(wordsA),
        captionStyle: clip.captionStyle,
        layoutConfig: clip.layoutConfig,
        thumbnailUrl: clip.thumbnailUrl,
        remixData: clip.remixData,
        storyData: clip.storyData,
        // Coach + export reset — they're now stale for half-the-clip.
        coachData: null,
        exportUrl: null,
        exportKey: null,
      },
    }),
    db.clip.create({
      data: {
        projectId: clip.projectId,
        title: titleB,
        startTime: at,
        endTime: clip.endTime,
        score: clip.score,
        words: JSON.stringify(wordsB),
        captionStyle: clip.captionStyle,
        layoutConfig: clip.layoutConfig,
        // No thumbnail for B yet — project page handles null gracefully.
        thumbnailUrl: null,
        remixData: clip.remixData,
        storyData: null,
        coachData: null,
        exportUrl: null,
        exportKey: null,
      },
    }),
  ]);

  return NextResponse.json({ a, b });
}
