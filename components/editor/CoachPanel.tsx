"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, useCallback } from "react";
import {
  Gauge, Loader2, AlertCircle, CheckCircle2, RefreshCw, Wand2,
  ExternalLink, AlertTriangle, Lightbulb, ChevronDown,
} from "lucide-react";

interface CoachComment { issue: string; fix: string }
interface CoachReport {
  viralReady: boolean; score: number; verdict: string; comments: CoachComment[];
}
interface RefVideo {
  videoId: string; url: string; title: string; channelTitle: string;
  thumbnailUrl: string; viewCount: number; viewsPerDay: number; durationSec: number;
}
interface Coach { report: CoachReport; videos: RefVideo[]; generatedAt: string }

interface Props { clipId: string }

function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function scoreColor(s: number): string {
  if (s >= 70) return "bg-green-500";
  if (s >= 45) return "bg-yellow-500";
  return "bg-red-500";
}

export default function CoachPanel({ clipId }: Props) {
  const [coach, setCoach] = useState<Coach | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRefs, setShowRefs] = useState(true);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/coach`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error || "Coach check failed");
      else setCoach(data.coach);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setLoading(false);
    setInitialLoad(false);
  }, [clipId]);

  // Load the cached coach report. A weak clip from the import auto-check has
  // a report but no reference videos yet — fetch them automatically.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/clips/${clipId}/coach`);
        if (res.ok) {
          const data = await res.json();
          if (data.coach) {
            setCoach(data.coach);
            const r = data.coach.report;
            if (r && !r.viralReady && (!data.coach.videos || data.coach.videos.length === 0)) {
              runCheck();
              return;
            }
          }
        }
      } catch {}
      setInitialLoad(false);
    })();
  }, [clipId, runCheck]);

  const report = coach?.report;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-sm text-white font-medium flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-brand-400" /> Virality Coach
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          An AI check on whether this clip is ready to go viral — with fixes for what isn&apos;t.
        </p>
      </div>

      {initialLoad ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-surface-500" />
        </div>
      ) : (
        <button
          onClick={runCheck}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-medium transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the clip…</>
          ) : coach ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Re-check</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> Run Coach check</>
          )}
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Verdict + score */}
          <div
            className={`rounded-xl p-3 border ${
              report.viralReady
                ? "bg-green-900/30 border-green-800/60"
                : "bg-surface-700/40 border-surface-600"
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1">
                {report.viralReady ? (
                  <span className="text-green-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Viral-ready
                  </span>
                ) : (
                  <span className="text-yellow-300 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Needs work
                  </span>
                )}
              </span>
              <span className={`text-white text-[11px] font-bold px-2 py-0.5 rounded-full ${scoreColor(report.score)}`}>
                {report.score}/100
              </span>
            </div>
            {report.verdict && (
              <p className="text-xs text-white leading-relaxed mt-1">{report.verdict}</p>
            )}
          </div>

          {/* Issue / fix comments */}
          {report.comments.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider">
                Coach notes ({report.comments.length})
              </p>
              {report.comments.map((c, i) => (
                <div key={i} className="bg-surface-700/50 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-white leading-relaxed">{c.issue}</p>
                  </div>
                  {c.fix && (
                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="w-3 h-3 text-brand-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-brand-200 leading-relaxed">{c.fix}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Reference videos */}
          {coach && coach.videos.length > 0 && (
            <div>
              <button
                onClick={() => setShowRefs((s) => !s)}
                className="w-full flex items-center justify-between mb-2 text-[10px] text-surface-500 uppercase tracking-wider hover:text-surface-300 transition-colors"
                aria-expanded={showRefs}
              >
                <span>Viral references to study ({coach.videos.length})</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${showRefs ? "" : "-rotate-90"}`}
                />
              </button>
              {showRefs && (
              <div className="space-y-2">
                {coach.videos.map((v) => (
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
              )}
            </div>
          )}

          {report.viralReady && (
            <p className="text-[11px] text-green-300/80 text-center">
              No fixes needed — this clip is good to post. 🎉
            </p>
          )}
        </div>
      )}
    </div>
  );
}
