import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sliceWords, type WordTimestamp } from "@/lib/whisper";

interface Transcription {
  text: string;
  words: WordTimestamp[];
  duration: number;
}

// Author a new clip by hand from the source editor. Slices the words
// out of the project's full transcription so the clip carries its own
// caption data (clip-local timestamps).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const startTime = Number(body.startTime);
  const endTime = Number(body.endTime);
  const muted = body.muted === true;
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return NextResponse.json({ error: "Invalid startTime/endTime" }, { status: 400 });
  }

  let words: WordTimestamp[] = [];
  if (project.transcription) {
    try {
      const parsed = JSON.parse(project.transcription) as Transcription;
      if (Array.isArray(parsed.words)) {
        words = sliceWords(parsed.words, startTime, endTime);
      }
    } catch {}
  }

  // Title fallback: first ~5 words of the clip's spoken text, else "Clip N"
  // where N is one more than the project's current clip count.
  let title = (body.title ?? "").toString().trim();
  if (!title) {
    const snippet = words.slice(0, 5).map((w) => w.word).join(" ").trim();
    if (snippet.length > 0) {
      title = snippet.length > 60 ? snippet.slice(0, 57) + "…" : snippet;
    } else {
      const count = await db.clip.count({ where: { projectId: id } });
      title = `Clip ${count + 1}`;
    }
  }

  const clip = await db.clip.create({
    data: {
      projectId: id,
      title,
      startTime,
      endTime,
      score: null,
      words: JSON.stringify(words),
      muted,
    },
  });

  return NextResponse.json({ clip });
}
