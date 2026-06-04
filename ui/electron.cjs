'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut, shell, screen,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const zlib  = require('zlib');
const https = require('https');
const { spawn, execSync } = require('child_process');

app.name = 'TheMouse.app';
if (process.platform === 'win32') {
  app.setAppUserModelId('app.themouse');
}

/* ── constants ─────────────────────────────────────────────────── */
const isDev   = !app.isPackaged;
const APP_DIR = isDev
  ? path.join(__dirname, '..', 'Source', 'themouseapp', 'x64', 'Release')
  : path.join(process.resourcesPath, 'app');

const MAIN_EXE      = path.join(APP_DIR, 'themouseapp.exe');
const INSTALLER_EXE = path.join(APP_DIR, 'install-interception.exe');
const GITHUB_REPO = process.env.THEMOUSE_GITHUB_REPO || 'DevTheDiv/the.mouse.app';
const PROFILES_SCHEMA_VERSION = 1;
const DEFAULT_PROFILE_PREV_HOTKEY = 'Alt+Shift+Left';
const DEFAULT_PROFILE_NEXT_HOTKEY = 'Alt+Shift+Right';
let startupUpdateNoticeShownFor = null;

function parseSemverLike(input) {
  const m = String(input || '').trim().match(/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
  };
}

function compareSemverLike(a, b) {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': `TheMouse.app/${app.getVersion()}`,
        Accept: 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location).then(resolve).catch(reject);
        return;
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Update check failed (${res.statusCode})`));
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid release response from GitHub'));
        }
      });
    });

    req.setTimeout(10000, () => req.destroy(new Error('Update check timed out')));
    req.on('error', reject);
  });
}

async function getLatestReleaseInfo() {
  const currentVersion = app.getVersion();
  const api = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const release = await fetchJson(api);

  const tag = String(release?.tag_name || release?.name || '').trim();
  const latestVersion = tag.replace(/^v/i, '');
  const releaseUrl = String(release?.html_url || `https://github.com/${GITHUB_REPO}/releases`);
  const exeAsset = Array.isArray(release?.assets)
    ? release.assets.find((a) => /\.exe$/i.test(String(a?.name || '')))
    : null;
  const downloadUrl = exeAsset?.browser_download_url || releaseUrl;

  const parsedCurrent = parseSemverLike(currentVersion);
  const parsedLatest = parseSemverLike(latestVersion);
  const updateAvailable = parsedCurrent && parsedLatest
    ? compareSemverLike(parsedLatest, parsedCurrent) > 0
    : latestVersion && latestVersion !== currentVersion;

  return {
    currentVersion,
    latestVersion,
    latestTag: tag,
    releaseName: String(release?.name || ''),
    releaseUrl,
    downloadUrl,
    publishedAt: String(release?.published_at || ''),
    repo: GITHUB_REPO,
    updateAvailable,
  };
}

async function checkForStartupUpdate() {
  if (isDev) return;

  try {
    const info = await getLatestReleaseInfo();
    if (!info?.updateAvailable) return;
    if (startupUpdateNoticeShownFor === info.latestVersion) return;

    startupUpdateNoticeShownFor = info.latestVersion;
    showAppNotification('Update Available', `Version ${info.latestVersion} is available to download.`);
  } catch (e) {
    console.error('Startup update check failed', e);
  }
}

// In packaged builds, write settings to userData so they survive updates
// and are always writable regardless of install location.
function getSettingsPath() {
  if (isDev) return path.join(APP_DIR, 'settings.ini');
  const destDir = app.getPath('userData');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  
  const dest = path.join(destDir, 'settings.ini');
  if (!fs.existsSync(dest)) {
    const src = path.join(APP_DIR, 'settings.ini');
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
  return dest;
}

function getProfilesPath() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'profiles.json');
}

function defaultProfilesStore() {
  return {
    schemaVersion: PROFILES_SCHEMA_VERSION,
    activeProfileId: null,
    profiles: [],
    presets: [],
  };
}

function readProfilesStore() {
  const p = getProfilesPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      schemaVersion: raw?.schemaVersion || PROFILES_SCHEMA_VERSION,
      activeProfileId: raw?.activeProfileId || null,
      profiles: Array.isArray(raw?.profiles) ? raw.profiles : [],
      presets: Array.isArray(raw?.presets) ? raw.presets : [],
    };
  } catch (e) {
    console.error('Failed to parse profiles store', e);
    return null;
  }
}

