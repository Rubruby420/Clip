"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  Sparkles, Loader2, TrendingUp, Copy, Check, ExternalLink,
  Wand2, AlertCircle, RefreshCw, Music2, Film, Plus,
} from "lucide-react";
import type { CaptionStyle } from "@/lib/captions";

interface ViralVideo {
  videoId: string; url: string; title: string; channelTitle: string;
  thumbnailUrl: string; viewCount: number; viewsPerDay: number;
  durationSec: number; viralScore: number;
}
interface EditBeat {
  timeRange: string; cut: string; overlay: string; sound: string;
}
interface CloneRecipe {
  styleSummary: string; hook: string; hookText: string;
  suggestedTitle: string; captionStyle: CaptionStyle; hashtags: string[];
  musicVibe: string; editBeats: EditBeat[]; predictedScore: number;
  clonedFrom: { videoId: string; title: string }[];
}
interface Remix {
  candidates: ViralVideo[]; queries: string[];
  recipe: CloneRecipe | null; pickedIds?: string[]; generatedAt: string;
}

interface Props {
  clipId: string;
  previewActive: boolean;
  onPreview: (recipe: CloneRecipe) => void;
}

function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

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

export default function RemixPanel({ clipId, previewActive, onPreview }: Props) {
  const [remix, setRemix] = useState<Remix | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/remix/${clipId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.remix) {
            setRemix(data.remix);
            if (data.remix.pickedIds) setPicks(new Set(data.remix.pickedIds));
          }
        }
      } catch {}
      setInitialLoad(false);
    })();
  }, [clipId]);

  async function findRefs() {
    setFinding(true);
    setError(null);
    try {
      const res = await fetch(`/api/remix/${clipId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to find references");
      } else {
        setRemix(data.remix);
        setPicks(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setFinding(false);
  }

  async function cloneFromPicks() {
    if (picks.size === 0) return;
    setCloning(true);
    setError(null);
    try {
      const res = await fetch(`/api/remix/${clipId}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: [...picks] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to clone style");
      } else {
        setRemix(data.remix);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setCloning(false);
  }

  function togglePick(videoId: string) {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else if (next.size < 5) next.add(videoId);
      return next;
    });
  }

  const recipe = remix?.recipe;
  const candidates = remix?.candidates || [];

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-sm text-white font-medium flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-brand-400" /> Viral Remix
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          Find 10 viral videos in your niche, pick the ones to copy, and let AI remix your clip in their exact style.
        </p>
      </div>

      {/* Find / refind */}
      {!initialLoad && (
        <button
          onClick={findRefs}
          disabled={finding || cloning}
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-medium transition-colors"
        >
          {finding ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching YouTube…</>
          ) : candidates.length ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Find new references</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> Find 10 viral references</>
          )}
        </button>
      )}

      {finding && (
        <p className="text-[10px] text-surface-500 text-center leading-relaxed">
          Pulling the top 10 viral videos in your niche. ~10-20s.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Candidate gallery — pick the videos to clone the style of */}
      {candidates.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider">
              References ({candidates.length})
            </p>
            <p className="text-[10px] text-brand-300 font-semibold">
              {picks.size} picked{picks.size > 0 ? ` / 5 max` : ""}
            </p>
          </div>
          <div className="space-y-2">
            {candidates.map((v) => {
              const picked = picks.has(v.videoId);
              return (
                <div
                  key={v.videoId}
                  className={`flex gap-2 rounded-lg p-1.5 transition-colors border ${
                    picked
                      ? "bg-brand-900/40 border-brand-600"
                      : "bg-surface-700/50 border-transparent hover:bg-surface-700"
                  }`}
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
                    <p className="text-[11px] text-white leading-tight line-clamp-2">
                      {v.title}
                    </p>
                    <p className="text-[9px] text-surface-500 mt-0.5 truncate">{v.channelTitle}</p>
                    <p className="text-[9px] text-surface-400 mt-0.5">
                      <span className="text-green-400 font-medium">{compact(v.viewCount)}</span>
                      {" · "}{compact(v.viewsPerDay)}/day
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        onClick={() => togglePick(v.videoId)}
                        className={`flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded transition-colors ${
                          picked
                            ? "bg-brand-600 text-white"
                            : "bg-surface-600 hover:bg-surface-500 text-white"
                        }`}
                      >
                        {picked ? (
                          <><Check className="w-3 h-3" /> Picked</>
                        ) : (
                          <><Plus className="w-3 h-3" /> Pick</>
                        )}
                      </button>
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-surface-300 hover:text-brand-300 px-1.5 py-1 transition-colors"
                        title="Watch on YouTube"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky-ish CTA — only appears once 1+ refs are picked */}
          {picks.size > 0 && (
            <button
              onClick={cloneFromPicks}
              disabled={cloning}
              className="w-full mt-3 flex items-center justify-center gap-1.5 bg-gradient-to-r from-brand-500 to-purple-600 hover:from-brand-400 hover:to-purple-500 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-semibold transition-colors"
            >
              {cloning ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cloning style…</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5" /> Remix my clip in {picks.size === 1 ? "this style" : `these ${picks.size} styles`}</>
              )}
            </button>
          )}

          {cloning && (
            <p className="text-[10px] text-surface-500 text-center leading-relaxed mt-1">
              Studying the picks and building a beat-by-beat plan. ~10-20s.
            </p>
          )}
        </div>
      )}

      {/* Clone recipe — the AI's style-clone plan for the user's clip */}
      {recipe && (
        <div className="space-y-3 pt-2 border-t border-surface-700">
          {/* Style summary + predicted score */}
          <div className="bg-gradient-to-br from-brand-900/50 to-purple-900/40 border border-brand-800/60 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] text-brand-300 uppercase tracking-wider font-semibold">
                Cloned style
              </span>
              <span className="inline-flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                <TrendingUp className="w-3 h-3" /> {recipe.predictedScore}% viral
              </span>
            </div>
            <p className="text-xs text-white leading-relaxed">{recipe.styleSummary}</p>
            {recipe.clonedFrom?.length > 0 && (
              <p className="text-[10px] text-surface-400 mt-2 line-clamp-2">
                <span className="text-surface-500">From: </span>
                {recipe.clonedFrom.map((c) => `"${c.title}"`).join(", ")}
              </p>
            )}
          </div>

          {/* Preview Edit — applies the AI's planned changes to the canvas
              without writing to the DB. The editor shows a Save/Discard bar
              so you can A/B and confirm. */}
          <button
            onClick={() => onPreview(recipe)}
            disabled={previewActive}
            className="w-full flex items-center justify-center gap-1.5 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-60 text-black text-xs py-2.5 rounded-lg font-semibold transition-colors"
          >
            {previewActive ? (
              <><Check className="w-3.5 h-3.5" /> Previewing — use Save / Discard below</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5" /> Preview this edit on my clip</>
            )}
          </button>
          <p className="text-[10px] text-surface-500 leading-relaxed -mt-1">
            Shows the hook overlay, title, and caption style live on the preview without saving.
            Use the Save / Discard bar that appears below the preview to commit or revert.
          </p>

          <Field label="3-second hook" value={recipe.hook} />
          <Field label="On-screen hook text" value={recipe.hookText} />
          <Field label="Suggested title" value={recipe.suggestedTitle} />

          {/* Music vibe */}
          {recipe.musicVibe && (
            <div>
              <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Music2 className="w-3 h-3" /> Music / sound vibe
              </p>
              <div className="flex items-start gap-2 bg-surface-700/60 rounded-lg px-2.5 py-2">
                <p className="text-xs text-white flex-1 leading-relaxed">{recipe.musicVibe}</p>
                <CopyButton text={recipe.musicVibe} />
              </div>
            </div>
          )}

          {/* Edit beats — the beat-by-beat plan */}
          {recipe.editBeats?.length > 0 && (
            <div>
              <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Film className="w-3 h-3" /> Edit plan ({recipe.editBeats.length} beats)
              </p>
              <div className="space-y-1.5">
                {recipe.editBeats.map((b, i) => (
                  <div
                    key={i}
                    className="bg-surface-700/60 rounded-lg p-2 border-l-2 border-brand-500"
                  >
                    <p className="text-[10px] text-brand-300 font-mono font-bold mb-1">{b.timeRange}</p>
                    {b.cut && <p className="text-[11px] text-white"><span className="text-surface-500">Cut:</span> {b.cut}</p>}
                    {b.overlay && <p className="text-[11px] text-white mt-0.5"><span className="text-surface-500">Text:</span> {b.overlay}</p>}
                    {b.sound && <p className="text-[11px] text-white mt-0.5"><span className="text-surface-500">Sound:</span> {b.sound}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Caption style — shown as info; applied via the Preview button. */}
          <div>
            <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
              Caption style
            </p>
            <span className="text-xs text-white capitalize bg-surface-700/60 rounded-lg px-2.5 py-2 block">
              {recipe.captionStyle.replace("-", " ")}
            </span>
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
    </div>
  );
}
