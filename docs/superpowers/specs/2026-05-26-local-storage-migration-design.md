# Local-Disk Storage Migration

**Date:** 2026-05-26
**Status:** Approved, ready for implementation plan

## Why

Clip currently stores every artifact in Cloudflare R2 (source uploads, exported
clips, Story Mode TTS mp3s). For a solo-use local-only app, R2 adds friction
without much benefit:

- Chunked multipart uploads, CORS, presigned URLs, retry logic — all
  exist because R2 is remote. None of it helps on a single-user machine.
- Bucket costs and credentials to maintain.
- The FFmpeg export route has to download the source from R2 and upload the
  result back, just to use a file that was on this machine to begin with.

We're moving all storage to a local directory: `D:\clip\`, configurable via
`CLIP_STORAGE_DIR`.

## Folder layout

```
D:\clip\
  <projectId>\
    source.<ext>                    original upload (preserves source extension)
    clips\
      <clipId>\
        export.mp4                  rendered export from the editor
        voice.mp3                   Story Mode AI voiceover (if generated)
        thumb.jpg                   clip thumbnail
```

Deleting a project means `fs.rm("D:/clip/<projectId>", { recursive: true })` —
one call wipes the source and every derivative. No orphan files.

## Upload flow

1. User picks a file on `/upload`.
2. Browser does a single
   `PUT /api/upload?projectId=<id>&ext=mp4` with the raw file as the request
   body. Progress is reported via `XMLHttpRequest.upload.onprogress`, same UX
   as today minus the chunk math.
3. The route handler reads `request.body` as a `ReadableStream` and pipes it
   straight to `fs.createWriteStream("D:/clip/<projectId>/source.<ext>")`.
   The file is **never buffered in memory** — this is the load-bearing detail
   that respects the existing CLAUDE.md gotcha about `formData()` exploding on
   multi-GB uploads.
4. On finish the route writes `Project.videoUrl = "<projectId>/source.<ext>"`
   in the DB and kicks off the AI pipeline exactly as today.

The entire chunked-multipart code path (start/complete endpoints,
`putPartWithRetry`, chunk loop) is deleted.

## Serving files back to the browser

A new route `GET /api/files/[...path]` streams files from `D:\clip\<path>`
with full HTTP Range support so `<video>` scrubbing works. Implementation:

- Resolve `path.join(CLIP_STORAGE_DIR, ...segments)` and verify the resolved
  absolute path still starts with `CLIP_STORAGE_DIR` — reject otherwise. This
  blocks `..\..\windows\system32\...` even though the app is solo-use.
- Respect the `Range` header; return `206 Partial Content` with
  `Content-Range`, `Accept-Ranges: bytes`, and a Node stream sliced via
  `fs.createReadStream(p, { start, end })`.
- Set `Content-Type` from the file extension
  (mp4 → `video/mp4`, jpg → `image/jpeg`, mp3 → `audio/mpeg`).

The DB no longer stores R2 URLs. It stores relative paths like
`<projectId>/source.mp4` or `<projectId>/clips/<clipId>/export.mp4`. A small
helper `fileUrl(p)` in `lib/storage.ts` returns `` `/api/files/${p}` ``;
components use that.

## FFmpeg

The export route currently downloads the source from R2, runs FFmpeg, then
uploads the result back to R2. With local storage FFmpeg reads from
`D:\clip\<projectId>\source.<ext>` and writes to
`D:\clip\<projectId>\clips\<clipId>\export.mp4` directly. The download step
and the upload step both disappear.

Thumbnails (`extractThumbnail`) and TTS mp3s also write straight into the
project's clip folder instead of R2.

## DB

No Prisma schema change. The existing URL fields (`Project.videoUrl`,
`Clip.exportUrl`, `Clip.thumbnailUrl`, `Clip.storyVoiceUrl`) now hold
relative paths inside `D:\clip` rather than absolute R2 URLs. A short
comment in `schema.prisma` will note this.

## Files added

- `app/api/upload/route.ts` — streaming PUT to disk
- `app/api/files/[...path]/route.ts` — Range-aware file server
- `lib/storage.ts` — `CLIP_STORAGE_DIR`, `ensureDir`, `projectPath`,
  `clipPath`, `fileUrl`, path-traversal guard

## Files removed

- `lib/r2.ts`
- `app/api/upload/multipart/start/route.ts`
- `app/api/upload/multipart/complete/route.ts`
- `app/api/export/[id]/download/route.ts` (proxy to R2). The
  `/api/files/[...path]` route will accept a `?download=<filename>` query
  param and, when present, send `Content-Disposition: attachment;
  filename="..."`. Same-origin downloads work with `<a download>` so we
  don't need a separate route.

## Files edited

- `app/upload/page.tsx` — strip chunks + retry, replace with one
  `XMLHttpRequest.send(file)`
- `app/api/export/[id]/route.ts` — drop R2 round-trip; read and write
  directly on disk
- `app/api/clips/[id]/story/voice/route.ts` — write TTS mp3 to disk
- `app/api/projects/[id]/route.ts` — DELETE removes the project folder
- `app/api/process/[id]/route.ts` — read source from disk for Whisper /
  AssemblyAI (currently fetches via R2 URL)
- `lib/ffmpeg.ts` — write thumbnails / temp outputs into the project folder
- `prisma/schema.prisma` — comment that URL fields now hold relative paths
- `.env.local` — remove `CLOUDFLARE_R2_*`, add `CLIP_STORAGE_DIR=D:/clip`
- `CLAUDE.md` — update the tech-stack section and gotchas

## Out of scope

- Data migration. The DB has no projects right now and the user is deleting
  the R2 bucket. Clean slate.
- Multi-machine sync, network shares, or backups of `D:\clip`. That's the
  user's concern, not the app's.
- Streaming uploads with resume. Localhost doesn't drop; if the OS hiccups
  the user re-picks the file.

## Risks

- **AssemblyAI needs a public URL.** AssemblyAI's `/transcript` endpoint
  fetches the audio over HTTPS from a URL we supply. With local-only
  storage there's no public URL. Mitigation: extract the audio with FFmpeg
  to a temp file (we already do this for Whisper), then *upload that audio
  file* to AssemblyAI via its `/upload` endpoint (it returns an
  AssemblyAI-hosted URL). This is what the AssemblyAI SDK does by default
  when given a local path. Verify the current code does this and adjust if
  not.
- **Path-traversal in `/api/files/[...path]`.** Mitigated by the
  resolve-and-verify check described above.
- **OneDrive again.** `D:\` is a separate physical drive, not synced. Safe.
  We just need to make sure `CLIP_STORAGE_DIR` is never accidentally
  pointed at a OneDrive folder.
