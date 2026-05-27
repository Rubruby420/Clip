"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Scissors, Ban, Undo2 } from "lucide-react";
import { formatDuration } from "@/lib/utils";

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
}

type DragMode = "start" | "end" | "playhead" | null;

// SVG-based waveform timeline. Renders one vertical bar per peak with the
// trimmed-out regions masked, draggable in/out handles, and a playhead
// you can grab to scrub. Clicking the bar (outside the handles) seeks.
export default function WaveformTimeline({
  peaks, duration, startTime, endTime, currentTime,
  onStartChange, onEndChange, onSeek, savedClips = [], onSplit,
  splitTooltip = "Split clip at playhead",
  onToggleMute, playheadClipMuted = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<DragMode>(null);
  const dragRef = useRef<DragMode>(null);

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
  const safeDuration = duration > 0 ? duration : 1;
  const tToX = useCallback((t: number) => (Math.max(0, Math.min(safeDuration, t)) / safeDuration) * width, [safeDuration, width]);
  const xToT = useCallback((x: number) => Math.max(0, Math.min(safeDuration, (x / width) * safeDuration)), [safeDuration, width]);

  const startX = tToX(startTime);
  const endX = tToX(endTime);
  const playheadX = tToX(currentTime);

  // Split-boundary detection — when two saved clips meet (e.g. after a
  // razor cut), we want the shared edge to read as a "this is a split"
  // marker, not just another clip edge. We collect every time T where
  // some clip ends AND another starts within 50ms float-slop, then
  // render those Xs in a contrasting accent instead of the subdued
  // green clip-edge stroke.
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
  // pointer leaves the SVG. dragRef mirrors drag state for handlers
  // attached only once at drag start.
  useEffect(() => {
    if (!drag) return;
    dragRef.current = drag;
    const onMove = (e: PointerEvent) => {
      if (!ref.current || !dragRef.current) return;
      const rect = ref.current.getBoundingClientRect();
      const t = xToT(e.clientX - rect.left);
      if (dragRef.current === "start") onStartChange(Math.min(t, endTime - 0.5));
      else if (dragRef.current === "end") onEndChange(Math.max(t, startTime + 0.5));
      else if (dragRef.current === "playhead") onSeek(t);
    };
    const onUp = () => { dragRef.current = null; setDrag(null); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [drag, endTime, startTime, xToT, onStartChange, onEndChange, onSeek]);

  function handleBarClick(e: React.MouseEvent) {
    if (drag) return;
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    onSeek(xToT(e.clientX - rect.left));
  }

  // Bar count is whatever fits; if peaks > width we down-sample by index.
  const barWidth = 2;
  const gap = 1;
  const barCount = Math.max(1, Math.floor(width / (barWidth + gap)));
  const bars: { x: number; h: number }[] = [];
  if (peaks.length > 0) {
    for (let i = 0; i < barCount; i++) {
      const peakIdx = Math.floor((i / barCount) * peaks.length);
      const v = peaks[peakIdx] ?? 0;
      const h = Math.max(1, v * height * 0.92);
      bars.push({ x: i * (barWidth + gap), h });
    }
  }

  return (
    <div className="px-4 py-3 bg-surface-800 border-t border-surface-600 select-none">
      <div className="flex justify-between text-xs text-surface-500 mb-2">
        <span>{formatDuration(startTime)}</span>
        <span className="text-brand-400">{formatDuration(currentTime)}</span>
        <span>{formatDuration(endTime)}</span>
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
          {/* Waveform bars. When peaks aren't ready yet we render a
              shimmer-style skeleton of varying-height bars so the area
              looks like it's loading, not broken. A flat 2px line read
              as "this thing is empty / unavailable." */}
          {peaks.length === 0 ? (
            <g className="animate-pulse">
              {Array.from({ length: barCount }).map((_, i) => {
                // Smooth pseudo-random heights so the skeleton has the
                // visual rhythm of a real waveform without claiming to
                // be real data. Two superposed sines + offset to avoid
                // a perfect repeat.
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

          {/* Mask the excluded regions so the selected segment pops. */}
          {startX > 0 && (
            <rect x={0} y={0} width={startX} height={height} fill="#000000" fillOpacity={0.55} />
          )}
          {endX < width && (
            <rect x={endX} y={0} width={width - endX} height={height} fill="#000000" fillOpacity={0.55} />
          )}

          {/* Saved clips — one green band per range, plus a vertical
              divider on either edge so adjacent clips read as distinct
              segments instead of one big block. Boundaries that are
              shared with another clip (i.e. razor splits) get a brighter,
              wider yellow accent so the split is unmistakable. The
              band itself is also inset by 1px on each side so adjacent
              green tints don't fuse into a solid block. Muted clips
              render in grey with a horizontal strike-through so they
              read as "this part has been removed from playback." */}
          {savedClips.map((c) => {
            const cx = tToX(c.startTime);
            const cw = Math.max(1, tToX(c.endTime) - cx);
            const startIsSplit = isSplitBoundaryT(c.startTime);
            const endIsSplit = isSplitBoundaryT(c.endTime);
            const bandFill = c.muted ? "#6b7280" : "#22c55e";
            const bandOpacity = c.muted ? 0.12 : 0.18;
            const edgeColor = c.muted ? "#6b7280" : "#22c55e";
            return (
              <g key={c.id} pointerEvents="none">
                <rect
                  x={cx + 1}
                  y={0}
                  width={Math.max(1, cw - 2)}
                  height={height}
                  fill={bandFill}
                  fillOpacity={bandOpacity}
                />
                {c.muted && (
                  <line
                    x1={cx + 1}
                    x2={cx + cw - 1}
                    y1={height / 2}
                    y2={height / 2}
                    stroke="#9ca3af"
                    strokeWidth={2}
                    strokeOpacity={0.85}
                    strokeDasharray="4 3"
                  />
                )}
                <line
                  x1={cx}
                  x2={cx}
                  y1={0}
                  y2={height}
                  stroke={startIsSplit && !c.muted ? "#fef3c7" : edgeColor}
                  strokeWidth={startIsSplit && !c.muted ? 3 : 1.5}
                  strokeOpacity={startIsSplit && !c.muted ? 1 : 0.85}
                />
                <line
                  x1={cx + cw}
                  x2={cx + cw}
                  y1={0}
                  y2={height}
                  stroke={endIsSplit && !c.muted ? "#fef3c7" : edgeColor}
                  strokeWidth={endIsSplit && !c.muted ? 3 : 1.5}
                  strokeOpacity={endIsSplit && !c.muted ? 1 : 0.85}
                />
              </g>
            );
          })}

          {/* Selected segment tint */}
          <rect
            x={startX}
            y={0}
            width={Math.max(0, endX - startX)}
            height={height}
            fill="#6366f1"
            fillOpacity={0.12}
            pointerEvents="none"
          />

          {/* Playhead line */}
          <line
            x1={playheadX}
            x2={playheadX}
            y1={0}
            y2={height}
            stroke="#ffffff"
            strokeWidth={2}
            pointerEvents="none"
          />
        </svg>

        {/* Start handle */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); setDrag("start"); }}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize group"
          style={{ left: startX }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-brand-400 group-hover:bg-brand-300" />
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-6 bg-brand-500 rounded-sm shadow group-hover:bg-brand-400" />
        </div>

        {/* End handle */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); setDrag("end"); }}
          className="absolute top-0 bottom-0 w-3 -ml-1.5 cursor-ew-resize group"
          style={{ left: endX }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-brand-400 group-hover:bg-brand-300" />
          <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-3 h-6 bg-brand-500 rounded-sm shadow group-hover:bg-brand-400" />
        </div>

        {/* Playhead grab */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); setDrag("playhead"); }}
          className="absolute top-0 bottom-0 w-4 -ml-2 cursor-grab active:cursor-grabbing"
          style={{ left: playheadX }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3 bg-white rotate-45" />
        </div>

        {/* Razor button — appears on the playhead when the parent allows
            a split (i.e. the playhead is inside a saved clip). Offset
            right of the line so it doesn't sit on top of the diamond.
            stopPropagation on BOTH pointerdown and mousedown — mouse
            events are a separate stream from pointer events, and the
            parent's onMouseDown=handleBarClick would otherwise seek the
            playhead to the click X, moving the button out from under
            the cursor before mouseup fires (so click never lands). */}
        {onSplit && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSplit(); }}
            title={splitTooltip}
            className="absolute top-1 w-6 h-6 -ml-0.5 flex items-center justify-center rounded-md bg-brand-600 hover:bg-brand-500 text-white shadow-lg ring-1 ring-black/40 transition-colors"
            style={{ left: playheadX + 8 }}
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Mute toggle button — sits to the right of the scissors.
            Same stopPropagation treatment for the same reason. Icon
            and tooltip flip based on the current muted state of the
            clip under the playhead. */}
        {onToggleMute && (
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
            style={{ left: playheadX + 36 }}
          >
            {playheadClipMuted ? <Undo2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      <div className="flex justify-center mt-2">
        <span className="text-xs text-surface-500">
          Clip duration: <span className="text-white">{formatDuration(endTime - startTime)}</span>
        </span>
      </div>
    </div>
  );
}
