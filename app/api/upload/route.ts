import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { db } from "@/lib/db";
import { ensureDirFor, projectSourcePath, resolveStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

function sanitiseExt(raw: string | null): string {
  const e = (raw ?? "mp4").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return e || "mp4";
}

export async function PUT(req: NextRequest) {
  if (!req.body) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const ext = sanitiseExt(req.nextUrl.searchParams.get("ext"));
  const title = req.nextUrl.searchParams.get("title") || "Untitled";

  const project = await db.project.create({
    data: {
      title,
      originalUrl: "",
      originalKey: "",
      status: "uploading",
    },
  });

  const rel = projectSourcePath(project.id, ext);
  const abs = resolveStorage(rel);
  await ensureDirFor(abs);

  try {
    // Web ReadableStream -> Node Readable -> write stream. Never buffers.
    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    const ws = createWriteStream(abs);
    await pipeline(nodeStream, ws);
  } catch (err) {
    await fs.rm(abs, { force: true }).catch(() => {});
    await db.project.delete({ where: { id: project.id } }).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }

  await db.project.update({
    where: { id: project.id },
    data: { originalUrl: rel, originalKey: rel, status: "processing" },
  });

  return NextResponse.json({ projectId: project.id, path: rel });
}
