"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Zap, Loader2, Film, AudioLines, Scissors, CheckCircle2, Sparkles, X, Pencil,
} from "lucide-react";
import CanvasPreview from "@/components/editor/CanvasPreview";
import WaveformTimeline from "@/components/editor/WaveformTimeline";
import ClipGroups from "@/components/editor/ClipGroups";
import SpliceStrip, { type Segment } from "@/components/editor/SpliceStrip";
import SilenceControls from "@/components/editor/SilenceControls";
import UndoRedoButtons from "@/components/editor/UndoRedoButtons";
import { DEFAULT_LAYOUT } from "@/components/editor/LayoutPanel";
import { DEFAULT_CAPTION_CONFIG } from "@/lib/captions";
import { formatDuration } from "@/lib/utils";
import { detectTalkSegments, MIN_CUT, sensitivityToOpts, summarizeSilenceRemoval } from "@/lib/silence";
import { seqTotal, seqToSource, clampSeq } from "@/lib/splice";
import { fileUrl } from "@/lib/file-urls";
import { useUndoRedo, useUndoRedoShortcuts } from "@/lib/useUndoRedo";

interface WordTimestamp { word: string; start: number; end: number; }
interface SavedClip {
  id: string; title: string; startTime: number; endTime: number;
  muted: boolean;
  // Returned by GET /api/projects/[id] (full Prisma rows); used to number the
  // sidebar's grouped clip list in creation order.
  createdAt: string;
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

  // Undo/redo. Every action on this surface writes to the DB immediately, so
  // each command's undo fires a *reversing* server request (delete a created
  // clip, PATCH a mute back, re-merge a split). Commands that recreate a clip
  // get a new id from the server, so they track the live id in their closure
  // and remap it on each redo.
  const history = useUndoRedo();
  useUndoRedoShortcuts(history.undo, history.redo);
  const byStart = (a: SavedClip, b: SavedClip) => a.startTime - b.startTime;

  // Splice tool: break the source into an ordered list of segments that get
  // stitched into one exported clip (separate tool from cut/mute).
  const [tool, setTool] = useState<"scissors" | "splice">("scissors");
  const [spliceSegments, setSpliceSegments] = useState<Segment[] | null>(null);
  const [selectedSpliceId, setSelectedSpliceId] = useState<string | null>(null);
  const [savedSpliceId, setSavedSpliceId] = useState<string | null>(null);
  const [savingSplice, setSavingSplice] = useState(false);

  // Silence removal ("waveform cut"): collapse the source to only the talking
  // parts so every non-speaking gap is dropped from the output. Lives on the
  // splice tool — the detected speech segments become the stitched sequence.
  const [silenceApplied, setSilenceApplied] = useState(false);
  const [silenceSensitivity, setSilenceSensitivity] = useState(0.5);
  const silencePatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ordered ranges fed to the preview's sequence player. Memoized so its
  // identity is stable across renders (otherwise CanvasPreview's reset effect
  // would re-fire every render and pin playback at the first segment).
  const playSequence = useMemo(
    () => (tool === "splice" && spliceSegments && spliceSegments.length > 0
      ? spliceSegments.map((s) => ({ start: s.start, end: s.end }))
      : undefined),
    [tool, spliceSegments],
  );

