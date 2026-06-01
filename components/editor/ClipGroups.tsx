"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown, Pencil } from "lucide-react";
import { formatDuration } from "@/lib/utils";

// One clip row's worth of data. Parent passes clips ALREADY sorted into the
// order they should be numbered (creation order — Clip 1 = first saved).
export interface ClipGroupItem {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
}

const GROUP_SIZE = 12;

// Group index -> letter, spreadsheet-style so it never runs out after Z:
// 0->A … 25->Z, 26->AA, 27->AB, … (bijective base 26).
function groupLetter(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// Auto-organizes a flat clip list into collapsible groups of 12, labeled A–Z
// (then AA, AB…). Numbering is global and continuous (Clip 1..N) across groups.
// Collapse state is per-group (keyed by letter, so it survives rebalancing when
// a clip is deleted) and persisted to localStorage per project.
export default function ClipGroups({
  projectId,
  clips,
  onRenameClip,
}: {
  projectId: string;
  clips: ClipGroupItem[];
  // Persist a clip's new title. The parent owns the data; this component owns
  // only the inline edit-field UI.
  onRenameClip?: (id: string, title: string) => void | Promise<void>;
}) {
  const storageKey = `clipGroups:open:${projectId}`;

  // Default: all collapsed. Load persisted open-state after mount (not during
  // render) so the SSR'd HTML and first client render match — avoids a
  // hydration mismatch.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setOpen(JSON.parse(raw));
    } catch {
      /* ignore malformed/unavailable storage */
    }
  }, [storageKey]);

  function toggle(letter: string) {
    setOpen((prev) => {
      const next = { ...prev, [letter]: !prev[letter] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Inline rename state. Only one row edits at a time. escapeRef lets the blur
  // handler distinguish an Escape-triggered blur (cancel) from a normal
  // save-on-blur, and routing Enter through .blur() means we commit exactly
  // once instead of from both the keydown and the blur.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const escapeRef = useRef(false);

  function startEdit(c: ClipGroupItem) {
    setEditingId(c.id);
    setDraft(c.title);
  }
  async function commitEdit(id: string) {
    const title = draft.trim();
    setEditingId(null);
    setDraft("");
    if (title && onRenameClip) await onRenameClip(id, title);
  }

  // Empty state is handled by the parent (it shows a hint when there are no
  // clips), so render nothing here.
  if (clips.length === 0) return null;

  const groups: { letter: string; start: number; items: ClipGroupItem[] }[] = [];
  for (let i = 0; i < clips.length; i += GROUP_SIZE) {
    groups.push({
      letter: groupLetter(i / GROUP_SIZE),
      start: i,
      items: clips.slice(i, i + GROUP_SIZE),
    });
  }

  return (
    <div className="space-y-1">
      {groups.map((g) => {
        const isOpen = !!open[g.letter];
        const startNum = g.start + 1;
        const endNum = g.start + g.items.length;
        return (
          <div key={g.letter}>
            <button
              type="button"
              onClick={() => toggle(g.letter)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-1.5 px-1 py-1.5 text-left text-white font-bold text-xs hover:text-brand-200 transition-colors"
            >
              {isOpen ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {g.letter} Clips {startNum}-{endNum}
              </span>
            </button>

            {isOpen && (
              <div className="space-y-1.5 pl-4 pb-1">
                {g.items.map((c, idx) => {
                  const globalNum = g.start + idx + 1;
                  const isEditing = editingId === c.id;
                  return (
                    <div
                      key={c.id}
                      className="rounded-lg bg-surface-700/50 hover:bg-surface-700 transition-colors"
                    >
                      {isEditing ? (
                        <div className="p-2">
                          <div className="flex items-center gap-1 text-[11px]">
                            <span className="text-surface-400 shrink-0">Clip {globalNum} —</span>
                            <input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
                                else if (e.key === "Escape") { escapeRef.current = true; e.currentTarget.blur(); }
                              }}
                              onBlur={() => {
                                if (escapeRef.current) { escapeRef.current = false; setEditingId(null); setDraft(""); return; }
                                commitEdit(c.id);
                              }}
                              className="flex-1 min-w-0 bg-surface-900 border border-brand-600 focus:border-brand-400 rounded px-1.5 py-0.5 text-white text-[11px] outline-none"
                              aria-label={`Rename clip ${globalNum}`}
                            />
                          </div>
                          <p className="text-[10px] text-surface-500 tabular-nums mt-1">
                            {formatDuration(c.startTime)} – {formatDuration(c.endTime)}
                            <span className="text-surface-600"> · {formatDuration(c.endTime - c.startTime)}</span>
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <Link href={`/edit/${c.id}`} className="block flex-1 min-w-0 p-2">
                            <p className="text-[11px] text-surface-200 font-normal truncate">
                              <span className="text-surface-400">Clip {globalNum}</span> — {c.title}
                            </p>
                            <p className="text-[10px] text-surface-500 tabular-nums">
                              {formatDuration(c.startTime)} – {formatDuration(c.endTime)}
                              <span className="text-surface-600"> · {formatDuration(c.endTime - c.startTime)}</span>
                            </p>
                          </Link>
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            className="shrink-0 p-1.5 mr-1 text-surface-500 hover:text-brand-300 transition-colors"
                            title="Rename clip"
                            aria-label={`Rename clip ${globalNum}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
