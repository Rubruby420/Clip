"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  Sparkles, Loader2, TrendingUp, Copy, Check, ExternalLink,
  Wand2, AlertCircle, RefreshCw,
} from "lucide-react";
import type { CaptionStyle } from "@/lib/captions";

interface ViralVideo {
  videoId: string; url: string; title: string; channelTitle: string;
  thumbnailUrl: string; viewCount: number; viewsPerDay: number;
  durationSec: number; viralScore: number;
}
interface RemixRecipe {
  matchedFormat: string; whyItWorks: string; hook: string; hookText: string;
  suggestedTitle: string; captionStyle: CaptionStyle; hashtags: string[];
  recutNote: string; predictedScore: number;
}
interface Remix {
  recipe: RemixRecipe; videos: ViralVideo[]; queries: string[]; generatedAt: string;
}

interface Props {
  clipId: string;
  onApplyStyle: (style: CaptionStyle) => void;
}

function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// Small copy-to-clipboard control reused across the recipe fields.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 text-surface-500 hover:text-brand-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-start gap-2 bg-surface-700/60 rounded-lg px-2.5 py-2">
        <p className="text-xs text-white flex-1 leading-relaxed">{value}</p>
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export default function RemixPanel({ clipId, onApplyStyle }: Props) {
  const [remix, setRemix] = useState<Remix | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // Load any cached remix for this clip.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/remix/${clipId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.remix) setRemix(data.remix);
        }
      } catch {}
      setInitialLoad(false);
    })();
  }, [clipId]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/remix/${clipId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate remix");
      } else {
        setRemix(data.remix);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setLoading(false);
  }

  const recipe = remix?.recipe;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-sm text-white font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-brand-400" /> Viral Remix
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          Find viral videos in your niche and remix this clip into their proven format.
        </p>
      </div>

      {/* Generate / regenerate */}
      {!initialLoad && (
        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-medium transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing trends…</>
          ) : remix ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Regenerate</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> Find viral matches</>
          )}
        </button>
      )}

      {loading && (
        <p className="text-[10px] text-surface-500 text-center leading-relaxed">
          Searching YouTube for viral videos, scoring them, and building your remix recipe. This takes ~15-30s.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Recipe */}
      {recipe && (
        <div className="space-y-3">
          {/* Format + predicted score */}
          <div className="bg-gradient-to-br from-brand-900/50 to-surface-700/40 border border-brand-800/60 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] text-brand-300 uppercase tracking-wider font-semibold">
                Matched format
              </span>
              <span className="inline-flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                <TrendingUp className="w-3 h-3" /> {recipe.predictedScore}% viral
              </span>
            </div>
            <p className="text-sm text-white font-semibold">{recipe.matchedFormat}</p>
            {recipe.whyItWorks && (
              <p className="text-[11px] text-surface-400 mt-1 leading-relaxed">{recipe.whyItWorks}</p>
            )}
          </div>

          <Field label="3-second hook" value={recipe.hook} />
          <Field label="On-screen hook text" value={recipe.hookText} />
          <Field label="Suggested title" value={recipe.suggestedTitle} />
          <Field label="Re-cut tip" value={recipe.recutNote} />

          {/* Caption style — applies straight to the editor */}
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
              Recommended caption style
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white capitalize bg-surface-700/60 rounded-lg px-2.5 py-2 flex-1">
                {recipe.captionStyle.replace("-", " ")}
              </span>
              <button
                onClick={() => {
                  onApplyStyle(recipe.captionStyle);
                  setApplied(true);
                  setTimeout(() => setApplied(false), 1800);
                }}
                className="shrink-0 flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors"
              >
                {applied ? <><Check className="w-3.5 h-3.5" /> Applied</> : "Apply"}
              </button>
            </div>
          </div>

          {/* Hashtags */}
          {recipe.hashtags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-surface-500 uppercase tracking-wider">Hashtags</p>
                <CopyButton text={recipe.hashtags.join(" ")} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recipe.hashtags.map((h) => (
                  <span key={h} className="text-[10px] text-brand-300 bg-brand-900/40 rounded-md px-1.5 py-0.5">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Viral reference videos */}
      {remix && remix.videos.length > 0 && (
        <div>
          <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-2">
            Viral references ({remix.videos.length})
          </p>
          <div className="space-y-2">
            {remix.videos.map((v) => (
              <a
                key={v.videoId}
                href={v.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-2 bg-surface-700/50 hover:bg-surface-700 rounded-lg p-1.5 transition-colors group"
              >
                <div className="relative w-20 shrink-0 aspect-video rounded overflow-hidden bg-surface-600">
                  {v.thumbnailUrl && (
                    <img src={v.thumbnailUrl} alt={v.title} className="w-full h-full object-cover" />
                  )}
                  <span className="absolute bottom-0.5 right-0.5 bg-black/80 text-white text-[8px] px-1 rounded">
                    {v.durationSec}s
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-white leading-tight line-clamp-2 group-hover:text-brand-300 transition-colors">
                    {v.title}
                  </p>
                  <p className="text-[9px] text-surface-500 mt-0.5 truncate">{v.channelTitle}</p>
                  <p className="text-[9px] text-surface-400 mt-0.5 flex items-center gap-1">
                    <span className="text-green-400 font-medium">{compact(v.viewCount)} views</span>
                    · {compact(v.viewsPerDay)}/day
                    <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-100" />
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {remix && (
        <p className="text-[9px] text-surface-600 text-center">
          Remixes the format only — never another creator&apos;s footage.
        </p>
      )}
    </div>
  );
}