  // Clips in creation order (oldest first) for the grouped sidebar list, so
  // "Clip 1" is the first one saved. The API returns them score-desc; we sort
  // a copy here without disturbing the score-ordered list the waveform uses.
  const orderedClips = useMemo(
    () => [...(project?.clips ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [project?.clips],
  );

  // Inline rename — video (project) title in the header. Enter/blur saves,
  // Escape cancels. titleEscRef lets the blur handler tell an Escape-triggered
  // blur apart from a normal save-on-blur.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleEscRef = useRef(false);

  async function commitProjectTitle() {
    const title = titleDraft.trim();
    setEditingTitle(false);
    if (project && title && title !== project.title) {
      setProject((prev) => (prev ? { ...prev, title } : prev));
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch(() => {});
    }
  }

  // Inline rename — a clip's title from the sidebar groups. Optimistic local
  // update + PATCH; ClipGroups owns the edit-field UI.
  async function renameClip(clipId: string, title: string) {
    setProject((prev) =>
      prev ? { ...prev, clips: prev.clips.map((c) => (c.id === clipId ? { ...c, title } : c)) } : prev,
    );
    await fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }

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

      // One-time migration: sweep out useless sub-MIN_CUT slivers (the old
      // "white line" cuts from before the minimum-size guard). Drop them from
      // the payload before it ever reaches local state, and delete them
      // server-side (fire-and-forget — a failure just retries next load).
      // Runs only here on the initial fetch, never in the poll loop, and not
      // on the undo stack (it's a migration, not a user edit).
      const slivers = p.clips.filter((c) => c.endTime - c.startTime < MIN_CUT);
      if (slivers.length > 0) {
        p.clips = p.clips.filter((c) => c.endTime - c.startTime >= MIN_CUT);
        slivers.forEach((c) => { void fetch(`/api/clips/${c.id}`, { method: "DELETE" }).catch(() => null); });
      }

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
      // Waveform ~45s flat. Proxy encode is GPU-assisted but a heavy 4K/60fps
      // source runs near real-time, so budget ~1.5x the source duration (floor
      // 90s). Overestimating is safe — the bar vanishes the moment the proxy
      // lands; underestimating parks it at 95% for the rest of the encode.
      const waveformBudget = peaks.length === 0 ? 45 : 0;
      const proxyBudget = !hasProxy ? Math.max(90, (duration || 600) * 1.5) : 0;
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
  }, [prepPending, peaks.length, hasProxy, duration, generatingProxy, generatingWaveform]);
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

