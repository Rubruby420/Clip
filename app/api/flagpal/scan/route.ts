import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanForViolations, type FlagReport, type FlagPlatform } from "@/lib/flagpal";
import { transcribeAudio } from "@/lib/whisper";
import { extractAudio, tmpPath } from "@/lib/ffmpeg";
import { resolveStorage } from "@/lib/storage";
import fs from "fs";

interface ScanItem {
  kind: "project" | "clip";
  id: string;
}

interface ClipWord { word: string; start: number; end: number }
interface StoredTranscription { text: string; words: ClipWord[]; duration: number }

// Project.transcription is stored as JSON.stringify({ text, words, duration }).
function parseProjectTranscription(raw: string): { text: string; words: ClipWord[] } | null {
  try {
    const parsed: StoredTranscription = JSON.parse(raw);
    if (parsed.text) return { text: parsed.text, words: parsed.words ?? [] };
  } catch {}
  if (raw.trim()) return { text: raw.trim(), words: [] };
  return null;
}

// Run Whisper on the project's source video, store the result, and return
// the transcript + words. Called when a project has no stored transcription.
async function transcribeProject(project: {
  id: string;
  originalUrl: string;
  duration: number | null;
}): Promise<{ text: string; words: ClipWord[] } | null> {
  const videoPath = resolveStorage(project.originalUrl);
  if (!fs.existsSync(videoPath)) return null;

  const audioPath = tmpPath(`flagpal-${project.id}.mp3`);
  try {
    await extractAudio(videoPath, audioPath);
    const transcription = await transcribeAudio(audioPath);
    if (!transcription.text.trim()) return null;

    // Store so future scans skip Whisper
    await db.project.update({
      where: { id: project.id },
      data: {
        transcription: JSON.stringify(transcription),
        ...(transcription.duration > 0 && !project.duration
          ? { duration: transcription.duration }
          : {}),
      },
    });

    return { text: transcription.text, words: transcription.words };
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

// POST { items: ScanItem[] }
// Scans each project or clip for YouTube policy/copyright violations.
// No DB writes for results — session-only. Transcription IS stored as a
// side-effect when a manual-mode project has no stored transcript.
export async function POST(req: NextRequest) {
  let items: ScanItem[] = [];
  let platform: FlagPlatform = "youtube";
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
    if (["youtube", "tiktok", "instagram"].includes(body.platform)) platform = body.platform;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (items.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const capped = items.slice(0, 20);

  const results = await Promise.all(
    capped.map(async (item) => {
      try {
        if (item.kind === "project") {
          const project = await db.project.findUnique({
            where: { id: item.id },
            include: { clips: { select: { words: true } } },
          });
          if (!project) {
            return { kind: item.kind, id: item.id, title: "Unknown", report: noSpeech() };
          }

          let transcript = "";
          let words: ClipWord[] = [];

          // 1. Stored Whisper JSON from AI-mode processing
          if (project.transcription) {
            const parsed = parseProjectTranscription(project.transcription);
            if (parsed) { transcript = parsed.text; words = parsed.words; }
          }

          // 2. Fallback: stitch from clip words (AI-mode clips have words)
          if (!transcript && project.clips.length > 0) {
            for (const clip of project.clips) {
              try {
                const cw: ClipWord[] = JSON.parse(clip.words || "[]");
                words = words.concat(cw);
              } catch {}
            }
            transcript = words.map((w) => w.word).join(" ").trim();
          }

          // 3. Last resort: run Whisper now (manual-mode project, never transcribed).
          //    This is slow (~15-60s) but automatic — result gets stored for next time.
          if (!transcript) {
            const result = await transcribeProject(project).catch((err) => {
              console.error("FlagPal auto-transcribe failed:", err);
              return null;
            });
            if (result) { transcript = result.text; words = result.words; }
          }

          if (!transcript) {
            return {
              kind: item.kind, id: item.id, title: project.title,
              report: noSpeech(),
            };
          }

          const report = await scanForViolations({
            title: project.title,
            transcript,
            durationSec: project.duration ?? undefined,
            words: words.length ? words : undefined,
            platform,
          });
          return { kind: item.kind, id: item.id, title: project.title, report };

        } else {
          // clip
          const clip = await db.clip.findUnique({
            where: { id: item.id },
            include: { project: { select: { id: true, originalUrl: true, duration: true, transcription: true } } },
          });
          if (!clip) {
            return { kind: item.kind, id: item.id, title: "Unknown", report: noSpeech() };
          }

          let words: ClipWord[] = [];
          try { words = JSON.parse(clip.words || "[]"); } catch {}
          let transcript = words.map((w) => w.word).join(" ").trim();

          // If clip has no words (manual-mode cut), try slicing from the
          // project transcription if it exists.
          if (!transcript && clip.project.transcription) {
            const parsed = parseProjectTranscription(clip.project.transcription);
            if (parsed) {
              const sliced = parsed.words.filter(
                (w) => w.start >= clip.startTime && w.end <= clip.endTime,
              );
              words = sliced;
              transcript = sliced.map((w) => w.word).join(" ").trim();
            }
          }

          // Auto-transcribe the whole project if no transcript exists at all,
          // then re-slice for this clip.
          if (!transcript) {
            const result = await transcribeProject(clip.project).catch(() => null);
            if (result) {
              const sliced = result.words.filter(
                (w) => w.start >= clip.startTime && w.end <= clip.endTime,
              );
              words = sliced;
              transcript = sliced.map((w) => w.word).join(" ").trim();
            }
          }

          if (!transcript) {
            return { kind: item.kind, id: item.id, title: clip.title, report: noSpeech() };
          }

          const report = await scanForViolations({
            title: clip.title,
            transcript,
            durationSec: clip.endTime - clip.startTime,
            words: words.length ? words : undefined,
            platform,
          });
          return { kind: item.kind, id: item.id, title: clip.title, report };
        }
      } catch (err) {
        console.error(`FlagPal scan error for ${item.kind} ${item.id}:`, err);
        const msg = err instanceof Error ? err.message : "Scan failed";
        const errorReport: FlagReport = {
          status: "clean",
          riskScore: 0,
          summary: `Error: ${msg}`,
          violations: [],
        };
        return { kind: item.kind, id: item.id, title: item.id, report: errorReport };
      }
    })
  );

  return NextResponse.json({ results });
}

function noSpeech(): FlagReport {
  return {
    status: "clean",
    riskScore: 0,
    summary: "No speech detected in this video.",
    violations: [],
  };
}
