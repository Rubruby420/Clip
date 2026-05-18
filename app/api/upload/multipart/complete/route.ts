import { NextRequest, NextResponse } from "next/server";
import { completeMultipartUpload, abortMultipartUpload, getPublicUrl } from "@/lib/r2";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const { projectId, key, uploadId, parts } = await req.json();

    if (!projectId || !key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
      return NextResponse.json({ error: "Missing upload parameters" }, { status: 400 });
    }

    await completeMultipartUpload(key, uploadId, parts);

    const project = await db.project.update({
      where: { id: projectId },
      data: { originalUrl: getPublicUrl(key), status: "uploaded" },
    });

    return NextResponse.json({ project });
  } catch (err) {
    console.error("Multipart complete error:", err);
    // Best-effort cleanup of the orphaned multipart upload
    try {
      const { key, uploadId } = await req.json();
      if (key && uploadId) await abortMultipartUpload(key, uploadId);
    } catch {}
    return NextResponse.json({ error: `Failed to finalise upload: ${err}` }, { status: 500 });
  }
}
