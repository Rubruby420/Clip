import "server-only";
import fs from "fs";
import path from "path";

const STORAGE_DIR = process.env.CLIP_STORAGE_DIR ?? "D:/clip";
const TOKENS_DIR = path.join(path.resolve(STORAGE_DIR), "_social");
const TOKENS_FILE = path.join(TOKENS_DIR, "tokens.json");

export type Platform = "tiktok" | "youtube" | "instagram";

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  /** Unix milliseconds when the access token expires. */
  expiresAt: number;
  /** Platform-specific user/account id. */
  userId?: string;
  /** Display name / handle shown in the UI. */
  handle?: string;
  scope?: string;
}

type TokenStore = Partial<Record<Platform, TokenData>>;

function readStore(): TokenStore {
  try {
    if (fs.existsSync(TOKENS_FILE))
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8")) as TokenStore;
  } catch {}
  return {};
}

function writeStore(store: TokenStore): void {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function loadToken(platform: Platform): TokenData | null {
  return readStore()[platform] ?? null;
}

export function saveToken(platform: Platform, data: TokenData): void {
  const store = readStore();
  store[platform] = data;
  writeStore(store);
}

export function deleteToken(platform: Platform): void {
  const store = readStore();
  delete store[platform];
  writeStore(store);
}

/** Returns true when the token exists and won't expire within the next 60 s. */
export function isTokenValid(t: TokenData): boolean {
  return Date.now() < t.expiresAt - 60_000;
}
