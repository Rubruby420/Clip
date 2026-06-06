"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Scissors, Ban, Undo2, X,
  ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight, Image,
} from "lucide-react";
import { formatDuration, formatPreciseTime } from "@/lib/utils";
import { seqTotal, segOffsets, seqToSource } from "@/lib/splice";

interface SavedClipRange {
  id: string;
  startTime: number;
  endTime: number;
  muted?: boolean;
}

interface Props {
  peaks: number[];
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  onStartChange: (t: number) => void;
  onEndChange: (t: number) => void;
  onSeek: (t: number) => void;
  // Already-saved clips drawn as green ranges so the user can see every
  // auto-cut segment at a glance. Optional — empty array hides the
  // overlay.
  savedClips?: SavedClipRange[];
  // Razor button. When provided, a scissors icon rides the playhead so
  // the user can split the clip under it. Parent controls behaviour:
  // in `/source`, scissors splits inside a saved clip and inserts a
  // muted segment when clicked in the grey unsaved area — the
  // splitTooltip prop lets the parent tell the user which mode they're
  // about to trigger.
  onSplit?: () => void;
  splitTooltip?: string;
  // Mute toggle. Same pattern as onSplit — parent passes it only when
  // the playhead is inside a saved clip. `playheadClipMuted` toggles
  // the icon (Ban vs Undo2) and tooltip text.
  onToggleMute?: () => void;
  playheadClipMuted?: boolean;
  // Two-click mute selection: when set, the parent is mid-selection and
  // the waveform should draw a tentative marker at this time so the
  // user knows the next scissors click will close the range.
  pendingMuteStart?: number | null;
  // Direct manipulation of muted (cut) regions. When provided, each muted
  // band gets drag-to-move + edge-resize + a delete (✕). Commit fires once
  // on pointer-up (onMuteRangeChange); delete fires immediately
  // (onMuteDelete). Green content clips are never made interactive.
  onMuteRangeChange?: (id: string, startTime: number, endTime: number) => void;
  onMuteDelete?: (id: string) => void;
  // Smallest allowed cut width (seconds). Resizes clamp against it.
  minCut?: number;
  // Splice mode: render the source's ordered segments as numbered bands with
  // boundary markers, and show an "add splice point" button on the playhead.
  // Read-only here — all editing (split/reorder/drop) happens in the parent's
  // SpliceStrip. When spliceMode is on, the parent withholds the cut/mute
  // props so those interactions are cleanly inert.
  spliceMode?: boolean;
  spliceSegments?: { id: string; start: number; end: number }[];
  selectedSpliceId?: string | null;
  onAddSplicePoint?: () => void;
  onRemoveBgNoise?: () => void;
}

// Drag targets. The trim handles + playhead are the originals; the three
// region* kinds drive direct manipulation of a muted clip; the overview*
// kinds drive the zoom minimap. regionId identifies the muted clip.
type DragKind =
  | "start" | "end" | "playhead"
  | "regionMove" | "regionResizeL" | "regionResizeR"
  | "overviewMove" | "overviewResizeL" | "overviewResizeR";
interface DragState { kind: DragKind; regionId?: string }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// Tightest visible window (seconds). At this span the track shows ~MIN_VIEW
// of audio across its full width, far finer than the 0.1s the user needs.
const MIN_VIEW = 1;


