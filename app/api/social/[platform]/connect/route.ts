import { NextRequest, NextResponse } from "next/server";
import { isValidPlatform, getDriver, type SocialPlatform } from "@/lib/social/index";

/** Returns a human-readable error when required credentials are missing from env,
 *  or null when everything looks set. Called before building the auth URL so we
 *  never send an empty client_key/client_id to a platform. */
function missingCredentials(platform: SocialPlatform): string | null {
  if (platform === "tiktok") {
    if (!process.env.TIKTOK_CLIENT_KEY?.trim() || !process.env.TIKTOK_CLIENT_SECRET?.trim())
      return "TikTok Client Key and Client Secret are not set. Enter them in Settings → App credentials, save, then restart Clip before connecting.";
  }
  if (platform === "youtube") {
    if (!process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() || !process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim())
      return "YouTube OAuth Client ID and Client Secret are not set. Enter them in Settings → App credentials, save, then restart Clip before connecting.";
  }
  if (platform === "instagram") {
    if (!process.env.INSTAGRAM_APP_ID?.trim() || !process.env.INSTAGRAM_APP_SECRET?.trim())
      return "Instagram App ID and App Secret are not set. Enter them in Settings → App credentials, save, then restart Clip before connecting.";
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isValidPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  }

  const settingsUrl = new URL("/settings#connections", req.url);

  // Guard: refuse to build an auth URL with empty credentials.
  const err = missingCredentials(platform);
  if (err) {
    settingsUrl.searchParams.set("socialError", err);
    return NextResponse.redirect(settingsUrl);
  }

  const url = getDriver(platform).getAuthUrl();
  return NextResponse.redirect(url);
}
