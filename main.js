const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, Tray, Menu, nativeImage, systemPreferences, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const createScope = require('./scope-main');
const { createKeyState, matches, releases, toAccelerator } = require('./bindings');

let uIOhook = null;
let UiohookKey = null;
try {
  ({ uIOhook, UiohookKey } = require('uiohook-napi'));
} catch (e) {
  console.warn('uiohook-napi unavailable; fire/aim triggers disabled:', e.message);
}

const DATA_FILE = () => path.join(app.getPath('userData'), 'crosshair-studio.json');

let data = null; // owned by the editor; main keeps the latest copy for hotkeys and the overlay
let editorWin = null;
let overlayWin = null;
let tray = null;
let inputState = { available: false, error: null };
let quitting = false;
let scope = null;
let keys = null; // held-key tracker for binds
let heldCrosshair = null; // { id, bind } while a "hold" crosshair bind is pressed
let escTimer = null;
const ESC_HOLD_MS = 3000;

// ---------------- persistence ----------------

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8'));
  } catch {
    return null;
  }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE()), { recursive: true });
      fs.writeFileSync(DATA_FILE() + '.tmp', JSON.stringify(data));
      fs.renameSync(DATA_FILE() + '.tmp', DATA_FILE());
    } catch (e) {
      console.error('Save failed', e);
    }
  }, 250);
}

// ---------------- helpers ----------------

const activeProfile = () => data && (data.profiles.find((p) => p.id === data.activeProfileId) || data.profiles[0]);
const activeCrosshair = () => {
  const p = activeProfile();
  if (!p) return null;
  const held = heldCrosshair && data.crosshairs.find((c) => c.id === heldCrosshair.id);
  return held || data.crosshairs.find((c) => c.id === p.crosshairId) || data.crosshairs[0];
};

function targetDisplay() {
  const p = activeProfile();
  const all = screen.getAllDisplays();
  return (p && all.find((d) => d.id === p.displayId)) || screen.getPrimaryDisplay();
}

function displaysInfo() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `${d.label || 'Display ' + (i + 1)} — ${d.size.width}×${d.size.height}${d.id === primary ? ' (primary)' : ''}`,
  }));
}

// ---------------- overlay ----------------

function createOverlay() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(path.join(__dirname, 'src/overlay/overlay.html'));
  if (process.platform === 'win32') {
    setInterval(() => {
      if (overlayWin && overlayWin.isVisible()) {
        overlayWin.setAlwaysOnTop(true, 'screen-saver');
        overlayWin.moveTop();
      }
    }, 2000);
  }
  overlayWin.webContents.on('did-finish-load', pushOverlay);
}

function placeOverlay() {
  if (!overlayWin) return;
  const d = targetDisplay();
  overlayWin.setBounds(d.bounds);
}

// `announce`: show the crosshair's name on screen (used when switching by hotkey or tray).
function pushOverlay(announce = false) {
  if (!overlayWin || !data) return;
  placeOverlay();
  const d = targetDisplay();
  const p = activeProfile();
  const visible = !!data.settings.overlayVisible;
  overlayWin.webContents.send('overlay:update', {
    crosshair: activeCrosshair(),
    offsetX: p.offsetX || 0,
    offsetY: p.offsetY || 0,
    display: d.bounds,
    window: overlayWin.getBounds(),
    announce: announce === true && data.settings.switchToast !== false,
  });
  if (visible && !overlayWin.isVisible()) overlayWin.showInactive();
  if (!visible && overlayWin.isVisible()) overlayWin.hide();
  if (scope) scope.push();
  updateTray();
}

// ---------------- global input (fire / aim triggers) ----------------

const BUTTONS = { 1: 'left', 2: 'right', 3: 'middle', 4: 'mouse4', 5: 'mouse5' };

