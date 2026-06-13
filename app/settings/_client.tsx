"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Settings,
  ArrowLeft,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Zap,
  Share2,
} from "lucide-react";

type ConfigKey =
  | "OPENAI_API_KEY"
  | "ASSEMBLYAI_API_KEY"
  | "YOUTUBE_API_KEY"
  | "JAMENDO_CLIENT_ID"
  | "TIKTOK_CLIENT_KEY"
  | "TIKTOK_CLIENT_SECRET"
  | "YOUTUBE_OAUTH_CLIENT_ID"
  | "YOUTUBE_OAUTH_CLIENT_SECRET"
  | "INSTAGRAM_APP_ID"
  | "INSTAGRAM_APP_SECRET"
  | "PUBLIC_BASE_URL";

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

// Social publish OAuth credentials — separate section in the UI
const SOCIAL_KEYS: {
  key: ConfigKey;
  name: string;
  description: string;
  getKeyUrl: string;
}[] = [
  {
    key: "PUBLIC_BASE_URL",
    name: "App public URL",
    description: "OAuth redirect base. Default: http://localhost:3000. Set to your HTTPS tunnel for Instagram.",
    getKeyUrl: "https://ngrok.com",
  },
  {
    key: "TIKTOK_CLIENT_KEY",
    name: "TikTok Client Key",
    description: "From TikTok Developer Portal — Login Kit + Content Posting API",
    getKeyUrl: "https://developers.tiktok.com",
  },
  {
    key: "TIKTOK_CLIENT_SECRET",
    name: "TikTok Client Secret",
    description: "Keep this secret — never commit to git",
    getKeyUrl: "https://developers.tiktok.com",
  },
  {
    key: "YOUTUBE_OAUTH_CLIENT_ID",
    name: "YouTube OAuth Client ID",
    description: "Google Cloud → OAuth 2.0 Client (Web) — YouTube Data API v3 scope",
    getKeyUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    key: "YOUTUBE_OAUTH_CLIENT_SECRET",
    name: "YouTube OAuth Client Secret",
    description: "The client secret for the OAuth client above",
    getKeyUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    key: "INSTAGRAM_APP_ID",
    name: "Instagram / Facebook App ID",
    description: "Facebook Developers → App ID (Instagram Basic Display or Graph API app)",
    getKeyUrl: "https://developers.facebook.com",
  },
  {
    key: "INSTAGRAM_APP_SECRET",
    name: "Instagram / Facebook App Secret",
    description: "Keep this secret — never commit to git",
    getKeyUrl: "https://developers.facebook.com",
  },
];

type SocialPlatform = "tiktok" | "youtube" | "instagram";
const SOCIAL_PLATFORMS: { platform: SocialPlatform; name: string; emoji: string }[] = [
  { platform: "tiktok",    name: "TikTok",          emoji: "🎵" },
  { platform: "youtube",   name: "YouTube Shorts",  emoji: "▶️" },
  { platform: "instagram", name: "Instagram Reels", emoji: "📱" },
];

const EMPTY: Record<ConfigKey, string> = {
  OPENAI_API_KEY: "",
  ASSEMBLYAI_API_KEY: "",
  YOUTUBE_API_KEY: "",
  JAMENDO_CLIENT_ID: "",
  TIKTOK_CLIENT_KEY: "",
  TIKTOK_CLIENT_SECRET: "",
  YOUTUBE_OAUTH_CLIENT_ID: "",
  YOUTUBE_OAUTH_CLIENT_SECRET: "",
  INSTAGRAM_APP_ID: "",
  INSTAGRAM_APP_SECRET: "",
  PUBLIC_BASE_URL: "",
};

interface ConnectionStatus { connected: boolean; handle: string; }

