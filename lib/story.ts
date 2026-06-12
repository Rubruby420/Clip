// Story Mode — turns a rough clip into a structured short-form STORY:
// a hook, a clear middle, a payoff. Writes a hybrid voiceover (the creator's
// strongest lines kept + new narration to bridge), one on-screen callout per
// beat, sound/B-roll cues, a recommended re-cut, and an AI-picked voice.

import OpenAI from "openai";

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
const MODEL = "gpt-4o-mini";

export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export function isTtsVoice(v: unknown): v is TtsVoice {
  return typeof v === "string" && (TTS_VOICES as readonly string[]).includes(v);
}

interface WordTimestamp { word: string; start: number; end: number }

export interface StoryBeat {
  label: string; // e.g. "Hook", "The discovery", "Payoff"
  source: "original" | "bridge" | "new"; // origin of the voiceover line
  voiceover: string; // the line to be spoken for this beat
  start: number; // seconds, relative to the clip
  end: number;
  callout: string; // one on-screen text callout pointing out the main idea
  cue: string; // sound and/or B-roll cue
}

export interface StoryPlan {
  structure: string;
  structureWhy: string;
  beats: StoryBeat[];
  recutStart: number; // seconds, relative to the clip
  recutEnd: number;
  voice: TtsVoice; // AI-picked voice that fits the clip
  voiceUrl?: string; // set once a voiceover has been generated
  generatedAt: string;
}

// Build a transcript with periodic [12.3s] markers so the model can map
// story beats to real timestamps.
function timestamped(words: WordTimestamp[]): string {
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i % 12 === 0) parts.push(`\n[${words[i].start.toFixed(1)}s]`);
    parts.push(words[i].word);
  }
  return parts.join(" ").trim();
}

export async function generateStoryPlan(input: {
  clipTitle: string;
  words: WordTimestamp[];
  fullTranscript: string;
  clipDuration: number;
}): Promise<StoryPlan> {
  const dur = input.clipDuration;
  const clipTranscript =
    input.words.length > 0 ? timestamped(input.words) : "(no transcript available)";

  const res = await getOpenAI().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a short-form video story editor. You turn a rough clip into a tight, well-structured STORY for TikTok / Reels / Shorts: a strong hook, a clear middle, and a satisfying payoff. You write a HYBRID voiceover — keeping the creator's strongest original lines and adding new narration to frame and bridge them. Every story beat gets exactly one on-screen text callout that points out its main idea, plus a sound/B-roll cue. The story must make sense and be accurate to what actually happens. Respond only in JSON.",
      },
      {
        role: "user",
        content: `FULL VIDEO TRANSCRIPT (context only, so the story stays accurate):
${input.fullTranscript.slice(0, 6000)}

THIS CLIP
Title: ${input.clipTitle}
Length: ${dur.toFixed(1)}s
Timestamped transcript (markers like [12.3s] mark when that part starts):
${clipTranscript.slice(0, 6000)}

Design the best story for THIS CLIP. Choose whatever narrative structure fits best.

Return JSON:
{
  "structure": "short name of the narrative structure you chose",
  "structureWhy": "one sentence on why it fits this clip",
  "voice": "one of: ${TTS_VOICES.join(", ")} — the voice that best fits the clip's tone",
  "recutStart": <seconds within 0-${dur.toFixed(1)}>,
  "recutEnd": <seconds within 0-${dur.toFixed(1)}, greater than recutStart, span at least 8s>,
  "beats": [
    {
      "label": "beat name, e.g. Hook, Setup, The discovery, Payoff",
      "source": "original | bridge | new  (original = creator's own words kept verbatim, bridge = their words lightly tightened, new = added narration)",
      "voiceover": "the exact line to be spoken for this beat",
      "start": <seconds relative to clip>,
      "end": <seconds relative to clip>,
      "callout": "a SHORT on-screen text callout, max 6 words, pointing out this beat's main idea",
      "cue": "a concrete sound and/or B-roll cue for this beat"
    }
  ]
}
Use 3 to 5 beats, in chronological order. The first beat must be the hook.`,
      },
    ],
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");

  const beats: StoryBeat[] = (Array.isArray(json.beats) ? json.beats : [])
    .map((b: Record<string, unknown>) => ({
      label: String(b.label || "Beat"),
      source: (["original", "bridge", "new"].includes(b.source as string)
        ? b.source
        : "new") as StoryBeat["source"],
      voiceover: String(b.voiceover || ""),
      start: Math.max(0, Math.min(Number(b.start) || 0, dur)),
      end: Math.max(0, Math.min(Number(b.end) || 0, dur)),
      callout: String(b.callout || ""),
      cue: String(b.cue || ""),
    }))
    .filter((b: StoryBeat) => b.voiceover);

  let recutStart = Math.max(0, Math.min(Number(json.recutStart) || 0, dur));
  let recutEnd = Math.max(0, Math.min(Number(json.recutEnd) || dur, dur));
  if (recutEnd - recutStart < 8) {
    recutStart = 0;
    recutEnd = dur;
  }

  return {
    structure: String(json.structure || "Story"),
    structureWhy: String(json.structureWhy || ""),
    beats,
    recutStart,
    recutEnd,
    voice: isTtsVoice(json.voice) ? json.voice : "onyx",
    generatedAt: new Date().toISOString(),
  };
}

/** Generate spoken voiceover audio (mp3) from a script with OpenAI TTS. */
export async function generateVoiceover(script: string, voice: TtsVoice): Promise<Buffer> {
  const res = await getOpenAI().audio.speech.create({
    model: "tts-1",
    voice,
    input: script.slice(0, 4000),
  });
  return Buffer.from(await res.arrayBuffer());
}
