"use client";

import { useRef, useCallback } from "react";
import { formatDuration } from "@/lib/utils";

interface Props {
  duration: number;
  startTime: number;
  endTime: number;
  currentTime: number;
  onStartChange: (t: number) => void;
  onEndChange: (t: number) => void;
  onSeek: (t: number) => void;
  // Waveform peaks: one value per bucket, 0-1 normalized.
  // `videoDuration` must match the peaks array's total time span.
  peaks?: number[];
  videoDuration?: number;
}

// Render 120 amplitude bars across the visible track.
function WaveformBars({ peaks, videoDuration, duration }: {
  peaks: number[]; videoDuration: number; duration: number;
}) {
  const BAR_COUNT = 120;
  const bars: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const t = (i / BAR_COUNT) * duration;
    const srcIdx = Math.floor((t / videoDuration) * peaks.length);
    bars.push(peaks[Math.min(srcIdx, peaks.length - 1)] ?? 0);
  }
  return (
    <div className="absolute inset-0 flex items-end gap-px px-px pointer-events-none z-0" aria-hidden>
      {bars.map((amp, i) => (
        <div
          key={i}
          className="flex-1 bg-brand-500/25 rounded-t-sm"
          style={{ height: `${Math.max(4, amp * 90)}%` }}
        />
      ))}
    </div>
  );
}

export default function Timeline({
  duration, startTime, endTime, currentTime, onStartChange, onEndChange, onSeek,
  peaks, videoDuration,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

  const toPercent = (t: number) => (t / duration) * 100;

  const clickTrack = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct * duration);
  }, [duration, onSeek]);

  return (
    <div className="px-4 py-3 bg-surface-800 border-t border-surface-600 select-none">
      {/* Time labels */}
      <div className="flex justify-between text-xs text-surface-500 mb-2">
        <span>{formatDuration(startTime)}</span>
        <span className="text-brand-400">{formatDuration(currentTime)}</span>
        <span>{formatDuration(endTime)}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-10 bg-surface-700 rounded-lg cursor-pointer overflow-hidden"
        onClick={clickTrack}
      >
        {/* Waveform amplitude bars (behind everything else) */}
        {peaks && peaks.length > 0 && videoDuration && videoDuration > 0 && (
          <WaveformBars peaks={peaks} videoDuration={videoDuration} duration={duration} />
        )}

        {/* Excluded region (before startTime) */}
        <div
          className="absolute top-0 left-0 h-full bg-black/50"
          style={{ width: `${toPercent(startTime)}%` }}
        />
        {/* Selected region */}
        <div
          className="absolute top-0 h-full bg-brand-600/30 border-x-2 border-brand-500"
          style={{
            left: `${toPercent(startTime)}%`,
            width: `${toPercent(endTime - startTime)}%`,
          }}
        />
        {/* Excluded region (after endTime) */}
        <div
          className="absolute top-0 right-0 h-full bg-black/50"
          style={{ width: `${toPercent(duration - endTime)}%` }}
        />
        {/* Playhead */}
        <div
          className="absolute top-0 w-0.5 h-full bg-white z-10"
          style={{ left: `${toPercent(currentTime)}%` }}
        />

        {/* Start handle */}
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={startTime}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (v < endTime - 2) onStartChange(v);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
          style={{ pointerEvents: "none" }}
        />
      </div>

      {/* Trim sliders */}
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-500 w-12">Start</span>
          <input
            type="range" min={0} max={duration} step={0.1} value={startTime}
            onChange={(e) => { const v = parseFloat(e.target.value); if (v < endTime - 2) onStartChange(v); }}
            className="flex-1"
          />
          <span className="text-xs text-white w-12 text-right">{formatDuration(startTime)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-500 w-12">End</span>
          <input
            type="range" min={0} max={duration} step={0.1} value={endTime}
            onChange={(e) => { const v = parseFloat(e.target.value); if (v > startTime + 2) onEndChange(v); }}
            className="flex-1"
          />
          <span className="text-xs text-white w-12 text-right">{formatDuration(endTime)}</span>
        </div>
      </div>

      {/* Duration info */}
      <div className="flex justify-center mt-2">
        <span className="text-xs text-surface-500">
          Clip duration: <span className="text-white">{formatDuration(endTime - startTime)}</span>
        </span>
      </div>
    </div>
  );
}
