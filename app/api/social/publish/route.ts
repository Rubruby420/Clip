import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resolveStorage, projectHighlightReelPath } from "@/lib/storage";
import { isValidPlatform } from "@/lib/social/index";
import { loadToken, saveToken, isTokenValid } from "@/lib/social/tokens";
import { getDriver } from "@/lib/social/index";
import * as tiktok from "@/lib/social/tiktok";
import * as youtube from "@/lib/social/youtube";
import * as instagram from "@/lib/social/instagram";
import fs from "fs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    platform,
    source,
    id,
    caption = "",
    title = "",
    privacy = "SELF_ONLY",
    privacyStatus = "public",
  } = body as {
    platform: string;
    source: "clip" | "reel";
    id: string;
    caption?: string;
    title?: string;
    privacy?: string; // TikTok privacy_level
    privacyStatus?: string; // YouTube privacyStatus
  };

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        // --- Validate platform ---
        if (!isValidPlatform(platform)) {
          send({ type: "error", error: "Unknown platform" });
          controller.close();
          return;
        }

        // --- Load + maybe refresh token ---
        let token = loadToken(platform);
        if (!token) {
          send({ type: "error", error: `Not connected to ${platform}. Connect in Settings → Connected Accounts.` });
          controller.close();
          return;
        }
        if (!isTokenValid(token)) {
          send({ type: "progress", pct: 2, message: "Refreshing token…" });
          try {
            token = await getDriver(platform).refreshAccessToken(token);
            saveToken(platform, token);
          } catch (err) {
            send({ type: "error", error: `Session expired — please reconnect ${platform} in Settings. (${err})` });
            controller.close();
            return;
          }
        }

        // --- Resolve the mp4 path ---
        let absPath: string;
        let relPath: string;
        let videoTitle = title;

        if (source === "clip") {
          const clip = await db.clip.findUnique({ where: { id } });
          if (!clip) { send({ type: "error", error: "Clip not found" }); controller.close(); return; }
          if (!clip.exportUrl) { send({ type: "error", error: "This clip hasn't been exported yet. Export it first, then publish." }); controller.close(); return; }
          relPath = clip.exportUrl;
          absPath = resolveStorage(relPath);
          if (!videoTitle) videoTitle = clip.title;
        } else {
          // source === "reel"
          relPath = projectHighlightReelPath(id);
          absPath = resolveStorage(relPath);
          if (!videoTitle) videoTitle = "Highlight Reel";
        }

        if (!fs.existsSync(absPath)) {
          send({ type: "error", error: "Video file not found on disk — try exporting again." });
          controller.close();
          return;
        }

        send({ type: "progress", pct: 3, message: "Starting upload…" });

        // --- Dispatch to platform driver ---
        let result: { publishId?: string; postUrl?: string } = {};

        if (platform === "tiktok") {
          result = await tiktok.publishVideo({
            absPath,
            title: videoTitle,
            privacy: (privacy as tiktok.TikTokPrivacy) ?? "SELF_ONLY",
            token,
            onProgress: (pct, msg) => send({ type: "progress", pct, message: msg }),
          });
        } else if (platform === "youtube") {
          result = await youtube.publishVideo({
            absPath,
            title: videoTitle,
            description: caption,
            privacyStatus: (privacyStatus as "public" | "private" | "unlisted") ?? "public",
            token,
            onProgress: (pct, msg) => send({ type: "progress", pct, message: msg }),
          });
        } else if (platform === "instagram") {
          result = await instagram.publishVideo({
            relPath,
            caption: caption || videoTitle,
            token,
            onProgress: (pct, msg) => send({ type: "progress", pct, message: msg }),
          });
        }

        send({ type: "done", ...result });
      } catch (err) {
        console.error("[social/publish] error:", err);
        send({ type: "error", error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
