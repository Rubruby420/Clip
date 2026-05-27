/** Browser-safe URL helpers for files stored under STORAGE_DIR.
 *  Kept separate from `lib/storage.ts` (which pulls in `fs`) so client
 *  components can import these without dragging Node built-ins into the
 *  browser bundle. */

/** Browser-facing URL for a stored file. Accepts the relative path the
 *  DB columns hold (e.g. "abc/source.mp4"). Returns "" for empty input. */
export function fileUrl(relPath: string | null | undefined): string {
  if (!relPath) return "";
  return `/api/files/${relPath}`;
}

/** Same as fileUrl but adds `?download=<filename>` so /api/files sets
 *  Content-Disposition: attachment and the browser saves the file. */
export function downloadUrl(relPath: string, filename: string): string {
  return `/api/files/${relPath}?download=${encodeURIComponent(filename)}`;
}
