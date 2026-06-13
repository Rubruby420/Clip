import "server-only";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { resolveStorage, thumbnailMemoryPath } from "./storage";

export interface ThumbnailLesson {
  id: string;
  text: string;
  source: "feedback" | "example" | "youtube";
  weight: number;
  createdAt: string;
}

export interface ThumbnailExample {
  path: string;    // relative storage path
  note: string;
  createdAt: string;
}

export interface ThumbnailMemory {
  lessons: ThumbnailLesson[];
  examples: ThumbnailExample[];
}

const MAX_LESSONS = 40;
const MAX_EXAMPLES = 20;

function emptyMemory(): ThumbnailMemory {
  return { lessons: [], examples: [] };
}

export function loadMemory(): ThumbnailMemory {
  try {
    const abs = resolveStorage(thumbnailMemoryPath());
    if (!fs.existsSync(abs)) return emptyMemory();
    const raw = fs.readFileSync(abs, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      examples: Array.isArray(parsed.examples) ? parsed.examples : [],
    };
  } catch {
    return emptyMemory();
  }
}

function saveMemory(mem: ThumbnailMemory): void {
  const abs = resolveStorage(thumbnailMemoryPath());
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(mem, null, 2), "utf-8");
}

/** Add new lessons to memory. Deduplicates by text, caps at MAX_LESSONS by weight desc. */
export function appendLessons(
  newLessons: Array<{ text: string; source: "feedback" | "example" | "youtube"; weight?: number }>
): void {
  const mem = loadMemory();
  const existing = new Set(mem.lessons.map((l) => l.text.toLowerCase().trim()));

  for (const l of newLessons) {
    const key = l.text.toLowerCase().trim();
    if (!key || existing.has(key)) continue;
    existing.add(key);
    mem.lessons.push({
      id: randomUUID(),
      text: l.text.trim(),
      source: l.source,
      weight: l.weight ?? 1,
      createdAt: new Date().toISOString(),
    });
  }

  // Keep the highest-weight, most-recent lessons
  if (mem.lessons.length > MAX_LESSONS) {
    mem.lessons = mem.lessons
      .sort(
        (a, b) =>
          b.weight - a.weight ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, MAX_LESSONS);
  }

  saveMemory(mem);
}

/** Record a user-supplied example thumbnail to memory. */
export function appendExample(relPath: string, note: string): void {
  const mem = loadMemory();
  mem.examples.push({ path: relPath, note, createdAt: new Date().toISOString() });
  if (mem.examples.length > MAX_EXAMPLES) mem.examples = mem.examples.slice(-MAX_EXAMPLES);
  saveMemory(mem);
}
