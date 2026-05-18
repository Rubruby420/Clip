# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this is

**Clip** — an AI clipping-agency web app. Upload a long-form recording (stream VOD,
podcast, gameplay, interview); AI detects the viral highlight moments and turns them
into short-form clips. A browser editor lets you trim, restyle, add backgrounds and
trendy captions, then export sized for TikTok/Reels/Shorts, YouTube, or Instagram.
Reference product: Riverside.fm Magic Clips. Editor depth like Premiere, ease like CapCut.

Solo-use app (no multi-tenant auth).

## Tech stack

- **Next.js 15** (App Router, TypeScript) — full-stack, API routes for the backend
- **Tailwind CSS** — dark-mode UI. Configs are `postcss.config.js` + `tailwind.config.js`
- **Prisma + SQLite** — `prisma/schema.prisma`, DB file `prisma/dev.db` (gitignored)
- **Cloudflare R2** — video storage (S3-compatible)
- **OpenAI Whisper** (`whisper-1`) — transcription with word-level timestamps
- **OpenAI `gpt-4o-mini`** — viral-remix strategist (search queries + remix recipes)
- **AssemblyAI** — auto-chapters / highlight detection + virality scoring
- **YouTube Data API v3** — finds currently-viral videos to use as remix templates
- **FFmpeg** via `ffmpeg-static` + `child_process` — audio extract, thumbnails, export render
- **lucide-react** — icons. (`konva`/`react-konva` are installed but the editor preview
  currently uses plain HTML video + CSS overlays, not a Konva canvas.)

## Project structure

```
app/
  page.tsx                      Dashboard — project list, delete/rename
  upload/page.tsx               Drag-drop upload (chunked multipart to R2)
  projects/[id]/page.tsx        Clip grid — AI candidates with scores/thumbnails
  editor/[id]/page.tsx          Clip editor shell
  api/
    upload/multipart/start      Create R2 multipart upload + presigned part URLs
    upload/multipart/complete   Finalise the multipart upload
    process/[id]                AI pipeline (Whisper + AssemblyAI) — runs async
    remix/[clipId]              Viral Remix — YouTube search + AI remix recipe
    projects, projects/[id]     Project CRUD
    projects/[id]/retitle       Re-title generic "Clip N" clips from their transcript
    clips/[id]                  Clip CRUD
    clips/[id]/autocut          AI picks the best segment within a clip
    export/[id]                 FFmpeg render + upload final mp4 to R2
components/editor/              Timeline, CanvasPreview, CaptionPanel, LayoutPanel, RemixPanel
lib/
  db.ts          Prisma client singleton
  r2.ts          R2/S3 client + multipart helpers
  whisper.ts     Transcription wrapper
  assemblyai.ts  Highlight detection (auto-chapters)
  highlights.ts  LLM highlight detection + clip titling (fallback for assemblyai)
  youtube.ts     YouTube Data API — search viral videos, score by views/day
  remix.ts       AI viral-remix strategist (search queries + remix recipe)
  captions.ts    Caption grouping + 4 styles (karaoke, bold-pop, minimal, emoji-auto)
  ffmpeg.ts      FFmpeg wrappers (extractAudio, extractThumbnail, exportClip, generateSRT)
```

## Setup & running

1. `npm install`
2. Create `.env.local` (gitignored) with these keys:
   ```
   CLOUDFLARE_R2_ACCOUNT_ID=
   CLOUDFLARE_R2_ACCESS_KEY_ID=
   CLOUDFLARE_R2_SECRET_ACCESS_KEY=
   CLOUDFLARE_R2_BUCKET_NAME=
   CLOUDFLARE_R2_PUBLIC_URL=
   OPENAI_API_KEY=
   ASSEMBLYAI_API_KEY=
   YOUTUBE_API_KEY=
   DATABASE_URL="file:./dev.db"
   ```
   `YOUTUBE_API_KEY` (free): Google Cloud Console → create a project → enable
   "YouTube Data API v3" → Credentials → Create credentials → API key.
3. `npm run db:push` — creates the SQLite database
4. `npm run dev` — starts on **port 3000** (locked; see note below)

Other commands: `npm run build`, `npm run db:studio`.

## Important implementation notes / gotchas

