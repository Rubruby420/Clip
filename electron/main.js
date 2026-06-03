'use strict';

// Electron main process for the Clip desktop app.
//
// Flow (packaged):
//   1. Read user config from {userData}/clip-config.json
//   2. Fork the Next.js standalone server (resources/app/server.js) as a
//      child process, passing config as env vars
//   3. Show a loading splash while we wait for the server to respond
//   4. Open the main BrowserWindow at http://127.0.0.1:3000
//   5. Check GitHub Releases for updates in the background
//
// Flow (development — `electron .`):
//   Run `npm run dev` first; Electron skips spawning a server and just
//   connects to the already-running Next.js on port 3000.

const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

autoUpdater.logger = log;
log.transports.file.level = 'info';

const PORT = 3000; // must match Next.js dev server lock
let mainWindow = null;
let nextServerProcess = null;

// ── Config ──────────────────────────────────────────────────────────────────

// Read API keys + storage paths from {userData}/clip-config.json.
// Sensible defaults are applied for DATABASE_URL and CLIP_STORAGE_DIR so the
// app works out of the box without any manual setup (data goes to AppData).
function loadConfig() {
  const userData = app.getPath('userData');
  const configPath = path.join(userData, 'clip-config.json');
  let saved = {};
  if (fs.existsSync(configPath)) {
    try { saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch (e) {
      log.warn('clip-config.json parse error:', e);
    }
  }
  return {
    DATABASE_URL:     `file:${path.join(userData, 'clip.db').replace(/\\/g, '/')}`,
    CLIP_STORAGE_DIR: path.join(userData, 'storage'),
    CLIP_CONFIG_PATH: configPath,
    ...saved,
  };
}

// ── Database init ────────────────────────────────────────────────────────────

// Copy the bundled template DB to userData on first launch so Prisma has a
// schema-ready database without needing the CLI at runtime.
function ensureDatabase(config) {
  const dbPath = config.DATABASE_URL.replace(/^file:/, '');
  if (!fs.existsSync(dbPath)) {
    const templatePath = app.isPackaged
      ? path.join(process.resourcesPath, 'template.db')
      : path.join(__dirname, '..', 'resources', 'template.db');
    if (fs.existsSync(templatePath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.copyFileSync(templatePath, dbPath);
      log.info('Initialised database from template:', dbPath);
    } else {
      log.warn('template.db not found — database will be empty');
    }
  }
}

// ── Next.js server ───────────────────────────────────────────────────────────

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app', 'server.js');
  }
  return null; // dev: user runs `npm run dev` separately
}

function spawnNextServer(config) {
  const serverPath = getServerPath();
  if (!serverPath) return; // dev mode — nothing to spawn

  const env = {
    ...process.env,
    ...config,
    PORT:     String(PORT),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  };

  nextServerProcess = fork(serverPath, [], {
    env,
    cwd:    path.dirname(serverPath),
    silent: true, // suppress server stdout/stderr in packaged app
  });

  nextServerProcess.stdout?.on('data', (d) => log.info('[next]', d.toString().trimEnd()));
  nextServerProcess.stderr?.on('data', (d) => log.warn('[next]', d.toString().trimEnd()));
  nextServerProcess.on('error', (err) => log.error('Next.js server error:', err));
}

function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function poll() {
      if (Date.now() > deadline) {
        reject(new Error(`Next.js server did not respond within ${timeoutMs / 1000}s`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(poll, 600));
      req.setTimeout(500, () => { req.destroy(); setTimeout(poll, 600); });
    })();
  });
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 360, height: 170,
    frame: false, resizable: false,
    backgroundColor: '#0a0a0a',
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;height:100vh;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:14px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-app-region:drag}
.logo{width:48px;height:48px;background:#7c5af3;border-radius:13px;display:flex;
  align-items:center;justify-content:center;font-weight:800;font-size:22px;color:#fff;
  letter-spacing:-.5px;flex-shrink:0}
p{color:#6b7280;font-size:13px;letter-spacing:.015em}
</style></head><body>
<div class="logo">C</div>
<p>Starting Clip…</p>
</body></html>`)
  );
  return win;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 960, minHeight: 600,
    backgroundColor: '#0a0a0a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open all target=_blank / window.open links in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  Menu.setApplicationMenu(null);
}

// ── Auto-updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload       = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => log.warn('Auto-updater error (non-fatal):', err));

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info.version);
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type:      'info',
      title:     'Clip — Update Ready',
      message:   `Version ${info.version} is ready to install.`,
      detail:    'Clip will restart and apply the update.',
      buttons:   ['Restart now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    }).catch(() => {});
  });

  // Check on startup, then every 4 hours.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const config = loadConfig();
  const loading = createLoadingWindow();

  try {
    ensureDatabase(config);
    spawnNextServer(config);
    await waitForServer();
    loading.close();
    createMainWindow();
    if (app.isPackaged) setupAutoUpdater();
  } catch (err) {
    loading.close();
    log.error('Startup failed:', err);
    await dialog.showErrorBox('Clip failed to start', String(err));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (nextServerProcess) { nextServerProcess.kill(); nextServerProcess = null; }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (nextServerProcess) { nextServerProcess.kill(); nextServerProcess = null; }
});

app.on('activate', () => {
  if (!mainWindow && app.isReady()) createMainWindow();
});
