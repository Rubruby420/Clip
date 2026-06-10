"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, use, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Film, Clock, Zap, Edit3, Loader2, AlertCircle, CheckCircle, AlertTriangle, Scissors, AudioLines, GripVertical, Search } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { fileUrl, downloadUrl } from "@/lib/file-urls";

interface Clip {
  id: string; title: string; startTime: number; endTime: number;
  score: number | null; thumbnailUrl: string | null; exportUrl: string | null;
  coachData: string | null; words: string | null;
}

// Read the Virality Coach verdict cached on a clip.
function coachNeedsWork(coachData: string | null): boolean {
  if (!coachData) return false;
  try { return JSON.parse(coachData)?.report?.viralReady === false; } catch { return false; }
}

// Find the first word timestamp matching a search query in a clip's words JSON.
// Returns the absolute start time (seconds), or null if not found.
function findMatch(words: string | null, query: string): number | null {
  if (!words || !query.trim()) return null;
  const q = query.trim().toLowerCase();
  try {
    const arr = JSON.parse(words) as Array<{ word: string; start: number }>;
    const idx = arr.findIndex((w) => w.word.toLowerCase().includes(q));
    return idx === -1 ? null : arr[idx].start;
  } catch { return null; }
}

interface Project {
  id: string; title: string; status: string; duration: number | null;
  createdAt: string; originalUrl: string; proxyUrl: string | null; clips: Clip[];
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  uploading:  { label: "Uploading…",      icon: <Loader2 className="w-4 h-4 animate-spin" />, color: "text-blue-400" },
  uploaded:   { label: "Queued",           icon: <Loader2 className="w-4 h-4 animate-spin" />, color: "text-blue-400" },
  processing: { label: "AI Processing…",  icon: <Loader2 className="w-4 h-4 animate-spin" />, color: "text-yellow-400" },
  ready:      { label: "Ready",            icon: <CheckCircle className="w-4 h-4" />,          color: "text-green-400" },
  error:      { label: "Error",            icon: <AlertCircle className="w-4 h-4" />,           color: "text-red-400" },
};

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-surface-500";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white font-medium ${color}`}>
      <Zap className="w-3 h-3" /> {pct}%
    </span>
  );
}

