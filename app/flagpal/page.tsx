"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Flag, ArrowLeft, Film, Clock, CheckCircle, Loader2, AlertCircle, Zap,
  ScanSearch, ChevronRight, SquareCheck, Square,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { fileUrl } from "@/lib/file-urls";
import FlagResults, { type ScanResult } from "@/components/flagpal/FlagResults";
import type { FlagPlatform } from "@/lib/flagpal";

interface ProjectClip { id: string; score: number | null; thumbnailUrl: string | null }
interface Project {
  id: string; title: string; status: string; duration: number | null;
  createdAt: string; clips: ProjectClip[];
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  uploading:  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />,
  uploaded:   <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />,
  processing: <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-400" />,
  ready:      <CheckCircle className="w-3.5 h-3.5 text-green-400" />,
  error:      <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
};
const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading…", uploaded: "Queued", processing: "AI Processing…",
  ready: "Ready", error: "Error",
};

export default function FlagPalPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState<FlagPlatform>("youtube");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ScanResult[] | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => { setProjects(d.projects ?? []); setLoading(false); });
  }, []);

  function toggleProject(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === projects.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map((p) => p.id)));
    }
  }

  async function handleScan() {
    if (selected.size === 0) return;
    setScanning(true);
    try {
      const items = [...selected].map((id) => ({ kind: "project" as const, id }));
      const res = await fetch("/api/flagpal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, platform }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
    } catch (err) {
      console.error("FlagPal scan error:", err);
      alert("Scan failed — check your connection.");
    }
    setScanning(false);
  }

  const allSelected = projects.length > 0 && selected.size === projects.length;

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="border-b border-surface-600 px-6 py-4 flex items-center gap-4">
        <Link
          href="/"
          className="p-2 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
          title="Back to dashboard"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Flag className="w-4 h-4 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">FlagPal</span>
          <span className="text-xs bg-brand-900 text-brand-100 px-2 py-0.5 rounded-full">Policy Scanner</span>
        </div>

        {/* Platform selector */}
        <div className="flex items-center gap-1 bg-surface-800 border border-surface-600 rounded-lg p-1">
          {(["youtube","tiktok","instagram"] as FlagPlatform[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
                platform === p ? "bg-brand-600 text-white" : "text-surface-400 hover:text-white"
              }`}
            >
              {p === "instagram" ? "Instagram" : p === "tiktok" ? "TikTok" : "YouTube"}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {projects.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-white transition-colors"
            >
              {allSelected
                ? <SquareCheck className="w-4 h-4 text-brand-400" />
                : <Square className="w-4 h-4" />
              }
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
          <button
            type="button"
            onClick={handleScan}
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
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <Film className="w-12 h-12 text-surface-600" />
            <div>
              <p className="text-white font-semibold">No projects yet</p>
              <p className="text-surface-500 text-sm mt-1">Upload a recording first to scan it.</p>
            </div>
            <Link href="/upload" className="text-brand-400 hover:underline text-sm">Go upload</Link>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-white">Your Projects</h1>
              <p className="text-sm text-surface-500">
                Check videos to scan them, or drill in to select individual clips.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {projects.map((project) => {
                const thumb = project.clips.find((c) => c.thumbnailUrl)?.thumbnailUrl;
                const isSelected = selected.has(project.id);
                return (
                  <div
                    key={project.id}
                    className={`bg-surface-800 rounded-xl border overflow-hidden transition-colors ${
                      isSelected ? "border-brand-500 ring-1 ring-brand-500/40" : "border-surface-600 hover:border-surface-500"
                    }`}
                  >
                    {/* Thumbnail + checkbox overlay */}
                    <div
                      className="relative aspect-video bg-surface-700 overflow-hidden cursor-pointer"
                      onClick={() => toggleProject(project.id)}
                    >
                      {thumb ? (
                        <img src={fileUrl(thumb)} alt={project.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-10 h-10 text-surface-500" />
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

                      {/* Status badge top-right */}
                      <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded-full text-xs text-white">
                        {STATUS_ICONS[project.status]}
                        {STATUS_LABEL[project.status]}
                      </div>

                      {/* Clip count */}
                      {project.clips.length > 0 && (
                        <div className="absolute bottom-2 right-2 bg-brand-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                          {project.clips.length} clips
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      <h3 className="text-white font-semibold text-sm mb-1 truncate">{project.title}</h3>
                      {project.duration && (
                        <p className="flex items-center gap-1 text-xs text-surface-500 mb-3">
                          <Clock className="w-3 h-3" />
                          {formatDuration(project.duration)}
                        </p>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                            isSelected
                              ? "bg-brand-600 border-brand-500 text-white"
                              : "bg-surface-700 border-surface-600 text-surface-300 hover:text-white hover:bg-surface-600"
                          }`}
                        >
                          {isSelected ? <SquareCheck className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                          {isSelected ? "Selected" : "Select video"}
                        </button>

                        {project.clips.length > 0 && (
                          <Link
                            href={`/flagpal/${project.id}`}
                            className="ml-auto flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
                          >
                            Select clips <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-6 text-xs text-surface-600 text-center">
              FlagPal scans spoken transcripts for YouTube Community Guidelines, monetization, and copyright risks.
              It does not perform audio fingerprinting — use <a href="https://studio.youtube.com" target="_blank" rel="noreferrer" className="underline hover:text-surface-400">YouTube Studio</a> for full Content-ID checking.
            </p>
          </div>
        )}
      </main>

      {/* Results modal */}
      {results && (
        <FlagResults results={results} platform={platform} onClose={() => setResults(null)} />
      )}
    </div>
  );
}
