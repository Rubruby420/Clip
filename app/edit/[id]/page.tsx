"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Zap, Sparkles, Loader2, Film, AudioLines } from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import WaveformTimeline from "@/components/editor/WaveformTimeline";
import { type LayoutConfig, DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import { DEFAULT_CAPTION_CONFIG, type CaptionConfig } from "@/lib/captions";
import { fileUrl } from "@/lib/storage";

interface WordTimestamp { word: string; start: number; end: number; }
interface Clip {
  id: string; projectId: string; title: string;
  startTime: number; endTime: number;
  words: string; captionStyle: string; layoutConfig: string;
}

// New dedicated AI video editor — scaffolding. Reuses the existing data
// model + CanvasPreview/Timeline; the side panels and beyond are TBD.
export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [clip, setClip] = useState<Clip | null>(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [hasProxy, setHasProxy] = useState(false);
  const [generatingProxy, setGeneratingProxy] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [generatingWaveform, setGeneratingWaveform] = useState(false);
  const [loading, setLoading] = useState(true);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(60);
  const [words, setWords] = useState<WordTimestamp[]>([]);
  const [layout, setLayout] = useState<LayoutConfig>(DEFAULT_LAYOUT);
  const [captionConfig] = useState<CaptionConfig>(DEFAULT_CAPTION_CONFIG);

  const [aiCutting, setAiCutting] = useState(false);

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

      const projRes = await fetch(`/api/projects/${c.projectId}`);
      if (projRes.ok) {
        const { project } = await projRes.json();
        setVideoSrc(fileUrl(project.proxyUrl || project.originalUrl));
        setHasProxy(Boolean(project.proxyUrl));
        if (project.waveform) {
          try { setPeaks(JSON.parse(project.waveform)); } catch {}
        }
      }
      setLoading(false);
    })();
  }, [id]);

  async function handleAiCut() {
    setAiCutting(true);
    try {
      const res = await fetch(`/api/clips/${id}/autocut`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setStartTime(data.startTime);
        setEndTime(data.endTime);
        setCurrentTime(data.startTime);
      } else {
        alert(data.error || "AI auto-cut failed");
      }
    } catch {
      alert("AI auto-cut failed — check your connection.");
    }
    setAiCutting(false);
  }

  async function handleGenerateWaveform() {
    if (!clip) return;
    setGeneratingWaveform(true);
    try {
      const res = await fetch(`/api/projects/${clip.projectId}/waveform`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.waveform) {
        setPeaks(JSON.parse(data.project.waveform));
      } else {
        alert(data.error || "Couldn't generate the waveform.");
      }
    } catch {
      alert("Couldn't generate the waveform — check your connection.");
    }
    setGeneratingWaveform(false);
  }

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
        alert(data.error || "Couldn't generate the preview.");
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

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      <header className="border-b border-surface-600 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href={`/projects/${clip.projectId}`} className="text-surface-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-white text-sm font-bold">Edit</span>
          <span className="text-[10px] uppercase tracking-wider text-brand-400 border border-brand-700 rounded px-1.5 py-0.5">beta</span>
        </div>
        <span className="text-surface-500 text-sm">/</span>
        <span className="text-white text-sm font-medium truncate max-w-[280px]">{clip.title}</span>

        <div className="ml-auto flex items-center gap-2">
          {peaks.length === 0 && (
            <button
              onClick={handleGenerateWaveform}
              disabled={generatingWaveform}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-500 text-surface-200 hover:bg-surface-700 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
              title="Build the audio waveform for the timeline"
            >
              {generatingWaveform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5" />}
              {generatingWaveform ? "Generating waveform…" : "Generate waveform"}
            </button>
          )}
          {!hasProxy && (
            <button
              onClick={handleGenerateProxy}
              disabled={generatingProxy}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-yellow-600 text-yellow-300 hover:bg-yellow-900/30 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
              title="Generate a 720p preview for smoother playback"
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
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — reserved for future panels (multi-track, effects, etc.) */}
        <aside className="w-64 border-r border-surface-600 bg-surface-800 shrink-0 p-4 text-xs text-surface-500">
          Side panels coming next. For now the new editor is just the preview + trim.
        </aside>

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
                captionsEnabled
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
          <p className="mt-3 text-xs text-surface-600 text-center">Click the video to play · Trim with the sliders below</p>
        </main>
      </div>

      <div className="shrink-0">
        <WaveformTimeline
          peaks={peaks}
          duration={duration}
          startTime={startTime}
          endTime={endTime}
          currentTime={currentTime}
          onStartChange={setStartTime}
          onEndChange={setEndTime}
          onSeek={(t) => setCurrentTime(t)}
        />
      </div>
    </div>
  );
}
