import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatePreviewProxy, tmpPath } from "@/lib/ffmpeg";
import {
  resolveStorage,
  ensureDirFor,
  projectProxyPath,
} from "@/lib/storage";
import fs from "fs";
import fsp from "fs/promises";

// Project IDs whose proxy is currently being generated in this server process.
// Prevents a second click (or the page's poll) from kicking off a duplicate
// encode. Solo-use app, single process — an in-memory Set is enough.
const inFlight = new Set<string>();

// Kicks off the 720p preview proxy for a project. The editor calls this from
// the "Smoother preview" button when project.proxyUrl is null.
//
// NON-BLOCKING: a big 4K/60fps source can take a long time to transcode even
// with GPU-assisted decode, so we DON'T await it — we start the encode in the
// background and return immediately. The source editor keeps playing the
// original and polls GET /api/projects/[id] until proxyUrl lands, then swaps.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Already done — let the caller adopt it immediately.
  if (project.proxyUrl) {
    return NextResponse.json({ status: "ready", project });
  }
  // Already running — don't start a second encode.
  if (inFlight.has(id)) {
    return NextResponse.json({ status: "running" });
  }

  inFlight.add(id);
  const videoPath = resolveStorage(project.originalUrl);
  const proxyTmp = tmpPath(`${id}_proxy.mp4`);

  // Fire-and-forget. Writes proxyUrl to the DB on success; the editor's poll
  // notices it. 90-min cap so a hopeless encode still cleans up eventually.
  (async () => {
    try {
      await generatePreviewProxy(videoPath, proxyTmp, 90 * 60 * 1000);
      if (fs.existsSync(proxyTmp)) {
        const proxyRel = projectProxyPath(id);
        const proxyAbs = resolveStorage(proxyRel);
        await ensureDirFor(proxyAbs);
        await fsp.copyFile(proxyTmp, proxyAbs);
        await db.project.update({
          where: { id },
          data: { proxyUrl: proxyRel, proxyKey: proxyRel },
        });
      }
    } catch (err) {
      console.error("Background proxy generation failed:", err);
    } finally {
      try { fs.unlinkSync(proxyTmp); } catch {}
      inFlight.delete(id);
    }
  })();

  return NextResponse.json({ status: "started" });
}
