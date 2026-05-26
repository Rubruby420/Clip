# Local-Disk Storage Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-26-local-storage-migration-design.md`

**Goal:** Replace all Cloudflare R2 storage (source uploads, exports, TTS mp3s, 720p proxies, waveforms, thumbnails) with a single local directory `D:\clip\<projectId>\…`, served back to the browser via one Range-aware `/api/files/[...path]` route.

**Architecture:** A small `lib/storage.ts` module owns the storage root + path helpers (with a path-traversal guard). Browser uploads become a single streaming `PUT /api/upload`. Every existing R2 read/write is replaced by direct `fs` access. The DB keeps its existing URL columns but stores **relative paths inside `D:\clip`** instead of absolute R2 URLs — the frontend renders them via `/api/files/<relative-path>`.

**Tech stack:** Next.js 15 App Router, TypeScript, Node `fs/promises` + `fs.createReadStream` / `createWriteStream`, FFmpeg (`ffmpeg-static`).

**Testing approach:** This codebase has no automated test suite. Every task ends with a manual verification step (run a command, hit a URL, watch the dev server logs) before committing. Final task is full end-to-end (upload → AI → edit → export → play → download).

**Project context to read first:**
- `CLAUDE.md` — gotchas section, especially around `formData()` for large uploads and Windows path quirks
- `prisma/schema.prisma` — `Project` has `originalUrl/originalKey/proxyUrl/proxyKey/waveform`; `Clip` has `exportUrl/exportKey/thumbnailUrl`

**Convention:** When this plan says "store `<path>` in the DB", that means a relative path like `<projectId>/source.mp4` (forward slashes, no leading slash, no `D:` prefix). Both the `Url` and `Key` columns can hold this same string — `Key` is legacy and not used by anything outside R2 code, but keeping it populated avoids changing the schema right now.

---

## Task 1: Storage foundation

**Files:**
- Create: `lib/storage.ts`
- Modify: `.env.local` (manual — user must add `CLIP_STORAGE_DIR=D:/clip`)

- [ ] **Step 1: Add `CLIP_STORAGE_DIR` to `.env.local`**

Append this line:

```
CLIP_STORAGE_DIR=D:/clip
```

Use forward slashes — Node accepts them on Windows and they avoid escaping headaches.

- [ ] **Step 2: Create the storage root**

In PowerShell:

```powershell
New-Item -ItemType Directory -Force D:\clip | Out-Null
```

Verify with `Test-Path D:\clip` (should print `True`).

- [ ] **Step 3: Write `lib/storage.ts`**

```typescript
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";

export const STORAGE_DIR = process.env.CLIP_STORAGE_DIR ?? "D:/clip";

/** Resolve a relative storage path (e.g. "abc/source.mp4") against STORAGE_DIR.
 *  Throws if the resolved path escapes STORAGE_DIR (path-traversal guard). */
export function resolveStorage(relPath: string): string {
  const root = path.resolve(STORAGE_DIR);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path traversal blocked: ${relPath}`);
  }
  return abs;
}

/** Make sure the directory containing `absPath` exists. */
export async function ensureDirFor(absPath: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
}

/** Make sure `absPath` itself is a directory. */
export async function ensureDir(absPath: string): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
}

/** Relative path (DB-shape) for a project's source file. */
export function projectSourcePath(projectId: string, ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase() || "mp4";
  return `${projectId}/source.${clean}`;
}

/** Relative path for a project's 720p proxy. */
export function projectProxyPath(projectId: string): string {
  return `${projectId}/proxy.mp4`;
}

/** Relative path for a project's waveform JSON. */
export function projectWaveformPath(projectId: string): string {
  return `${projectId}/waveform.json`;
}

/** Relative path for a clip's rendered export. */
export function clipExportPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/export.mp4`;
}

/** Relative path for a clip's Story Mode TTS voiceover. */
export function clipVoicePath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/voice.mp3`;
}

