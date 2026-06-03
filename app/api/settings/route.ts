import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

type ConfigKey = "OPENAI_API_KEY" | "ASSEMBLYAI_API_KEY" | "YOUTUBE_API_KEY" | "JAMENDO_CLIENT_ID";

const KEYS: ConfigKey[] = [
  "OPENAI_API_KEY",
  "ASSEMBLYAI_API_KEY",
  "YOUTUBE_API_KEY",
  "JAMENDO_CLIENT_ID",
];

function mask(value: string | undefined): string {
  if (!value || value.length < 8) return "";
  return "••••••••" + value.slice(-4);
}

export async function GET() {
  const result = {} as Record<ConfigKey, string>;
  for (const key of KEYS) result[key] = mask(process.env[key]);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const configPath = process.env.CLIP_CONFIG_PATH;
  if (!configPath) {
    return NextResponse.json(
      { error: "Settings can only be saved from the packaged app. Edit .env.local directly in dev mode." },
      { status: 400 }
    );
  }

  const body = (await request.json()) as Partial<Record<ConfigKey, string>>;

  let existing: Record<string, string> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch {}
  }

  for (const key of KEYS) {
    const val = body[key]?.trim();
    if (val) existing[key] = val;
  }

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");
  } catch {
    return NextResponse.json({ error: "Failed to write config file." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
