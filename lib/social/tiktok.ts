import "server-only";
import fs from "fs";
import { createState, redirectUri, generatePKCE } from "./oauth";
import { TokenData } from "./tokens";

const CLIENT_KEY = () => process.env.TIKTOK_CLIENT_KEY ?? "";
const CLIENT_SECRET = () => process.env.TIKTOK_CLIENT_SECRET ?? "";

const AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_URL = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name";
const INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const STATUS_URL = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

export type TikTokPrivacy =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export function getAuthUrl(): string {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = createState(codeVerifier);
  const params = new URLSearchParams({
    client_key: CLIENT_KEY(),
    response_type: "code",
    scope: "user.info.basic,video.publish",
    redirect_uri: redirectUri("tiktok"),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_BASE}?${params}`;
}

export async function exchangeCode(code: string, codeVerifier?: string): Promise<TokenData> {
  const params: Record<string, string> = {
    client_key: CLIENT_KEY(),
    client_secret: CLIENT_SECRET(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri("tiktok"),
  };
  if (codeVerifier) params.code_verifier = codeVerifier;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`TikTok token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.error?.code && json.error.code !== "ok")
    throw new Error(`TikTok error: ${json.error.message}`);
  const d = json.data;
  const token: TokenData = {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + d.expires_in * 1000,
    userId: d.open_id,
    scope: d.scope,
  };
  // Fetch display name
  try {
    const u = await fetch(USER_URL, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    const ud = await u.json();
    token.handle = ud.data?.user?.display_name ?? "";
  } catch {}
  return token;
}

export async function refreshAccessToken(current: TokenData): Promise<TokenData> {
  if (!current.refreshToken) throw new Error("No refresh token stored for TikTok");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: CLIENT_KEY(),
      client_secret: CLIENT_SECRET(),
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`TikTok refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const d = json.data;
  return {
    ...current,
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + d.expires_in * 1000,
  };
}

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

/** Read a slice of a file into a Buffer. */
async function readChunk(filePath: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = fs.createReadStream(filePath, { start, end }); // end is inclusive
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export async function publishVideo(opts: {
  absPath: string;
  title: string;
  privacy: TikTokPrivacy;
  token: TokenData;
  onProgress?: (pct: number, msg?: string) => void;
}): Promise<{ publishId: string; postUrl?: string }> {
  const { absPath, title, privacy, token, onProgress } = opts;
  const emit = onProgress ?? (() => {});

  const fileSize = fs.statSync(absPath).size;
  const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

  emit(5, "Initialising TikTok upload…");

  // 1. Init
  const initRes = await fetch(INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 150),
        privacy_level: privacy,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: fileSize,
        chunk_size: CHUNK_SIZE,
        total_chunk_count: totalChunks,
      },
    }),
  });
  if (!initRes.ok) {
    const text = await initRes.text();
    throw new Error(`TikTok init failed: ${initRes.status} ${text}`);
  }
  const initJson = await initRes.json();
  if (initJson.error?.code && initJson.error.code !== "ok")
    throw new Error(`TikTok: ${initJson.error.message ?? JSON.stringify(initJson.error)}`);

  const { upload_url: uploadUrl, publish_id: publishId } = initJson.data;

  // 2. Upload chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize); // exclusive
    const chunk = await readChunk(absPath, start, end - 1); // end-1 → inclusive for createReadStream

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${fileSize}`,
      },
      body: chunk as unknown as BodyInit,
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`TikTok chunk ${i + 1} upload failed: ${putRes.status} ${t}`);
    }
    emit(5 + Math.round(((i + 1) / totalChunks) * 75), `Uploading… chunk ${i + 1}/${totalChunks}`);
  }

  // 3. Poll status
  emit(85, "Processing…");
  let attempts = 0;
  while (attempts++ < 60) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(STATUS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    if (!statusRes.ok) continue;
    const statusJson = await statusRes.json();
    const status: string = statusJson.data?.status ?? "";
    if (status === "PUBLISH_COMPLETE") {
      emit(100, "Published!");
      return { publishId };
    }
    if (status === "FAILED" || status === "CANCELLED") {
      const reason = statusJson.data?.fail_reason ?? status;
      throw new Error(`TikTok publish failed: ${reason}`);
    }
    // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD / SEND_TO_USER_INBOX — keep polling
  }
  throw new Error("TikTok publish timed out after 3 min — check your TikTok account for the draft.");
}
