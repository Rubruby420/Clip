import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { clips: { select: { id: true, score: true, thumbnailUrl: true } } },
  });
  return NextResponse.json({ projects });
}
