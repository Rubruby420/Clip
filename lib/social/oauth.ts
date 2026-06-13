import "server-only";
import crypto from "crypto";

// In-process CSRF state store. Entries expire after 10 min. Fine for a
// solo-use app (single Node process, no multi-instance concerns).
const pendingStates = new Map<string, number>();

export function createState(): string {
  const s = crypto.randomBytes(16).toString("hex");
  pendingStates.set(s, Date.now() + 10 * 60 * 1000);
  return s;
}

export function verifyState(s: string): boolean {
  const exp = pendingStates.get(s);
  if (!exp) return false;
  pendingStates.delete(s);
  return Date.now() < exp;
}

/** Build the OAuth redirect_uri for a given platform.
 *  Reads PUBLIC_BASE_URL from env (default http://localhost:3000). */
export function redirectUri(platform: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/social/${platform}/callback`;
}
