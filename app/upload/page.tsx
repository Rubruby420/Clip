"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Film, ArrowLeft, CheckCircle, Zap, CloudUpload } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

type UploadPhase = "idle" | "uploading" | "uploaded" | "error";

// 95 MiB chunks — safely above R2's 5 MiB minimum, ~54 parts for a 5 GB file
const CHUNK_SIZE = 95 * 1024 * 1024;
const CONCURRENCY = 4;

interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** PUT a single chunk to its presigned R2 URL, reporting bytes loaded. */
function putPart(
  url: string,
  chunk: Blob,
  onProgress: (loaded: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (etag) resolve(etag);
        else reject(new Error("R2 did not return an ETag — check the bucket's CORS ExposeHeaders setting."));
      } else {
        reject(new Error(`Chunk upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Connection lost while uploading. Check the bucket CORS policy."));
    xhr.open("PUT", url);
    xhr.send(chunk);
  });
}

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [autoProcess, setAutoProcess] = useState(true);
  const [statusText, setStatusText] = useState("");

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
      const partCount = Math.ceil(file.size / CHUNK_SIZE);

      // 1. Start the multipart upload, get presigned URLs for every chunk
      const startRes = await fetch("/api/upload/multipart/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          title: file.name.replace(/\.[^/.]+$/, ""),
          partCount,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? "Failed to start upload");
      const { projectId, key, uploadId, partUrls } = startData;

      // 2. Upload all chunks directly to R2, with limited concurrency
      const loaded = new Array<number>(partCount).fill(0);
      const parts = new Array<UploadedPart>(partCount);

      const report = () => {
        const total = loaded.reduce((a, b) => a + b, 0);
        setProgress(Math.min(99, Math.round((total / file.size) * 100)));
      };

      let nextIndex = 0;
      async function worker() {
        while (nextIndex < partCount) {
          const i = nextIndex++;
          const start = i * CHUNK_SIZE;
          const chunk = file!.slice(start, Math.min(start + CHUNK_SIZE, file!.size));
          const etag = await putPart(partUrls[i], chunk, (b) => { loaded[i] = b; report(); });
          loaded[i] = chunk.size;
          report();
          parts[i] = { partNumber: i + 1, etag };
        }
      }

      setStatusText(`Uploading ${partCount} chunk${partCount > 1 ? "s" : ""} to cloud storage…`);
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, partCount) }, worker));

      // 3. Finalise the upload
      setStatusText("Finalising upload…");
      setProgress(100);
      const completeRes = await fetch("/api/upload/multipart/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, key, uploadId, parts }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error ?? "Failed to finalise upload");

      setStatusText("Upload complete! Starting AI…");
      setPhase("uploaded");

      if (autoProcess) {
        await fetch(`/api/process/${projectId}`, { method: "POST" });
      }

      setTimeout(() => router.push(`/projects/${projectId}`), 1500);
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
              <p className="text-surface-500">AI is now finding your best moments…</p>
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
                <div className="flex items-center justify-between p-4 bg-surface-800 rounded-xl border border-surface-600">
                  <div>
                    <p className="text-white text-sm font-medium">Auto-detect highlights with AI</p>
                    <p className="text-surface-500 text-xs mt-0.5">Transcribe & find viral moments automatically</p>
                  </div>
                  <button
                    onClick={() => setAutoProcess(!autoProcess)}
                    className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${autoProcess ? "bg-brand-600" : "bg-surface-600"}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 shadow-sm transition-all duration-200 ${autoProcess ? "left-6" : "left-1"}`} />
                  </button>
                </div>

                <button
                  onClick={startUpload}
                  className="w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-white py-4 rounded-xl font-bold text-base transition-all duration-200 flex items-center justify-center gap-2.5 shadow-lg shadow-brand-900/40"
                >
                  <Zap className="w-5 h-5" />
                  {autoProcess ? "Upload & Find Viral Clips" : "Upload Video"}
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
