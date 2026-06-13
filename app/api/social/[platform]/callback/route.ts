import { NextRequest, NextResponse } from "next/server";
import { isValidPlatform, getDriver } from "@/lib/social/index";
import { saveToken } from "@/lib/social/tokens";
import { verifyState } from "@/lib/social/oauth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isValidPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") ?? "";
  const error = searchParams.get("error");
  const settingsUrl = new URL("/settings#connections", req.url);

  // User denied access or platform returned an error
  if (error || !code) {
    settingsUrl.searchParams.set("socialError", error ?? "access_denied");
    return NextResponse.redirect(settingsUrl);
  }

  // CSRF check
  if (!verifyState(state)) {
    settingsUrl.searchParams.set("socialError", "invalid_state");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const token = await getDriver(platform).exchangeCode(code);
    saveToken(platform, token);
    settingsUrl.searchParams.set("socialConnected", platform);
    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    console.error(`[social/${platform}/callback] error:`, err);
    settingsUrl.searchParams.set("socialError", String(err));
    return NextResponse.redirect(settingsUrl);
  }
}
