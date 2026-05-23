import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDownloadPresignedUrl, uploadBuffer } from "@/lib/r2";
import { generatePreviewProxy, tmpPath } from "@/lib/ffmpeg";
import fs from "fs";
import https from "https";
import http from "http";

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith("https") ? https : http;
    client.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
      file.on("error", reject);
    }).on("error", reject);
  });
}

// Generates the 720p preview proxy for a project on demand. Used for
// projects uploaded before proxy support existed — the editor calls this
// from a "Generate preview" button when project.proxyUrl is null.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const videoPath = tmpPath(`${id}_proxy_src.mp4`);
  const proxyPath = tmpPath(`${id}_proxy.mp4`);
  try {
    const downloadUrl = await getDownloadPresignedUrl(project.originalKey);
    await downloadFile(downloadUrl, videoPath);
    await generatePreviewProxy(videoPath, proxyPath);
    if (!fs.existsSync(proxyPath)) {
      return NextResponse.json({ error: "Proxy file was not created" }, { status: 500 });
    }
    const buf = fs.readFileSync(proxyPath);
    const proxyKey = `proxies/${id}.mp4`;
    const proxyUrl = await uploadBuffer(proxyKey, buf, "video/mp4");
    const updated = await db.project.update({
      where: { id },
      data: { proxyUrl, proxyKey },
    });
    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("Manual proxy generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy generation failed" },
      { status: 500 }
    );
  } finally {
    [videoPath, proxyPath].forEach((p) => { try { fs.unlinkSync(p); } catch {} });
  }
}
