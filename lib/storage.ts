import "server-only";
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";

export const STORAGE_DIR = process.env.CLIP_STORAGE_DIR ?? "D:/clip";

/** Resolve a relative storage path (e.g. "abc/source.mp4") against STORAGE_DIR.
 *  Throws if the resolved path escapes STORAGE_DIR. */
export function resolveStorage(relPath: string): string {
  const root = path.resolve(STORAGE_DIR);
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path traversal blocked: ${relPath}`);
  }
  return abs;
}

/** Make sure the directory containing `absPath` exists. */
export async function ensureDirFor(absPath: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
}

/** Make sure `absPath` itself is a directory. */
export async function ensureDir(absPath: string): Promise<void> {
  await fs.mkdir(absPath, { recursive: true });
}

/** Relative path (DB-shape) for a project's source file. */
export function projectSourcePath(projectId: string, ext: string): string {
  const clean = ext.replace(/^\./, "").toLowerCase() || "mp4";
  return `${projectId}/source.${clean}`;
}

/** Relative path for a project's 720p proxy. */
export function projectProxyPath(projectId: string): string {
  return `${projectId}/proxy.mp4`;
}

/** Relative path for a project's waveform JSON. */
export function projectWaveformPath(projectId: string): string {
  return `${projectId}/waveform.json`;
}

/** Relative path for a clip's rendered export. */
export function clipExportPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/export.mp4`;
}

/** Relative path for a clip's Story Mode TTS voiceover. */
export function clipVoicePath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/voice.mp3`;
}

/** Relative path for a clip's thumbnail. */
export function clipThumbPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/thumb.jpg`;
}

/** Relative path for a project's watermark/logo PNG. */
export function projectLogoPath(projectId: string): string {
  return `${projectId}/logo.png`;
}

/** Relative path for a clip's AI-generated thumbnail image. */
export function clipThumbnailGenPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/thumb-gen.jpg`;
}

/** Relative path for a clip's thumbnail recipe + feedback JSON cache. */
export function clipThumbnailDataPath(projectId: string, clipId: string): string {
  return `${projectId}/clips/${clipId}/thumbnail.json`;
}

/** Relative path for a numbered user-supplied example thumbnail image. */
export function clipThumbnailExamplePath(projectId: string, clipId: string, n: number): string {
  return `${projectId}/clips/${clipId}/thumb-example-${n}.png`;
}

/** Relative path for the global thumbnail learning memory file. */
export function thumbnailMemoryPath(): string {
  return `_thumbnail/memory.json`;
}

/** Relative path for a project's stitched highlight reel. */
export function projectHighlightReelPath(projectId: string): string {
  return `${projectId}/highlight-reel.mp4`;
}

/** Stream a file off disk — used by the file route. */
export function openReadStream(absPath: string, start?: number, end?: number) {
  return createReadStream(absPath, start != null && end != null ? { start, end } : {});
}

/** Delete a project's entire folder (source + all clip artifacts). */
export async function deleteProjectFolder(projectId: string): Promise<void> {
  const abs = resolveStorage(projectId);
  await fs.rm(abs, { recursive: true, force: true });
}
