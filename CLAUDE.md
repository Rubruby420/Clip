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
- **Local disk storage** — `D:\clip\<projectId>\…` for source uploads, exports,
  Story Mode TTS, 720p proxy, thumbnails. Configurable via `CLIP_STORAGE_DIR`.
  Files are served back to the browser through `/api/files/[...path]` with HTTP
  Range support. (Previously Cloudflare R2 — migrated 2026-05-26, see
  `docs/superpowers/specs/2026-05-26-local-storage-migration-design.md`.)
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
  upload/page.tsx               Drag-drop upload (single streaming PUT to disk)
  projects/[id]/page.tsx        Clip grid — AI candidates with scores/thumbnails
  editor/[id]/page.tsx          Clip editor shell
  api/
    upload                      Streaming PUT — writes the file to D:\clip\<id>\source.<ext>
    files/[...path]             Range-aware reader for everything under D:\clip
    process/[id]                AI pipeline (Whisper + AssemblyAI) — runs async
    remix/[clipId]              Viral Remix — YouTube search + AI remix recipe
    projects, projects/[id]     Project CRUD (DELETE wipes the storage folder)
    projects/[id]/retitle       Re-title generic "Clip N" clips from their transcript
    clips/[id]                  Clip CRUD
    clips/[id]/autocut          AI picks the best segment within a clip
    clips/[id]/story            Story Mode — generate the story plan
    clips/[id]/story/voice      Story Mode — generate AI voiceover (TTS, writes mp3 to disk)
    clips/[id]/coach            Virality Coach — readiness check + reference videos
    export/[id]                 FFmpeg render — writes export.mp4 into the clip folder
components/editor/              Timeline, CanvasPreview, CaptionPanel, LayoutPanel,
                                RemixPanel, StoryPanel, CoachPanel, ClipGroups
lib/
  db.ts          Prisma client singleton
  storage.ts     Local-storage paths, traversal guard, fileUrl/downloadUrl helpers
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
   OPENAI_API_KEY=
   ASSEMBLYAI_API_KEY=
   YOUTUBE_API_KEY=
   JAMENDO_CLIENT_ID=
   DATABASE_URL="file:C:/Users/tania/ClipData/dev.db"
   CLIP_STORAGE_DIR=D:/clip
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

- **Uploads stream a single PUT body straight to disk** (`app/upload/page.tsx` →
  `app/api/upload/route.ts`). The route reads `request.body` as a Node `Readable`
  and pipes it to `fs.createWriteStream` — the file is never buffered in memory.
  Do NOT switch to `request.formData()` for the upload route; buffering multi-GB
  files in memory fails. This is the same gotcha that killed the original R2
  multipart approach.
- **`/api/files/[...path]` is the only way the browser reads stored files.**
  Direct `<video src="D:/...">` won't work. Routes that produce files write them
  under `D:\clip\<projectId>\…` and the DB stores the *relative* path
  (e.g. `abc123/source.mp4`). Components wrap reads with `fileUrl(...)` from
  `lib/storage.ts`. Downloads use `downloadUrl(path, filename)` which adds
  `?download=<name>` and the route returns `Content-Disposition: attachment`.
- **AssemblyAI needs a URL it can fetch.** We extract audio with FFmpeg to a
  local temp file, then hand the *file path* to the AssemblyAI SDK — which
  uploads the bytes to `/upload` and uses the returned URL. Never pass a
  `/api/files/...` URL; AssemblyAI's servers can't reach localhost.
- **The path-traversal guard in `lib/storage.ts`** resolves every requested
  path against `STORAGE_DIR` and rejects anything that escapes. Keep that
  check intact in every storage helper.
