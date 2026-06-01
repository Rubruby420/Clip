"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Film, ArrowLeft, CheckCircle, Zap, CloudUpload, Scissors, Sparkles } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

type UploadPhase = "idle" | "uploading" | "uploaded" | "error";

// Chunked, resumable upload. Multi-GB recordings used to go up as one ~5-minute
// PUT; if the connection so much as hiccuped the whole thing failed and showed a
// misleading "OneDrive" error. Instead we send the file in fixed-size pieces the
// server appends in order, with per-chunk retry + byte-exact resume, so a dropped
// connection just continues from where it left off. Designed for 12GB+ files.
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_CHUNK_RETRIES = 5;
const RESUME_KEY = "clip:pendingUpload";

interface ResumeRecord { projectId: string; name: string; size: number }

function readResume(file: File): string | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as ResumeRecord;
    return r.name === file.name && r.size === file.size ? r.projectId : null;
  } catch { return null; }
}
function writeResume(rec: ResumeRecord) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(rec)); } catch {}
}
function clearResume() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
}

async function getReceived(projectId: string): Promise<number> {
  const res = await fetch(`/api/upload/${projectId}`);
  if (!res.ok) throw new Error("session-gone");
  return (await res.json()).received as number;
}

// PUT one chunk. Resolves with the server's authoritative byte count; for a 409
// (offset disagreement) it resolves with the server's count so the caller
// resyncs rather than treating it as fatal.
function putChunk(
  projectId: string,
  offset: number,
  blob: Blob,
  onLoaded: (loaded: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(offset + e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).received as number); }
        catch { resolve(offset + blob.size); }
      } else if (xhr.status === 409) {
        try { resolve(JSON.parse(xhr.responseText).received as number); }
        catch { reject(new Error("offset mismatch")); }
      } else {
        let msg = `chunk failed (HTTP ${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("network drop"));
    xhr.ontimeout = () => reject(new Error("chunk timed out"));
    xhr.open("PUT", `/api/upload/${projectId}?offset=${offset}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(blob);
  });
}