// SVG-based waveform timeline. Renders one vertical bar per peak with the
// trimmed-out regions masked, draggable in/out handles, and a playhead you
// can grab to scrub. Clicking the bar (outside the handles) seeks. The view
// is a zoomable window over the source: [viewStart, viewStart+viewDuration]
// maps across the track width, so you can zoom in to cut precisely.
export default function WaveformTimeline({
  peaks, duration, startTime, endTime, currentTime,
  onStartChange, onEndChange, onSeek, savedClips = [], onSplit,
  splitTooltip = "Split clip at playhead",
  onToggleMute, playheadClipMuted = false,
  pendingMuteStart = null,
  onMuteRangeChange, onMuteDelete, minCut = 0.3,
  spliceMode = false, spliceSegments = [], selectedSpliceId = null, onAddSplicePoint,
  onRemoveBgNoise,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const ovRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Captured at pointer-down on a muted region (or the overview box) so the
  // document move handler works from stable coords (not a closure that
  // changes identity every render and would tear down the listener).
  const dragMetaRef = useRef<{ s0: number; e0: number; grabOffsetT: number } | null>(null);
  // Live coords for the region currently being dragged — local only, so the
  // band moves smoothly without a DB write per frame. Committed on pointer-up.
  const [override, setOverride] = useState<{ id: string; start: number; end: number } | null>(null);

  // Zoom window state. zoom === 1 fits the whole source; higher zooms in.
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(() => {
      if (ref.current) setWidth(ref.current.clientWidth);
    });
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const height = 80;
  // In splice mode the timeline is the OUTPUT sequence (kept segments
  // concatenated), so its length is the sum of segment durations. Everything
  // geometric (window, zoom, pan, tToX/xToT, playhead) runs over this
  // effectiveDuration. Peak sampling still uses the raw source `duration`.
  const seqDuration = spliceMode ? seqTotal(spliceSegments) : 0;
  const effectiveDuration = spliceMode ? seqDuration : duration;
  const safeDuration = effectiveDuration > 0 ? effectiveDuration : 1;
  const ZOOM_MAX = Math.max(1, safeDuration / MIN_VIEW);

  // Derived visible window. viewStart is read-clamped so a stale value after
  // a zoom change can never render off the end of the source.
  const zoomClamped = clamp(zoom, 1, ZOOM_MAX);
  const viewDuration = safeDuration / zoomClamped;
  const maxViewStart = Math.max(0, safeDuration - viewDuration);
  const viewStartC = clamp(viewStart, 0, maxViewStart);
  const viewEnd = viewStartC + viewDuration;
  const pxPerSec = width / viewDuration;

  // Window-aware mapping. tToX may now return values outside [0,width]
  // (off-screen) — consumers clamp/cull. xToT clamps its result to the
  // source so seeks/handles stay valid.
  const tToX = useCallback(
    (t: number) => (t - viewStartC) * pxPerSec,
    [viewStartC, pxPerSec],
  );
  const xToT = useCallback(
    (x: number) => clamp(viewStartC + x / pxPerSec, 0, safeDuration),
    [viewStartC, pxPerSec, safeDuration],
  );

  const startX = tToX(startTime);
  const endX = tToX(endTime);
  const playheadX = tToX(currentTime);
  const onScreen = (x: number) => x >= 0 && x <= width;

  // Overview (minimap) mapping — always spans the whole source across width.
  const ovToX = (t: number) => (clamp(t, 0, safeDuration) / safeDuration) * width;

  // Zoom anchored on a screen X so the time under the cursor/centre stays put.
  const applyZoom = useCallback((nextZoomRaw: number, anchorX: number) => {
    const nextZoom = clamp(nextZoomRaw, 1, ZOOM_MAX);
    const curVD = safeDuration / zoomClamped;
    const curPx = width / curVD;
    const tAnchor = viewStartC + anchorX / curPx;
    const nextVD = safeDuration / nextZoom;
    const nextPx = width / nextVD;
    const ns = clamp(tAnchor - anchorX / nextPx, 0, Math.max(0, safeDuration - nextVD));
    setZoom(nextZoom);
    setViewStart(ns);
  }, [ZOOM_MAX, safeDuration, zoomClamped, width, viewStartC]);

  const panBy = useCallback((deltaT: number) => {
    setViewStart((vs) => clamp(vs + deltaT, 0, Math.max(0, safeDuration - safeDuration / zoomClamped)));
  }, [safeDuration, zoomClamped]);

  const nudge = useCallback((dir: -1 | 1, coarse: boolean) => {
    onSeek(clamp(currentTime + dir * (coarse ? 1 : 0.1), 0, safeDuration));
  }, [currentTime, onSeek, safeDuration]);

  // Live refs for the once-attached wheel + key listeners.
  const zoomRef = useRef(zoomClamped); zoomRef.current = zoomClamped;
  const pxPerSecRef = useRef(pxPerSec); pxPerSecRef.current = pxPerSec;
  const viewStartRef = useRef(viewStartC); viewStartRef.current = viewStartC;
  const applyZoomRef = useRef(applyZoom); applyZoomRef.current = applyZoom;
  const panByRef = useRef(panBy); panByRef.current = panBy;
  const nudgeRef = useRef(nudge); nudgeRef.current = nudge;

  // Split-boundary detection — when two saved clips meet (e.g. after a
  // razor cut), we want the shared edge to read as a "this is a split"
  // marker, not just another clip edge.
  const splitBoundaryTimes: number[] = (() => {
    if (savedClips.length < 2) return [];
    const sorted = [...savedClips].sort((a, b) => a.startTime - b.startTime);
    const shared: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (Math.abs(sorted[i].endTime - sorted[i + 1].startTime) < 0.05) {
        shared.push(sorted[i].endTime);
      }
    }
    return shared;
  })();
  const isSplitBoundaryT = (t: number) =>
    splitBoundaryTimes.some((bt) => Math.abs(bt - t) < 0.05);

  // Drag interactions live on document so they keep firing even when the
  // pointer leaves the SVG. dragRef mirrors drag state for handlers attached
  // only once at drag start.
  useEffect(() => {
    if (!drag) return;
    dragRef.current = drag;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;

      // Overview (minimap) drags — pan or resize the visible window.
      if (cur.kind === "overviewMove" || cur.kind === "overviewResizeL" || cur.kind === "overviewResizeR") {
        if (!ovRef.current) return;
        const orect = ovRef.current.getBoundingClientRect();
        const t = clamp(((e.clientX - orect.left) / orect.width) * safeDuration, 0, safeDuration);
        const vd = safeDuration / zoomRef.current;
        if (cur.kind === "overviewMove") {
          const grab = dragMetaRef.current?.grabOffsetT ?? 0;
          setViewStart(clamp(t - grab, 0, Math.max(0, safeDuration - vd)));
        } else if (cur.kind === "overviewResizeR") {
          const newVD = clamp(t - viewStartRef.current, MIN_VIEW, safeDuration);
          setZoom(safeDuration / newVD);
        } else {
          const vEnd = viewStartRef.current + vd;
          const newVD = clamp(vEnd - t, MIN_VIEW, safeDuration);
          setViewStart(Math.max(0, vEnd - newVD));
          setZoom(safeDuration / newVD);
        }
        return;
      }

      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const t = xToT(e.clientX - rect.left);
      if (cur.kind === "start") onStartChange(Math.min(t, endTime - 0.5));
      else if (cur.kind === "end") onEndChange(Math.max(t, startTime + 0.5));
      else if (cur.kind === "playhead") onSeek(t);
      else if (cur.regionId && dragMetaRef.current) {
        const { s0, e0, grabOffsetT } = dragMetaRef.current;
        if (cur.kind === "regionMove") {
          const w = e0 - s0;
          const ns = clamp(t - grabOffsetT, 0, safeDuration - w);
          setOverride({ id: cur.regionId, start: ns, end: ns + w });
        } else if (cur.kind === "regionResizeL") {
          const ns = clamp(t, 0, e0 - minCut);
          setOverride({ id: cur.regionId, start: ns, end: e0 });
        } else if (cur.kind === "regionResizeR") {
          const ne = clamp(t, s0 + minCut, safeDuration);
          setOverride({ id: cur.regionId, start: s0, end: ne });
        }
      }
    };
    const onUp = () => {
      const cur = dragRef.current;
      // Commit a region drag once, on release.
      if (cur?.regionId && override && override.id === cur.regionId && onMuteRangeChange) {
        onMuteRangeChange(cur.regionId, override.start, override.end);
      }
      dragRef.current = null;
      dragMetaRef.current = null;
      setOverride(null);
      setDrag(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [drag, endTime, startTime, xToT, onStartChange, onEndChange, onSeek, safeDuration, minCut, override, onMuteRangeChange]);

  // Native, non-passive wheel listener (React's onWheel is passive, so it
  // can't preventDefault). Ctrl/⌘+wheel zooms toward the cursor; plain wheel
  // pans when zoomed in (otherwise the page scrolls normally).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const cursorX = e.clientX - el.getBoundingClientRect().left;
        applyZoomRef.current(zoomRef.current * Math.exp(-e.deltaY * 0.002), cursorX);
      } else if (zoomRef.current > 1) {
        e.preventDefault();
        panByRef.current((e.deltaY + e.deltaX) / pxPerSecRef.current);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Arrow-key nudge of the playhead (±0.1s, Shift = ±1s). Skipped while a
  // text field is focused so typing isn't hijacked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); nudgeRef.current(-1, e.shiftKey); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nudgeRef.current(1, e.shiftKey); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-follow: keep the playhead inside the window during playback.
  // Suppressed while any drag is in progress (so it never fights a manual
  // pan/scrub) and at fit zoom. A paused manual pan stays put.
  useEffect(() => {
    if (drag || zoomClamped <= 1) return;
    const vd = safeDuration / zoomClamped;
    const margin = vd * 0.1;
    if (currentTime < viewStartC + margin) {
      setViewStart(Math.max(0, currentTime - margin));
    } else if (currentTime > viewStartC + vd - margin) {
      setViewStart(clamp(currentTime - vd + margin, 0, Math.max(0, safeDuration - vd)));
    }
  }, [currentTime, drag, zoomClamped, viewStartC, safeDuration]);

  function handleBarClick(e: React.MouseEvent) {
    if (drag) return;
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    onSeek(xToT(e.clientX - rect.left));
  }

  // Minimum on-screen width (px) for a muted-region overlay, so even a
  // hair-thin cut stays grabbable and deletable.
  const MIN_HIT = 14;

  // Start dragging a muted region. Captures the region's committed coords +
  // where along it the user grabbed, so the document move handler can work
  // from stable numbers regardless of re-renders.
  function beginRegionDrag(e: React.PointerEvent, c: SavedClipRange, kind: DragKind) {
    e.stopPropagation();
    const rect = ref.current?.getBoundingClientRect();
    const pointerT = rect ? xToT(e.clientX - rect.left) : c.startTime;
    dragMetaRef.current = { s0: c.startTime, e0: c.endTime, grabOffsetT: pointerT - c.startTime };
    setDrag({ kind, regionId: c.id });
  }

  // Start dragging the overview window box.
  function beginOverviewDrag(e: React.PointerEvent, kind: DragKind) {
    e.stopPropagation();
    const orect = ovRef.current?.getBoundingClientRect();
    const pointerT = orect ? clamp(((e.clientX - orect.left) / orect.width) * safeDuration, 0, safeDuration) : viewStartC;
    dragMetaRef.current = { s0: viewStartC, e0: viewEnd, grabOffsetT: pointerT - viewStartC };
    setDrag({ kind });
  }

  // Click the overview track (outside the box) to recenter the window there.
  function handleOverviewClick(e: React.MouseEvent) {
    if (drag || zoomClamped <= 1 || !ovRef.current) return;
    const orect = ovRef.current.getBoundingClientRect();
    const t = clamp(((e.clientX - orect.left) / orect.width) * safeDuration, 0, safeDuration);
    setViewStart(clamp(t - viewDuration / 2, 0, maxViewStart));
  }

  // Bar count is whatever fits; bars span only the visible window.
  const barWidth = 2;
  const gap = 1;
  const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
  const bars: { x: number; h: number }[] = [];
  const srcDuration = duration > 0 ? duration : 1;
  if (peaks.length > 0) {
    for (let i = 0; i < barCount; i++) {
      const tBar = viewStartC + (i / barCount) * viewDuration;
      // In splice mode tBar is a SEQUENCE second — map it back to the source
      // time so the right slice of the waveform is sampled. Peaks always span
      // the source, so index by the raw source duration.
      const srcT = spliceMode ? seqToSource(spliceSegments, tBar).srcTime : tBar;
      const peakIdx = Math.min(peaks.length - 1, Math.floor((srcT / srcDuration) * peaks.length));
      const v = peaks[peakIdx] ?? 0;
      const h = Math.max(1, v * height * 0.92);
      bars.push({ x: i * (barWidth + gap), h });
    }
  }

  // Floating playhead buttons flip to the left of the line when it's near
  // the right edge so they don't get clipped off-screen.
  const flipButtons = playheadX > width - 70;
  const scissorsLeft = flipButtons ? playheadX - 30 : playheadX + 8;
  const muteBtnLeft = flipButtons ? playheadX - 58 : playheadX + 36;

  return (
    <div className="px-4 py-3 bg-surface-800 border-t border-surface-600 select-none">
      {/* Toolbar: zoom controls + precise playhead readout + nudge */}
      <div className="flex items-center gap-2 mb-2">

        <button type="button" title="Zoom out" disabled={zoomClamped <= 1}
          onClick={() => applyZoom(zoomClamped / 1.5, width / 2)}
          className="p-1.5 rounded-xl bg-orange-400 border-2 border-orange-600 shadow-[3px_3px_0px_#9a3412] hover:shadow-[1px_1px_0px_#9a3412] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-[3px_3px_0px_#9a3412] disabled:translate-x-0 disabled:translate-y-0 transition-all duration-100">
          <ZoomOut className="w-4 h-4 text-white" strokeWidth={2.5} />
        </button>

        <button type="button" title="Zoom in" disabled={zoomClamped >= ZOOM_MAX}
          onClick={() => applyZoom(zoomClamped * 1.5, width / 2)}
          className="p-1.5 rounded-xl bg-emerald-400 border-2 border-emerald-600 shadow-[3px_3px_0px_#065f46] hover:shadow-[1px_1px_0px_#065f46] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-[3px_3px_0px_#065f46] disabled:translate-x-0 disabled:translate-y-0 transition-all duration-100">
          <ZoomIn className="w-4 h-4 text-white" strokeWidth={2.5} />
        </button>

        <button type="button" title="Fit whole video" disabled={zoomClamped <= 1}
          onClick={() => { setZoom(1); setViewStart(0); }}
          className="p-1.5 rounded-xl bg-sky-400 border-2 border-sky-600 shadow-[3px_3px_0px_#0369a1] hover:shadow-[1px_1px_0px_#0369a1] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-[3px_3px_0px_#0369a1] disabled:translate-x-0 disabled:translate-y-0 transition-all duration-100">
          <Maximize2 className="w-4 h-4 text-white" strokeWidth={2.5} />
        </button>

        <span className="tabular-nums text-xs font-black px-2.5 py-1 rounded-xl bg-surface-700 border-2 border-surface-500 shadow-[3px_3px_0px_#111116] text-white select-none">
          {zoomClamped.toFixed(1)}×
        </span>

        <button type="button" title="Remove BG Noise"
          onClick={onRemoveBgNoise}
          disabled={!onRemoveBgNoise}
          className="p-1.5 rounded-xl bg-violet-400 border-2 border-violet-600 shadow-[3px_3px_0px_#5b21b6] hover:shadow-[1px_1px_0px_#5b21b6] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-all duration-100 disabled:opacity-40 disabled:pointer-events-none">
          <Image className="w-4 h-4 text-white" strokeWidth={2.5} />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" title="Nudge back 0.1s"
            onClick={() => nudge(-1, false)}
            className="p-1.5 rounded-xl bg-pink-400 border-2 border-pink-600 shadow-[3px_3px_0px_#9d174d] hover:shadow-[1px_1px_0px_#9d174d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-all duration-100">
            <ChevronLeft className="w-4 h-4 text-white" strokeWidth={2.5} />
          </button>

          <span className="tabular-nums w-16 text-center text-xs font-black text-brand-400 select-none">
            {formatPreciseTime(currentTime)}
          </span>

          <button type="button" title="Nudge forward 0.1s"
            onClick={() => nudge(1, false)}
            className="p-1.5 rounded-xl bg-pink-400 border-2 border-pink-600 shadow-[3px_3px_0px_#9d174d] hover:shadow-[1px_1px_0px_#9d174d] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-none active:translate-x-[3px] active:translate-y-[3px] transition-all duration-100">
            <ChevronRight className="w-4 h-4 text-white" strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div
        ref={ref}
        className="relative rounded-lg overflow-hidden bg-surface-700"
        style={{ height }}
        onMouseDown={(e) => {
          // Only seek if we're not hitting one of the handles. The handles
          // stop propagation themselves so this fires only on the bar.
          handleBarClick(e);
        }}
      >
        <svg width={width} height={height} className="block">
          {/* Waveform bars (skeleton while peaks load). */}
          {peaks.length === 0 ? (
            <g className="animate-pulse">
              {Array.from({ length: barCount }).map((_, i) => {
                const phase = (i / barCount) * Math.PI * 6;
                const h = Math.max(2, (Math.sin(phase) * 0.35 + Math.sin(phase * 0.5 + 1.7) * 0.25 + 0.45) * height * 0.6);
                return (
                  <rect
                    key={i}
                    x={i * (barWidth + gap)}
                    y={(height - h) / 2}
                    width={barWidth}
                    height={h}
                    rx={1}
                    fill="#3a3a44"
                  />
                );
              })}
            </g>
          ) : (
            bars.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={(height - b.h) / 2}
                width={barWidth}
                height={b.h}
                rx={1}
                fill="#9ca3af"
              />
            ))
          )}

          {/* Mask the excluded regions so the selected segment pops.
              Source-mode only — in splice mode the whole track IS the kept
              output, nothing is masked. */}
          {!spliceMode && (() => {
            const sx = clamp(startX, 0, width);
            const ex = clamp(endX, 0, width);
            return (
              <>
                {sx > 0 && <rect x={0} y={0} width={sx} height={height} fill="#000000" fillOpacity={0.55} />}
                {ex < width && <rect x={ex} y={0} width={Math.max(0, width - ex)} height={height} fill="#000000" fillOpacity={0.55} />}
              </>
            );
          })()}

          {/* Saved clips — one band per range, edges drawn as dividers.
              Off-window clips are skipped; partially-visible ones clamp to
              the viewport. Muted clips render grey with a strike-through. */}
          {savedClips.map((c) => {
            const cx = tToX(c.startTime);
            const cxe = tToX(c.endTime);
            if (cxe < 0 || cx > width) return null;
            const left = clamp(cx, 0, width);
            const right = clamp(cxe, 0, width);
            const bandW = Math.max(0, right - left);
            const startIsSplit = isSplitBoundaryT(c.startTime);
            const endIsSplit = isSplitBoundaryT(c.endTime);
            const bandFill = c.muted ? "#6b7280" : "#22c55e";
            const bandOpacity = c.muted ? 0.12 : 0.18;
            const edgeColor = c.muted ? "#6b7280" : "#22c55e";
            return (
              <g key={c.id} pointerEvents="none">
                <rect x={left} y={0} width={bandW} height={height} fill={bandFill} fillOpacity={bandOpacity} />
                {c.muted && bandW > 2 && (
                  <line
                    x1={left + 1} x2={right - 1} y1={height / 2} y2={height / 2}
                    stroke="#9ca3af" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="4 3"
                  />
                )}
                {onScreen(cx) && (
                  <line
                    x1={cx} x2={cx} y1={0} y2={height}
                    stroke={startIsSplit && !c.muted ? "#fef3c7" : edgeColor}
                    strokeWidth={startIsSplit && !c.muted ? 3 : 1.5}
                    strokeOpacity={startIsSplit && !c.muted ? 1 : 0.85}
                  />
                )}
                {onScreen(cxe) && (
                  <line
                    x1={cxe} x2={cxe} y1={0} y2={height}
                    stroke={endIsSplit && !c.muted ? "#fef3c7" : edgeColor}
                    strokeWidth={endIsSplit && !c.muted ? 3 : 1.5}
                    strokeOpacity={endIsSplit && !c.muted ? 1 : 0.85}
                  />
                )}
              </g>
            );
          })}

          {/* Selected segment tint (the in/out trim) — source mode only. */}
          {!spliceMode && (() => {
            const sx = clamp(startX, 0, width);
            const ex = clamp(endX, 0, width);
            return <rect x={sx} y={0} width={Math.max(0, ex - sx)} height={height} fill="#6366f1" fillOpacity={0.12} pointerEvents="none" />;
          })()}

          {/* Tentative mute selection between the first click and the playhead. */}
          {pendingMuteStart !== null && (() => {
            const a = tToX(pendingMuteStart);
            const b = playheadX;
            const x = clamp(Math.min(a, b), 0, width);
            const xr = clamp(Math.max(a, b), 0, width);
            return (
              <g pointerEvents="none">
                <rect x={x} y={0} width={Math.max(0, xr - x)} height={height} fill="#fbbf24" fillOpacity={0.18} />
                {onScreen(a) && (
                  <line x1={a} x2={a} y1={0} y2={height} stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 3" />
                )}
              </g>
            );
          })()}

          {/* Splice segments — numbered bands + dividers, positioned by their
              SEQUENCE offset (output order), so deleted parts are gone and
              reorders show in arrangement order. Read-only; editing is in the
              SpliceStrip below. */}
          {spliceMode && (() => {
            const offsets = segOffsets(spliceSegments);
            return spliceSegments.map((seg, i) => {
              const segStartSeq = offsets[i];
              const segEndSeq = segStartSeq + Math.max(0, seg.end - seg.start);
              const sx = tToX(segStartSeq);
              const sxe = tToX(segEndSeq);
              if (sxe < 0 || sx > width) return null;
              const left = clamp(sx, 0, width);
              const right = clamp(sxe, 0, width);
              const bw = Math.max(0, right - left);
              const selected = seg.id === selectedSpliceId;
              return (
                <g key={`seg-${seg.id}`} pointerEvents="none">
                  <rect
                    x={left} y={0} width={bw} height={height}
                    fill="#6366f1" fillOpacity={selected ? 0.28 : 0.12}
                  />
                  {onScreen(sx) && i > 0 && (
                    <line x1={sx} x2={sx} y1={0} y2={height} stroke="#a5b4fc" strokeWidth={2} />
                  )}
                  {bw > 14 && (
                    <text x={left + 4} y={14} fill="#c7d2fe" fontSize={11} fontWeight={700}>{i + 1}</text>
                  )}
                </g>
              );
            });
          })()}

          {/* Playhead line */}
          {onScreen(playheadX) && (
            <line x1={playheadX} x2={playheadX} y1={0} y2={height} stroke="#ffffff" strokeWidth={2} pointerEvents="none" />
          )}
        </svg>

        {/* Muted-region direct manipulation (move / resize / delete). DOM
            overlays so they get pointer events; rendered before the trim
            handles / playhead so those win z-order where they overlap. */}
        {onMuteRangeChange && onMuteDelete && savedClips.filter((c) => c.muted).map((c) => {
          const s = override?.id === c.id ? override.start : c.startTime;
          const e = override?.id === c.id ? override.end : c.endTime;
          const x = tToX(s);
          const xe = tToX(e);
          if (xe < 0 || x > width) return null;
          const left = clamp(x, 0, width);
          const right = clamp(xe, 0, width);
          const w = Math.max(MIN_HIT, right - left);
          const startVisible = onScreen(x);
          const endVisible = onScreen(xe);
          return (
            <div
              key={`mute-${c.id}`}
              className="absolute top-0 bottom-0"
              style={{ left, width: w, touchAction: "none" }}
            >
              <div
                onPointerDown={(ev) => beginRegionDrag(ev, c, "regionMove")}
                onMouseDown={(ev) => ev.stopPropagation()}
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                title="Drag to move this cut · drag an edge to resize · ✕ to delete"
              />
              {startVisible && (
                <div
                  onPointerDown={(ev) => beginRegionDrag(ev, c, "regionResizeL")}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  className="absolute top-0 bottom-0 -left-1 w-2.5 cursor-ew-resize"
                  title="Resize cut start"
                />
              )}
              {endVisible && (
                <div
                  onPointerDown={(ev) => beginRegionDrag(ev, c, "regionResizeR")}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  className="absolute top-0 bottom-0 -right-1 w-2.5 cursor-ew-resize"
                  title="Resize cut end"
                />
              )}
              {endVisible && (
                <button
                  type="button"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => { ev.stopPropagation(); onMuteDelete(c.id); }}
                  title="Delete this cut"
                  className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded bg-surface-900/80 text-surface-300 hover:text-white hover:bg-red-600 ring-1 ring-black/40 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* In/out trim handles — source mode only (splice has no single
            in/out; the sequence spans the whole track). */}
        {!spliceMode && (
          <>
            {/* Start handle (clipped by overflow-hidden when off-window) */}
            <div
              onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: "start" }); }}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize group"
              style={{ left: startX }}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-brand-400 group-hover:bg-brand-300" />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-6 bg-brand-500 rounded-sm shadow group-hover:bg-brand-400" />
            </div>

            {/* End handle */}
            <div
              onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: "end" }); }}
              className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize group"
              style={{ left: endX }}
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-brand-400 group-hover:bg-brand-300" />
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-6 bg-brand-500 rounded-sm shadow group-hover:bg-brand-400" />
            </div>
          </>
        )}

        {/* Playhead grab */}
        {onScreen(playheadX) && (
          <div
            onPointerDown={(e) => { e.stopPropagation(); setDrag({ kind: "playhead" }); }}
            className="absolute top-0 bottom-0 w-4 -ml-2 cursor-grab active:cursor-grabbing"
            style={{ left: playheadX }}
          >
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45" />
          </div>
        )}

        {/* Add-splice-point button — rides the playhead in splice mode and
            divides the segment under it into two. */}
        {spliceMode && onAddSplicePoint && onScreen(playheadX) && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onAddSplicePoint(); }}
            title="Add a splice point here (divide the segment)"
            className="absolute top-1 w-6 h-6 -ml-0.5 flex items-center justify-center rounded-md bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg ring-1 ring-black/40 transition-colors"
            style={{ left: scissorsLeft }}
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Razor button — rides the playhead when a split is allowed. */}
        {onSplit && onScreen(playheadX) && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSplit(); }}
            title={splitTooltip}
            className="absolute top-1 w-6 h-6 -ml-0.5 flex items-center justify-center rounded-md bg-brand-600 hover:bg-brand-500 text-white shadow-lg ring-1 ring-black/40 transition-colors"
            style={{ left: scissorsLeft }}
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Mute toggle button — sits next to the scissors. */}
        {onToggleMute && onScreen(playheadX) && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            title={playheadClipMuted ? "Un-mute segment" : "Mute segment (skip during playback)"}
            className={`absolute top-1 w-6 h-6 -ml-0.5 flex items-center justify-center rounded-md shadow-lg ring-1 ring-black/40 transition-colors text-white ${
              playheadClipMuted
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-surface-700 hover:bg-surface-600"
            }`}
            style={{ left: muteBtnLeft }}
          >
            {playheadClipMuted ? <Undo2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Overview / minimap — full source with a draggable window box. Only
          interactive once zoomed in. */}
      <div
        ref={ovRef}
        onMouseDown={handleOverviewClick}
        className={`relative mt-1.5 h-4 rounded bg-surface-700/60 overflow-hidden ${zoomClamped > 1 ? "cursor-pointer" : ""}`}
      >
        {zoomClamped > 1 && (() => {
          const boxLeft = ovToX(viewStartC);
          const boxW = Math.max(8, ovToX(viewEnd) - boxLeft);
          return (
            <div
              onPointerDown={(e) => beginOverviewDrag(e, "overviewMove")}
              onMouseDown={(e) => e.stopPropagation()}
              className="absolute top-0 bottom-0 bg-brand-500/30 border border-brand-400/70 rounded cursor-grab active:cursor-grabbing"
              style={{ left: boxLeft, width: boxW, touchAction: "none" }}
            >
              <div
                onPointerDown={(e) => beginOverviewDrag(e, "overviewResizeL")}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-0 bottom-0 -left-0.5 w-1.5 cursor-ew-resize bg-brand-300/70"
              />
              <div
                onPointerDown={(e) => beginOverviewDrag(e, "overviewResizeR")}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-0 bottom-0 -right-0.5 w-1.5 cursor-ew-resize bg-brand-300/70"
              />
            </div>
          );
        })()}
      </div>

      <div className="flex justify-between mt-2 text-xs text-surface-500">
        <span>{formatDuration(viewStartC)}</span>
        <span>
          {spliceMode ? (
            <>Sequence: <span className="text-white">{formatDuration(effectiveDuration)}</span></>
          ) : (
            <>Clip: <span className="text-white">{formatDuration(endTime - startTime)}</span></>
          )}
          {zoomClamped > 1 && <span className="text-surface-600"> · viewing {formatPreciseTime(viewDuration)}</span>}
        </span>
        <span>{formatDuration(viewEnd)}</span>
      </div>
    </div>
  );
}
