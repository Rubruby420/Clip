# Clip — Session Handoff
*Last updated: 2026-06-13*

---

## Session 2026-06-13 — Direct Social Publish (TikTok / YouTube Shorts / Instagram Reels)

### What shipped (commits `bea5c05`, `00a853a`, `1c2b362`)

New **Publish** flow — skip the download → manual re-upload step entirely. Finished clips and highlight reels can be posted directly to TikTok, YouTube Shorts, and Instagram Reels from inside Clip.

**Architecture:**
- `lib/social/tokens.ts` — token persistence to `D:\clip\_social\tokens.json` (no DB migration)
- `lib/social/oauth.ts` — CSRF state map + PKCE helpers (`generatePKCE`, `verifyState`)
- `lib/social/tiktok.ts` — TikTok v2 OAuth + PKCE + chunked FILE_UPLOAD byte upload → poll publish status
- `lib/social/youtube.ts` — Google OAuth + resumable upload → `#Shorts` title suffix
- `lib/social/instagram.ts` — Facebook Login → IG Business user → container-create → poll → publish (requires HTTPS tunnel)
- `lib/social/index.ts` — driver registry
- `app/api/social/[platform]/connect/route.ts` — starts OAuth; guards empty credentials with redirect to Settings + plain-English error
- `app/api/social/[platform]/callback/route.ts` — code exchange (passes `codeVerifier` for TikTok PKCE)
- `app/api/social/[platform]/route.ts` — GET status / DELETE disconnect
- `app/api/social/publish/route.ts` — SSE-streaming publish (clip or highlight reel)
- `components/PublishDialog.tsx` — shared modal: platform picker, caption/title/privacy fields, SSE progress bar, success link
- Publish buttons added to: clip editor toolbar + export-success modal, highlight reel card on project page
- Settings page extended with `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `PUBLIC_BASE_URL` credential inputs + a Connected Accounts section

**Key fixes made during setup:**
- `allowedDevOrigins` moved to top-level in `next.config.ts` (was erroneously inside `experimental`) — wildcard `*.trycloudflare.com` / `*.loca.lt` / `*.ngrok*` covers any tunnel URL without per-session config changes
- TikTok PKCE — TikTok v2 mandates `code_challenge` / `code_challenge_method=S256`; added `generatePKCE()`, wired verifier through state map → callback → `exchangeCode`
- Credential guard — `missingCredentials()` in connect route redirects to `/settings#connections` with plain-English error before building any OAuth URL; Connect button is a disabled `<span>` (not an `<a>`) until credentials are saved

### Where we stopped — TikTok credentials setup in progress

The tunnel is running and cloudflared binary is at `C:\clip\cloudflared.exe`.

**Every time you resume:** start the cloudflared tunnel first:
```powershell
C:\clip\cloudflared.exe tunnel --url http://localhost:3000
```
Get the new `https://*.trycloudflare.com` URL from the metrics server:
```powershell
(Invoke-RestMethod "http://127.0.0.1:20241/metrics") -split "`n" | Select-String "trycloudflare"
```

**Steps remaining to complete TikTok connect:**
1. Create TikTok dev app at https://developers.tiktok.com → add **Login Kit** + **Content Posting API** products
2. Set redirect URI to `https://<tunnel-url>/api/social/tiktok/callback` and redirect domain to `<tunnel-url>` (no https://)
3. Add your TikTok account as a tester (Sandbox → Manage users)
4. Copy **Client Key** + **Client Secret** from the app dashboard
5. In Clip Settings → App credentials: paste Client Key, Client Secret, and `PUBLIC_BASE_URL = https://<tunnel-url>`
6. Save credentials → restart dev server → click Connect TikTok

**After TikTok works:** YouTube Shorts (simpler — Google OAuth allows localhost, no tunnel needed) and Instagram Reels (also needs HTTPS tunnel, requires Business account + Facebook Page).

**TikTok audit note:** Until the TikTok developer app passes audit, posts are `SELF_ONLY` (private to your account). The code is built for public posting — it just works once audited.

