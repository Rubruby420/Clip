# Settings Page — API Keys Design

**Date:** 2026-06-02
**Status:** Approved

## Goal

Give the packaged Electron app a UI for entering and saving API keys, so users never need to touch a terminal or edit a JSON file manually. The app becomes fully self-contained after install.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `app/settings/page.tsx` | Settings UI — four provider cards, Save button |
| `app/api/settings/route.ts` | GET masked keys from env · POST writes `clip-config.json` |

### Modified files

| File | Change |
|------|--------|
| `electron/main.js` | Pass `CLIP_CONFIG_PATH` env var to Next.js server process |
| `app/page.tsx` | Add gear icon in top-right linking to `/settings` |
| `app/_dashboard.tsx` (new — renamed from page.tsx body) | Existing dashboard client component |

---

## Settings Page (`app/settings/page.tsx`)

- Dark-mode, consistent with the rest of Clip (Tailwind, `#0a0a0a` background)
- Header: "Settings" title + "API Keys" pill badge + back arrow to dashboard
- Four provider cards, one per key:

| Card | Key name | "Get key" URL | What it powers |
|------|----------|---------------|----------------|
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/api-keys | Whisper transcription · GPT-4o-mini highlights · TTS voiceover |
| AssemblyAI | `ASSEMBLYAI_API_KEY` | https://www.assemblyai.com/dashboard | Auto-chapters · virality scoring |
| YouTube Data API v3 | `YOUTUBE_API_KEY` | https://console.cloud.google.com/apis/credentials | Viral Remix reference videos |
| Jamendo | `JAMENDO_CLIENT_ID` | https://developer.jamendo.com | AI Remix background music |

Each card contains:
- Provider name (bold) + feature description (muted)
- "Get key ↗" link top-right — opens in default browser (`target="_blank"` / Electron `shell.openExternal`)
- Password input, pre-filled with the masked current value (last 4 chars visible, rest `•`)
- Input clears to empty on focus if it only contains masked characters, so pasting a new key is clean

**Save button** — single button at the bottom of the page. On click:
1. POSTs all four values to `POST /api/settings`
2. On success: shows a green confirmation banner — "Settings saved. Restart Clip to apply your new keys."
3. On error: shows a red banner with the error message

**First-run banner** — when the page is loaded with `?firstRun=true` in the URL, an info banner appears at the top: "Welcome to Clip — add your API keys to get started." This banner is in addition to the normal page content.

---

## Settings API (`app/api/settings/route.ts`)

### `GET /api/settings`

Returns current key values masked for display. Masking rule: if the value is 8+ chars, return the last 4 chars preceded by `••••••••`; if shorter or empty, return empty string.

```json
{
  "OPENAI_API_KEY": "••••••••3kXa",
  "ASSEMBLYAI_API_KEY": "••••••••f91c",
  "YOUTUBE_API_KEY": "",
  "JAMENDO_CLIENT_ID": "••••••••2871"
}
```

### `POST /api/settings`

Accepts `{ OPENAI_API_KEY, ASSEMBLYAI_API_KEY, YOUTUBE_API_KEY, JAMENDO_CLIENT_ID }`.

Behavior:
1. Reads `CLIP_CONFIG_PATH` from `process.env`. If not set (dev mode), returns `400` with message "Settings can only be saved from the packaged app. Edit `.env.local` directly in dev mode."
2. Reads existing `clip-config.json` at that path (creates empty object if file doesn't exist)
3. Merges new non-empty values in — blank inputs are ignored so existing keys aren't accidentally wiped by leaving a field empty
4. Writes the updated object back as pretty-printed JSON
5. Returns `{ ok: true }`

---

## Electron Main Process (`electron/main.js`)

In `spawnNextServer`, add `CLIP_CONFIG_PATH` to the env object passed to the forked Next.js process:

```js
CLIP_CONFIG_PATH: configPath,  // path.join(userData, 'clip-config.json')
```

`configPath` is already computed in `loadConfig()` — extract it so both functions share it.

---

## First-Run Redirect (`app/page.tsx` + `app/upload/page.tsx`)

Next.js middleware runs in the Edge Runtime and cannot read server-side env vars like `OPENAI_API_KEY`, so the redirect is done in the page Server Components instead.

`app/page.tsx` is converted from a pure client component to a thin server component wrapper:

```tsx
// app/page.tsx — Server Component
import { redirect } from 'next/navigation'
import Dashboard from './_dashboard'  // existing client component, renamed

export default function Page() {
  if (!process.env.OPENAI_API_KEY) redirect('/settings?firstRun=true')
  return <Dashboard />
}
```

The existing dashboard JSX moves to `app/_dashboard.tsx` (client component, unchanged).
`app/upload/page.tsx` gets the same two-line guard at the top of its server component (it's already a server component — just add the redirect before the client import).

The settings page itself is never guarded — it must always be reachable.

---

## Gear Icon (Dashboard)

A `<Settings>` icon (lucide-react) in the top-right corner of `app/page.tsx`, wrapped in a `<Link href="/settings">`. Styled as a muted icon button consistent with the existing dashboard controls.

---

## Error Handling

- If `CLIP_CONFIG_PATH` is not set: POST returns `400` — dev-mode message shown in the UI
- If the config file can't be written (permissions, disk full): POST returns `500` — generic error shown in the UI
- Masked GET values never expose the real key — the pre-filled input is for display only; saving requires re-entering the key

---

## Out of Scope

- Validating API keys by making test calls (just saves them as-is)
- A "show/hide" eye toggle on the inputs (masked by default is sufficient for a solo-use app)
- Any settings other than API keys
- In-app restart button (user restarts Clip manually after saving)
