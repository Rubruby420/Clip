"use client";

import { useRef } from "react";

export type AspectRatio = "9:16" | "16:9" | "1:1";
export type BgType = "blur" | "color" | "gradient" | "image";

// Timed text/emoji overlay popping in at a specific beat. Auto-populated
// from the AI Remix clone recipe's editBeats (one per beat).
export interface BeatOverlay {
  text: string;        // overlay text (may include emoji)
  emoji: string;       // big emoji "stamp" at the same beat
  start: number;       // clip-relative seconds
  end: number;
  position: "top" | "center" | "bottom";
}

export interface LayoutConfig {
  aspectRatio: AspectRatio;
  bgType: BgType;
  bgColor: string;
  gradientFrom: string;
  gradientTo: string;
  bgImageUrl: string;
  blurAmount: number;
  // Opening hook overlay (first overlayDuration seconds).
  overlayText: string;
  overlayDuration: number;
  // Beat-by-beat overlays from the AI clone recipe.
  beatOverlays: BeatOverlay[];
  // Background music (Jamendo). Auto-picked by AI Remix or set by hand.
  musicUrl: string;
  musicTitle: string;
  musicArtist: string;
  musicVolume: number; // 0-1, multiplier mixed under the original clip audio
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  aspectRatio: "9:16",
  bgType: "blur",
  bgColor: "#0f0f12",
  gradientFrom: "#6366f1",
  gradientTo: "#ec4899",
  bgImageUrl: "",
  blurAmount: 20,
  overlayText: "",
  overlayDuration: 3,
  beatOverlays: [],
  musicUrl: "",
  musicTitle: "",
  musicArtist: "",
  musicVolume: 0.25,
};

interface Props {
  config: LayoutConfig;
  onChange: (c: LayoutConfig) => void;
}

const RATIOS: { label: string; value: AspectRatio; desc: string }[] = [
  { label: "9:16", value: "9:16", desc: "TikTok / Reels" },
  { label: "16:9", value: "16:9", desc: "YouTube" },
  { label: "1:1",  value: "1:1",  desc: "Instagram" },
];

const BG_TYPES: { label: string; value: BgType }[] = [
  { label: "Blur BG", value: "blur" },
  { label: "Solid", value: "color" },
  { label: "Gradient", value: "gradient" },
  { label: "Image", value: "image" },
];

export default function LayoutPanel({ config, onChange }: Props) {
  const update = (patch: Partial<LayoutConfig>) => onChange({ ...config, ...patch });
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="p-4 space-y-5">
      <div>
        <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Hook overlay</p>
        <input
          type="text"
          value={config.overlayText}
          onChange={(e) => update({ overlayText: e.target.value })}
          placeholder="Big bold text at the start (e.g. WAIT FOR IT…)"
          maxLength={80}
          className="w-full px-2.5 py-2 bg-surface-700 border border-surface-600 rounded-lg text-xs text-white placeholder-surface-500 focus:border-brand-500 focus:outline-none"
        />
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-surface-500">Shows for</span>
          <input
            type="range" min={1} max={8} step={0.5} value={config.overlayDuration}
            onChange={(e) => update({ overlayDuration: parseFloat(e.target.value) })}
            className="flex-1 accent-brand-500"
          />
          <span className="text-[10px] text-white tabular-nums">{config.overlayDuration}s</span>
        </div>
      </div>

      <div>
        <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Aspect Ratio</p>
        <div className="grid grid-cols-3 gap-2">
          {RATIOS.map((r) => (
            <button
              key={r.value}
              onClick={() => update({ aspectRatio: r.value })}
              className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs transition-colors ${
                config.aspectRatio === r.value
                  ? "border-brand-500 bg-brand-900/40 text-brand-300"
                  : "border-surface-600 text-surface-400 hover:border-surface-500"
              }`}
            >
              <span className="font-bold">{r.label}</span>
              <span className="text-surface-500 text-[10px]">{r.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Background</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {BG_TYPES.map((b) => (
            <button
              key={b.value}
              onClick={() => update({ bgType: b.value })}
              className={`py-2 rounded-lg border text-xs transition-colors ${
                config.bgType === b.value
                  ? "border-brand-500 bg-brand-900/40 text-brand-300"
                  : "border-surface-600 text-surface-400 hover:border-surface-500"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {config.bgType === "color" && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={config.bgColor}
              onChange={(e) => update({ bgColor: e.target.value })}
              className="w-10 h-8 rounded cursor-pointer bg-transparent border-0"
            />
            <span className="text-xs text-surface-400">{config.bgColor}</span>
          </div>
        )}

        {config.bgType === "gradient" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input type="color" value={config.gradientFrom} onChange={(e) => update({ gradientFrom: e.target.value })}
                className="w-10 h-7 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-xs text-surface-400">From</span>
              <input type="color" value={config.gradientTo} onChange={(e) => update({ gradientTo: e.target.value })}
                className="w-10 h-7 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-xs text-surface-400">To</span>
            </div>
            <div
              className="h-6 rounded-lg"
              style={{ background: `linear-gradient(to right, ${config.gradientFrom}, ${config.gradientTo})` }}
            />
          </div>
        )}

        {config.bgType === "blur" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500">Blur</span>
            <input
              type="range" min={5} max={40} step={1} value={config.blurAmount}
              onChange={(e) => update({ blurAmount: parseInt(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-white">{config.blurAmount}px</span>
          </div>
        )}

        {config.bgType === "image" && (
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) update({ bgImageUrl: URL.createObjectURL(f) });
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-2 border border-dashed border-surface-600 rounded-lg text-xs text-surface-400 hover:border-surface-500 transition-colors"
            >
              {config.bgImageUrl ? "Change image" : "Upload background image"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
