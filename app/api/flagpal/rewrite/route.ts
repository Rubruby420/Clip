import { NextRequest, NextResponse } from "next/server";
import { rewriteViolation, type FlagPlatform } from "@/lib/flagpal";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const quote = String(body.quote || "").trim();
  const context = String(body.context || "").trim();
  const category = String(body.category || "Other").trim();
  const platform: FlagPlatform = (["youtube", "tiktok", "instagram"].includes(String(body.platform))
    ? body.platform : "youtube") as FlagPlatform;

  if (!quote) return NextResponse.json({ rewrites: [] });

  try {
    const rewrites = await rewriteViolation({ quote, context, category, platform });
    return NextResponse.json({ rewrites });
  } catch (err) {
    console.error("FlagPal rewrite error:", err);
    return NextResponse.json({ error: "Rewrite failed" }, { status: 500 });
  }
}
