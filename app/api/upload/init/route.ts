import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDirFor, projectSourcePath, resolveStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitiseExt(raw: unknown): string {
  const e = String(raw ?? "mp4").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return e || "mp4";
}

// Start a chunked, resumable upload. Creates the project + storage dir up
// front and records the source key in originalKey so the chunk/status/complete
// routes can locate the (growing) partial file. originalUrl stays empty and
// status stays "uploading" until /complete verifies the full byte count — that
// is what marks the upload as real and lets processing begin.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const ext = sanitiseExt(body.ext);
  const title = String(body.title ?? "Untitled");

  const project = await db.project.create({
    data: { title, originalUrl: "", originalKey: "", status: "uploading" },
  });

  const rel = projectSourcePath(project.id, ext);
  const abs = resolveStorage(rel);
  await ensureDirFor(abs);

  await db.project.update({ where: { id: project.id }, data: { originalKey: rel } });

  return NextResponse.json({ projectId: project.id, ext });
}
