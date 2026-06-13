import "server-only";
import fs from "fs";
import { createState, redirectUri } from "./oauth";
import { TokenData } from "./tokens";

// Distinct from lib/youtube.ts (read-only YouTube Data API key usage for Viral Remix).
// This file handles OAuth + upload for YouTube Shorts publishing.

const CLIENT_ID = () => process.env.YOUTUBE_OAUTH_CLIENT_ID ?? "";
const CLIENT_SECRET = () => process.env.YOUTUBE_OAUTH_CLIENT_SECRET ?? "";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export function getAuthUrl(): string {
  const state = createState();
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    redirect_uri: redirectUri("youtube"),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    access_type: "offline",
    prompt: "consent", // force refresh_token every time
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string): Promise<TokenData> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      redirect_uri: redirectUri("youtube"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`YouTube error: ${json.error_description ?? json.error}`);
  const token: TokenData = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
  };
  // Fetch channel title for the "Connected as" display
  try {
    const ch = await fetch(CHANNELS_URL, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    const chJson = await ch.json();
    token.handle = chJson.items?.[0]?.snippet?.title ?? "";
  } catch {}
  return token;
}

export async function refreshAccessToken(current: TokenData): Promise<TokenData> {
  if (!current.refreshToken) throw new Error("No refresh token for YouTube");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`YouTube refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error) throw new Error(`YouTube refresh error: ${json.error_description ?? json.error}`);
  return {
    ...current,
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

export async function publishVideo(opts: {
  absPath: string;
  title: string;
  description: string;
  privacyStatus: "public" | "private" | "unlisted";
  token: TokenData;
  onProgress?: (pct: number, msg?: string) => void;
}): Promise<{ videoId: string; postUrl: string }> {
  const { absPath, title, description, privacyStatus, token, onProgress } = opts;
  const emit = onProgress ?? (() => {});
  const fileSize = fs.statSync(absPath).size;

  // A Short title must end with " #Shorts" (or contain #Shorts) for YouTube to
  // classify it automatically as a Short. We append it if not already present.
  const shortTitle = title.includes("#Shorts") ? title : `${title} #Shorts`;

  emit(5, "Initiating YouTube resumable upload…");

  // 1. Initiate resumable upload session
  const initRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(fileSize),
    },
    body: JSON.stringify({
      snippet: {
        title: shortTitle.slice(0, 100),
        description: description.slice(0, 5000),
        categoryId: "22", // People & Blogs
      },
      status: { privacyStatus },
    }),
  });
  if (!initRes.ok)
    throw new Error(`YouTube init failed: ${initRes.status} ${await initRes.text()}`);

  const sessionUri = initRes.headers.get("location");
  if (!sessionUri) throw new Error("YouTube did not return a resumable session URI");

  emit(15, "Uploading…");

  // 2. Single-shot upload (clips are typically <500 MB; a resumable PUT works fine)
  const fileBuffer = fs.readFileSync(absPath);
  const uploadRes = await fetch(sessionUri, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(fileSize),
      "Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
    },
    body: fileBuffer,
  });
  if (!uploadRes.ok && uploadRes.status !== 308)
    throw new Error(`YouTube upload failed: ${uploadRes.status} ${await uploadRes.text()}`);

  const videoJson = await uploadRes.json();
  const videoId: string = videoJson.id;
  if (!videoId) throw new Error(`YouTube upload succeeded but no video id returned: ${JSON.stringify(videoJson)}`);

  emit(100, "Published!");
  return { videoId, postUrl: `https://www.youtube.com/shorts/${videoId}` };
}
