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

// Group Whisper word-timestamps into conversation segments.
//
// Unlike detectTalkSegments (which gates on loudness), this function only
// fires on real speech — Whisper doesn't emit words over music, bangs, or
// applause, so those sections are naturally ignored.
//
// Tuning rationale for stream / gaming / podcast content:
//   - minSilenceGap 1.5s: speakers pause 1–2s between thoughts; 0.7s was
//     splitting mid-thought and creating many tiny segments that then got
//     dropped by the length filter.
//   - minSegmentLength 0.8s: catches genuine short utterances ("alright",
//     "yeah") that are real speech, not noise.
//   - orphanAbsorb 3.0s: a short orphan within 3s of the next segment gets
//     pulled INTO that segment instead of being silently dropped. Fixes the
//     "alright [pause] main speech" case — the clip starts at "alright".
//   - padding 0.4s: more breathing room so playback doesn't start mid-word.
export function groupSpeechSegments(
  words: { start: number; end: number }[],
  duration: number,
  opts: { minSilenceGap?: number; minSegmentLength?: number; padding?: number } = {},
): TalkSegment[] {
  if (!Array.isArray(words) || words.length === 0 || duration <= 0) return [];

  const minSilenceGap    = opts.minSilenceGap    ?? 1.5;
  const minSegmentLength = opts.minSegmentLength ?? 0.8;
  const padding          = opts.padding          ?? 0.4;
  const orphanAbsorb     = 3.0; // absorb a short segment into a neighbor within this gap

  // Sort by start time — Whisper is usually in order but be safe.
  const sorted = [...words].sort((a, b) => a.start - b.start);

  // Pass 1 — merge words separated by < minSilenceGap into one segment.
  const merged: TalkSegment[] = [];
  let segStart = sorted[0].start;
  let segEnd   = sorted[0].end;

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i];
    if (w.start - segEnd < minSilenceGap) {
      segEnd = Math.max(segEnd, w.end);
    } else {
      merged.push({ start: segStart, end: segEnd });
      segStart = w.start;
      segEnd   = w.end;
    }
  }
  merged.push({ start: segStart, end: segEnd });

  // Pass 2 — absorb short orphan segments into the nearest adjacent segment
  // when the gap between them is ≤ orphanAbsorb. This fixes cases like
  // "alright [2s gap] main conversation": the short word pulls the adjacent
  // clip's boundary back to include it, rather than being silently dropped.
  // Loop until stable (handles runs of consecutive short segments).
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      const s = merged[i];
      if (s.end - s.start >= minSegmentLength) continue; // not short, skip

      const prev = i > 0 ? merged[i - 1] : null;
      const next = i < merged.length - 1 ? merged[i + 1] : null;
      const gapToPrev = prev ? s.start - prev.end : Infinity;
      const gapToNext = next ? next.start - s.end : Infinity;
      const nearPrev  = gapToPrev <= orphanAbsorb;
      const nearNext  = gapToNext <= orphanAbsorb;

      if (!nearPrev && !nearNext) continue; // truly isolated — Pass 3 will drop it

      if (nearPrev && (!nearNext || gapToPrev <= gapToNext)) {
        // Absorb backward: extend the previous segment's end to cover this one.
        merged[i - 1] = { start: merged[i - 1].start, end: Math.max(merged[i - 1].end, s.end) };
      } else {
        // Absorb forward: extend the next segment's start to cover this one.
        merged[i + 1] = { start: Math.min(merged[i + 1].start, s.start), end: merged[i + 1].end };
      }
      merged.splice(i, 1);
      changed = true;
      break; // restart — splicing invalidates indices
    }
  }

  // Pass 3 — drop stray isolated blips with no neighbor to absorb them.
  const kept = merged.filter((s) => s.end - s.start >= minSegmentLength);

  // Pass 4 — pad and clamp so playback starts/ends on a full word.
  return kept.map((s) => ({
    start: Math.max(0, s.start - padding),
    end:   Math.min(duration, s.end + padding),
  }));
}

// Map a single 0..1 "sensitivity" dial onto detectTalkSegments options so the
// UI never exposes raw thresholds. 0 = gentle (only long, clearly-silent gaps
// are cut), 1 = aggressive (shorter, less-quiet pauses are cut too). 0.5 lands
// close to the function's own defaults.
export function sensitivityToOpts(sensitivity: number): DetectOptions {
  const s = Math.max(0, Math.min(1, sensitivity));
  return {
    silenceThreshold: 0.06 + s * 0.12, // 0.06 → 0.18 of p90
    minSilenceGap: 1.2 - s * 0.85,     // 1.2s → 0.35s
  };
}

// Readout for the "remove silences" UI: how much of the source survives, how
// much was dropped, and how many distinct silent gaps were cut (leading,
// trailing, and between kept segments). Order-independent.
export function summarizeSilenceRemoval(
  segments: readonly { start: number; end: number }[],
  duration: number,
): { keptDuration: number; removedDuration: number; gapCount: number } {
  if (!Array.isArray(segments) || segments.length === 0 || duration <= 0) {
    return { keptDuration: 0, removedDuration: 0, gapCount: 0 };
  }
  const ordered = [...segments].sort((a, b) => a.start - b.start);
  const kept = ordered.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  const EPS = 0.05; // ignore sub-frame slivers
  let gapCount = 0;
  if (ordered[0].start > EPS) gapCount++;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start - ordered[i - 1].end > EPS) gapCount++;
  }
  if (ordered[ordered.length - 1].end < duration - EPS) gapCount++;
  const keptDuration = Math.min(kept, duration);
  return { keptDuration, removedDuration: Math.max(0, duration - keptDuration), gapCount };
}