/** Relative path for a clip's thumbnail. */
export function clipThumbPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/thumb.jpg`;
}

/** Browser-facing URL for a stored file. */
export function fileUrl(relPath: string): string {
  return `/api/files/${relPath}`;
}

/** Optional `?download=<filename>` form, used by the editor's Download button. */
export function downloadUrl(relPath: string, filename: string): string {
  return `/api/files/${relPath}?download=${encodeURIComponent(filename)}`;
}

/** Stream a file off disk — used by the file route. */
export function openReadStream(absPath: string, start?: number, end?: number) {
  return createReadStream(absPath, start != null && end != null ? { start, end } : {});
}

/** Delete a project's entire folder (source + all clip artifacts). */
export async function deleteProjectFolder(projectId: string): Promise<void> {
  const abs = resolveStorage(projectId);
  await fs.rm(abs, { recursive: true, force: true });
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors related to `lib/storage.ts`. (Existing R2 callers still compile — we haven't deleted anything yet.)

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts
git commit -m "Add lib/storage.ts foundation for local-disk storage"
```

(`.env.local` is gitignored — nothing to commit there.)

---

## Task 2: `/api/files/[...path]` — Range-aware file server

**Files:**
- Create: `app/api/files/[...path]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest } from "next/server";
import fs from "fs/promises";
import { resolveStorage, openReadStream } from "@/lib/storage";

export const runtime = "nodejs";
// Range responses are streamed — never let Next try to buffer.
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", avi: "video/x-msvideo",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  mp3: "audio/mpeg", wav: "audio/wav",
  json: "application/json",
};

function contentTypeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m) return null;
  const startStr = m[1], endStr = m[2];
  let start: number, end: number;
  if (startStr === "") {
    // Suffix range: last N bytes
    const suffix = parseInt(endStr, 10);
    if (Number.isNaN(suffix)) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === "" ? size - 1 : parseInt(endStr, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const rel = segments.join("/");

  let abs: string;
  try {
    abs = resolveStorage(rel);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  let stat;
  try {
    stat = await fs.stat(abs);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });

  const size = stat.size;
  const type = contentTypeFor(abs);
  const download = req.nextUrl.searchParams.get("download");
  const disposition = download
    ? `attachment; filename="${download.replace(/"/g, "")}"`
    : "inline";

  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const { start, end } = range;
    const stream = openReadStream(abs, start, end) as unknown as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Disposition": disposition,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const stream = openReadStream(abs) as unknown as ReadableStream;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
```

- [ ] **Step 2: Drop a smoke-test file into the storage dir**

```powershell
"hello clip storage" | Out-File -Encoding utf8 D:\clip\test.txt
```

- [ ] **Step 3: Run the dev server and verify**

In a separate terminal:

```bash
npm run dev
```

Then hit the route in your browser or with curl:

```bash
curl -i http://localhost:3000/api/files/test.txt
curl -i -H "Range: bytes=0-4" http://localhost:3000/api/files/test.txt
curl -i http://localhost:3000/api/files/../package.json
```

Expected:
- First call → `200 OK`, body = `hello clip storage…`
- Second call → `206 Partial Content`, `Content-Range: bytes 0-4/…`, body = first 5 bytes
- Third call → `403 Forbidden` (traversal guard tripped)

Stop the dev server (Ctrl+C) and clean up:

```powershell
Remove-Item D:\clip\test.txt
```

- [ ] **Step 4: Commit**

```bash
git add app/api/files/
git commit -m "Add /api/files/[...path] route with Range + traversal guard"
```

---

## Task 3: New streaming upload route

**Files:**
- Create: `app/api/upload/route.ts`

This route accepts `PUT /api/upload?ext=mp4&title=My%20Video&originalName=raw.mp4` with the raw file body. It creates a new `Project` row, streams the body into `D:/clip/<projectId>/source.<ext>`, and returns `{ projectId }`. The kickoff to `/api/process/<id>` stays on the client (matches today's behaviour).

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { prisma } from "@/lib/db";
import { ensureDirFor, projectSourcePath, resolveStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Next defaults to a 4 MB body limit for route handlers — disable for uploads.
export const maxDuration = 3600;

function sanitiseExt(raw: string | null): string {
  const e = (raw ?? "mp4").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return e || "mp4";
}

export async function PUT(req: NextRequest) {
  if (!req.body) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  const ext = sanitiseExt(req.nextUrl.searchParams.get("ext"));
  const title = req.nextUrl.searchParams.get("title") || "Untitled";

  // Pre-create the Project so we have an ID for the file path.
  const relPath = projectSourcePath("__pending__", ext); // placeholder
  const project = await prisma.project.create({
    data: {
      title,
      originalUrl: "", // backfilled below once we know the path
      originalKey: "",
      status: "uploading",
    },
  });

  const finalRel = projectSourcePath(project.id, ext);
  const abs = resolveStorage(finalRel);
  await ensureDirFor(abs);

  try {
    // Web ReadableStream → Node Readable → write stream. Never buffers.
    const nodeStream = Readable.fromWeb(req.body as any);
    const ws = createWriteStream(abs);
    await pipeline(nodeStream, ws);
  } catch (err) {
    // Roll back the half-written project so the dashboard doesn't show ghosts.
    await fs.rm(abs, { force: true }).catch(() => {});
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { originalUrl: finalRel, originalKey: finalRel, status: "processing" },
  });

  return NextResponse.json({ projectId: project.id, path: finalRel });
}
```

