import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sliceWords, type WordTimestamp } from "@/lib/whisper";
import { MIN_CUT } from "@/lib/silence";
import { randomUUID } from "crypto";

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
  const muted = body.muted === true;

  // Spliced clip: an ordered list of source-time segments stitched into one
  // output. When present it drives the span (startTime/endTime) and, later,
  // sequence preview + concat export. Validate each segment, then derive the
  // envelope so legacy code that reads [startTime,endTime] still has a range.
  let segmentsJson: string | null = null;
  let startTime: number;
  let endTime: number;
  const rawSegments = Array.isArray(body.segments) ? body.segments : null;
  if (rawSegments) {
    const segs = rawSegments
      .map((s: Record<string, unknown>) => ({
        id: String(s.id ?? randomUUID()),
        start: Number(s.start),
        end: Number(s.end),
      }))
      .filter((s: { start: number; end: number }) =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= MIN_CUT);
    if (segs.length === 0) {
      return NextResponse.json({ error: "A splice needs at least one segment" }, { status: 400 });
    }
    segmentsJson = JSON.stringify(segs);
    startTime = Math.min(...segs.map((s: { start: number }) => s.start));
    endTime = Math.max(...segs.map((s: { end: number }) => s.end));
  } else {
    startTime = Number(body.startTime);
    endTime = Number(body.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime - startTime < MIN_CUT) {
      return NextResponse.json(
        { error: `Clip must be at least ${MIN_CUT}s long` },
        { status: 400 },
      );
    }
  }

  // Spliced clips carry no clip-local captions in v1 (the stitched timeline
  // would need word remapping — deferred), so skip word slicing for them.
  let words: WordTimestamp[] = [];
  if (!segmentsJson && project.transcription) {
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
      title = segmentsJson ? `Spliced ${count + 1}` : `Clip ${count + 1}`;
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
      segments: segmentsJson,
    },
  });

  return NextResponse.json({ clip });
}