### Docs written
- `docs/social-setup-tiktok.md`
- `docs/social-setup-youtube.md`
- `docs/social-setup-instagram.md`

---

## Session 2026-06-13 — Highlight Reel export

### What shipped (commits `f6d5d2d`, `ca98dae`)

New **Highlight Reel** button on the project page — stitches the top N clips (by score, best first) into a single downloadable MP4.

**How it works:**
- User sets N (default 5) via a number input next to the button
- Single `buildHighlightReel()` FFmpeg call: `-ss BEFORE -i` (fast keyframe seek) for each input, then one concat-filter pass — all N clips in one process
- 9:16 vertical with blurred-fill background, same as clip exports
- SSE progress stream → overall % bar in the bottom-left corner
- "Download reel" anchor appears on completion; GET route re-surfaces it after page reload

**Key fix (ca98dae):** First attempt used `exportSplicedClip` which places `-ss AFTER -i` (decode-from-start). On a 5.1 GB source, segment 4 (at 198 s) failed on Windows with exit code 4294967294. New `buildHighlightReel()` in `lib/ffmpeg.ts` uses fast seeks and a single concat-filter pass — faster and reliable.

**Files changed:** `lib/ffmpeg.ts` (+`buildHighlightReel`), `lib/storage.ts` (+`projectHighlightReelPath`), `app/api/projects/[id]/highlight-reel/route.ts` (new), `app/projects/[id]/page.tsx` (button + progress + download).

No Prisma migration. Reel written to `<projectId>/highlight-reel.mp4` on disk.

---

## Session 2026-06-12 — Thumbnail Generator + CI fixes

### What shipped — Thumbnail Generator (commit `16d5d93`)

New **Thumbnail** tab in the clip editor (rightmost tab, image icon). Smoke tested and confirmed working.

**Per-generation pipeline:**
1. 7 candidate frames extracted evenly across the clip window
2. Live YouTube niche search — downloads top-5 high-res thumbnails as style references
3. One GPT-4o vision call — picks best frame, designs headline/color/position/crop
4. Text burned in via ASS subtitle over a 1-frame FFmpeg loop (reuses Windows `:` escape logic)
5. **AI Background mode** (optional) — sends chosen frame to `gpt-image-1` for dramatic stylisation before text

**Feedback + learning loop:**
- 👍 saves a lightweight positive lesson to global memory
- 👎 expands: "how can I do better?" textarea + optional example image upload → GPT-4o distils 2–4 design rules → written to `D:\clip\_thumbnail\memory.json` → injected into every future generation across all clips

**Zero Prisma migration:** generated image reuses existing `clip.thumbnailUrl` column; recipe + feedback cached in `thumbnail.json` inside the clip folder. Generated thumbnail appears on project page card automatically.

**Key new files:** `lib/thumbnail.ts`, `lib/thumbnail-memory.ts`, `lib/ffmpeg.ts` (3 new helpers), `lib/storage.ts` (4 path helpers), `lib/youtube.ts` (thumbnailHigh field), `app/api/clips/[id]/thumbnail/route.ts`, `app/api/clips/[id]/thumbnail/feedback/route.ts`, `components/editor/ThumbnailPanel.tsx`.

---

## Session 2026-06-12 — GitHub Actions Node.js upgrade + v0.2.2

### What shipped

**Fixed GitHub Actions Node.js 20 deprecation warning:**

CI annotation after v0.2.1: *"Node.js 20 actions are deprecated… Actions will be forced to run with Node.js 24 by default starting June 16th, 2026."*

- First tried `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` env var (v0.2.1) — didn't suppress the warning when using pinned `@v4` action versions.
- Updated `actions/checkout@v4` → `@v6` and `actions/setup-node@v4` → `@v6` (both at v6 as of June 2026) and removed the env var workaround (v0.2.2) — CI passed clean with zero annotations except the routine `windows-latest` redirect notice.

**Tags published:** `v0.2.0` (previous session), `v0.2.1`, `v0.2.2` — all on GitHub Releases.

