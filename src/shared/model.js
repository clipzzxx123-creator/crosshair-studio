// Data model: layer/crosshair factories, normalization and share codes.
(function () {
  const XH = (window.XH = window.XH || {});

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const OUTLINE = { enabled: true, thickness: 1, color: '#000000', opacity: 1, blur: 0 };
  const COMMON = { visible: true, color: '#00ff66', opacity: 1, blur: 0, rotation: 0, scale: 1, x: 0, y: 0 };

  const LAYER_DEFAULTS = {
    lines: { name: 'Lines', arms: 4, length: 6, width: 2, gap: 4, tMode: 'never', rounded: false, bloom: 1 },
    dot: { name: 'Dot', size: 2, shape: 'square' },
    ring: { name: 'Ring', radius: 12, thickness: 1.5, segments: 0, segmentGap: 20, segmentOffset: 0, rounded: false, bloom: 1 },
    shape: {
      name: 'Shapes', shape: 'chevron', count: 1, radius: 0, width: 12, height: 6, thickness: 2,
      filled: true, arcAngle: 60, inward: true, startAngle: 180, rounded: false, bloom: 1,
    },
    text: { name: 'Text', text: '+', fontSize: 24, fontFamily: 'system-ui', fontWeight: 700 },
    image: { name: 'Image', src: '', width: 48, height: 48, color: '#ffffff' },
  };

  function newLayer(type, overrides = {}) {
    const base = LAYER_DEFAULTS[type];
    if (!base) throw new Error('Unknown layer type ' + type);
    const outline = Object.assign({}, OUTLINE, type === 'image' ? { enabled: false } : {}, overrides.outline || {});
    return Object.assign({ id: uid(), type }, COMMON, base, overrides, { outline });
  }

  function bloomAnimation(amount = 6) {
    return {
      id: uid(), name: 'Bloom while firing', enabled: true, trigger: 'left', mode: 'hold',
      stages: [{ duration: 120, easing: 'easeOut', spread: amount }],
      releaseDuration: 180, releaseEasing: 'easeOut',
    };
  }

  function newCrosshair(overrides = {}) {
    const ch = {
      id: uid(),
      name: 'New Crosshair',
      category: 'Custom',
      opacity: 1,
      pixelSnap: true,
      hideOnADS: false,
      adsMode: 'hold',
      layers: [newLayer('lines'), newLayer('dot', { outline: { enabled: true } })],
      animations: [],
      createdAt: Date.now(),
    };
    return normalizeCrosshair(Object.assign(ch, overrides));
  }

  // Fill in any fields missing from older or imported data so the editor never sees undefined.
  function normalizeCrosshair(ch) {
    const out = Object.assign(
      { id: uid(), name: 'Crosshair', category: 'Custom', opacity: 1, pixelSnap: true, hideOnADS: false, adsMode: 'hold', layers: [], animations: [] },
      ch
    );
    out.layers = (out.layers || [])
      .filter((L) => L && LAYER_DEFAULTS[L.type])
      .map((L) => {
        const n = Object.assign({ id: uid() }, COMMON, LAYER_DEFAULTS[L.type], L);
        n.outline = Object.assign({}, OUTLINE, L.type === 'image' ? { enabled: false } : {}, L.outline || {});
        return n;
      });
    out.animations = (out.animations || []).map((a) =>
      Object.assign({ id: uid(), name: 'Animation', enabled: true, trigger: 'left', mode: 'once', stages: [], releaseDuration: 150, releaseEasing: 'easeOut' }, a)
    );
    return out;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function duplicateCrosshair(ch, name) {
    const c = clone(ch);
    c.id = uid();
    c.name = name || ch.name + ' copy';
    c.createdAt = Date.now();
    c.layers.forEach((L) => (L.id = uid()));
    c.animations.forEach((a) => (a.id = uid()));
    delete c.builtin;
    return c;
  }

  // ---------- share codes: "XHS1." + base64url(deflate-raw(json)) ----------

  const PREFIX = 'XHS1.';

  function toB64Url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64Url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function pipe(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  async function encodeShareCode(ch) {
    const c = clone(ch);
    delete c.id;
    delete c.createdAt;
    delete c.builtin;
    c.layers.forEach((L) => delete L.id);
    c.animations.forEach((a) => delete a.id);
    const json = new TextEncoder().encode(JSON.stringify(c));
    return PREFIX + toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
  }

  async function decodeShareCode(code) {
    code = (code || '').trim();
    if (!code.startsWith(PREFIX)) throw new Error('Not a Crosshair Studio share code.');
    const bytes = await pipe(fromB64Url(code.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    const ch = JSON.parse(new TextDecoder().decode(bytes));
    ch.id = uid();
    ch.createdAt = Date.now();
    return normalizeCrosshair(ch);
  }

  // ---------- scope (zoom lens) ----------
  // Stored per game profile. Binds use uiohook key names (e.g. 'F6', 'A', 'Shift') or mouse buttons.

  function defaultScope() {
    return {
      rev: 3,
      enabled: false,
      keepWarm: true,
      zoom: 2.5,
      zoomStep: 0.5,
      setZoomValue: 4,
      wheelZoom: false, // the wheel also reaches the game (weapon switch), so this is opt-in
      animate: true,
      animMs: 80,
      shape: 'circle',
      size: 280,
      width: 380,
      height: 220,
      roundness: 24,
      edgeFeather: 1,
      distortion: false,
      distortionStrength: 0.35,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      sharpen: 0,
      outline: { enabled: true, color: '#ffffff', thickness: 2, opacity: 0.9, feather: 1 },
      dim: { enabled: false, color: '#000000', opacity: 0.45 },
      position: 'fixed',
      offsetX: 0,
      offsetY: 0,
      crosshair: 'show',
      quality: 'balanced',
      vsync: true,
      holdDelay: 0,
      binds: {
        toggle: { kind: 'key', code: 'F6' },
        hold: { kind: 'mouse', button: 'mouse5' },
        zoomIn: null,
        zoomOut: null,
        setZoom: null,
        reset: null,
        follow: { kind: 'key', code: 'F7' },
      },
    };
  }

  function normalizeScope(sc) {
    const def = defaultScope();
    const out = Object.assign(def, sc || {});
    out.outline = Object.assign(defaultScope().outline, (sc && sc.outline) || {});
    out.dim = Object.assign(defaultScope().dim, (sc && sc.dim) || {});
    out.binds = Object.assign(defaultScope().binds, (sc && sc.binds) || {});
    // rev 2: scroll-wheel zoom changed from on to off by default; switch it off in older saves once.
    if (sc && (sc.rev || 1) < 2) out.wheelZoom = false;
    // rev 3: snappier default zoom animation (160 → 80 ms) for anyone still on the old default.
    if (sc && (sc.rev || 1) < 3 && out.animMs === 160) out.animMs = 80;
    out.rev = 3;
    return out;
  }

  // ---------- app data ----------

  // ---------- app-wide binds ----------
  // Same shape as scope binds: { kind: 'key', code, ctrl, alt, shift, meta } or { kind: 'mouse', button }.

  const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  // Converts an Electron accelerator ("CommandOrControl+Shift+X") from older saves into a bind.
  function accelToBind(accel) {
    if (!accel) return null;
    const parts = String(accel).split('+');
    const key = parts.pop();
    const b = { kind: 'key', code: '', ctrl: false, alt: false, shift: false, meta: false };
    for (const m of parts) {
      if (/^(CommandOrControl|CmdOrCtrl)$/i.test(m)) IS_MAC ? (b.meta = true) : (b.ctrl = true);
      else if (/^(Command|Cmd|Super|Meta)$/i.test(m)) b.meta = true;
      else if (/^(Control|Ctrl)$/i.test(m)) b.ctrl = true;
      else if (/^(Alt|Option)$/i.test(m)) b.alt = true;
      else if (/^Shift$/i.test(m)) b.shift = true;
    }
    const named = { Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', '`': 'Backquote' };
    if (named[key]) b.code = named[key];
    else if (/^num\d$/.test(key)) b.code = 'Numpad' + key.slice(3);
    else b.code = key.length === 1 ? key.toUpperCase() : key;
    return b.code ? b : null;
  }

  const DEFAULT_HOTKEYS = {
    toggle: 'CommandOrControl+Shift+X',
    next: 'CommandOrControl+Shift+Right',
    prev: 'CommandOrControl+Shift+Left',
    center: 'CommandOrControl+Shift+C',
  };
  const defaultBinds = () => Object.fromEntries(Object.entries(DEFAULT_HOTKEYS).map(([k, a]) => [k, accelToBind(a)]));

  function defaultData() {
    const ch = newCrosshair({ name: 'My First Crosshair' });
    const profile = { id: uid(), name: 'Default', crosshairId: ch.id, offsetX: 0, offsetY: 0, displayId: null, scope: defaultScope() };
    return {
      version: 1,
      crosshairs: [ch],
      profiles: [profile],
      activeProfileId: profile.id,
      settings: {
        overlayVisible: true,
        binds: defaultBinds(), // show/hide, next, previous, re-center
        crosshairBinds: {}, // crosshairId -> { bind, mode: 'switch' | 'hold' }
        switchToast: true,
        escKill: true,
        startHidden: true,
        previewBg: 'range',
        previewZoom: 3,
      },
    };
  }

  function normalizeData(d) {
    const def = defaultData();
    if (!d || !Array.isArray(d.crosshairs)) return def;
    d.crosshairs = d.crosshairs.map(normalizeCrosshair);
    if (!d.crosshairs.length) d.crosshairs = def.crosshairs;
    if (!Array.isArray(d.profiles) || !d.profiles.length) {
      d.profiles = def.profiles;
      d.profiles[0].crosshairId = d.crosshairs[0].id;
    }
    if (!d.profiles.find((p) => p.id === d.activeProfileId)) d.activeProfileId = d.profiles[0].id;
    const saved = d.settings || {};
    d.settings = Object.assign({}, def.settings, saved);
    if (!saved.binds) {
      // Older saves stored accelerator strings under `hotkeys`.
      const old = Object.assign({}, DEFAULT_HOTKEYS, saved.hotkeys || {});
      d.settings.binds = Object.fromEntries(Object.keys(DEFAULT_HOTKEYS).map((k) => [k, accelToBind(old[k])]));
    }
    delete d.settings.hotkeys;
    d.settings.binds = Object.assign(Object.fromEntries(Object.keys(DEFAULT_HOTKEYS).map((k) => [k, null])), d.settings.binds);
    // Drop binds for crosshairs that no longer exist.
    const ids = new Set(d.crosshairs.map((c) => c.id));
    d.settings.crosshairBinds = Object.fromEntries(
      Object.entries(d.settings.crosshairBinds || {}).filter(([id, cb]) => ids.has(id) && cb && cb.bind)
        .map(([id, cb]) => [id, { bind: cb.bind, mode: cb.mode === 'hold' ? 'hold' : 'switch' }])
    );
    for (const p of d.profiles) {
      if (!d.crosshairs.find((c) => c.id === p.crosshairId)) p.crosshairId = d.crosshairs[0].id;
      p.scope = normalizeScope(p.scope);
    }
    return d;
  }

  Object.assign(XH, {
    uid, newLayer, newCrosshair, normalizeCrosshair, duplicateCrosshair, bloomAnimation, clone,
    encodeShareCode, decodeShareCode, defaultData, normalizeData, LAYER_DEFAULTS, defaultScope, normalizeScope, accelToBind, IS_MAC,
  });
})();