function writeProfilesStore(store) {
  try {
    fs.writeFileSync(getProfilesPath(), JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to write profiles store', e);
    return false;
  }
}

function readAccelCurveFile() {
  const p = getAccelCurvePath();
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeAccelCurveFile(curve) {
  fs.writeFileSync(getAccelCurvePath(), JSON.stringify(curve, null, 2), 'utf8');
  writeAccelLut(curve.enabled, curve.multiCurve, curve.maxSpeed, curve.lutX, curve.lutY);
}

function createProfileFromRuntime(name = 'Default') {
  const now = new Date().toISOString();
  return {
    id: `profile-${Date.now()}`,
    name,
    createdAt: now,
    updatedAt: now,
    settings: readSettings(),
    accelCurve: readAccelCurveFile(),
    source: 'migrated_from_ini',
  };
}

function ensureProfilesStore() {
  let store = readProfilesStore() || defaultProfilesStore();

  if (!Array.isArray(store.profiles) || store.profiles.length === 0) {
    const migrated = createProfileFromRuntime('Default');
    store.profiles = [migrated];
    store.activeProfileId = migrated.id;
    store.schemaVersion = PROFILES_SCHEMA_VERSION;
    writeProfilesStore(store);
    return store;
  }

  if (!store.activeProfileId || !store.profiles.find((p) => p.id === store.activeProfileId)) {
    store.activeProfileId = store.profiles[0].id;
  }

  if (!Array.isArray(store.presets)) store.presets = [];
  if (!store.schemaVersion) store.schemaVersion = PROFILES_SCHEMA_VERSION;
  writeProfilesStore(store);
  return store;
}

function getActiveProfile(store) {
  if (!store || !Array.isArray(store.profiles) || store.profiles.length === 0) return null;
  return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0];
}

function listModulePresets(moduleKey) {
  const store = ensureProfilesStore();
  return (store.presets || []).filter((p) => p.module === moduleKey);
}

function saveModulePreset(moduleKey, name, payload) {
  const store = ensureProfilesStore();
  const now = new Date().toISOString();
  const preset = {
    id: `preset-${Date.now()}`,
    module: moduleKey,
    name: String(name || '').trim() || 'Untitled Preset',
    payload,
    createdAt: now,
    updatedAt: now,
  };
  store.presets.push(preset);
  writeProfilesStore(store);
  return preset;
}

function deleteModulePreset(moduleKey, presetId) {
  const store = ensureProfilesStore();
  const before = store.presets.length;
  store.presets = store.presets.filter((p) => !(p.module === moduleKey && p.id === presetId));
  if (store.presets.length === before) return false;
  writeProfilesStore(store);
  return true;
}

function isNotificationsEnabled() {
  const store = ensureProfilesStore();
  const active = getActiveProfile(store);
  const raw = active?.settings?.Notifications_Enabled;
  if (raw === undefined || raw === null || raw === '') return true;
  if (typeof raw === 'boolean') return raw;
  return String(raw) !== '0';
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let noticeWindow = null;
let noticeCloseTimer = null;

function showAppNotification(title, body) {
  if (!isNotificationsEnabled()) return;

  if (noticeCloseTimer) {
    clearTimeout(noticeCloseTimer);
    noticeCloseTimer = null;
  }

  if (noticeWindow && !noticeWindow.isDestroyed()) {
    noticeWindow.close();
    noticeWindow = null;
  }

  const safeTitle = escapeHtml(title || 'Notice');
  const safeBody = escapeHtml(body || '');
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      font-family: "Segoe UI", "Inter", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wrap {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      border-radius: 12px;
      border: 1px solid rgba(0, 229, 255, 0.28);
      background: rgba(8, 13, 18, 0.94);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
      padding: 11px 13px;
      animation: enter 170ms ease-out;
    }
    .title {
      color: #00e5ff;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.78px;
      font-weight: 700;
      margin-bottom: 4px;
      line-height: 1;
    }
    .body {
      color: #d7e7ed;
      font-size: 13px;
      line-height: 1.34;
      white-space: normal;
      word-wrap: break-word;
    }
    @keyframes enter {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">${safeTitle}</div>
    <div class="body">${safeBody}</div>
  </div>
</body>
</html>`;

  const wnd = new BrowserWindow({
    width: 320,
    height: 92,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: false,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  noticeWindow = wnd;

  wnd.setAlwaysOnTop(true, 'screen-saver');
  wnd.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  wnd.setIgnoreMouseEvents(true);

  wnd.once('ready-to-show', () => {
    const display = screen.getPrimaryDisplay();
    const { x, y, width } = display.workArea;
    const margin = 14;
    const nx = Math.round(x + width - 320 - margin);
    const ny = Math.round(y + margin);
    if (!wnd.isDestroyed()) {
      wnd.setPosition(nx, ny, false);
      wnd.showInactive();
    }
  });

  wnd.on('closed', () => {
    if (noticeWindow === wnd) {
      noticeWindow = null;
    }
  });

  wnd.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  noticeCloseTimer = setTimeout(() => {
    if (!wnd.isDestroyed()) wnd.close();
    if (noticeWindow === wnd) {
      noticeWindow = null;
    }
    noticeCloseTimer = null;
  }, 2600);
}

function emitProfileChanged(profile) {
  mainWindow?.webContents.send('profile-changed', {
    activeProfileId: profile?.id || null,
    name: profile?.name || '',
  });
}

async function restartAppIfRunningInternal() {
  if (processStatus === 'running') {
    stopApp({ notify: false });
    await new Promise((resolve) => setTimeout(resolve, 500));
    startApp({ notify: false });
  }
}

async function switchActiveProfile(profileId, options = {}) {
  const { notify = true, restartIfRunning = false } = options;
  const store = ensureProfilesStore();
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) {
    return { success: false, error: 'Profile not found' };
  }

  store.activeProfileId = profileId;
  writeProfilesStore(store);
  syncActiveProfileToRuntime();
  setTimeout(() => {
    try {
      refreshShortcuts();
    } catch (e) {
      console.error('Failed to refresh shortcuts after profile switch', e);
    }
  }, 0);

  if (restartIfRunning) {
    await restartAppIfRunningInternal();
  }

  emitProfileChanged(profile);
  if (notify) {
    showAppNotification('Profile Switched', `Active profile: ${profile.name || 'Unknown'}`);
  }

  return { success: true, activeProfileId: profile.id };
}

async function cycleProfile(direction) {
  const store = ensureProfilesStore();
  if (!Array.isArray(store.profiles) || store.profiles.length < 2) return;

  const currentIndex = Math.max(0, store.profiles.findIndex((p) => p.id === store.activeProfileId));
  const nextIndex = (currentIndex + direction + store.profiles.length) % store.profiles.length;
  const nextProfile = store.profiles[nextIndex];
  if (!nextProfile || nextProfile.id === store.activeProfileId) return;

  await switchActiveProfile(nextProfile.id, { notify: true, restartIfRunning: true });
}

function syncActiveProfileToRuntime() {
  const store = ensureProfilesStore();
  const active = getActiveProfile(store);
  if (!active) return false;

  writeSettings(active.settings || {});

  try {
    if (active.accelCurve) {
      writeAccelCurveFile(active.accelCurve);
    } else {
      const curvePath = getAccelCurvePath();
      const lutPath = getAccelLutPath();
      if (fs.existsSync(curvePath)) fs.unlinkSync(curvePath);
      if (fs.existsSync(lutPath)) fs.unlinkSync(lutPath);
    }
  } catch (e) {
    console.error('Failed to sync accel data for active profile', e);
  }

  return true;
}

let mainWindow    = null;
let tray          = null;
let childProcess  = null;
let processStatus = 'stopped';
let startTime     = null;

/* ── minimal inline PNG generator (no external deps) ───────────── */
function crc32(buf) {
  const t = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb   = Buffer.from(type, 'ascii');
  const crcv = Buffer.alloc(4); crcv.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crcv]);
}

function makePNG(size, r, g, b) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(1 + size * 3);
  row[0] = 0;
  for (let x = 0; x < size; x++) { row[1+x*3]=r; row[2+x*3]=g; row[3+x*3]=b; }
  const raw  = Buffer.concat(Array(size).fill(row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ── accel curve helpers ───────────────────────────────────────── */
function getAccelCurvePath() {
  return path.join(path.dirname(getSettingsPath()), 'accel_curve.json');
}

function getAccelLutPath() {
  return path.join(path.dirname(getSettingsPath()), 'accel_lut.bin');
}

function writeAccelLut(enabled, multiCurve, maxSpeed, lutX, lutY) {
  const isMulti = multiCurve ? 1 : 0;
  const flag = (enabled ? 1 : 0) | (isMulti ? 2 : 0);
  const count = lutX.length;
  const size = isMulti ? 12 + (count * 2) * 4 : 12 + count * 4;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(flag, 0);
  buf.writeFloatLE(maxSpeed, 4);
  buf.writeUInt32LE(count, 8);
  for (let i = 0; i < count; i++) buf.writeFloatLE(lutX[i], 12 + i * 4);
  if (isMulti && lutY) {
    for (let i = 0; i < count; i++) buf.writeFloatLE(lutY[i], 12 + count * 4 + i * 4);
  }
  fs.writeFileSync(getAccelLutPath(), buf);
}

/* ── settings.ini helpers ──────────────────────────────────────── */
function readSettings() {
  const p = getSettingsPath();
  try {
    const text = fs.readFileSync(p, 'utf8');
    const out  = {};
    for (const line of text.split(/\r?\n/)) {
      const t  = line.trim();
      if (!t || t.startsWith(';') || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq !== -1) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    // If we got nothing but expected something, the file might be corrupted
    if (Object.keys(out).length === 0 && !isDev) {
      throw new Error('Empty settings');
    }
    return out;
  } catch (e) {
    console.error(`Failed to read settings at ${p}, attempting recovery...`, e);
    // Recovery: Try to copy from template again if not in dev
    if (!isDev) {
      const src = path.join(APP_DIR, 'settings.ini');
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, p);
          // Simple manual parse of the freshly copied file to avoid infinite recursion
          const text = fs.readFileSync(p, 'utf8');
          const out = {};
          for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith(';') || t.startsWith('#')) continue;
            const eq = t.indexOf('=');
            if (eq !== -1) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
          }
          return out;
        } catch (e2) { console.error('Recovery failed', e2); }
      }
    }
    return {};
  }
}

function writeSettings(settings) {
  try {
    const text = Object.entries(settings).map(([k, v]) => {
      let val = v;
      if (typeof v === 'boolean') val = v ? '1' : '0';
      return `${k} = ${val}`;
    }).join('\r\n');
    fs.writeFileSync(getSettingsPath(), text);
    return true;
  } catch (e) {
    console.error('Failed to write settings', e);
    return false;
  }
}

function migrateSettings() {
  const dest = path.join(app.getPath('userData'), 'settings.ini');
  const src  = path.join(APP_DIR, 'settings.ini');
  
  if (isDev || !fs.existsSync(dest) || !fs.existsSync(src)) return;

  try {
    const parse = (p) => {
      const text = fs.readFileSync(p, 'utf8');
      const obj = {};
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith(';') || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq !== -1) obj[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      }
      return obj;
    };

    const userSettings = parse(dest);
    const templateSettings = parse(src);
    let changed = false;

    for (const [k, v] of Object.entries(templateSettings)) {
      if (userSettings[k] === undefined) {
        userSettings[k] = v;
        changed = true;
      }
    }

    if (changed) {
      writeSettings(userSettings);
      console.log('Settings migrated with new defaults');
    }
  } catch (e) {
    console.error('Migration failed', e);
  }
}

/* ── driver status ─────────────────────────────────────────────── */
function getDriverStatus() {
  const execOpts = { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };

  // 1. Check if ANY interception service is actually RUNNING
  for (const svc of ['mouse', 'keyboard', 'mouse_filter', 'keyboard_filter']) {
    try {
      const out = execSync(`sc query ${svc}`, execOpts).toString();
      if (out.includes('RUNNING')) return 'installed';
    } catch { /* ignore */ }
  }

  // 2. Check if the driver is installed but NOT active (needs reboot)
  // We look for our specific service names AND verify they point to keyboard.sys/mouse.sys
  for (const svc of ['mouse', 'keyboard', 'mouse_filter', 'keyboard_filter']) {
    try {
      const config = execSync(`sc qc ${svc}`, execOpts).toString();
      if (config.includes('keyboard.sys') || config.includes('mouse.sys')) {
        return 'reboot_required';
      }
    } catch { /* ignore */ }
  }

  // 3. Registry fallback — only if it points to our driver files
  for (const svc of ['mouse', 'keyboard', 'mouse_filter', 'keyboard_filter']) {
    try {
      const out = execSync(`reg query "HKLM\\SYSTEM\\CurrentControlSet\\Services\\${svc}" /v ImagePath`, execOpts).toString();
      if (out.toLowerCase().includes('keyboard.sys') || out.toLowerCase().includes('mouse.sys')) {
        return 'reboot_required';
      }
    } catch { /* ignore */ }
  }

  return 'not_installed';
}

/* ── run install-interception.exe with UAC elevation ───────────── */
function runElevated(flag) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(INSTALLER_EXE)) {
      return reject(new Error(`install-interception.exe not found at:\n${INSTALLER_EXE}`));
    }
    // Use a simpler command to avoid PowerShell variable parsing issues in different environments.
    const command = `Start-Process -FilePath '${INSTALLER_EXE}' -ArgumentList '${flag}' -Verb RunAs -Wait`;
    const ps = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command', command
    ], { windowsHide: true });
    
    ps.on('close', (code) => {
      // Since we can't reliably capture the exit code of the elevated process from here,
      // we assume success if PowerShell itself exited cleanly. 
      // The user will see the driver status update in the UI.
      if (code === 0) resolve();
      else reject(new Error(`Elevated process failed with code ${code}`));
    });
    ps.on('error', reject);
  });
}

/* ── process management ────────────────────────────────────────── */
function startApp(options = {}) {
  const { notify = true } = options;
  syncActiveProfileToRuntime();

  if (childProcess) return;
  if (!fs.existsSync(MAIN_EXE)) {
    mainWindow?.webContents.send('app-error', `Executable not found:\n${MAIN_EXE}`);
    return;
  }

  // Persist state to active profile and runtime projection
  try {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    if (active) {
      active.settings = { ...(active.settings || {}), Running: '1' };
      active.updatedAt = new Date().toISOString();
      writeProfilesStore(store);
      syncActiveProfileToRuntime();
    }
  } catch (e) { console.error('Failed to save running state', e); }

  // Kill any zombie instances first
  try {
    execSync('taskkill /F /IM themouseapp.exe /T', { stdio: 'ignore' });
  } catch (e) { /* ignore if not running */ }

  const settingsPath = getSettingsPath();
  childProcess = spawn(MAIN_EXE, [settingsPath], { cwd: APP_DIR, windowsHide: true });
  processStatus = 'running';
  startTime = Date.now();

  childProcess.stdout.on('data', (data) => {
    const str = data.toString();
    const lines = str.split(/\r?\n/);
    for (const line of lines) {
      if (line.startsWith('LIVE:')) {
        const parts = line.split(':');
        if (parts.length >= 4) {
          const x      = parseFloat(parts[1]);
          const y      = parseFloat(parts[2]);
          const bits   = parseInt(parts[3]);
          const speedX = parts.length >= 5 ? parseFloat(parts[4]) : 0;
          const speedY = parts.length >= 6 ? parseFloat(parts[5]) : speedX;
          const p   = (bits & 1) === 1;
          const re  = (bits & 2) === 2;
          const xye = (bits & 4) === 4;
          const ae   = (bits & 8)  === 8;
          const ange = (bits & 16) === 16;
          const se   = (bits & 32) === 32;
          mainWindow?.webContents.send('live-sens', { x, y, paused: p, randomizerEnabled: re, xyEnabled: xye, accelEnabled: ae, angleEnabled: ange, snapEnabled: se, speedX, speedY });
        }
      }
    }
  });

  childProcess.on('exit', () => {
    childProcess = null; processStatus = 'stopped'; startTime = null;
    mainWindow?.webContents.send('process-status', { status: 'stopped' });
    updateTrayMenu();
  });
  childProcess.on('error', (err) => {
    childProcess = null; processStatus = 'stopped'; startTime = null;
    mainWindow?.webContents.send('app-error', err.message);
    updateTrayMenu();
  });
  mainWindow?.webContents.send('process-status', { status: 'running', startTime });
  if (notify) showAppNotification('Engine Active', 'TheMouse engine is now running.');
  updateTrayMenu();
}

function stopApp(options = {}) {
  const { notify = true } = options;
  if (!childProcess) return;

  // Persist state to active profile and runtime projection
  try {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    if (active) {
      active.settings = { ...(active.settings || {}), Running: '0' };
      active.updatedAt = new Date().toISOString();
      writeProfilesStore(store);
      syncActiveProfileToRuntime();
    }
  } catch (e) { console.error('Failed to save stopped state', e); }

  childProcess.kill();
  childProcess = null; processStatus = 'stopped'; startTime = null;
  mainWindow?.webContents.send('process-status', { status: 'stopped' });
  if (notify) showAppNotification('Engine Inactive', 'TheMouse engine has stopped.');
  updateTrayMenu();
}

/* ── tray ──────────────────────────────────────────────────────── */
function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: app.name, enabled: false },
    { type: 'separator' },
    { label: 'Open',  click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    {
      label: processStatus === 'running' ? 'Stop' : 'Start',
      click: () => processStatus === 'running' ? stopApp() : startApp(),
    },
    { type: 'separator' },
    { label: 'Quit',  click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

async function createTray() {
  let icon;

  const trayIconPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(trayIconPath)) {
    const img = nativeImage.createFromPath(trayIconPath);
    if (!img.isEmpty()) {
      icon = img.resize({ width: 16, height: 16, quality: 'best' });
    }
  }

  try {
    if (!icon) {
      icon = await app.getFileIcon(MAIN_EXE, { size: 'small' });
    }
  } catch {
    if (!icon) {
      icon = nativeImage.createFromBuffer(makePNG(32, 0, 229, 255));
    }
  }
  if (icon.isEmpty()) icon = nativeImage.createFromBuffer(makePNG(32, 0, 229, 255));

  tray = new Tray(icon);
  tray.setToolTip(app.name);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  updateTrayMenu();
}

/* ── main window ───────────────────────────────────────────────── */
function createWindow() {
  mainWindow = new BrowserWindow({
    title: app.name,
    width: 920, height: 660, minWidth: 760, minHeight: 560,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Prevent Electron from zooming the window on Ctrl+Scroll so the
  // gesture reaches our SVG wheel handler inside the renderer.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (tray && tray.displayBalloon) {
        tray.displayBalloon({
          title: app.name,
          content: 'Running in the background. Right-click the tray icon to quit.',
          iconType: 'info',
        });
      }
    }
  });
}

/* ── IPC ───────────────────────────────────────────────────────── */
function setupIPC() {
  ipcMain.handle('get-settings', () => {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    return active?.settings || readSettings();
  });

  ipcMain.handle('save-settings', (_, settings) => {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    if (!active) return false;

    active.settings = { ...(active.settings || {}), ...settings };
    active.updatedAt = new Date().toISOString();
    writeProfilesStore(store);
    syncActiveProfileToRuntime();
    refreshShortcuts();
    return true;
  });

  ipcMain.handle('get-status', () => ({
    processStatus,
    startTime,
    driverStatus: getDriverStatus(),
    autoStart: app.getLoginItemSettings().openAtLogin,
    activeProfileId: ensureProfilesStore().activeProfileId,
  }));

  ipcMain.handle('start-app',  () => startApp());
  ipcMain.handle('stop-app',   () => stopApp());

  ipcMain.handle('restart-app-if-running', async () => restartAppIfRunningInternal());

  ipcMain.handle('toggle-pause', () => {
    if (childProcess) {
      childProcess.stdin.write('TOGGLE\n');
    }
  });

  ipcMain.handle('install-driver', async () => {
    try {
      await runElevated('/install');
      return { success: true, status: getDriverStatus() };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('uninstall-driver', async () => {
    if (childProcess) stopApp();
    try {
      await runElevated('/uninstall');
      return { success: true, status: getDriverStatus() };
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('get-driver-status', () => getDriverStatus());

  ipcMain.handle('get-accel-curve', () => {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    return active?.accelCurve || null;
  });

  ipcMain.handle('save-accel-curve', (_, curve) => {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    if (!active) return false;

    active.accelCurve = curve;
    active.updatedAt = new Date().toISOString();
    writeProfilesStore(store);
    syncActiveProfileToRuntime();
    return true;
  });

  ipcMain.handle('get-profiles', () => {
    const store = ensureProfilesStore();
    return {
      activeProfileId: store.activeProfileId,
      profiles: store.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    };
  });

  ipcMain.handle('create-profile', (_, payload) => {
    const store = ensureProfilesStore();
    const active = getActiveProfile(store);
    const now = new Date().toISOString();
    const newProfile = {
      id: `profile-${Date.now()}`,
      name: String(payload?.name || 'New Profile').trim() || 'New Profile',
      createdAt: now,
      updatedAt: now,
      settings: JSON.parse(JSON.stringify(active?.settings || readSettings())),
      accelCurve: active?.accelCurve ? JSON.parse(JSON.stringify(active.accelCurve)) : null,
      source: 'user_created',
    };
    store.profiles.push(newProfile);
    store.activeProfileId = newProfile.id;
    writeProfilesStore(store);
    syncActiveProfileToRuntime();
    refreshShortcuts();
    return { success: true, activeProfileId: newProfile.id };
  });

  ipcMain.handle('set-active-profile', async (_, profileId) => switchActiveProfile(profileId));

  ipcMain.handle('delete-profile', (_, profileId) => {
    const store = ensureProfilesStore();
    const profiles = Array.isArray(store.profiles) ? store.profiles : [];
    if (profiles.length <= 1) {
      return { success: false, error: 'At least one profile must remain.' };
    }

    const index = profiles.findIndex((p) => p.id === profileId);
    if (index === -1) {
      return { success: false, error: 'Profile not found' };
    }

    const deletedProfile = profiles[index];
    const deletedActive = store.activeProfileId === profileId;
    store.profiles = profiles.filter((p) => p.id !== profileId);

    let nextActiveProfile = getActiveProfile(store);
    if (deletedActive) {
      const fallbackIndex = Math.min(index, store.profiles.length - 1);
      nextActiveProfile = store.profiles[fallbackIndex] || store.profiles[0] || null;
      store.activeProfileId = nextActiveProfile?.id || null;
    }

    writeProfilesStore(store);

    if (deletedActive && nextActiveProfile) {
      syncActiveProfileToRuntime();
      setTimeout(() => {
        try {
          refreshShortcuts();
        } catch (e) {
          console.error('Failed to refresh shortcuts after profile deletion', e);
        }
      }, 0);
      emitProfileChanged(nextActiveProfile);
    }

    return {
      success: true,
      deletedActive,
      deletedProfileId: deletedProfile.id,
      deletedProfileName: deletedProfile.name,
      activeProfileId: store.activeProfileId,
    };
  });

  ipcMain.handle('get-module-presets', (_, moduleKey) => {
    if (typeof moduleKey !== 'string' || !moduleKey.trim()) return [];
    return listModulePresets(moduleKey.trim());
  });

  ipcMain.handle('save-module-preset', (_, payload) => {
    const moduleKey = String(payload?.module || '').trim();
    const name = String(payload?.name || '').trim();
    if (!moduleKey || !name) return { success: false, error: 'Missing module or preset name' };
    const preset = saveModulePreset(moduleKey, name, payload?.data ?? {});
    return { success: true, preset };
  });

  ipcMain.handle('delete-module-preset', (_, payload) => {
    const moduleKey = String(payload?.module || '').trim();
    const presetId = String(payload?.id || '').trim();
    if (!moduleKey || !presetId) return { success: false, error: 'Missing module or preset id' };
    const ok = deleteModulePreset(moduleKey, presetId);
    return ok ? { success: true } : { success: false, error: 'Preset not found' };
  });

  ipcMain.handle('set-autostart', (_, enable) => {
    app.setLoginItemSettings({ openAtLogin: enable });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('get-windows-accel', () => {
    try {
      const out = execSync('powershell -Command "(Get-ItemProperty \'HKCU:\\Control Panel\\Mouse\').MouseSpeed"').toString().trim();
      return out !== '0';
    } catch { return false; }
  });

  ipcMain.handle('set-windows-accel', (_, enabled) => {
    const v = enabled ? 1 : 0, t1 = enabled ? 6 : 0, t2 = enabled ? 10 : 0;
    const lines = [
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W32 { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, int[] c, uint d); }'`,
      `Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseSpeed      -Value ${v}`,
      `Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold1 -Value ${t1}`,
      `Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold2 -Value ${t2}`,
      `[W32]::SystemParametersInfo(4, 0, [int[]](${t1}, ${t2}, ${v}), 3)`,
    ];
    const encoded = Buffer.from(lines.join('\r\n'), 'utf16le').toString('base64');
    try { execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`); return true; }
    catch { return false; }
  });

  ipcMain.handle('get-windows-mouse-speed', () => {
    try {
      const out = execSync('powershell -Command "(Get-ItemProperty \'HKCU:\\Control Panel\\Mouse\').MouseSensitivity"').toString().trim();
      return parseInt(out) || 10;
    } catch { return 10; }
  });

  ipcMain.handle('set-windows-mouse-speed', (_, speed) => {
    const lines = [
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W32S { [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, uint c, uint d); }'`,
      `Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name MouseSensitivity -Value ${speed}`,
      `[W32S]::SystemParametersInfo(0x71, 0, ${speed}, 3)`,
    ];
    const encoded = Buffer.from(lines.join('\r\n'), 'utf16le').toString('base64');
    try { execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`); return true; }
    catch { return false; }
  });

  ipcMain.handle('get-update-info', async () => {
    try {
      const info = await getLatestReleaseInfo();
      return { success: true, ...info };
    } catch (err) {
      return {
        success: false,
        currentVersion: app.getVersion(),
        repo: GITHUB_REPO,
        error: err.message || 'Update check failed',
      };
    }
  });

  ipcMain.handle('open-external-url', async (_, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window-close',    () => mainWindow?.hide());
}

/* ── hotkeys ───────────────────────────────────────────────────── */
function refreshShortcuts() {
  globalShortcut.unregisterAll();
  const store = ensureProfilesStore();
  const s = getActiveProfile(store)?.settings || readSettings();
  const profilePrevHotkey = s.Hotkey_ProfilePrev === undefined || s.Hotkey_ProfilePrev === null
    ? DEFAULT_PROFILE_PREV_HOTKEY
    : String(s.Hotkey_ProfilePrev).trim();
  const profileNextHotkey = s.Hotkey_ProfileNext === undefined || s.Hotkey_ProfileNext === null
    ? DEFAULT_PROFILE_NEXT_HOTKEY
    : String(s.Hotkey_ProfileNext).trim();
  
  if (s.Hotkey_StartStop) {
    try {
      globalShortcut.register(s.Hotkey_StartStop, () => {
        if (processStatus === 'running') stopApp();
        else startApp();
      });
    } catch (e) { console.error('Failed to register start/stop shortcut', e); }
  }

  if (s.Hotkey_Pause) {
    try {
      globalShortcut.register(s.Hotkey_Pause, () => {
        if (childProcess) childProcess.stdin.write('TOGGLE\n');
      });
    } catch (e) { console.error('Failed to register pause shortcut', e); }
  }

  if (profilePrevHotkey) {
    try {
      globalShortcut.register(profilePrevHotkey, () => {
        cycleProfile(-1).catch((e) => console.error('Failed to cycle to previous profile', e));
      });
    } catch (e) { console.error('Failed to register previous-profile shortcut', e); }
  }

  if (profileNextHotkey) {
    try {
      globalShortcut.register(profileNextHotkey, () => {
        cycleProfile(1).catch((e) => console.error('Failed to cycle to next profile', e));
      });
    } catch (e) { console.error('Failed to register next-profile shortcut', e); }
  }
}

/* ── app lifecycle ─────────────────────────────────────────────── */
app.whenReady().then(async () => {
  migrateSettings();
  ensureProfilesStore();
  syncActiveProfileToRuntime();
  createWindow();
  await createTray();
  setupIPC();
  refreshShortcuts();

  // If app was running when last closed, resume it
  const s = getActiveProfile(ensureProfilesStore())?.settings || readSettings();
  if (s.Running === '1') startApp();

  setTimeout(() => {
    checkForStartupUpdate();
  }, 2000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep app running in background (tray)
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopApp();
  globalShortcut.unregisterAll();
});