export default function SettingsClient({ firstRun }: { firstRun: boolean }) {
  const searchParams = useSearchParams();
  const [masked, setMasked] = useState<Record<ConfigKey, string>>(EMPTY);
  const [values, setValues] = useState<Record<ConfigKey, string>>(EMPTY);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [connections, setConnections] = useState<Record<SocialPlatform, ConnectionStatus>>({
    tiktok: { connected: false, handle: "" },
    youtube: { connected: false, handle: "" },
    instagram: { connected: false, handle: "" },
  });
  const [socialMsg, setSocialMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => setMasked(data))
      .catch(() => {});

    // Fetch connection statuses
    Promise.all(
      SOCIAL_PLATFORMS.map((p) =>
        fetch(`/api/social/${p.platform}`)
          .then((r) => r.json())
          .then((d) => ({ platform: p.platform, connected: !!d.connected, handle: d.handle ?? "" }))
          .catch(() => ({ platform: p.platform, connected: false, handle: "" }))
      )
    ).then((results) => {
      const next = { ...connections };
      results.forEach(({ platform, connected, handle }) => {
        next[platform as SocialPlatform] = { connected, handle };
      });
      setConnections(next);
    });

    // Handle OAuth callback messages
    const connected = searchParams.get("socialConnected");
    const err = searchParams.get("socialError");
    if (connected) setSocialMsg(`✓ ${SOCIAL_PLATFORMS.find((p) => p.platform === connected)?.name ?? connected} connected!`);
    if (err) setSocialMsg(`Connection failed: ${err}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDisconnect(platform: SocialPlatform) {
    await fetch(`/api/social/${platform}`, { method: "DELETE" });
    setConnections((prev) => ({ ...prev, [platform]: { connected: false, handle: "" } }));
  }

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

  const nothingToSave = Object.values(values).every((v) => !v.trim());

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

        {/* AI provider keys */}
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
                type={values[key] ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={values[key]}
                placeholder={masked[key] || "Paste key here…"}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [key]: e.target.value }));
                  if (status === "error") setStatus("idle");
                }}
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-surface-500 focus:outline-none focus:border-brand-500 font-mono"
              />
            </div>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSave}
            disabled={status === "saving" || nothingToSave}
            className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {status === "saving" && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>

        {/* ── Social Publish ── */}
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-1">
            <Share2 className="w-4 h-4 text-brand-400" />
            <h2 className="text-white font-semibold text-base">Social Publish</h2>
          </div>
          <p className="text-surface-500 text-sm mb-6">
            Publish clips and highlight reels directly to TikTok, YouTube Shorts, and Instagram Reels.
            Enter your app credentials below, then click Connect.
          </p>

          {socialMsg && (
            <div className={`mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${
              socialMsg.startsWith("✓")
                ? "bg-green-900/40 border border-green-700 text-green-200"
                : "bg-red-900/40 border border-red-700 text-red-200"
            }`}>
              {socialMsg.startsWith("✓") ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
              {socialMsg}
            </div>
          )}

          {/* Connected accounts */}
          <div id="connections" className="flex flex-col gap-3 mb-8">
            {SOCIAL_PLATFORMS.map(({ platform, name, emoji }) => {
              const conn = connections[platform];
              return (
                <div key={platform} className="bg-surface-800 border border-surface-600 rounded-xl px-5 py-4 flex items-center gap-3">
                  <span className="text-xl">{emoji}</span>
                  <div className="flex-1">
                    <div className="text-white text-sm font-semibold">{name}</div>
                    {conn.connected ? (
                      <div className="text-green-400 text-xs mt-0.5">
                        ✓ Connected{conn.handle ? ` as ${conn.handle}` : ""}
                      </div>
                    ) : (
                      <div className="text-surface-500 text-xs mt-0.5">Not connected</div>
                    )}
                  </div>
                  {conn.connected ? (
                    <button
                      onClick={() => handleDisconnect(platform)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors border border-red-800 hover:border-red-600 px-3 py-1.5 rounded-lg"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <a
                      href={`/api/social/${platform}/connect`}
                      className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
                    >
                      Connect
                    </a>
                  )}
                </div>
              );
            })}
          </div>

          {/* Social OAuth credentials */}
          <h3 className="text-surface-400 text-xs font-medium uppercase tracking-wider mb-3">
            App credentials (required before connecting)
          </h3>
          <div className="flex flex-col gap-4">
            {SOCIAL_KEYS.map(({ key, name, description, getKeyUrl }) => (
              <div key={key} className="bg-surface-800 border border-surface-600 rounded-xl p-5">
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
                    Setup <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <input
                  type={values[key] ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  value={values[key]}
                  placeholder={masked[key] || "Paste value here…"}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [key]: e.target.value }));
                    if (status === "error") setStatus("idle");
                  }}
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-surface-500 focus:outline-none focus:border-brand-500 font-mono"
                />
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={status === "saving" || nothingToSave}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {status === "saving" && <Loader2 className="w-4 h-4 animate-spin" />}
              {status === "saving" ? "Saving…" : "Save credentials"}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