  // While a background proxy encode is in flight (the "Smoother preview"
  // button kicked one off), poll until proxyUrl lands, then swap the preview
  // to the smoother proxy. Capped so a failed/timed-out encode doesn't poll
  // forever (matches the route's 90-min cap plus slack, at 5s per attempt).
  const proxyPollAttempts = useRef(0);
  useEffect(() => {
    if (!generatingProxy) { proxyPollAttempts.current = 0; return; }
    const interval = setInterval(async () => {
      proxyPollAttempts.current += 1;
      if (proxyPollAttempts.current > 1140) {
        clearInterval(interval);
        setGeneratingProxy(false);
        alert("Couldn't build a smoother preview for this video — it's likely too large/long for this machine. The original still plays fine.");
        return;
      }
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) return;
        const { project: p } = await res.json() as { project: ProjectSummary };
        if (p.proxyUrl) {
          clearInterval(interval);
          setProject(p);
          setVideoSrc(fileUrl(p.proxyUrl));
          setHasProxy(true);
          setPendingProxyUrl(null);
          setGeneratingProxy(false);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingProxy, id]);

  // Talk-segment detection now runs server-side during processing (clips
  // land on the project grid), so the editor no longer auto-cuts on load —
  // it opens with the project's existing clips and is a pure editing surface.

  async function handleGenerateProxy() {
    if (!project) return;
    // Re-anchor the prep progress bar so it starts fresh from 0% for the
    // manual run instead of sitting at the asymptotic 95% leftover from
    // the original auto-prep attempt. Anchor to now (not null) so the running
    // ticker keeps climbing — nulling it froze the bar at 0%.
    prepStartedAt.current = Date.now();
    setPrepProgress(0);
    setGeneratingProxy(true);
    try {
      const res = await fetch(`/api/projects/${id}/proxy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Couldn't start the preview.");
        setGeneratingProxy(false);
        return;
      }
      if (data.status === "ready" && data.project?.proxyUrl) {
        // Proxy already existed — swap immediately.
        setVideoSrc(fileUrl(data.project.proxyUrl));
        setHasProxy(true);
        setPendingProxyUrl(null);
        setGeneratingProxy(false);
      }
      // status "started" / "running": the encode runs in the background. Keep
      // generatingProxy true; the proxy-poll effect adopts it when proxyUrl
      // lands and swaps the preview in. The original keeps playing meanwhile.
    } catch {
      alert("Couldn't start the preview.");
      setGeneratingProxy(false);
    }
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
    prepStartedAt.current = Date.now();
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

  // Move/resize a clip's range both locally and on the server. Used by the
  // waveform's direct manipulation of muted (cut) regions.
  function setClipRangeLocal(clipId: string, s: number, e: number) {
    setProject((prev) => prev
      ? { ...prev, clips: prev.clips.map((c) => (c.id === clipId ? { ...c, startTime: s, endTime: e } : c)).sort(byStart) }
      : prev);
  }
  async function patchRange(clipId: string, s: number, e: number) {
    const res = await fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTime: s, endTime: e }),
    });
    if (!res.ok) throw new Error("PATCH failed");
  }

  // Drag-to-move / resize a cut region. Commits once (on pointer-up) from
  // the waveform. Stable clip id, so the undo command is a plain inverse
  // PATCH — no recreate / id-remap needed.
  async function handleMuteRangeChange(clipId: string, start: number, end: number) {
    if (end - start < MIN_CUT) return; // belt-and-suspenders; timeline clamps too
    const before = project?.clips.find((c) => c.id === clipId);
    if (!before) return;
    const prevStart = before.startTime;
    const prevEnd = before.endTime;
    setClipRangeLocal(clipId, start, end);
    try {
      await patchRange(clipId, start, end);
      history.push({
        label: "move cut",
        undo: async () => { await patchRange(clipId, prevStart, prevEnd); setClipRangeLocal(clipId, prevStart, prevEnd); },
        redo: async () => { await patchRange(clipId, start, end); setClipRangeLocal(clipId, start, end); },
      });
    } catch {
      setClipRangeLocal(clipId, prevStart, prevEnd);
      alert("Couldn't move the cut — check your connection.");
    }
  }

  // Delete a cut region. Undo recreates it (server hands back a NEW id, which
  // we remap into the closure so a later redo deletes the right clip — same
  // pattern as the split/create commands).
  async function handleMuteDelete(clipId: string) {
    const removed = project?.clips.find((c) => c.id === clipId);
    if (!removed) return;
    setProject((prev) => prev ? { ...prev, clips: prev.clips.filter((c) => c.id !== clipId) } : prev);
    try {
      const res = await fetch(`/api/clips/${clipId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("DELETE failed");
      const live = { id: clipId };
      history.push({
        label: "delete cut",
        undo: async () => {
          const r = await fetch(`/api/projects/${id}/clips`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ startTime: removed.startTime, endTime: removed.endTime, muted: true, title: removed.title }),
          });
          const d = await r.json();
          if (!r.ok || !d.clip) throw new Error("recreate failed");
          live.id = d.clip.id;
          setProject((prev) => prev ? { ...prev, clips: [...prev.clips, d.clip].sort(byStart) } : prev);
        },
        redo: async () => {
          await fetch(`/api/clips/${live.id}`, { method: "DELETE" });
          const gone = live.id;
          setProject((prev) => prev ? { ...prev, clips: prev.clips.filter((c) => c.id !== gone) } : prev);
        },
      });
    } catch {
      // Restore on failure.
      setProject((prev) => prev ? { ...prev, clips: [...prev.clips, removed].sort(byStart) } : prev);
      alert("Couldn't delete the cut — check your connection.");
    }
  }

  async function handleSplit() {
    if (!clipAtPlayhead) return;
    const original = clipAtPlayhead;
    const splitAt = currentTime;
    // Refuse a split that would leave either half too short to be usable.
    if (splitAt - original.startTime < MIN_CUT || original.endTime - splitAt < MIN_CUT) {
      alert(`Move the playhead further from the clip edge — each half needs at least ${MIN_CUT}s.`);
      return;
    }
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
    if (endAt - startAt < MIN_CUT) {
      // Too narrow to be a usable cut — discard silently (no leftover line).
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

  // ---- Splice tool ------------------------------------------------------

  // Persist a segment edit to a saved spliced clip (no-op until it's saved).
  async function patchSegments(clipId: string, segs: Segment[]) {
    await fetch(`/api/clips/${clipId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        segments: JSON.stringify(segs),
        startTime: Math.min(...segs.map((s) => s.start)),
        endTime: Math.max(...segs.map((s) => s.end)),
      }),
    });
  }

  // Apply a new segment arrangement locally, persist if already saved, and
  // record one undo step (whole-array snapshot — stable ids, no id remap).
  function commitSegments(next: Segment[], label: string) {
    const prev = spliceSegments;
    setSpliceSegments(next);
    // Keep the (sequence-time) playhead in range after the arrangement changes.
    setCurrentTime((p) => clampSeq(next, p));
    if (savedSpliceId) void patchSegments(savedSpliceId, next);
    history.push({
      label,
      undo: async () => { setSpliceSegments(prev); if (savedSpliceId && prev) await patchSegments(savedSpliceId, prev); },
      redo: async () => { setSpliceSegments(next); if (savedSpliceId) await patchSegments(savedSpliceId, next); },
    });
  }

  // Seed a splice from the current in/out selection (defaults to whole source).
  // In splice mode currentTime is SEQUENCE-time, so reset it to 0.
  function startSplice() {
    const start = outTime > inTime ? inTime : 0;
    const end = outTime > inTime ? outTime : duration;
    setSpliceSegments([{ id: crypto.randomUUID(), start, end }]);
    setSelectedSpliceId(null);
    setCurrentTime(0);
  }

  // Divide the segment under the playhead into two. currentTime is sequence-
  // time, so map it to the underlying source time + active segment first.
  function addSplicePoint() {
    if (!spliceSegments) return;
    const total = seqTotal(spliceSegments);
    if (currentTime <= 0 || currentTime >= total) return;
    const { srcTime, segIndex } = seqToSource(spliceSegments, currentTime);
    const seg = spliceSegments[segIndex];
    if (srcTime - seg.start < MIN_CUT || seg.end - srcTime < MIN_CUT) {
      alert(`Move the playhead further from the segment edge — each piece needs at least ${MIN_CUT}s.`);
      return;
    }
    const a: Segment = { id: crypto.randomUUID(), start: seg.start, end: srcTime };
    const b: Segment = { id: crypto.randomUUID(), start: srcTime, end: seg.end };
    commitSegments([...spliceSegments.slice(0, segIndex), a, b, ...spliceSegments.slice(segIndex + 1)], "splice point");
  }

  function reorderSegment(from: number, to: number) {
    if (!spliceSegments) return;
    const next = [...spliceSegments];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commitSegments(next, "reorder segment");
  }

  function deleteSegment(segId: string) {
    if (!spliceSegments) return;
    if (spliceSegments.length <= 1) { alert("A splice needs at least one segment — can't delete the last part."); return; }
    commitSegments(spliceSegments.filter((s) => s.id !== segId), "delete part");
  }

  // Save (or update) the spliced sequence as a single clip.
  async function saveSplice() {
    if (!project || !spliceSegments || spliceSegments.length === 0) return;
    setSavingSplice(true);
    try {
      if (savedSpliceId) {
        await patchSegments(savedSpliceId, spliceSegments);
      } else {
        const res = await fetch(`/api/projects/${id}/clips`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: spliceSegments }),
        });
        const data = await res.json();
        if (res.ok && data.clip) {
          setSavedSpliceId(data.clip.id);
          setProject((prev) => prev ? { ...prev, clips: [...prev.clips, data.clip] } : prev);
        } else {
          alert(data.error || "Couldn't save the splice.");
        }
      }
    } catch {
      alert("Couldn't save the splice — check your connection.");
    }
    setSavingSplice(false);
  }

  // ---- Silence removal (waveform cut) -----------------------------------

  // Build the talking-only sequence at a given sensitivity. Returns null if no
  // clear speech was found (caller leaves the current arrangement untouched).
  function detectSilenceSegments(sensitivity: number): Segment[] | null {
    if (peaks.length === 0 || duration <= 0) return null;
    const segs = detectTalkSegments(peaks, duration, sensitivityToOpts(sensitivity));
    if (segs.length === 0) return null;
    return segs.map((s) => ({ id: crypto.randomUUID(), start: s.start, end: s.end }));
  }

  // Primary action: drop every non-speaking gap, leaving one continuous clip.
  // Switches into the splice tool and records a single undo step.
  function handleRemoveSilences() {
    const next = detectSilenceSegments(silenceSensitivity);
    if (!next) {
      alert("No clear speech detected — lower the sensitivity and try again.");
      return;
    }
    if (tool !== "splice") setTool("splice");
    const prev = spliceSegments;
    const wasApplied = silenceApplied;
    setSpliceSegments(next);
    setSelectedSpliceId(null);
    setCurrentTime(0);
    setSilenceApplied(true);
    if (savedSpliceId) void patchSegments(savedSpliceId, next);
    history.push({
      label: "remove silences",
      undo: async () => {
        setSpliceSegments(prev);
        setSilenceApplied(wasApplied);
        setCurrentTime(0);
        if (savedSpliceId && prev) await patchSegments(savedSpliceId, prev);
      },
      redo: async () => {
        setSpliceSegments(next);
        setSilenceApplied(true);
        setCurrentTime(0);
        if (savedSpliceId) await patchSegments(savedSpliceId, next);
      },
    });
  }

  // Live sensitivity tweak. Once silences have been removed, dragging the
  // slider re-detects and updates the sequence in place. These micro-edits are
  // intentionally NOT pushed onto the undo stack — the single "remove silences"
  // entry owns the whole operation. A debounced patch persists if saved.
  function handleSensitivityChange(v: number) {
    setSilenceSensitivity(v);
    if (!silenceApplied) return;
    const next = detectSilenceSegments(v);
    if (!next) return;
    setSpliceSegments(next);
    setCurrentTime(0);
    if (savedSpliceId) {
      const target = savedSpliceId;
      if (silencePatchTimer.current) clearTimeout(silencePatchTimer.current);
      silencePatchTimer.current = setTimeout(() => { void patchSegments(target, next); }, 300);
    }
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
  // Silence-removal readout for the splice controls.
  const silenceSummary = summarizeSilenceRemoval(spliceSegments ?? [], duration);

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
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              else if (e.key === "Escape") { titleEscRef.current = true; e.currentTarget.blur(); }
            }}
            onBlur={() => {
              if (titleEscRef.current) { titleEscRef.current = false; setEditingTitle(false); return; }
              commitProjectTitle();
            }}
            className="bg-surface-900 border border-brand-600 focus:border-brand-400 rounded px-2 py-0.5 text-white text-sm outline-none max-w-[280px]"
            aria-label="Video title"
          />
        ) : (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-white text-sm font-medium truncate max-w-[280px]">{project.title}</span>
            <button
              type="button"
              onClick={() => { setTitleDraft(project.title); setEditingTitle(true); }}
              className="shrink-0 text-surface-500 hover:text-brand-300 transition-colors"
              title="Rename video"
              aria-label="Rename video"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </span>
        )}

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
          {/* Tool toggle: Cut/mute vs Splice (separate tools). */}
          <div className="flex items-center rounded-lg border border-surface-600 overflow-hidden text-xs">
            <button
              onClick={() => { setTool("scissors"); setCurrentTime(0); }}
              className={`px-3 py-1.5 font-medium transition-colors ${tool === "scissors" ? "bg-brand-600 text-white" : "text-surface-300 hover:bg-surface-700"}`}
              title="Cut / mute tool"
            >
              Cut
            </button>
            <button
              onClick={() => { setTool("splice"); if (!spliceSegments) startSplice(); else setCurrentTime(0); }}
              className={`px-3 py-1.5 font-medium transition-colors ${tool === "splice" ? "bg-indigo-600 text-white" : "text-surface-300 hover:bg-surface-700"}`}
              title="Splice tool — break the track into reorderable segments"
            >
              Splice
            </button>
          </div>

          {tool === "scissors" ? (
            <button
              onClick={handleSaveClip}
              disabled={saving || segmentDuration < 1}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-colors"
              title="Save the current in/out as a new clip"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
              Save as new clip ({formatDuration(segmentDuration)})
            </button>
          ) : (
            <button
              onClick={saveSplice}
              disabled={savingSplice || !spliceSegments || spliceSegments.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs rounded-lg font-medium transition-colors"
              title="Save the arranged segments as one stitched clip"
            >
              {savingSplice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
              {savedSpliceId ? "Update spliced clip" : "Save spliced clip"}
            </button>
          )}
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
                <>A smoother 720p preview is rendering in the background (large 4K/60fps videos can take a while). The original is fine to scrub in the meantime.</>
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
              <ClipGroups projectId={project.id} clips={orderedClips} onRenameClip={renameClip} />
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
                  endTime={tool === "splice" && spliceSegments ? seqTotal(spliceSegments) : (duration || 0)}
                  skipRanges={tool === "splice" ? undefined : mutedRanges}
                  playSequence={playSequence}
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
          savedClips={tool === "splice" ? [] : (project?.clips ?? [])}
          // Cut/mute tools — only in scissors mode (withheld in splice mode so
          // those interactions are cleanly inert).
          onSplit={tool === "scissors" ? handleScissors : undefined}
          splitTooltip={
            pendingMuteStart !== null
              ? "Click to end the mute here (Esc to cancel)"
              : clipAtPlayhead
                ? "Split clip at playhead"
                : "Click to start a precise mute (then click again at the end)"
          }
          pendingMuteStart={tool === "scissors" ? pendingMuteStart : null}
          onToggleMute={tool === "scissors" && clipAtPlayhead ? handleToggleMute : undefined}
          playheadClipMuted={clipAtPlayhead?.muted ?? false}
          onMuteRangeChange={tool === "scissors" ? handleMuteRangeChange : undefined}
          onMuteDelete={tool === "scissors" ? handleMuteDelete : undefined}
          minCut={MIN_CUT}
          // Splice tool
          spliceMode={tool === "splice"}
          spliceSegments={tool === "splice" ? (spliceSegments ?? []) : []}
          selectedSpliceId={selectedSpliceId}
          onAddSplicePoint={tool === "splice" ? addSplicePoint : undefined}
        />
        {tool === "splice" && (
          <>
            <SilenceControls
              disabled={peaks.length === 0 || duration <= 0}
              applied={silenceApplied}
              sensitivity={silenceSensitivity}
              onSensitivityChange={handleSensitivityChange}
              onRemoveSilences={handleRemoveSilences}
              segmentCount={spliceSegments?.length ?? 0}
              keptDuration={silenceSummary.keptDuration}
              removedDuration={silenceSummary.removedDuration}
              gapCount={silenceSummary.gapCount}
              totalDuration={duration}
            />
            {spliceSegments
              ? (
                <SpliceStrip
                  segments={spliceSegments}
                  selectedId={selectedSpliceId}
                  onReorder={reorderSegment}
                  onDelete={deleteSegment}
                  onSelect={(id) => setSelectedSpliceId((cur) => (cur === id ? null : id))}
                />
              )
              : (
                <div className="px-4 py-3 border-t border-surface-700">
                  <button
                    onClick={startSplice}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                  >
                    Start splice from current selection
                  </button>
                </div>
              )}
          </>
        )}
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
