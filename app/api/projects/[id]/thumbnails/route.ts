import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractThumbnail } from "@/lib/ffmpeg";
import { resolveStorage, ensureDirFor, clipThumbPath } from "@/lib/storage";
import fs from "fs";

// Backfill thumbnails for any clip in the project that doesn't have one yet.
// Manual cuts (Save-as-clip, auto-cut, split, splice) are created without a
// thumbnail — only the AI pipeline and the optional finalize/Coach pass made
// them before. This generates them directly from the source so manual cuts
// always show a frame on the project page, regardless of finalize.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const clips = await db.clip.findMany({ where: { projectId: id } });
  const missing = clips.filter((c) => !c.thumbnailUrl);
  if (missing.length === 0) return NextResponse.json({ generated: 0 });

  const videoPath = resolveStorage(project.originalUrl);
  let generated = 0;

  for (const clip of missing) {
    // Pick a representative frame INSIDE the clip's first real piece. For a
    // spliced clip the envelope [startTime,endTime] spans deleted regions, so
    // use the first kept segment; offset a little in but never past its end.
    let base = clip.startTime;
    let pieceDur = clip.endTime - clip.startTime;
    if (clip.segments) {
      try {
        const segs = JSON.parse(clip.segments) as Array<{ start: number; end: number }>;
        if (Array.isArray(segs) && segs.length > 0) {
          base = segs[0].start;
          pieceDur = segs[0].end - segs[0].start;
        }
      } catch {}
    }
    const at = base + Math.min(1, Math.max(0, pieceDur * 0.5));

    const thumbRel = clipThumbPath(id, clip.id);
    const thumbAbs = resolveStorage(thumbRel);
    await ensureDirFor(thumbAbs);
    await extractThumbnail(videoPath, thumbAbs, at).catch(() => null);
    if (fs.existsSync(thumbAbs)) {
      await db.clip.update({ where: { id: clip.id }, data: { thumbnailUrl: thumbRel } });
      generated++;
    }
  }

  return NextResponse.json({ generated });
}
