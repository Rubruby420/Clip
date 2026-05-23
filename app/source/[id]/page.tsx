"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft, Zap, Loader2, Film, AudioLines, Scissors, CheckCircle2,
} from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import WaveformTimeline from "@/components/editor/WaveformTimeline";
import { DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import { DEFAULT_CAPTION_CONFIG } from "@/lib/captions";
import { formatDuration } from "@/lib/utils";

interface WordTimestamp { word: string; start: number; end: number; }
interface SavedClip {
  id: string; title: string; startTime: number; endTime: number;
}
interface Transcription {
  text: string; words: WordTimestamp[]; duration: number;
}
interface ProjectSummary {
  id: string; title: string;
  originalUrl: string; proxyUrl: string | null;
  waveform: string | null; transcription: string | null;
  duration: number | null;
  clips: SavedClip[];
}

// Source-level editor. The whole project video plays in CanvasPreview;
// the user drags the waveform handles to scope a clip and saves it.
export default function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [videoSrc, setVideoSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasProxy, setHasProxy] = useState(false);
  const [generatingProxy, setGeneratingProxy] = useState(false);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [generatingWaveform, setGeneratingWaveform] = useState(false);

  const [words, setWords] = useState<WordTimestamp[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(0);

  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) { setLoading(false); return; }
      const { project: p } = await res.json() as { project: ProjectSummary };
      setProject(p);
      setVideoSrc(p.proxyUrl || p.originalUrl);
      setHasProxy(Boolean(p.proxyUrl));
      const dur = p.duration ?? 0;
      setDuration(dur);
      setInTime(0);
      setOutTime(dur);
      if (p.waveform) {
        try { setPeaks(JSON.parse(p.waveform)); } catch {}
      }
      if (p.transcription) {
        try {
          const t = JSON.parse(p.transcription) as Transcription;
          if (Array.isArray(t.words)) setWords(t.words);
        } catch {}
      }
      setLoading(false);
    })();
  }, [id]);

  async function handleGenerateProxy() {
    if (!project) return;
    setGeneratingProxy(true);
    try {
      const res = await fetch(`/api/projects/${id}/proxy`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.proxyUrl) {
        setVideoSrc(data.project.proxyUrl);
        setHasProxy(true);
      } else {
        alert(data.error || "Couldn't generate the preview.");
      }
    } catch {
      alert("Couldn't generate the preview.");
    }
    setGeneratingProxy(false);
  }

  async function handleGenerateWaveform() {
    setGeneratingWaveform(true);
    try {
      const res = await fetch(`/api/projects/${id}/waveform`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.waveform) {
        setPeaks(JSON.parse(data.project.waveform));
      } else {
        alert(data.error || "Couldn't generate the waveform.");
      }
    } catch {
      alert("Couldn't generate the waveform.");
    }
    setGeneratingWaveform(false);
  }

  async function handleSaveClip() {
    if (!project) return;
    if (outTime - inTime < 1) {
      alert("Selected segment is too short — drag the handles to widen it.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: inTime, endTime: outTime }),
      });
      const data = await res.json();
      if (res.ok && data.clip) {
        setProject((prev) => prev ? { ...prev, clips: [...prev.clips, data.clip] } : prev);
        setSavedToast(data.clip.title);
        // Tee up the next clip: in-point picks up where the last out-point left off.
        const newIn = outTime;
        setInTime(newIn);
        setOutTime(duration);
        setCurrentTime(newIn);
        setTimeout(() => setSavedToast(null), 2500);
      } else {
        alert(data.error || "Couldn't save the clip.");
      }
    } catch {
      alert("Couldn't save the clip — check your connection.");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center gap-4">
        <Film className="w-12 h-12 text-surface-500" />
        <p className="text-white">Project not found</p>
        <Link href="/" className="text-brand-400 hover:underline">Go home</Link>
      </div>
    );
  }

  const segmentDuration = Math.max(0, outTime - inTime);

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      <header className="border-b border-surface-600 px-4 py-3 flex items-center gap-3 shrink-0">
        <Link href={`/projects/${id}`} className="text-surface-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="text-white text-sm font-bold">Source</span>
        </div>
        <span className="text-surface-500 text-sm">/</span>
        <span className="text-white text-sm font-medium truncate max-w-[280px]">{project.title}</span>

        <div className="ml-auto flex items-center gap-2">
          {peaks.length === 0 && (
            <button
              onClick={handleGenerateWaveform}
              disabled={generatingWaveform}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-500 text-surface-200 hover:bg-surface-700 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
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
            >
              {generatingProxy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              {generatingProxy ? "Generating preview…" : "Smoother preview"}
            </button>
          )}
          <button
            onClick={handleSaveClip}
            disabled={saving || segmentDuration < 1}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-colors"
            title="Save the current in/out as a new clip"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
            Save as new clip ({formatDuration(segmentDuration)})
          </button>
        </div>
      </header>

      {savedToast && (
        <div className="shrink-0 px-4 py-2 bg-green-900/40 border-b border-green-800/60 flex items-center gap-2 text-xs text-green-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          Saved: <span className="text-white font-medium">{savedToast}</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-surface-600 bg-surface-800 shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-surface-700">
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">
              Clips in this project ({project.clips.length})
            </p>
            {project.clips.length === 0 ? (
              <p className="text-[11px] text-surface-600 leading-relaxed">
                Drag the waveform handles below to set in/out points,
                then click <span className="text-brand-300">Save as new clip</span>.
              </p>
            ) : (
              <div className="space-y-1.5">
                {project.clips.map((c) => (
                  <Link
                    key={c.id}
                    href={`/edit/${c.id}`}
                    className="block p-2 rounded-lg bg-surface-700/50 hover:bg-surface-700 transition-colors"
                  >
                    <p className="text-[11px] text-white truncate">{c.title}</p>
                    <p className="text-[10px] text-surface-500 tabular-nums">
                      {formatDuration(c.startTime)} – {formatDuration(c.endTime)}
                      <span className="text-surface-600"> · {formatDuration(c.endTime - c.startTime)}</span>
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto bg-surface-900">
          <div className="w-full max-w-xs">
            {videoSrc && duration > 0 ? (
              <CanvasPreview
                videoSrc={videoSrc}
                words={words}
                currentTime={currentTime}
                onTimeUpdate={(t) => setCurrentTime(t)}
                onLoadedMetadata={(d) => {
                  // Only adopt the metadata duration if the project didn't
                  // already report one — keeps the timeline width stable.
                  if (duration === 0) {
                    setDuration(d);
                    setOutTime(d);
                  }
                }}
                captionConfig={DEFAULT_CAPTION_CONFIG}
                captionsEnabled
                layout={DEFAULT_LAYOUT}
                startTime={0}
                endTime={duration}
              />
            ) : (
              <div className="aspect-[9/16] bg-surface-800 rounded-xl flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-surface-500" />
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-surface-600 text-center">
            Click the video to play · Drag the handles below to scope a clip
          </p>
        </main>
      </div>

      <div className="shrink-0">
        <WaveformTimeline
          peaks={peaks}
          duration={duration}
          startTime={inTime}
          endTime={outTime}
          currentTime={currentTime}
          onStartChange={setInTime}
          onEndChange={setOutTime}
          onSeek={(t) => setCurrentTime(t)}
        />
      </div>
    </div>
  );
}
