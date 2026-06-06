// FlagPal — scan a transcript for YouTube policy violations, copyright risk,
// and demonetization triggers. Mirrors the lib/coach.ts pattern exactly.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

export type FlagSeverity = "high" | "medium" | "low";

export interface FlagViolation {
  category: string;    // "Profanity" | "Hate/Harassment" | "Violence/Graphic" |
                       // "Sexual" | "Dangerous Acts" | "Copyright" | "Misinformation" | "Other"
  severity: FlagSeverity;
  quote: string;       // verbatim short excerpt from the transcript
  explanation: string; // why it risks a flag/strike/demonetization
  policy: string;      // which YouTube policy it touches
  time?: number;       // approximate source time in seconds (clips only, best-effort)
}

export interface FlagReport {
  status: "clean" | "flagged";
  riskScore: number;      // 0-100
  summary: string;        // one line
  violations: FlagViolation[];
}

// Look up the approximate start time (seconds) of a quote in the words array.
// Uses a sliding-window substring match over joined words. Returns undefined
// if no words or the quote can't be found.
export function findQuoteTime(
  words: { word: string; start: number; end: number }[],
  quote: string,
): number | undefined {
  if (!words.length || !quote.trim()) return undefined;
  const q = quote.trim().toLowerCase();
  // Try every window size from 1…words.length
  for (let len = 1; len <= words.length; len++) {
    for (let i = 0; i <= words.length - len; i++) {
      const window = words
        .slice(i, i + len)
        .map((w) => w.word)
        .join(" ")
        .toLowerCase();
      if (window.includes(q) || q.includes(window)) {
        return words[i].start;
      }
    }
  }
  return undefined;
}

export async function scanForViolations(input: {
  title: string;
  transcript: string;
  durationSec?: number;
  words?: { word: string; start: number; end: number }[];
}): Promise<FlagReport> {
  // Nothing to scan
  if (!input.transcript.trim()) {
    return { status: "clean", riskScore: 0, summary: "No speech to scan.", violations: [] };
  }

  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a YouTube Trust & Safety and monetization reviewer. Given a video transcript, identify anything that could trigger a Community-Guidelines strike, a copyright claim (e.g. singing copyrighted song lyrics, reading copyrighted scripts, verbatim quoting of others' lyrics), or demonetization (advertiser-unfriendly content: profanity, hate speech, harassment, graphic violence, sexual content, dangerous acts, health misinformation). Be precise: quote the exact offending text from the transcript. If the content is clean, say so. Respond only in JSON.",
      },
      {
        role: "user",
        content: `Review this video transcript for YouTube policy violations and demonetization risks.
Title: ${input.title}
${input.durationSec != null ? `Length: ${Math.round(input.durationSec)}s` : ""}
Transcript: ${input.transcript.slice(0, 4000)}

Return JSON:
{
  "riskScore": <integer 0-100, overall risk level>,
  "status": <"clean" if no significant issues, "flagged" if any violations found>,
  "summary": "one short sentence summarising the overall risk",
  "violations": [
    {
      "category": <"Profanity"|"Hate/Harassment"|"Violence/Graphic"|"Sexual"|"Dangerous Acts"|"Copyright"|"Misinformation"|"Other">,
      "severity": <"high"|"medium"|"low">,
      "quote": "verbatim excerpt from the transcript (keep it short, ≤20 words)",
      "explanation": "why this risks a strike, claim, or demonetization",
      "policy": "the specific YouTube policy or guideline it could violate"
    }
  ]
}
If no violations, return an empty violations array and status "clean". List up to 8 violations, most severe first.`,
      },
    ],
  });

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.choices[0]?.message?.content || "{}");
  } catch {
    return { status: "clean", riskScore: 0, summary: "Could not parse scan result.", violations: [] };
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(Number(json.riskScore) || 0)));
  const status: "clean" | "flagged" = json.status === "flagged" ? "flagged" : "clean";
  const summary = String(json.summary || "").trim() || (status === "clean" ? "No issues found." : "Violations detected.");

  const rawViolations = Array.isArray(json.violations) ? json.violations : [];
  const violations: FlagViolation[] = rawViolations
    .slice(0, 8)
    .map((v: Record<string, unknown>) => {
      const quote = String(v.quote || "").trim();
      const violation: FlagViolation = {
        category: String(v.category || "Other").trim(),
        severity: (["high", "medium", "low"].includes(String(v.severity)) ? v.severity : "medium") as FlagSeverity,
        quote,
        explanation: String(v.explanation || "").trim(),
        policy: String(v.policy || "").trim(),
      };
      // Attach timestamp if words are available
      if (input.words?.length && quote) {
        const t = findQuoteTime(input.words, quote);
        if (t != null) violation.time = t;
      }
      return violation;
    })
    .filter((v) => v.quote || v.explanation);

  return { status, riskScore, summary, violations };
}
