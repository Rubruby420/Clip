import "server-only";
import OpenAI, { toFile } from "openai";
import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { generateSearchQueries } from "./remix";
import { searchViralVideos } from "./youtube";
import { loadMemory } from "./thumbnail-memory";
import { extractCandidateFrames, renderThumbnailStill, tmpPath, type ThumbnailTextRecipe } from "./ffmpeg";

const execAsync = promisify(exec);

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }
function ffmpegBin(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ffmpeg-static") as string;
  } catch { return "ffmpeg"; }
}

const MODEL_VISION = "gpt-4o";

export interface ThumbnailRecipe extends ThumbnailTextRecipe {
  bestFrameIndex: number;
  aiBackgroundPrompt: string;
  rationale: string;
  youtubePatternsApplied: string[];
  lessonsApplied: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function downloadToTmp(url: string, filename: string): Promise<string> {
  const dest = tmpPath(filename);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(dest)));
      file.on("error", reject);
    }).on("error", reject);
  });
}

function toDataUrl(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase().replace(".", "");
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const data = fs.readFileSync(absPath).toString("base64");
  return `data:${mime};base64,${data}`;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Search YouTube for viral thumbnails in the clip's niche, download them to
 * .tmp/ and return the local abs paths. Errors are swallowed — thumbnail
 * generation continues without live YouTube patterns if this fails.
 */
export async function analyzeNiche(
  title: string,
  transcript: string
): Promise<string[]> {
  try {
    const queries = await generateSearchQueries(title, transcript);
    if (!queries.length) return [];
    const videos = (await searchViralVideos(queries)).slice(0, 5);
    const paths: string[] = [];
    for (let i = 0; i < videos.length; i++) {
      const url = videos[i].thumbnailHigh || videos[i].thumbnailUrl;
      if (!url) continue;
      try {
        const p = await downloadToTmp(url, `yt-ref-${i}-${Date.now()}.jpg`);
        paths.push(p);
      } catch { /* skip this thumbnail */ }
    }
    return paths;
  } catch (err) {
    console.error("[thumbnail] YouTube niche analysis failed (continuing without):", err);
    return [];
  }
}

/**
 * Extract evenly-spaced candidate frames from a clip and return their abs paths.
 * Frames are written under `outDir`.
 */
export async function getCandidateFrames(
  videoPath: string,
  startTime: number,
  endTime: number,
  outDir: string,
  count = 7
): Promise<string[]> {
  const dur = Math.max(1, endTime - startTime);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    // Skip first and last 10% of the clip to avoid fade-in/out frames
    const pct = 0.1 + (0.8 * i) / Math.max(1, count - 1);
    times.push(startTime + dur * pct);
  }
  return extractCandidateFrames(videoPath, times, outDir);
}

/**
 * Ask GPT-4o vision to:
 * 1. Pick the best candidate frame for a thumbnail.
 * 2. Design the text overlay (headline, position, font size, color, etc.).
 * 3. Describe an AI background (for mode="ai").
 * All learned memory lessons are injected into the system prompt.
 */
