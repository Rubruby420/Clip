import { spawn } from "child_process";

function ffmpegBin(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("ffmpeg-static") as string;
  } catch {
    return "ffmpeg";
  }
}

// Generate a normalized peak array from an audio file. ffmpeg streams
// signed-16-bit little-endian mono PCM at 8 kHz to stdout — small enough
// to buffer in memory for hour-long sources (~57 MB/hr). The samples are
// binned into `peakCount` equal-width buckets; per bucket we keep the
// max absolute amplitude, then normalize to 0..1.
//
// The result is what the WaveformTimeline renders — one vertical bar per
// peak — so 2000 buckets is plenty for the editor's display width.
export async function generatePeaks(
  audioPath: string,
  peakCount = 2000
): Promise<number[]> {
  const bin = ffmpegBin();
  const args = [
    "-i", audioPath,
    "-f", "s16le",
    "-ar", "8000",
    "-ac", "1",
    "-",
  ];

  const samples = await new Promise<Int16Array>((resolve, reject) => {
    const proc = spawn(bin, args);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr.on("data", () => { /* ffmpeg writes progress to stderr; ignore */ });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`ffmpeg exited ${code} while extracting PCM`));
        return;
      }
      const buf = Buffer.concat(chunks);
      // Wrap as Int16Array — note byteOffset/byteLength must align on 2.
      const aligned = buf.byteLength % 2 === 0 ? buf : buf.subarray(0, buf.byteLength - 1);
      resolve(new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2));
    });
  });

  if (samples.length === 0) return [];

  const bucketSize = Math.max(1, Math.floor(samples.length / peakCount));
  const peaks: number[] = [];
  for (let i = 0; i < peakCount; i++) {
    const start = i * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = samples[j] < 0 ? -samples[j] : samples[j];
      if (v > max) max = v;
    }
    peaks.push(max);
  }

  // Normalize to 0..1 against the loudest peak so quiet sources still
  // render visibly. (Absolute calibration isn't useful for a UI bar.)
  const maxPeak = peaks.reduce((m, v) => (v > m ? v : m), 1);
  return peaks.map((p) => +(p / maxPeak).toFixed(4));
}
