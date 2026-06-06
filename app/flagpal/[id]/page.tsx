"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  Flag, ArrowLeft, Film, Clock, Zap, Loader2, AlertCircle, CheckCircle,
  ScanSearch, Square, SquareCheck,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { fileUrl } from "@/lib/file-urls";
import FlagResults, { type ScanResult } from "@/components/flagpal/FlagResults";

interface Clip {
  id: string; title: string; startTime: number; endTime: number;
  score: number | null; thumbnailUrl: string | null;
}
interface Project {
  id: string; title: string; status: string; duration: number | null;
  clips: Clip[];
}

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-surface-500";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white font-medium ${color}`}>
      <Zap className="w-3 h-3" /> {pct}%
    </span>
  );
}

export default function FlagPalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[] | null>(null);

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => { setProject(d.project); setLoading(false); });
  }, [id]);

  function toggleClip(clipId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(clipId) ? next.delete(clipId) : next.add(clipId);
      return next;
    });
  }

  function toggleAll() {
    if (!project) return;
    const allIds = project.clips.map((c) => c.id);
    if (selected.size === allIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  async function handleScanClips() {
    if (selected.size === 0) return;
    setScanning(true);
    try {
      const items = [...selected].map((clipId) => ({ kind: "clip" as const, id: clipId }));
      const res = await fetch("/api/flagpal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      console.error("FlagPal scan error:", err);
      alert("Scan failed — check your connection.");
    }
    setScanning(false);
  }

  async function handleScanWholeVideo() {
    if (!project) return;
    setScanning(true);
    try {
      const res = await fetch("/api/flagpal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ kind: "project", id: project.id }] }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      console.error("FlagPal scan error:", err);
      alert("Scan failed — check your connection.");
    }
    setScanning(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="min-h-screen bg-surface-900 flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-white text-lg">Project not found</p>
        <Link href="/flagpal" className="text-brand-400 hover:underline">Back to FlagPal</Link>
      </div>
    );
  }

  const allSelected = project.clips.length > 0 && selected.size === project.clips.length;

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="border-b border-surface-600 px-6 py-4 flex items-center gap-4">
        <Link
          href="/flagpal"
          className="p-2 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
          title="Back to FlagPal"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Flag className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">FlagPal</span>
        </div>
        <span className="text-surface-500">/</span>
        <span className="text-white font-medium truncate max-w-xs">{project.title}</span>

        <div className="ml-auto flex items-center gap-3">
          {project.clips.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors"
            >
              {allSelected
                ? <SquareCheck className="w-4 h-4 text-brand-400" />
                : <Square className="w-4 h-4" />
              }
              {allSelected ? "Deselect all clips" : "Select all clips"}
            </button>
          )}
          <button
            type="button"
            onClick={handleScanWholeVideo}
            disabled={scanning}
            className="flex items-center gap-2 border border-surface-600 hover:border-brand-600 text-surface-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
            Scan whole video
          </button>
          <button
            type="button"
            onClick={handleScanClips}
            disabled={selected.size === 0 || scanning}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {scanning
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning… (may take a minute)</>

              : <><ScanSearch className="w-4 h-4" /> Scan selected{selected.size > 0 ? ` (${selected.size})` : ""}</>
            }
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {project.clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <Film className="w-12 h-12 text-surface-600" />
            <div>
              <p className="text-white font-semibold">No clips in this project</p>
              <p className="text-surface-500 text-sm mt-1">
                You can still{" "}
                <button
                  onClick={handleScanWholeVideo}
                  disabled={scanning}
                  className="text-brand-400 hover:underline disabled:opacity-50"
                >
                  scan the whole video
                </button>.
              </p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-white">
                {project.clips.length} Clip{project.clips.length !== 1 ? "s" : ""}
              </h1>
              <p className="text-sm text-surface-500">Check clips to scan them for YouTube policy risks.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {project.clips.map((clip) => {
                const duration = clip.endTime - clip.startTime;
                const isSelected = selected.has(clip.id);
                return (
                  <div
                    key={clip.id}
                    className={`bg-surface-800 rounded-xl border overflow-hidden transition-colors ${
                      isSelected ? "border-brand-500 ring-1 ring-brand-500/40" : "border-surface-600 hover:border-surface-500"
                    }`}
                  >
                    {/* Thumbnail + checkbox */}
                    <div
                      className="relative aspect-video bg-surface-700 overflow-hidden cursor-pointer"
                      onClick={() => toggleClip(clip.id)}
                    >
                      {clip.thumbnailUrl ? (
                        <img src={fileUrl(clip.thumbnailUrl)} alt={clip.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-8 h-8 text-surface-500" />
                        </div>
                      )}

                      {/* Checkbox top-left */}
                      <div className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-brand-500 border-brand-400"
                          : "bg-black/60 border-surface-400"
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>

                      {/* Score badge top-right */}
                      {clip.score != null && (
                        <div className="absolute top-2 right-2">
                          <ScoreBadge score={clip.score} />
                        </div>
                      )}

                      {/* Duration bottom-right */}
                      <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white font-medium">
                        {formatDuration(duration)}
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <h3 className="text-white text-sm font-semibold mb-1 line-clamp-2">{clip.title}</h3>
                      <p className="flex items-center gap-1 text-xs text-surface-500 mb-3">
                        <Clock className="w-3 h-3" />
                        {formatDuration(clip.startTime)} – {formatDuration(clip.endTime)}
                      </p>

                      <button
                        type="button"
                        onClick={() => toggleClip(clip.id)}
                        className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                          isSelected
                            ? "bg-brand-600 border-brand-500 text-white"
                            : "bg-surface-700 border-surface-600 text-surface-300 hover:text-white hover:bg-surface-600"
                        }`}
                      >
                        {isSelected
                          ? <><SquareCheck className="w-3.5 h-3.5" /> Selected</>
                          : <><Square className="w-3.5 h-3.5" /> Select clip</>
                        }
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Results modal */}
      {results && (
        <FlagResults results={results} onClose={() => setResults(null)} />
      )}
    </div>
  );
}
