"use client";

import { Scissors, Loader2 } from "lucide-react";
import { formatDuration } from "@/lib/utils";

interface Props {
  disabled: boolean;
  busy?: boolean;
  applied: boolean;
  sensitivity: number; // 0..1
  onSensitivityChange: (v: number) => void;
  onRemoveSilences: () => void;
  segmentCount: number;
  keptDuration: number;
  removedDuration: number;
  gapCount: number;
  totalDuration: number;
}

// Splice-mode control bar for the one-click "waveform cut": detect the talking
// parts and drop every non-speaking gap, leaving one continuous clip. The
// sensitivity dial re-detects live once silences have been removed.
export default function SilenceControls({
  disabled, busy, applied, sensitivity, onSensitivityChange, onRemoveSilences,
  segmentCount, keptDuration, removedDuration, gapCount, totalDuration,
}: Props) {
  return (
    <div className="px-4 py-3 border-t border-surface-700 flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        onClick={onRemoveSilences}
        disabled={disabled || busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors"
        title={
          disabled
            ? "Waveform still preparing — hang on a moment"
            : "Detect the talking parts and remove every non-speaking gap"
        }
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
        {applied ? "Re-cut silences" : "Remove silences"}
      </button>

      <label className="flex items-center gap-2 text-xs text-surface-400">
        <span className="uppercase tracking-wider text-[11px] text-surface-500">Sensitivity</span>
        <span className="text-[10px] text-surface-600">Gentle</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sensitivity}
          disabled={disabled}
          onChange={(e) => onSensitivityChange(Number(e.target.value))}
          className="w-32 accent-indigo-500 disabled:opacity-50"
          title="Lower = only cut long, clearly-silent gaps · Higher = also cut shorter pauses"
        />
        <span className="text-[10px] text-surface-600">Aggressive</span>
      </label>

      {applied && (
        <span className="text-[11px] text-surface-400 tabular-nums">
          Kept <span className="text-white font-semibold">{segmentCount}</span> part{segmentCount === 1 ? "" : "s"}
          {" · "}
          <span className="text-white font-semibold">{formatDuration(keptDuration)}</span>
          {" of "}{formatDuration(totalDuration)}
          {" · removed "}
          <span className="text-white font-semibold">{gapCount}</span> silent gap{gapCount === 1 ? "" : "s"}
          {" ("}{formatDuration(removedDuration)}{")"}
        </span>
      )}
    </div>
  );
}