### Current state
- CI is clean; no build warnings, no actions deprecation warnings.
- `windows-latest` will silently redirect to `windows-2025-vs2026` by June 15 — no action needed.
- Version in `package.json`: `0.2.0` (patch releases 0.2.1/0.2.2 were workflow-only fixes; no need to bump).

### Next steps
- Full smoke test on a **longer talking video** (5–30 min) to exercise AssemblyAI auto-chapters, multi-clip detection, and the 720p proxy pipeline.
- Optional: add a gear icon to the dashboard header linking to `/settings` for easy key editing without the first-run flow.

---

## Session 2026-06-11 — Setup fixes + installer verification

### What shipped (commits `1ad3c4d`, `c37e910`)

**Three recurring setup issues fixed:**

1. **Build warnings** — removed unused `projectLogoPath` imports from export routes, deleted dead `startSplice` function, renamed lucide `Image` → `ImageIcon` (stopped false-positive alt-prop ESLint hit), added eslint-disable on logo overlay `<img>`. `npm run build` now zero warnings.
2. **Settings save in dev mode** — `POST /api/settings` was returning 400 "packaged app only". Now writes keys to `.env.local` using safe line-by-line update. Restart dev server after saving.
3. **OpenAI lazy init** — replaced module-level `new OpenAI(...)` with `getOpenAI()` factory in all 6 lib files (whisper, coach, highlights, flagpal, remix, story). Build no longer throws when `OPENAI_API_KEY` is absent at build time.

**Installer testing found and fixed three bugs:**
1. **`.env.local` leaking into installer** — Next.js standalone bundles env files. `prepare-electron-build.js` now strips them before packaging so the installer never ships dev keys.
2. **Dashboard/upload statically pre-rendered** — `process.env.OPENAI_API_KEY` check in `app/page.tsx` and `app/upload/page.tsx` was evaluated at build time (key set → no redirect → static). Added `export const dynamic = "force-dynamic"` to both.
3. **`template.db` missing `clipStatus`** — regenerated from current schema.

**Installer verified end-to-end:**
- Fresh install → `/settings?firstRun=true` redirect ✓
- Save keys → writes `%AppData%\Clip\clip-config.json` ✓
- Restart → dashboard loads with all keys ✓

**Smoke test on talking video — full pipeline verified:**
- Upload (48MB screen recording, 43s) → API ✓
- AI processing: Whisper transcription (10,044 chars / 139 words), LLM fallback highlight detection (AssemblyAI auto-chapters too short at 43s) ✓
- 1 clip generated with real title from transcript, score 0.92 ✓
- Export with live SSE progress bar → 6.05 MB 9:16 1080×1920 MP4 ✓
- Download via `/api/files/` ✓
- Delete project → storage folder + DB record gone ✓

### Next steps
- **Full smoke test on longer content** (5–30 min talking video) to exercise AssemblyAI chapters, multi-clip detection, and the 720p proxy pipeline.
- **Delete the old Cloudflare R2 bucket** — local storage migration is confirmed working.
- **Publish a real release**: bump version in `package.json`, then `git tag v0.2.0 && git push --tags` → GitHub Actions builds and publishes installer.
- **Optional**: add a gear icon to the dashboard header linking to `/settings` for easy key editing without the first-run flow.

---

## GOAL

Package Clip as a **Windows installable desktop application** (NSIS `.exe` installer) that **auto-updates itself** when a new version is pushed. The flow: developer bumps the version, tags a release on GitHub → GitHub Actions builds the installer and publishes it → installed copies detect the new release on startup and silently download + apply the update.

---

## Session 2026-06-10 — UX polish (8 features across two rounds)

### What shipped — Round 1 (commit `8af22a9`)

