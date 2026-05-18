import { NextRequest, NextResponse } from "next/server";
import { createMultipartUpload, signUploadPart, r2EnvMissing } from "@/lib/r2";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const missing = r2EnvMissing();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing R2 environment variables: ${missing.join(", ")}. Fill in .env.local and restart the dev server.` },
      { status: 500 }
    );
  }

  try {
    const { filename, contentType, title, partCount } = await req.json();

    if (!partCount || partCount < 1 || partCount > 10000) {
      return NextResponse.json({ error: "Invalid part count" }, { status: 400 });
    }

    const ext = (filename?.split(".").pop() ?? "mp4").toLowerCase();
    const key = `uploads/${randomUUID()}.${ext}`;

    const uploadId = await createMultipartUpload(key, contentType || "video/mp4");

    // Presign a PUT URL for every part
    const partUrls: string[] = [];
    for (let i = 1; i <= partCount; i++) {
      partUrls.push(await signUploadPart(key, uploadId, i));
    }

    const project = await db.project.create({
      data: {
        title: title || filename?.replace(/\.[^/.]+$/, "") || "Untitled",
        originalUrl: "",
        originalKey: key,
        status: "uploading",
      },
    });

    return NextResponse.json({ projectId: project.id, key, uploadId, partUrls });
  } catch (err) {
    console.error("Multipart start error:", err);
    return NextResponse.json({ error: `Failed to start upload: ${err}` }, { status: 500 });
  }
}
