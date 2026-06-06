// FlagPal — scan a transcript for YouTube/TikTok/Instagram policy violations,
// copyright risk, demonetization triggers, and trending topic risks.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

export type FlagSeverity = "high" | "medium" | "low";
export type FlagOutcome = "strike" | "demonetization" | "age-gate" | "limited-ads";
export type FlagPlatform = "youtube" | "tiktok" | "instagram";

export interface FlagViolation {
  category: string;         // "Profanity" | "Hate/Harassment" | "Violence/Graphic" |
                            // "Sexual" | "Dangerous Acts" | "Copyright" | "Misinformation" | "Other"
  severity: FlagSeverity;
  outcome: FlagOutcome;     // which platform consequence this risks
  quote: string;            // verbatim short excerpt from the transcript
  explanation: string;      // why it risks a flag/strike/demonetization
  policy: string;           // which platform policy it touches
  fix: string;              // specific actionable fix
  // Copyright-specific
  copyrightedWork?: string; // e.g. "Shape of You by Ed Sheeran"
  contentIdRisk?: "high" | "medium" | "low";
  time?: number;            // approximate source time in seconds (clips only)
}

export interface SensitiveTopic {
  topic: string;            // e.g. "vaccine efficacy claims"
  reason: string;           // why it's currently risky even if not a clear violation
  risk: "high" | "medium" | "low";
}

export interface FlagReport {
  status: "clean" | "flagged";
  riskScore: number;          // 0-100
  summary: string;            // one line
  violations: FlagViolation[];
  sensitiveTopics: SensitiveTopic[]; // trending/contextual risk radar
}

const PLATFORM_CONTEXT: Record<FlagPlatform, string> = {
  youtube: `Platform: YouTube. Apply YouTube's Community Guidelines and Advertiser-Friendly Content Guidelines.
Outcomes to classify each violation as:
- "strike": content removed + channel warning (hate speech, graphic violence, sexual content involving minors, dangerous challenges)
- "demonetization": video stays up but earns no ad revenue (profanity, adult themes, controversial topics, mild violence)
- "age-gate": video restricted to 18+ viewers (sexual content, graphic violence, disturbing imagery)
- "limited-ads": video monetizes at lower rate (sensitive topics, strong language, controversial but not guideline-violating content)
Copyright: YouTube uses Content-ID. Singing/quoting copyrighted lyrics = likely claim. Fair use is narrow.`,

  tiktok: `Platform: TikTok. Apply TikTok's Community Guidelines — generally stricter than YouTube on:
- Minor safety and dangerous acts (very strict — immediate removal)
- Violent extremism and hate speech (zero tolerance)
- Misinformation (especially health/medical claims)
- Music copyright is heavily enforced via its own Content-ID equivalent
TikTok is somewhat more permissive on mild profanity than YouTube but less on dangerous content.
Outcomes: "strike" (removal/ban), "demonetization" (removed from Creator Fund), "age-gate" (For You restrictions), "limited-ads" (reduced distribution).`,

  instagram: `Platform: Instagram/Meta Reels. Apply Instagram's Community Guidelines:
- Stricter on nudity and sexual content than YouTube
- Strict on graphic violence and dangerous acts
- Music copyright heavily enforced (licensed music via Meta's library; other music triggers muting or removal)
- Misinformation flagged with interstitial warnings
Outcomes: "strike" (removal/account action), "demonetization" (no Reels bonus/ads), "age-gate" (18+ restriction), "limited-ads" (reduced reach in recommendations).`,
};

