import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { db } from "@/lib/db";
import { resolveStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function currentSize(abs: string): Promise<number> {
  try {
    return (await fs.stat(abs)).size;
  } catch {
    return 0;
  }
}

// Finalize a chunked upload. Verifies the assembled file is exactly the size
// the client promised at init — a truncated upload is rejected with the real
// numbers instead of silently producing a broken source. Only on a verified
// match do we publish originalUrl + flip status to "processing".
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || !project.originalKey) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }

  const abs = resolveStorage(project.originalKey);
  const size = await currentSize(abs);
  const expected = Number((await req.json().catch(() => ({}))).size);

  if (Number.isFinite(expected) && expected > 0 && size !== expected) {
    return NextResponse.json(
      {
        error: `Upload incomplete: ${size} of ${expected} bytes on disk. Retry to finish the rest.`,
        received: size,
      },
      { status: 400 },
    );
  }

  await db.project.update({
    where: { id },
    data: { originalUrl: project.originalKey, status: "processing" },
  });

  return NextResponse.json({ projectId: id, path: project.originalKey });
}
