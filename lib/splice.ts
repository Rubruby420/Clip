// Sequence ↔ source mapping for the splice tool.
//
// A spliced clip is an ORDERED list of source-time segments. The array order
// is the play/export order, and segments can be reordered — so source time is
// NOT monotonic across the sequence. All mapping must therefore go by segment
// index + cumulative offset, never by sorting or searching on source time.

// A source-time range. Full splice Segments (with an id) satisfy this too, so
// the mapping helpers work for both stored segments and the preview's plain
// {start,end} play-ranges.
export interface Range {
  start: number; // source seconds
  end: number;   // source seconds
}

export interface Segment extends Range {
  id: string;
}

/** Total duration of the stitched output (sum of kept segment durations). */
export function seqTotal(segs: readonly Range[]): number {
  return segs.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
}

/** Cumulative sequence-start time for each segment index. */
export function segOffsets(segs: readonly Range[]): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const s of segs) {
    offsets.push(acc);
    acc += Math.max(0, s.end - s.start);
  }
  return offsets;
}

/** Clamp a sequence position to [0, seqTotal]. */
export function clampSeq(segs: readonly Range[], p: number): number {
  return Math.max(0, Math.min(seqTotal(segs), p));
}

/**
 * Map a sequence position (output seconds) to the underlying source time,
 * plus which segment it lands in. Clamps p into range.
 */
export function seqToSource(
  segs: readonly Range[],
  p: number,
): { srcTime: number; segIndex: number; localOffset: number } {
  if (segs.length === 0) return { srcTime: 0, segIndex: 0, localOffset: 0 };
  const total = seqTotal(segs);
  const clamped = Math.max(0, Math.min(total, p));
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const dur = Math.max(0, segs[i].end - segs[i].start);
    // Last segment owns the right edge so p === total maps to its end.
    if (clamped < acc + dur || i === segs.length - 1) {
      const local = clamped - acc;
      return { srcTime: segs[i].start + local, segIndex: i, localOffset: acc };
    }
    acc += dur;
  }
  // Unreachable, but keep TS happy.
  const last = segs[segs.length - 1];
  return { srcTime: last.end, segIndex: segs.length - 1, localOffset: total };
}

/**
 * Map a source time within a KNOWN segment index back to sequence position.
 * The active index is required — the same source second can belong to zero or
 * several kept segments after a reorder, so it can't be inferred from srcT.
 */
export function sourceToSeq(segs: readonly Range[], srcT: number, segIndex: number): number {
  if (segIndex < 0 || segIndex >= segs.length) return 0;
  const offsets = segOffsets(segs);
  const seg = segs[segIndex];
  return offsets[segIndex] + Math.max(0, srcT - seg.start);
}