1. **Export progress feedback** — single clip export uses SSE (`text/event-stream`); FFmpeg writes `out_time_ms` to stdout via `-progress pipe:1`; the editor shows a live progress fill bar + percentage on the Export button.
2. **Clip reorder** — HTML5 drag-and-drop on project page cards; custom order persisted in `localStorage["clipOrder:<projectId>"]`; "AI Score / Custom" sort toggle with ✕ reset. No DB changes.
3. **Batch export** — "Export All" button on project page streams SSE from `POST /api/projects/[id]/batch-export`; per-clip + overall progress bars in a fixed bottom-right overlay; done banner with count.
4. **Transcript viewer** — "View transcript" button in Caption panel (when words exist) opens `TranscriptModal`: search box, sentence groups with seekable timestamps, click any word to seek to it.
5. **Caption style previews** — CSS mini-previews for karaoke / bold-pop / minimal / emoji-auto in the Caption panel style grid.
6. **FlagPal Cut-at link** — carries `?t=N` into the editor which seeks to that timestamp on open. (Already existed as `seekOnOpen` in the editor; wired up this session.)
7. **Delete after export** — "Delete this clip" button in the export-success modal (confirms, calls `DELETE /api/clips/${id}`, navigates back to project page).
8. **Style presets** — save/apply/delete named layout+caption combos from a `Presets` dropdown in the editor header; `localStorage["clip:stylePresets"]`, no DB.
9. **Hover-to-play** — muted looping video overlay on project page clip cards on mouse-enter; prefers 720p proxy; `HoverVideo` component seeks to `clip.startTime` and loops the clip window.
10. **Text-to-clip search** — search bar above clip grid, client-side word-timestamp search across all clip transcript JSONs; non-matching cards dim; match chip links to `/editor/${id}?t=N`.
11. **Keyboard shortcuts in editor** — `Space`/`K` play-pause, `J`/`L` ±5s, `←`/`→` ±1s, `Shift+←`/`→` ±0.1s, `I`/`O` set in/out, `E` export; `?` hover-tooltip button in header.

### What shipped — Round 2 (commit `bea75a0`)

12. **SRT subtitle export** — `GET /api/clips/[id]/srt` returns the clip's transcript as an SRT file. `.srt` button in editor header; also appears in the export-success modal alongside the video download button.
13. **Clip status tags** — `done` / `skip` / `review` pill buttons on every project-page card; optimistic update + `PATCH /api/clips/[id]`. Added `clipStatus String @default("none")` to Prisma schema.
14. **Logo/watermark overlay** — "Watermark / Logo" section in Layout panel. Upload PNG/WebP → `POST /api/projects/[id]/logo` saves to `D:\clip\<projectId>\logo.png`. Corner position, size (5–40%), opacity (10–100%). Renders live in CanvasPreview; burned into export via FFmpeg `scale`+`format=rgba`+`colorchannelmixer`+`overlay` filter chain.
15. **Waveform in timeline** — clip editor's trim track now renders soft amplitude bars sampled from `Project.waveform` peaks JSON. 120 bars across the visible trim range; silences visible as valleys.

### One required action before status tags work

The `clipStatus` column is in SQLite already, but the Prisma client binary couldn't be regenerated while the dev server was running (DLL lock). Run once with the server stopped:

```powershell
# Stop npm run dev first, then:
$env:DATABASE_URL='file:C:/Users/tania/ClipData/dev.db'; npx prisma db push
# Restart dev server
```

### Key files changed this session

| File | Change |
|------|--------|
| `app/editor/[id]/page.tsx` | Export SSE, SRT button, transcript modal wiring, logo upload, waveform props |
| `app/projects/[id]/page.tsx` | Drag reorder, batch export, hover-to-play, transcript search, status tags |
| `app/api/export/[id]/route.ts` | SSE streaming, logo path passthrough |
| `app/api/projects/[id]/batch-export/route.ts` | NEW — SSE batch export with logo |
| `app/api/clips/[id]/srt/route.ts` | NEW — SRT download |
| `app/api/projects/[id]/logo/route.ts` | NEW — logo upload/delete |
| `components/editor/CanvasPreview.tsx` | Logo overlay, keyboard shortcuts |
| `components/editor/Timeline.tsx` | Waveform peaks rendering |
| `components/editor/LayoutPanel.tsx` | Logo section + onLogoUpload prop |
| `components/editor/TranscriptModal.tsx` | NEW — searchable transcript viewer |
| `components/editor/PresetsPanel.tsx` | NEW — style preset save/apply/delete |
| `components/editor/CaptionPanel.tsx` | CSS style previews, view-transcript button |
| `lib/ffmpeg.ts` | Logo overlay filter, export SSE progress |
| `lib/storage.ts` | `projectLogoPath()` helper |
| `prisma/schema.prisma` | `clipStatus String @default("none")` |

