// Detect talking segments from a waveform peaks array.
//
// Approach: threshold against a percentile of the peaks (robust to clip-
// to-clip volume differences), then merge near-by talking runs and drop
// tiny noise blips. Padding is added around each segment so words don't
// start mid-syllable.
//
// Tuning rationale:
//   - silenceThreshold 0.10 of p90: captures normal speech reliably while
//     rejecting quiet room tone / breathing.
//   - minSilenceGap 0.7s: pauses shorter than this stay inside the same
//     segment (natural speech rhythm).
//   - minSegmentLength 1.2s: anything shorter is almost certainly noise,
//     a cough, or a one-syllable interjection — not worth a clip.
//   - padding 0.25s on each side: keeps the segment from cutting on the
//     first/last phoneme.

// Minimum meaningful duration (seconds) for any clip or cut/mute region.
// Anything shorter is a useless sub-pixel sliver on the timeline, so we
// refuse to create it and clamp manual resizes against it. Shared by the
// source editor, the clip-create route, and the split route. Comfortably
// below detectTalkSegments' 1.2s floor, so auto-cut is never affected.
export const MIN_CUT = 0.3;

export interface TalkSegment {
  start: number;
  end: number;
}

export interface DetectOptions {
  silenceThreshold?: number;
  minSilenceGap?: number;
  minSegmentLength?: number;
  padding?: number;
}

export function detectTalkSegments(
  peaks: number[],
  duration: number,
  opts: DetectOptions = {},
): TalkSegment[] {
  if (!Array.isArray(peaks) || peaks.length === 0 || duration <= 0) return [];

  const silenceThreshold = opts.silenceThreshold ?? 0.10;
  const minSilenceGap = opts.minSilenceGap ?? 0.7;
  const minSegmentLength = opts.minSegmentLength ?? 1.2;
  const padding = opts.padding ?? 0.25;

  // Percentile-based amplitude floor — robust to outliers and
  // normalisation differences between recordings.
  const sorted = [...peaks].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const amp = p90 * silenceThreshold;
  if (amp <= 0) return [];

  const secPerBin = duration / peaks.length;

  // Pass 1 — collect raw above-threshold runs.
  const raw: TalkSegment[] = [];
  let inRun = false;
  let runStart = 0;
  for (let i = 0; i < peaks.length; i++) {
    const t = i * secPerBin;
    const loud = peaks[i] >= amp;
    if (loud && !inRun) {
      inRun = true;
      runStart = t;
    } else if (!loud && inRun) {
      inRun = false;
      raw.push({ start: runStart, end: t });
    }
  }
  if (inRun) raw.push({ start: runStart, end: duration });

  // Pass 2 — merge runs separated by gaps shorter than minSilenceGap. Two
  // talkers separated by a 0.3s breath are the same thought and should
  // stay one segment.
  const merged: TalkSegment[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < minSilenceGap) {
      last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }

  // Pass 3 — drop too-short segments (noise / single-syllable blips).
  const kept = merged.filter((s) => s.end - s.start >= minSegmentLength);

  // Pass 4 — pad and clamp so words aren't cut at the edges.
  return kept.map((s) => ({
    start: Math.max(0, s.start - padding),
    end: Math.min(duration, s.end + padding),
  }));
}
