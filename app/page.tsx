"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Upload, Film, Clock, Trash2, Edit3, Plus, Loader2, CheckCircle, AlertCircle, Zap } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import { fileUrl } from "@/lib/file-urls";

interface ProjectClip { id: string; score: number | null; thumbnailUrl: string | null; }
interface Project {
  id: string; title: string; status: string; duration: number | null;
  createdAt: string; clips: ProjectClip[];
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  uploading: <Loader2 className="w-4 h-4 animate-spin text-blue-400" />,
  uploaded:  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />,
  processing: <Loader2 className="w-4 h-4 animate-spin text-yellow-400" />,
  ready: <CheckCircle className="w-4 h-4 text-green-400" />,
  error: <AlertCircle className="w-4 h-4 text-red-400" />,
};

const STATUS_LABEL: Record<string, string> = {
  uploading: "Uploading…", uploaded: "Queued", processing: "AI Processing…",
  ready: "Ready", error: "Error",
};

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function fetchProjects() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 5000);
    return () => clearInterval(interval);
  }, []);

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its clips?")) return;
    setDeletingId(id);
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects((p) => p.filter((proj) => proj.id !== id));
    setDeletingId(null);
  }

  async function renameProject(id: string) {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameValue }),
    });
    setProjects((p) => p.map((proj) => proj.id === id ? { ...proj, title: renameValue } : proj));
    setRenamingId(null);
  }

  return (
    <div className="min-h-screen bg-surface-900">
      {/* Header */}
      <header className="border-b border-surface-600 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Clip</span>
          <span className="text-xs bg-brand-900 text-brand-100 px-2 py-0.5 rounded-full">AI Studio</span>
        </div>
        <Link
          href="/upload"
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Project
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center">
              <Film className="w-8 h-8 text-surface-500" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">No projects yet</h2>
              <p className="text-surface-500 text-sm">Upload a recording to get started</p>
            </div>
            <Link href="/upload" className="mt-2 flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <Upload className="w-4 h-4" /> Upload Video
            </Link>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-bold text-white mb-6">Your Projects</h1>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {projects.map((project) => {
                const thumb = project.clips.find((c) => c.thumbnailUrl)?.thumbnailUrl;
                const bestScore = Math.max(...project.clips.map((c) => c.score ?? 0), 0);
                return (
                  <div key={project.id} className="bg-surface-800 rounded-xl border border-surface-600 overflow-hidden group hover:border-brand-600 transition-colors">
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-surface-700 overflow-hidden">
                      {thumb ? (
                        <img src={fileUrl(thumb)} alt={project.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-10 h-10 text-surface-500" />
                        </div>
                      )}
                      {/* Status badge */}
                      <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white">
                        {STATUS_ICONS[project.status]}
                        {STATUS_LABEL[project.status]}
                      </div>
                      {project.clips.length > 0 && (
                        <div className="absolute top-2 right-2 bg-brand-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                          {project.clips.length} clips
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="p-4">
                      {renamingId === project.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => renameProject(project.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") renameProject(project.id); if (e.key === "Escape") setRenamingId(null); }}
                          className="w-full bg-surface-700 text-white text-sm rounded px-2 py-1 border border-brand-500 outline-none mb-1"
                        />
                      ) : (
                        <h3 className="text-white font-semibold text-sm mb-1 truncate">{project.title}</h3>
                      )}

                      <div className="flex items-center gap-3 text-xs text-surface-500 mb-3">
                        {project.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(project.duration)}
                          </span>
                        )}
                        {bestScore > 0 && (
                          <span className="flex items-center gap-1 text-yellow-400">
                            <Zap className="w-3 h-3" />
                            {Math.round(bestScore * 100)}% viral
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {project.status === "ready" ? (
                          <Link
                            href={`/projects/${project.id}`}
                            className="flex-1 text-center text-xs bg-brand-600 hover:bg-brand-700 text-white py-2 rounded-lg font-medium transition-colors"
                          >
                            View Clips
                          </Link>
                        ) : project.status === "uploaded" ? (
                          <button
                            onClick={async () => {
                              await fetch(`/api/process/${project.id}`, { method: "POST" });
                              fetchProjects();
                            }}
                            className="flex-1 text-center text-xs bg-yellow-600 hover:bg-yellow-700 text-white py-2 rounded-lg font-medium transition-colors"
                          >
                            Start AI Processing
                          </button>
                        ) : project.status === "ready" || project.status === "processing" ? (
                          <Link href={`/projects/${project.id}`} className="flex-1 text-center text-xs bg-surface-700 hover:bg-surface-600 text-white py-2 rounded-lg font-medium transition-colors">
                            View Project
                          </Link>
                        ) : (
                          <div className="flex-1 text-center text-xs text-surface-500 py-2">
                            {STATUS_LABEL[project.status]}
                          </div>
                        )}

                        <button
                          onClick={() => { setRenamingId(project.id); setRenameValue(project.title); }}
                          className="p-2 text-surface-500 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
                          title="Rename"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteProject(project.id)}
                          disabled={deletingId === project.id}
                          className="p-2 text-surface-500 hover:text-red-400 hover:bg-surface-700 rounded-lg transition-colors"
                          title="Delete"
                        >
                          {deletingId === project.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
