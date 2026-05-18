import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPublicUrl } from "@/lib/r2";

export async function POST(req: NextRequest) {
  try {
    const { projectId, key } = await req.json();

    const project = await db.project.update({
      where: { id: projectId },
      data: {
        originalUrl: getPublicUrl(key),
        status: "uploaded",
      },
    });

    return NextResponse.json({ project });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to mark upload complete" }, { status: 500 });
  }
}
