"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Loader2, ExternalLink, CheckCircle, AlertCircle, Upload, Share2 } from "lucide-react";

type Platform = "tiktok" | "youtube" | "instagram";
type TikTokPrivacy = "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
type YTPrivacy = "public" | "private" | "unlisted";

interface PlatformStatus {
  platform: Platform;
  name: string;
  emoji: string;
  connected: boolean;
  handle: string;
  setupUrl: string;
}

interface PublishDialogProps {
  /** "clip" uses clipId; "reel" uses projectId. */
  source: "clip" | "reel";
  id: string;
  defaultTitle?: string;
  isOpen: boolean;
  onClose: () => void;
}

const PLATFORM_META: { platform: Platform; name: string; emoji: string; setupUrl: string }[] = [
  { platform: "tiktok",    name: "TikTok",           emoji: "🎵", setupUrl: "/docs/social-setup-tiktok.md" },
  { platform: "youtube",   name: "YouTube Shorts",   emoji: "▶️", setupUrl: "/docs/social-setup-youtube.md" },
  { platform: "instagram", name: "Instagram Reels",  emoji: "📱", setupUrl: "/docs/social-setup-instagram.md" },
];

const TIKTOK_PRIVACY_OPTIONS: { value: TikTokPrivacy; label: string; note?: string }[] = [
  { value: "SELF_ONLY",            label: "Private (only me)", note: "Always available without app audit" },
  { value: "PUBLIC_TO_EVERYONE",   label: "Public",            note: "Requires TikTok app audit" },
  { value: "FOLLOWER_OF_CREATOR",  label: "Followers" },
  { value: "MUTUAL_FOLLOW_FRIENDS",label: "Friends" },
];

