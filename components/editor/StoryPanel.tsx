"use client";

import { useEffect, useState } from "react";
import {
  BookOpen, Loader2, Wand2, RefreshCw, AlertCircle,
  Scissors, Volume2, Download, Check, Quote, Bell, Clapperboard,
} from "lucide-react";
import { fileUrl, downloadUrl } from "@/lib/file-urls";

type BeatSource = "original" | "bridge" | "new";

interface StoryBeat {
  label: string;
  source: BeatSource;
  voiceover: string;
  start: number;
  end: number;
  callout: string;
  cue: string;
}
interface StoryPlan {
  structure: string;
  structureWhy: string;
  beats: StoryBeat[];
  recutStart: number;
  recutEnd: number;
  voice: string;
  voiceUrl?: string;
  generatedAt: string;
}

interface Props {
  clipId: string;
  onApplyRecut: (start: number, end: number, reason: string) => void;
}

const SOURCE_STYLE: Record<BeatSource, { label: string; cls: string }> = {
  original: { label: "Your words", cls: "bg-green-900/50 text-green-300" },
  bridge: { label: "Tightened", cls: "bg-yellow-900/50 text-yellow-300" },
  new: { label: "New narration", cls: "bg-brand-900/50 text-brand-300" },
};

function ts(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function StoryPanel({ clipId, onApplyRecut }: Props) {
  const [story, setStory] = useState<StoryPlan | null>(null);
  const [clipStart, setClipStart] = useState(0);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recutApplied, setRecutApplied] = useState(false);

  const [voicing, setVoicing] = useState(false);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);

  // Load any cached story plan for this clip.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/clips/${clipId}/story`);
        if (res.ok) {
          const data = await res.json();
          if (data.story) {
            setStory(data.story);
            setVoiceUrl(data.story.voiceUrl ?? null);
          }
          if (typeof data.clipStart === "number") setClipStart(data.clipStart);
        }
      } catch {}
      setInitialLoad(false);
    })();
  }, [clipId]);

  async function buildStory() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/story`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to build the story");
      } else {
        setStory(data.story);
        setVoiceUrl(data.story.voiceUrl ?? null);
        if (typeof data.clipStart === "number") setClipStart(data.clipStart);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setLoading(false);
  }

  // Edit a beat's voiceover line in place.
  function editBeat(index: number, voiceover: string) {
    if (!story) return;
    const beats = story.beats.map((b, i) => (i === index ? { ...b, voiceover } : b));
    setStory({ ...story, beats });
  }

  async function generateVoice() {
    if (!story) return;
    const script = story.beats.map((b) => b.voiceover).join("\n\n").trim();
    if (!script) return;
    setVoicing(true);
    setError(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/story/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, voice: story.voice }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Voiceover generation failed");
      } else {
        setVoiceUrl(data.voiceUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setVoicing(false);
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-sm text-white font-medium flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-brand-400" /> Story Mode
        </p>
        <p className="text-xs text-surface-500 mt-0.5">
          Turn this clip into a structured story — hook, beats, voiceover and callouts.
        </p>
      </div>

      {!initialLoad && (
        <button
          onClick={buildStory}
          disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-xs py-2.5 rounded-lg font-medium transition-colors"
        >
          {loading ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing the story…</>
          ) : story ? (
            <><RefreshCw className="w-3.5 h-3.5" /> Rebuild story</>
          ) : (
            <><Wand2 className="w-3.5 h-3.5" /> Build story</>
          )}
        </button>
      )}

      {loading && (
        <p className="text-[10px] text-surface-500 text-center leading-relaxed">
          Reading the whole video for context and shaping the clip into a story. ~15-30s.
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-900/30 border border-red-800 rounded-lg p-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {story && (
        <div className="space-y-3">
          {/* Structure */}
          <div className="bg-gradient-to-br from-brand-900/50 to-surface-700/40 border border-brand-800/60 rounded-xl p-3">
            <span className="text-[10px] text-brand-300 uppercase tracking-wider font-semibold">
              Story structure
            </span>
            <p className="text-sm text-white font-semibold">{story.structure}</p>
            {story.structureWhy && (
              <p className="text-[11px] text-surface-400 mt-1 leading-relaxed">{story.structureWhy}</p>
            )}
          </div>

          {/* Re-cut */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white bg-surface-700/60 rounded-lg px-2.5 py-2 flex-1">
              Story cut: <span className="text-brand-300 font-medium">{ts(story.recutStart)} – {ts(story.recutEnd)}</span>
            </span>
            <button
              onClick={() => {
                onApplyRecut(
                  clipStart + story.recutStart,
                  clipStart + story.recutEnd,
                  `Trimmed to fit the "${story.structure}" story arc.`
                );
                setRecutApplied(true);
                setTimeout(() => setRecutApplied(false), 1800);
              }}
              className="shrink-0 flex items-center gap-1 bg-brand-600 hover:bg-brand-700 text-white text-xs px-3 py-2 rounded-lg font-medium transition-colors"
            >
              {recutApplied ? <><Check className="w-3.5 h-3.5" /> Cut</> : <><Scissors className="w-3.5 h-3.5" /> Apply</>}
            </button>
          </div>

          {/* Beats */}
          <div className="space-y-2.5">
            <p className="text-[10px] text-surface-500 uppercase tracking-wider">
              Story beats ({story.beats.length})
            </p>
            {story.beats.map((beat, i) => {
              const src = SOURCE_STYLE[beat.source];
              return (
                <div key={i} className="bg-surface-700/50 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-xs text-white font-semibold flex-1 truncate">{beat.label}</span>
                    <span className="text-[9px] text-surface-500">{ts(beat.start)}–{ts(beat.end)}</span>
                  </div>

                  {/* Voiceover line — editable */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-surface-500 uppercase tracking-wider flex items-center gap-1">
                        <Quote className="w-2.5 h-2.5" /> Voiceover
                      </span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded ${src.cls}`}>{src.label}</span>
                    </div>
                    <textarea
                      value={beat.voiceover}
                      onChange={(e) => editBeat(i, e.target.value)}
                      rows={3}
                      className="w-full bg-surface-800 border border-surface-600 focus:border-brand-500 outline-none text-[11px] text-white rounded-md px-2 py-1.5 resize-y leading-relaxed"
                    />
                  </div>

                  {/* Callout */}
                  {beat.callout && (
                    <div className="flex items-start gap-1.5">
                      <Bell className="w-3 h-3 text-brand-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-brand-200">
                        <span className="text-surface-500">On-screen:</span> {beat.callout}
                      </p>
                    </div>
                  )}

                  {/* Sound / B-roll cue */}
                  {beat.cue && (
                    <div className="flex items-start gap-1.5">
                      <Clapperboard className="w-3 h-3 text-surface-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-surface-400">
                        <span className="text-surface-500">Cue:</span> {beat.cue}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* AI voiceover */}
          <div className="border-t border-surface-700 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-surface-500 uppercase tracking-wider">AI voiceover</p>
              <span className="text-[10px] text-surface-400">
                voice: <span className="text-brand-300">{story.voice}</span>
              </span>
            </div>
            <button
              onClick={generateVoice}
              disabled={voicing}
              className="w-full flex items-center justify-center gap-1.5 border border-brand-600 text-brand-300 hover:bg-brand-900/40 disabled:opacity-50 text-xs py-2 rounded-lg font-medium transition-colors"
            >
              {voicing ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating voice…</>
              ) : (
                <><Volume2 className="w-3.5 h-3.5" /> {voiceUrl ? "Regenerate voiceover" : "Generate AI voiceover"}</>
              )}
            </button>
            {voiceUrl && (
              <div className="space-y-1.5">
                <audio controls src={fileUrl(voiceUrl)} className="w-full h-8" />
                <a
                  href={downloadUrl(voiceUrl, "voiceover.mp3")}
                  download
                  className="flex items-center justify-center gap-1 text-[11px] text-brand-300 hover:text-brand-200"
                >
                  <Download className="w-3 h-3" /> Download voiceover (.mp3)
                </a>
              </div>
            )}
            <p className="text-[9px] text-surface-600 leading-relaxed">
              Edit any voiceover line above, then generate to hear it. Record it yourself for
              your own voice, or use this AI take.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