function startInputHook() {
  if (!uIOhook) {
    inputState = { available: false, error: 'Mouse hook module failed to load.' };
    return;
  }
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    inputState = { available: false, error: 'Grant Accessibility access to enable fire/aim triggers (System Settings → Privacy & Security → Accessibility), then restart.' };
    return;
  }
  try {
    const send = (type) => (e) => {
      const button = BUTTONS[e.button];
      if (!button) return;
      if (overlayWin) overlayWin.webContents.send('overlay:input', { type, button });
      const ev = { kind: 'mouse', button };
      if (type === 'down') onBindDown(ev);
      else onBindUp(ev);
    };
    uIOhook.on('mousedown', send('down'));
    uIOhook.on('mouseup', send('up'));
    uIOhook.on('keydown', (e) => {
      const ev = keys.keyDown(e);
      if (!ev) return;
      if (ev.code === 'Escape') startEscTimer();
      onBindDown(ev);
    });
    uIOhook.on('keyup', (e) => {
      const ev = keys.keyUp(e);
      if (!ev) return;
      if (ev.code === 'Escape') clearTimeout(escTimer);
      onBindUp(ev);
    });
    uIOhook.on('wheel', (e) => scope.handleWheel(e));
    uIOhook.start();
    inputState = { available: true, error: null };
  } catch (e) {
    inputState = { available: false, error: 'Mouse hook failed to start: ' + e.message };
  }
}

// ---------------- hotkeys ----------------

function cycleCrosshair(dir) {
  const p = activeProfile();
  const list = data.crosshairs;
  const i = list.findIndex((c) => c.id === p.crosshairId);
  switchCrosshair(list[(i + dir + list.length) % list.length].id);
}

function switchCrosshair(id) {
  if (!data.crosshairs.find((c) => c.id === id)) return;
  heldCrosshair = null;
  activeProfile().crosshairId = id;
  changed(true);
}

function changed(announce = false) {
  persist();
  pushOverlay(announce);
  if (editorWin) editorWin.webContents.send('data:changed', data);
}

// ---------------- binds (keys + mouse buttons, via the global hook) ----------------

function onBindDown(ev) {
  if (!data) return;
  const s = data.settings;
  for (const [action, bind] of Object.entries(s.binds || {})) {
    if (HOTKEY_ACTIONS[action] && matches(bind, ev)) HOTKEY_ACTIONS[action]();
  }
  for (const [id, cb] of Object.entries(s.crosshairBinds || {})) {
    if (!cb || !matches(cb.bind, ev)) continue;
    if (cb.mode === 'hold') {
      // Use this crosshair only while the bind is held; not saved.
      if (!data.crosshairs.find((c) => c.id === id)) continue;
      heldCrosshair = { id, bind: cb.bind };
      pushOverlay();
    } else {
      switchCrosshair(id);
    }
  }
  scope.onBindDown(ev);
}

function onBindUp(ev) {
  if (!data) return;
  if (heldCrosshair && releases(heldCrosshair.bind, ev)) {
    heldCrosshair = null;
    pushOverlay();
  }
  scope.onBindUp(ev);
}

// Hold Esc for 3 s: hide the crosshair and close the scope.
function startEscTimer() {
  clearTimeout(escTimer);
  if (!data || data.settings.escKill === false) return;
  escTimer = setTimeout(() => {
    heldCrosshair = null;
    data.settings.overlayVisible = false;
    scope.deactivate();
    changed();
  }, ESC_HOLD_MS);
}

const HOTKEY_ACTIONS = {
  toggle: () => {
    data.settings.overlayVisible = !data.settings.overlayVisible;
    changed();
  },
  next: () => cycleCrosshair(1),
  prev: () => cycleCrosshair(-1),
  center: () => {
    const p = activeProfile();
    p.offsetX = 0;
    p.offsetY = 0;
    changed();
  },
};

// With the global hook running, every bind goes through onBindDown/onBindUp. Without it
// (macOS before Accessibility access), keyboard binds fall back to globalShortcut and
// mouse binds / hold modes are unavailable.
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (!data || inputState.available) return [];
  const failed = [];
  const reg = (bind, fn) => {
    const accel = toAccelerator(bind);
    if (!accel) return;
    try {
      if (!globalShortcut.register(accel, fn)) failed.push(accel);
    } catch {
      failed.push(accel);
    }
  };
  for (const [action, bind] of Object.entries(data.settings.binds || {})) if (HOTKEY_ACTIONS[action]) reg(bind, HOTKEY_ACTIONS[action]);
  for (const [id, cb] of Object.entries(data.settings.crosshairBinds || {})) if (cb) reg(cb.bind, () => switchCrosshair(id));
  failed.push(...scope.registerFallback());
  return failed;
}

