// YouTube Data API v3 — find currently-viral short-form videos in a niche.
// Used as remix "templates": we study why they went viral, never reuse footage.

const API = "https://www.googleapis.com/youtube/v3";

export interface ViralVideo {
  videoId: string;
  url: string;
  title: string;
  channelTitle: string;
  description: string;
  tags: string[];
  thumbnailUrl: string;   // medium quality
  thumbnailHigh: string;  // maxres/high quality — for vision analysis
  viewCount: number;
  likeCount: number;
  commentCount: number;
  publishedAt: string;
  durationSec: number;
  viewsPerDay: number;
  viralScore: number; // 0-1, normalised
}

// Parse ISO-8601 duration (e.g. "PT1M30S") into seconds.
function parseDuration(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ytFetch(path: string): Promise<any> {
  const res = await fetch(`${API}/${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error(
        "YouTube API rejected the request (403). Check that YOUTUBE_API_KEY is valid and the YouTube Data API v3 is enabled, or that the daily quota is not exhausted."
      );
    }
    throw new Error(`YouTube API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Search YouTube for the most-viewed recent short videos matching the given
 * queries, then rank them by how fast they accumulated views.
 */
export async function searchViralVideos(queries: string[]): Promise<ViralVideo[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error(
      "YOUTUBE_API_KEY is not set. Add it to .env.local — see CLAUDE.md for how to get a free key."
    );
  }

  // Only consider videos from the last ~9 months so trends stay current.
  const publishedAfter = new Date(Date.now() - 270 * 864e5).toISOString();
  const ids = new Set<string>();

  for (const q of queries.slice(0, 3)) {
    if (!q.trim()) continue;
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      order: "viewCount",
      videoDuration: "short", // under 4 min — short-form territory
      maxResults: "8",
      relevanceLanguage: "en",
      q,
      publishedAfter,
      key,
    });
    const data = await ytFetch(`search?${params}`);
    for (const item of data.items ?? []) {
      if (item.id?.videoId) ids.add(item.id.videoId);
    }
  }

  if (ids.size === 0) return [];

  // Fetch full stats for the collected video IDs (one batched call, max 50).
  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: [...ids].slice(0, 50).join(","),
    key,
  });
  const data = await ytFetch(`videos?${params}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const videos: ViralVideo[] = (data.items ?? []).map((v: any) => {
    const stats = v.statistics ?? {};
    const sn = v.snippet ?? {};
    const viewCount = Number(stats.viewCount || 0);
    const days = Math.max(
      1,
      (Date.now() - new Date(sn.publishedAt).getTime()) / 864e5
    );
    const viewsPerDay = viewCount / days;
    // Log scale: ~1M views/day maps to ~1.0.
    const viralScore = Math.min(1, Math.log10(viewsPerDay + 1) / 6);
    return {
      videoId: v.id,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: sn.title ?? "",
      channelTitle: sn.channelTitle ?? "",
      description: (sn.description ?? "").slice(0, 400),
      tags: Array.isArray(sn.tags) ? sn.tags.slice(0, 15) : [],
      thumbnailUrl:
        sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? "",
      thumbnailHigh:
        sn.thumbnails?.maxres?.url ?? sn.thumbnails?.high?.url ??
        sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? "",
      viewCount,
      likeCount: Number(stats.likeCount || 0),
      commentCount: Number(stats.commentCount || 0),
      publishedAt: sn.publishedAt ?? "",
      durationSec: parseDuration(v.contentDetails?.duration ?? ""),
      viewsPerDay: Math.round(viewsPerDay),
      viralScore: parseFloat(viralScore.toFixed(2)),
    };
  });

  return videos.sort((a, b) => b.viralScore - a.viralScore);
}
