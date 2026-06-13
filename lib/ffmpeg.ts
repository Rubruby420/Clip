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

export async function extractAudio(videoPath: string, outputPath: string, prependSilenceMs = 0): Promise<void> {
  const bin = ffmpegBin();
  if (prependSilenceMs > 0) {
    // Prepend silence so Whisper doesn't clip the very first word — a known
    // Whisper quirk where the first utterance is sometimes missed when audio
    // starts immediately at t=0. Caller must subtract prependSilenceMs/1000
    // from all returned word timestamps.
    await execAsync(
      `"${bin}" -y -i "${videoPath}" -vn -af "aformat=channel_layouts=mono,adelay=${prependSilenceMs}" -ar 16000 -b:a 64k "${outputPath}"`,
    );
  } else {
    await execAsync(`"${bin}" -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${outputPath}"`);
  }
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
// untouched. ultrafast/crf 26 keeps the encode cheap; faststart lets the
// browser stream before the file is fully downloaded.
//
// HARD TIMEOUT: a huge 4K source (e.g. a 15 GB DJI file) can make this encode
// effectively never finish, and it once wedged the whole processing pipeline.
// We spawn ffmpeg directly (NOT via exec/cmd.exe, which on Windows can orphan
// the child when killed) and SIGKILL it after `timeoutMs`. Callers treat a
// rejection as non-fatal and fall back to the original video.
export async function generatePreviewProxy(
  videoPath: string,
  outputPath: string,
  timeoutMs: number = 8 * 60 * 1000,
): Promise<void> {
  const bin = ffmpegBin();
  const args = [
    "-y",
    // Offload decode to the GPU. The bottleneck on big sources is decoding 4K
    // (often 10-bit HEVC at 60fps) — encoding a 720p proxy is cheap. `auto`
    // picks dxva2/d3d11va/cuda/qsv and falls back to software if none work, so
    // this is strictly safer/faster. Without it, a 4K HEVC source can never
    // finish on CPU and just times out below.
    "-hwaccel", "auto",
    "-i", videoPath,
    // Downscale to 720p, cap to 30fps, force 8-bit so a 60fps/10-bit source
    // becomes a light, broadly-playable proxy.
    "-vf", "scale=-2:720,fps=30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let timedOut = false;
    let stderrTail = "";
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr?.on("data", (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Proxy encode timed out after ${Math.round(timeoutMs / 1000)}s`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg proxy exited with code ${code}: ${stderrTail.slice(-400)}`));
      }
    });
  });
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
  onProgress?: (pct: number) => void; // called with 0-99 during encode, 100 on done
  logoPath?: string;
  logoPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoSize?: number;    // 5-40, percentage of video width
  logoOpacity?: number; // 0.1-1
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

  // Logo overlay: scale to `logoSize`% of width, apply opacity, composite
  // over the composed video at the requested corner position.
  const hasLogo = !!opts.logoPath;
  const hasMusic = !!opts.musicPath;
  const logoIdx = hasMusic ? 2 : 1; // logo input comes after music (if any)
  const logoW = Math.round(targetW * ((opts.logoSize ?? 15) / 100));
  const logoPad = 10;
  const logoPosMap: Record<string, string> = {
    "top-left":     `${logoPad}:${logoPad}`,
    "top-right":    `W-w-${logoPad}:${logoPad}`,
    "bottom-left":  `${logoPad}:H-h-${logoPad}`,
    "bottom-right": `W-w-${logoPad}:H-h-${logoPad}`,
  };
  const logoPosStr = logoPosMap[opts.logoPosition ?? "bottom-right"];
  const logoOpacity = Math.max(0.1, Math.min(1, opts.logoOpacity ?? 0.9));
  const logoFilter = hasLogo
    ? `;[${logoIdx}:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=${logoOpacity}[logo];[v][logo]overlay=${logoPosStr}[v]`
    : "";

  const vMap = "[v]";

  // Music mixing: a second input feeds [1:a] which we volume-attenuate then
  // amix with the source audio. The clip audio stays at full volume so the
  // music sits underneath.
  const musicVol = Math.max(0, Math.min(1, opts.musicVolume ?? 0.25));
  const audioFilter = hasMusic
    ? `;[1:a]volume=${musicVol},aloop=loop=-1:size=2e9[mus];[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0[aout]`
    : "";
  const aMap = hasMusic ? "[aout]" : "0:a?";

  // Build args array (spawn — no shell quoting needed).
  const args: string[] = [
    "-y",
    "-ss", String(opts.startTime),
    "-t", String(duration),
    "-i", opts.inputPath,
  ];
  if (hasMusic) args.push("-i", opts.musicPath!);
  if (hasLogo) args.push("-i", opts.logoPath!);
  args.push(
    "-filter_complex", `${filterComplex}${subtitleFilter}${hookFilter}${logoFilter}${audioFilter}`,
    "-map", vMap,
    "-map", aMap,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    "-shortest",
    "-progress", "pipe:1", // machine-readable progress to stdout
    "-nostats",             // suppress human-readable stats on stderr
    opts.outputPath,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderrBuf = "";

    child.stdout?.on("data", (d: Buffer) => {
      // FFmpeg -progress writes key=value pairs; out_time_ms is microseconds.
      const text = d.toString();
      const m = text.match(/out_time_ms=(\d+)/);
      if (m && opts.onProgress && duration > 0) {
        const outSec = parseInt(m[1], 10) / 1_000_000;
        const pct = Math.min(99, Math.round((outSec / duration) * 100));
        opts.onProgress(pct);
      }
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderrBuf = (stderrBuf + d.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        opts.onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`ffmpeg export exited with code ${code}: ${stderrBuf.slice(-400)}`));
      }
    });
  });
}

