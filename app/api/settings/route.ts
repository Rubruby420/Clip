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

// Update a .env.local file in-place, adding or replacing KEY=value lines.
function updateEnvLocal(filePath: string, updates: Record<string, string>) {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8").split("\n")
    : [];
  const touched = new Set<string>();
  const result = lines.map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] in updates) {
      touched.add(m[1]);
      return `${m[1]}=${updates[m[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!touched.has(key)) result.push(`${key}=${value}`);
  }
  // Trim trailing blank lines then add one newline at end.
  const trimmed = result.join("\n").replace(/\n+$/, "");
  fs.writeFileSync(filePath, trimmed + "\n", "utf-8");
}

export async function POST(request: Request) {
  let body: Partial<Record<ConfigKey, string>>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const configPath = process.env.CLIP_CONFIG_PATH;

  if (configPath) {
    // Packaged Electron app — write to clip-config.json.
    let existing: Record<string, string> = {};
    if (fs.existsSync(configPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      } catch (e) {
        console.error("clip-config.json parse error — overwriting with new values:", e);
      }
    }
    for (const key of KEYS) {
      const val = body[key];
      if (typeof val === "string" && val.trim()) existing[key] = val.trim();
    }
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");
    } catch {
      return NextResponse.json({ error: "Failed to write config file." }, { status: 500 });
    }
  } else {
    // Dev mode — write to .env.local so the dev server picks them up on restart.
    const envPath = path.join(process.cwd(), ".env.local");
    const updates: Record<string, string> = {};
    for (const key of KEYS) {
      const val = body[key];
      if (typeof val === "string" && val.trim()) updates[key] = val.trim();
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No values provided." }, { status: 400 });
    }
    try {
      updateEnvLocal(envPath, updates);
    } catch {
      return NextResponse.json({ error: "Failed to write .env.local." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
