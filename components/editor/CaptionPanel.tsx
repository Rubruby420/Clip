"use client";

import type { CaptionConfig, CaptionStyle } from "@/lib/captions";

interface Props {
  config: CaptionConfig;
  onChange: (c: CaptionConfig) => void;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  onViewTranscript?: () => void;
}

const STYLES: { value: CaptionStyle; label: string; desc: string }[] = [
  { value: "karaoke",    label: "Karaoke",    desc: "Word-by-word highlight" },
  { value: "bold-pop",   label: "Bold Pop",   desc: "2-3 words, punchy" },
  { value: "minimal",    label: "Minimal",    desc: "Clean subtitles" },
  { value: "emoji-auto", label: "Emoji Auto", desc: "Bold-pop + emojis" },
];

function StylePreview({ style, selected }: { style: CaptionStyle; selected: boolean }) {
  const base = "w-full h-10 rounded mb-2 bg-black/60 relative overflow-hidden flex items-center justify-center";
  if (style === "karaoke") return (
    <div className={base}>
      <span className="text-[9px] text-white/50">word </span>
      <span className="text-[9px] font-bold text-yellow-300 mx-0.5 underline underline-offset-1">you</span>
      <span className="text-[9px] text-white/50"> here</span>
    </div>
  );
  if (style === "bold-pop") return (
    <div className={base}>
      <span className={`text-[11px] font-black tracking-wide ${selected ? "text-brand-300" : "text-white"}`} style={{ fontFamily: "Impact, sans-serif", textShadow: "0 1px 3px #000" }}>HEY YOU</span>
    </div>
  );
  if (style === "minimal") return (
    <div className={base}>
      <span className="absolute bottom-1 text-[8px] text-white/80 tracking-wide">simple text here</span>
    </div>
  );
  // emoji-auto
  return (
    <div className={base}>
      <span className={`text-[10px] font-bold ${selected ? "text-brand-300" : "text-white"}`} style={{ fontFamily: "Impact, sans-serif" }}>great! 🔥</span>
    </div>
  );
}

const FONTS = ["Impact", "Arial Black", "Bebas Neue", "Montserrat", "Inter", "Comic Sans MS"];

const POSITIONS: CaptionConfig["position"][] = ["top", "center", "bottom"];

export default function CaptionPanel({ config, onChange, enabled, onEnabledChange, onViewTranscript }: Props) {
  const update = (patch: Partial<CaptionConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="p-4 space-y-5">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white font-medium">Captions</p>
          <p className="text-xs text-surface-500">Auto-generated from transcription</p>
        </div>
        <button
          onClick={() => onEnabledChange(!enabled)}
          className={`w-10 h-6 rounded-full relative transition-colors ${enabled ? "bg-brand-600" : "bg-surface-600"}`}
        >
          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${enabled ? "left-5" : "left-1"}`} />
        </button>
      </div>

      {enabled && (
        <>
          {/* Style picker */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Style</p>
            <div className="grid grid-cols-2 gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => update({ style: s.value })}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    config.style === s.value
                      ? "border-brand-500 bg-brand-900/40"
                      : "border-surface-600 hover:border-surface-500"
                  }`}
                >
                  <StylePreview style={s.value} selected={config.style === s.value} />
                  <p className={`text-xs font-bold ${config.style === s.value ? "text-brand-300" : "text-white"}`}>{s.label}</p>
                  <p className="text-[10px] text-surface-500 mt-0.5">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Font */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Font</p>
            <select
              value={config.fontFamily}
              onChange={(e) => update({ fontFamily: e.target.value })}
              className="w-full bg-surface-700 border border-surface-600 text-white text-xs rounded-lg px-3 py-2"
            >
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Font size */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500 w-16">Size</span>
            <input
              type="range" min={24} max={96} step={2} value={config.fontSize}
              onChange={(e) => update({ fontSize: parseInt(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-white w-8">{config.fontSize}</span>
          </div>

          {/* Colors */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Colors</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <input type="color" value={config.primaryColor}
                  onChange={(e) => update({ primaryColor: e.target.value })}
                  className="w-8 h-7 rounded cursor-pointer bg-transparent border-0" />
                <span className="text-xs text-surface-400">Text color</span>
              </div>
              <div className="flex items-center gap-3">
                <input type="color" value={config.highlightColor}
                  onChange={(e) => update({ highlightColor: e.target.value })}
                  className="w-8 h-7 rounded cursor-pointer bg-transparent border-0" />
                <span className="text-xs text-surface-400">Highlight / active word</span>
              </div>
            </div>
          </div>

          {/* Position */}
          <div>
            <p className="text-xs text-surface-500 uppercase tracking-wider mb-2">Position</p>
            <div className="flex gap-2">
              {POSITIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => update({ position: p })}
                  className={`flex-1 py-1.5 rounded-lg border text-xs capitalize transition-colors ${
                    config.position === p
                      ? "border-brand-500 bg-brand-900/40 text-brand-300"
                      : "border-surface-600 text-surface-400 hover:border-surface-500"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Background pill */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-white">Background pill</p>
              <p className="text-[10px] text-surface-500">Rounded box behind text</p>
            </div>
            <button
              onClick={() => update({ backgroundPill: !config.backgroundPill })}
              className={`w-10 h-6 rounded-full relative transition-colors ${config.backgroundPill ? "bg-brand-600" : "bg-surface-600"}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${config.backgroundPill ? "left-5" : "left-1"}`} />
            </button>
          </div>

          {/* Speed */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-surface-500 w-16">Speed</span>
            <input
              type="range" min={0.5} max={2} step={0.1} value={config.animationSpeed}
              onChange={(e) => update({ animationSpeed: parseFloat(e.target.value) })}
              className="flex-1"
            />
            <span className="text-xs text-white w-8">{config.animationSpeed}x</span>
          </div>
        </>
      )}

      {onViewTranscript && (
        <div className="pt-2 border-t border-surface-700">
          <button
            onClick={onViewTranscript}
            className="w-full text-xs text-brand-400 hover:text-brand-300 transition-colors py-1.5"
          >
            View transcript
          </button>
        </div>
      )}
    </div>
  );
}
