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
- **Prisma + SQLite** — `prisma/schema.prisma`. DB file lives OUTSIDE the repo at
  `C:/Users/tania/ClipData/dev.db` (see gotcha — must not be in OneDrive)
- **Cloudflare R2** — video storage (S3-compatible)
- **OpenAI Whisper** (`whisper-1`) — transcription with word-level timestamps
- **OpenAI `gpt-4o-mini`** — highlight detection, viral-remix recipes, Story Mode
- **OpenAI TTS** (`tts-1`) — AI voiceover generation for Story Mode
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
    clips/[id]/story            Story Mode — generate the story plan
    clips/[id]/story/voice      Story Mode — generate AI voiceover (TTS)
    clips/[id]/coach            Virality Coach — readiness check + reference videos
    export/[id]                 FFmpeg render + upload final mp4 to R2
components/editor/              Timeline, CanvasPreview, CaptionPanel, LayoutPanel,
                                RemixPanel, StoryPanel, CoachPanel
lib/
  db.ts          Prisma client singleton
  r2.ts          R2/S3 client + multipart helpers
  whisper.ts     Transcription wrapper
  assemblyai.ts  Highlight detection (auto-chapters)
  highlights.ts  LLM highlight detection + clip titling (fallback for assemblyai)
  youtube.ts     YouTube Data API — search viral videos, score by views/day
  remix.ts       AI viral-remix strategist (search queries + remix recipe)
  story.ts       Story Mode — story plan + AI voiceover (TTS)
  coach.ts       Virality Coach — clip readiness evaluation
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
   JAMENDO_CLIENT_ID=
   DATABASE_URL="file:C:/Users/tania/ClipData/dev.db"
   ```
   `YOUTUBE_API_KEY` (free): Google Cloud Console → create a project → enable
   "YouTube Data API v3" → Credentials → Create credentials → API key.
   `JAMENDO_CLIENT_ID` (free): https://developer.jamendo.com → sign up →
   create an app → copy the Client ID. Used for AI Remix background music.
   `DATABASE_URL` must point OUTSIDE OneDrive (see gotcha below).
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
- **R2 client must use `forcePathStyle: true`** (set in `lib/r2.ts`). R2 only
  guarantees DNS for `<account>.r2.cloudflarestorage.com`; the AWS SDK's default
  virtual-hosted style produces `<bucket>.<account>.r2.cloudflarestorage.com`,
  which can resolve in browsers (Chrome DoH / cached) but fails server-side in
  Node with `getaddrinfo ENOTFOUND`. This broke the export route's source-video
  download — every server-to-R2 request needs path-style addressing.
- **Subtitle paths must escape `:` for FFmpeg's `subtitles` filter** (handled in
  `lib/ffmpeg.ts`). The filter uses `:` as its option separator, so a Windows
  path like `C:/Users/...` gets mis-parsed (FFmpeg reads `C` as the file and
  `/...` as the `original_size` option). Replace `\` with `/` then escape every
  `:` as `\:`.
- **Export download uses a same-origin proxy route + R2's
  `ResponseContentDisposition`.** A naive `<a href="<r2-url>" download>` is
  silently ignored by browsers for cross-origin URLs (clicking just plays the
  video). `/api/export/[id]/download` 302s to a presigned R2 URL with
  `Content-Disposition: attachment` baked in, which forces a save-to-disk.
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
- **The SQLite DB must live OUTSIDE OneDrive.** `DATABASE_URL` points to
  `C:/Users/tania/ClipData/dev.db` — NOT the project folder, which is OneDrive-synced.
  OneDrive syncing a live SQLite file can swap it for an older copy and cause total data
  loss (this happened once — the whole projects table was wiped). Always copy the DB to
  a backup before `prisma db push`.
- **The Prisma CLI only reads `.env`, not `.env.local`.** Next.js reads `.env.local`,
  so the app runs fine, but `npm run db:push` / `prisma generate` fail with
  "Environment variable not found: DATABASE_URL". Run them with the var set inline:
  `$env:DATABASE_URL='file:C:/Users/tania/ClipData/dev.db'; npm run db:push` (PowerShell).
- **`prisma generate` fails with `EPERM` while `npm run dev` is running** — the dev
  server locks the query-engine DLL. Stop the dev server first, then regenerate.
- **Viral Remix** (`lib/youtube.ts` + `lib/remix.ts`, `api/remix/[clipId]`
  + `api/remix/[clipId]/clone`, editor "Viral" tab): two-stage flow. (1) Find
  10 viral references on YouTube in the clip's niche. (2) User picks 1-5 to
  clone the style of → `gpt-4o-mini` builds a beat-by-beat clone recipe
  (style summary, hook + on-screen text, suggested title, music vibe,
  hashtags, 4-6 editBeats with `timeRange/cut/overlay/emoji/sound`,
  predicted virality). The recipe gets PREVIEWED on the clip (Preview-
  before-apply mode — see next bullet) and on Save commits the hook overlay,
  caption style, title, beat overlays, and background music all at once.
  Adapts *format* only — never reuses footage. Cached in `Clip.remixData`.
- **Preview-before-apply** for Viral Remix: clicking "Preview this edit on my
  clip" in the Viral panel applies the AI's planned changes to the live
  canvas (hook overlay, beat overlays, caption style, title, background
  music) but does NOT auto-save. A yellow `Previewing AI remix` bar with
  Save/Discard appears in the editor; the auto-save effect is gated on
  `!previewMode`. Save commits via a single PATCH; Discard restores the
  pre-preview snapshot.
- **Hook + beat overlays** (`LayoutPanel.LayoutConfig.overlayText`,
  `LayoutConfig.beatOverlays`, `CanvasPreview`, `lib/ffmpeg.generateOverlayAss`):
  the editor renders a big top-of-screen hook for the first N seconds plus
  beat-by-beat text+emoji "stamps" cycling through top/center/bottom
  positions. On export, a single ASS subtitle file containing every event is
  chained as a second `subtitles=` filter after the captions. Use single
  quotes + colon-escape on the ASS path (same Windows gotcha as the captions
  SRT — see below).
- **AI background music** (`lib/music.ts`, `api/clips/[id]/music`, music
  fields on `LayoutConfig`): when previewing a Remix, the recipe's
  `musicVibe` string is sent to Jamendo's `/v3.0/tracks/` API; the panel
  picks a random track from the top 5 popular matches in the duration range,
  saves `{musicUrl, musicTitle, musicArtist}` into `layoutConfig`. The
  CanvasPreview plays it via a synced `<audio>` (play/pause/seeked listeners
  on the main video). FFmpeg export adds the mp3 as input #1 and mixes via
  `[1:a]volume=V,aloop[mus];[0:a][mus]amix=2:duration=first`. The clip-local
  music chip below the preview has a volume slider and ✕ to remove.
- **AI Auto-Cut** (`selectBestSegment` in `lib/highlights.ts`, `api/clips/[id]/autocut`):
  the editor opens with a blocking choice modal — AI Auto-Cut or Edit Manually. AI
  picks the tightest segment within the clip; the result is applied as a normal trim
  (auto-saved) and stays adjustable by hand. The autocut route only *suggests* times;
  the editor applies them. An "AI Cut" header button re-runs it any time.
- **Story Mode** (`lib/story.ts`, `api/clips/[id]/story` + `/voice`, editor "Story"
  tab): turns a clip into a structured story. `gpt-4o-mini` reads the whole video for
  context and produces a story plan — 3-5 beats, each with a hybrid voiceover line
  (original / bridge / new), a one-line on-screen callout, a sound/B-roll cue — plus a
  recommended re-cut and an AI-picked TTS voice. The script is editable in the panel;
  "generate voiceover" runs OpenAI `tts-1`, uploads the mp3 to R2, and plays it inline.
  Plan cached in `Clip.storyData` (JSON).
- **Smart Import** (upload-page toggle → `api/process/[id]` body): when enabled, the
  process pipeline runs `selectBestSegment` on every detected highlight and saves clips
  already trimmed to their best part, within a user-chosen min-max length range
  (10-90s). The process route reads `{ smartImport, minLen, maxLen }` from its POST
  body; it's off when called with no body.
- **Virality Coach** (`lib/coach.ts`, `api/clips/[id]/coach`, editor "Coach" tab):
  the process pipeline auto-runs `evaluateClip` on every clip (score + verdict + issue/
  fix comments) and stores it in `Clip.coachData`. Weak clips (`viralReady: false`) get
  a "needs work" badge on the project page. The Coach tab shows the critique; for weak
  clips it also pulls reference viral videos via the Remix/YouTube helpers (POST does
  evaluation + video fetch; the import auto-check stores the report only).

## Status (last session, 2026-05-18)

**All planned AI features are built, committed, and pushed to GitHub.**

- Upload pipeline (multipart to R2): **working**, verified with a 5 GB file.
- AI processing kicks off automatically after upload.
- Editor and export are built; export had been exercised (left temp files in `.tmp/`).
- **Highlight detection fixed** — LLM fallback gives clips real titles.
- **Viral Remix, AI Auto-Cut, Story Mode, Virality Coach** — built and **tested live**.
- **Smart Import** — built; runs only inside the import pipeline, so it will be
  exercised on the next real upload (toggle is on the upload page).
- **Database** — moved out of OneDrive to `C:/Users/tania/ClipData/dev.db` after a
  OneDrive-sync incident wiped it once. Always back up before `prisma db push`.
- **App is a clean slate.** The test project (UberX) and its video were deleted by the
  user on purpose (a delete click in the dashboard also wipes the R2 video). The
  database currently has no projects — upload a fresh video to use the app.

### Next session
- No feature backlog. Likely next steps: a live test of Smart Import + FFmpeg export
  on a fresh upload, or a brand-new feature the user decides on.

## Repository

GitHub: https://github.com/Rubruby420/Clip — branch `main`

## Git workflow

Commit and push to `origin/main` after every meaningful change. Use concise imperative
commit messages (e.g. `Add feature X`, `Fix bug in Y`).
