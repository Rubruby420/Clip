"use client";

import { useEffect, useState, use, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Zap, Download, Loader2,
  Film, Type, Layout, Sparkles, BookOpen, Gauge, Image as ImageIcon,
} from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import Timeline from "@/components/editor/Timeline";
import LayoutPanel, { type LayoutConfig, DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import ViralTipsPanel from "@/components/editor/ViralTipsPanel";
import CaptionPanel from "@/components/editor/CaptionPanel";
import StoryPanel from "@/components/editor/StoryPanel";
import CoachPanel from "@/components/editor/CoachPanel";
import ThumbnailPanel from "@/components/editor/ThumbnailPanel";
import UndoRedoButtons from "@/components/editor/UndoRedoButtons";
import TranscriptModal from "@/components/editor/TranscriptModal";
import PresetsPanel from "@/components/editor/PresetsPanel";
import { useDocumentHistory } from "@/components/editor/useDocumentHistory";
import { useUndoRedo, useUndoRedoShortcuts } from "@/lib/useUndoRedo";
import { DEFAULT_CAPTION_CONFIG, type CaptionConfig } from "@/lib/captions";
import { fileUrl, downloadUrl } from "@/lib/file-urls";

interface WordTimestamp { word: string; start: number; end: number; }
interface Clip {
  id: string; projectId: string; title: string;
  startTime: number; endTime: number; score: number | null;
  words: string; captionStyle: string; layoutConfig: string;
  exportUrl: string | null;
}

type Tab = "story" | "layout" | "captions" | "viral" | "coach" | "thumbnail";
type ExportAspect = "9:16" | "16:9" | "1:1";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const seekOnOpen = searchParams.get("t");
  const [clip, setClip] = useState<Clip | null>(null);
  const [loading, setLoading] = useState(true);

  const [videoSrc, setVideoSrc] = useState("");
  const [hasProxy, setHasProxy] = useState(false);
  const [generatingProxy, setGeneratingProxy] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [words, setWords] = useState<WordTimestamp[]>([]);

  const [activeTab, setActiveTab] = useState<Tab>("layout");
  const [layout, setLayout] = useState<LayoutConfig>(DEFAULT_LAYOUT);
  const [captionConfig, setCaptionConfig] = useState<CaptionConfig>(DEFAULT_CAPTION_CONFIG);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const [showTranscript, setShowTranscript] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportAspect, setExportAspect] = useState<ExportAspect>("9:16");
  const [showExportModal, setShowExportModal] = useState(false);
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [aiCutting, setAiCutting] = useState(false);
  const [aiCutReason, setAiCutReason] = useState<string | null>(null);
  const [remixApplied, setRemixApplied] = useState<{
    overlay: string; title: string; style: string;
  } | null>(null);

  // Preview-before-apply mode: while ON, AI Remix changes are reflected in
  // the canvas/preview only (NO DB write). The user can Save to commit or
  // Discard to revert from the snapshot.
  const [previewMode, setPreviewMode] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<{
    layout: LayoutConfig;
    captionStyle: string;
    captionsEnabled: boolean;
    title: string;
  } | null>(null);

  // Shared undo/redo command stack for this editor surface.
  const history = useUndoRedo();
  useUndoRedoShortcuts(history.undo, history.redo);

  // Load clip + project video
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/clips/${id}`);
      if (!res.ok) { setLoading(false); return; }
      const { clip: c } = await res.json();
      setClip(c);
      setStartTime(c.startTime);
      setEndTime(c.endTime);
      setCurrentTime(c.startTime);
      setWords(JSON.parse(c.words || "[]"));
      if (c.layoutConfig) {
        try { setLayout({ ...DEFAULT_LAYOUT, ...JSON.parse(c.layoutConfig) }); } catch {}
      }
      if (c.captionStyle) {
        try { setCaptionConfig((prev) => ({ ...prev, style: c.captionStyle })); } catch {}
      }
      if (c.exportUrl) setExportUrl(c.exportUrl);

      // Get project to get video URL. Prefer the 720p proxy when ready —
      // it keeps the editor preview smooth on 4K sources. The export route
      // still reads the original from disk so finals stay full-res.
      const projRes = await fetch(`/api/projects/${c.projectId}`);
      if (projRes.ok) {
        const { project } = await projRes.json();
        setVideoSrc(fileUrl(project.proxyUrl || project.originalUrl));
        setHasProxy(Boolean(project.proxyUrl));
        setProjectId(project.id);
        if (project.waveform) {
          try { setWaveformPeaks(JSON.parse(project.waveform)); } catch {}
        }
        if (project.duration) setVideoDuration(project.duration);
      }
      // If navigated from FlagPal with ?t=X, seek to that timestamp
      if (seekOnOpen) {
        const t = Number(seekOnOpen);
        if (!isNaN(t) && t >= 0) setCurrentTime(t);
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // While previewing a remix, hold all writes — the user hasn't confirmed
    // they want these changes yet. Save() resumes when they hit "Save changes".
    if (previewMode) return;
    const timer = setTimeout(() => {
      save({
        startTime,
        endTime,
        layoutConfig: JSON.stringify(layout),
        captionStyle: captionConfig.style,
        title: clip.title,
      });
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, endTime, layout, captionConfig.style, clip?.title, previewMode]);

  // Undo/redo over the editable document. Recording is gated until the clip
  // has loaded (so the initial load is free) and paused during a remix preview
  // (so the preview's transient changes aren't recorded — Save pushes one
  // explicit command for the whole remix instead).
  const applyDoc = useCallback((d: {
    startTime: number; endTime: number; layout: LayoutConfig;
    captionStyle: string; captionsEnabled: boolean; title: string;
  }) => {
    setStartTime(d.startTime);
    setEndTime(d.endTime);
    setCurrentTime(d.startTime);
    setLayout(d.layout);
    setCaptionConfig((prev) => ({ ...prev, style: d.captionStyle as CaptionConfig["style"] }));
    setCaptionsEnabled(d.captionsEnabled);
    setClip((prev) => (prev ? { ...prev, title: d.title } : prev));
  }, []);

  const docHistory = useDocumentHistory({
    doc: {
      startTime, endTime, layout,
      captionStyle: captionConfig.style,
      captionsEnabled,
      title: clip?.title ?? "",
    },
    applyDoc,
    enabled: !!clip && !previewMode,
    history,
  });

  async function handleSavePreview() {
    if (!clip) return;
    // Persist everything in one shot now that the user has confirmed.
    await fetch(`/api/clips/${clip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: clip.title,
        layoutConfig: JSON.stringify(layout),
        captionStyle: captionConfig.style,
      }),
    });

    // Record the whole remix as ONE undo step (before/after of the fields the
    // remix touches), so a single undo reverses the entire applied remix.
    const before = previewSnapshot;
    const after = {
      layout,
      captionStyle: captionConfig.style,
      captionsEnabled,
      title: clip.title,
    };
    if (before) {
      const restore = (s: { layout: LayoutConfig; captionStyle: string; captionsEnabled: boolean; title: string }) => {
        docHistory.suppress();
        setLayout(s.layout);
        setCaptionConfig((prev) => ({ ...prev, style: s.captionStyle as CaptionConfig["style"] }));
        setCaptionsEnabled(s.captionsEnabled);
        setClip((prev) => (prev ? { ...prev, title: s.title } : prev));
      };
      history.push({
        label: "remix",
        undo: () => restore(before),
        redo: () => restore(after),
      });
    }

    setPreviewMode(false);
    setPreviewSnapshot(null);
    setRemixApplied({
      overlay: layout.overlayText,
      title: clip.title,
      style: captionConfig.style,
    });
  }

  function handleDiscardPreview() {
    if (!previewSnapshot) {
      setPreviewMode(false);
      return;
    }
    setLayout(previewSnapshot.layout);
    setCaptionConfig((prev) => ({ ...prev, style: previewSnapshot.captionStyle as typeof prev.style }));
    setCaptionsEnabled(previewSnapshot.captionsEnabled);
    setClip((prev) => (prev ? { ...prev, title: previewSnapshot.title } : prev));
    setPreviewSnapshot(null);
    setPreviewMode(false);
  }

  async function handleExport() {
    setExporting(true);
    setExportProgress(0);
    setShowExportModal(false);
    setExportError(null);
    try {
      const res = await fetch(`/api/export/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aspectRatio: exportAspect,
          blurBackground: layout.bgType === "blur",
        }),
      });
      if (!res.body) {
        setExportError("Export failed — no response body.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (typeof evt.pct === "number") setExportProgress(evt.pct);
            if (evt.done) {
              setExportProgress(100);
              setExportUrl(evt.exportUrl as string);
              setShowExportSuccess(true);
            }
            if (evt.error) setExportError(evt.error as string);
          } catch {}
        }
      }
    } catch (err) {
      setExportError(String(err));
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }

  // Same-origin /api/files route with ?download=<name> sets
  // Content-Disposition: attachment, so the browser saves the file.
  function handleDownload() {
    if (!exportUrl || !clip) return;
    const a = document.createElement("a");
    a.href = downloadUrl(exportUrl, `${clip.title}.mp4`);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleDeleteClip() {
    if (!clip) return;
    if (!window.confirm("Delete this clip? This cannot be undone.")) return;
    await fetch(`/api/clips/${id}`, { method: "DELETE" });
    router.push(`/projects/${clip.projectId}`);
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
        setCurrentTime(data.startTime);
        setAiCutReason(data.reason || "AI trimmed this clip to its best moment.");
      } else {
        alert(data.error || "AI auto-cut failed");
      }
    } catch {
      alert("AI auto-cut failed — check your connection and try again.");
    }
    setAiCutting(false);
  }

  // Generate the 720p preview proxy for an older project on demand. New
  // uploads get one automatically during the process pipeline.
  async function handleGenerateProxy() {
    if (!clip) return;
    setGeneratingProxy(true);
    try {
      const res = await fetch(`/api/projects/${clip.projectId}/proxy`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.proxyUrl) {
        setVideoSrc(fileUrl(data.project.proxyUrl));
        setHasProxy(true);
      } else {
        alert(data.error || "Couldn't generate the preview. Falling back to the original.");
      }
    } catch {
      alert("Couldn't generate the preview — check your connection.");
    }
    setGeneratingProxy(false);
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
    story: <BookOpen className="w-4 h-4" />,
    layout: <Layout className="w-4 h-4" />,
    captions: <Type className="w-4 h-4" />,
    viral: <Sparkles className="w-4 h-4" />,
    coach: <Gauge className="w-4 h-4" />,
    thumbnail: <ImageIcon className="w-4 h-4" />,
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
          <UndoRedoButtons
            undo={history.undo}
            redo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            undoLabel={history.undoLabel}
            redoLabel={history.redoLabel}
          />
          <PresetsPanel
            layout={layout}
            captionConfig={captionConfig}
            captionsEnabled={captionsEnabled}
            onApply={(p) => {
              setLayout(p.layout);
              setCaptionConfig(p.captionConfig);
              setCaptionsEnabled(p.captionsEnabled);
            }}
          />
          {!hasProxy && clip && (
            <button
              onClick={handleGenerateProxy}
              disabled={generatingProxy}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-yellow-600 text-yellow-300 hover:bg-yellow-900/30 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
              title="Generate a 720p preview for smoother playback (export still uses the original full-res video)"
            >
              {generatingProxy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {generatingProxy ? "Generating preview…" : "Smoother preview"}
            </button>
          )}
          <button
            onClick={handleAiCut}
            disabled={aiCutting}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-600 text-brand-300 hover:bg-brand-900/40 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
            title="Let AI re-trim this clip to its best moment"
          >
            {aiCutting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI Cut
          </button>
          {/* Keyboard shortcuts hint */}
          <div className="group relative">
            <button className="w-6 h-6 rounded-full border border-surface-600 text-surface-500 hover:text-white hover:border-surface-400 text-xs font-bold transition-colors flex items-center justify-center">
              ?
            </button>
            <div className="pointer-events-none absolute right-0 top-full mt-2 w-44 bg-surface-800 border border-surface-600 rounded-xl p-3 z-50 opacity-0 group-hover:opacity-100 transition-opacity shadow-xl">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider mb-2 font-semibold">Shortcuts</p>
              {[
                ["Space / K", "Play / pause"],
                ["J / L", "−5s / +5s"],
                ["← →", "±1s"],
                ["Shift ← →", "±0.1s"],
                ["I", "Set in-point"],
                ["O", "Set out-point"],
                ["E", "Export"],
              ].map(([key, label]) => (
                <div key={key} className="flex justify-between items-center py-0.5">
                  <kbd className="text-[10px] bg-surface-700 text-surface-300 px-1.5 py-0.5 rounded font-mono">{key}</kbd>
                  <span className="text-[10px] text-surface-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
          {words.length > 0 && (
            <a
              href={`/api/clips/${id}/srt`}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-600 text-surface-400 hover:text-white hover:border-surface-500 text-xs rounded-lg font-medium transition-colors"
              title="Download subtitle file (.srt) to upload alongside the video on YouTube"
            >
              .srt
            </a>
          )}
          {exportUrl && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          )}
          <button
            onClick={() => setShowExportModal(true)}
            disabled={exporting || !videoSrc}
            className="relative flex items-center gap-1.5 px-4 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-colors overflow-hidden"
          >
            {/* Progress fill behind the label */}
            {exporting && exportProgress !== null && (
              <span
                className="absolute inset-0 bg-brand-500/60 origin-left transition-[width] duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting
                ? exportProgress !== null && exportProgress > 0
                  ? `Exporting… ${exportProgress}%`
                  : "Exporting…"
                : "Export"}
            </span>
          </button>
        </div>
      </header>

      {/* Main editor layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — tabs */}
        <aside className="w-64 border-r border-surface-600 bg-surface-800 flex flex-col overflow-y-auto shrink-0">
          {/* Tab switcher */}
          <div className="flex border-b border-surface-600">
            {(["story", "layout", "captions", "viral", "coach", "thumbnail"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors capitalize ${
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
            <LayoutPanel
              config={layout}
              onChange={setLayout}
              onLogoUpload={async (file) => {
                if (!projectId) return;
                const fd = new FormData();
                fd.append("logo", file);
                const res = await fetch(`/api/projects/${projectId}/logo`, { method: "POST", body: fd });
                if (res.ok) {
                  const { logoUrl } = await res.json();
                  setLayout((prev) => ({ ...prev, logoUrl }));
                }
              }}
            />
          )}
          {activeTab === "captions" && (
            <CaptionPanel
              config={captionConfig}
              onChange={setCaptionConfig}
              enabled={captionsEnabled}
              onEnabledChange={setCaptionsEnabled}
              onViewTranscript={words.length > 0 ? () => setShowTranscript(true) : undefined}
            />
          )}
          {activeTab === "story" && (
            <StoryPanel
              clipId={clip.id}
              onApplyRecut={(start, end, reason) => {
                setStartTime(start);
                setEndTime(end);
                setCurrentTime(start);
                setAiCutReason(reason);
              }}
            />
          )}
          {activeTab === "viral" && <ViralTipsPanel clipId={clip.id} />}
          {activeTab === "coach" && <CoachPanel clipId={clip.id} />}
          {activeTab === "thumbnail" && (
            <ThumbnailPanel clipId={clip.id} clipTitle={clip.title} />
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
                onSetIn={() => setStartTime(currentTime)}
                onSetOut={() => setEndTime(currentTime)}
                onExport={() => { if (!exporting) setShowExportModal(true); }}
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

      {/* Preview-mode bar — the user is reviewing AI's planned changes.
          Nothing has been saved yet; Save commits, Discard reverts. */}
      {previewMode && (
        <div className="shrink-0 px-4 py-3 bg-gradient-to-r from-yellow-900/60 to-amber-900/60 border-t-2 border-yellow-500 flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-yellow-300 shrink-0" />
          <div className="flex-1 text-xs text-yellow-100 leading-relaxed">
            <span className="font-bold">Previewing AI remix.</span>{" "}
            Hook overlay, title, and caption style are showing on the preview but{" "}
            <span className="font-semibold">not yet saved.</span> Click Save to commit, or Discard to revert.
          </div>
          <button
            onClick={handleDiscardPreview}
            className="px-3 py-1.5 border border-surface-500 text-surface-200 hover:text-white hover:border-white text-xs rounded-lg font-medium transition-colors"
          >
            Discard
          </button>
          <button
            onClick={handleSavePreview}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg font-semibold transition-colors"
          >
            Save changes
          </button>
        </div>
      )}

      {/* Viral Remix apply confirmation — proves the apply actually changed
          the clip, with the concrete diff right there. */}
      {remixApplied && (remixApplied.overlay || remixApplied.title || remixApplied.style) && (
        <div className="shrink-0 px-4 py-2 bg-green-900/30 border-t border-green-800/50 flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-green-200 leading-relaxed">
            <span className="font-semibold">Remix applied to your clip:</span>{" "}
            {remixApplied.overlay && (
              <>hook overlay &ldquo;<span className="font-mono">{remixApplied.overlay}</span>&rdquo; burned onto the first {layout.overlayDuration}s · </>
            )}
            {remixApplied.title && <>title set to &ldquo;<span className="italic">{remixApplied.title}</span>&rdquo; · </>}
            {remixApplied.style && <>caption style: <span className="font-medium capitalize">{remixApplied.style.replace("-", " ")}</span></>}
          </div>
          <button
            onClick={() => setRemixApplied(null)}
            className="text-surface-500 hover:text-white text-sm leading-none"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* Persistent music chip — visible whenever a music track is set. */}
      {layout.musicUrl && !remixApplied && (
        <div className="shrink-0 px-4 py-1.5 bg-surface-800/80 border-t border-surface-700 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            role="switch"
            aria-checked={layout.musicEnabled !== false}
            onClick={() => setLayout((prev) => ({ ...prev, musicEnabled: prev.musicEnabled === false }))}
            className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${
              layout.musicEnabled !== false ? "bg-brand-500" : "bg-surface-600"
            }`}
            title={layout.musicEnabled !== false ? "Music on" : "Music off"}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                layout.musicEnabled !== false ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-brand-400 shrink-0">♪</span>
          <span className="text-surface-400">Music:</span>
          <span className={`truncate flex-1 ${layout.musicEnabled !== false ? "text-white" : "text-surface-500"}`}>
            {layout.musicTitle} <span className="text-surface-500">by {layout.musicArtist}</span>
          </span>
          <span className="text-surface-500 text-[10px]">Vol</span>
          <input
            type="range" min={0} max={1} step={0.05} value={layout.musicVolume}
            disabled={layout.musicEnabled === false}
            onChange={(e) => setLayout((prev) => ({ ...prev, musicVolume: parseFloat(e.target.value) }))}
            className="w-16 accent-brand-500 disabled:opacity-40"
          />
          <span className="text-surface-400 tabular-nums w-7 text-right">{Math.round(layout.musicVolume * 100)}%</span>
          <button
            onClick={() => setLayout((prev) => ({ ...prev, musicUrl: "", musicTitle: "", musicArtist: "" }))}
            className="text-surface-500 hover:text-red-400 transition-colors"
            title="Remove music"
          >
            ✕
          </button>
        </div>
      )}

      {/* Persistent hook-overlay chip — visible whenever an overlay is set,
          so you know the burned-in text is there even when the playhead has
          moved past the overlay window. */}
      {layout.overlayText && !remixApplied && (
        <div className="shrink-0 px-4 py-1.5 bg-surface-800/80 border-t border-surface-700 flex items-center gap-2 text-[11px]">
          <Sparkles className="w-3 h-3 text-brand-400 shrink-0" />
          <span className="text-surface-400">Hook overlay:</span>
          <span className="text-white font-mono truncate flex-1">{layout.overlayText}</span>
          <span className="text-surface-500">{layout.overlayDuration}s</span>
          <button
            onClick={() => setLayout((prev) => ({ ...prev, overlayText: "" }))}
            className="text-surface-500 hover:text-red-400 transition-colors"
            title="Remove overlay"
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
            peaks={waveformPeaks.length > 0 ? waveformPeaks : undefined}
            videoDuration={videoDuration > 0 ? videoDuration : undefined}
          />
        </div>
      )}

      {/* Transcript modal */}
      {showTranscript && (
        <TranscriptModal
          words={words}
          clipStart={startTime}
          onSeek={(t) => { setCurrentTime(t); setShowTranscript(false); }}
          onClose={() => setShowTranscript(false)}
        />
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

      {/* Export success — prominent download CTA so the user can't miss it */}
      {showExportSuccess && exportUrl && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 border border-green-700/60 rounded-2xl p-6 w-full max-w-sm text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-green-700/30 border border-green-600 flex items-center justify-center">
              <Download className="w-7 h-7 text-green-400" />
            </div>
            <h2 className="text-white font-bold text-lg mb-1">Your clip is ready</h2>
            <p className="text-surface-400 text-sm mb-5">
              Rendered with captions burned in. Save it to your device below.
            </p>
            <button
              onClick={handleDownload}
              className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 mb-2"
            >
              <Download className="w-4 h-4" /> Download to my device
            </button>
            {words.length > 0 && (
              <a
                href={`/api/clips/${id}/srt`}
                download
                className="w-full py-2.5 border border-surface-600 hover:border-surface-500 text-surface-400 hover:text-white rounded-xl text-sm transition-colors flex items-center justify-center gap-2 mb-2"
              >
                <Download className="w-3.5 h-3.5" /> Download .srt subtitles
              </a>
            )}
            <button
              onClick={() => setShowExportSuccess(false)}
              className="w-full py-2 text-surface-500 hover:text-white text-xs transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleDeleteClip}
              className="w-full py-2 text-red-500 hover:text-red-400 text-xs transition-colors"
            >
              Delete this clip
            </button>
          </div>
        </div>
      )}

      {/* Export error */}
      {exportError && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 border border-red-700/60 rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-white font-bold text-lg mb-1">Export failed</h2>
            <p className="text-surface-400 text-sm mb-4 break-words">{exportError}</p>
            <button
              onClick={() => setExportError(null)}
              className="w-full py-2.5 bg-surface-700 hover:bg-surface-600 text-white rounded-xl text-sm transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
