"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Zap, Loader2, Film, AudioLines, Scissors, CheckCircle2, Sparkles, X,
} from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import WaveformTimeline from "@/components/editor/WaveformTimeline";
import UndoRedoButtons from "@/components/editor/UndoRedoButtons";
import { DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import { DEFAULT_CAPTION_CONFIG } from "@/lib/captions";
import { formatDuration } from "@/lib/utils";
import { detectTalkSegments } from "@/lib/silence";
import { fileUrl } from "@/lib/file-urls";
import { useUndoRedo, useUndoRedoShortcuts } from "@/lib/useUndoRedo";

interface WordTimestamp { word: string; start: number; end: number; }
interface SavedClip {
  id: string; title: string; startTime: number; endTime: number;
  muted: boolean;
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

  // Auto-cut state.
  //  - autoCutRan: guards against re-running when the user manually
  //    deletes all the auto clips (we honour their reset by not
  //    repopulating).
  //  - autoCutting: in flight, blocks duplicate runs and shows a banner.
  //  - autoCutIds: the clip IDs created by the most recent auto-cut so
  //    Undo can wipe just those (not any clips the user added later).
  const [autoCutRan, setAutoCutRan] = useState(false);
  const [autoCutting, setAutoCutting] = useState(false);
  const [autoCutIds, setAutoCutIds] = useState<string[]>([]);
  const [autoCutError, setAutoCutError] = useState<string | null>(null);

  // Undo/redo. Every action on this surface writes to the DB immediately, so
  // each command's undo fires a *reversing* server request (delete a created
  // clip, PATCH a mute back, re-merge a split). Commands that recreate a clip
  // get a new id from the server, so they track the live id in their closure
  // and remap it on each redo. Auto-cut is intentionally NOT on the stack — it
  // is an automatic import step with its own dedicated "Undo auto-cut" button.
  const history = useUndoRedo();
  useUndoRedoShortcuts(history.undo, history.redo);
  const byStart = (a: SavedClip, b: SavedClip) => a.startTime - b.startTime;

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
    setVideoSrc((prev) => prev || fileUrl(p.proxyUrl || p.originalUrl));
    // If the proxy just landed but we're still on the originalUrl,
    // surface it as a pending upgrade. Cleared once we adopt it.
    if (p.proxyUrl) {
      setPendingProxyUrl((prev) => prev ?? fileUrl(p.proxyUrl));
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

  // Time-based estimated progress for the prep banner. FFmpeg progress
  // isn't piped through the API, so this is a budgeted estimate (linear
  // to 90% across the expected duration, then a slow creep toward 95%).
  // The bar disappears the moment prep finishes — it's only a "things
  // are moving" signal, not a measurement.
  const prepPending = peaks.length === 0 || !hasProxy;
  const prepStartedAt = useRef<number | null>(null);
  const [prepProgress, setPrepProgress] = useState(0);
  useEffect(() => {
    if (!prepPending) {
      prepStartedAt.current = null;
      setPrepProgress(0);
      return;
    }
    if (prepStartedAt.current === null) prepStartedAt.current = Date.now();
    const tick = () => {
      if (prepStartedAt.current === null) return;
      const elapsed = (Date.now() - prepStartedAt.current) / 1000;
      // Waveform ~45s flat. Proxy ~5% of source duration, floor 90s.
      const waveformBudget = peaks.length === 0 ? 45 : 0;
      const proxyBudget = !hasProxy ? Math.max(90, (duration || 600) * 0.05) : 0;
      const totalBudget = Math.max(20, waveformBudget + proxyBudget);
      const ratio = elapsed / totalBudget;
      const pct = ratio < 1
        ? ratio * 90
        : Math.min(95, 90 + (ratio - 1) * 5);
      setPrepProgress(pct);
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [prepPending, peaks.length, hasProxy, duration]);
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

  // Auto-cut on first load. Fires once peaks + duration are ready, the
  // project has zero saved clips, and we haven't already attempted this.
  // Creates one clip per talking segment via the same POST /clips route
  // the manual Save button uses — keeps clip creation single-pathed.
  useEffect(() => {
    if (!project) return;
    if (autoCutRan || autoCutting) return;
    if (peaks.length === 0 || duration <= 0) return;
    if (project.clips.length > 0) {
      // Project already has clips — don't auto-cut over them. Mark as
      // ran so a future deletion doesn't trigger this either.
      setAutoCutRan(true);
      return;
    }

    const segments = detectTalkSegments(peaks, duration);
    setAutoCutRan(true);
    if (segments.length === 0) {
      // No detected talk — leave the manual flow intact.
      return;
    }

    (async () => {
      setAutoCutting(true);
      setAutoCutError(null);
      const createdIds: string[] = [];
      try {
        for (const seg of segments) {
          const res = await fetch(`/api/projects/${id}/clips`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime: seg.start, endTime: seg.end }),
          });
          if (!res.ok) continue;
          const { clip } = await res.json() as { clip: SavedClip };
          createdIds.push(clip.id);
          setProject((prev) => prev ? { ...prev, clips: [...prev.clips, clip] } : prev);
        }
        setAutoCutIds(createdIds);
      } catch {
        setAutoCutError("Auto-cut hit a snag — you can still cut manually.");
      } finally {
        setAutoCutting(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, peaks.length, duration, autoCutRan, autoCutting]);

  // Wipe the auto-generated clips so the user can cut manually if the AI
  // got it wrong. Only deletes the IDs we created in this session — any
  // clips the user added after auto-cut survive.
  async function handleUndoAutoCut() {
    if (autoCutIds.length === 0) return;
    const ids = autoCutIds;
    setAutoCutIds([]);
    setProject((prev) => prev ? { ...prev, clips: prev.clips.filter((c) => !ids.includes(c.id)) } : prev);
    await Promise.all(
      ids.map((cid) => fetch(`/api/clips/${cid}`, { method: "DELETE" }).catch(() => null)),
    );
  }

  async function handleGenerateProxy() {
    if (!project) return;
    // Re-anchor the prep progress bar so it starts fresh from 0% for the
    // manual run instead of sitting at the asymptotic 95% leftover from
    // the original auto-prep attempt.
    prepStartedAt.current = null;
    setPrepProgress(0);
    setGeneratingProxy(true);
    try {
      const res = await fetch(`/api/projects/${id}/proxy`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.project?.proxyUrl) {
        // User explicitly asked for the smoother preview — swap now and
        // accept the playback reset. They clicked the button knowing what
        // they were getting.
        setVideoSrc(fileUrl(data.project.proxyUrl));
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
    prepStartedAt.current = null;
    setPrepProgress(0);
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

  // The saved clip (if any) that contains the current playhead. Drives
  // whether the razor + mute buttons show up on the waveform and what
  // they target.
  const clipAtPlayhead = project?.clips.find(
    (c) => currentTime > c.startTime && currentTime < c.endTime,
  );

  // Ranges the source-editor preview should skip during playback —
  // every clip the user has marked as muted. Re-derived on every
  // render so toggle-mute is reflected immediately.
  const mutedRanges = (project?.clips ?? [])
    .filter((c) => c.muted)
    .map((c) => ({ start: c.startTime, end: c.endTime }));

  // Apply a mute value to one clip both locally and on the server. Shared by
  // the toggle handler and its undo/redo command so all three go one path.
  function setClipMutedLocal(clipId: string, muted: boolean) {
    setProject((prev) => prev
      ? { ...prev, clips: prev.clips.map((c) => (c.id === clipId ? { ...c, muted } : c)) }
      : prev);
  }
  async function patchMuted(clipId: string, muted: boolean) {
    const res = await fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted }),
    });
    if (!res.ok) throw new Error("PATCH failed");
  }

  async function handleToggleMute() {
    if (!clipAtPlayhead) return;
    const clipId = clipAtPlayhead.id;
    const prevMuted = clipAtPlayhead.muted;
    const next = !prevMuted;
    // Optimistic update so the band re-renders instantly.
    setClipMutedLocal(clipId, next);
    try {
      await patchMuted(clipId, next);
      history.push({
        label: next ? "mute" : "unmute",
        undo: async () => { await patchMuted(clipId, prevMuted); setClipMutedLocal(clipId, prevMuted); },
        redo: async () => { await patchMuted(clipId, next); setClipMutedLocal(clipId, next); },
      });
    } catch {
      // Roll back the optimistic update if the server didn't accept it.
      setClipMutedLocal(clipId, prevMuted);
      alert("Couldn't toggle mute — check your connection.");
    }
  }

  async function handleSplit() {
    if (!clipAtPlayhead) return;
    const original = clipAtPlayhead;
    const splitAt = currentTime;
    try {
      const res = await fetch(`/api/clips/${original.id}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: splitAt }),
      });
      const data = await res.json();
      if (!res.ok || !data.a || !data.b) {
        alert(data.error || "Couldn't split the clip.");
        return;
      }
      setProject((prev) => prev
        ? {
            ...prev,
            clips: [
              ...prev.clips.filter((c) => c.id !== original.id),
              data.a,
              data.b,
            ].sort(byStart),
          }
        : prev);

      // Inverse command. `cur*` track the live ids: undo re-merges (deletes the
      // two halves, recreates the original — which gets a NEW id), redo
      // re-splits whatever the original currently is.
      let curA: SavedClip = data.a;
      let curB: SavedClip = data.b;
      let curOriginal: SavedClip = original;
      history.push({
        label: "split clip",
        undo: async () => {
          await Promise.all([
            fetch(`/api/clips/${curA.id}`, { method: "DELETE" }),
            fetch(`/api/clips/${curB.id}`, { method: "DELETE" }),
          ]);
          const res2 = await fetch(`/api/projects/${id}/clips`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              startTime: original.startTime,
              endTime: original.endTime,
              muted: original.muted,
              title: original.title,
            }),
          });
          const d2 = await res2.json();
          if (!res2.ok || !d2.clip) throw new Error("re-merge failed");
          curOriginal = d2.clip;
          const removedA = curA.id, removedB = curB.id;
          setProject((prev) => prev
            ? { ...prev, clips: [...prev.clips.filter((c) => c.id !== removedA && c.id !== removedB), d2.clip].sort(byStart) }
            : prev);
        },
        redo: async () => {
          const res2 = await fetch(`/api/clips/${curOriginal.id}/split`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ at: splitAt }),
          });
          const d2 = await res2.json();
          if (!res2.ok || !d2.a || !d2.b) throw new Error("re-split failed");
          const mergedId = curOriginal.id;
          curA = d2.a; curB = d2.b;
          setProject((prev) => prev
            ? { ...prev, clips: [...prev.clips.filter((c) => c.id !== mergedId), d2.a, d2.b].sort(byStart) }
            : prev);
        },
      });
      // Nudge the playhead 50ms forward so it ends up inside the new
      // B half (strictly inside, not on the boundary) — keeps the
      // scissors button visible for an immediate second split without
      // making the user scrub. Clamped so we never overshoot the
      // source duration.
      setCurrentTime((t) => Math.min(t + 0.05, Math.max(0, duration - 0.05)));
    } catch {
      alert("Couldn't split the clip — check your connection.");
    }
  }

  // Pending mute-region selection: first scissors click in grey
  // captures the playhead time here; the next scissors click (anywhere)
  // completes the selection and mutes [min, max]. null = no selection
  // in progress.
  const [pendingMuteStart, setPendingMuteStart] = useState<number | null>(null);

  // Escape cancels an in-progress mute selection without affecting
  // anything else. Skipping it if focus is in an input so the user can
  // type Esc inside text fields without losing their work.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (pendingMuteStart !== null) {
        e.preventDefault();
        setPendingMuteStart(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingMuteStart]);

  // Finalise a mute selection from the captured first-click time to the
  // current playhead. The range is taken min→max so the user can mark
  // either end first. Submitted via the standard clip-create endpoint
  // with muted: true.
  async function finishMuteSelection(from: number, to: number) {
    const startAt = Math.min(from, to);
    const endAt = Math.max(from, to);
    if (endAt - startAt < 0.05) {
      // Too narrow to mean anything — just clear the pending state.
      setPendingMuteStart(null);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: startAt,
          endTime: endAt,
          muted: true,
          title: "Muted",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.clip) {
        alert(data.error || "Couldn't mute the segment.");
        return;
      }
      setProject((prev) => prev
        ? { ...prev, clips: [...prev.clips, data.clip].sort(byStart) }
        : prev);
      pushCreateCommand("mute selection", data.clip, { startTime: startAt, endTime: endAt, muted: true, title: "Muted" });
    } catch {
      alert("Couldn't mute the segment — check your connection.");
    } finally {
      setPendingMuteStart(null);
    }
  }

  // Record a "clip was created" command. Undo deletes the clip and drops it
  // from local state; redo re-POSTs the same body (the server hands back a new
  // id, which we remap into the closure so a later undo deletes the right one).
  function pushCreateCommand(
    label: string,
    created: SavedClip,
    body: { startTime: number; endTime: number; muted?: boolean; title?: string },
  ) {
    const live = { id: created.id };
    history.push({
      label,
      undo: async () => {
        await fetch(`/api/clips/${live.id}`, { method: "DELETE" });
        const removed = live.id;
        setProject((prev) => prev ? { ...prev, clips: prev.clips.filter((c) => c.id !== removed) } : prev);
        setJustSaved((j) => (j && j.id === removed ? null : j));
      },
      redo: async () => {
        const res = await fetch(`/api/projects/${id}/clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await res.json();
        if (!res.ok || !d.clip) throw new Error("recreate failed");
        live.id = d.clip.id;
        setProject((prev) => prev ? { ...prev, clips: [...prev.clips, d.clip].sort(byStart) } : prev);
      },
    });
  }

  // Single scissors handler:
  //   - Pending selection in progress? Close it at the current playhead.
  //   - Playhead in a green clip and no pending? Split that clip.
  //   - Playhead in grey and no pending? Start a mute selection.
  function handleScissors() {
    if (pendingMuteStart !== null) {
      void finishMuteSelection(pendingMuteStart, currentTime);
      return;
    }
    if (clipAtPlayhead) {
      void handleSplit();
      return;
    }
    setPendingMuteStart(currentTime);
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
        pushCreateCommand("save clip", data.clip, { startTime: inTime, endTime: outTime });
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
          <UndoRedoButtons
            undo={history.undo}
            redo={history.redo}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            undoLabel={history.undoLabel}
            redoLabel={history.redoLabel}
          />
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

      {project && autoCutting && (
        <div className="shrink-0 px-4 py-2 bg-brand-900/30 border-b border-brand-800/60 flex items-center gap-2 text-xs text-brand-100">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-300 shrink-0" />
          <span className="flex-1">
            Auto-cutting silence — building one clip per talking segment. Each shows up in the sidebar as it&apos;s saved.
          </span>
        </div>
      )}

      {project && !autoCutting && autoCutIds.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-green-900/30 border-b border-green-800/60 flex items-center gap-2 text-xs text-green-100">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
          <span className="flex-1">
            Auto-cut <span className="font-semibold">{autoCutIds.length}</span> talking segment{autoCutIds.length === 1 ? "" : "s"}. Each is highlighted on the timeline and listed on the left — review or open any one to fine-tune.
          </span>
          <button
            onClick={handleUndoAutoCut}
            className="px-2.5 py-1 rounded-md border border-green-600 text-green-200 hover:bg-green-800/40 text-[11px] font-semibold transition-colors"
            title="Delete the auto-generated clips so you can cut manually instead"
          >
            Undo auto-cut
          </button>
        </div>
      )}

      {project && autoCutError && (
        <div className="shrink-0 px-4 py-2 bg-orange-900/30 border-b border-orange-800/60 text-xs text-orange-200">
          {autoCutError}
        </div>
      )}

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

      {project && prepPending && (!pollExhausted || generatingProxy || generatingWaveform) && (
        <div className="shrink-0 px-4 py-2 bg-yellow-900/20 border-b border-yellow-800/40 text-xs text-yellow-200">
          <div className="flex items-center gap-2">
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
            <span className="tabular-nums text-yellow-300 font-semibold w-10 text-right shrink-0">
              {Math.round(prepProgress)}%
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full bg-yellow-950/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-400 transition-[width] duration-500 ease-out"
              style={{ width: `${prepProgress}%` }}
            />
          </div>
        </div>
      )}

      {project && prepPending && pollExhausted && !generatingProxy && !generatingWaveform && (
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
          <div className="w-full max-w-xs relative">
            {videoSrc ? (
              <>
                {/*
                  Mount CanvasPreview as soon as we have a src — gating on
                  duration > 0 used to deadlock manual-mode projects, since
                  /api/process only writes Project.duration in AI mode.
                  Without the <video> element mounted, onLoadedMetadata
                  can never fire and the page sits on "Loading the video
                  player…" forever.
                */}
                <CanvasPreview
                  videoSrc={videoSrc}
                  words={words}
                  currentTime={currentTime}
                  onTimeUpdate={(t) => setCurrentTime(t)}
                  onLoadedMetadata={(d) => {
                    if (duration === 0) {
                      setDuration(d);
                      setOutTime(d);
                    }
                  }}
                  captionConfig={DEFAULT_CAPTION_CONFIG}
                  captionsEnabled
                  layout={DEFAULT_LAYOUT}
                  startTime={0}
                  endTime={duration || 0}
                  skipRanges={mutedRanges}
                />
                {duration === 0 && (
                  <div className="absolute inset-0 rounded-xl bg-surface-900/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 px-6 text-center pointer-events-none">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
                    <p className="text-xs text-surface-300 leading-relaxed">
                      Buffering the source so the player can start…
                    </p>
                  </div>
                )}
              </>
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
          savedClips={project?.clips ?? []}
          onSplit={handleScissors}
          splitTooltip={
            pendingMuteStart !== null
              ? "Click to end the mute here (Esc to cancel)"
              : clipAtPlayhead
                ? "Split clip at playhead"
                : "Click to start a precise mute (then click again at the end)"
          }
          pendingMuteStart={pendingMuteStart}
          onToggleMute={clipAtPlayhead ? handleToggleMute : undefined}
          playheadClipMuted={clipAtPlayhead?.muted ?? false}
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
