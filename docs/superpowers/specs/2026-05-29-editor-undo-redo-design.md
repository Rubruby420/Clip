# Editor Undo/Redo

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan

## Goal

Add undo/redo to every editing surface in the app, with on-screen buttons and
keyboard shortcuts, covering all user-initiated actions.

There are three editor surfaces, and they fall into two categories that need
different undo mechanisms:

1. **`/editor/[id]`** — the main clip editor. Editable state lives in React
   state (trim, layout/overlay, music, caption style, captions-enabled, title)
   and is persisted by a debounced auto-save.
2. **`/edit/[id]`** — a beta clip editor (preview + trim + layout only). Does
   not auto-save yet; undo simply restores in-memory state.
3. **`/source/[id]`** — the source waveform editor. Every action (save clip,
   mute toggle, split, mute-selection) writes to the database **immediately**,
   so undo must reverse a server operation.

## Approach (chosen)

**One shared command-stack hook, with surface-appropriate commands.** A single
generic `useUndoRedo` hook holds the undo + redo stacks. Each undoable thing is
recorded as a *command* with its own `undo`/`redo` behavior:

- Clip editors push **snapshot commands** (restore previous / next in-memory
  values; auto-save then persists).
- Source editor pushes **inverse-operation commands** (undo calls the reversing
  server request).

This gives one consistent abstraction, one set of buttons + shortcuts, while
each surface records commands that match how it actually works.

Rejected alternatives:
- *Pure snapshot history everywhere* — would require diffing and reconciling the
  source editor's clip list against the DB on every undo; recreated clips get
  new IDs and multi-step undo becomes error-prone.
- *Client-only undo* — would require reworking the source editor to stop saving
  immediately and batch on a "Done" button; a larger UX change than wanted.

## Components

### 1. `lib/useUndoRedo.ts` — generic command stack

The unit of undo:

```ts
interface Command {
  label: string;                       // tooltip text, e.g. "Trim", "Split clip"
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
}
```

Hook surface:

```ts
interface UndoRedo {
  push: (cmd: Command) => void;   // record a command; clears the redo stack
  undo: () => void;               // pop past -> run undo() -> push to future
  redo: () => void;               // pop future -> run redo() -> push to past
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;             // label of the next command to undo
  redoLabel?: string;             // label of the next command to redo
  clear: () => void;
}
```

Internals:
- Two arrays, `past: Command[]` and `future: Command[]`.
- `push` appends to `past` and empties `future`.
- `undo` pops `past`, runs `cmd.undo()`, pushes it onto `future`.
- `redo` pops `future`, runs `cmd.redo()`, pushes it onto `past`.
- A `busy` guard ignores new undo/redo calls while an async command is running,
  so a slow server reversal can't be double-fired.
- The pure stack transitions (push / undo / redo / redo-cleared-by-push) are
  implemented as a reducer so they can be unit-tested without React.

History is **in-session and per-page**: it lives in component state and is gone
on reload or navigation. The redo stack is cleared by any new `push`.

### 2. `components/editor/useDocumentHistory.ts` — automatic snapshots for clip editors

Built on `useUndoRedo`. Signature:

```ts
useDocumentHistory<T>({
  doc: T,                       // the current editable document
  applyDoc: (doc: T) => void,   // write a document back into component state
  enabled?: boolean,            // pause recording (e.g. during remix preview)
  debounceMs?: number,          // default ~500ms
  history: UndoRedo,            // the shared stack
}): void
```

Behavior:
- Holds a `committedDoc` ref initialized to the first populated document (after
  the clip loads). The initial load does **not** create a history entry.
- An effect compares the live `doc` to `committedDoc` (deep equality). When they
  differ and `enabled`, after `debounceMs` of no further change it pushes a
  snapshot command — `undo` calls `applyDoc(committedDoc)`, `redo` calls
  `applyDoc(newDoc)` — and advances `committedDoc` to the new doc.
- `undo`/`redo` from the stack call `applyDoc(...)` and the command also resets
  `committedDoc` to whatever it restored, so the diff effect sees no change and
  does not record a spurious entry.
- The debounce **coalesces a continuous drag** (slider, trim handle) into a
  single undo step.

Documents:
- `/editor`: `{ startTime, endTime, layout, captionStyle, captionsEnabled, title }`
- `/edit`: `{ startTime, endTime, layout }`

### 3. `components/editor/UndoRedoButtons.tsx` — shared header control

