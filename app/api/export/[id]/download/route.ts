import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAttachmentDownloadUrl } from "@/lib/r2";

// Redirects to a short-lived presigned R2 URL that carries
// Content-Disposition: attachment, so the browser saves the file to disk
// instead of streaming it inline. Cross-origin <a download> is ignored by
// browsers; this response header is not.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip || !clip.exportKey) {
    return NextResponse.json(
      { error: "Export not found — render the clip first." },
      { status: 404 }
    );
  }

  const safeName = clip.title.replace(/[^a-zA-Z0-9 _.-]/g, "").trim().slice(0, 80) || "clip";
  const filename = `${safeName}.mp4`;

  const url = await getAttachmentDownloadUrl(clip.exportKey, filename);
  return NextResponse.redirect(url, 302);
}
