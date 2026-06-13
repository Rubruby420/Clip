import "server-only";
import crypto from "crypto";

interface StateEntry {
  exp: number;
  codeVerifier?: string;
}

// In-process CSRF state store. Entries expire after 10 min. Fine for a
// solo-use app (single Node process, no multi-instance concerns).
const pendingStates = new Map<string, StateEntry>();

export function createState(codeVerifier?: string): string {
  const s = crypto.randomBytes(16).toString("hex");
  pendingStates.set(s, { exp: Date.now() + 10 * 60 * 1000, codeVerifier });
  return s;
}

/** Returns { valid, codeVerifier } — codeVerifier is set when PKCE was used. */
export function verifyState(s: string): { valid: boolean; codeVerifier?: string } {
  const entry = pendingStates.get(s);
  if (!entry) return { valid: false };
  pendingStates.delete(s);
  if (Date.now() >= entry.exp) return { valid: false };
  return { valid: true, codeVerifier: entry.codeVerifier };
}

/** Generate a PKCE code_verifier + code_challenge (S256). */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** Build the OAuth redirect_uri for a given platform.
 *  Reads PUBLIC_BASE_URL from env (default http://localhost:3000). */
export function redirectUri(platform: string): string {
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/social/${platform}/callback`;
}
