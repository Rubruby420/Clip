'use strict';

// Minimal preload — Clip is a full web app; no IPC bridge needed yet.
// Exposes the desktop flag so the UI can optionally hide browser-specific hints.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('clipDesktop', {
  isDesktop: true,
  platform:  process.platform,
});
