'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, globalShortcut,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const zlib  = require('zlib');
const { spawn, execSync } = require('child_process');

app.name = 'the.mouse.app';
if (process.platform === 'win32') {
  app.setAppUserModelId('app.the.mouse');
}

/* ── constants ─────────────────────────────────────────────────── */
const isDev   = !app.isPackaged;
const APP_DIR = isDev
  ? path.join(__dirname, '..', 'Source', 'themouseapp', 'x64', 'Release')
  : path.join(process.resourcesPath, 'app');

const MAIN_EXE      = path.join(APP_DIR, 'themouseapp.exe');
const INSTALLER_EXE = path.join(APP_DIR, 'install-interception.exe');

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
    const text = Object.entries(settings).map(([k, v]) => `${k} = ${v}`).join('\r\n');
    fs.writeFileSync(getSettingsPath(), text, 'utf8');
  } catch (e) { console.error('Failed to write settings', e); }
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

    // Add any missing keys from template to user settings
    for (const [k, v] of Object.entries(templateSettings)) {
      if (!(k in userSettings)) {
        userSettings[k] = v;
        changed = true;
      }
    }

    if (changed) {
      writeSettings(userSettings);
      console.log('Settings migrated with new defaults.');
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
function startApp() {
  if (childProcess) return;
  if (!fs.existsSync(MAIN_EXE)) {
    mainWindow?.webContents.send('app-error', `Executable not found:\n${MAIN_EXE}`);
    return;
  }

  // Persist state
  try {
    const s = readSettings();
    s.Running = '1';
    writeSettings(s);
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
          const ae  = (bits & 8) === 8;
          mainWindow?.webContents.send('live-sens', { x, y, paused: p, randomizerEnabled: re, xyEnabled: xye, accelEnabled: ae, speedX, speedY });
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
  updateTrayMenu();
}

function stopApp() {
  if (!childProcess) return;

  // Persist state
  try {
    const s = readSettings();
    s.Running = '0';
    writeSettings(s);
  } catch (e) { console.error('Failed to save stopped state', e); }

  childProcess.kill();
  childProcess = null; processStatus = 'stopped'; startTime = null;
  mainWindow?.webContents.send('process-status', { status: 'stopped' });
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
  try {
    icon = await app.getFileIcon(MAIN_EXE, { size: 'small' });
  } catch {
    icon = nativeImage.createFromBuffer(makePNG(32, 0, 229, 255));
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
  ipcMain.handle('get-settings', () => readSettings());

  ipcMain.handle('save-settings', (_, settings) => {
    writeSettings({ ...readSettings(), ...settings });
    refreshShortcuts();
    return true;
  });

  ipcMain.handle('get-status', () => ({
    processStatus,
    startTime,
    driverStatus: getDriverStatus(),
    autoStart: app.getLoginItemSettings().openAtLogin,
  }));

  ipcMain.handle('start-app',  () => startApp());
  ipcMain.handle('stop-app',   () => stopApp());

  ipcMain.handle('restart-app-if-running', async () => {
    if (processStatus === 'running') {
      stopApp();
      // Small delay to ensure process cleanup
      await new Promise(r => setTimeout(r, 500));
      startApp();
    }
  });

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
    const p = getAccelCurvePath();
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  });

  ipcMain.handle('save-accel-curve', (_, curve) => {
    fs.writeFileSync(getAccelCurvePath(), JSON.stringify(curve, null, 2), 'utf8');
    writeAccelLut(curve.enabled, curve.multiCurve, curve.maxSpeed, curve.lutX, curve.lutY);
    return true;
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
    const speed = enabled ? 1 : 0;
    const t1    = enabled ? 6 : 0;
    const t2    = enabled ? 10 : 0;
    const psCommand = `$code = @'
      using System;
      using System.Runtime.InteropServices;
      namespace Win32 {
          public class WinApi {
              [DllImport("user32.dll")]
              public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
          }
      }
'@
      if (-not ([System.Management.Automation.PSTypeName]'Win32.WinApi').Type) {
          Add-Type -TypeDefinition $code
      }
      Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name 'MouseSpeed' -Value ${speed}
      Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold1' -Value ${t1}
      Set-ItemProperty 'HKCU:\\Control Panel\\Mouse' -Name 'MouseThreshold2' -Value ${t2}
      $mouseParams = [int[]](${t1}, ${t2}, ${speed})
      $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal(12)
      [System.Runtime.InteropServices.Marshal]::Copy($mouseParams, 0, $ptr, 3)
      [Win32.WinApi]::SystemParametersInfo(0x0004, 0, $ptr, 0x03)
      [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    `.trim();
    
    try {
      const tmpPath = path.join(app.getPath('temp'), `set-accel-${Date.now()}.ps1`);
      fs.writeFileSync(tmpPath, psCommand, 'utf8');
      execSync(`powershell -ExecutionPolicy Bypass -File "${tmpPath}"`, { windowsHide: true });
      fs.unlinkSync(tmpPath);
      return true;
    } catch (e) {
      console.error('Failed to set windows accel', e);
      return false;
    }
  });

  ipcMain.handle('get-windows-mouse-speed', () => {
    try {
      const out = execSync('powershell -Command "(Get-ItemProperty \'HKCU:\\Control Panel\\Mouse\').MouseSensitivity"').toString().trim();
      return parseInt(out) || 10;
    } catch { return 10; }
  });

  ipcMain.handle('set-windows-mouse-speed', (_, val) => {
    const psCommand = `$code = @'
      using System;
      using System.Runtime.InteropServices;
      namespace Win32 {
          public class WinApi {
              [DllImport("user32.dll")]
              public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
          }
      }
'@
      if (-not ([System.Management.Automation.PSTypeName]'Win32.WinApi').Type) {
          Add-Type -TypeDefinition $code
      }
      [Win32.WinApi]::SystemParametersInfo(0x0071, 0, [IntPtr]${val}, 0x03)
    `.trim();
    
    try {
      const tmpPath = path.join(app.getPath('temp'), `set-speed-${Date.now()}.ps1`);
      fs.writeFileSync(tmpPath, psCommand, 'utf8');
      execSync(`powershell -ExecutionPolicy Bypass -File "${tmpPath}"`, { windowsHide: true });
      fs.unlinkSync(tmpPath);
      return true;
    } catch (e) {
      console.error('Failed to set windows mouse speed', e);
      return false;
    }
  });

  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () =>
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.on('window-close',   () => mainWindow.close());
}

/* ── shortcuts ─────────────────────────────────────────────────── */
function refreshShortcuts() {
  globalShortcut.unregisterAll();
  const settings = readSettings();
  
  const startStopKey = settings.Hotkey_StartStop || 'CommandOrControl+F12';
  
  try {
    const ok = globalShortcut.register(startStopKey, () => {
      if (processStatus === 'running') stopApp();
      else startApp();
    });
    if (!ok) console.error(`Failed to register StartStop shortcut: ${startStopKey} (shortcut might be in use)`);
  } catch (e) { console.error('Error registering StartStop shortcut', e); }

  if (settings.Hotkey_Pause) {
    try {
      globalShortcut.register(settings.Hotkey_Pause, () => {
        if (childProcess) {
          childProcess.stdin.write('TOGGLE\n');
        }
      });
    } catch (e) { console.error('Failed to register Pause shortcut', e); }
  }
}

/* ── app lifecycle ─────────────────────────────────────────────── */
app.whenReady().then(async () => {
  // Enable auto-start on first launch
  const marker = path.join(app.getPath('userData'), '.themouseapp-initialized');
  if (!fs.existsSync(marker)) {
    app.setLoginItemSettings({ openAtLogin: true });
    fs.writeFileSync(marker, '1');
  }

  setupIPC();
  migrateSettings();
  createWindow();
  await createTray();
  refreshShortcuts();

  // Auto-start engine if it was running last session
  try {
    const s = readSettings();
    if (s.Running === '1') {
      startApp();
    }
  } catch (e) { /* ignore startup auto-start errors */ }
});

app.on('window-all-closed', (e) => e.preventDefault()); // keep alive in tray

app.on('before-quit', () => {
  app.isQuitting = true;
  if (childProcess) childProcess.kill();
});

app.on('activate', () => mainWindow?.show());
