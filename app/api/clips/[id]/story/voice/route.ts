import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateVoiceover, isTtsVoice } from "@/lib/story";
import { resolveStorage, ensureDirFor, clipVoicePath } from "@/lib/storage";
import fs from "fs/promises";

// POST — generate AI voiceover audio from a (possibly edited) story script.
// Body: { script: string, voice?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clip = await db.clip.findUnique({ where: { id } });
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const script = String(body.script || "").trim();
  if (!script) {
    return NextResponse.json({ error: "No script to voice." }, { status: 400 });
  }
  const voice = isTtsVoice(body.voice) ? body.voice : "onyx";

  try {
    const audio = await generateVoiceover(script, voice);

    const voiceRel = clipVoicePath(clip.projectId, id);
    const voiceAbs = resolveStorage(voiceRel);
    await ensureDirFor(voiceAbs);
    await fs.writeFile(voiceAbs, audio);

    // Persist the relative path on the stored story plan.
    if (clip.storyData) {
      try {
        const story = JSON.parse(clip.storyData);
        story.voiceUrl = voiceRel;
        story.voice = voice;
        await db.clip.update({ where: { id }, data: { storyData: JSON.stringify(story) } });
      } catch {}
    }

    return NextResponse.json({ voiceUrl: voiceRel, voice });
  } catch (err) {
    console.error("Voiceover generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Voiceover generation failed" },
      { status: 500 }
    );
  }
}
