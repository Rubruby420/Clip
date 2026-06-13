import { NextRequest, NextResponse } from "next/server";
import { isValidPlatform } from "@/lib/social/index";
import { loadToken, deleteToken } from "@/lib/social/tokens";

/** GET — return connection status { connected, handle } */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isValidPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  const token = loadToken(platform);
  if (!token) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, handle: token.handle ?? "" });
}

/** DELETE — disconnect (clear stored token) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isValidPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }
  deleteToken(platform);
  return NextResponse.json({ ok: true });
}