---

## Session 2026-06-07 — Electron build + dashboard sort/filter

### What shipped

1. **Electron build — first successful end-to-end run.**
   Output: `C:\Users\tania\ClipDist\Clip Setup 0.1.0.exe` (+ blockmap for auto-updater).
   Fixed two build blockers en route:
   - `FlagResults.tsx` — unescaped `"` quotes in JSX (two sites) → `&ldquo;`/`&rdquo;`
   - `flagpal/scan/route.ts` — `sensitiveTopics: []` missing from error-fallback and `noSpeech()` objects (TypeScript error, added last session)
   Build pipeline: `next build` → `prepare-electron-build.js` → `esbuild` → `electron-builder --win`.
   No code-signing cert — installer is unsigned (expected for personal use).

2. **Dashboard sort + filter** (`app/_dashboard.tsx`).
   Filter pills: All / Ready / Processing / Error (Processing groups uploading+queued+processing).
   Each non-All pill shows a live count. Sort dropdown: Newest / Oldest / Most clips / Best score.
   Empty-filter state shows a "Show all" escape link. Pure client-side — no API changes.

### Remaining warnings (non-blocking)
Five ESLint warnings that appear during `next build` but don't fail it:
- `flagpal/page.tsx` — `Zap` unused import; ternary-as-expression at line 50
- `flagpal/[id]/page.tsx` — `CheckCircle` unused import; ternary-as-expression at line 52
- `WaveformTimeline.tsx:425` — `<img>` missing `alt` prop

