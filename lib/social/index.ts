import "server-only";
import * as tiktok from "./tiktok";
import * as youtube from "./youtube";
import * as instagram from "./instagram";
import { TokenData } from "./tokens";

export type SocialPlatform = "tiktok" | "youtube" | "instagram";

export const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
};

export const ALL_PLATFORMS: SocialPlatform[] = ["tiktok", "youtube", "instagram"];

interface Driver {
  getAuthUrl(): string;
  exchangeCode(code: string): Promise<TokenData>;
  refreshAccessToken(current: TokenData): Promise<TokenData>;
}

const DRIVERS: Record<SocialPlatform, Driver> = {
  tiktok,
  youtube,
  instagram,
};

export function getDriver(platform: SocialPlatform): Driver {
  return DRIVERS[platform];
}

export function isValidPlatform(s: string): s is SocialPlatform {
  return s === "tiktok" || s === "youtube" || s === "instagram";
}
