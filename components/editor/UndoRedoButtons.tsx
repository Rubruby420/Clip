"use client";

import { Undo2, Redo2 } from "lucide-react";

interface UndoRedoButtonsProps {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

/** Shared `↶ ↷` header control. Each button disables when its stack is empty
 *  and its tooltip names the action it would reverse/replay. Styled to match
 *  the other small header buttons in the editors. */
export default function UndoRedoButtons({
  undo,
  redo,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
}: UndoRedoButtonsProps) {
  return (
    <div className="flex items-center rounded-lg border border-surface-600 overflow-hidden">
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        title={canUndo ? `Undo ${undoLabel ?? ""}`.trim() : "Nothing to undo"}
        className="flex items-center justify-center px-2.5 py-1.5 text-surface-300 hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default transition-colors"
        aria-label="Undo"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <span className="w-px self-stretch bg-surface-600" />
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        title={canRedo ? `Redo ${redoLabel ?? ""}`.trim() : "Nothing to redo"}
        className="flex items-center justify-center px-2.5 py-1.5 text-surface-300 hover:bg-surface-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default transition-colors"
        aria-label="Redo"
      >
        <Redo2 className="w-4 h-4" />
      </button>
    </div>
  );
}
