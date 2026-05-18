// LLM-based highlight detection — reads the Whisper transcript (with word
// timestamps) and picks real, well-titled clip moments. Used as a fallback
// when AssemblyAI returns no chapters, so clips never get generic "Clip N"
// titles.

import OpenAI from "openai";
import type { Highlight } from "./assemblyai";
import type { TranscriptionResult, WordTimestamp } from "./whisper";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

// Build a transcript with periodic [12.3s] markers so the model can locate
// moments accurately enough to return start/end times.
function timestampedTranscript(words: WordTimestamp[]): string {
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i % 12 === 0) parts.push(`\n[${words[i].start.toFixed(1)}s]`);
    parts.push(words[i].word);
  }
  return parts.join(" ").trim();
}

/**
 * Find the most clip-worthy moments in a transcript and title each one.
 * Returns [] if there is nothing usable to analyse.
 */
export async function detectHighlightsFromTranscript(
  transcription: TranscriptionResult
): Promise<Highlight[]> {
  const { words, text } = transcription;
  if (!text?.trim()) return [];

  // Fall back to the last word's end time if Whisper gave no duration.
  const duration =
    transcription.duration > 0
      ? transcription.duration
      : words.length > 0
        ? words[words.length - 1].end
        : 0;
  if (duration <= 0) return [];

  const transcript =
    words.length > 0 ? timestampedTranscript(words) : text;

  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a short-form video producer. Given a timestamped transcript of a long recording, identify the moments most likely to perform as standalone viral clips. Every clip gets a specific, punchy title describing what actually happens — never generic names like 'Clip 1'.",
      },
      {
        role: "user",
        content: `Video duration: ${Math.round(duration)}s.
Timestamped transcript (markers like [12.3s] mark when that part starts):
${transcript.slice(0, 12000)}

Return JSON: {"highlights":[{"title","start","end","score","summary"}]}
Rules:
- 5 to 12 highlights, ordered best first.
- start and end are seconds within 0-${Math.round(duration)}; start < end.
- Each clip is 15-60 seconds long.
- title: <= 8 words, specific to what is said, scroll-stopping.
- score: 0-1 viral potential.
- summary: one sentence.`,
      },
    ],
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");
  const raw: unknown[] = Array.isArray(json.highlights) ? json.highlights : [];

  const out: Highlight[] = [];
  for (const item of raw) {
    const h = item as Record<string, unknown>;
    let start = Number(h.start);
    let end = Number(h.end);
    if (!isFinite(start) || !isFinite(end)) continue;

    start = Math.max(0, Math.min(start, duration));
    end = Math.max(0, Math.min(end, duration));
    if (end - start < 8) continue; // too short to be a real clip
    if (end - start > 90) end = start + 60; // trim runaway segments

    const title = String(h.title || "").trim();
    if (!title) continue;

    out.push({
      title,
      start,
      end,
      score: Math.max(0, Math.min(1, Number(h.score) || 0.5)),
      summary: String(h.summary || ""),
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 12);
}

/** Generate a single punchy title for an existing clip from its transcript. */
export async function generateClipTitle(text: string): Promise<string> {
  if (!text.trim()) return "";

  const res = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Write one punchy, specific, scroll-stopping title for a short-form video clip, based on its transcript. Max 8 words. No surrounding quotes, no hashtags, no emojis. Respond with only the title.",
      },
      { role: "user", content: text.slice(0, 3000) },
    ],
  });

  return (res.choices[0]?.message?.content || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 100);
}
