import { NextRequest, NextResponse } from "next/server";
import { isValidPlatform, getDriver } from "@/lib/social/index";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isValidPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  const url = getDriver(platform).getAuthUrl();
  return NextResponse.redirect(url);
}
