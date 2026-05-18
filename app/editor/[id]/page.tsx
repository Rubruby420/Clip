"use client";

import { useEffect, useState, use, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Zap, Download, Loader2,
  Film, Type, Layout, Sparkles, Scissors,
} from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import Timeline from "@/components/editor/Timeline";
import LayoutPanel, { type LayoutConfig, DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import CaptionPanel from "@/components/editor/CaptionPanel";
import RemixPanel from "@/components/editor/RemixPanel";
import { DEFAULT_CAPTION_CONFIG, type CaptionConfig } from "@/lib/captions";

interface WordTimestamp { word: string; start: number; end: number; }
interface Clip {
  id: string; projectId: string; title: string;
  startTime: number; endTime: number; score: number | null;
  words: string; captionStyle: string; layoutConfig: string;
  exportUrl: string | null;
}

type Tab = "layout" | "captions" | "viral";
type ExportAspect = "9:16" | "16:9" | "1:1";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [clip, setClip] = useState<Clip | null>(null);
  const [loading, setLoading] = useState(true);

  const [videoSrc, setVideoSrc] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [words, setWords] = useState<WordTimestamp[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>("layout");
  const [layout, setLayout] = useState<LayoutConfig>(DEFAULT_LAYOUT);
  const [captionConfig, setCaptionConfig] = useState<CaptionConfig>(DEFAULT_CAPTION_CONFIG);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportAspect, setExportAspect] = useState<ExportAspect>("9:16");
  const [showExportModal, setShowExportModal] = useState(false);

  // Edit-mode choice: the user must pick AI auto-cut or manual before editing.
  const [showEditChoice, setShowEditChoice] = useState(true);
  const [aiCutting, setAiCutting] = useState(false);
  const [aiCutReason, setAiCutReason] = useState<string | null>(null);

  // Load clip + project video
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/clips/${id}`);
      if (!res.ok) { setLoading(false); return; }
      const { clip: c } = await res.json();
      setClip(c);
      setStartTime(c.startTime);
      setEndTime(c.endTime);
      setWords(JSON.parse(c.words || "[]"));
      if (c.layoutConfig) {
        try { setLayout({ ...DEFAULT_LAYOUT, ...JSON.parse(c.layoutConfig) }); } catch {}
      }
      if (c.captionStyle) {
        try { setCaptionConfig((prev) => ({ ...prev, style: c.captionStyle })); } catch {}
      }
      if (c.exportUrl) setExportUrl(c.exportUrl);

      // Get project to get video URL
      const projRes = await fetch(`/api/projects/${c.projectId}`);
      if (projRes.ok) {
        const { project } = await projRes.json();
        setVideoSrc(project.originalUrl);
      }
      setLoading(false);
    })();
  }, [id]);

  // Auto-save layout/caption changes
  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      await fetch(`/api/clips/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [id]
  );

  useEffect(() => {
    if (!clip) return;
    const timer = setTimeout(() => {
      save({
        startTime,
        endTime,
        layoutConfig: JSON.stringify(layout),
        captionStyle: captionConfig.style,
      });
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, layout, captionConfig.style]);

  async function handleExport() {
    setExporting(true);
    setShowExportModal(false);
    try {
      const res = await fetch(`/api/export/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aspectRatio: exportAspect,
          blurBackground: layout.bgType === "blur",
        }),
      });
      const data = await res.json();
      if (data.exportUrl) setExportUrl(data.exportUrl);
    } catch (err) {
      alert("Export failed: " + err);
    }
    setExporting(false);
  }

  // Let AI pick the best part of the clip, then apply it (auto-saved like
  // any manual trim — and still adjustable by hand afterwards).
  async function handleAiCut() {
    setAiCutting(true);
    try {
      const res = await fetch(`/api/clips/${id}/autocut`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setStartTime(data.startTime);
        setEndTime(data.endTime);
        setAiCutReason(data.reason || "AI trimmed this clip to its best moment.");
        setShowEditChoice(false);
      } else {
        alert(data.error || "AI auto-cut failed");
      }
    } catch {
      alert("AI auto-cut failed — check your connection and try again.");
    }
    setAiCutting(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center gap-4">
        <Film className="w-12 h-12 text-surface-500" />
        <p className="text-white">Clip not found</p>
        <Link href="/" className="text-brand-400 hover:underline">Go home</Link>
      </div>
    );
  }

  const TAB_ICONS: Record<Tab, React.ReactNode> = {
    layout: <Layout className="w-4 h-4" />,
    captions: <Type className="w-4 h-4" />,
    viral: <Sparkles className="w-4 h-4" />,
  };

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-600 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href={`/projects/${clip.projectId}`} className="text-surface-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-sm">Clip</span>
        </div>
        <span className="text-surface-500 text-sm">/</span>
        <span className="text-white text-sm font-medium truncate max-w-[200px]">{clip.title}</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleAiCut}
            disabled={aiCutting}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-600 text-brand-300 hover:bg-brand-900/40 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
            title="Let AI re-trim this clip to its best moment"
          >
            {aiCutting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI Cut
          </button>
          {exportUrl && (
            <a
              href={exportUrl}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
          <button
            onClick={() => setShowExportModal(true)}
            disabled={exporting || !videoSrc}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-colors"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>

      {/* Main editor layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — tabs */}
        <aside className="w-64 border-r border-surface-600 bg-surface-800 flex flex-col overflow-y-auto shrink-0">
          {/* Tab switcher */}
          <div className="flex border-b border-surface-600">
            {(["layout", "captions", "viral"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 flex items-center justify-center gap-1 py-3 text-xs font-medium transition-colors capitalize ${
                  activeTab === tab
                    ? "text-brand-300 border-b-2 border-brand-500"
                    : "text-surface-500 hover:text-white"
                }`}
              >
                {TAB_ICONS[tab]} {tab}
              </button>
            ))}
          </div>

          {activeTab === "layout" && (
            <LayoutPanel config={layout} onChange={setLayout} />
          )}
          {activeTab === "captions" && (
            <CaptionPanel
              config={captionConfig}
              onChange={setCaptionConfig}
              enabled={captionsEnabled}
              onEnabledChange={setCaptionsEnabled}
            />
          )}
          {activeTab === "viral" && (
            <RemixPanel
              clipId={clip.id}
              onApplyStyle={(style) => {
                setCaptionConfig((prev) => ({ ...prev, style }));
                setCaptionsEnabled(true);
              }}
            />
          )}
        </aside>

        {/* Center — preview */}
        <main className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto bg-surface-900">
          <div className="w-full max-w-xs">
            {videoSrc ? (
              <CanvasPreview
                videoSrc={videoSrc}
                words={words}
                currentTime={Math.max(0, currentTime - startTime)}
                onTimeUpdate={(t) => setCurrentTime(t)}
                onLoadedMetadata={(d) => setDuration(d)}
                captionConfig={captionConfig}
                captionsEnabled={captionsEnabled}
                layout={layout}
                startTime={startTime}
                endTime={endTime}
              />
            ) : (
              <div className="aspect-[9/16] bg-surface-800 rounded-xl flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-surface-500" />
              </div>
            )}
          </div>

          {/* Playback hint */}
          <p className="mt-3 text-xs text-surface-600 text-center">Use the video controls to preview · Trim with sliders below</p>
        </main>
      </div>

      {/* AI cut summary */}
      {aiCutReason && (
        <div className="shrink-0 px-4 py-2 bg-brand-900/30 border-t border-brand-800/50 flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-brand-400 shrink-0" />
          <p className="text-xs text-brand-200 flex-1">
            <span className="font-semibold">AI cut:</span> {aiCutReason} You can still fine-tune the trim below.
          </p>
          <button
            onClick={() => setAiCutReason(null)}
            className="text-surface-500 hover:text-white text-sm leading-none"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bottom — timeline */}
      {duration > 0 && (
        <div className="shrink-0">
          <Timeline
            duration={duration}
            startTime={startTime}
            endTime={endTime}
            currentTime={currentTime}
            onStartChange={setStartTime}
            onEndChange={setEndTime}
            onSeek={(t) => setCurrentTime(t)}
          />
        </div>
      )}

      {/* Edit-mode choice — blocks editing until the user picks an approach */}
      {showEditChoice && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-white font-bold text-lg mb-1">Edit this clip</h2>
            <p className="text-surface-500 text-sm mb-5">
              Choose how to start. You can always fine-tune the trim by hand afterwards.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleAiCut}
                disabled={aiCutting}
                className="w-full flex items-start gap-3 p-4 rounded-xl border border-brand-600 bg-brand-900/30 hover:bg-brand-900/50 disabled:opacity-60 text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
                  {aiCutting ? (
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  ) : (
                    <Sparkles className="w-5 h-5 text-white" />
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">
                    {aiCutting ? "AI is choosing the best part…" : "AI Auto-Cut"}
                  </p>
                  <p className="text-surface-400 text-xs mt-0.5">
                    Let AI trim straight to the punchiest, most viral moment of the clip.
                  </p>
                </div>
              </button>
              <button
                onClick={() => setShowEditChoice(false)}
                disabled={aiCutting}
                className="w-full flex items-start gap-3 p-4 rounded-xl border border-surface-600 hover:border-surface-500 disabled:opacity-60 text-left transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-surface-700 flex items-center justify-center shrink-0">
                  <Scissors className="w-5 h-5 text-surface-300" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Edit Manually</p>
                  <p className="text-surface-400 text-xs mt-0.5">
                    Trim and adjust everything yourself with the timeline.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-white font-bold text-lg mb-1">Export Clip</h2>
            <p className="text-surface-500 text-sm mb-5">Choose format and render your clip with AI captions burned in.</p>

            <div className="space-y-3 mb-6">
              <p className="text-xs text-surface-500 uppercase tracking-wider">Aspect Ratio</p>
              {(["9:16", "16:9", "1:1"] as ExportAspect[]).map((ar) => {
                const labels: Record<string, string> = { "9:16": "TikTok / Reels / Shorts", "16:9": "YouTube / Twitch", "1:1": "Instagram Square" };
                return (
                  <label key={ar} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${exportAspect === ar ? "border-brand-500 bg-brand-900/30" : "border-surface-600 hover:border-surface-500"}`}>
                    <input type="radio" name="ar" value={ar} checked={exportAspect === ar} onChange={() => setExportAspect(ar)} className="accent-brand-500" />
                    <div>
                      <p className="text-white text-sm font-medium">{ar}</p>
                      <p className="text-surface-500 text-xs">{labels[ar]}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 py-2.5 border border-surface-600 text-surface-400 hover:text-white rounded-xl text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                Render & Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