An `↶ ↷` pair (lucide `Undo2` / `Redo2`). Props: `{ undo, redo, canUndo, canRedo, undoLabel, redoLabel }`. Each button is disabled when its stack is empty; the
tooltip shows the action label ("Undo trim", "Redo mute"). Styled to match the
existing header buttons.

### 4. `useUndoRedoShortcuts(undo, redo)` — keyboard

A small hook that adds a `window` keydown listener:
- `Ctrl/Cmd+Z` → undo
- `Ctrl/Cmd+Shift+Z` and `Ctrl+Y` → redo

**Skipped when focus is in a text input** (`INPUT` / `TEXTAREA` / contenteditable)
so native text-editing undo still works inside fields like the hook-overlay text
box. Mirrors the existing Escape-key guard in `/source`.

## Per-surface integration

### `/editor/[id]`
- Create the shared `useUndoRedo` stack and call `useDocumentHistory` over the
  six-field document, with `applyDoc` writing each field's `setState`.
- `enabled` is `!previewMode` — recording is paused during a remix preview,
  matching the auto-save gate.
- On **Save preview** (`handleSavePreview`), push a single "Apply remix" snapshot
  command so the whole remix is one undo step. **Discard** uses the existing
  snapshot revert and records nothing.
- Add `<UndoRedoButtons>` to the header and call `useUndoRedoShortcuts`.

### `/edit/[id]`
- Same pattern over `{ startTime, endTime, layout }`. No auto-save exists here;
  undo just changes in-memory state, which is correct for the beta surface.
- Add buttons + shortcuts.

### `/source/[id]`
Each handler pushes an inverse command after performing its action:

| Action | `undo` | `redo` |
|---|---|---|
| Save as new clip / mute-selection (POST create) | DELETE the created clip, remove it from local state | POST again (new id), add to local state, remap the closure's live id |
| Toggle mute (PATCH) | PATCH `muted` back to the previous value, update local state | PATCH `muted` forward, update local state |
| Split (1 clip → a + b) | DELETE a and b, recreate the original clip (new id), restore local state | Re-split the current clip at the same time, replace it with the two halves |

- Optimistic local update with rollback on a failed server call (matching the
  current `handleToggleMute`). On failure, surface the existing alert and leave
  the command stacks unchanged so the user can retry.
- Commands that recreate a clip store the live id in their closure and remap it
  on each redo, so a later undo deletes the correct clip.
- **Auto-cut is not on the stack.** It is an automatic import step (not a
  user-initiated edit) and keeps its existing dedicated "Undo auto-cut" button.
- Reuse the existing keydown effect / add `useUndoRedoShortcuts`, and add
  `<UndoRedoButtons>` to the header.

## Edge cases & decisions

- **Scope:** history is per-page and cleared on reload — not persisted. Standard
  for editors.
- **Coalescing:** continuous drags collapse into one entry via the document
  debounce; distinct edits separated by >debounce are separate entries.
- **Text fields:** while a text input is focused, shortcuts defer to the
  browser's native text undo.
- **Async safety:** the `busy` guard prevents overlapping source-editor
  reversals; buttons reflect `canUndo`/`canRedo`.
- **Remix preview:** recording paused while previewing; the applied remix is a
  single undo entry; discard records nothing.

## Testing & verification

- **Unit:** test the pure `useUndoRedo` reducer — push records and clears redo;
  undo/redo move commands between stacks; redo stack clears on a new push;
  empty-stack undo/redo are no-ops. Add a test runner if none exists.
- **Manual smoke test** in the running app, per surface:
  - `/editor`: change trim, caption style, and layout; undo/redo each; confirm
    auto-save persists the result; confirm remix Save is one undo step.
  - `/edit`: trim, undo, redo.
  - `/source`: save a clip, toggle mute, split — undo and redo each; confirm the
    database reflects the reversal (clip removed/recreated, mute restored).
  - Keyboard shortcuts work and defer to native undo inside text fields.

## Files

**New**
- `lib/useUndoRedo.ts`
- `components/editor/useDocumentHistory.ts`
- `components/editor/UndoRedoButtons.tsx`
- `useUndoRedoShortcuts` (in `lib/useUndoRedo.ts` or its own file)

**Edited**
- `app/editor/[id]/page.tsx`
- `app/edit/[id]/page.tsx`
- `app/source/[id]/page.tsx`