The placeholder `relPath` line is just to make the intent clear in code; only `finalRel` is used. Leave the comment.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: passes. (`Readable.fromWeb` needs `any` because the Web/Node stream types disagree.)

- [ ] **Step 3: Commit**

```bash
git add app/api/upload/route.ts
git commit -m "Add streaming /api/upload PUT route writing to local disk"
```

---

## Task 4: Rewrite `/upload` page to use the streaming route

**Files:**
- Modify: `app/upload/page.tsx`

This rip-replaces the chunked multipart code with a single XHR PUT. The progress UI, mode picker, and Smart Import controls all stay; only the network code changes.

- [ ] **Step 1: Replace the file**

Open `app/upload/page.tsx` and:

1. Delete lines 9-97 (the `UploadPhase` type stays — everything from `// 25 MiB chunks…` through the end of `putPartWithRetry` goes).
2. Insert this in its place, right after the imports:

```typescript
type UploadPhase = "idle" | "uploading" | "uploaded" | "error";

/** Single streaming PUT to /api/upload. Returns the new projectId. */
function uploadFile(
  file: File,
  title: string,
  onProgress: (loaded: number, total: number) => void
): Promise<{ projectId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const qs = new URLSearchParams({ ext, title });
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Server returned invalid JSON")); }
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error ?? msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error(
      "Upload failed mid-stream. If the file is in a OneDrive folder, " +
      "OneDrive may have touched it — move it to D:\\ or C:\\Users\\tania\\Videos\\ and try again."
    ));
    xhr.open("PUT", `/api/upload?${qs.toString()}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.send(file);
  });
}
```

3. Replace the entire `try` block inside `startUpload` (currently lines 139-216 in the unedited file — find the block starting `const partCount = Math.ceil(...)` and ending right before `} catch (err) {`) with:

```typescript
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

      const dest = mode === "manual" ? `/source/${projectId}` : `/projects/${projectId}`;
      setTimeout(() => router.push(dest), 1500);
```

The remaining UI code (drag-drop, mode picker, Smart Import sliders, progress bar) is unchanged.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Manually verify in the browser**

`npm run dev`, open `http://localhost:3000/upload`, drop a small test video (5-50 MB is fine for this round). Watch the progress bar. After it hits 100%, verify the file exists:

```powershell
ls D:\clip\
ls D:\clip\<projectId>\
```

You should see `source.<ext>`. The page should auto-navigate to `/source/<projectId>` (manual mode) or `/projects/<projectId>` (AI mode). It is OK if that destination page errors — we haven't fixed the downstream routes yet.

- [ ] **Step 4: Commit**

```bash
git add app/upload/page.tsx
git commit -m "Rewrite /upload page as single streaming PUT to /api/upload"
```

---

## Task 5: Process route — source from disk + AssemblyAI from local file

**Files:**
- Read first: `app/api/process/[id]/route.ts`
- Modify: same file

The process route currently fetches the source video by R2 URL for Whisper transcription and passes another R2 URL to AssemblyAI. With local storage:

- For Whisper: read the file directly off disk with `fs.createReadStream` or pass the path to `extractAudio`.
- For AssemblyAI: upload the audio file to AssemblyAI's `/upload` endpoint to get an AssemblyAI-hosted URL, then submit a transcript request against that URL. The SDK does this automatically when you pass a local path.

- [ ] **Step 1: Read the current implementation**

Open and read all of `app/api/process/[id]/route.ts`. Note every place that:
- Builds an R2 URL or calls `getPublicUrl` / `getDownloadPresignedUrl`
- Passes a URL to `extractAudio`, Whisper, or AssemblyAI

- [ ] **Step 2: Replace R2 access with local disk reads**

For each call site identified in Step 1:

- Replace any `getPublicUrl(originalKey)` with `resolveStorage(project.originalUrl)` (absolute path) for places that need a filesystem path.
- For places that hand a URL to Whisper, switch to passing the local path (or use a file stream — Whisper SDK accepts `fs.createReadStream(path)`).
- For AssemblyAI: import `assemblyai`'s SDK and pass the **local audio file path** to `transcripts.transcribe(...)`. The SDK auto-uploads. If the code currently constructs a URL by hand, replace with the path.

Add the import at the top:

```typescript
import { resolveStorage } from "@/lib/storage";
```

- [ ] **Step 3: Update places that *write* derived files**

Anywhere in `/api/process/[id]` (or its helpers in `lib/`) that uploads a derived artifact to R2 (`uploadBuffer(...)`), replace with a direct disk write using the appropriate `lib/storage.ts` helper. The most common derived artifact here is the transcription JSON stored in `Project.transcription` — that's a DB column so no file changes needed.

- [ ] **Step 4: Type check + smoke run**

Run: `npx tsc --noEmit` — passes.

Restart `npm run dev`. Upload a fresh short video (1-2 min works; AI mode). Watch the dev server logs. The pipeline should reach `status: ready` and create clips.

- [ ] **Step 5: Commit**

```bash
git add app/api/process/[id]/route.ts
git commit -m "Process route: read source from local disk; AssemblyAI via /upload"
```

---

## Task 6: Proxy + waveform + finalize routes — write to disk

**Files:**
- Modify: `app/api/projects/[id]/proxy/route.ts`
- Modify: `app/api/projects/[id]/waveform/route.ts`
- Modify: `app/api/projects/[id]/finalize/route.ts`

Each of these currently downloads from R2, processes, and uploads back. Pattern is identical — only the artifact differs (mp4 proxy, JSON waveform, finalize step).

- [ ] **Step 1: Edit each route, one at a time**

For each file:

1. Replace any `getPublicUrl(project.originalKey)` or `getDownloadPresignedUrl(...)` with `resolveStorage(project.originalUrl)` — pass the absolute path to FFmpeg as input.
2. Replace any `uploadBuffer(key, buf, mime)` with:
   ```typescript
   const rel = projectProxyPath(project.id);    // or projectWaveformPath(...)
   const abs = resolveStorage(rel);
   await ensureDirFor(abs);
   await fs.writeFile(abs, buf);
   ```
3. Update the DB column to store `rel` (both the `Url` and `Key` columns get the same relative path).

Required imports at the top of each file:

```typescript
import fs from "fs/promises";
import {
  resolveStorage,
  ensureDirFor,
  projectProxyPath,        // or projectWaveformPath
} from "@/lib/storage";
```

- [ ] **Step 2: Verify each route**

For each route, hit it manually for the test project from Task 4:

```bash
# proxy
curl -X POST http://localhost:3000/api/projects/<id>/proxy
# waveform
curl -X POST http://localhost:3000/api/projects/<id>/waveform
# finalize (if it's POST)
curl -X POST http://localhost:3000/api/projects/<id>/finalize
```

After each, check that the expected file appeared on disk and the matching DB column got the relative path:

```powershell
ls D:\clip\<projectId>\
```

- [ ] **Step 3: Commit**

```bash
git add app/api/projects/
git commit -m "Project proxy/waveform/finalize routes write to local disk"
```

---

## Task 7: Export route — read source, write export, both local

**Files:**
- Read first: `app/api/export/[id]/route.ts`
- Modify: same file

- [ ] **Step 1: Read the current implementation**

Note every R2 call.

- [ ] **Step 2: Replace R2 access**

- Source path: `resolveStorage(project.originalUrl)` (or `proxyUrl` if the export uses the proxy).
- Export output: write the rendered mp4 to `resolveStorage(clipExportPath(project.id, clip.id))`. Make sure the directory exists with `ensureDirFor(...)`.
- Update `Clip.exportUrl` and `Clip.exportKey` with the relative path `clipExportPath(project.id, clip.id)`.
- Delete the `uploadBuffer` / `PutObjectCommand` block.
- Keep the temp-files-in `.tmp/` cleanup in the `finally` block.

Imports:

```typescript
import {
  resolveStorage,
  ensureDirFor,
  clipExportPath,
} from "@/lib/storage";
```

- [ ] **Step 3: Manual verification**

In the dev app, open the editor for a clip from your test project and click Export. Wait for completion. Verify:

```powershell
ls D:\clip\<projectId>\clips\<clipId>\export.mp4
```

And that the editor shows a working preview / Play / Download button. Playback in the editor should work via the new `/api/files/...` route.

- [ ] **Step 4: Commit**

```bash
git add app/api/export/[id]/route.ts
git commit -m "Export route: read source and write export on local disk"
```

---

## Task 8: TTS voiceover route — write mp3 to disk

**Files:**
- Read first: `app/api/clips/[id]/story/voice/route.ts`
- Modify: same file

- [ ] **Step 1: Replace R2 upload with disk write**

Find the `uploadBuffer` (or `PutObjectCommand`) call. Replace with:

```typescript
const rel = clipVoicePath(clip.projectId, clip.id);
const abs = resolveStorage(rel);
await ensureDirFor(abs);
await fs.writeFile(abs, mp3Buffer);
// then save `rel` into clip.storyData.voiceUrl (or wherever it lives)
```

Imports:

```typescript
import fs from "fs/promises";
import { resolveStorage, ensureDirFor, clipVoicePath } from "@/lib/storage";
```

- [ ] **Step 2: Manual verification**

Open a clip in the editor, switch to the Story tab, hit Generate Voiceover. Verify:

```powershell
ls D:\clip\<projectId>\clips\<clipId>\voice.mp3
```

And the voiceover plays inline in the panel.

- [ ] **Step 3: Commit**

```bash
git add app/api/clips/[id]/story/voice/route.ts
git commit -m "Story Mode voiceover: write TTS mp3 to local disk"
```

---

## Task 9: Project DELETE — wipe the folder

**Files:**
- Modify: `app/api/projects/[id]/route.ts`

- [ ] **Step 1: Replace the R2 delete with a folder remove**

Find the DELETE handler. Replace any `deleteObject(...)` calls with a single:

```typescript
import { deleteProjectFolder } from "@/lib/storage";
// ...
await deleteProjectFolder(project.id);
```

Run that **before** `prisma.project.delete(...)` so that if the rm fails, the DB row isn't left orphaned. Cascade deletes on `Clip` handle the rest.

- [ ] **Step 2: Manual verification**

Delete the test project from the dashboard. Verify:

```powershell
Test-Path D:\clip\<projectId>     # should print False
```

- [ ] **Step 3: Commit**

```bash
git add app/api/projects/[id]/route.ts
git commit -m "Project DELETE removes local storage folder"
```

---

## Task 10: FFmpeg helpers — thumbnails into the clip folder

**Files:**
- Modify: `lib/ffmpeg.ts`

Currently `extractThumbnail` writes to `.tmp/` and the caller uploads it to R2. With local storage we can either keep `.tmp/` for the intermediate file and then move it, or write straight into the clip folder.

- [ ] **Step 1: Find every caller of `extractThumbnail`**

Run: Grep for `extractThumbnail` across the repo.

For each caller, decide whether the destination is a clip thumbnail (write to `clipThumbPath(...)`) or something temporary (keep in `.tmp/`).

- [ ] **Step 2: Update callers, not `extractThumbnail` itself**

`extractThumbnail` should keep accepting an arbitrary output path. The change is at the caller: pass `resolveStorage(clipThumbPath(...))` and store the relative path in `Clip.thumbnailUrl`.

- [ ] **Step 3: Manual verification**

Re-process a project (or re-upload to make a new one). Thumbnails should appear on the project page (loaded via `/api/files/...`). Verify on disk:

```powershell
ls D:\clip\<projectId>\clips\<clipId>\thumb.jpg
```

- [ ] **Step 4: Commit**

```bash
git add app/ lib/
git commit -m "Write clip thumbnails into the project folder"
```

---

## Task 11: Frontend — replace stored URLs with `/api/files/...`

**Files (search-and-fix):** any component or page that reads `project.originalUrl`, `project.proxyUrl`, `clip.exportUrl`, `clip.thumbnailUrl`, `clip.storyData.voiceUrl`, etc.

The DB now stores relative paths. Components currently treat these fields as full URLs and shove them straight into `<video src>`, `<img src>`, `<audio src>`, or fetch them with `fetch()`. They need to be wrapped with `fileUrl(...)`.

- [ ] **Step 1: Find every consumer**

Grep across the repo:

- `originalUrl`
- `proxyUrl`
- `exportUrl`
- `thumbnailUrl`
- `voiceUrl`

For each, decide if it's the *write* side (API route — already updated in earlier tasks) or the *read* side (component / page — needs `fileUrl(...)`).

- [ ] **Step 2: Wrap reads with `fileUrl`**

Example, before:
```tsx
<video src={project.originalUrl} ... />
```
After:
```tsx
import { fileUrl } from "@/lib/storage";
<video src={fileUrl(project.originalUrl)} ... />
```

For the editor's Download button, use `downloadUrl(clip.exportUrl, \`\${clip.title}.mp4\`)` so the browser saves with a friendly name.

- [ ] **Step 3: Manual verification**

Walk the app end-to-end with the test project:
- Project page shows thumbnails
- `/source/<id>` loads the source video and plays
- Editor preview plays
- Export → Download saves with the right filename

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "Frontend reads stored paths via /api/files"
```

---

## Task 12: Delete R2 code

**Files to delete:**
- `lib/r2.ts`
- `app/api/upload/multipart/start/route.ts`
- `app/api/upload/multipart/complete/route.ts`
- `app/api/upload/multipart/` (the now-empty parent folder)
- `app/api/export/[id]/download/route.ts`
- `scripts/clear-r2.mjs`

- [ ] **Step 1: Confirm nothing still imports R2**

Run: Grep for `from "@/lib/r2"` and `from "../../../lib/r2"` and similar across the repo. Every match must be in a file we're about to delete or already fixed in earlier tasks.

If anything still imports it, **stop and fix that file first** — going back to Task 5-11 as needed.

- [ ] **Step 2: Delete the files**

```bash
rm lib/r2.ts
rm -r "app/api/upload/multipart"
rm "app/api/export/[id]/download/route.ts"
rm scripts/clear-r2.mjs
```

- [ ] **Step 3: Remove `@aws-sdk/*` from package.json if nothing else uses it**

Check: Grep for `@aws-sdk` across the repo. If no matches outside `package.json` and `package-lock.json`:

```bash
npm uninstall @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 4: Type check + dev server**

Run: `npx tsc --noEmit` — passes.
Restart `npm run dev` — no startup errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove R2 code; storage is now local D:\\clip"
```

---

## Task 13: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit `CLAUDE.md`**

- Remove `Cloudflare R2` bullet from the tech stack list. Add: `Local disk storage — D:\clip\<projectId>\… (configurable via CLIP_STORAGE_DIR)`.
- Remove the entire R2/CORS/multipart/forcePathStyle/checksum/CORS bullets from the Gotchas section.
- Remove the `CLOUDFLARE_R2_*` lines from the `.env.local` example. Add `CLIP_STORAGE_DIR=D:/clip`.
- Add a new Gotchas bullet:
  > **`/api/files/[...path]` is the only way browsers can read stored files.** Direct `<video src="D:/...">` won't work. Routes that produce files write them under `D:\clip\<projectId>\...` and the DB stores the *relative* path (e.g. `abc123/source.mp4`). Components wrap reads with `fileUrl(...)` from `lib/storage.ts`.
- Add another Gotchas bullet:
  > **AssemblyAI needs a URL it can fetch.** We extract audio to a local temp file with FFmpeg, then hand the *file* to the AssemblyAI SDK — which uploads to AssemblyAI's `/upload` endpoint and uses the returned URL. Don't pass a `/api/files/...` URL; AssemblyAI's servers can't reach localhost.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for local D:\\clip storage"
```

---

## Task 14: End-to-end verification

- [ ] **Step 1: Wipe the test project**

In the dashboard, delete any leftover test projects from earlier tasks. Confirm `D:\clip\` only contains intentional folders (or is empty).

- [ ] **Step 2: Run the full AI flow on a real video**

Upload a 5-15 minute video in **AI mode** with Smart Import on. Watch:

1. Upload finishes, page navigates to `/projects/<id>`.
2. Project status flips to `ready`; clips appear with thumbnails + virality scores.
3. Open a clip in the editor; the preview plays and seeks smoothly (Range requests working).
4. In the Coach tab, the report loads.
5. Export the clip. The Download button saves an mp4 with a real filename.
6. Story tab → generate voiceover; it plays inline.
7. (Optional) Viral Remix → preview → save.

- [ ] **Step 3: Run the full manual flow on a real video**

Upload another video in **Manual mode**. Navigate to `/source/<id>`; the waveform editor loads, the proxy plays, you can cut a clip.

- [ ] **Step 4: Delete-project sanity check**

Delete the test project from the dashboard. Verify `D:\clip\<id>\` is gone.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: User can now delete the R2 bucket safely.**

Remind the user: *"The app is fully on local storage. You can delete the Cloudflare R2 bucket whenever you want."*

---

## Self-review checklist (already done by the plan author)

- **Spec coverage:** every section of the spec maps to a task — foundation (Task 1), upload (Tasks 3-4), file serving (Task 2), FFmpeg (Tasks 5-7, 10), DB convention (Task 1 + all write sites), deletes (Task 9), removals (Task 12), CLAUDE.md (Task 13), risks (AssemblyAI handled in Task 5 + Task 13 note; path traversal in Task 2).
- **Placeholder scan:** no TBDs. Where an existing file's exact contents matter, the plan tells the engineer to read it first (Step 1 of the affected task) instead of guessing line numbers.
- **Type consistency:** every helper used in later tasks (`projectSourcePath`, `clipExportPath`, `clipThumbPath`, `clipVoicePath`, `projectProxyPath`, `projectWaveformPath`, `resolveStorage`, `ensureDirFor`, `deleteProjectFolder`, `fileUrl`, `downloadUrl`, `openReadStream`) is defined in Task 1.
- **Scope:** single migration, one implementation cycle.
