'use strict';

// Run this after `next build` and before `electron-builder`.
// Next.js standalone output omits the static files and public folder —
// they must be copied into the standalone tree manually.
//
//   .next/static   → .next/standalone/.next/static
//   public/        → .next/standalone/public

const fs   = require('fs');
const path = require('path');

const root       = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');
const staticSrc  = path.join(root, '.next', 'static');
const staticDst  = path.join(standalone, '.next', 'static');
const publicSrc  = path.join(root, 'public');
const publicDst  = path.join(standalone, 'public');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(standalone)) {
  console.error('ERROR: .next/standalone not found — run `next build` first.');
  process.exit(1);
}

console.log('Copying .next/static → standalone/.next/static …');
copyDir(staticSrc, staticDst);

console.log('Copying public/ → standalone/public …');
copyDir(publicSrc, publicDst);

console.log('Standalone is ready to package.');
