"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Scissors } from "lucide-react";
import { formatDuration } from "@/lib/utils";

interface SavedClipRange {
  id: string;
  startTime: number;
  endTime: number;
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
  // the user can split the clip under it. Parent controls when this is
  // active (typically only when the playhead is inside a saved clip).
  onSplit?: () => void;
}

type DragMode = "start" | "end" | "playhead" | null;

// SVG-based waveform timeline. Renders one vertical bar per peak with the
// trimmed-out regions masked, draggable in/out handles, and a playhead
// you can grab to scrub. Clicking the bar (outside the handles) seeks.
export default function WaveformTimeline({
  peaks, duration, startTime, endTime, currentTime,
  onStartChange, onEndChange, onSeek, savedClips = [], onSplit,
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
              segments instead of one big block. */}
          {savedClips.map((c) => {
            const cx = tToX(c.startTime);
            const cw = Math.max(1, tToX(c.endTime) - cx);
            return (
              <g key={c.id} pointerEvents="none">
                <rect x={cx} y={0} width={cw} height={height} fill="#22c55e" fillOpacity={0.18} />
                <line x1={cx} x2={cx} y1={0} y2={height} stroke="#22c55e" strokeWidth={1.5} strokeOpacity={0.85} />
                <line
                  x1={cx + cw}
                  x2={cx + cw}
                  y1={0}
                  y2={height}
                  stroke="#22c55e"
                  strokeWidth={1.5}
                  strokeOpacity={0.85}
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
            right of the line so it doesn't sit on top of the diamond. */}
        {onSplit && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSplit(); }}
            title="Split clip at playhead"
            className="absolute top-1 w-6 h-6 -ml-0.5 flex items-center justify-center rounded-md bg-brand-600 hover:bg-brand-500 text-white shadow-lg ring-1 ring-black/40 transition-colors"
            style={{ left: playheadX + 8 }}
          >
            <Scissors className="w-3.5 h-3.5" />
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
