"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Search } from "lucide-react";

interface Word { word: string; start: number; end: number }

interface Props {
  words: Word[];
  clipStart: number;
  onSeek: (relativeTime: number) => void;
  onClose: () => void;
}

// Group words into sentences split by pauses > 0.6s or more than 12 words.
function toSentences(words: Word[]): Word[][] {
  const out: Word[][] = [];
  let current: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const gap = i + 1 < words.length ? words[i + 1].start - words[i].end : 99;
    if (gap > 0.6 || current.length >= 12) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function TranscriptModal({ words, clipStart, onSeek, onClose }: Props) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => { document.body.style.overflow = ""; };
  }, []);

  const query = search.trim().toLowerCase();

  const sentences = useMemo(() => toSentences(words), [words]);

  // Highlight query within a word string.
  function highlight(text: string) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-brand-500/40 text-brand-200 rounded-sm">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  }

  // When searching, only show sentences that contain the query.
  const filtered = query
    ? sentences.filter((s) => s.some((w) => w.word.toLowerCase().includes(query)))
    : sentences;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-start justify-center p-4 pt-12">
        <div
          className="w-full max-w-lg bg-surface-900 rounded-2xl border border-surface-600 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search transcript…"
                className="w-full bg-surface-800 border border-surface-600 text-white text-sm rounded-lg pl-8 pr-3 py-2 placeholder:text-surface-500 focus:outline-none focus:border-brand-500"
              />
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 max-h-[60vh] overflow-y-auto space-y-3">
            {filtered.length === 0 ? (
              <p className="text-surface-500 text-sm text-center py-8">No matches found.</p>
            ) : (
              filtered.map((sentence, si) => (
                <div key={si} className="flex gap-3 group">
                  <button
                    onClick={() => onSeek(sentence[0].start - clipStart)}
                    className="shrink-0 mt-0.5 text-[10px] tabular-nums text-surface-600 group-hover:text-brand-400 transition-colors w-10 text-right"
                    title={`Seek to ${formatTime(sentence[0].start)}`}
                  >
                    {formatTime(sentence[0].start)}
                  </button>
                  <p className="text-sm text-surface-300 leading-relaxed flex flex-wrap gap-x-0.5">
                    {sentence.map((w, wi) => (
                      <button
                        key={wi}
                        onClick={() => onSeek(w.start - clipStart)}
                        className="hover:text-brand-300 hover:underline transition-colors"
                        title={`Seek to ${formatTime(w.start)}`}
                      >
                        {highlight(w.word)}
                      </button>
                    ))}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="px-5 py-3 border-t border-surface-700 text-center">
            <p className="text-[11px] text-surface-600">{words.length} words · click any word to seek</p>
          </div>
        </div>
      </div>
    </div>
  );
}
