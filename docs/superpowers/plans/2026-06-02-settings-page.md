# Settings Page — API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/settings` page where users can paste API keys that get saved to `clip-config.json`, so the packaged Electron app works without any terminal or file editing.

**Architecture:** A dedicated `/settings` Next.js route with a card-based UI for four providers. A `GET /api/settings` returns masked key values; `POST /api/settings` writes to `clip-config.json` at the path provided by the `CLIP_CONFIG_PATH` env var (set by Electron). Dashboard and upload pages gain a server-component wrapper that redirects to `/settings?firstRun=true` when `OPENAI_API_KEY` is missing.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, lucide-react, Node.js `fs` for config file I/O.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `app/api/settings/route.ts` | GET masked keys · POST writes clip-config.json |
| Create | `app/settings/page.tsx` | Server component — reads searchParams, renders client |
| Create | `app/settings/_client.tsx` | Client component — full settings UI |
| Create | `app/_dashboard.tsx` | Extracted dashboard client component (moved from page.tsx) |
| Modify | `app/page.tsx` | Replace with server wrapper + first-run redirect |
| Create | `app/upload/_upload.tsx` | Extracted upload client component (moved from upload/page.tsx) |
| Modify | `app/upload/page.tsx` | Replace with server wrapper + first-run redirect |
| Modify | `electron/main.js` | Add CLIP_CONFIG_PATH to env passed to Next.js server |

---

## Task 1: Settings API Route

**Files:**
- Create: `app/api/settings/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type ConfigKey = "OPENAI_API_KEY" | "ASSEMBLYAI_API_KEY" | "YOUTUBE_API_KEY" | "JAMENDO_CLIENT_ID";

const KEYS: ConfigKey[] = [
  "OPENAI_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "YOUTUBE_API_KEY",
  "JAMENDO_CLIENT_ID",
];

function mask(value: string | undefined): string {
  if (!value || value.length < 8) return "";
  return "••••••••" + value.slice(-4);
}

export async function GET() {
  const result = {} as Record<ConfigKey, string>;
  for (const key of KEYS) result[key] = mask(process.env[key]);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const configPath = process.env.CLIP_CONFIG_PATH;
  if (!configPath) {
    return NextResponse.json(
      { error: "Settings can only be saved from the packaged app. Edit .env.local directly in dev mode." },
      { status: 400 }
    );
  }

  const body = (await request.json()) as Partial<Record<ConfigKey, string>>;

  let existing: Record<string, string> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {}
  }

  for (const key of KEYS) {
    const val = body[key]?.trim();
    if (val) existing[key] = val;
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch {
    return NextResponse.json({ error: "Failed to write config file." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify GET returns masked values**

Start the dev server (`npm run dev`), then run:

```bash
curl http://localhost:3000/api/settings
```

Expected: JSON with four keys. Each key that has a value in `.env.local` shows `"••••••••XXXX"` (last 4 chars). Empty keys return `""`.

- [ ] **Step 3: Verify POST returns 400 in dev mode**

```bash
curl -X POST http://localhost:3000/api/settings \
  -H "Content-Type: application/json" \
  -d '{"OPENAI_API_KEY":"sk-test123"}'
```

Expected: `{"error":"Settings can only be saved from the packaged app. Edit .env.local directly in dev mode."}`

- [ ] **Step 4: Commit**

```bash
git add app/api/settings/route.ts
git commit -m "Add settings API route (GET masked keys, POST writes clip-config.json)"
```

---

## Task 2: Settings UI

**Files:**
- Create: `app/settings/page.tsx`
- Create: `app/settings/_client.tsx`

- [ ] **Step 1: Create the server component wrapper `app/settings/page.tsx`**

```tsx
import SettingsClient from "./_client";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ firstRun?: string }>;
}) {
  const params = await searchParams;
  return <SettingsClient firstRun={params.firstRun === "true"} />;
}
```

- [ ] **Step 2: Create the client component `app/settings/_client.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Settings,
  ArrowLeft,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Zap,
} from "lucide-react";

type ConfigKey =
  | "OPENAI_API_KEY"
  | "ASSEMBLYAI_API_KEY"
  | "YOUTUBE_API_KEY"
  | "JAMENDO_CLIENT_ID";

const PROVIDERS: {
  key: ConfigKey;
  name: string;
  description: string;
  getKeyUrl: string;
}[] = [
  {
    key: "OPENAI_API_KEY",
    name: "OpenAI",
    description: "Whisper transcription · GPT-4o-mini highlights · TTS voiceover",
    getKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    key: "ASSEMBLYAI_API_KEY",
    name: "AssemblyAI",
    description: "Auto-chapters · virality scoring",
    getKeyUrl: "https://www.assemblyai.com/dashboard",
  },
  {
    key: "YOUTUBE_API_KEY",
    name: "YouTube Data API v3",
    description: "Viral Remix reference videos",
    getKeyUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    key: "JAMENDO_CLIENT_ID",
    name: "Jamendo",
    description: "AI Remix background music",
    getKeyUrl: "https://developer.jamendo.com",
  },
];

