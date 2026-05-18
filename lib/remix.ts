// AI viral-remix strategist. Studies proven viral videos and produces a recipe
// that applies their winning FORMAT (hook, pacing, captions, title, hashtags)
// to the user's own clip — never their footage.

import OpenAI from "openai";
import type { CaptionStyle } from "./captions";
import type { ViralVideo } from "./youtube";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-4o-mini";
const CAPTION_STYLES: CaptionStyle[] = ["karaoke", "bold-pop", "minimal", "emoji-auto"];

export interface RemixRecipe {
  matchedFormat: string; // name of the viral format the references share
  whyItWorks: string; // why that format goes viral
  hook: string; // spoken/written hook for the first 3 seconds
  hookText: string; // short punchy on-screen text overlay for the opening
  suggestedTitle: string; // new clickable title for the clip
  captionStyle: CaptionStyle; // one of the 4 supported styles
  hashtags: string[];
  recutNote: string; // how to trim/pace the clip to match the format
  predictedScore: number; // 0-100 predicted virality of the remixed clip
}

/** Ask the model for concise YouTube search queries that surface viral videos
 *  in the same niche as the clip. */
export async function generateSearchQueries(
  title: string,
  transcript: string
): Promise<string[]> {
  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You help creators find viral short-form videos to use as remix templates. Given a clip's topic, return concise YouTube search queries that surface currently-viral videos in the same niche and format.",
      },
      {
        role: "user",
        content: `Clip title: ${title}\nTranscript (excerpt): ${transcript.slice(0, 1500)}\n\nReturn JSON: {"queries": ["q1","q2","q3"]} — exactly 3 search queries, 2-5 words each, likely to surface viral videos in this niche.`,
      },
    ],
  });
  const json = JSON.parse(res.choices[0]?.message?.content || "{}");
  const queries: string[] = Array.isArray(json.queries) ? json.queries : [];
  return queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3);
}

/** Build a remix recipe: study the viral references, then map their format
 *  onto the user's clip. */
export async function generateRemixRecipe(input: {
  title: string;
  transcript: string;
  durationSec: number;
  videos: ViralVideo[];
}): Promise<RemixRecipe> {
  const refs = input.videos
    .slice(0, 6)
    .map(
      (v, i) =>
        `${i + 1}. "${v.title}" — ${v.viewCount.toLocaleString()} views (${v.viewsPerDay.toLocaleString()}/day), ${v.durationSec}s. Tags: ${v.tags.slice(0, 8).join(", ") || "none"}`
    )
    .join("\n");

  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a viral short-form content strategist. You analyse proven viral videos and create a remix recipe that applies their winning FORMAT to a creator's own clip. Crucial rule: never suggest reusing or copying another video's footage — only adapt the format (hook structure, pacing, on-screen text, caption style, title pattern, hashtags). Respond only with JSON.",
      },
      {
        role: "user",
        content: `MY CLIP
Title: ${input.title}
Length: ${Math.round(input.durationSec)}s
Transcript (excerpt): ${input.transcript.slice(0, 2000)}

VIRAL REFERENCE VIDEOS (ranked by views/day)
${refs}

Identify the common viral FORMAT across the references, then write a remix recipe that reshapes MY CLIP into that format.

Return JSON with exactly these keys:
{
  "matchedFormat": "short name of the shared viral format",
  "whyItWorks": "1-2 sentences on why that format goes viral",
  "hook": "the spoken/written hook for the first 3 seconds of my clip",
  "hookText": "a short, punchy on-screen text overlay for the opening (max 8 words)",
  "suggestedTitle": "a new scroll-stopping title for my clip",
  "captionStyle": "one of: ${CAPTION_STYLES.join(", ")}",
  "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
  "recutNote": "concrete advice on how to trim/pace my clip to fit the format",
  "predictedScore": <integer 0-100 predicting the remixed clip's virality>
}`,
      },
    ],
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");

  // Normalise / guard the model output.
  const captionStyle: CaptionStyle = CAPTION_STYLES.includes(json.captionStyle)
    ? json.captionStyle
    : "bold-pop";

  return {
    matchedFormat: String(json.matchedFormat || "Viral format"),
    whyItWorks: String(json.whyItWorks || ""),
    hook: String(json.hook || ""),
    hookText: String(json.hookText || ""),
    suggestedTitle: String(json.suggestedTitle || input.title),
    captionStyle,
    hashtags: Array.isArray(json.hashtags)
      ? json.hashtags.map((h: unknown) => String(h)).slice(0, 8)
      : [],
    recutNote: String(json.recutNote || ""),
    predictedScore: Math.max(
      0,
      Math.min(100, Math.round(Number(json.predictedScore) || 0))
    ),
  };
}
