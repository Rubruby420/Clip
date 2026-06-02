import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groupSpeechSegments } from "@/lib/silence";
import { extractAudio, extractThumbnail, tmpPath } from "@/lib/ffmpeg";
import { transcribeAudio } from "@/lib/whisper";
import { resolveStorage, ensureDirFor, clipThumbPath } from "@/lib/storage";
import fs from "fs";
import { randomUUID } from "crypto";

// "Detect Speakers" — finds every segment where a human is actually talking
// and turns each into a clip.
//
// Strategy: use Whisper word-level timestamps as the source of truth for
// "speech". Whisper only emits words over real speech, so music, applause,
// bangs, and other loud-but-not-speech sections produce no words and are
// silently ignored. This replaces the old amplitude-threshold approach which
// treated any loud moment as "talking".
//
// If the project already has a transcript (from AI mode or a prior Detect
// Speakers run), it is reused — making re-runs instant and free. Otherwise
// audio is extracted and sent to Whisper; the result is persisted so the
// next run is cached.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // --- Step 1: get the transcript (cached or fresh) ---

  let transcription: { text: string; words: { word: string; start: number; end: number }[]; duration: number };

  if (project.transcription) {
    // Already transcribed (AI mode or a prior Detect Speakers run) — reuse it.
    try {
      transcription = JSON.parse(project.transcription);
    } catch {
      return NextResponse.json({ error: "Transcript data is corrupted — try re-processing." }, { status: 500 });
    }
  } else {
    // Manual-mode project: run Whisper now. Extract audio → transcribe → cache.
    const videoPath = resolveStorage(project.originalUrl);
    const audioPath = tmpPath(`${id}_detect.mp3`);
    try {
      await extractAudio(videoPath, audioPath);
      transcription = await transcribeAudio(audioPath);
      // Persist so subsequent runs are instant.
      await db.project.update({
        where: { id },
        data: {
          transcription: JSON.stringify(transcription),
          duration: transcription.duration || project.duration,
        },
      });
    } catch (err) {
      console.error("Detect Speakers — transcription failed:", err);
      return NextResponse.json(
        { error: "Transcription failed. Check your OpenAI API key and try again." },
        { status: 500 },
      );
    } finally {
      try { fs.unlinkSync(audioPath); } catch {}
    }
  }

  // --- Step 2: nothing said? ---

  if (!transcription.words || transcription.words.length === 0) {
    return NextResponse.json({ created: 0, message: "No speech detected in this video." });
  }

  // --- Step 3: group words into conversation segments ---

  const duration = (transcription.duration || project.duration) ?? 0;
  const segments = groupSpeechSegments(transcription.words, duration);

  if (segments.length === 0) {
    return NextResponse.json({ created: 0, message: "No clear talking segments found." });
  }

  // --- Step 4: create one clip per segment ---

  const videoPath = resolveStorage(project.originalUrl);
  let n = await db.clip.count({ where: { projectId: id } });

  const created = [];
  for (const seg of segments) {
    const clipId  = randomUUID();
    const thumbRel = clipThumbPath(id, clipId);
    const thumbAbs = resolveStorage(thumbRel);
    await ensureDirFor(thumbAbs);
    await extractThumbnail(videoPath, thumbAbs, seg.start + 1).catch(() => null);
    const thumbnailUrl = fs.existsSync(thumbAbs) ? thumbRel : "";

    const clip = await db.clip.create({
      data: {
        id: clipId,
        projectId: id,
        title: `Clip ${++n}`,
        startTime: seg.start,
        endTime:   seg.end,
        score:     null,
        words:     "[]",
        thumbnailUrl,
      },
    });
    created.push(clip);
  }

  return NextResponse.json({ created: created.length, clips: created });
}
