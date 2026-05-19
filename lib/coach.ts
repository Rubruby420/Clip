// Virality Coach — judges whether a clip is ready to go viral and, for clips
// that aren't, returns specific issue/fix feedback. Balanced strictness:
// flags real weaknesses, leaves genuinely strong clips alone.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

export interface CoachComment {
  issue: string; // a specific weakness
  fix: string; // exactly how to fix it
}

export interface CoachReport {
  viralReady: boolean; // true = strong enough to post as-is
  score: number; // 0-100 viral readiness
  verdict: string; // one-line summary
  comments: CoachComment[]; // issue/fix pairs — empty when viralReady
}

export async function evaluateClip(input: {
  title: string;
  transcript: string;
  durationSec: number;
}): Promise<CoachReport> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a viral short-form video coach. You judge whether a clip is ready to go viral on TikTok / Reels / Shorts and give specific, actionable feedback. Be balanced: flag clips with real weaknesses (slow hook, no payoff, rambling, unclear stakes, wrong length, weak ending) but do not nitpick genuinely strong clips. Respond only in JSON.",
      },
      {
        role: "user",
        content: `Evaluate this clip for viral readiness.
Title: ${input.title}
Length: ${Math.round(input.durationSec)}s
Transcript: ${input.transcript.slice(0, 2500) || "(no speech)"}

Return JSON:
{
  "score": <integer 0-100, viral readiness>,
  "viralReady": <true if the clip is strong enough to post as-is, false if it needs work>,
  "verdict": "one short sentence summarising the clip's viral readiness",
  "comments": [ { "issue": "a specific weakness", "fix": "exactly how to fix it" } ]
}
If viralReady is true, return an empty comments array. If false, give 2-4 issue/fix comments, most important first.`,
      },
    ],
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");
  const score = Math.max(0, Math.min(100, Math.round(Number(json.score) || 0)));
  const viralReady = json.viralReady === true;

  const comments: CoachComment[] = viralReady
    ? []
    : (Array.isArray(json.comments) ? json.comments : [])
        .map((c: Record<string, unknown>) => ({
          issue: String(c.issue || "").trim(),
          fix: String(c.fix || "").trim(),
        }))
        .filter((c: CoachComment) => c.issue)
        .slice(0, 4);

  return { viralReady, score, verdict: String(json.verdict || ""), comments };
}
