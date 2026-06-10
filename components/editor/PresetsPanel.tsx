"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Trash2, Check } from "lucide-react";
import type { CaptionConfig } from "@/lib/captions";
import type { LayoutConfig } from "./LayoutPanel";

interface StylePreset {
  id: string;
  name: string;
  layout: LayoutConfig;
  captionConfig: CaptionConfig;
  captionsEnabled: boolean;
  savedAt: number;
}

interface Props {
  layout: LayoutConfig;
  captionConfig: CaptionConfig;
  captionsEnabled: boolean;
  onApply: (preset: StylePreset) => void;
}

const STORAGE_KEY = "clip:stylePresets";

function load(): StylePreset[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function save(presets: StylePreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export default function PresetsPanel({ layout, captionConfig, captionsEnabled, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setPresets(load());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  function savePreset() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next: StylePreset[] = [
      { id: crypto.randomUUID(), name: trimmed, layout, captionConfig, captionsEnabled, savedAt: Date.now() },
      ...presets,
    ];
    save(next);
    setPresets(next);
    setName("");
    setNaming(false);
  }

  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    save(next);
    setPresets(next);
  }

  function applyPreset(preset: StylePreset) {
    onApply(preset);
    setApplied(preset.id);
    setTimeout(() => setApplied(null), 1200);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 border text-xs rounded-lg font-medium transition-colors ${
          open ? "border-brand-500 bg-brand-900/40 text-brand-300" : "border-surface-600 text-surface-400 hover:text-white hover:border-surface-500"
        }`}
        title="Style presets"
      >
        <Bookmark className="w-3.5 h-3.5" />
        Presets
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl z-50">
          <div className="px-3 py-2.5 border-b border-surface-700 flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Style Presets</span>
            <button
              onClick={() => { setNaming(true); setName(""); }}
              className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              <BookmarkPlus className="w-3 h-3" /> Save current
            </button>
          </div>

          {naming && (
            <div className="px-3 py-2 border-b border-surface-700 flex gap-2">
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePreset();
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="Preset name…"
                className="flex-1 bg-surface-700 border border-surface-600 text-white text-xs rounded px-2 py-1 placeholder:text-surface-500 focus:outline-none focus:border-brand-500"
              />
              <button
                onClick={savePreset}
                disabled={!name.trim()}
                className="px-2 py-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs rounded transition-colors"
              >
                Save
              </button>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto">
            {presets.length === 0 ? (
              <p className="text-center text-surface-500 text-xs py-6 px-3">
                No presets yet. Save your current style above.
              </p>
            ) : (
              presets.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-700/50 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white font-medium truncate">{p.name}</p>
                    <p className="text-[10px] text-surface-500">{new Date(p.savedAt).toLocaleDateString()}</p>
                  </div>
                  <button
                    onClick={() => applyPreset(p)}
                    className={`shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded transition-colors ${
                      applied === p.id
                        ? "bg-green-700 text-white"
                        : "bg-brand-700 hover:bg-brand-600 text-white"
                    }`}
                  >
                    {applied === p.id ? <><Check className="w-3 h-3" /> Applied</> : "Apply"}
                  </button>
                  <button
                    onClick={() => deletePreset(p.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 p-1 text-surface-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
