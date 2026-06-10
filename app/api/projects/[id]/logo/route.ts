import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveStorage, ensureDirFor, projectLogoPath } from "@/lib/storage";
import fs from "fs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const formData = await req.formData();
  const file = formData.get("logo") as File | null;
  if (!file) return NextResponse.json({ error: "No logo file provided" }, { status: 400 });

  const rel = projectLogoPath(id);
  const abs = resolveStorage(rel);
  await ensureDirFor(abs);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(abs, buffer);

  return NextResponse.json({ logoUrl: rel });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    fs.unlinkSync(resolveStorage(projectLogoPath(id)));
  } catch {}
  return NextResponse.json({ success: true });
}