export default function PublishDialog({ source, id, defaultTitle = "", isOpen, onClose }: PublishDialogProps) {
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [selected, setSelected] = useState<Platform | null>(null);
  const [caption, setCaption] = useState("");
  const [videoTitle, setVideoTitle] = useState(defaultTitle);
  const [tiktokPrivacy, setTiktokPrivacy] = useState<TikTokPrivacy>("SELF_ONLY");
  const [ytPrivacy, setYtPrivacy] = useState<YTPrivacy>("public");
  const [publishing, setPublishing] = useState(false);
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ postUrl?: string; publishId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPlatforms = useCallback(async () => {
    setLoadingPlatforms(true);
    const statuses = await Promise.all(
      PLATFORM_META.map(async (p) => {
        try {
          const res = await fetch(`/api/social/${p.platform}`);
          const data = await res.json();
          return { ...p, connected: !!data.connected, handle: data.handle ?? "" };
        } catch {
          return { ...p, connected: false, handle: "" };
        }
      })
    );
    setPlatforms(statuses);
    setLoadingPlatforms(false);
    // Auto-select the first connected platform
    const first = statuses.find((p) => p.connected);
    if (first && !selected) setSelected(first.platform);
  }, [selected]);

  useEffect(() => {
    if (isOpen) {
      setVideoTitle(defaultTitle);
      setResult(null);
      setError(null);
      setPct(0);
      setMessage("");
      setPublishing(false);
      fetchPlatforms();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePublish() {
    if (!selected) return;
    setPublishing(true);
    setError(null);
    setResult(null);
    setPct(0);
    setMessage("Preparing…");

    try {
      const res = await fetch("/api/social/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: selected,
          source,
          id,
          caption,
          title: videoTitle,
          privacy: tiktokPrivacy,
          privacyStatus: ytPrivacy,
        }),
      });

      if (!res.body) throw new Error("No response stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "progress") { setPct(evt.pct ?? 0); setMessage(evt.message ?? ""); }
            if (evt.type === "done") { setResult({ postUrl: evt.postUrl, publishId: evt.publishId }); setPct(100); }
            if (evt.type === "error") { setError(evt.error ?? "Publish failed"); }
          } catch {}
        }
      }
    } catch (err) {
      setError(String(err));
    }
    setPublishing(false);
  }

  async function handleDisconnect(platform: Platform) {
    await fetch(`/api/social/${platform}`, { method: "DELETE" });
    fetchPlatforms();
    if (selected === platform) setSelected(null);
  }

  if (!isOpen) return null;

  const selectedMeta = platforms.find((p) => p.platform === selected);
  const canPublish = !!selected && !!selectedMeta?.connected && !publishing && !result;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-800 border border-surface-600 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-brand-400" />
            <span className="text-white font-semibold text-sm">Publish to social</span>
          </div>
          <button onClick={onClose} className="text-surface-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Platform picker */}
          <div>
            <p className="text-surface-400 text-xs mb-2 font-medium uppercase tracking-wider">Platform</p>
            {loadingPlatforms ? (
              <div className="flex items-center gap-2 text-surface-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking connections…
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {platforms.map((p) => (
                  <div key={p.platform} className="flex items-center gap-3">
                    <button
                      onClick={() => p.connected && setSelected(p.platform)}
                      disabled={!p.connected || publishing}
                      className={`flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm transition-colors
                        ${selected === p.platform && p.connected
                          ? "border-brand-500 bg-brand-900/40 text-white"
                          : p.connected
                          ? "border-surface-600 hover:border-surface-500 text-white"
                          : "border-surface-700 text-surface-500 cursor-not-allowed"
                        }`}
                    >
                      <span className="text-base">{p.emoji}</span>
                      <span className="font-medium">{p.name}</span>
                      {p.connected ? (
                        <span className="ml-auto text-xs text-surface-400 truncate max-w-[120px]">
                          {p.handle || "Connected"}
                        </span>
                      ) : (
                        <a
                          href={`/api/social/${p.platform}/connect`}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
                        >
                          Connect <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </button>
                    {p.connected && (
                      <button
                        onClick={() => handleDisconnect(p.platform)}
                        disabled={publishing}
                        className="text-surface-500 hover:text-red-400 text-xs transition-colors px-1"
                        title="Disconnect"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Caption / title */}
          {selected && selectedMeta?.connected && !result && (
            <>
              <div>
                <label className="text-surface-400 text-xs mb-1.5 font-medium uppercase tracking-wider block">
                  Title
                </label>
                <input
                  type="text"
                  value={videoTitle}
                  onChange={(e) => setVideoTitle(e.target.value)}
                  disabled={publishing}
                  maxLength={150}
                  placeholder="Video title…"
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-surface-500 focus:outline-none focus:border-brand-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-surface-400 text-xs mb-1.5 font-medium uppercase tracking-wider block">
                  Caption / description
                </label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  disabled={publishing}
                  rows={3}
                  maxLength={2200}
                  placeholder="Add a caption, hashtags…"
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-surface-500 focus:outline-none focus:border-brand-500 disabled:opacity-50 resize-none"
                />
              </div>

              {/* TikTok privacy */}
              {selected === "tiktok" && (
                <div>
                  <label className="text-surface-400 text-xs mb-1.5 font-medium uppercase tracking-wider block">
                    Who can see this
                  </label>
                  <div className="flex flex-col gap-1">
                    {TIKTOK_PRIVACY_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="radio"
                          name="tiktok-privacy"
                          value={opt.value}
                          checked={tiktokPrivacy === opt.value}
                          onChange={() => setTiktokPrivacy(opt.value)}
                          disabled={publishing}
                          className="accent-brand-500"
                        />
                        <span className="text-white">{opt.label}</span>
                        {opt.note && <span className="text-surface-500 text-xs">— {opt.note}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* YouTube privacy */}
              {selected === "youtube" && (
                <div>
                  <label className="text-surface-400 text-xs mb-1.5 font-medium uppercase tracking-wider block">
                    Visibility
                  </label>
                  <select
                    value={ytPrivacy}
                    onChange={(e) => setYtPrivacy(e.target.value as YTPrivacy)}
                    disabled={publishing}
                    className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  >
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="private">Private</option>
                  </select>
                </div>
              )}
            </>
          )}

          {/* Progress */}
          {publishing && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-400">{message || "Uploading…"}</span>
                <span className="text-white font-mono">{pct}%</span>
              </div>
              <div className="h-2 bg-surface-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {/* Success */}
          {result && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-full bg-green-700/30 border border-green-600 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              <p className="text-white font-semibold text-sm">Published!</p>
              {result.postUrl && (
                <a
                  href={result.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-brand-400 hover:text-brand-300 text-sm transition-colors"
                >
                  View post <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              {!result.postUrl && result.publishId && (
                <p className="text-surface-400 text-xs text-center">
                  Post is processing — check your account.
                  <br />
                  ID: <code className="text-white font-mono">{result.publishId}</code>
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-900/30 border border-red-700 rounded-xl px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-red-300 text-xs">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          {result ? (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-surface-700 hover:bg-surface-600 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Close
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={publishing}
                className="flex-1 py-2.5 border border-surface-600 hover:border-surface-500 text-surface-400 hover:text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={!canPublish}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {publishing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Publishing…</>
                ) : (
                  <><Upload className="w-4 h-4" /> Publish</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
