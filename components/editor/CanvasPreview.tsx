"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { CaptionConfig } from "@/lib/captions";
import { groupWordsIntoCaptions, autoEmoji } from "@/lib/captions";
import type { LayoutConfig } from "./LayoutPanel";

interface WordTimestamp { word: string; start: number; end: number; }

interface Props {
  videoSrc: string;
  words: WordTimestamp[];
  currentTime: number;
  onTimeUpdate: (t: number) => void;
  onLoadedMetadata: (duration: number) => void;
  captionConfig: CaptionConfig;
  captionsEnabled: boolean;
  layout: LayoutConfig;
  startTime: number;
  endTime: number;
}

function getAspectClass(ratio: string) {
  if (ratio === "9:16") return "aspect-[9/16]";
  if (ratio === "1:1") return "aspect-square";
  return "aspect-video";
}

function CaptionOverlay({ words, currentTime, config, enabled }: {
  words: WordTimestamp[]; currentTime: number; config: CaptionConfig; enabled: boolean;
}) {
  if (!enabled || words.length === 0) return null;
  const groups = groupWordsIntoCaptions(words, config.style);
  const activeGroup = groups.find((g) => currentTime >= g.start && currentTime <= g.end + 0.2);
  if (!activeGroup) return null;

  const posClass =
    config.position === "top" ? "top-[8%]" :
    config.position === "center" ? "top-1/2 -translate-y-1/2" :
    "bottom-[8%]";

  const emoji = config.style === "emoji-auto" ? autoEmoji(activeGroup.text) : "";
  const scaledSize = Math.round(config.fontSize * 0.38);

  return (
    <div className={`absolute left-0 right-0 ${posClass} flex justify-center px-3 pointer-events-none z-20`}>
      <div className={config.backgroundPill ? "px-4 py-2 rounded-2xl bg-black/65 backdrop-blur-sm" : ""} style={{ maxWidth: "92%" }}>
        {config.style === "karaoke" ? (
          <span className="flex flex-wrap justify-center gap-x-1">
            {activeGroup.words.map((w, i) => {
              const active = currentTime >= w.start && currentTime <= w.end + 0.05;
              return (
                <span key={i} style={{
                  fontFamily: config.fontFamily, fontSize: scaledSize,
                  color: active ? config.highlightColor : config.primaryColor,
                  textShadow: "0 2px 8px rgba(0,0,0,0.9)", fontWeight: 900,
                  transition: "color 0.08s",
                }}>
                  {w.word}
                </span>
              );
            })}
          </span>
        ) : (
          <p style={{
            fontFamily: config.fontFamily, fontSize: scaledSize,
            color: config.primaryColor, fontWeight: 900, lineHeight: 1.15,
            textShadow: "0 2px 12px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,1)",
            letterSpacing: config.style === "bold-pop" ? "-0.01em" : "normal",
            textAlign: "center",
          }}>
            {activeGroup.text.toUpperCase()}{emoji ? ` ${emoji}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

const CanvasPreview = forwardRef<HTMLDivElement, Props>(({
  videoSrc, words, currentTime, onTimeUpdate, onLoadedMetadata,
  captionConfig, captionsEnabled, layout, startTime, endTime,
}, ref) => {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Sync background video with main video
  useEffect(() => {
    const main = mainVideoRef.current;
    const bg = bgVideoRef.current;
    if (!main || !bg) return;
    const sync = () => { if (Math.abs(bg.currentTime - main.currentTime) > 0.2) bg.currentTime = main.currentTime; };
    main.addEventListener("timeupdate", sync);
    main.addEventListener("seeked", sync);
    main.addEventListener("play", () => bg.play().catch(() => null));
    main.addEventListener("pause", () => bg.pause());
    return () => main.removeEventListener("timeupdate", sync);
  }, []);

  // Mirror the <video> element's play/pause state into React so the custom
  // play button reflects reality (the video can pause itself on end / errors).
  useEffect(() => {
    const v = mainVideoRef.current;
    if (!v) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  // Snap playback into the trimmed range whenever the trim changes (e.g.
  // after AI Auto-Cut or manual slider drag).
  useEffect(() => {
    const v = mainVideoRef.current;
    if (!v) return;
    if (v.currentTime < startTime || v.currentTime > endTime) {
      v.currentTime = startTime;
    }
  }, [startTime, endTime]);

  const clipDuration = Math.max(0.1, endTime - startTime);
  // The `currentTime` prop coming in is already clip-relative (parent maps
  // `videoTime - startTime`). Clamp it for display so the scrubber stays in
  // bounds even mid-transition.
  const localTime = Math.min(clipDuration, Math.max(0, currentTime));

  function togglePlay() {
    const v = mainVideoRef.current;
    if (!v) return;
    if (v.paused) {
      // Rewind to clip start if we ended (or are out of range) so the next
      // play always replays the segment from the beginning.
      if (v.currentTime >= endTime - 0.05 || v.currentTime < startTime) {
        v.currentTime = startTime;
      }
      v.play().catch(() => null);
    } else {
      v.pause();
    }
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const v = mainVideoRef.current;
    if (!v) return;
    v.currentTime = startTime + parseFloat(e.target.value);
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function bgStyle(): React.CSSProperties {
    if (layout.bgType === "color") return { background: layout.bgColor };
    if (layout.bgType === "gradient") return {
      background: `linear-gradient(135deg, ${layout.gradientFrom}, ${layout.gradientTo})`,
    };
    if (layout.bgType === "image" && layout.bgImageUrl) return {
      backgroundImage: `url(${layout.bgImageUrl})`, backgroundSize: "cover", backgroundPosition: "center",
    };
    return { background: "#0f0f12" };
  }

  return (
    <div
      ref={ref}
      className={`relative ${getAspectClass(layout.aspectRatio)} w-full overflow-hidden rounded-xl shadow-2xl bg-black`}
    >
      {/* Background layer */}
      {layout.bgType === "blur" ? (
        <video
          ref={bgVideoRef}
          src={videoSrc}
          className="absolute inset-0 w-full h-full object-cover scale-110"
          style={{ filter: `blur(${layout.blurAmount}px)` }}
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="absolute inset-0" style={bgStyle()} />
      )}

      {/* Main video (centered, letterboxed). No native controls — we expose
          a clip-local scrubber below so the user only ever sees the trimmed
          segment, not the full source video. */}
      <video
        ref={mainVideoRef}
        src={videoSrc}
        className="absolute inset-0 w-full h-full object-contain z-10 cursor-pointer"
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          onTimeUpdate(t);
          if (t >= endTime) e.currentTarget.pause();
        }}
        onLoadedMetadata={(e) => {
          onLoadedMetadata(e.currentTarget.duration);
          // Snap to the clip start on initial load so the first frame the
          // user sees is the start of the trimmed segment.
          e.currentTarget.currentTime = startTime;
        }}
      />

      {/* Caption overlay */}
      <CaptionOverlay
        words={words} currentTime={currentTime}
        config={captionConfig} enabled={captionsEnabled}
      />

      {/* Clip-local control bar — only spans the trimmed segment */}
      <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-3 pt-8 flex items-center gap-2">
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full bg-white/95 hover:bg-white text-black flex items-center justify-center shrink-0 transition-colors"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>
        <input
          type="range"
          min={0}
          max={clipDuration}
          step={0.05}
          value={localTime}
          onChange={handleScrub}
          className="flex-1 h-1 accent-brand-500 cursor-pointer"
        />
        <span className="text-white text-[10px] font-mono tabular-nums shrink-0">
          {formatTime(localTime)} / {formatTime(clipDuration)}
        </span>
      </div>
    </div>
  );
});

CanvasPreview.displayName = "CanvasPreview";
export default CanvasPreview;
