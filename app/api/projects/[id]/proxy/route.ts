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

// Generates the 720p preview proxy for a project on demand. Used for
// projects that don't have a proxy yet — the editor calls this from a
// "Generate preview" button when project.proxyUrl is null.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const videoPath = resolveStorage(project.originalUrl);
  const proxyTmp = tmpPath(`${id}_proxy.mp4`);
  try {
    await generatePreviewProxy(videoPath, proxyTmp);
    if (!fs.existsSync(proxyTmp)) {
      return NextResponse.json({ error: "Proxy file was not created" }, { status: 500 });
    }
    const proxyRel = projectProxyPath(id);
    const proxyAbs = resolveStorage(proxyRel);
    await ensureDirFor(proxyAbs);
    await fsp.copyFile(proxyTmp, proxyAbs);
    const updated = await db.project.update({
      where: { id },
      data: { proxyUrl: proxyRel, proxyKey: proxyRel },
    });
    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("Manual proxy generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy generation failed" },
      { status: 500 }
    );
  } finally {
    try { fs.unlinkSync(proxyTmp); } catch {}
  }
}
