// Jamendo API — find a free-to-use background music track that matches a
// vibe description. Used to auto-add music when applying the AI Remix.
//
// Get a free client_id at https://developer.jamendo.com — set in .env.local
// as JAMENDO_CLIENT_ID.

const JAMENDO_API = "https://api.jamendo.com/v3.0";

export interface MusicTrack {
  id: string;
  url: string;       // direct mp3 stream URL
  title: string;
  artist: string;
  durationSec: number;
  shareUrl: string;  // human-readable Jamendo page
}

/**
 * Search Jamendo for music matching a free-text vibe ("upbeat trap beat with
 * heavy bass drops"). Returns one track from the top results (lightly
 * randomised so back-to-back remixes don't pick the same song).
 */
export async function searchMusicByVibe(
  vibe: string,
  targetDurationSec: number
): Promise<MusicTrack | null> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "JAMENDO_CLIENT_ID is not set. Get a free client_id at https://developer.jamendo.com and add it to .env.local."
    );
  }

  const search = (vibe || "upbeat background").slice(0, 80);
  // Allow a generous duration window — Jamendo tracks are usually 2-4 min,
  // and FFmpeg trims to the clip length on export anyway.
  const minDur = Math.max(15, targetDurationSec);
  const maxDur = targetDurationSec + 240;

  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: "20",
    search,
    audioformat: "mp32",
    order: "popularity_total",
    durationbetween: `${minDur}_${maxDur}`,
    include: "musicinfo",
  });

  const res = await fetch(`${JAMENDO_API}/tracks/?${params}`);
  if (!res.ok) {
    throw new Error(`Jamendo API error ${res.status}`);
  }
  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const tracks = data.results || [];
  if (tracks.length === 0) return null;

  // Sample one from the top 5 for variety.
  const top = tracks.slice(0, 5);
  const pick = top[Math.floor(Math.random() * top.length)] as Record<string, unknown>;

  return {
    id: String(pick.id ?? ""),
    url: String(pick.audio ?? ""),
    title: String(pick.name ?? "Untitled"),
    artist: String(pick.artist_name ?? "Unknown artist"),
    durationSec: Number(pick.duration ?? 0),
    shareUrl: String(pick.shareurl ?? ""),
  };
}