const EMPTY: Record<ConfigKey, string> = {
  OPENAI_API_KEY: "",
  ASSEMBLYAI_API_KEY: "",
  YOUTUBE_API_KEY: "",
  JAMENDO_CLIENT_ID: "",
};

export default function SettingsClient({ firstRun }: { firstRun: boolean }) {
  const [masked, setMasked] = useState<Record<ConfigKey, string>>(EMPTY);
  const [values, setValues] = useState<Record<ConfigKey, string>>(EMPTY);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setMasked(data));
  }, []);

  async function handleSave() {
    setStatus("saving");
    const payload: Partial<Record<ConfigKey, string>> = {};
    (Object.keys(values) as ConfigKey[]).forEach((k) => {
      if (values[k].trim()) payload[k] = values[k].trim();
    });
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const fresh = await fetch("/api/settings").then((r) => r.json());
      setMasked(fresh);
      setValues(EMPTY);
      setStatus("saved");
    } else {
      const err = await res.json();
      setErrorMsg(err.error ?? "Failed to save settings.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen bg-surface-900">
      <header className="border-b border-surface-600 px-6 py-4 flex items-center gap-4">
        <Link
          href="/"
          className="p-2 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Settings</span>
          <span className="text-xs bg-surface-700 text-surface-300 px-2 py-0.5 rounded-full">
            API Keys
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        {firstRun && (
          <div className="mb-6 flex items-start gap-3 bg-brand-900/40 border border-brand-700 text-brand-200 rounded-xl px-4 py-3 text-sm">
            <Settings className="w-4 h-4 mt-0.5 flex-shrink-0" />
            Welcome to Clip — add your API keys to get started.
          </div>
        )}

        {status === "saved" && (
          <div className="mb-6 flex items-start gap-3 bg-green-900/40 border border-green-700 text-green-200 rounded-xl px-4 py-3 text-sm">
            <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            Settings saved. Restart Clip to apply your new keys.
          </div>
        )}

        {status === "error" && (
          <div className="mb-6 flex items-start gap-3 bg-red-900/40 border border-red-700 text-red-200 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            {errorMsg}
          </div>
        )}

        <p className="text-surface-500 text-sm mb-6">
          These keys are stored locally on your machine and never uploaded anywhere.
        </p>

        <div className="flex flex-col gap-4">
          {PROVIDERS.map(({ key, name, description, getKeyUrl }) => (
            <div
              key={key}
              className="bg-surface-800 border border-surface-600 rounded-xl p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-white font-semibold text-sm">{name}</div>
                  <div className="text-surface-500 text-xs mt-0.5">{description}</div>
                </div>
                <a
                  href={getKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-brand-400 hover:text-brand-300 text-xs transition-colors flex-shrink-0"
                >
                  Get key <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <input
                type="password"
                value={values[key]}
                placeholder={masked[key] || "Paste key here…"}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))
                }
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-surface-500 focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSave}
            disabled={status === "saving"}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {status === "saving" && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify the settings page loads**

Navigate to `http://localhost:3000/settings` in the browser. Expected:
- Page loads with dark background
- Four provider cards visible (OpenAI, AssemblyAI, YouTube, Jamendo)
- Each card shows a "Get key ↗" link and a password input
- Inputs show masked placeholder values for any keys already in `.env.local`
- Save button visible at bottom

- [ ] **Step 4: Verify first-run banner**

Navigate to `http://localhost:3000/settings?firstRun=true`. Expected: purple info banner at top reading "Welcome to Clip — add your API keys to get started."

- [ ] **Step 5: Commit**

```bash
git add app/settings/page.tsx app/settings/_client.tsx
git commit -m "Add settings page UI with provider cards and save button"
```

---

## Task 3: Dashboard Server Wrapper + First-Run Redirect

**Files:**
- Create: `app/_dashboard.tsx` (extracted from `app/page.tsx`)
- Modify: `app/page.tsx`

- [ ] **Step 1: Copy entire `app/page.tsx` content to `app/_dashboard.tsx`**

The file content is identical to the current `app/page.tsx`. No changes to any logic or JSX. The only difference is the filename.

Create `app/_dashboard.tsx` with the full content of the current `app/page.tsx` (all 219 lines as-is).

- [ ] **Step 2: Add `Settings` to the import in `app/_dashboard.tsx`**

In the lucide-react import line, add `Settings` to the list:

```tsx
import { Upload, Film, Clock, Trash2, Edit3, Plus, Loader2, CheckCircle, AlertCircle, Zap, Settings } from "lucide-react";
```

- [ ] **Step 3: Add gear icon to the dashboard header in `app/_dashboard.tsx`**

Find the header's right side — currently:

```tsx
        <Link
          href="/upload"
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Project
        </Link>
```

Replace with:

```tsx
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="p-2 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <Link
            href="/upload"
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Project
          </Link>
        </div>
```

- [ ] **Step 4: Replace `app/page.tsx` with the server wrapper**

Overwrite `app/page.tsx` entirely with:

```tsx
import { redirect } from "next/navigation";
import Dashboard from "./_dashboard";

export default function Page() {
  if (!process.env.OPENAI_API_KEY) redirect("/settings?firstRun=true");
  return <Dashboard />;
}
```

- [ ] **Step 5: Verify the dashboard still works**

Navigate to `http://localhost:3000`. Expected:
- Dashboard loads normally (your API key is in `.env.local` so no redirect)
- Gear icon appears in the top-right header next to "New Project"
- Clicking the gear icon navigates to `/settings`

- [ ] **Step 6: Commit**

```bash
git add app/_dashboard.tsx app/page.tsx
git commit -m "Refactor dashboard: server wrapper with first-run redirect, gear icon for settings"
```

---

## Task 4: Upload Page Server Wrapper

**Files:**
- Create: `app/upload/_upload.tsx` (extracted from `app/upload/page.tsx`)
- Modify: `app/upload/page.tsx`

- [ ] **Step 1: Copy entire `app/upload/page.tsx` to `app/upload/_upload.tsx`**

Create `app/upload/_upload.tsx` with the full content of the current `app/upload/page.tsx` (all lines, unchanged).

- [ ] **Step 2: Replace `app/upload/page.tsx` with the server wrapper**

Overwrite `app/upload/page.tsx` entirely with:

```tsx
import { redirect } from "next/navigation";
import UploadPage from "./_upload";

export default function Page() {
  if (!process.env.OPENAI_API_KEY) redirect("/settings?firstRun=true");
  return <UploadPage />;
}
```

- [ ] **Step 3: Verify upload page still works**

Navigate to `http://localhost:3000/upload`. Expected: upload page loads normally, drag-drop area and file picker visible.

- [ ] **Step 4: Commit**

```bash
git add app/upload/_upload.tsx app/upload/page.tsx
git commit -m "Refactor upload page: server wrapper with first-run redirect"
```

---

## Task 5: Electron — Pass CLIP_CONFIG_PATH to Next.js Server

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: Extract `configPath` in `loadConfig()` and add it to the returned object**

Find the `loadConfig()` function in `electron/main.js`. Currently it computes `configPath` as a local variable. Update it to include `CLIP_CONFIG_PATH` in the returned config:

Current:
```js
function loadConfig() {
  const configPath = path.join(app.getPath('userData'), 'clip-config.json');
  let saved = {};
  if (fs.existsSync(configPath)) {
    try { saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch (e) {
      log.warn('clip-config.json parse error:', e);
    }
  }
  const userData = app.getPath('userData');
  return {
    DATABASE_URL:    `file:${path.join(userData, 'clip.db').replace(/\\/g, '/')}`,
    CLIP_STORAGE_DIR: path.join(userData, 'storage'),
    ...saved,
  };
}
```

Replace with:
```js
function loadConfig() {
  const userData = app.getPath('userData');
  const configPath = path.join(userData, 'clip-config.json');
  let saved = {};
  if (fs.existsSync(configPath)) {
    try { saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch (e) {
      log.warn('clip-config.json parse error:', e);
    }
  }
  return {
    DATABASE_URL:     `file:${path.join(userData, 'clip.db').replace(/\\/g, '/')}`,
    CLIP_STORAGE_DIR: path.join(userData, 'storage'),
    CLIP_CONFIG_PATH: configPath,
    ...saved,
  };
}
```

The only changes: move `userData` declaration before `configPath`, and add `CLIP_CONFIG_PATH: configPath` to the returned object. `spawnNextServer` already spreads the full config into env, so no change needed there.

- [ ] **Step 2: Verify the logic in `spawnNextServer` already passes through new env keys**

Check `spawnNextServer` — it does `const env = { ...process.env, ...config, ... }`. Since `config` now includes `CLIP_CONFIG_PATH`, it will automatically be passed to the Next.js child process. No other changes needed.

- [ ] **Step 3: Commit**

```bash
git add electron/main.js
git commit -m "Pass CLIP_CONFIG_PATH env var to Next.js server so settings API can write clip-config.json"
```

---

## Task 6: End-to-End Smoke Test (Dev Mode)

- [ ] **Step 1: Verify gear icon navigates to settings**

Open `http://localhost:3000`. Click the gear icon in the top-right. Should land on `/settings`.

- [ ] **Step 2: Verify first-run banner shows**

Navigate to `http://localhost:3000/settings?firstRun=true`. Should show purple "Welcome to Clip" banner.

- [ ] **Step 3: Verify dev-mode save shows correct error**

On the settings page, type any value in the OpenAI field and click "Save changes". Expected: red error banner reading "Settings can only be saved from the packaged app. Edit .env.local directly in dev mode."

- [ ] **Step 4: Verify "Get key" links open correctly**

Click each "Get key ↗" link. Each should open the correct provider page in a new browser tab (in dev) or the default browser (in packaged Electron).

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

---

## Packaged App Verification (when ready to build)

After running `npm run build && npm run electron:build` and installing the resulting `.exe`:

1. **First launch with no `clip-config.json`** — app should redirect to `/settings?firstRun=true` with the welcome banner
2. **Paste a key and save** — green "Restart Clip to apply your new keys" banner should appear; `%AppData%\Clip\clip-config.json` should exist with the key written to it
3. **Restart Clip** — app should land on the dashboard (no redirect), key is now active
