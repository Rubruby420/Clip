import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs/promises";
import { generateThumbnail } from "@/lib/thumbnail";
import {
  resolveStorage,
  ensureDirFor,
  clipThumbnailGenPath,
  clipThumbnailDataPath,
} from "@/lib/storage";
import { fileUrl } from "@/lib/file-urls";
import { tmpPath } from "@/lib/ffmpeg";

// GET — return the cached thumbnail recipe (if any).
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  // Read per-clip thumbnail.json cache
  let thumbnail = null;
  try {
    const dataAbs = resolveStorage(clipThumbnailDataPath(clip.projectId, id));
    const raw = await fs.readFile(dataAbs, "utf-8");
    thumbnail = JSON.parse(raw);
  } catch {}

  const url = clip.thumbnailUrl ? fileUrl(clip.thumbnailUrl) : null;
  return NextResponse.json({ thumbnail, url });
}

// POST — full generation pipeline.
// Body: { mode?: "frame" | "ai" }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({
    where: { id },
    include: { project: true },
  });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const mode: "frame" | "ai" = body.mode === "ai" ? "ai" : "frame";

  // Resolve source video path
  const sourceRel = clip.project.originalKey;
  if (!sourceRel) {
    return NextResponse.json({ error: "No source video found for this project." }, { status: 400 });
  }
  const videoPath = resolveStorage(sourceRel);

  interface ClipWord { word: string; start: number; end: number }
  let words: ClipWord[] = [];
  try { words = JSON.parse(clip.words || "[]"); } catch {}
  const transcript = words.map((w) => w.word).join(" ").trim();

  // Temp dir for candidate frames — cleaned in finally
  const tmpFrameDir = tmpPath(`thumb-frames-${id}-${Date.now()}`);

  try {
    const { generatedPath, recipe } = await generateThumbnail({
      videoPath,
      startTime: clip.startTime,
      endTime: clip.endTime,
      title: clip.title,
      transcript,
      mode,
      tmpFrameDir,
    });

    // Persist the generated image to D:\clip\<projectId>\clips\<clipId>\thumb-gen.jpg
    const genRel = clipThumbnailGenPath(clip.projectId, id);
    const genAbs = resolveStorage(genRel);
    await ensureDirFor(genAbs);
    await fs.copyFile(generatedPath, genAbs);

    // Update clip.thumbnailUrl so it shows on the project page card
    await db.clip.update({ where: { id }, data: { thumbnailUrl: genRel } });

    // Cache the recipe + metadata to thumbnail.json
    const dataRel = clipThumbnailDataPath(clip.projectId, id);
    const dataAbs = resolveStorage(dataRel);
    await ensureDirFor(dataAbs);
    const cacheData = { recipe, mode, generatedAt: new Date().toISOString(), feedback: [] };
    await fs.writeFile(dataAbs, JSON.stringify(cacheData, null, 2), "utf-8");

    return NextResponse.json({
      thumbnail: cacheData,
      url: fileUrl(genRel),
    });
  } catch (err) {
    console.error("[thumbnail] Generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Thumbnail generation failed" },
      { status: 500 }
    );
  } finally {
    // Clean up temp frame directory
    try {
      await fs.rm(tmpFrameDir, { recursive: true, force: true });
    } catch {}
  }
}
