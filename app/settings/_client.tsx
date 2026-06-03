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
