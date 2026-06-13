import "server-only";
import { createState, redirectUri } from "./oauth";
import { TokenData } from "./tokens";

const APP_ID = () => process.env.INSTAGRAM_APP_ID ?? "";
const APP_SECRET = () => process.env.INSTAGRAM_APP_SECRET ?? "";
const PUBLIC_BASE_URL = () => (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const FB_AUTH = "https://www.facebook.com/v19.0/dialog/oauth";
const FB_TOKEN = "https://graph.facebook.com/v19.0/oauth/access_token";
const FB_EXCHANGE = "https://graph.facebook.com/v19.0/oauth/access_token";
const IG_GRAPH = "https://graph.instagram.com/v21.0";

export function getAuthUrl(): string {
  const state = createState();
  const params = new URLSearchParams({
    client_id: APP_ID(),
    redirect_uri: redirectUri("instagram"),
    scope: "instagram_basic,instagram_content_publish,pages_read_engagement",
    response_type: "code",
    state,
  });
  return `${FB_AUTH}?${params}`;
}

export async function exchangeCode(code: string): Promise<TokenData> {
  // 1. Short-lived token
  const res = await fetch(
    `${FB_TOKEN}?${new URLSearchParams({
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      redirect_uri: redirectUri("instagram"),
      code,
    })}`
  );
  if (!res.ok) throw new Error(`Instagram code exchange failed: ${res.status} ${await res.text()}`);
  const shortJson = await res.json();
  if (shortJson.error) throw new Error(`Instagram error: ${shortJson.error.message}`);
  const shortToken: string = shortJson.access_token;

  // 2. Long-lived token (~60 days)
  const longRes = await fetch(
    `${FB_EXCHANGE}?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      fb_exchange_token: shortToken,
    })}`
  );
  if (!longRes.ok) throw new Error(`Instagram long-token exchange failed: ${longRes.status} ${await longRes.text()}`);
  const longJson = await longRes.json();

  const token: TokenData = {
    accessToken: longJson.access_token,
    expiresAt: Date.now() + (longJson.expires_in ?? 5_184_000) * 1000,
  };

  // 3. Get IG Business account id + username
  try {
    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${token.accessToken}`
    );
    const pages = await pagesRes.json();
    const page = pages.data?.[0];
    if (page) {
      const igRes = await fetch(
        `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${token.accessToken}`
      );
      const igPage = await igRes.json();
      const igUserId: string | undefined = igPage.instagram_business_account?.id;
      if (igUserId) {
        token.userId = igUserId;
        // Get username
        const unRes = await fetch(
          `${IG_GRAPH}/${igUserId}?fields=username&access_token=${token.accessToken}`
        );
        const unJson = await unRes.json();
        token.handle = unJson.username ? `@${unJson.username}` : "";
      }
    }
  } catch {}
  return token;
}

export async function refreshAccessToken(current: TokenData): Promise<TokenData> {
  // Long-lived FB tokens are refreshed the same way as long-token exchange.
  const res = await fetch(
    `${FB_EXCHANGE}?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: APP_ID(),
      client_secret: APP_SECRET(),
      fb_exchange_token: current.accessToken,
    })}`
  );
  if (!res.ok) throw new Error(`Instagram token refresh failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return {
    ...current,
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 5_184_000) * 1000,
  };
}

export async function publishVideo(opts: {
  relPath: string; // relative path under STORAGE_DIR — used to build the public video_url
  caption: string;
  token: TokenData;
  onProgress?: (pct: number, msg?: string) => void;
}): Promise<{ publishId: string; postUrl?: string }> {
  const { relPath, caption, token, onProgress } = opts;
  const emit = onProgress ?? (() => {});

  const base = PUBLIC_BASE_URL();
  if (base.startsWith("http://localhost")) {
    throw new Error(
      "Instagram Reels requires a public HTTPS URL. " +
        "Set PUBLIC_BASE_URL to your ngrok/cloudflared tunnel (e.g. https://abc.ngrok.io) " +
        "in Settings and try again."
    );
  }

  if (!token.userId) throw new Error("Instagram account not linked — please disconnect and reconnect.");

  const videoUrl = `${base}/api/files/${relPath.replace(/\\/g, "/")}`;
  emit(10, "Creating media container…");

  // 1. Create container
  const containerRes = await fetch(`${IG_GRAPH}/${token.userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption: caption.slice(0, 2200),
      access_token: token.accessToken,
    }),
  });
  if (!containerRes.ok)
    throw new Error(`Instagram container create failed: ${containerRes.status} ${await containerRes.text()}`);
  const containerJson = await containerRes.json();
  if (containerJson.error) throw new Error(`Instagram: ${containerJson.error.message}`);
  const containerId: string = containerJson.id;
  emit(20, "Waiting for Instagram to process the video…");

  // 2. Poll container status
  let attempts = 0;
  while (attempts++ < 60) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(
      `${IG_GRAPH}/${containerId}?fields=status_code&access_token=${token.accessToken}`
    );
    const statusJson = await statusRes.json();
    const code: string = statusJson.status_code ?? "";
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED")
      throw new Error(`Instagram container failed: ${code} — ${JSON.stringify(statusJson)}`);
    emit(20 + Math.min(attempts * 2, 60), `Processing… (${code || "IN_PROGRESS"})`);
  }

  if (attempts >= 60) throw new Error("Instagram processing timed out after 5 min.");
  emit(85, "Publishing…");

  // 3. Publish
  const publishRes = await fetch(`${IG_GRAPH}/${token.userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: token.accessToken,
    }),
  });
  if (!publishRes.ok)
    throw new Error(`Instagram publish failed: ${publishRes.status} ${await publishRes.text()}`);
  const publishJson = await publishRes.json();
  if (publishJson.error) throw new Error(`Instagram: ${publishJson.error.message}`);

  emit(100, "Published!");
  return { publishId: publishJson.id };
}