- **Subtitle paths must escape `:` for FFmpeg's `subtitles` filter** (handled in
  `lib/ffmpeg.ts`). The filter uses `:` as its option separator, so a Windows
  path like `C:/Users/...` gets mis-parsed (FFmpeg reads `C` as the file and
  `/...` as the `original_size` option). Replace `\` with `/` then escape every
  `:` as `\:`.
- **Dev server is locked to port 3000** (`next dev -p 3000` in package.json).
  Same-origin file URLs (`/api/files/...`) follow the dev origin, so a port
  drift just means cached pages 404 on assets — not a security issue.
- **Tailwind / PostCSS configs must be `.js` (CommonJS)**, not `.ts` / `.mjs`. Next.js was
  not picking up the `.ts` / `.mjs` versions and the whole app rendered unstyled.
- **The AI pipeline (`api/process/[id]`) runs async** — the route returns immediately and
  processing continues in the background, flipping `Project.status` through
  `processing -> ready` (or `error`). The UI polls.
- **The 720p proxy is built LAST and never blocks clip detection.** It used to run
  before clips, so a huge 4K source (a 15 GB DJI upload) whose proxy encode never
  finished wedged the whole "Detecting your clips" screen. Now the pipeline flips the
  project to `ready` as soon as clips exist, then builds the proxy via `finishWithProxy()`.
  `lib/ffmpeg.generatePreviewProxy` spawns ffmpeg directly (NOT through `exec`/`cmd.exe`,
  which on Windows can orphan the child when killed) and `SIGKILL`s it after a timeout
  (8-min default in the pipeline). If the proxy fails/times out it's non-fatal — the editor
  falls back to the original video.
- **The proxy encode is GPU-assisted (`-hwaccel auto`) and outputs 720p/30fps/8-bit.**
  The bottleneck on big sources is *decoding* (phone/drone 4K is often 10-bit HEVC at
  60fps); `-hwaccel auto` offloads decode to the GPU (dxva2/d3d11va/cuda/qsv) and falls
  back to software if none works. Pure-CPU decode of such files stalls at ~0 bytes and
  just times out. **Hardware reality on this machine (Intel Iris Xe iGPU):** a 4K/60fps
  10-bit source still only encodes at ~0.6x real-time, because the decoded frames must be
  copied off the iGPU for the CPU scale/encode. A full on-GPU pipeline (`vpp_qsv`/
  `scale_qsv` + `h264_qsv`) would be far faster but is **broken in the bundled
  `ffmpeg-static`** (filter "Failed to inject frame" / decode errors) — don't rely on it.
- **"Smoother preview" (`api/projects/[id]/proxy`) is a non-blocking background job.**
  Because a long 4K proxy can take tens of minutes, the POST kicks off the encode and
  returns immediately (`{ status: "started" | "running" | "ready" }`); an in-process
  `Set` guards against duplicate encodes; the encode has a 90-min cap. The source editor
  (`app/source/[id]/page.tsx`) keeps playing the original and polls `GET /api/projects/[id]`
  until `proxyUrl` lands, then swaps the preview in. The prep progress bar is a *time
  estimate* (no real ffmpeg progress is piped), budgeted at ~1.5x source duration; it had
  a bug where manual generation nulled `prepStartedAt` and froze the bar at 0% — fixed by
  anchoring to `Date.now()` and adding the generating flags to the estimate effect's deps.
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
  "generate voiceover" runs OpenAI `tts-1` and writes the mp3 to
  `<projectId>/clips/<clipId>/voice.mp3`, served via `/api/files`. Plan cached
  in `Clip.storyData` (JSON).
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
- **Multi-Playlist Clips** (`components/editor/ClipGroups.tsx`, used in the source
  editor sidebar `app/source/[id]/page.tsx`): the "Clips in this project" list
  auto-organizes into collapsible groups of 12, labeled A, B, C… (then AA, AB… after Z,
  spreadsheet-style). Headers read "{Letter} Clips {start}-{end}" (e.g. "B Clips 13-24").
  Numbering is global/continuous (Clip 1..N) in **creation order** — the source page sorts
  a copy of `project.clips` by `createdAt` asc and passes it in (the API still returns them
  score-desc; the waveform's `savedClips` keep that order). Groups are derived by chunking,
  so deleting a clip rebalances automatically. Collapsed by default; per-group collapse
  state is keyed by letter and persisted to `localStorage["clipGroups:open:<projectId>"]`
  (loaded in a post-mount effect to avoid a hydration mismatch). Pure UI/derived — no DB.
- **Inline title rename** (source editor): a pencil next to the video/project title in the
  header and next to every clip row in the groups. Click → text field → Enter (or blur)
  saves, Escape cancels. `ClipGroups` owns the edit-field UI and calls an `onRenameClip`
  prop; the source page does optimistic local update + `PATCH /api/clips/[id]` (clip) or
  `PATCH /api/projects/[id]` (title). Enter is routed through `.blur()` so it commits once.
  No API changes — both PATCH routes already accept `{ title }`.
- **Fullscreen toggle** (`components/editor/CanvasPreview.tsx`): a maximize/minimize button
  in the preview's bottom control bar fullscreens the **composed preview container** (so
  captions + hook/beat overlays show too, with the `object-contain` video letterboxed) via
  the Fullscreen API. An internal `containerRef` is merged with the forwarded `ref`;
  `isFullscreen` mirrors `document.fullscreenElement` (so the icon is right even on Esc);
  when fullscreen the root div swaps its aspect-box classes for `w-screen h-screen
  rounded-none`. Shared component, so it shows on the source, clip, and beta editors.
- **Preview settings menu + playback speed** (`components/editor/CanvasPreview.tsx`): a
  gear icon in the control bar (left of fullscreen) toggles a small popover that
  animates open/close (fade + scale from the corner, `pointer-events-none` + `aria-hidden`
  when closed, respects reduce-motion; dismisses on Esc / outside-click via a
  `settingsRef` wrapper). The menu holds a **"Speed"** control (clock icon + label; the
  current rate shows a 🔥 fire badge when ≠ 1x, else muted "Normal"). Expanding it reveals
  a **0.25x–2x slider** (`step=0.01`, wheel nudges 0.05): clickable 0.25x/1x/2x quick-jump
  markers + grey tick lines at those points, white end-caps at the limits, and a
  brand-colored line marking the current speed. `setSpeed` clamps, snaps to 0.01, and
  **magnets to exactly 1x within ±0.04**. It sets the preview `<video>.playbackRate` (and
  the synced music `<audio>`), re-applied on src remount / `loadedmetadata`. Preview-only:
  no trim/timeline/export/DB impact.

## Status (last session, 2026-05-31)

Recent work, all on `main`:

- **Fixed the pipeline hang** — the 720p proxy encode no longer blocks clip detection
  and is hard-timeout-bounded (see the proxy gotcha above). Surfaced by a real 15 GB /
  31-min 4K DJI upload that froze on "Detecting your clips".
- **Multi-Playlist Clips** — collapsible A–Z groups of 12 in the source editor sidebar
  (see feature bullet above).
- **Inline title rename** — pencil-edit the video title and every clip title in the
  source editor (see feature bullet above).
- **Fullscreen toggle** on the video preview, and **proxy overhaul** — GPU-assisted
  decode + a non-blocking background "Smoother preview" job that the source editor polls
  for and swaps in, plus a fix for the progress bar freezing at 0% (see gotchas/feature
  bullets above). Confirmed the 4K/60fps proxy ceiling on the Iris Xe iGPU is ~0.6x
  real-time (~45–55 min for a 32-min clip); acceptable now that it's a background job.
- **Preview settings menu** — gear → animated popover with a **playback-speed** control
  (0.25x–2x slider, 1x magnet, quick-jump markers + ticks + end-caps). Preview-only.

Also added a **`swap`** PowerShell command (in the user's profile) that runs
`switch.ps1` from any folder for the Cursor↔Antigravity editor handoff.

- **All planned AI features still in place** — Viral Remix, AI Auto-Cut, Story
  Mode, Virality Coach, Smart Import.
- **Database** — `C:/Users/tania/ClipData/dev.db` (outside OneDrive — never
  move it back).
- **DB contents** — one project, `DJI_20260527203440_0543_D` (status `ready`).
  The earlier debugging/demo projects were deleted.
- **Storage migration (R2 → local `D:\clip`) is complete** and was the previous
  session's work; spec/plan in `docs/superpowers/{specs,plans}/2026-05-26-*`.

### Next session
- Still pending: a full end-to-end smoke test of the local-storage pipeline on a
  **talking** video (upload → process → edit → export → download → delete). The DJI
  drone clips exercise manual mode but produce little, since the app targets speech.
- After the smoke test passes, the old Cloudflare R2 bucket can be deleted.

## Editors / IDEs

The project is editor-agnostic — it's just files + `npm` + Node + FFmpeg. Any
editor works, including **Antigravity IDE** (VS Code–based, with a Gemini agent).
When using a different IDE, the environment gotchas above still apply (they are
machine-specific, not editor-specific):

- Use a **PowerShell** integrated terminal — the commands in this file assume it.
- The SQLite DB must stay at `C:/Users/tania/ClipData/dev.db` (NEVER inside the
  OneDrive-synced repo folder).
- Prisma CLI reads `.env`, not `.env.local` — use the inline-var workaround.
- Dev server is locked to port 3000.
- An IDE's built-in AI agent may read `.env.local` (API keys) as context — add it
  to that tool's ignore list if that's a concern.
- Don't run two agentic tools on the repo at once (edit conflicts); commit/push
  between switches.

### Switching between Cursor and Antigravity (`switch.ps1`)

GitHub is the baton the two editors pass back and forth. The golden rule:
**only one editor's AI agent edits the project at a time.** To hand off safely,
type `swap` in the editor's PowerShell terminal (a `swap` function in the user's
PowerShell profile at `…\WindowsPowerShell\profile.ps1` runs `switch.ps1` from any
folder; `./switch.ps1` from inside the repo still works) — a guided menu:

- **`1` Leaving** — saves your work (`git add` + `commit` + `push`). Run it in the
  editor you're stepping away from, *before* opening the other one.
- **`2` Arriving** — pulls the latest (`git pull`). Run it in the editor you just
  opened, *before* you start editing.
- **`3` Cancel** — does nothing.

The script handles the common snags in plain English (push rejected because the
other editor pushed first → "Arrive first, then Leave"; pulling over unsaved
changes → warns instead of clobbering). It keeps files in sync but cannot stop
two agents typing at once — that part is on the human. Equivalent by hand:
`git add -A; git commit -m "…"; git push` when leaving, `git pull` when arriving.

## Repository

GitHub: https://github.com/Rubruby420/Clip — branch `main`

## Git workflow

Commit and push to `origin/main` after every meaningful change. Use concise imperative
commit messages (e.g. `Add feature X`, `Fix bug in Y`).