// Render a spliced clip: an ordered list of source-time segments stitched
// into one mp4. Two steps so the concat is reliable on Windows:
//   1. Trim each segment to its own temp mp4, RE-ENCODED with identical
//      codec/resolution/fps/sample-rate params (and the same scale/pad as a
//      normal export) — `-ss`/`-t` AFTER `-i` for frame-accurate cut points.
//   2. Stitch with the concat demuxer + stream copy (safe because every part
//      shares params).
// v1 renders video+audio only — no captions/overlays/music (deferred).
export async function exportSplicedClip(opts: {
  inputPath: string;
  outputPath: string;
  segments: { start: number; end: number }[];
  aspectRatio: "9:16" | "16:9" | "1:1";
  blurBackground?: boolean;
  onSegmentProgress?: (segIdx: number, segPct: number) => void;
}): Promise<void> {
  const bin = ffmpegBin();
  const targetW = opts.aspectRatio === "16:9" ? 1920 : 1080;
  const targetH = opts.aspectRatio === "16:9" ? 1080 : opts.aspectRatio === "9:16" ? 1920 : 1080;

  const filter = opts.blurBackground
    ? [
        `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:5[bg]`,
        `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2[v]`,
      ].join(";")
    : `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black[v]`;

  const partPaths: string[] = [];
  const token = Math.random().toString(36).slice(2, 8);
  try {
    // 1. Encode each segment to a uniform temp part.
    for (let i = 0; i < opts.segments.length; i++) {
      const seg = opts.segments[i];
      const dur = Math.max(0.05, seg.end - seg.start);
      const part = tmpPath(`splice_${token}_${i}.mp4`);
      partPaths.push(part);
      const segArgs = [
        "-y",
        "-i", opts.inputPath,
        "-ss", String(seg.start),
        "-t", String(dur),
        "-filter_complex", filter,
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-r", "30",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-movflags", "+faststart",
        "-progress", "pipe:1",
        "-nostats",
        part,
      ];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(bin, segArgs, { windowsHide: true });
        let stderrBuf = "";
        child.stdout?.on("data", (d: Buffer) => {
          const m = d.toString().match(/out_time_ms=(\d+)/);
          if (m && opts.onSegmentProgress) {
            const outSec = parseInt(m[1], 10) / 1_000_000;
            const pct = Math.min(99, Math.round((outSec / dur) * 100));
            opts.onSegmentProgress(i, pct);
          }
        });
        child.stderr?.on("data", (d: Buffer) => { stderrBuf = (stderrBuf + d.toString()).slice(-2000); });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) { opts.onSegmentProgress?.(i, 100); resolve(); }
          else reject(new Error(`ffmpeg splice seg ${i} exited ${code}: ${stderrBuf.slice(-400)}`));
        });
      });
    }

    // 2. Concat-demuxer stitch (stream copy — parts share params).
    const listPath = tmpPath(`splice_${token}.txt`);
    const listBody = partPaths
      .map((p) => `file '${p.replace(/\\/g, "/")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listBody);
    try {
      await execAsync(
        `"${bin}" -y -f concat -safe 0 -i "${listPath}" -c copy -movflags +faststart "${opts.outputPath}"`,
        { maxBuffer: 1024 * 1024 * 50 },
      );
    } finally {
      try { fs.unlinkSync(listPath); } catch {}
    }
  } finally {
    partPaths.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
  }
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

// ---------------------------------------------------------------------------
// Thumbnail generator helpers
// ---------------------------------------------------------------------------

/** Extract N candidate frames from a clip at the given time offsets (seconds). */
export async function extractCandidateFrames(
  videoPath: string,
  times: number[],
  outDir: string
): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const outPath = path.join(outDir, `frame-${i}.jpg`);
    await extractThumbnail(videoPath, outPath, times[i]);
    paths.push(outPath);
  }
  return paths;
}

/** Probe an image file's pixel dimensions. Falls back to 1280×720 on any error. */
async function getImageDimensions(imgAbs: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin(), ["-i", imgAbs], { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", () => {
      // Match "1920x1080" style dimensions in the video stream line.
      const m = stderr.match(/,\s*(\d{2,5})x(\d{2,5})[,\s]/);
      if (m) resolve({ w: parseInt(m[1], 10), h: parseInt(m[2], 10) });
      else resolve({ w: 1280, h: 720 });
    });
  });
}

export interface ThumbnailTextRecipe {
  headline: string;
  subText?: string;
  fontName: string;
  fontSizePct: number;   // % of image height, e.g. 12
  textColor: string;     // hex e.g. "#FFFFFF"
  strokeColor: string;   // hex e.g. "#000000"
  position: { v: "top" | "center" | "bottom"; h: "left" | "center" | "right" };
  cropFocus?: { x: number; y: number; zoom: number };
}

/** Convert a #RRGGBB hex colour to an ASS &H00BBGGRR colour string. */
function hexToAss(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/**
 * Build a minimal ASS subtitle file that renders a headline (and optional
 * sub-text line) as a single static overlay for a 2-second window starting
 * at t=0. Used by renderThumbnailStill.
 */
export function generateThumbnailAss(recipe: ThumbnailTextRecipe, videoW: number, videoH: number): string {
  const fontSize = Math.round(videoH * (recipe.fontSizePct / 100));
  const subFontSize = Math.round(fontSize * 0.55);
  const marginEdge = Math.round(videoH * 0.06);
  const primaryColour = hexToAss(recipe.textColor);
  const outlineColour = hexToAss(recipe.strokeColor);
  const outline = Math.max(2, Math.round(fontSize * 0.08));

  // ASS alignment integers: (v row) * 3 + (h col), 1-indexed
  // top-left=7, top-center=8, top-right=9
  // mid-left=4, mid-center=5, mid-right=6
  // bot-left=1, bot-center=2, bot-right=3
  const alignMap: Record<string, Record<string, number>> = {
    top:    { left: 7, center: 8, right: 9 },
    center: { left: 4, center: 5, right: 6 },
    bottom: { left: 1, center: 2, right: 3 },
  };
  const alignment = alignMap[recipe.position.v]?.[recipe.position.h] ?? 2;

  const marginV = recipe.position.v === "center" ? 0 : marginEdge;
  const marginH = recipe.position.h === "center" ? 0 : marginEdge;
  const marginL = recipe.position.h === "left"  ? marginH : 0;
  const marginR = recipe.position.h === "right" ? marginH : 0;

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
  lines.push(
    `Style: Headline,${recipe.fontName},${fontSize},${primaryColour},${outlineColour},&H00000000,1,0,0,0,100,100,0,0,1,${outline},2,${alignment},${marginL},${marginR},${marginV},1`
  );
  lines.push(
    `Style: Sub,${recipe.fontName},${subFontSize},${primaryColour},${outlineColour},&H00000000,0,0,0,0,100,100,0,0,1,${Math.max(1, Math.round(outline * 0.6))},1,${alignment},${marginL},${marginR},${marginV + subFontSize + Math.round(videoH * 0.01)},1`
  );
  lines.push("");
  lines.push("[Events]");
  lines.push("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");

  const safe = (s: string) => s.replace(/[{}]/g, "").replace(/[\r\n]+/g, " ").trim();

  if (recipe.headline?.trim()) {
    lines.push(`Dialogue: 0,0:00:00.00,0:00:02.00,Headline,,0,0,0,,${safe(recipe.headline)}`);
  }
  if (recipe.subText?.trim()) {
    lines.push(`Dialogue: 0,0:00:00.00,0:00:02.00,Sub,,0,0,0,,${safe(recipe.subText)}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Burn a text overlay onto a still image using FFmpeg.
 * Treats the JPG/PNG as a 1-frame looped video, applies the ASS subtitle
 * (which is active from t=0), then extracts the single output frame.
 * The `:` escape Windows gotcha is handled here (same as exportClip).
 */
export async function renderThumbnailStill(
  baseImgAbs: string,
  recipe: ThumbnailTextRecipe,
  outAbs: string
): Promise<void> {
  const bin = ffmpegBin();

  // Generate ASS in a temp file
  const { w, h } = await getImageDimensions(baseImgAbs);
  const assContent = generateThumbnailAss(recipe, w, h);
  const assPath = tmpPath(`thumb-ass-${Date.now()}.ass`);
  fs.writeFileSync(assPath, assContent, "utf-8");

  // Escape the ASS path for the subtitles= filter (Windows colon gotcha)
  const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");

  // Optional crop-to-focus filter (zoom in on the subject's face/center)
  let cropFilter = "";
  if (recipe.cropFocus && recipe.cropFocus.zoom > 1) {
    const z = recipe.cropFocus.zoom.toFixed(4);
    const fx = recipe.cropFocus.x.toFixed(4);
    const fy = recipe.cropFocus.y.toFixed(4);
    // Scale up then crop back to original size centered on the focal point
    cropFilter = `scale=iw*${z}:ih*${z},crop=iw/${z}:ih/${z}:iw*(${z}-1)*${fx}/${z}:ih*(${z}-1)*${fy}/${z},`;
  }

  const vf = `${cropFilter}subtitles='${escapedAss}'`;

  await execAsync(
    `"${bin}" -y -loop 1 -t 2 -i "${baseImgAbs}" -vf "${vf}" -frames:v 1 -q:v 2 "${outAbs}"`
  );

  // Clean up the temporary ASS file
  try { fs.unlinkSync(assPath); } catch {}
}
