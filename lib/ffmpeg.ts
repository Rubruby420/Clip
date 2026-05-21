import { exec } from "child_process";
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

export async function getVideoDuration(videoPath: string): Promise<number> {
  const bin = ffmpegBin();
  const { stdout } = await execAsync(
    `"${bin}" -i "${videoPath}" 2>&1 | grep Duration | awk '{print $2}' | tr -d ,`
  );
  const parts = stdout.trim().split(":");
  if (parts.length !== 3) return 0;
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

export interface ExportOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  subtitlePath?: string;
  blurBackground?: boolean;
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

  const vMap = subtitleFilter ? "[v]" : "[v]";

  const cmd = [
    `"${bin}" -y`,
    `-ss ${opts.startTime}`,
    `-t ${duration}`,
    `-i "${opts.inputPath}"`,
    `-filter_complex "${filterComplex}${subtitleFilter}"`,
    `-map ${vMap} -map 0:a?`,
    `-c:v libx264 -preset fast -crf 23`,
    `-c:a aac -b:a 128k`,
    `-movflags +faststart`,
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
