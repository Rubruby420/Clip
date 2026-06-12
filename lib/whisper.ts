import OpenAI from "openai";
import fs from "fs";

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionResult {
  text: string;
  words: WordTimestamp[];
  duration: number;
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const file = fs.createReadStream(audioPath);

  const response = await getOpenAI().audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["word"],
  });

  const words: WordTimestamp[] = (response.words ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  return {
    text: response.text,
    words,
    duration: response.duration ?? 0,
  };
}

export function sliceWords(words: WordTimestamp[], start: number, end: number): WordTimestamp[] {
  return words
    .filter((w) => w.start >= start && w.end <= end)
    .map((w) => ({ ...w, start: w.start - start, end: w.end - start }));
}
