"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Film, ArrowLeft, Loader2, CheckCircle, Zap } from "lucide-react";
import { formatFileSize } from "@/lib/utils";

type UploadPhase = "idle" | "uploading" | "uploaded" | "error";

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [autoProcess, setAutoProcess] = useState(true);

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

    try {
      // Get presigned URL
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const { presignedUrl, key, projectId } = await presignRes.json();

      // Upload to R2 via XHR (for progress tracking)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.open("PUT", presignedUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // Mark complete
      await fetch("/api/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, key }),
      });

      setPhase("uploaded");

      if (autoProcess) {
        await fetch(`/api/process/${projectId}`, { method: "POST" });
      }

      setTimeout(() => router.push(`/projects/${projectId}`), 1200);
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  }

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
        <span className="text-white font-medium">New Project</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold text-white mb-2">Upload Recording</h1>
        <p className="text-surface-500 mb-10">Drop any long-form video — stream VOD, podcast, interview, gameplay. AI will find the viral moments.</p>

        {phase === "uploaded" ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <CheckCircle className="w-16 h-16 text-green-400" />
            <p className="text-white text-xl font-semibold">Upload complete!</p>
            <p className="text-surface-500 text-sm">Redirecting to your project…</p>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-brand-500 bg-brand-900/20"
                  : file
                  ? "border-green-500 bg-green-900/10"
                  : "border-surface-600 hover:border-surface-500 bg-surface-800"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => phase === "idle" && inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />

              {phase === "uploading" ? (
                <div className="space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-brand-500 mx-auto" />
                  <p className="text-white font-medium">Uploading {file?.name}</p>
                  <div className="w-full bg-surface-700 rounded-full h-2">
                    <div
                      className="bg-brand-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-surface-500 text-sm">{progress}%</p>
                </div>
              ) : file ? (
                <div className="space-y-3">
                  <Film className="w-12 h-12 text-green-400 mx-auto" />
                  <p className="text-white font-semibold">{file.name}</p>
                  <p className="text-surface-500 text-sm">{formatFileSize(file.size)}</p>
                  <p className="text-xs text-surface-600">Click to change file</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-12 h-12 text-surface-500 mx-auto" />
                  <p className="text-white font-medium">Drag & drop your video here</p>
                  <p className="text-surface-500 text-sm">or click to browse</p>
                  <p className="text-xs text-surface-600 mt-2">MP4, MOV, AVI, MKV supported</p>
                </div>
              )}
            </div>

            {error && (
              <p className="mt-4 text-red-400 text-sm">{error}</p>
            )}

            {/* Options */}
            {file && phase !== "uploading" && (
              <div className="mt-6 space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    className={`w-10 h-6 rounded-full transition-colors relative ${autoProcess ? "bg-brand-600" : "bg-surface-600"}`}
                    onClick={() => setAutoProcess(!autoProcess)}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${autoProcess ? "left-5" : "left-1"}`} />
                  </div>
                  <div>
                    <p className="text-white text-sm font-medium">Auto-process with AI</p>
                    <p className="text-surface-500 text-xs">Automatically detect highlights after upload</p>
                  </div>
                </label>

                <button
                  onClick={startUpload}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload & {autoProcess ? "Find Clips" : "Save"}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
