"use client";

import { useRef, useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import type { Segment } from "@/lib/splice";

export type { Segment };

interface Props {
  segments: Segment[];
  selectedId: string | null;
  onReorder: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}

// Ordered, reorderable strip of splice segments shown below the waveform.
// Each block = one piece of the final stitched clip, in play/export order.
// Drag a block to reorder (native HTML5 DnD), ✕ to drop it, click to select
// (highlights it on the waveform).
export default function SpliceStrip({
  segments, selectedId, onReorder, onDelete, onSelect,
}: Props) {
  const dragFrom = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  if (segments.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-surface-500">
        Splice mode — move the playhead and tap the scissors on the track to add a
        splice point. Segments will appear here to reorder and arrange.
      </div>
    );
  }

  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);

  return (
    <div className="px-4 py-3 border-t border-surface-700">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-surface-500 uppercase tracking-wider">
          Sequence ({segments.length}) · {formatDuration(total)}
        </span>
        <span className="text-[11px] text-surface-600">— 🗑 deletes a part from the exported video</span>
      </div>

      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {segments.map((seg, i) => {
          const selected = seg.id === selectedId;
          const isOver = overIdx === i;
          return (
            <div
              key={seg.id}
              draggable
              onDragStart={() => { dragFrom.current = i; }}
              onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
              onDragLeave={() => setOverIdx((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                setOverIdx(null);
                dragFrom.current = null;
                if (from !== null && from !== i) onReorder(from, i);
              }}
              onDragEnd={() => { dragFrom.current = null; setOverIdx(null); }}
              onClick={() => onSelect(seg.id)}
              className={`group relative shrink-0 w-32 rounded-lg border px-2.5 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                selected
                  ? "border-indigo-400 bg-indigo-900/40"
                  : "border-surface-600 bg-surface-700/60 hover:border-surface-500"
              } ${isOver ? "ring-2 ring-indigo-400" : ""}`}
              title="Drag to reorder · click to select on the track"
            >
              <div className="flex items-center gap-1 mb-1">
                <GripVertical className="w-3 h-3 text-surface-500 shrink-0" />
                <span className="text-[11px] font-bold text-indigo-300">#{i + 1}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete this part of the video? It won't appear in the exported clip. You can undo with Ctrl+Z.")) {
                      onDelete(seg.id);
                    }
                  }}
                  className="ml-auto text-surface-500 hover:text-red-400 transition-colors"
                  title="Delete this part — permanently removed from the final video"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-surface-300 tabular-nums leading-tight">
                {formatDuration(seg.start)} – {formatDuration(seg.end)}
              </p>
              <p className="text-[10px] text-surface-500 tabular-nums">
                {(seg.end - seg.start).toFixed(1)}s
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
