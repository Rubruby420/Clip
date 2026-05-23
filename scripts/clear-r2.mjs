/* eslint-disable no-console */
/**
 * One-off bucket cleanup.
 *
 *   list:        node --env-file=.env.local scripts/clear-r2.mjs
 *   nuke R2:     node --env-file=.env.local scripts/clear-r2.mjs --confirm
 *   R2 + DB:     node --env-file=.env.local scripts/clear-r2.mjs --confirm --db
 *
 * Lists every object in CLOUDFLARE_R2_BUCKET_NAME and, with --confirm,
 * deletes them. With --db it also drops every Project + Clip row in the
 * local SQLite DB (backed up first per CLAUDE.md gotcha).
 */

import {
  S3Client, ListObjectsV2Command, DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const ACCOUNT_ID = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const KEY_SECRET = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

if (!ACCOUNT_ID || !BUCKET || !KEY_ID || !KEY_SECRET) {
  console.error("Missing CLOUDFLARE_R2_* env vars. Did you pass --env-file=.env.local?");
  process.exit(1);
}

const confirm = process.argv.includes("--confirm");
const wipeDb = process.argv.includes("--db");

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: KEY_SECRET },
  forcePathStyle: true,
});

async function listAll() {
  const keys = [];
  let token;
  do {
    const res = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push({ key: obj.Key, size: obj.Size ?? 0 });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteAll(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000);
    await r2.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: slice.map(({ key }) => ({ Key: key })) },
    }));
    console.log(`  deleted ${Math.min(i + 1000, keys.length)} / ${keys.length}`);
  }
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  console.log(`R2 bucket: ${BUCKET}`);
  console.log(`Listing objects…`);
  const keys = await listAll();
  const totalBytes = keys.reduce((s, k) => s + k.size, 0);
  console.log(`Found ${keys.length} object(s), ${fmt(totalBytes)} total.`);

  if (keys.length > 0) {
    const byPrefix = new Map();
    for (const { key, size } of keys) {
      const prefix = key.includes("/") ? key.split("/")[0] + "/" : "(root)/";
      const cur = byPrefix.get(prefix) ?? { count: 0, bytes: 0 };
      cur.count++;
      cur.bytes += size;
      byPrefix.set(prefix, cur);
    }
    for (const [prefix, { count, bytes }] of byPrefix) {
      console.log(`  ${prefix.padEnd(20)} ${String(count).padStart(4)} obj   ${fmt(bytes)}`);
    }
  }

  if (!confirm) {
    console.log("");
    console.log("Dry run — nothing deleted. Re-run with --confirm to delete.");
    console.log("  Add --db to also drop all Project + Clip rows from the local SQLite DB.");
    return;
  }

  if (keys.length > 0) {
    console.log("\nDeleting R2 objects…");
    await deleteAll(keys);
    console.log("R2 bucket cleared.");
  }

  if (wipeDb) {
    const dbUrl = process.env.DATABASE_URL ?? "";
    const filePath = dbUrl.replace(/^file:/, "");
    if (filePath && fs.existsSync(filePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = `${filePath}.bak-${ts}`;
      fs.copyFileSync(filePath, backup);
      console.log(`\nBacked up DB → ${path.basename(backup)}`);
    }

    const prisma = new PrismaClient();
    try {
      const clipCount = await prisma.clip.deleteMany({});
      const projectCount = await prisma.project.deleteMany({});
      console.log(`Dropped ${clipCount.count} clip(s), ${projectCount.count} project(s).`);
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
