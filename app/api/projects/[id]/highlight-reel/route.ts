import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildHighlightReel, tmpPath } from "@/lib/ffmpeg";
import { resolveStorage, ensureDirFor, projectHighlightReelPath } from "@/lib/storage";
import fs from "fs";
import { randomUUID } from "crypto";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rel = projectHighlightReelPath(id);
  try {
    const abs = resolveStorage(rel);
    if (fs.existsSync(abs)) {
      return NextResponse.json({ url: rel });
    }
  } catch {}
  return NextResponse.json({ url: null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const n = Math.max(1, Math.min(100, Number(body.n) || 5));
  const aspectRatio: "9:16" | "16:9" | "1:1" =
    ["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16";
  const blurBackground = body.blurBackground !== false;

  const project = await db.project.findUnique({
    where: { id },
    include: { clips: { orderBy: [{ score: "desc" }, { createdAt: "asc" }] } },
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      if (!project) {
        send({ type: "error", error: "Project not found" });
        controller.close();
        return;
      }

      const top = project.clips.slice(0, n);
      if (top.length === 0) {
        send({ type: "error", error: "No clips to stitch" });
        controller.close();
        return;
      }

      const reelId = randomUUID();
      const outPath = tmpPath(`reel_${reelId}.mp4`);
      // Prefer originalKey (always the local relative path); fall back to originalUrl.
      const sourcePath = resolveStorage(project.originalKey || project.originalUrl);
      const segments = top.map((c) => ({ start: c.startTime, end: c.endTime }));

      try {
        send({ type: "start", total: top.length });

        await buildHighlightReel({
          inputPath: sourcePath,
          outputPath: outPath,
          segments,
          aspectRatio,
          blurBackground,
          onProgress: (pct) => send({ type: "progress", pct }),
        });

        const reelRel = projectHighlightReelPath(id);
        const reelAbs = resolveStorage(reelRel);
        await ensureDirFor(reelAbs);
        fs.copyFileSync(outPath, reelAbs);

        send({ type: "done", url: reelRel, count: top.length });
      } catch (err) {
        console.error("[highlight-reel] Error:", err);
        send({ type: "error", error: String(err) });
      } finally {
        try { fs.unlinkSync(outPath); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
