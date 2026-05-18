import type { WordTimestamp } from "./whisper";

export type CaptionStyle = "karaoke" | "bold-pop" | "minimal" | "emoji-auto";

export interface CaptionGroup {
  words: WordTimestamp[];
  start: number;
  end: number;
  text: string;
}

export interface CaptionConfig {
  style: CaptionStyle;
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  position: "top" | "center" | "bottom";
  backgroundPill: boolean;
  animationSpeed: number;
}

export const DEFAULT_CAPTION_CONFIG: CaptionConfig = {
  style: "bold-pop",
  fontFamily: "Impact",
  fontSize: 52,
  primaryColor: "#ffffff",
  highlightColor: "#fbbf24",
  position: "bottom",
  backgroundPill: true,
  animationSpeed: 1,
};

// Group words into caption chunks (2-4 words for bold-pop, 1 for karaoke)
export function groupWordsIntoCaptions(
  words: WordTimestamp[],
  style: CaptionStyle
): CaptionGroup[] {
  if (words.length === 0) return [];

  if (style === "karaoke") {
    return words.map((w) => ({
      words: [w],
      start: w.start,
      end: w.end,
      text: w.word,
    }));
  }

  // bold-pop, minimal, emoji-auto: 3 words per group
  const groups: CaptionGroup[] = [];
  const chunkSize = style === "minimal" ? 5 : 3;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    groups.push({
      words: chunk,
      start: chunk[0].start,
      end: chunk[chunk.length - 1].end,
      text: chunk.map((w) => w.word).join(" "),
    });
  }

  return groups;
}

// Simple emoji map for emoji-auto style
const EMOJI_MAP: Record<string, string> = {
  fire: "🔥", crazy: "🤯", love: "❤️", laugh: "😂", lol: "😂",
  wow: "😮", omg: "😮", win: "🏆", goat: "🐐", god: "👑",
  money: "💰", bro: "💀", insane: "🤯", clip: "🎬", go: "🚀",
  dead: "💀", best: "🏆", sick: "🤢", clean: "✨", poggers: "🎉",
};

export function autoEmoji(text: string): string {
  const lower = text.toLowerCase();
  for (const [word, emoji] of Object.entries(EMOJI_MAP)) {
    if (lower.includes(word)) return emoji;
  }
  return "";
}
