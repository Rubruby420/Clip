"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Film, Clock, Zap, Edit3, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { formatDuration } from "@/lib/utils";

interface Clip {
  id: string; title: string; startTime: number; endTime: number;
  score: number | null; thumbnailUrl: string | null; exportUrl: string | null;
}
interface Project {
  id: string; title: string; status: string; duration: number | null;
  createdAt: string; clips: Clip[];
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

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchProject() {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProject(data.project);
    setLoading(false);
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
              <span className="text-surface-500">{project.clips.length} clips detected</span>
            </div>
          </div>
        </div>

        {/* Processing state */}
        {(project.status === "processing" || project.status === "uploading" || project.status === "uploaded") && (
          <div className="bg-surface-800 border border-surface-600 rounded-xl p-8 mb-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-brand-900/40 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
            </div>
            <div>
              <p className="text-white font-semibold text-lg">AI is analysing your recording</p>
              <p className="text-surface-500 text-sm mt-1">Transcribing speech, detecting highlights, and scoring virality…</p>
            </div>
            <div className="flex gap-3 text-xs text-surface-500">
              {["Transcription", "Highlight detection", "Virality scoring"].map((step) => (
                <span key={step} className="flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> {step}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Clips grid */}
        {project.clips.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">AI-Detected Clips</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {project.clips.map((clip) => {
                const duration = clip.endTime - clip.startTime;
                return (
                  <div key={clip.id} className="bg-surface-800 rounded-xl border border-surface-600 overflow-hidden hover:border-brand-600 transition-colors group">
                    {/* Thumbnail */}
                    <div className="relative aspect-video bg-surface-700 overflow-hidden">
                      {clip.thumbnailUrl ? (
                        <img src={clip.thumbnailUrl} alt={clip.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-8 h-8 text-surface-500" />
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white font-medium">
                        {formatDuration(duration)}
                      </div>
                      {clip.score != null && (
                        <div className="absolute top-2 left-2">
                          <ScoreBadge score={clip.score} />
                        </div>
                      )}
                    </div>

                    <div className="p-4">
                      <h3 className="text-white text-sm font-semibold mb-1 line-clamp-2">{clip.title}</h3>
                      <p className="text-surface-500 text-xs mb-3">
                        {formatDuration(clip.startTime)} – {formatDuration(clip.endTime)}
                      </p>

                      <div className="flex items-center gap-2">
                        <Link
                          href={`/editor/${clip.id}`}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs py-2 rounded-lg font-medium transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Clip
                        </Link>
                        {clip.exportUrl && (
                          <a
                            href={clip.exportUrl}
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
          <div className="text-center py-16 text-surface-500">
            <Film className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No clips were detected. The video may be too short or silent.</p>
          </div>
        )}
      </main>
    </div>
  );
}
