// AI viral-remix strategist. Studies a handful of proven viral videos that
// the user has picked, then produces a concrete clone recipe — a beat-by-beat
// plan to re-edit the user's own clip in those references' exact style
// (hook, pacing, captions, on-screen text, sound vibe, title, hashtags).

import OpenAI from "openai";
import type { CaptionStyle } from "./captions";
import type { ViralVideo } from "./youtube";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-4o-mini";
const CAPTION_STYLES: CaptionStyle[] = ["karaoke", "bold-pop", "minimal", "emoji-auto"];

export interface EditBeat {
  timeRange: string;   // e.g. "0-2s", "2-5s"
  cut: string;         // visual / cut instruction
  overlay: string;     // on-screen text at this beat (short, punchy)
  emoji: string;       // single emoji to "stamp" at this beat (e.g. "💀", "🔥", "😭")
  sound: string;       // sound / music cue at this beat
}

export interface CloneRecipe {
  styleSummary: string;        // 1-2 sentences describing the references' shared style
  hook: string;                // spoken/written hook for the first 3 seconds
  hookText: string;            // short on-screen text overlay for the opening
  suggestedTitle: string;      // scroll-stopping title in the references' voice
  captionStyle: CaptionStyle;  // one of the 4 supported styles
  hashtags: string[];
  musicVibe: string;           // describe the music/sound the user should layer in
  editBeats: EditBeat[];       // beat-by-beat plan to re-cut the user's clip
  predictedScore: number;      // 0-100 predicted virality of the cloned clip
  clonedFrom: { videoId: string; title: string }[]; // echo of the picked refs
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

/**
 * Build a clone recipe: the user has picked specific viral references; study
 * those exact picks and produce a beat-by-beat plan for re-editing the user's
 * clip in that same style. Single pick = pure clone; multiple picks = fusion.
 */
export async function generateCloneRecipe(input: {
  title: string;
  transcript: string;
  durationSec: number;
  picks: ViralVideo[];
}): Promise<CloneRecipe> {
  const refs = input.picks
    .map(
      (v, i) =>
        `${i + 1}. "${v.title}" by ${v.channelTitle}\n   ${v.viewCount.toLocaleString()} views (${v.viewsPerDay.toLocaleString()}/day), ${v.durationSec}s long\n   Description: ${v.description.slice(0, 250)}\n   Tags: ${v.tags.slice(0, 10).join(", ") || "none"}`
    )
    .join("\n\n");

  const blendNote =
    input.picks.length > 1
      ? `You have ${input.picks.length} reference videos — fuse the strongest elements of each into one cohesive style.`
      : `You have one reference video — clone its style as closely as possible.`;

  const res = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert short-form video editor and viral-content strategist. The creator has picked specific viral videos to use as their style template. Your job is to produce a beat-by-beat remix plan that reshapes the creator's own clip in the reference videos' exact style — hook structure, pacing, on-screen text, caption look, sound vibe, title voice. Be concrete and prescriptive: the creator should be able to follow the editBeats and produce something that LOOKS like the references. Respond only with JSON.",
      },
      {
        role: "user",
        content: `MY CLIP
Title: ${input.title}
Length: ${Math.round(input.durationSec)}s
Transcript: ${input.transcript.slice(0, 2500)}

REFERENCE VIDEOS (the creator picked these to clone the style of)
${refs}

${blendNote}

Return JSON with exactly these keys:
{
  "styleSummary": "1-2 sentences describing the references' shared editing/visual style",
  "hook": "what the first 3 seconds should say (spoken or text)",
  "hookText": "a punchy on-screen text overlay for the opening (max 8 words)",
  "suggestedTitle": "a new scroll-stopping title in the references' voice",
  "captionStyle": "one of: ${CAPTION_STYLES.join(", ")}",
  "hashtags": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
  "musicVibe": "describe the music/sound to layer in — genre, energy, where it drops",
  "editBeats": [
    {"timeRange":"0-2s","cut":"visual / cut instruction","overlay":"SHORT PUNCHY TEXT (3-5 words)","emoji":"single emoji like 💀 🔥 😭 🤯","sound":"music or sfx cue"},
    {"timeRange":"2-5s","cut":"...","overlay":"...","emoji":"...","sound":"..."}
    // 4-6 beats covering the full clip length. Overlay text must be short (3-5 words) and uppercase-able. Emoji must be ONE viral meme emoji.
  ],
  "predictedScore": <integer 0-100 predicting the remixed clip's virality>
}

Make editBeats specific to MY clip's actual content (use the transcript) and the references' editing style.`,
      },
    ],
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");

  const captionStyle: CaptionStyle = CAPTION_STYLES.includes(json.captionStyle)
    ? json.captionStyle
    : "bold-pop";

  const editBeats: EditBeat[] = Array.isArray(json.editBeats)
    ? json.editBeats.slice(0, 8).map((b: Record<string, unknown>) => ({
        timeRange: String(b.timeRange ?? ""),
        cut: String(b.cut ?? ""),
        overlay: String(b.overlay ?? ""),
        emoji: String(b.emoji ?? ""),
        sound: String(b.sound ?? ""),
      }))
    : [];

  return {
    styleSummary: String(json.styleSummary || ""),
    hook: String(json.hook || ""),
    hookText: String(json.hookText || ""),
    suggestedTitle: String(json.suggestedTitle || input.title),
    captionStyle,
    hashtags: Array.isArray(json.hashtags)
      ? json.hashtags.map((h: unknown) => String(h)).slice(0, 8)
      : [],
    musicVibe: String(json.musicVibe || ""),
    editBeats,
    predictedScore: Math.max(0, Math.min(100, Math.round(Number(json.predictedScore) || 0))),
    clonedFrom: input.picks.map((p) => ({ videoId: p.videoId, title: p.title })),
  };
}
