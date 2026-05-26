"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Zap, Loader2, Film, AudioLines, Scissors, CheckCircle2, Sparkles, X,
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
  const router = useRouter();
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
  // After a save we surface a modal asking "make more clips?" — null means
  // no modal, otherwise it holds the clip we just saved (used in the copy
  // and to compute the "continue from here" in-point).
  const [justSaved, setJustSaved] = useState<SavedClip | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // When the proxy lands after the user has already been served the
  // originalUrl, we DON'T auto-swap mid-watch — swapping src remounts
  // the <video> element and resets playback. Instead we stash the
  // proxy URL here and offer an explicit "Use smoother playback"
  // upgrade button in the status banner.
  const [pendingProxyUrl, setPendingProxyUrl] = useState<string | null>(null);

  // Apply a fresh project payload to local state. Hoisted so the initial
  // load and the prep-poll loop both reuse it.
  //
  // IMPORTANT: this runs on every poll tick, so it MUST be idempotent — never
  // re-set fields that are already populated locally. Re-setting `videoSrc`
  // remounts the <video> element (kills playback + re-buffers the proxy);
  // re-setting `peaks` re-parses a large JSON array on every tick and makes
  // the timeline flicker. Local state wins once a field is populated.
  function applyProject(p: ProjectSummary) {
    setProject(p);
    // First load adopts whatever's best. After that we never auto-swap
    // — swapping src remounts <video> and resets playback. A proxy
    // upgrade is offered via pendingProxyUrl + an explicit upgrade button.
    setVideoSrc((prev) => prev || p.proxyUrl || p.originalUrl);
    // If the proxy just landed but we're still on the originalUrl,
    // surface it as a pending upgrade. Cleared once we adopt it.
    if (p.proxyUrl) {
      setPendingProxyUrl((prev) => prev ?? p.proxyUrl);
    }
    setHasProxy((prev) => prev || Boolean(p.proxyUrl));
    const dur = p.duration ?? 0;
    if (dur > 0) {
      setDuration((prev) => (prev === 0 ? dur : prev));
      setOutTime((prev) => (prev === 0 ? dur : prev));
    }
    if (p.waveform) {
      setPeaks((prev) => {
        if (prev.length > 0) return prev;
        try { return JSON.parse(p.waveform!); } catch { return prev; }
      });
    }
    if (p.transcription) {
      setWords((prev) => {
        if (prev.length > 0) return prev;
        try {
          const t = JSON.parse(p.transcription!) as Transcription;
          return Array.isArray(t.words) ? t.words : prev;
        } catch { return prev; }
      });
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) { setLoading(false); return; }
      const { project: p } = await res.json() as { project: ProjectSummary };
      applyProject(p);
      setInTime(0);
      setOutTime(p.duration ?? 0);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Poll for light-prep readiness. Manual mode kicks off /api/process in
  // the background after upload; this page might load before proxy +
  // waveform exist. Re-fetch every 3s until both are present, capped at
  // ~3 min so a broken pipeline doesn't hammer the route forever.
  //
  // Paused while a manual generate button is in flight — the proxy POST
  // takes ~3 min on a long Source and the poll would otherwise race the
  // button's own state writes, causing a flicker and (when applyProject
  // was non-idempotent) restarting video playback.
  //
  // When the poll caps out without finishing, `pollExhausted` flips on
  // and the UI surfaces manual generate buttons + a friendlier "auto
  // prep didn't finish" banner instead of leaving the user staring at
  // a perpetually-spinning loader.
  const [pollExhausted, setPollExhausted] = useState(false);
  const pollAttempts = useRef(0);
  useEffect(() => {
    if (hasProxy && peaks.length > 0) return;
    if (generatingProxy || generatingWaveform) return;
    pollAttempts.current = 0;
    setPollExhausted(false);
    const interval = setInterval(async () => {
      pollAttempts.current += 1;
      if (pollAttempts.current > 60) {
        clearInterval(interval);
        setPollExhausted(true);
        return;
      }
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) return;
        const { project: p } = await res.json() as { project: ProjectSummary };
        applyProject(p);
        if (p.proxyUrl && p.waveform) clearInterval(interval);
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hasProxy, peaks.length, generatingProxy, generatingWaveform]);

  async function handleGenerateProxy() {
    if (!project) return;
    setGeneratingProxy(true);
    try {
      const res = await fetch(`/api/projects/${id}/proxy`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.proxyUrl) {
        // User explicitly asked for the smoother preview — swap now and
        // accept the playback reset. They clicked the button knowing what
        // they were getting.
        setVideoSrc(data.project.proxyUrl);
        setHasProxy(true);
        setPendingProxyUrl(null);
      } else {
        alert(data.error || "Couldn't generate the preview.");
      }
    } catch {
      alert("Couldn't generate the preview.");
    }
    setGeneratingProxy(false);
  }

  // Adopt the proxy that landed in the background. Distinct from the
  // manual handler because no FFmpeg call is in flight — we just swap
  // the src. Playback reset is documented to the user via the upgrade
  // banner so they're not surprised.
  function handleAdoptProxy() {
    if (!pendingProxyUrl) return;
    setVideoSrc(pendingProxyUrl);
    setHasProxy(true);
    setPendingProxyUrl(null);
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
        // Show the "make more clips?" modal — the user picks reset vs
        // continue vs finalize from there. We do NOT auto-advance the in
        // point any more so the modal owns the next-step decision.
        setJustSaved(data.clip);
      } else {
        alert(data.error || "Couldn't save the clip.");
      }
    } catch {
      alert("Couldn't save the clip — check your connection.");
    }
    setSaving(false);
  }

  // Modal: Yes — find another. Reset selection to span the whole source
  // so the user can scrub freely for their next moment.
  function handleFindAnother() {
    setInTime(0);
    setOutTime(duration);
    setCurrentTime(0);
    setJustSaved(null);
  }

  // Modal: Yes — continue from here. Pick up where the last clip ended
  // (the previous behaviour, just now explicit).
  function handleContinueFromHere() {
    if (!justSaved) return;
    const next = justSaved.endTime;
    setInTime(next);
    setOutTime(duration);
    setCurrentTime(next);
    setJustSaved(null);
  }

  // Modal: No — done. Kick off Coach scoring on every saved clip and head
  // back to the project page where scores + thumbnails fill in as Coach
  // finishes each one.
  async function handleFinalize() {
    setFinalizing(true);
    try {
      await fetch(`/api/projects/${id}/finalize`, { method: "POST" });
    } catch {
      // Non-fatal — even if the kickoff fails the clips are already saved.
    }
    router.push(`/projects/${id}`);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-12 h-12 rounded-2xl bg-brand-600/20 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
          </div>
          <div>
            <p className="text-white text-base font-semibold">Loading source…</p>
            <p className="text-surface-500 text-sm mt-1">
              Fetching your video and any prep work that&apos;s already done.
            </p>
          </div>
        </div>
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
          {/* Manual generate buttons appear only when the background poll
              has given up or the user is mid-generate — keeps the header
              calm during the normal happy path where prep finishes on
              its own. */}
          {peaks.length === 0 && (generatingWaveform || pollExhausted) && (
            <button
              onClick={handleGenerateWaveform}
              disabled={generatingWaveform}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-surface-500 text-surface-200 hover:bg-surface-700 disabled:opacity-50 text-xs rounded-lg font-medium transition-colors"
            >
              {generatingWaveform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AudioLines className="w-3.5 h-3.5" />}
              {generatingWaveform ? "Generating waveform…" : "Generate waveform"}
            </button>
          )}
          {!hasProxy && (generatingProxy || pollExhausted) && (
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

      {project && pendingProxyUrl && videoSrc !== pendingProxyUrl && (
        <div className="shrink-0 px-4 py-2 bg-green-900/30 border-b border-green-800/60 flex items-center gap-2 text-xs text-green-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          <span className="flex-1">
            Smoother 720p preview is ready. Switching will jump playback back to the start — pause first if you want to keep your spot.
          </span>
          <button
            onClick={handleAdoptProxy}
            className="px-2.5 py-1 rounded-md bg-green-600 hover:bg-green-500 text-white text-[11px] font-semibold transition-colors"
          >
            Use smoother playback
          </button>
        </div>
      )}

      {project && (peaks.length === 0 || !hasProxy) && !pollExhausted && (
        <div className="shrink-0 px-4 py-2 bg-yellow-900/20 border-b border-yellow-800/40 flex items-center gap-2 text-xs text-yellow-200">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-400 shrink-0" />
          <span className="flex-1">
            {peaks.length === 0 && !hasProxy && (
              <>Preparing your source — the timeline waveform and a smoother 720p preview are rendering in the background. You can start scrubbing now.</>
            )}
            {peaks.length === 0 && hasProxy && (
              <>Building the timeline waveform — usually under a minute. The editor will fill it in automatically.</>
            )}
            {peaks.length > 0 && !hasProxy && (
              <>A smoother 720p preview is rendering in the background (2-3 min for an hour-long video). The original is fine to scrub in the meantime.</>
            )}
          </span>
        </div>
      )}

      {project && (peaks.length === 0 || !hasProxy) && pollExhausted && (
        <div className="shrink-0 px-4 py-2 bg-orange-900/30 border-b border-orange-800/60 flex items-center gap-2 text-xs text-orange-200">
          <span className="flex-1">
            Auto-prep didn&apos;t finish on its own. Use the
            {peaks.length === 0 ? " “Generate waveform”" : ""}
            {peaks.length === 0 && !hasProxy ? " and " : ""}
            {!hasProxy ? " “Smoother preview”" : ""} button{peaks.length === 0 && !hasProxy ? "s" : ""} in the header to run it manually.
          </span>
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
              <div className="aspect-[9/16] bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3 px-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
                <p className="text-xs text-surface-400 leading-relaxed">
                  Loading the video player…
                </p>
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

      {justSaved && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl">
            <div className="p-5 border-b border-surface-700 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">Saved &ldquo;{justSaved.title}&rdquo;</p>
                <p className="text-surface-400 text-xs mt-0.5 tabular-nums">
                  {formatDuration(justSaved.startTime)} – {formatDuration(justSaved.endTime)}
                  <span className="text-surface-600"> · {formatDuration(justSaved.endTime - justSaved.startTime)}</span>
                </p>
              </div>
              <button
                onClick={() => setJustSaved(null)}
                className="text-surface-500 hover:text-white transition-colors p-1 rounded"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-white text-base font-semibold">Make more clips?</p>
              <button
                onClick={handleFindAnother}
                disabled={finalizing}
                className="w-full text-left px-4 py-3 rounded-xl bg-surface-700 hover:bg-surface-600 border border-surface-600 hover:border-brand-600 transition-colors disabled:opacity-50 flex items-center gap-3"
              >
                <Scissors className="w-4 h-4 text-brand-300 shrink-0" />
                <div>
                  <p className="text-white text-sm font-medium">Yes — find another</p>
                  <p className="text-surface-400 text-[11px]">Reset the timeline so I can scrub for the next moment.</p>
                </div>
              </button>
              <button
                onClick={handleContinueFromHere}
                disabled={finalizing}
                className="w-full text-left px-4 py-3 rounded-xl bg-surface-700 hover:bg-surface-600 border border-surface-600 hover:border-brand-600 transition-colors disabled:opacity-50 flex items-center gap-3"
              >
                <Film className="w-4 h-4 text-brand-300 shrink-0" />
                <div>
                  <p className="text-white text-sm font-medium">Yes — continue from here</p>
                  <p className="text-surface-400 text-[11px]">Keep playing from where this clip ended.</p>
                </div>
              </button>
              <button
                onClick={handleFinalize}
                disabled={finalizing}
                className="w-full text-left px-4 py-3 rounded-xl bg-brand-900/40 hover:bg-brand-900/60 border border-brand-700 hover:border-brand-500 transition-colors disabled:opacity-50 flex items-center gap-3"
              >
                {finalizing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-brand-300 shrink-0" />
                ) : (
                  <Sparkles className="w-4 h-4 text-brand-300 shrink-0" />
                )}
                <div>
                  <p className="text-white text-sm font-medium">
                    {finalizing ? "Starting Coach…" : "No — finalize & let AI score them"}
                  </p>
                  <p className="text-surface-400 text-[11px]">
                    Coach grades each saved clip. You can always come back to make more.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
