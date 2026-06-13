"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, useRef, useCallback } from "react";
import {
  ImageIcon, Loader2, AlertCircle, RefreshCw, Wand2,
  ThumbsUp, ThumbsDown, Download, ChevronDown, ChevronUp,
  Upload, Sparkles,
} from "lucide-react";
import { downloadUrl } from "@/lib/file-urls";

interface ThumbnailRecipe {
  bestFrameIndex: number;
  headline: string;
  subText?: string;
  fontSizePct: number;
  textColor: string;
  strokeColor: string;
  position: { v: string; h: string };
  rationale?: string;
  youtubePatternsApplied?: string[];
  lessonsApplied?: string[];
  aiBackgroundPrompt?: string;
}

interface ThumbnailCache {
  recipe: ThumbnailRecipe;
  mode: "frame" | "ai";
  generatedAt: string;
  feedback: object[];
}

interface Props {
  clipId: string;
  clipTitle?: string;
}

export default function ThumbnailPanel({ clipId, clipTitle = "thumbnail" }: Props) {
  const [cache, setCache] = useState<ThumbnailCache | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"frame" | "ai">("frame");
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Feedback state
  const [verdict, setVerdict] = useState<"up" | "down" | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [exampleFile, setExampleFile] = useState<File | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const exampleRef = useRef<HTMLInputElement>(null);

  // Insight toggle
  const [showInsights, setShowInsights] = useState(false);

  // Load cached thumbnail on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/clips/${clipId}/thumbnail`);
        if (res.ok) {
          const data = await res.json();
          if (data.thumbnail) setCache(data.thumbnail);
          if (data.url) setUrl(data.url);
        }
      } catch {}
      setInitialLoad(false);
    })();
  }, [clipId]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setVerdict(null);
    setFeedbackNote("");
    setExampleFile(null);
    setFeedbackDone(false);
    try {
      const res = await fetch(`/api/clips/${clipId}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
      } else {
        setCache(data.thumbnail);
        setUrl(data.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setLoading(false);
    setInitialLoad(false);
  }, [clipId, mode]);

  const submitFeedback = useCallback(async (regenerate: boolean) => {
    if (!verdict) return;
    setFeedbackLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("verdict", verdict);
      fd.append("note", feedbackNote);
      fd.append("regenerate", String(regenerate));
      if (exampleFile) fd.append("example", exampleFile);

      const res = await fetch(`/api/clips/${clipId}/thumbnail/feedback`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Feedback failed");
      } else {
        if (data.regenerated && data.url) {
          setUrl(data.url);
          if (data.thumbnail) setCache(data.thumbnail);
          setVerdict(null);
          setFeedbackNote("");
          setExampleFile(null);
        }
        setFeedbackDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setFeedbackLoading(false);
  }, [clipId, verdict, feedbackNote, exampleFile]);

  const recipe = cache?.recipe;
  const hasYoutubePatterns = (recipe?.youtubePatternsApplied?.length ?? 0) > 0;
  const hasLessons = (recipe?.lessonsApplied?.length ?? 0) > 0;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <p className="text-sm text-white font-medium flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 text-brand-400" /> Thumbnail Generator
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          AI picks the best frame, studies viral YouTube thumbnails, and overlays a click-worthy hook.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex rounded-lg border border-surface-600 overflow-hidden">
        {(["frame", "ai"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-brand-600 text-white"
                : "text-surface-400 hover:text-white hover:bg-surface-700"
            }`}
          >
            {m === "ai" ? <Sparkles className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />}
            {m === "frame" ? "Frame + Text" : "AI Background"}
          </button>
        ))}
      </div>
      {mode === "ai" && (
        <p className="text-[10px] text-yellow-400/80 leading-relaxed">
          AI background uses gpt-image-1 to stylise the chosen frame — adds cost per generation.
        </p>
      )}

      {/* Generate button */}
      {!initialLoad && (
        <button
          onClick={generate}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-medium transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating… (may take ~30s)</>
          ) : url ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Regenerate</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> Generate Thumbnail</>
          )}
        </button>
      )}

      {/* Initial loading */}
      {initialLoad && (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-surface-500" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Generated thumbnail */}
      {url && (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-surface-700 aspect-video">
            <img
              src={`${url}?t=${Date.now()}`}
              alt="Generated thumbnail"
              className="w-full h-full object-contain"
            />
          </div>

          {/* Download */}
          <a
            href={cache ? downloadUrl(
              `${cache.recipe ? "" : ""}${url.replace("/api/files/", "")}`,
              `${clipTitle.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-thumbnail.jpg`
            ) : url}
            download
            className="w-full flex items-center justify-center gap-1.5 border border-surface-600 text-surface-300 hover:text-white hover:border-surface-500 text-xs py-2 rounded-lg font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download .jpg
          </a>

          {/* Insights (what YouTube patterns + memory lessons were applied) */}
          {(hasYoutubePatterns || hasLessons) && (
            <div className="rounded-lg border border-surface-600 overflow-hidden">
              <button
                onClick={() => setShowInsights((s) => !s)}
                className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-surface-400 hover:text-surface-300 transition-colors uppercase tracking-wider"
              >
                <span>What it learned &amp; applied</span>
                {showInsights ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showInsights && (
                <div className="px-3 pb-3 space-y-2">
                  {hasYoutubePatterns && (
                    <div>
                      <p className="text-[10px] text-surface-500 mb-1">From YouTube thumbnails:</p>
                      {recipe!.youtubePatternsApplied!.map((p, i) => (
                        <p key={i} className="text-[10px] text-surface-300 leading-relaxed">· {p}</p>
                      ))}
                    </div>
                  )}
                  {hasLessons && (
                    <div>
                      <p className="text-[10px] text-surface-500 mb-1">From your past feedback:</p>
                      {recipe!.lessonsApplied!.map((l, i) => (
                        <p key={i} className="text-[10px] text-brand-300 leading-relaxed">· {l}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Feedback row */}
          {!feedbackDone ? (
            <div className="space-y-2">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider">Rate this thumbnail</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setVerdict("up"); setFeedbackNote(""); setExampleFile(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    verdict === "up"
                      ? "bg-green-800/50 border-green-600 text-green-300"
                      : "border-surface-600 text-surface-400 hover:text-white hover:border-surface-500"
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" /> Looks good
                </button>
                <button
                  onClick={() => setVerdict("down")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    verdict === "down"
                      ? "bg-red-900/40 border-red-700 text-red-300"
                      : "border-surface-600 text-surface-400 hover:text-white hover:border-surface-500"
                  }`}
                >
                  <ThumbsDown className="w-3.5 h-3.5" /> Needs work
                </button>
              </div>

              {/* Thumbs-up: just save the positive signal */}
              {verdict === "up" && (
                <button
                  onClick={() => submitFeedback(false)}
                  disabled={feedbackLoading}
                  className="w-full flex items-center justify-center gap-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs py-2 rounded-lg font-medium transition-colors"
                >
                  {feedbackLoading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                    : "Save positive feedback"}
                </button>
              )}

              {/* Thumbs-down: ask how to improve + example */}
              {verdict === "down" && (
                <div className="space-y-2">
                  <textarea
                    value={feedbackNote}
                    onChange={(e) => setFeedbackNote(e.target.value)}
                    placeholder="How can I do better? (e.g. bigger text, yellow color, face in center…)"
                    rows={3}
                    className="w-full bg-surface-700 border border-surface-600 text-white text-xs rounded-lg px-3 py-2 resize-none placeholder:text-surface-500 focus:outline-none focus:border-brand-500"
                  />

                  {/* Example image upload */}
                  <input
                    ref={exampleRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setExampleFile(f);
                      if (exampleRef.current) exampleRef.current.value = "";
                    }}
                  />
                  <button
                    onClick={() => exampleRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 border border-surface-600 text-surface-400 hover:text-white hover:border-surface-500 text-xs py-2 rounded-lg transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {exampleFile ? `Example: ${exampleFile.name}` : "Upload example thumbnail (optional)"}
                  </button>

                  <div className="flex gap-2">
                    <button
                      onClick={() => submitFeedback(false)}
                      disabled={feedbackLoading || (!feedbackNote && !exampleFile)}
                      className="flex-1 flex items-center justify-center gap-1.5 border border-surface-600 text-surface-300 hover:text-white disabled:opacity-40 text-xs py-2 rounded-lg transition-colors"
                    >
                      {feedbackLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      Save feedback
                    </button>
                    <button
                      onClick={() => submitFeedback(true)}
                      disabled={feedbackLoading || (!feedbackNote && !exampleFile)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs py-2 rounded-lg font-medium transition-colors"
                    >
                      {feedbackLoading
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Regenerating…</>
                        : <><RefreshCw className="w-3 h-3" /> Regenerate</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-center text-green-300/80">
              {verdict === "up"
                ? "Feedback saved — I'll keep that style! 👍"
                : "Learned from your feedback — will apply next time. 💡"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
