"use client";

import { useEffect, useRef } from "react";
import type { UndoRedo } from "@/lib/useUndoRedo";

/** Structural equality good enough for our editable documents (primitives +
 *  plain nested objects built with consistent key order). */
function docsEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface DocumentHistoryOptions<T> {
  /** The current editable document (a fresh object each render is fine). */
  doc: T;
  /** Write a document back into component state. */
  applyDoc: (doc: T) => void;
  /** Pause recording (e.g. during a remix preview, or before the clip loads). */
  enabled?: boolean;
  /** Coalesce a continuous drag into one undo step (default 500ms). */
  debounceMs?: number;
  /** The shared command stack. */
  history: UndoRedo;
}

export interface DocumentHistory {
  /** Call right before a *manually pushed* command mutates the same document,
   *  so the resulting change re-baselines instead of recording a stray edit. */
  suppress: () => void;
}

/**
 * Automatic snapshot history for the clip editors.
 *
 * Watches `doc`; once it has settled (no change for `debounceMs`) and differs
 * from the last committed snapshot, it pushes a command that restores the
 * previous doc on undo and re-applies the new doc on redo.
 *
 * Baselining: the committed snapshot is (re)set silently — with NO history
 * entry — the first time recording becomes enabled and on every disabled→
 * enabled transition. That makes the initial clip load free, and lets a
 * surface pause recording (remix preview) then resume on a fresh baseline.
 */
export function useDocumentHistory<T>({
  doc,
  applyDoc,
  enabled = true,
  debounceMs = 500,
  history,
}: DocumentHistoryOptions<T>): DocumentHistory {
  const committedRef = useRef<T | null>(null);
  const wasEnabledRef = useRef(false);
  // Set right before we call applyDoc() from an undo/redo, so the resulting
  // doc change re-baselines instead of recording a spurious entry.
  const suppressRef = useRef(false);

  const applyRef = useRef(applyDoc);
  applyRef.current = applyDoc;

  useEffect(() => {
    const wasEnabled = wasEnabledRef.current;
    wasEnabledRef.current = enabled;

    if (!enabled) return;

    // First enable, or resuming after a pause: baseline silently.
    if (committedRef.current === null || !wasEnabled) {
      committedRef.current = doc;
      return;
    }

    // We just applied an undo/redo result — re-baseline, don't record.
    if (suppressRef.current) {
      suppressRef.current = false;
      committedRef.current = doc;
      return;
    }

    if (docsEqual(doc, committedRef.current)) return;

    const prev = committedRef.current;
    const next = doc;
    const timer = setTimeout(() => {
      committedRef.current = next;
      history.push({
        label: "edit",
        undo: () => {
          suppressRef.current = true;
          applyRef.current(prev);
        },
        redo: () => {
          suppressRef.current = true;
          applyRef.current(next);
        },
      });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [doc, enabled, debounceMs, history]);

  return {
    suppress: () => {
      suppressRef.current = true;
    },
  };
}
