import { NextRequest, NextResponse } from "next/server";
import { getUploadPresignedUrl } from "@/lib/r2";
import { db } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { filename, contentType, title } = await req.json();

    const ext = filename.split(".").pop() ?? "mp4";
    const key = `uploads/${randomUUID()}.${ext}`;

    const presignedUrl = await getUploadPresignedUrl(key, contentType);

    const project = await db.project.create({
      data: {
        title: title || filename.replace(/\.[^/.]+$/, ""),
        originalUrl: "",
        originalKey: key,
        status: "uploading",
      },
    });

    return NextResponse.json({ presignedUrl, key, projectId: project.id });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to create presigned URL" }, { status: 500 });
  }
}
