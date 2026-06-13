import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs/promises";
import { distillFeedback, generateThumbnail } from "@/lib/thumbnail";
import { appendExample, appendLessons } from "@/lib/thumbnail-memory";
import {
  resolveStorage,
  ensureDirFor,
  clipThumbnailDataPath,
  clipThumbnailExamplePath,
  clipThumbnailGenPath,
} from "@/lib/storage";
import { fileUrl } from "@/lib/file-urls";
import { tmpPath } from "@/lib/ffmpeg";

// POST — record thumbs up/down feedback, optionally learn from it, optionally regenerate.
// Multipart form fields:
//   verdict: "up" | "down"
//   note: string (optional — user's "how can I do better?" text)
//   example: File (optional — reference image to learn from)
//   regenerate: "true" | "false"
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({
    where: { id },
    include: { project: true },
  });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not parse form data" }, { status: 400 });
  }

  const verdict = String(formData.get("verdict") || "").trim() as "up" | "down";
  const note = String(formData.get("note") || "").trim();
  const regenerate = formData.get("regenerate") === "true";
  const exampleFile = formData.get("example") as File | null;

  if (!["up", "down"].includes(verdict)) {
    return NextResponse.json({ error: "verdict must be 'up' or 'down'" }, { status: 400 });
  }

  // Load current thumbnail.json cache
  let cache: { recipe: object; mode: string; generatedAt: string; feedback: object[] } | null = null;
  try {
    const dataAbs = resolveStorage(clipThumbnailDataPath(clip.projectId, id));
    cache = JSON.parse(await fs.readFile(dataAbs, "utf-8"));
  } catch {
    return NextResponse.json({ error: "No thumbnail to give feedback on. Generate one first." }, { status: 400 });
  }

  // Persist the example image if provided
  let exampleRelPath: string | undefined;
  let exampleAbsPath: string | undefined;
  if (exampleFile) {
    const existingExamples = (cache!.feedback as Array<{ examplePath?: string }>)
      .filter((f) => (f as { examplePath?: string }).examplePath).length;
    exampleRelPath = clipThumbnailExamplePath(clip.projectId, id, existingExamples);
    exampleAbsPath = resolveStorage(exampleRelPath);
    await ensureDirFor(exampleAbsPath);
    const buffer = Buffer.from(await exampleFile.arrayBuffer());
    await fs.writeFile(exampleAbsPath, buffer);
    appendExample(exampleRelPath, note);
  }

  // Learn from the feedback
  const recipe = cache!.recipe as Parameters<typeof distillFeedback>[0]["rejectedRecipe"];

  if (verdict === "down" && (note || exampleAbsPath)) {
    try {
      const lessons = await distillFeedback({
        rejectedRecipe: recipe,
        note,
        exampleImageAbs: exampleAbsPath,
      });
      if (lessons.length > 0) {
        appendLessons(lessons.map((text) => ({ text, source: "feedback" as const, weight: 2 })));
      }
    } catch (err) {
      console.error("[thumbnail/feedback] distillFeedback failed:", err);
      // Non-fatal — still record the feedback event
    }
  } else if (verdict === "up") {
    // Positive signal — append a lightweight lesson reinforcing the winning traits
    const r = recipe as { headline?: string; textColor?: string; position?: { v: string; h: string }; fontSizePct?: number };
    const posLesson = [
      r.headline ? `Good: punchy headline like "${r.headline}"` : null,
      r.textColor ? `Good: text color ${r.textColor} works well` : null,
      r.position ? `Good: ${r.position.v}-${r.position.h} text position` : null,
    ].filter(Boolean) as string[];
    if (posLesson.length > 0) {
      appendLessons(posLesson.map((text) => ({ text, source: "feedback" as const, weight: 1 })));
    }
  }

  // Append feedback entry to the cache
  const feedbackEntry = {
    verdict,
    note: note || null,
    examplePath: exampleRelPath || null,
    at: new Date().toISOString(),
  };
  cache!.feedback.push(feedbackEntry);

  try {
    const dataAbs = resolveStorage(clipThumbnailDataPath(clip.projectId, id));
    await fs.writeFile(dataAbs, JSON.stringify(cache, null, 2), "utf-8");
  } catch {}

  // Optionally regenerate with the updated memory
  if (regenerate && verdict === "down") {
    const sourceRel = clip.project.originalKey;
    if (!sourceRel) {
      return NextResponse.json({ error: "No source video." }, { status: 400 });
    }
    const videoPath = resolveStorage(sourceRel);
    const mode = (cache!.mode as "frame" | "ai") || "frame";

    interface ClipWord { word: string; start: number; end: number }
    let words: ClipWord[] = [];
    try { words = JSON.parse(clip.words || "[]"); } catch {}
    const transcript = words.map((w) => w.word).join(" ").trim();
    const tmpFrameDir = tmpPath(`thumb-frames-${id}-${Date.now()}`);

    try {
      const { generatedPath, recipe: newRecipe } = await generateThumbnail({
        videoPath,
        startTime: clip.startTime,
        endTime: clip.endTime,
        title: clip.title,
        transcript,
        mode,
        tmpFrameDir,
      });

      const genRel = clipThumbnailGenPath(clip.projectId, id);
      const genAbs = resolveStorage(genRel);
      await ensureDirFor(genAbs);
      await fs.copyFile(generatedPath, genAbs);
      await db.clip.update({ where: { id }, data: { thumbnailUrl: genRel } });

      // Update cache with new recipe
      cache!.recipe = newRecipe;
      cache!.generatedAt = new Date().toISOString();
      const dataAbs = resolveStorage(clipThumbnailDataPath(clip.projectId, id));
      await fs.writeFile(dataAbs, JSON.stringify(cache, null, 2), "utf-8");

      return NextResponse.json({ ok: true, regenerated: true, url: fileUrl(genRel), thumbnail: cache });
    } catch (err) {
      console.error("[thumbnail/feedback] Regeneration failed:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Regeneration failed" },
        { status: 500 }
      );
    } finally {
      try { await fs.rm(tmpFrameDir, { recursive: true, force: true }); } catch {}
    }
  }

  return NextResponse.json({ ok: true, regenerated: false });
}