// ---------------- tray ----------------

// Draws a 16×16 crosshair icon as a PNG so the app needs no image assets.
// macOS: black template image (the system recolors it). Windows: bright green, since a black icon
// disappears on the dark taskbar.
function makeTrayIcon() {
  const S = 32;
  const px = Buffer.alloc(S * S * 4);
  const rgb = process.platform === 'darwin' ? [0, 0, 0] : [0x3d, 0xfc, 0x8b];
  const set = (x, y) => {
    const i = (y * S + x) * 4;
    [px[i], px[i + 1], px[i + 2]] = rgb;
    px[i + 3] = 255;
  };
  for (let i = 0; i < S; i++) {
    for (let w = 14; w < 18; w++) {
      if (i < 11 || i > 20) { set(i, w); set(w, i); }
    }
  }
  for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) set(x, y);
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(tb));
    return Buffer.concat([len, tb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function updateTray() {
  if (!tray || !data) return;
  const visible = !!data.settings.overlayVisible;
  tray.setToolTip(`Crosshair Studio — ${activeCrosshair().name}${visible ? '' : ' (hidden)'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Editor', click: () => showEditor() },
      ...(updateState.status === 'ready' ? [{ label: `Restart to update to ${updateState.version}`, click: installUpdate }] : []),
      { label: visible ? 'Hide Crosshair' : 'Show Crosshair', click: HOTKEY_ACTIONS.toggle },
      { label: 'Next Crosshair', click: HOTKEY_ACTIONS.next },
      { label: 'Previous Crosshair', click: HOTKEY_ACTIONS.prev },
      { type: 'separator' },
      {
        label: 'Profile',
        submenu: data.profiles.map((p) => ({
          label: p.name,
          type: 'radio',
          checked: p.id === data.activeProfileId,
          click: () => { data.activeProfileId = p.id; changed(); },
        })),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ])
  );
}

// ---------------- editor ----------------

// `hidden`: create the window without showing it (launch at startup → tray). The editor still
// loads so it can migrate and save settings.
function showEditor(hidden = false) {
  if (editorWin) {
    if (hidden === true) return;
    editorWin.show();
    editorWin.focus();
    return;
  }
  editorWin = new BrowserWindow({
    show: hidden !== true,
    width: Math.min(1320, screen.getPrimaryDisplay().workAreaSize.width - 40),
    height: Math.min(840, screen.getPrimaryDisplay().workAreaSize.height - 40),
    minWidth: 960,
    minHeight: 560,
    title: 'Crosshair Studio',
    backgroundColor: '#101216',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  editorWin.loadFile(path.join(__dirname, 'src/editor/index.html'));
  // Closing the editor keeps the crosshair running from the tray.
  editorWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      editorWin.hide();
    }
  });
  editorWin.on('closed', () => (editorWin = null));
}

// ---------------- IPC ----------------

ipcMain.handle('data:load', () => data);
ipcMain.handle('data:save', (_e, next) => {
  const bindsKey = (d) => d && JSON.stringify([d.settings.binds, d.settings.crosshairBinds, d.activeProfileId, d.profiles.map((p) => p.scope && [p.scope.enabled, p.scope.binds])]);
  const hotkeysChanged = bindsKey(next) !== bindsKey(data);
  data = next;
  persist();
  pushOverlay();
  return { failedHotkeys: hotkeysChanged ? registerHotkeys() : [] };
});
ipcMain.handle('displays:list', () => displaysInfo());
ipcMain.handle('update:get', () => updateState);
ipcMain.handle('update:check', () => {
  if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
  return updateState;
});
ipcMain.handle('update:install', () => installUpdate());
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, openAtLogin: app.getLoginItemSettings(loginOptions()).openAtLogin }));
ipcMain.handle('app:setOpenAtLogin', (_e, on) => {
  app.setLoginItemSettings(Object.assign(loginOptions(), { openAtLogin: !!on }));
  return app.getLoginItemSettings(loginOptions()).openAtLogin;
});
ipcMain.handle('input:status', () => inputState);
ipcMain.handle('scope:status', () => Object.assign(scope.status(), { hook: inputState.available }));
ipcMain.on('scope:error', (_e, msg) => scope.setError(msg));
ipcMain.handle('scope:requestScreenAccess', async () => {
  // Asking for sources makes macOS show the Screen Recording prompt the first time.
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch {}
  return scope.status();
});
ipcMain.handle('input:requestAccess', () => {
  if (process.platform === 'darwin') systemPreferences.isTrustedAccessibilityClient(true);
  return inputState;
});
ipcMain.handle('file:save', async (_e, { defaultName, content, encoding, filters }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(editorWin, { defaultPath: defaultName, filters });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, encoding === 'base64' ? Buffer.from(content, 'base64') : content);
  return { ok: true, filePath };
});

// ---------------- auto-update (Windows installer builds) ----------------

// Updates come from the GitHub releases set in package.json "build.publish". Only the installed
// Windows build can update itself: the portable .exe and dev runs (npm start) can't.
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
let autoUpdater = null;
const updateState = { status: 'idle', version: null, progress: 0, error: null, reason: null };

function setUpdate(patch) {
  Object.assign(updateState, patch);
  if (editorWin) editorWin.webContents.send('update:state', updateState);
  updateTray();
}

function setupUpdater() {
  if (process.platform !== 'win32') return setUpdate({ status: 'unsupported', reason: 'Automatic updates are available in the Windows app.' });
  if (!app.isPackaged) return setUpdate({ status: 'unsupported', reason: 'Automatic updates only run in the installed app, not with npm start.' });
  if (process.env.PORTABLE_EXECUTABLE_FILE) return setUpdate({ status: 'unsupported', reason: 'The portable version can\'t update itself. Install with the Setup .exe to get automatic updates.' });
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => setUpdate({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'latest' }));
  autoUpdater.on('download-progress', (p) => setUpdate({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setUpdate({ status: 'ready', version: info.version, progress: 100 }));
  autoUpdater.on('error', (e) => setUpdate({ status: 'error', error: String((e && e.message) || e).split('\n')[0] }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, UPDATE_CHECK_MS);
}

function installUpdate() {
  if (!autoUpdater || updateState.status !== 'ready') return;
  quitting = true;
  // Silent install, then relaunch the app.
  autoUpdater.quitAndInstall(true, true);
}

// ---------------- launch at startup ----------------

// The portable Windows build runs from a temp folder; point the login item at the real .exe.
function loginOptions() {
  if (process.platform !== 'win32') return {};
  return { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] };
}
function launchedAtLogin() {
  if (process.argv.includes('--hidden')) return true;
  try { return process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
}

// ---------------- lifecycle ----------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showEditor());

  app.whenReady().then(() => {
    data = loadData(); // null on first run; the editor creates defaults and saves them
    keys = createKeyState(UiohookKey);
    scope = createScope({ getOverlay: () => overlayWin, activeProfile, targetDisplay });
    scope.installCaptureHandler();
    createOverlay();
    startInputHook();
    if (data) registerHotkeys();
    tray = new Tray(makeTrayIcon());
    if (process.platform !== 'darwin') tray.on('click', () => showEditor());
    updateTray();
    showEditor(launchedAtLogin() && !!(data && data.settings.startHidden));
    setupUpdater();
    screen.on('display-added', pushOverlay);
    screen.on('display-removed', pushOverlay);
    screen.on('display-metrics-changed', pushOverlay);
  });

  app.on('activate', () => showEditor());
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', (e) => e.preventDefault && e.preventDefault());
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try { uIOhook && inputState.available && uIOhook.stop(); } catch {}
  });
}
