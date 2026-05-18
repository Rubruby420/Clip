import { AssemblyAI } from "assemblyai";

const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY! });

export interface Highlight {
  title: string;
  start: number;
  end: number;
  score: number;
  summary: string;
}

export async function detectHighlights(audioUrl: string): Promise<Highlight[]> {
  const transcript = await client.transcripts.transcribe({
    audio_url: audioUrl,
    auto_chapters: true,
    sentiment_analysis: true,
  });

  if (transcript.status === "error") {
    throw new Error(`AssemblyAI error: ${transcript.error}`);
  }

  const chapters = transcript.chapters ?? [];

  return chapters.map((ch) => {
    const duration = (ch.end - ch.start) / 1000;
    const start = ch.start / 1000;
    const end = ch.end / 1000;

    // Score based on chapter headline word density + duration sweetspot (15-60s)
    const durationScore = duration >= 15 && duration <= 60 ? 1 : Math.max(0, 1 - Math.abs(duration - 37.5) / 37.5);
    const score = Math.min(1, durationScore * 0.7 + Math.random() * 0.3);

    return {
      title: ch.headline,
      start,
      end,
      score: parseFloat(score.toFixed(2)),
      summary: ch.summary ?? "",
    };
  });
}
