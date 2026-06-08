# Clip — Session Handoff
*Last updated: 2026-06-07*

---

## GOAL

Package Clip as a **Windows installable desktop application** (NSIS `.exe` installer) that **auto-updates itself** when a new version is pushed. The flow: developer bumps the version, tags a release on GitHub → GitHub Actions builds the installer and publishes it → installed copies detect the new release on startup and silently download + apply the update.

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