function HoverVideo({ src, startTime, endTime }: { src: string; startTime: number; endTime: number }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = startTime;
    v.play().catch(() => {});

    function onTimeUpdate() {
      if (v && v.currentTime >= endTime) v.currentTime = startTime;
    }
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [startTime, endTime]);

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="metadata"
      className="absolute inset-0 w-full h-full object-cover"
    />
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const thumbsRequested = useRef(false);

  // Batch export state
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    idx: number; total: number; title: string; pct: number;
  } | null>(null);
  const [batchDone, setBatchDone] = useState<{ exported: number; total: number } | null>(null);

  // Hover-to-play
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);

  // Text-to-clip search
  const [searchQuery, setSearchQuery] = useState("");

  // Clip ordering — custom order persisted to localStorage.
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [sortMode, setSortMode] = useState<"score" | "custom">("score");
  const draggedId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(`clipOrder:${id}`);
    if (stored) {
      try {
        setCustomOrder(JSON.parse(stored) as string[]);
        setSortMode("custom");
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const orderedClips = useMemo<Clip[]>(() => {
    const clips = project?.clips ?? [];
    if (sortMode === "custom" && customOrder) {
      const map = new Map(clips.map((c) => [c.id, c]));
      const known = customOrder.map((cid) => map.get(cid)).filter(Boolean) as Clip[];
      const knownSet = new Set(customOrder);
      const newOnes = clips.filter((c) => !knownSet.has(c.id));
      return [...known, ...newOnes];
    }
    return clips;
  }, [project?.clips, customOrder, sortMode]);

  function handleDragStart(clipId: string) {
    draggedId.current = clipId;
  }

  function handleDragOver(e: React.DragEvent, clipId: string) {
    e.preventDefault();
    setDragOverId(clipId);
  }

  function handleDrop(targetId: string) {
    const fromId = draggedId.current;
    if (!fromId || fromId === targetId) { draggedId.current = null; setDragOverId(null); return; }
    const newOrder = [...orderedClips];
    const fromIdx = newOrder.findIndex((c) => c.id === fromId);
    const toIdx = newOrder.findIndex((c) => c.id === targetId);
    const [item] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, item);
    const ids = newOrder.map((c) => c.id);
    setCustomOrder(ids);
    setSortMode("custom");
    localStorage.setItem(`clipOrder:${id}`, JSON.stringify(ids));
    draggedId.current = null;
    setDragOverId(null);
  }

  function resetToScoreOrder() {
    setSortMode("score");
    setCustomOrder(null);
    localStorage.removeItem(`clipOrder:${id}`);
  }

  async function handleBatchExport() {
    setBatchExporting(true);
    setBatchProgress(null);
    setBatchDone(null);
    try {
      const res = await fetch(`/api/projects/${id}/batch-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspectRatio: "9:16", blurBackground: true }),
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (evt.type === "start") {
              setBatchProgress({ idx: Number(evt.idx), total: Number(evt.total), title: String(evt.title), pct: 0 });
            } else if (evt.type === "progress") {
              setBatchProgress((p) => p ? { ...p, pct: Number(evt.pct) } : p);
            } else if (evt.type === "done_clip") {
              setBatchProgress((p) => p ? { ...p, pct: 100 } : p);
            } else if (evt.type === "done") {
              setBatchDone({ exported: Number(evt.exported), total: Number(evt.total) });
              await fetchProject();
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error("Batch export error:", err);
    } finally {
      setBatchExporting(false);
    }
  }

  async function fetchProject() {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProject(data.project);
    setLoading(false);

    // Manual cuts are created without a thumbnail. Backfill any that are
    // missing one (off the Coach/finalize path), then refresh to show them.
    if (!thumbsRequested.current && data.project?.clips?.some((c: Clip) => !c.thumbnailUrl)) {
      thumbsRequested.current = true;
      try {
        const r = await fetch(`/api/projects/${id}/thumbnails`, { method: "POST" });
        const j = await r.json();
        if (r.ok && j.generated > 0) fetchProject();
      } catch {}
    }
  }

  // "Detect Speakers" — opt-in: auto-find the talking parts of the source and
  // turn each into a clip. Replaces the old auto-detection that ran silently
  // in Manual mode (which made "Manual" feel like it was AI-processing).
  async function handleDetectSpeakers() {
    setDetecting(true);
    try {
      const res = await fetch(`/api/projects/${id}/detect-speakers`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Couldn't detect speakers.");
      } else if (data.created === 0) {
        alert(data.message || "No clear talking segments found.");
      } else {
        await fetchProject();
      }
    } catch {
      alert("Couldn't detect speakers — check your connection.");
    }
    setDetecting(false);
  }

  useEffect(() => {
    fetchProject();
    const interval = setInterval(() => {
      if (project?.status === "processing" || project?.status === "uploading") fetchProject();
    }, 4000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.status]);

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
        <Link href="/" className="text-brand-400 hover:underline">Go home</Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.ready;

  return (
    <div className="min-h-screen bg-surface-900">
      <header className="border-b border-surface-600 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-surface-500 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">Clip</span>
        </div>
        <span className="text-surface-500">/</span>
        <span className="text-white font-medium truncate max-w-xs">{project.title}</span>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Project meta */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">{project.title}</h1>
            <div className="flex items-center gap-4 text-sm">
              <span className={`flex items-center gap-1.5 ${status.color}`}>
                {status.icon} {status.label}
              </span>
              {project.duration && (
                <span className="flex items-center gap-1 text-surface-500">
                  <Clock className="w-4 h-4" />
                  {formatDuration(project.duration)} total
                </span>
              )}
              <span className="text-surface-500">{project.clips.length} clip{project.clips.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          {project.status === "ready" && (
            <div className="shrink-0 flex items-center gap-2">
              <button
                onClick={handleDetectSpeakers}
                disabled={detecting}
                className="flex items-center gap-1.5 px-4 py-2 border border-brand-600 text-brand-300 hover:bg-brand-900/40 disabled:opacity-50 text-sm rounded-lg font-medium transition-colors"
                title="Find where people are actually talking and turn each conversation into a clip"
              >
                {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
                {detecting ? "Detecting…" : "Detect Speakers"}
              </button>
              {project.clips.length > 0 && (
                <button
                  onClick={handleBatchExport}
                  disabled={batchExporting}
                  className="flex items-center gap-1.5 px-4 py-2 border border-surface-600 text-surface-300 hover:bg-surface-700 disabled:opacity-50 text-sm rounded-lg font-medium transition-colors"
                  title="Export all clips to MP4"
                >
                  {batchExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {batchExporting ? "Exporting…" : "Export All"}
                </button>
              )}
              <Link
                href={`/source/${project.id}`}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm rounded-lg font-medium transition-colors"
                title="Jump back to the source editor and cut more clips by hand"
              >
                <Scissors className="w-4 h-4" /> Make more clips
              </Link>
            </div>
          )}
        </div>

        {/* Processing state — shown for the initial pipeline run AND for
            the post-manual finalize pass. Copy is neutral enough to cover
            both. */}
        {(project.status === "processing" || project.status === "uploading" || project.status === "uploaded") && (
          <div className="bg-surface-800 border border-surface-600 rounded-xl p-8 mb-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-900/40 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
            </div>
            <div>
              <p className="text-white font-semibold text-lg">
                {project.clips.length > 0 ? "Coach is scoring your clips" : "Preparing your video"}
              </p>
              <p className="text-surface-500 text-sm mt-1">
                {project.clips.length > 0
                  ? "Transcribing each clip and grading it for virality. Scores will appear below as they finish."
                  : "Building the waveform and a smooth 720p preview so you can start clipping…"}
              </p>
            </div>
          </div>
        )}

        {/* Clips grid */}
        {project.clips.length > 0 && (
          <div>
            {/* Search bar */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clip transcripts… (e.g. &quot;product launch&quot;)"
                className="w-full bg-surface-800 border border-surface-600 text-white text-sm rounded-xl pl-10 pr-4 py-2.5 placeholder:text-surface-500 focus:outline-none focus:border-brand-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-white transition-colors"
                >
                  ×
                </button>
              )}
            </div>

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                Clips
                {searchQuery && (
                  <span className="ml-2 text-sm font-normal text-surface-500">
                    {orderedClips.filter((c) => findMatch(c.words, searchQuery) !== null).length} match
                    {orderedClips.filter((c) => findMatch(c.words, searchQuery) !== null).length !== 1 ? "es" : ""}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-1 bg-surface-800 border border-surface-600 rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => { setSortMode("score"); }}
                  className={`px-3 py-1 rounded transition-colors ${sortMode === "score" ? "bg-brand-600 text-white" : "text-surface-400 hover:text-white"}`}
                >
                  AI Score
                </button>
                <button
                  onClick={() => { if (sortMode !== "custom") return; }}
                  className={`px-3 py-1 rounded transition-colors ${sortMode === "custom" ? "bg-surface-600 text-white" : "text-surface-500 cursor-default"}`}
                  title={sortMode === "custom" ? "Custom order (drag to reorder)" : "Drag clips to set a custom order"}
                >
                  Custom
                </button>
                {sortMode === "custom" && (
                  <button onClick={resetToScoreOrder} className="px-2 py-1 text-surface-500 hover:text-red-400 transition-colors">✕</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {orderedClips.map((clip) => {
                const duration = clip.endTime - clip.startTime;
                const isDragging = draggedId.current === clip.id;
                const isDragTarget = dragOverId === clip.id && draggedId.current !== clip.id;
                const isHovered = hoveredClipId === clip.id;
                const matchTime = searchQuery ? findMatch(clip.words, searchQuery) : null;
                const dimmed = searchQuery && matchTime === null;
                const videoSrc = project.proxyUrl
                  ? fileUrl(project.proxyUrl)
                  : fileUrl(project.originalUrl);
                return (
                  <div
                    key={clip.id}
                    draggable
                    onDragStart={() => handleDragStart(clip.id)}
                    onDragOver={(e) => handleDragOver(e, clip.id)}
                    onDrop={() => handleDrop(clip.id)}
                    onDragEnd={() => { draggedId.current = null; setDragOverId(null); }}
                    onMouseEnter={() => setHoveredClipId(clip.id)}
                    onMouseLeave={() => setHoveredClipId(null)}
                    className={`bg-surface-800 rounded-xl border overflow-hidden transition-all duration-200 group select-none ${
                      isDragTarget ? "border-brand-400 ring-2 ring-brand-400/40" : "border-surface-600 hover:border-brand-600"
                    } ${isDragging ? "opacity-40" : ""} ${dimmed ? "opacity-40" : ""}`}
                  >
                    {/* Thumbnail / hover video */}
                    <div className="relative aspect-video bg-surface-700 overflow-hidden">
                      {clip.thumbnailUrl ? (
                        <img
                          src={fileUrl(clip.thumbnailUrl)}
                          alt={clip.title}
                          className={`w-full h-full object-cover transition-all duration-300 ${isHovered ? "scale-105 opacity-0" : "group-hover:scale-105"}`}
                        />
                      ) : (
                        <div className={`w-full h-full flex items-center justify-center transition-opacity ${isHovered ? "opacity-0" : ""}`}>
                          <Film className="w-8 h-8 text-surface-500" />
                        </div>
                      )}

                      {/* Hover-to-play video */}
                      {isHovered && (
                        <HoverVideo
                          src={videoSrc}
                          startTime={clip.startTime}
                          endTime={clip.endTime}
                        />
                      )}

                      <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white font-medium">
                        {formatDuration(duration)}
                      </div>
                      {clip.score != null && (
                        <div className="absolute top-2 left-2">
                          <ScoreBadge score={clip.score} />
                        </div>
                      )}
                      {/* Drag handle — top-right, visible on hover */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-black/60 rounded p-1">
                        <GripVertical className="w-3.5 h-3.5 text-white" />
                      </div>
                    </div>

                    <div className="p-4">
                      <h3 className="text-white text-sm font-semibold mb-1 line-clamp-2">{clip.title}</h3>
                      <p className="text-surface-500 text-xs mb-2">
                        {formatDuration(clip.startTime)} – {formatDuration(clip.endTime)}
                      </p>
                      {coachNeedsWork(clip.coachData) && (
                        <p className="flex items-center gap-1 text-[11px] text-amber-400 mb-3">
                          <AlertTriangle className="w-3 h-3" /> Coach: needs work
                        </p>
                      )}

                      {/* Search match chip */}
                      {matchTime !== null && (
                        <Link
                          href={`/editor/${clip.id}?t=${matchTime.toFixed(2)}`}
                          className="inline-flex items-center gap-1 text-[10px] bg-brand-900/60 text-brand-300 border border-brand-700 rounded px-2 py-0.5 mb-3 hover:bg-brand-800/60 transition-colors"
                        >
                          <Search className="w-2.5 h-2.5" /> Match at {formatDuration(matchTime)} → jump to it
                        </Link>
                      )}

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/editor/${clip.id}`}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs py-2 rounded-lg font-medium transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Clip
                        </Link>
                        <Link
                          href={`/edit/${clip.id}`}
                          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-brand-300 border border-brand-700 hover:bg-brand-900/40 rounded px-1.5 py-2 transition-colors"
                          title="Open in the new editor (beta)"
                        >
                          beta
                        </Link>
                        {clip.exportUrl && (
                          <a
                            href={downloadUrl(clip.exportUrl, `${clip.title}.mp4`)}
                            download
                            className="px-3 py-2 bg-green-700 hover:bg-green-600 text-white text-xs rounded-lg font-medium transition-colors"
                          >
                            Download
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {project.status === "ready" && project.clips.length === 0 && (
          <div className="text-center py-16 text-surface-500 max-w-md mx-auto">
            <Scissors className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-white font-medium mb-1">No clips yet</p>
            <p className="text-sm mb-5">
              Let the app auto-find the talking parts with <span className="text-brand-300">Detect Speakers</span>,
              or open the editor and cut clips yourself.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleDetectSpeakers}
                disabled={detecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
              >
                {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AudioLines className="w-4 h-4" />}
                {detecting ? "Detecting…" : "Detect Speakers"}
              </button>
              <Link
                href={`/source/${project.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-surface-600 hover:border-brand-600 text-surface-300 hover:text-white text-sm rounded-lg font-medium transition-colors"
              >
                <Scissors className="w-4 h-4" /> Make a clip
              </Link>
            </div>
          </div>
        )}
      </main>

      {/* Batch export progress overlay */}
      {batchExporting && batchProgress && (
        <div className="fixed bottom-6 right-6 z-50 bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl p-5 w-80">
          <p className="text-white text-sm font-semibold mb-1">
            Exporting {batchProgress.idx + 1} / {batchProgress.total}
          </p>
          <p className="text-surface-400 text-xs mb-3 truncate">{batchProgress.title}</p>
          {/* Current clip bar */}
          <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden mb-1">
            <div
              className="h-full bg-brand-500 rounded-full transition-[width] duration-300"
              style={{ width: `${batchProgress.pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-surface-500 mb-3">
            <span>Current clip</span>
            <span>{batchProgress.pct}%</span>
          </div>
          {/* Overall bar */}
          <div className="h-1 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-700 rounded-full transition-[width] duration-300"
              style={{ width: `${((batchProgress.idx + batchProgress.pct / 100) / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-[10px] text-surface-600 mt-1 text-right">Overall progress</p>
        </div>
      )}

      {/* Batch export done banner */}
      {batchDone && !batchExporting && (
        <div className="fixed bottom-6 right-6 z-50 bg-surface-800 border border-green-700/60 rounded-2xl shadow-2xl p-5 w-80">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">
                {batchDone.exported} / {batchDone.total} clips exported
              </p>
              <p className="text-surface-400 text-xs mt-0.5">Download buttons are now visible on each clip.</p>
            </div>
            <button
              onClick={() => setBatchDone(null)}
              className="text-surface-500 hover:text-white transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
