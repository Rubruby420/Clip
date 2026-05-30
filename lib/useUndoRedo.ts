"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

/**
 * Generic command-stack undo/redo.
 *
 * Each undoable thing is a Command that knows how to reverse and replay itself.
 * Clip editors push *snapshot* commands (restore previous / next in-memory
 * values); the source editor pushes *inverse-operation* commands (undo fires
 * the reversing server request). One abstraction, one set of buttons/shortcuts.
 *
 * History is in-session and per-page: it lives in component state and is gone
 * on reload or navigation. Any new push() clears the redo stack.
 */
export interface Command {
  /** Tooltip text, e.g. "Trim", "Split clip". */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}

export interface UndoRedo {
  /** Record a command; clears the redo stack. */
  push: (cmd: Command) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Label of the next command that undo would reverse. */
  undoLabel?: string;
  /** Label of the next command that redo would replay. */
  redoLabel?: string;
  clear: () => void;
}

// ---- Pure stack reducer (no React, unit-testable) -------------------------

export interface HistoryState {
  past: Command[];
  future: Command[];
}

export type HistoryAction =
  | { type: "push"; command: Command }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" };

export const initialHistory: HistoryState = { past: [], future: [] };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "push":
      // A new edit invalidates any redo branch.
      return { past: [...state.past, action.command], future: [] };
    case "undo": {
      if (state.past.length === 0) return state;
      const cmd = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), future: [...state.future, cmd] };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      const cmd = state.future[state.future.length - 1];
      return { past: [...state.past, cmd], future: state.future.slice(0, -1) };
    }
    case "clear":
      return initialHistory;
    default:
      return state;
  }
}

// ---- React hook -----------------------------------------------------------

export function useUndoRedo(): UndoRedo {
  const [state, dispatch] = useReducer(historyReducer, initialHistory);

  // Mirror state in a ref so undo()/redo() can read the live top-of-stack
  // command synchronously at call time (dispatch is async w.r.t. render).
  const stateRef = useRef(state);
  stateRef.current = state;

  // While an async command (e.g. a server reversal) is running, ignore further
  // undo/redo so a slow request can't be double-fired.
  const busyRef = useRef(false);

  const push = useCallback((command: Command) => {
    dispatch({ type: "push", command });
  }, []);

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    const { past } = stateRef.current;
    if (past.length === 0) return;
    const cmd = past[past.length - 1];
    busyRef.current = true;
    try {
      await cmd.undo();
      // Only advance the stack once the reversal actually succeeded. On a
      // throw we leave the stacks untouched so the user can retry.
      dispatch({ type: "undo" });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const redo = useCallback(async () => {
    if (busyRef.current) return;
    const { future } = stateRef.current;
    if (future.length === 0) return;
    const cmd = future[future.length - 1];
    busyRef.current = true;
    try {
      await cmd.redo();
      dispatch({ type: "redo" });
    } finally {
      busyRef.current = false;
    }
  }, []);

  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  return useMemo<UndoRedo>(
    () => ({
      push,
      undo,
      redo,
      clear,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      undoLabel: state.past[state.past.length - 1]?.label,
      redoLabel: state.future[state.future.length - 1]?.label,
    }),
    [push, undo, redo, clear, state]
  );
}

// ---- Keyboard shortcuts ---------------------------------------------------

/** Returns true when focus is in a text-editing context, where the browser's
 *  own undo should win and our shortcuts must stand down. */
function isTextEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/**
 * Window-level keydown bindings:
 *   Ctrl/Cmd+Z          → undo
 *   Ctrl/Cmd+Shift+Z    → redo
 *   Ctrl+Y              → redo
 * Skipped while a text field is focused so native text undo keeps working.
 */
export function useUndoRedoShortcuts(undo: () => void, redo: () => void): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isTextEditingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
}
