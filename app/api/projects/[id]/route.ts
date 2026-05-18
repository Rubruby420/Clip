import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteObject } from "@/lib/r2";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({
    where: { id },
    include: { clips: { orderBy: { score: "desc" } } },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const project = await db.project.update({ where: { id }, data: body });
  return NextResponse.json({ project });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({
    where: { id },
    include: { clips: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete R2 objects
  if (project.originalKey) await deleteObject(project.originalKey).catch(() => null);
  for (const clip of project.clips) {
    if (clip.exportKey) await deleteObject(clip.exportKey).catch(() => null);
  }

  await db.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