// Look up the approximate start time (seconds) of a quote in the words array.
export function findQuoteTime(
  words: { word: string; start: number; end: number }[],
  quote: string,
): number | undefined {
  if (!words.length || !quote.trim()) return undefined;
  const q = quote.trim().toLowerCase();
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
  platform?: FlagPlatform;
}): Promise<FlagReport> {
  const platform = input.platform ?? "youtube";
  const empty: FlagReport = { status: "clean", riskScore: 0, summary: "No speech to scan.", violations: [], sensitiveTopics: [] };

  if (!input.transcript.trim()) return empty;

  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a platform Trust & Safety and monetization reviewer. Given a video transcript, identify:
1. Policy violations that could trigger strikes, demonetization, age-gating, or limited ads
2. Copyright issues — identify the SPECIFIC copyrighted work by name when possible (song title + artist, movie/show title)
3. Trending sensitive topics — subjects that attract mass reporting or "limited ads" even without a clear guideline violation (e.g. election claims, health misinformation, controversial figures)
Be precise: quote the exact offending text. If content is clean, say so. Respond only in JSON.

${PLATFORM_CONTEXT[platform]}`,
      },
      {
        role: "user",
        content: `Review this transcript for policy violations, copyright risks, and sensitive topics.
Title: ${input.title}
${input.durationSec != null ? `Length: ${Math.round(input.durationSec)}s` : ""}
Transcript: ${input.transcript.slice(0, 4000)}

Return JSON exactly:
{
  "riskScore": <integer 0-100>,
  "status": <"clean" or "flagged">,
  "summary": "one short sentence",
  "violations": [
    {
      "category": <"Profanity"|"Hate/Harassment"|"Violence/Graphic"|"Sexual"|"Dangerous Acts"|"Copyright"|"Misinformation"|"Other">,
      "severity": <"high"|"medium"|"low">,
      "outcome": <"strike"|"demonetization"|"age-gate"|"limited-ads">,
      "quote": "verbatim excerpt ≤20 words",
      "explanation": "why this risks the outcome",
      "policy": "specific policy violated",
      "fix": "exact fix — what to cut, mute, or rephrase",
      "copyrightedWork": "Song Title by Artist OR Movie/Show Title (only for Copyright category, omit otherwise)",
      "contentIdRisk": <"high"|"medium"|"low" — only for Copyright category, omit otherwise>
    }
  ],
  "sensitiveTopics": [
    {
      "topic": "short topic name",
      "reason": "why this attracts reporting or limited ads even without a clear violation",
      "risk": <"high"|"medium"|"low">
    }
  ]
}
List up to 8 violations (most severe first) and up to 4 sensitive topics. If none, return empty arrays.`,
      },
    ],
  });

  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.choices[0]?.message?.content || "{}");
  } catch {
    return { ...empty, summary: "Could not parse scan result." };
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
        outcome: (["strike", "demonetization", "age-gate", "limited-ads"].includes(String(v.outcome)) ? v.outcome : "demonetization") as FlagOutcome,
        quote,
        explanation: String(v.explanation || "").trim(),
        policy: String(v.policy || "").trim(),
        fix: String(v.fix || "").trim(),
      };
      if (v.copyrightedWork) violation.copyrightedWork = String(v.copyrightedWork).trim();
      if (v.contentIdRisk && ["high", "medium", "low"].includes(String(v.contentIdRisk))) {
        violation.contentIdRisk = v.contentIdRisk as "high" | "medium" | "low";
      }
      if (input.words?.length && quote) {
        const t = findQuoteTime(input.words, quote);
        if (t != null) violation.time = t;
      }
      return violation;
    })
    .filter((v) => v.quote || v.explanation);

  const rawTopics = Array.isArray(json.sensitiveTopics) ? json.sensitiveTopics : [];
  const sensitiveTopics: SensitiveTopic[] = rawTopics
    .slice(0, 4)
    .map((t: Record<string, unknown>) => ({
      topic: String(t.topic || "").trim(),
      reason: String(t.reason || "").trim(),
      risk: (["high", "medium", "low"].includes(String(t.risk)) ? t.risk : "medium") as "high" | "medium" | "low",
    }))
    .filter((t: SensitiveTopic) => t.topic);

  return { status, riskScore, summary, violations, sensitiveTopics };
}

// Generate 2-3 policy-compliant rewrites for a flagged quote.
export async function rewriteViolation(input: {
  quote: string;
  context: string;   // surrounding transcript for tone/topic
  category: string;
  platform: FlagPlatform;
}): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a video script editor helping a creator rephrase content that would get flagged on ${input.platform}. Generate compliant rewrites that preserve the speaker's meaning and tone but remove the policy risk. Return only JSON.`,
      },
      {
        role: "user",
        content: `The following quote was flagged as "${input.category}" on ${input.platform}:
"${input.quote}"

Context (surrounding transcript): ${input.context.slice(0, 500)}

Generate 2-3 alternative phrasings that:
- Convey the same idea/emotion
- Are fully compliant with ${input.platform}'s policies
- Sound natural, not sanitized or robotic

Return JSON: { "rewrites": ["rewrite 1", "rewrite 2", "rewrite 3"] }`,
      },
    ],
  });

  try {
    const json = JSON.parse(res.choices[0]?.message?.content || "{}");
    return Array.isArray(json.rewrites) ? json.rewrites.slice(0, 3).map(String) : [];
  } catch {
    return [];
  }
}
