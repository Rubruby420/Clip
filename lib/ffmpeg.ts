import { exec, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

function ffmpegBin(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ffmpeg-static") as string;
  } catch {
    return "ffmpeg";
  }
}

export async function extractAudio(videoPath: string, outputPath: string): Promise<void> {
  const bin = ffmpegBin();
  await execAsync(`"${bin}" -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`);
}

// Extract just the audio for a [startSec, endSec] slice of the source.
// Used by /api/projects/[id]/finalize so the manual-mode pipeline can
// Whisper-transcribe just the saved clips instead of the full source.
export async function extractAudioSegment(
  videoPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
): Promise<void> {
  const bin = ffmpegBin();
  const duration = Math.max(0.1, endSec - startSec);
  // -ss before -i is faster (keyframe seek); for an audio-only slice the
  // precision loss is negligible.
  await execAsync(
    `"${bin}" -y -ss ${startSec} -t ${duration} -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`,
  );
}

// 720p H.264 mp4 used by the editor preview so 4K sources don't crush
// playback. Export reads the original instead, so final quality is
// untouched. veryfast/crf 26 keeps the encode time tolerable for long
// 4K sources; faststart lets the browser stream before the file is fully
// downloaded.
export async function generatePreviewProxy(videoPath: string, outputPath: string): Promise<void> {
  const bin = ffmpegBin();
  await execAsync(
    `"${bin}" -y -i "${videoPath}" -vf "scale=-2:720" -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
    { maxBuffer: 1024 * 1024 * 50 }
  );
}

export async function extractThumbnail(
  videoPath: string,
  outputPath: string,
  timeSeconds: number = 2
): Promise<void> {
  const bin = ffmpegBin();
  await execAsync(
    `"${bin}" -y -ss ${timeSeconds} -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}"`
  );
}

// Probe a video's duration in seconds. Uses spawn + manual stderr parse so
// this works on Windows (the previous shell-piped grep/awk version exec'd
// through cmd.exe and silently returned 0).
export async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegBin(), ["-i", videoPath]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(0);
      const h = parseInt(m[1], 10);
      const mn = parseInt(m[2], 10);
      const s = parseFloat(m[3]);
      resolve(h * 3600 + mn * 60 + s);
    });
  });
}

export interface ExportOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  subtitlePath?: string;
  hookOverlayAssPath?: string; // pre-generated ASS file for the hook overlay
  musicPath?: string;          // background music audio file mixed under the clip
  musicVolume?: number;        // 0-1 multiplier for the music
  blurBackground?: boolean;
}

export interface BeatOverlayInput {
  text: string;
  emoji: string;
  start: number;
  end: number;
  position: "top" | "center" | "bottom";
}

// Build an ASS subtitle file that renders the hook + every beat overlay.
// Each beat is a separate Dialogue event with its own start/end and style
// for top/center/bottom positioning.
export function generateOverlayAss(opts: {
  hookText: string;
  hookDuration: number;
  beats: BeatOverlayInput[];
  videoW: number;
  videoH: number;
}): string {
  const { hookText, hookDuration, beats, videoW, videoH } = opts;

  const hookFont = Math.round(videoH * 0.045);
  const beatFont = Math.round(videoH * 0.038);
  const emojiFont = Math.round(videoH * 0.07);
  const marginTop = Math.round(videoH * 0.12);
  const marginBottom = Math.round(videoH * 0.18);

  const lines: string[] = [];
  lines.push("[Script Info]");
  lines.push("ScriptType: v4.00+");
  lines.push(`PlayResX: ${videoW}`);
  lines.push(`PlayResY: ${videoH}`);
  lines.push("ScaledBorderAndShadow: yes");
  lines.push("");
  lines.push("[V4+ Styles]");
  lines.push(
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
  );
  // White hook at top.
  lines.push(
    `Style: Hook,Impact,${hookFont},&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,2,8,40,40,${marginTop},1`
  );
  // Yellow beat text — top / center / bottom variants. Alignment values:
  //   8 = top-center, 5 = middle-center, 2 = bottom-center.
  lines.push(
    `Style: BeatTop,Impact,${beatFont},&H0000F0FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,8,40,40,${Math.round(videoH * 0.22)},1`
  );
  lines.push(
    `Style: BeatMid,Impact,${beatFont},&H0000F0FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,5,40,40,0,1`
  );
  lines.push(
    `Style: BeatBot,Impact,${beatFont},&H0000F0FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,2,2,40,40,${marginBottom},1`
  );
  // Emoji style — same alignment options; relies on system emoji font.
  lines.push(
    `Style: EmojiTop,Arial,${emojiFont},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,3,8,40,40,${Math.round(videoH * 0.1)},1`
  );
  lines.push(
    `Style: EmojiMid,Arial,${emojiFont},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,3,5,40,40,0,1`
  );
  lines.push(
    `Style: EmojiBot,Arial,${emojiFont},&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,3,2,40,40,${Math.round(videoH * 0.28)},1`
  );

  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  if (hookText && hookText.trim()) {
    const safe = sanitiseAssText(hookText);
    lines.push(`Dialogue: 0,0:00:00.00,${formatAssTime(hookDuration)},Hook,,0,0,0,,${safe}`);
  }

  for (const b of beats) {
    if (b.end <= b.start) continue;
    const textStyle = b.position === "top" ? "BeatTop" : b.position === "bottom" ? "BeatBot" : "BeatMid";
    const emojiStyle = b.position === "top" ? "EmojiTop" : b.position === "bottom" ? "EmojiBot" : "EmojiMid";
    const start = formatAssTime(b.start);
    const end = formatAssTime(b.end);
    if (b.emoji && b.emoji.trim()) {
      lines.push(`Dialogue: 0,${start},${end},${emojiStyle},,0,0,0,,${sanitiseAssText(b.emoji)}`);
    }
    if (b.text && b.text.trim()) {
      lines.push(`Dialogue: 0,${start},${end},${textStyle},,0,0,0,,${sanitiseAssText(b.text)}`);
    }
  }

  return lines.join("\n") + "\n";
}

