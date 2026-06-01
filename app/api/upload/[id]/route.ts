import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { db } from "@/lib/db";
import { resolveStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A single chunk is small (~50MB) and writes in seconds, so we never need the
// hour-long window the old single-shot PUT did. Keep a generous ceiling anyway.
export const maxDuration = 600;

async function currentSize(abs: string): Promise<number> {
  try {
    return (await fs.stat(abs)).size;
  } catch {
    return 0;
  }
}

// Status / resume probe. Reports how many bytes are already on disk so the
// client can resume from the exact byte after any interruption.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || !project.originalKey) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }
  const abs = resolveStorage(project.originalKey);
  return NextResponse.json({ received: await currentSize(abs) });
}

// Append one chunk. The chunk MUST start exactly where the file currently ends
// (?offset=N must equal the on-disk size); otherwise we return 409 with the
// true byte count so the client can resync and retry. Because we only ever
// append, a chunk that dies mid-write still leaves valid bytes — the next
// attempt simply continues from the new end. Byte-exact, corruption-safe.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!req.body) return NextResponse.json({ error: "Empty chunk body" }, { status: 400 });

  const project = await db.project.findUnique({ where: { id } });
  if (!project || !project.originalKey) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }

  const abs = resolveStorage(project.originalKey);
  const offset = Number(req.nextUrl.searchParams.get("offset"));
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }

  const size = await currentSize(abs);
  if (offset !== size) {
    return NextResponse.json(
      { error: "Offset mismatch — resync required", received: size },
      { status: 409 },
    );
  }

  try {
    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    const ws = createWriteStream(abs, { flags: "a" });
    await pipeline(nodeStream, ws);
  } catch (err) {
    // A partial append is fine — bytes that landed are kept; the client resumes
    // from the new size. Report the truth so it can.
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Chunk write failed",
        received: await currentSize(abs),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: await currentSize(abs) });
}