export async function generateThumbnailRecipe(opts: {
  candidateFramePaths: string[];
  referenceThumbPaths: string[];
  title: string;
  transcript: string;
  mode: "frame" | "ai";
}): Promise<ThumbnailRecipe> {
  const { candidateFramePaths, referenceThumbPaths, title, transcript, mode } = opts;
  const memory = loadMemory();

  const memoryContext =
    memory.lessons.length > 0
      ? `\nLearned preferences from past feedback:\n${memory.lessons
          .map((l, i) => `${i + 1}. ${l.text}`)
          .join("\n")}`
      : "";

  // Build vision message content: candidate frames, then reference thumbnails
  const content: OpenAI.ChatCompletionContentPart[] = [];

  for (let i = 0; i < candidateFramePaths.length; i++) {
    content.push({ type: "text", text: `Candidate frame ${i}:` });
    content.push({
      type: "image_url",
      image_url: { url: toDataUrl(candidateFramePaths[i]), detail: "low" },
    });
  }

  if (referenceThumbPaths.length > 0) {
    content.push({
      type: "text",
      text: "\nTop-performing YouTube thumbnails in this niche (study their design patterns):",
    });
    for (const p of referenceThumbPaths) {
      content.push({
        type: "image_url",
        image_url: { url: toDataUrl(p), detail: "low" },
      });
    }
  }

  content.push({
    type: "text",
    text: [
      `\nClip title: "${title}"`,
      `Transcript excerpt: ${transcript.slice(0, 1000)}`,
      `Mode: ${mode}`,
      memoryContext,
      "",
      "Pick the single BEST candidate frame (most engaging — clear face/subject, peak emotion, dynamic action).",
      "Design a thumbnail text overlay that maximises click-through rate.",
      mode === "ai"
        ? "Also write a detailed prompt to generate a dramatic AI-enhanced background."
        : "",
      "",
      `Return JSON with exactly these keys:
{
  "bestFrameIndex": <integer 0-${candidateFramePaths.length - 1}>,
  "headline": "<punchy ALL-CAPS hook, max 6 words>",
  "subText": "<optional 1-line supporting text, or empty string>",
  "fontName": "Impact",
  "fontSizePct": <integer 10-18, % of image height>,
  "textColor": "<#RRGGBB hex>",
  "strokeColor": "<#RRGGBB hex>",
  "position": {"v": "top|center|bottom", "h": "left|center|right"},
  "cropFocus": null or {"x": <0-1 subject center X>, "y": <0-1 subject center Y>, "zoom": <1.0-1.5>},
  "aiBackgroundPrompt": "${mode === "ai" ? "<describe the ideal AI-generated background>" : ""}",
  "rationale": "<1-2 sentences explaining your choices>",
  "youtubePatternsApplied": ["<pattern from reference thumbnails>", ...],
  "lessonsApplied": ["<lesson from memory applied>", ...]
}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const res = await getOpenAI().chat.completions.create({
    model: MODEL_VISION,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an expert YouTube thumbnail designer. Analyse video frames and viral reference thumbnails to produce optimal thumbnail designs that maximise click-through rate. Understand thumbnail psychology: bold text, high contrast, strong emotion, clear subject. Respond only with JSON.",
      },
      { role: "user", content },
    ],
    max_tokens: 1000,
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");
  const n = candidateFramePaths.length;

  return {
    bestFrameIndex: Math.max(0, Math.min(n - 1, Math.round(Number(json.bestFrameIndex) || 0))),
    headline: String(json.headline || title.toUpperCase().slice(0, 35)),
    subText: String(json.subText || ""),
    fontName: String(json.fontName || "Impact"),
    fontSizePct: Math.max(8, Math.min(20, Number(json.fontSizePct) || 12)),
    textColor: /^#[0-9a-fA-F]{6}$/.test(String(json.textColor)) ? String(json.textColor) : "#FFFFFF",
    strokeColor: /^#[0-9a-fA-F]{6}$/.test(String(json.strokeColor)) ? String(json.strokeColor) : "#000000",
    position: {
      v: ["top", "center", "bottom"].includes(json.position?.v) ? json.position.v : "bottom",
      h: ["left", "center", "right"].includes(json.position?.h) ? json.position.h : "center",
    },
    cropFocus:
      json.cropFocus && typeof json.cropFocus.x === "number"
        ? {
            x: Math.max(0, Math.min(1, Number(json.cropFocus.x))),
            y: Math.max(0, Math.min(1, Number(json.cropFocus.y))),
            zoom: Math.max(1, Math.min(1.5, Number(json.cropFocus.zoom))),
          }
        : undefined,
    aiBackgroundPrompt: String(json.aiBackgroundPrompt || ""),
    rationale: String(json.rationale || ""),
    youtubePatternsApplied: Array.isArray(json.youtubePatternsApplied)
      ? json.youtubePatternsApplied.map(String).filter(Boolean)
      : [],
    lessonsApplied: Array.isArray(json.lessonsApplied)
      ? json.lessonsApplied.map(String).filter(Boolean)
      : [],
  };
}

/**
 * AI background mode: send the chosen frame to gpt-image-1 for a dramatic
 * stylistic enhancement, then return the abs path to the enhanced image.
 * Falls back gracefully if the API call fails.
 */
export async function enhanceBackground(
  baseFrameAbs: string,
  recipe: ThumbnailRecipe
): Promise<string> {
  // gpt-image-1 images.edit requires a PNG — convert the JPG frame first
  const pngInput = tmpPath(`thumb-ai-in-${Date.now()}.png`);
  await execAsync(`"${ffmpegBin()}" -y -i "${baseFrameAbs}" "${pngInput}"`);

  const prompt = [
    recipe.aiBackgroundPrompt || "Dramatic, cinematic YouTube thumbnail background",
    "High contrast, vibrant colours, professional quality.",
    "Keep the subject and any text readable.",
  ].join(" ");

  const imageStream = fs.createReadStream(pngInput);
  const imageFile = await toFile(imageStream, "frame.png", { type: "image/png" });

  const response = await getOpenAI().images.edit({
    model: "gpt-image-1",
    image: imageFile,
    prompt,
    n: 1,
  });

  const imgData = response.data?.[0];
  let buffer: Buffer | null = null;

  if (imgData?.b64_json) {
    buffer = Buffer.from(imgData.b64_json, "base64");
  } else if (imgData?.url) {
    const dest = tmpPath(`thumb-ai-dl-${Date.now()}.png`);
    await downloadToTmp(imgData.url, path.basename(dest));
    buffer = fs.readFileSync(dest);
  }

  if (!buffer) throw new Error("No image data returned from AI background generation");

  const outPath = tmpPath(`thumb-enhanced-${Date.now()}.png`);
  fs.writeFileSync(outPath, buffer);
  return outPath; // abs path to the enhanced PNG
}

/**
 * Ask GPT-4o vision to distil the user's thumbs-down feedback (and optional
 * example image) into 2–4 concise, actionable design rules for the memory store.
 */
export async function distillFeedback(opts: {
  rejectedRecipe: ThumbnailRecipe;
  note: string;
  exampleImageAbs?: string;
}): Promise<string[]> {
  const { rejectedRecipe, note, exampleImageAbs } = opts;

  const content: OpenAI.ChatCompletionContentPart[] = [];

  if (exampleImageAbs && fs.existsSync(exampleImageAbs)) {
    content.push({ type: "text", text: "Example thumbnail the user wants to emulate:" });
    content.push({
      type: "image_url",
      image_url: { url: toDataUrl(exampleImageAbs), detail: "low" },
    });
  }

  content.push({
    type: "text",
    text: [
      "The user rejected a thumbnail with these design choices:",
      `- Headline: "${rejectedRecipe.headline}"`,
      `- Position: ${rejectedRecipe.position.v}-${rejectedRecipe.position.h}`,
      `- Font size: ${rejectedRecipe.fontSizePct}% of height`,
      `- Text color: ${rejectedRecipe.textColor}`,
      rejectedRecipe.subText ? `- Sub-text: "${rejectedRecipe.subText}"` : "",
      `\nUser feedback: "${note}"`,
      "",
      `Extract 2–4 specific, actionable design rules from this feedback${exampleImageAbs ? " and the example thumbnail" : ""}.`,
      "These rules will be saved to memory and applied to ALL future thumbnails.",
      'Rules should be specific, e.g. "Use yellow text, never white" or "Position text at the top third".',
      "",
      'Return JSON: {"lessons": ["<concise rule>", ...]}',
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const res = await getOpenAI().chat.completions.create({
    model: MODEL_VISION,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You extract concise, actionable design rules from thumbnail feedback to build a persistent style memory. Respond only with JSON.",
      },
      { role: "user", content },
    ],
    max_tokens: 400,
  });

  const json = JSON.parse(res.choices[0]?.message?.content || "{}");
  return Array.isArray(json.lessons)
    ? json.lessons.map(String).filter(Boolean).slice(0, 4)
    : [];
}

/**
 * Full thumbnail generation pipeline.
 * Returns { generatedPath: abs path, recipe }.
 */
export async function generateThumbnail(opts: {
  videoPath: string;
  startTime: number;
  endTime: number;
  title: string;
  transcript: string;
  mode: "frame" | "ai";
  tmpFrameDir: string;
}): Promise<{ generatedPath: string; recipe: ThumbnailRecipe }> {
  const { videoPath, startTime, endTime, title, transcript, mode, tmpFrameDir } = opts;

  // Step 1: Extract candidate frames
  const candidateFramePaths = await getCandidateFrames(videoPath, startTime, endTime, tmpFrameDir);

  // Step 2: Live YouTube niche analysis (swallowed on error)
  const referenceThumbPaths = await analyzeNiche(title, transcript);

  // Step 3: GPT-4o vision picks the best frame + designs text overlay
  const recipe = await generateThumbnailRecipe({
    candidateFramePaths,
    referenceThumbPaths,
    title,
    transcript,
    mode,
  });

  // Step 4: Select the best frame
  let baseFrameAbs = candidateFramePaths[recipe.bestFrameIndex] ?? candidateFramePaths[0];

  // Step 5: AI background enhancement (mode="ai" only)
  if (mode === "ai") {
    try {
      baseFrameAbs = await enhanceBackground(baseFrameAbs, recipe);
    } catch (err) {
      console.error("[thumbnail] AI background enhancement failed, using original frame:", err);
      // Fall through — text overlay still applied to the original frame
    }
  }

  // Step 6: Burn text overlay onto the chosen frame
  const outPath = tmpPath(`thumb-out-${Date.now()}.jpg`);
  await renderThumbnailStill(baseFrameAbs, recipe, outPath);

  return { generatedPath: outPath, recipe };
}