- **Uploads use chunked multipart, direct browser to R2.** The file is split into 95 MiB
  chunks (`app/upload/page.tsx`), each PUT straight to a presigned R2 URL, 4 in parallel.
  Do NOT route large uploads through the Next.js server — buffering multi-GB files in
  memory fails (`formData()` throws). This was learned the hard way.
- **R2 client needs `requestChecksumCalculation: "WHEN_REQUIRED"`** (set in `lib/r2.ts`).
  Without it, the AWS SDK v3 adds `x-amz-checksum-*` headers that break browser uploads
  via presigned URLs (signature / CORS mismatch).
- **R2 bucket CORS must allow `PUT` and expose the `ETag` header.** Multipart completion
  needs the ETag from each part-upload response. The bucket's CORS policy lists
  `AllowedMethods: [GET,PUT,HEAD,POST]`, `AllowedHeaders: ["*"]`, `ExposeHeaders: ["ETag"]`,
  and `AllowedOrigins` including `http://localhost:3000`.
- **Dev server is locked to port 3000** (`next dev -p 3000` in package.json). The R2 CORS
  `AllowedOrigins` depends on the exact origin — don't let it drift to another port.
- **Tailwind / PostCSS configs must be `.js` (CommonJS)**, not `.ts` / `.mjs`. Next.js was
  not picking up the `.ts` / `.mjs` versions and the whole app rendered unstyled.
- **The AI pipeline (`api/process/[id]`) runs async** — the route returns immediately and
  processing continues in the background, flipping `Project.status` through
  `processing -> ready` (or `error`). The UI polls.
- **Highlight detection has a two-tier fallback.** AssemblyAI auto-chapters run first;
  if they error or return nothing, `lib/highlights.ts` (`gpt-4o-mini`) detects highlights
  from the Whisper transcript with real titles. Fixed 60s "Clip N" segments are only a
  last resort if both fail. AssemblyAI errors are now logged, not swallowed.
- **FFmpeg temp files** are written to `.tmp/` (gitignored). The export route should clean
  them in a `finally` block; on Windows cleanup can fail if a file is still locked.
- The project was scaffolded **manually** (not via `create-next-app`) because
  `create-next-app` rejects the capital letter in the `Clip/` folder name.
- **The Prisma CLI only reads `.env`, not `.env.local`.** Next.js reads `.env.local`,
  so the app runs fine, but `npm run db:push` / `prisma generate` fail with
  "Environment variable not found: DATABASE_URL". Run them with the var set inline:
  `$env:DATABASE_URL='file:./dev.db'; npm run db:push` (PowerShell).
- **`prisma generate` fails with `EPERM` while `npm run dev` is running** — the dev
  server locks the query-engine DLL. Stop the dev server first, then regenerate.
- **Viral Remix** (`lib/youtube.ts` + `lib/remix.ts`, `api/remix/[clipId]`, editor
  "Viral" tab): searches YouTube for viral videos in the clip's niche, then has
  `gpt-4o-mini` build a remix recipe (hook, title, caption style, hashtags, re-cut
  tips). It adapts the *format* only — never reuses footage. Result is cached in
  `Clip.remixData` (JSON).
- **AI Auto-Cut** (`selectBestSegment` in `lib/highlights.ts`, `api/clips/[id]/autocut`):
  the editor opens with a blocking choice modal — AI Auto-Cut or Edit Manually. AI
  picks the tightest segment within the clip; the result is applied as a normal trim
  (auto-saved) and stays adjustable by hand. The autocut route only *suggests* times;
  the editor applies them. An "AI Cut" header button re-runs it any time.

## Status (last session, 2026-05-18)

- Upload pipeline (multipart to R2): **working**, verified with a 5 GB file.
- AI processing kicks off automatically after upload.
- Editor and export are built; export had been exercised (left temp files in `.tmp/`).
- **Viral Remix feature added** — `YOUTUBE_API_KEY` is set; tested live and working.
- **Highlight detection fixed** — LLM fallback gives clips real titles when AssemblyAI
  yields no chapters. `retitle` endpoint backfills existing generic-titled clips.
- Not yet rigorously tested end-to-end: editor caption preview, export output.

## Repository

GitHub: https://github.com/Rubruby420/Clip — branch `main`

## Git workflow

Commit and push to `origin/main` after every meaningful change. Use concise imperative
commit messages (e.g. `Add feature X`, `Fix bug in Y`).