function sanitiseAssText(s: string): string {
  return s.replace(/[{}]/g, "").replace(/[\r\n]+/g, " ").trim();
}

// Kept for backward compatibility with the previous single-overlay export.
export function generateHookAss(text: string, durationSec: number, videoW: number, videoH: number): string {
  return generateOverlayAss({ hookText: text, hookDuration: durationSec, beats: [], videoW, videoH });
}

function formatAssTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${m.toString().padStart(2, "0")}:${sec}`;
}

export async function exportClip(opts: ExportOptions): Promise<void> {
  const bin = ffmpegBin();
  const duration = opts.endTime - opts.startTime;

  const targetW = opts.aspectRatio === "16:9" ? 1920 : opts.aspectRatio === "9:16" ? 1080 : 1080;
  const targetH = opts.aspectRatio === "16:9" ? 1080 : opts.aspectRatio === "9:16" ? 1920 : 1080;

  let filterComplex = "";

  if (opts.blurBackground) {
    filterComplex = [
      `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:5[bg]`,
      `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
    ].join(";");
  } else {
    filterComplex = `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black[v]`;
  }

  // The FFmpeg `subtitles` filter uses `:` as its option separator, so a
  // Windows path like `C:/...` gets mis-parsed (FFmpeg reads `C` as the
  // filename and `/...` as the `original_size` option, which then errors).
  // Convert backslashes to forward slashes, then escape every colon.
  const subtitleArg = opts.subtitlePath
    ? opts.subtitlePath.replace(/\\/g, "/").replace(/:/g, "\\:")
    : "";
  const subtitleFilter = opts.subtitlePath
    ? `,[v]subtitles='${subtitleArg}':force_style='Fontname=Impact,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=2'[v]`
    : "";

  // Hook-text overlay (top-of-screen, first N seconds). Chained as a second
  // subtitles pass so it composites over the captions cleanly.
  const hookArg = opts.hookOverlayAssPath
    ? opts.hookOverlayAssPath.replace(/\\/g, "/").replace(/:/g, "\\:")
    : "";
  const hookFilter = opts.hookOverlayAssPath
    ? `,[v]subtitles='${hookArg}'[v]`
    : "";

  const vMap = "[v]";

  // Music mixing: a second input feeds [1:a] which we volume-attenuate then
  // amix with the source audio. The clip audio stays at full volume so the
  // music sits underneath.
  const hasMusic = !!opts.musicPath;
  const musicVol = Math.max(0, Math.min(1, opts.musicVolume ?? 0.25));
  const audioFilter = hasMusic
    ? `;[1:a]volume=${musicVol},aloop=loop=-1:size=2e9[mus];[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0[aout]`
    : "";
  const aMap = hasMusic ? "[aout]" : "0:a?";

  const inputs = [`-i "${opts.inputPath}"`];
  if (hasMusic) inputs.push(`-i "${opts.musicPath}"`);

  const cmd = [
    `"${bin}" -y`,
    `-ss ${opts.startTime}`,
    `-t ${duration}`,
    inputs.join(" "),
    `-filter_complex "${filterComplex}${subtitleFilter}${hookFilter}${audioFilter}"`,
    `-map ${vMap} -map ${aMap}`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `-movflags +faststart`,
    `-shortest`,
    `"${opts.outputPath}"`,
  ].join(" ");

  await execAsync(cmd, { maxBuffer: 1024 * 1024 * 50 });
}

export async function generateSRT(
  words: Array<{ word: string; start: number; end: number }>,
  style: string
): Promise<string> {
  const chunkSize = style === "minimal" ? 5 : 3;
  const lines: string[] = [];
  let index = 1;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    const text = chunk.map((w) => w.word).join(" ").trim();

    lines.push(String(index++));
    lines.push(`${toSRTTime(start)} --> ${toSRTTime(end)}`);
    lines.push(text);
    lines.push("");
  }

  return lines.join("\n");
}

function toSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, "0")}`;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function tmpPath(name: string): string {
  const dir = path.join(process.cwd(), ".tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}