### Next steps
- **Test the installer**: run `C:\Users\tania\ClipDist\Clip Setup 0.1.0.exe`, verify the app loads, confirm storage defaults to `%AppData%\Roaming\Clip\`.
- **Smoke test** — full end-to-end on a talking video: upload → process → FlagPal scan → Cut-at link → editor seeks → export → download.
- **To publish a release**: bump version in `package.json`, then `git tag v0.2.0 && git push --tags` — GitHub Actions builds and publishes the installer.
- **Optional cleanup**: fix the 5 ESLint warnings above.

---

## Session 2026-06-06 — FlagPal (policy scanner)

### What shipped (commit `2c76e83`)

**FlagPal** is a YouTube / TikTok / Instagram policy scanner accessible from the dashboard header (Flag icon). It scans spoken transcripts for violations — no audio fingerprinting.

#### Features added this session
1. **Platform selector** — YouTube / TikTok / Instagram toggle on both FlagPal pages (`/flagpal` and `/flagpal/[id]`). The OpenAI scan prompt uses platform-specific policy context (`PLATFORM_CONTEXT` in `lib/flagpal.ts`).
2. **Outcome classification** — each violation tagged Strike / Demonetized / Age-Gated / Limited Ads with coloured badge.
3. **Fix suggestions** — green wrench box per violation with an actionable fix.
4. **Script rewriter** (`/api/flagpal/rewrite`) — lazy on-click fetch returns 2-3 AI-compliant rewrites with copy buttons. Powered by `rewriteViolation()` in `lib/flagpal.ts`.
5. **Trending topic radar** — `sensitiveTopics` section in results flags contextually risky themes even without a clear policy hit.
6. **Copyright specifics** — `copyrightedWork` + Content-ID risk badge on copyright violations.
7. **"Cut at X:XX" link** — clip violations with a timestamp link directly to `/editor/[clipId]?t=TIME`.
8. **Editor seek-on-open** — editor reads `?t=` URL param and seeks to that time after the clip loads (`app/editor/[id]/page.tsx`).
9. **Captions off by default** — `captionsEnabled` starts `false` in both the clip editor and the source editor.

#### Transcription fallback in scan route (`app/api/flagpal/scan/route.ts`)
Three-tier fallback:
1. Parse `Project.transcription` (stored as `JSON.stringify({text,words,duration})`).
2. Stitch `Clip.words` arrays into a transcript.
3. Auto-run Whisper on demand if neither exists (handles manual-mode projects that never ran AI processing).

#### Key files
| File | Change |
|------|--------|
| `lib/flagpal.ts` | Added `FlagOutcome`, `SensitiveTopic`, platform context, `rewriteViolation()` |
| `app/api/flagpal/scan/route.ts` | 3-tier transcript fallback, `platform` param, auto-Whisper |
| `app/api/flagpal/rewrite/route.ts` | New — `POST { quote, context, category, platform }` → `{ rewrites }` |
| `app/flagpal/page.tsx` | Platform selector, checkbox project grid |
| `app/flagpal/[id]/page.tsx` | Platform selector, checkbox clip grid, "Scan whole video" |
| `components/flagpal/FlagResults.tsx` | Full results UI — outcome badges, fix box, rewrite section, copyright specifics, trending radar, Cut-at link |
| `app/editor/[id]/page.tsx` | Seek-on-open via `?t=` param; captions default `false` |
| `app/source/[id]/page.tsx` | Captions default `false` |

### What's pending

- **End-to-end smoke test** on a talking video: upload → process → FlagPal scan → "Cut at" link → editor seeks correctly → export → download.
- **Electron build** (carried from previous session — see below).

---

---

## Current State

### Detect Speakers (complete)
Fully rebuilt and tuned. Was a pure amplitude gate (picked up music, bangs, etc.); now uses **Whisper word-level timestamps** as the ground truth for speech. Only segments where actual words were spoken become clips. Short utterances and first words are no longer dropped.

### Electron Packaging (scaffolded — not yet verified end-to-end)
All the plumbing is in place and committed. The `electron:bundle` step (esbuild) works cleanly (647KB bundle, zero warnings). The full `electron:build` pipeline (`next build` → copy statics → esbuild → `electron-builder`) has **not been run end-to-end yet** — that's the next step.

---

## Files in Flight

| File | Status |
|------|--------|
| `electron/main.js` | New — Electron main process |
| `electron/preload.js` | New — minimal context bridge |
| `electron-builder.yml` | New — NSIS installer config |
| `scripts/prepare-electron-build.js` | New — copies `.next/static` + `public/` into standalone |
| `.github/workflows/release.yml` | New — CI build + publish on `v*` tag |
| `next.config.ts` | Modified — added `output: "standalone"` |
| `prisma/schema.prisma` | Modified — added `binaryTargets = ["native", "windows"]` |
| `package.json` | Modified — added `main`, 7 new scripts, Electron devDeps |
| `clip-config.example.json` | New — documents user's AppData config file |
| `app/api/projects/[id]/detect-speakers/route.ts` | Modified — Whisper-based detection |
| `lib/silence.ts` | Modified — `groupSpeechSegments()` + orphan absorption |
| `lib/ffmpeg.ts` | Modified — optional silence prepend for Whisper |

---

## Changed This Session

### 1. Detect Speakers — rebuilt (5 commits)

**`lib/silence.ts`**
- Added `groupSpeechSegments()` — groups Whisper word timestamps into conversation segments (replaces amplitude gating for Detect Speakers; the old `detectTalkSegments` still exists for remove-silences)
- Tuned: `minSilenceGap` 0.7s → 1.5s, `minSegmentLength` 1.2s → 0.8s, `padding` 0.25s → 0.4s
- Added **orphan absorption pass**: short segments within 3s of a neighbour are absorbed into that neighbour rather than dropped (fixes "alright [2s gap] main speech" — the clip starts at "alright")

**`lib/ffmpeg.ts`**
- `extractAudio()` gains optional `prependSilenceMs` param — prepends silence via FFmpeg `adelay` filter to fix Whisper's first-word truncation quirk

**`app/api/projects/[id]/detect-speakers/route.ts`**
- Rewrote to call `transcribeAudio()` (Whisper) then `groupSpeechSegments()` instead of `detectTalkSegments()`
- Prepends 500ms silence before Whisper, subtracts it from timestamps afterward
- **Does NOT save** transcript to `Project.transcription` — persisting it caused the source editor to show captions on the raw video (captions are AI-mode-only)
- Clips created with `words: "[]"` (no transcript data — that stays in AI mode)

**`app/source/[id]/page.tsx` + `app/projects/[id]/page.tsx`**
- Relaxed the `disabled={peaks.length === 0}` gate (Whisper needs the video file, not the waveform peaks)
- Updated button tooltips

### 2. Electron packaging (1 commit)

**New files:**
- `electron/main.js` — forks the Next.js standalone server, loading splash, BrowserWindow, auto-updater polling every 4h
- `electron/preload.js` — exposes `window.clipDesktop = { isDesktop: true, platform }`
- `electron-builder.yml` — NSIS x64, `extraResources` for Next.js standalone, GitHub publish
- `scripts/prepare-electron-build.js` — copies `.next/static` and `public/` into the standalone tree (step Next.js omits)
- `.github/workflows/release.yml` — triggers on `v*` tags; builds on `windows-latest`; publishes installer + `latest.yml` to GitHub Release
- `clip-config.example.json` — template for `%AppData%\Clip\clip-config.json`

**Modified:**
- `next.config.ts` — `output: "standalone"` + `outputFileTracingIncludes` for Prisma binaries
- `prisma/schema.prisma` — `binaryTargets = ["native", "windows"]`
- `package.json` — `"main": "electron/main.js"`, 7 new scripts, `electron`/`electron-builder`/`electron-updater`/`electron-log`/`esbuild` in devDeps

---

## Failed Attempts

### Detect Speakers — captions leaking into source editor (fixed)
**Attempt:** Cached the Whisper transcript in `Project.transcription` for re-run performance.
**Problem:** The source editor reads `project.transcription` and feeds it into `CanvasPreview` with `captionsEnabled` (line 1233 of `app/source/[id]/page.tsx`). This caused "I KEEP FORGETTING"-style captions to appear on the raw source video.
**Fix:** Transcription is now used purely in-memory; never written to DB in the Detect Speakers route.

### Detect Speakers — word data on clips (fixed)
**Attempt:** Populated `words` on each created clip from the Whisper transcript (seemed useful for captions/Coach).
**Problem:** Clips created by Detect Speakers (manual mode) should have `words: "[]"` — word data and captions are AI-mode-only features.
**Fix:** Reverted to `words: "[]"` on all Detect Speakers clips.

---

## Next Step

**Run the full Electron build end-to-end:**

```powershell
# In the project folder, stop the dev server first (Prisma DLL lock)
npm run electron:build
```

This will:
1. `next build` — verifies the standalone output works
2. `node scripts/prepare-electron-build.js` — copies statics
3. `esbuild electron/main.js ...` — bundles main process
4. `electron-builder --win` — produces `dist/Clip-Setup-0.1.0.exe`

**Expected issues to watch for:**
- `next build` may fail if `OPENAI_API_KEY` env var is absent (the `new OpenAI(...)` constructor at module load time throws). Workaround: set a dummy key in the shell before building: `$env:OPENAI_API_KEY="dummy"; npm run electron:build`
- Prisma binary: `prisma generate` needs to run first with `DATABASE_URL` set
- If the installer builds successfully, test it by running `dist/Clip-Setup-0.1.0.exe`, then verifying the app loads, uploads work, and storage defaults to `%AppData%\Roaming\Clip\`

**After a successful build, to publish a real release:**
```powershell
# Bump version in package.json first, then:
git tag v0.2.0
git push --tags
# GitHub Actions takes it from there
```
