// Scope (zoom lens) controller for the main process: keybinds, hold/toggle state, cursor follow
// and the screen-capture source. Rendering happens in the overlay. Raw input arrives from main.js
// as bind events (see bindings.js).
const { screen, systemPreferences, desktopCapturer, session, globalShortcut } = require('electron');
const { matches, releases, toAccelerator } = require('./bindings');

const MIN_ZOOM = 1.1;
const MAX_ZOOM = 20;

module.exports = function createScope({ getOverlay, activeProfile, targetDisplay }) {
  const rt = {
    active: false,
    zoom: null,
    follow: false,
    cfgZoom: null,
    cfgPosition: null,
    holding: false,
    holdTimer: null,
    cursorTimer: null,
    error: null,
  };

  const cfg = () => {
    const p = activeProfile();
    return p && p.scope;
  };
  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * 100) / 100));

  // Pick up edits made in the editor (zoom slider, position mode) without losing live state otherwise.
  function syncFromConfig() {
    const c = cfg();
    if (!c) return;
    if (rt.cfgZoom !== c.zoom) { rt.zoom = clampZoom(c.zoom); rt.cfgZoom = c.zoom; }
    if (rt.cfgPosition !== c.position) { rt.follow = c.position === 'follow'; rt.cfgPosition = c.position; }
    if (!c.enabled && rt.active) rt.active = false;
  }

  function push() {
    syncFromConfig();
    const win = getOverlay();
    const c = cfg();
    if (!win || !c) return;
    // Keep the overlay itself out of the screen capture so the lens never magnifies its own output.
    // Only while the scope is enabled, so the crosshair still shows up in recordings otherwise.
    try { win.setContentProtection(!!c.enabled); } catch {}
    win.webContents.send('overlay:scope', { cfg: c, active: rt.active, zoom: rt.zoom, follow: rt.follow, cursor: cursorLocal() });
    updateCursorPolling();
  }

  function cursorLocal() {
    const d = targetDisplay();
    const pt = screen.getCursorScreenPoint();
    return { x: pt.x - d.bounds.x, y: pt.y - d.bounds.y };
  }

  function updateCursorPolling() {
    const need = rt.active && rt.follow;
    if (need && !rt.cursorTimer) {
      let last = '';
      rt.cursorTimer = setInterval(() => {
        const win = getOverlay();
        if (!win) return;
        const c = cursorLocal();
        const key = c.x + ',' + c.y;
        if (key !== last) { last = key; win.webContents.send('overlay:cursor', c); }
      }, 8);
    } else if (!need && rt.cursorTimer) {
      clearInterval(rt.cursorTimer);
      rt.cursorTimer = null;
    }
  }

  // ---------- actions ----------
  const ACTIONS = {
    toggle: () => { rt.active = !rt.active; },
    zoomIn: () => { if (rt.active) rt.zoom = clampZoom(rt.zoom + cfg().zoomStep); },
    zoomOut: () => { if (rt.active) rt.zoom = clampZoom(rt.zoom - cfg().zoomStep); },
    setZoom: () => { if (rt.active) rt.zoom = clampZoom(cfg().setZoomValue); },
    reset: () => { if (rt.active) rt.zoom = clampZoom(cfg().zoom); },
    follow: () => { rt.follow = !rt.follow; },
  };

  function holdStart() {
    const c = cfg();
    rt.holding = true;
    clearTimeout(rt.holdTimer);
    const go = () => { if (rt.holding) { rt.active = true; push(); } };
    if (c.holdDelay > 0) rt.holdTimer = setTimeout(go, c.holdDelay);
    else go();
  }
  function holdEnd() {
    clearTimeout(rt.holdTimer);
    if (!rt.holding) return;
    rt.holding = false;
    rt.active = false;
    push();
  }

  // ---------- bind events ----------
  // A wheel flick sends many ticks. Zoom in/out react to every tick; on/off style actions take
  // at most one tick per WHEEL_GAP_MS so the lens doesn't flicker.
  const WHEEL_GAP_MS = 150;
  const STEPPED = new Set(['zoomIn', 'zoomOut']);
  const lastWheel = { up: 0, down: 0 };

  function onBindDown(ev) {
    const c = cfg();
    if (!c || !c.enabled) return;
    const b = c.binds || {};
    const wheel = ev.kind === 'wheel';
    const now = Date.now();
    const throttled = wheel && now - lastWheel[ev.dir] < WHEEL_GAP_MS;
    if (matches(b.hold, ev)) {
      // A scroll can't be held, so a scroll bound to "hold" toggles instead.
      if (!wheel) holdStart();
      else if (!throttled) { lastWheel[ev.dir] = now; ACTIONS.toggle(); push(); }
      return;
    }
    let changed = false;
    for (const action of Object.keys(ACTIONS)) {
      if (!matches(b[action], ev)) continue;
      if (wheel && !STEPPED.has(action)) {
        if (throttled) continue;
        lastWheel[ev.dir] = now;
      }
      ACTIONS[action]();
      changed = true;
    }
    if (changed) push();
  }
  function onBindUp(ev) {
    const c = cfg();
    if (c && c.binds && releases(c.binds.hold, ev)) holdEnd();
  }
  function handleWheel(e) {
    const c = cfg();
    if (!c || !c.enabled || !rt.active || !c.wheelZoom) return;
    const dir = e.rotation < 0 ? 1 : e.rotation > 0 ? -1 : 0; // wheel up zooms in
    if (!dir) return;
    rt.zoom = clampZoom(rt.zoom + dir * c.zoomStep * 0.5);
    push();
  }
  function deactivate() {
    clearTimeout(rt.holdTimer);
    rt.holding = false;
    rt.active = false;
    push();
  }

  // Keyboard-only fallback (no global hook): register through globalShortcut. Hold has no key-up
  // there, so it acts as a toggle.
  function registerFallback() {
    const c = cfg();
    if (!c || !c.enabled) return [];
    const failed = [];
    const all = Object.assign({}, ACTIONS, { hold: ACTIONS.toggle });
    for (const [action, fn] of Object.entries(all)) {
      const accel = toAccelerator(c.binds[action]);
      if (!accel) continue;
      try {
        if (!globalShortcut.register(accel, () => { fn(); push(); })) failed.push(accel);
      } catch {
        failed.push(accel);
      }
    }
    return failed;
  }

  // ---------- capture ----------
  function installCaptureHandler() {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        // Rejecting with an empty object can itself throw, so every callback is guarded.
        const deny = () => { try { callback({}); } catch {} };
        const win = getOverlay();
        if (!win || request.frame !== win.webContents.mainFrame) return deny();
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
          const d = targetDisplay();
          const src = sources.find((s) => String(s.display_id) === String(d.id)) || sources[0];
          if (!src) {
            rt.error = process.platform === 'darwin'
              ? 'No screen to capture. Allow Crosshair Studio under Screen Recording, then restart it.'
              : 'No screen to capture.';
            return deny();
          }
          callback({ video: src });
        } catch (e) {
          rt.error = 'Screen capture failed: ' + e.message;
          deny();
        }
      },
      { useSystemPicker: false }
    );
  }

  function status() {
    const screenAccess = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
    return { screen: screenAccess, error: rt.error, active: rt.active, zoom: rt.zoom, follow: rt.follow };
  }

  return {
    push,
    onBindDown,
    onBindUp,
    handleWheel,
    deactivate,
    registerFallback,
    installCaptureHandler,
    status,
    setError: (msg) => { rt.error = msg || null; },
  };
};