async function uploadFile(
  file: File,
  title: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<{ projectId: string }> {
  const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
  const total = file.size;

  // Reuse an in-progress session for this exact file if one survived a reload.
  let projectId = readResume(file);
  if (projectId) {
    try { await getReceived(projectId); } catch { projectId = null; }
  }
  if (!projectId) {
    const res = await fetch("/api/upload/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ext, title, size: total }),
    });
    if (!res.ok) throw new Error("Couldn't start the upload — is the app still running?");
    projectId = (await res.json()).projectId as string;
    writeResume({ projectId, name: file.name, size: total });
  }

  let offset = await getReceived(projectId).catch(() => 0);

  while (offset < total) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const blob = file.slice(offset, end);
    let attempt = 0;
    for (;;) {
      try {
        offset = await putChunk(projectId, offset, blob, (loaded) => onProgress(loaded, total));
        break;
      } catch (err) {
        attempt++;
        if (attempt >= MAX_CHUNK_RETRIES) {
          throw new Error(
            `Upload stalled at ${(offset / 1e9).toFixed(2)} GB of ${(total / 1e9).toFixed(2)} GB ` +
            `after ${MAX_CHUNK_RETRIES} retries (${err instanceof Error ? err.message : "unknown"}). ` +
            `Your progress is saved — click upload again to resume.`,
          );
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // backoff
        // Resync to the server's true byte count before retrying this chunk.
        try { offset = await getReceived(projectId); } catch {}
      }
    }
  }

  const res = await fetch(`/api/upload/${projectId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: total }),
  });
  if (!res.ok) {
    let msg = "Couldn't finalize the upload.";
    try { msg = (await res.json()).error ?? msg; } catch {}
    throw new Error(msg);
  }
  clearResume();
  return { projectId };
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("");

  // "manual" = light prep only (proxy + waveform) then drop the user
  // straight into the source editor to cut clips one at a time. "ai" =
  // full pipeline: transcript + highlight detection + per-clip Coach.
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  // Smart Import — AI keeps the best part of each detected clip. Only
  // relevant in AI mode.
  const [smartImport, setSmartImport] = useState(true);
  const [minLen, setMinLen] = useState(15);
  const [maxLen, setMaxLen] = useState(60);

  const handleFile = useCallback((f: File) => {
    if (!f.type.startsWith("video/")) { setError("Please upload a video file."); return; }
    setFile(f);
    setError("");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  async function startUpload() {
    if (!file) return;
    setPhase("uploading");
    setProgress(0);
    setError("");
    setStatusText("Preparing upload…");

    try {
      setStatusText("Uploading to local storage…");
      const { projectId } = await uploadFile(
        file,
        file.name.replace(/\.[^/.]+$/, ""),
        (loaded, total) => setProgress(Math.min(99, Math.round((loaded / total) * 100))),
      );

      setStatusText(mode === "manual" ? "Upload complete! Preparing source…" : "Upload complete! Starting AI…");
      setProgress(100);
      setPhase("uploaded");

      await fetch(`/api/process/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, smartImport, minLen, maxLen }),
      });

      // Manual mode drops the user straight into the source editor; the
      // editor polls for waveform + proxy as light prep finishes. AI mode
      // goes to the project page where the clip grid populates as the
      // pipeline runs.
      const dest = mode === "manual" ? `/source/${projectId}` : `/projects/${projectId}`;
      setTimeout(() => router.push(dest), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <div className="min-h-screen bg-surface-900 text-white">
      <header className="border-b border-surface-600 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-surface-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-surface-700">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">Clip</span>
        </div>
        <span className="text-surface-500">/</span>
        <span className="text-white font-medium">New Project</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        {phase === "uploaded" ? (
          <div className="flex flex-col items-center gap-5 py-20 text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Upload complete!</h2>
              <p className="text-surface-500">
                {mode === "manual"
                  ? "Opening the source editor — you'll cut clips by hand."
                  : "AI is now finding your best moments…"}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-brand-500 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mb-10">
              <h1 className="text-3xl font-bold text-white mb-2">Upload Recording</h1>
              <p className="text-surface-500">Drop any long-form video — stream VOD, podcast, interview, gameplay. AI will find the viral moments.</p>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => phase === "idle" && !file && inputRef.current?.click()}
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 overflow-hidden
                ${isDragging ? "border-brand-500 bg-brand-900/30 scale-[1.01] cursor-copy"
                : file ? "border-green-500/60 bg-green-900/10 cursor-default"
                : "border-surface-600 bg-surface-800 hover:border-brand-600 hover:bg-surface-700/50 cursor-pointer"}`}
            >
              <div className="p-12 flex flex-col items-center text-center gap-4">
                {phase === "uploading" ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-brand-900/50 flex items-center justify-center">
                      <CloudUpload className="w-8 h-8 text-brand-400 animate-pulse" />
                    </div>
                    <div className="w-full max-w-sm space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-white font-medium truncate max-w-[200px]">{file?.name}</span>
                        <span className="text-brand-400 font-bold tabular-nums">{progress}%</span>
                      </div>
                      <div className="w-full bg-surface-700 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="text-surface-500 text-xs">{statusText}</p>
                      <p className="text-surface-600 text-xs">Large files may take several minutes — keep this tab open</p>
                    </div>
                  </>
                ) : file ? (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-green-900/40 flex items-center justify-center">
                      <Film className="w-8 h-8 text-green-400" />
                    </div>
                    <div>
                      <p className="text-white font-semibold text-lg">{file.name}</p>
                      <p className="text-surface-500 text-sm mt-1">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFile(null); setError(""); inputRef.current?.click(); }}
                      className="text-xs text-surface-500 hover:text-white underline underline-offset-2 transition-colors"
                    >
                      Change file
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center">
                      <Upload className="w-8 h-8 text-surface-500" />
                    </div>
                    <div>
                      <p className="text-white font-semibold text-lg">Drop your video here</p>
                      <p className="text-surface-500 text-sm mt-1">or click to browse files</p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-center">
                      {["MP4", "MOV", "AVI", "MKV", "WebM"].map((f) => (
                        <span key={f} className="px-2.5 py-1 bg-surface-700 rounded-full text-xs text-surface-400">{f}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-900/30 border border-red-500/40 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            {file && phase !== "uploading" && (
              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-xs text-surface-500 uppercase tracking-wider mb-2 px-1">How do you want to clip this?</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setMode("manual")}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        mode === "manual"
                          ? "border-brand-500 bg-brand-900/30 ring-2 ring-brand-500/40"
                          : "border-surface-600 bg-surface-800 hover:border-surface-500"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Scissors className={`w-4 h-4 ${mode === "manual" ? "text-brand-300" : "text-surface-400"}`} />
                        <span className="text-white text-sm font-semibold">Manual</span>
                      </div>
                      <p className="text-surface-400 text-[11px] leading-snug">
                        I&rsquo;ll cut clips myself in the editor. No AI runs until I&rsquo;m done.
                      </p>
                    </button>
                    <button
                      onClick={() => setMode("ai")}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        mode === "ai"
                          ? "border-brand-500 bg-brand-900/30 ring-2 ring-brand-500/40"
                          : "border-surface-600 bg-surface-800 hover:border-surface-500"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Sparkles className={`w-4 h-4 ${mode === "ai" ? "text-brand-300" : "text-surface-400"}`} />
                        <span className="text-white text-sm font-semibold">AI auto-clip</span>
                      </div>
                      <p className="text-surface-400 text-[11px] leading-snug">
                        Find viral moments for me — transcript, scores, the works.
                      </p>
                    </button>
                  </div>
                </div>

                {mode === "ai" && (
                  <div className="p-4 bg-surface-800 rounded-xl border border-surface-600 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm font-medium">Smart Import — auto-trim clips</p>
                        <p className="text-surface-500 text-xs mt-0.5">AI keeps the best part of each detected clip</p>
                      </div>
                      <button
                        onClick={() => setSmartImport(!smartImport)}
                        className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${smartImport ? "bg-brand-600" : "bg-surface-600"}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all duration-200 ${smartImport ? "left-6" : "left-1"}`} />
                      </button>
                    </div>

                    {smartImport && (
                      <div className="pt-1 space-y-2.5 border-t border-surface-700">
                        <div className="flex justify-between text-xs pt-2.5">
                          <span className="text-surface-400">Clip length range</span>
                          <span className="text-brand-300 font-medium tabular-nums">{minLen}s – {maxLen}s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-surface-500 w-7">Min</span>
                          <input
                            type="range" min={10} max={90} step={5} value={minLen}
                            onChange={(e) => setMinLen(Math.min(parseInt(e.target.value), maxLen))}
                            className="flex-1 accent-brand-500"
                          />
                          <span className="text-[10px] text-white w-8 text-right tabular-nums">{minLen}s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-surface-500 w-7">Max</span>
                          <input
                            type="range" min={10} max={90} step={5} value={maxLen}
                            onChange={(e) => setMaxLen(Math.max(parseInt(e.target.value), minLen))}
                            className="flex-1 accent-brand-500"
                          />
                          <span className="text-[10px] text-white w-8 text-right tabular-nums">{maxLen}s</span>
                        </div>
                        <p className="text-[10px] text-surface-600">
                          AI picks the best length for each clip within this range.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={startUpload}
                  className="w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-white py-4 rounded-xl font-bold text-base transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-brand-900/40"
                >
                  {mode === "manual" ? <Scissors className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                  {mode === "manual" ? "Upload & Start Editing" : "Upload & Find Viral Clips"}
                </button>
              </div>
            )}

            {!file && phase === "idle" && (
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-6 w-full bg-surface-800 hover:bg-surface-700 border border-surface-600 hover:border-brand-600 text-white py-4 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" /> Browse Files
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
