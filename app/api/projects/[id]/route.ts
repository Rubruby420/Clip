import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteProjectFolder } from "@/lib/storage";

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
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Wipe every artifact (source, proxy, waveform, all clip exports/thumbs/voice)
  // before the DB row goes, so a failure leaves the DB pointing at a real
  // folder we can retry rather than at nothing.
  await deleteProjectFolder(id).catch((err) => {
    console.warn(`Failed to delete storage folder for ${id}:`, err);
  });

  await db.project.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
