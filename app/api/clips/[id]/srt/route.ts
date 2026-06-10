import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSRT } from "@/lib/ffmpeg";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const words = JSON.parse(clip.words || "[]") as Array<{ word: string; start: number; end: number }>;
  if (words.length === 0) {
    return NextResponse.json({ error: "No transcript available for this clip" }, { status: 400 });
  }

  const srt = await generateSRT(words, clip.captionStyle);
  const filename = clip.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) + ".srt";

  return new NextResponse(srt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
