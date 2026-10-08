(function () {
  'use strict';

  // ======================================================================
  // Platform bridge (falls back to the browser so the editor can be developed without Electron)
  // ======================================================================
  if (!window.api) {
    const KEY = 'crosshair-studio';
    window.api = {
      isElectron: false,
      platform: 'browser',
      load: async () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
      save: async (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} return { failedHotkeys: [] }; },
      listDisplays: async () => [{ id: 0, label: 'Browser preview' }],
      inputStatus: async () => ({ available: false, error: 'Running in a browser: the on-screen overlay and global mouse triggers need the desktop app.' }),
      requestInputAccess: async () => ({}),
      saveFile: async ({ defaultName, content, encoding }) => {
        const blob = encoding === 'base64'
          ? new Blob([Uint8Array.from(atob(content), (c) => c.charCodeAt(0))], { type: 'image/png' })
          : new Blob([content], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = defaultName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        return { ok: true };
      },
      onDataChanged: () => () => {},
      appInfo: async () => ({ version: 'browser preview', openAtLogin: false }),
    };
  }
  const api = window.api;
  const isMac = api.platform === 'darwin' || /Mac/.test(navigator.platform);

  // ======================================================================
  // Helpers
  // ======================================================================
  const $ = (s, root = document) => root.querySelector(s);
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }
  // replaceChildren that skips null/false, so optional children can be inlined.
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, p, v) => {
    const ks = p.split('.');
    const last = ks.pop();
    ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v;
  };
  const round = (v, step) => {
    const d = (String(step).split('.')[1] || '').length;
    return +(+v).toFixed(d);
  };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const prettyAccel = (a) =>
    (a || '')
      .replace(/CommandOrControl|CmdOrCtrl/g, isMac ? '⌘' : 'Ctrl')
      .replace(/Command|Cmd/g, '⌘')
      .replace(/Control/g, isMac ? '⌃' : 'Ctrl')
      .replace(/Alt/g, isMac ? '⌥' : 'Alt')
      .replace(/Shift/g, isMac ? '⇧' : 'Shift')
      .replace(/\+/g, isMac ? '' : '+');

  // ======================================================================
  // State
  // ======================================================================
  let data = null;
  let selLayerId = null;
  let libCat = 'All';
  let displays = [];
  let inputStatus = { available: false };
  const animator = new XH.Animator();

  const prof = () => data.profiles.find((p) => p.id === data.activeProfileId) || data.profiles[0];
  const cur = () => data.crosshairs.find((c) => c.id === prof().crosshairId) || data.crosshairs[0];
  const layer = () => cur().layers.find((l) => l.id === selLayerId) || null;

  // ---------- save + undo ----------
  const history = [];
  let histIdx = -1;
  let saveTimer, histTimer;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const res = await api.save(XH.clone(data));
      if (res && res.failedHotkeys && res.failedHotkeys.length)
        toast(`Couldn't register hotkey ${res.failedHotkeys.map(prettyAccel).join(', ')}. It may be used by another app.`);
    }, 120);
  }
  function snapshot() {
    const s = JSON.stringify(data);
    if (history[histIdx] === s) return;
    history.splice(histIdx + 1);
    history.push(s);
    if (history.length > 150) history.shift();
    histIdx = history.length - 1;
    updateUndoButtons();
  }
  function commit() {
    scheduleSave();
    clearTimeout(histTimer);
    histTimer = setTimeout(snapshot, 350);
  }
  function restore(i) {
    if (i < 0 || i >= history.length) return;
    clearTimeout(histTimer);
    histIdx = i;
    data = JSON.parse(history[i]);
    syncAnimator();
    renderAll();
    scheduleSave();
    updateUndoButtons();
  }
  const undo = () => { snapshot(); restore(histIdx - 1); };
  const redo = () => restore(histIdx + 1);
  function updateUndoButtons() {
    $('#undoBtn').disabled = histIdx <= 0;
    $('#redoBtn').disabled = histIdx >= history.length - 1;
  }

  function syncAnimator() {
    animator.setCrosshair(cur());
    const ch = cur();
    if (!ch.layers.find((l) => l.id === selLayerId)) selLayerId = ch.layers.length ? ch.layers[ch.layers.length - 1].id : null;
  }

  // ======================================================================
  // Preview stage
  // ======================================================================
  const BACKGROUNDS = {
    range: { label: 'Range', css: 'linear-gradient(180deg,#8ec5ea 0%,#d4e9f6 52%,#a08a63 52%,#6f5c3e 100%)' },
    desert: { label: 'Desert', css: 'linear-gradient(180deg,#f0b978 0%,#f7dfb5 48%,#d9a464 48%,#a8743c 100%)' },
    forest: { label: 'Forest', css: 'linear-gradient(180deg,#4e6f45 0%,#7f9a5b 46%,#2c3d23 46%,#18230f 100%)' },
    snow: { label: 'Snow', css: 'linear-gradient(180deg,#9fb4c6 0%,#e4edf3 50%,#f9fbfd 50%,#d5dfe8 100%)' },
    night: { label: 'Night', css: 'radial-gradient(ellipse at 50% 120%,#24405f 0%,#0b1220 60%,#04060b 100%)' },
    dark: { label: 'Dark', css: '#16181d' },
    light: { label: 'Light', css: '#ececec' },
    checker: { label: 'Transparent', css: 'repeating-conic-gradient(#7a7a7a 0 25%, #a6a6a6 0 50%) 0 0 / 16px 16px' },
  };
  const ZOOMS = [1, 2, 3, 4, 6, 8];

  function bgCss() {
    const s = data.settings;
    if (s.previewBg === 'custom' && s.customBg) return `center / cover no-repeat url("${s.customBg}")`;
    return (BACKGROUNDS[s.previewBg] || BACKGROUNDS.range).css;
  }

  let previewRaf = 0;
  function renderPreview() {
    previewRaf = 0;
    const ch = cur();
    const st = animator.state();
    const stage = $('#stage');
    const zoom = data.settings.previewZoom || 3;
    const size = Math.ceil(Math.max(stage.clientWidth, stage.clientHeight) / zoom) | 1;
    $('#stageXh').innerHTML = XH.renderSVG(ch, st, { size, pixelSize: size * zoom, idPrefix: 'pv' });
    $('#actualXh').innerHTML = XH.renderSVG(ch, st, { size: 121, idPrefix: 'pa' });
    XH.ScopeTab.preview(scopeCtx);
    if (st.active) previewRaf = requestAnimationFrame(renderPreview);
  }
  const schedulePreview = () => { if (!previewRaf) previewRaf = requestAnimationFrame(renderPreview); };

  function renderStageControls() {
    const s = data.settings;
    $('#stageBg').style.background = bgCss();
    $('#actualBg').style.background = bgCss();
    const sw = $('#bgSwatches');
    fill(sw, 
      ...Object.entries(BACKGROUNDS).map(([key, b]) =>
        h('button', {
          class: 'swatch' + (s.previewBg === key ? ' active' : ''), title: b.label, style: { background: b.css },
          onclick: () => { s.previewBg = key; renderStageControls(); commit(); },
        })
      ),
      s.customBg
        ? h('button', {
            class: 'swatch' + (s.previewBg === 'custom' ? ' active' : ''), title: 'Your screenshot',
            style: { background: `center / cover url("${s.customBg}")` },
            onclick: () => { s.previewBg = 'custom'; renderStageControls(); commit(); },
          })
        : null,
      h('button', {
        class: 'swatch upload', title: 'Use a game screenshot as the preview background',
        onclick: () => pickFile('image/*', (url) => { s.customBg = url; s.previewBg = 'custom'; renderStageControls(); commit(); }),
      }, '+')
    );
    fill($('#zoomSeg'), 
      ...ZOOMS.map((z) =>
        h('button', { class: s.previewZoom === z ? 'active' : '', onclick: () => { s.previewZoom = z; renderStageControls(); renderPreview(); commit(); } }, z + '×')
      )
    );
  }

  const MOUSE = ['left', 'middle', 'right', 'mouse4', 'mouse5'];
  function bindStage() {
    const stage = $('#stage');
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('mousedown', (e) => { e.preventDefault(); animator.press(MOUSE[e.button]); schedulePreview(); });
    window.addEventListener('mouseup', (e) => { animator.release(MOUSE[e.button]); schedulePreview(); });
    stage.addEventListener('mouseleave', () => {
      for (const b of MOUSE) animator.release(b);
      schedulePreview();
    });
    new ResizeObserver(() => schedulePreview()).observe(stage);
  }

  // ======================================================================
  // Header
  // ======================================================================
  function renderHeader() {
    const ps = $('#profileSelect');
    fill(ps, ...data.profiles.map((p) => h('option', { value: p.id, selected: p.id === data.activeProfileId }, p.name)));
    const ds = $('#displaySelect');
    const p = prof();
    fill(ds, 
      h('option', { value: '', selected: p.displayId == null }, 'Primary monitor'),
      ...displays.map((d) => h('option', { value: d.id, selected: p.displayId === d.id }, d.label))
    );
    $('#overlayToggle').checked = !!data.settings.overlayVisible;
  }

  // ======================================================================
  // Left: my crosshairs + library
  // ======================================================================
  function thumb(ch, size = 44, units = 56) {
    return h('div', { class: 'thumb', html: XH.renderSVG(ch, null, { size: units, pixelSize: size, idPrefix: 't' + ch.id }) });
  }

  function selectCrosshair(id) {
    prof().crosshairId = id;
    selLayerId = null;
    syncAnimator();
    renderAll();
    commit();
  }

  function renderMine() {
    const q = $('#mineSearch').value.trim().toLowerCase();
    const active = cur().id;
    const items = data.crosshairs.filter((c) => !q || c.name.toLowerCase().includes(q));
    const list = $('#mineList');
    if (!items.length) {
      fill(list, h('li', { class: 'empty' }, q ? 'No matches.' : 'No crosshairs yet.'));
      return;
    }
    fill(list, 
      ...items.map((c) => {
        const usedBy = data.profiles.filter((p) => p.crosshairId === c.id).map((p) => p.name);
        return h('li', { class: 'xh-item' + (c.id === active ? ' active' : ''), 'data-id': c.id, onclick: () => selectCrosshair(c.id) },
          thumb(c),
          h('div', { class: 'xh-meta' },
            h('div', { class: 'xh-name' }, c.name),
            h('div', { class: 'xh-sub' },
              `${c.layers.length} layer${c.layers.length === 1 ? '' : 's'}` + (c.animations.length ? ` · ${c.animations.length} anim` : '') +
              (usedBy.length ? ` · ${usedBy.join(', ')}` : ''))
          ),
          h('div', { class: 'xh-actions' },
            h('button', { class: 'icon-btn', title: 'Duplicate', onclick: (e) => { e.stopPropagation(); duplicate(c); } }, '⧉'),
            h('button', { class: 'icon-btn', title: 'Delete', onclick: (e) => { e.stopPropagation(); removeCrosshair(c); } }, '✕')
          )
        );
      })
    );
  }

  function refreshActiveThumb() {
    const el = $(`#mineList .xh-item[data-id="${cur().id}"] .thumb`);
    if (el) el.replaceWith(thumb(cur()));
  }

  function addCrosshair(ch) {
    data.crosshairs.push(ch);
    selectCrosshair(ch.id);
    switchTab('left', 'mine');
    requestAnimationFrame(() => {
      const el = $(`#mineList .xh-item[data-id="${ch.id}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
  }
  const duplicate = (c) => { addCrosshair(XH.duplicateCrosshair(c)); toast('Duplicated'); };

  function removeCrosshair(c) {
    if (data.crosshairs.length === 1) return toast('You need at least one crosshair.');
    if (!confirm(`Delete "${c.name}"?`)) return;
    const i = data.crosshairs.indexOf(c);
    data.crosshairs.splice(i, 1);
    const fallback = data.crosshairs[Math.min(i, data.crosshairs.length - 1)].id;
    data.profiles.forEach((p) => { if (p.crosshairId === c.id) p.crosshairId = fallback; });
    delete data.settings.crosshairBinds[c.id];
    syncAnimator();
    renderAll();
    commit();
  }

  function renderLibrary() {
    const q = $('#libSearch').value.trim().toLowerCase();
    fill($('#libCats'), 
      ...['All', ...XH.PRESET_CATEGORIES].map((c) =>
        h('button', { class: 'chip' + (libCat === c ? ' active' : ''), onclick: () => { libCat = c; renderLibrary(); } }, c)
      )
    );
    const items = XH.PRESETS.filter((p) => (libCat === 'All' || p.category === libCat) && (!q || p.name.toLowerCase().includes(q)));
    fill($('#libGrid'), 
      ...items.map((p) =>
        h('div', { class: 'lib-card', title: `Add "${p.name}" to My Crosshairs`, onclick: () => { addCrosshair(XH.duplicateCrosshair(p, p.name)); toast(`Added "${p.name}"`); } },
          thumb(p, 88, 64),
          h('div', { class: 'name' }, p.name),
          h('div', { class: 'add' }, '+ Add')
        )
      )
    );
    if (!items.length) $('#libGrid').append(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, 'No presets match.'));
  }

  // ======================================================================
  // Right: layers + inspector
  // ======================================================================
  const LAYER_TYPES = [
    ['lines', 'Lines'], ['dot', 'Dot'], ['ring', 'Ring'], ['shape', 'Shape'], ['text', 'Text'], ['image', 'Image'],
  ];

  function renderLayers() {
    const ch = cur();
    fill($('#addLayer'), 
      ...LAYER_TYPES.map(([t, label]) =>
        h('button', { class: 'btn', onclick: () => (t === 'image' ? pickFile('image/*', (url, img) => addLayer('image', imageSize(url, img))) : addLayer(t)) }, '+ ' + label)
      )
    );
    const list = $('#layerList');
    if (!ch.layers.length) {
      fill(list, h('li', { class: 'empty' }, 'No layers. Add one above.'));
      return;
    }
    // Topmost layer is listed first, like most design tools.
    fill(list, 
      ...ch.layers.slice().reverse().map((L) => {
        const i = ch.layers.indexOf(L);
        return h('li', { class: 'layer' + (L.id === selLayerId ? ' active' : '') + (L.visible === false ? ' off' : ''), onclick: () => { selLayerId = L.id; renderLayers(); renderInspector(); } },
          h('span', { class: 'sw', style: { background: L.type === 'image' ? '#888' : L.color } }),
          h('span', { class: 'lname' }, L.name || L.type),
          h('span', { class: 'ltype' }, L.type === 'shape' ? L.shape : L.type),
          h('button', { class: 'icon-btn', title: L.visible === false ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); L.visible = L.visible === false; changedLayer(true); } }, L.visible === false ? '◌' : '●'),
          h('button', { class: 'icon-btn', title: 'Move up', disabled: i === ch.layers.length - 1, onclick: (e) => { e.stopPropagation(); moveLayer(i, 1); } }, '↑'),
          h('button', { class: 'icon-btn', title: 'Move down', disabled: i === 0, onclick: (e) => { e.stopPropagation(); moveLayer(i, -1); } }, '↓'),
          h('button', { class: 'icon-btn', title: 'Duplicate', onclick: (e) => { e.stopPropagation(); duplicateLayer(L); } }, '⧉'),
          h('button', { class: 'icon-btn', title: 'Delete', onclick: (e) => { e.stopPropagation(); deleteLayer(L); } }, '✕')
        );
      })
    );
  }

  function addLayer(type, overrides = {}) {
    const ch = cur();
    const base = layer();
    const L = XH.newLayer(type, Object.assign({ color: base && base.type !== 'image' ? base.color : '#00ff66' }, overrides));
    ch.layers.push(L);
    selLayerId = L.id;
    changedLayer(true);
  }
  function duplicateLayer(L) {
    const c = XH.clone(L);
    c.id = XH.uid();
    c.name = (L.name || L.type) + ' copy';
    const ch = cur();
    ch.layers.splice(ch.layers.indexOf(L) + 1, 0, c);
    selLayerId = c.id;
    changedLayer(true);
  }
  function deleteLayer(L) {
    const ch = cur();
    const i = ch.layers.indexOf(L);
    ch.layers.splice(i, 1);
    selLayerId = ch.layers.length ? ch.layers[Math.max(0, i - 1)].id : null;
    changedLayer(true);
  }
  function moveLayer(i, dir) {
    const ls = cur().layers;
    const j = i + dir;
    if (j < 0 || j >= ls.length) return;
    [ls[i], ls[j]] = [ls[j], ls[i]];
    changedLayer(true);
  }
  function changedLayer(structural) {
    if (structural) { renderLayers(); renderInspector(); renderMine(); }
    else { renderLayers(); refreshActiveThumb(); }
    schedulePreview();
    commit();
  }

  function imageSize(url, img) {
    const max = 64;
    const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    return { src: url, width: Math.round((img.naturalWidth || max) * k), height: Math.round((img.naturalHeight || max) * k), name: 'Image' };
  }

  function pickFile(accept, cb) {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) return toast('That image is over 8 MB. Pick a smaller one.');
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => cb(reader.result, img);
        img.onerror = () => toast("Couldn't read that image.");
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    });
    input.click();
  }

  // ---------- field schema ----------
  const range = (key, label, min, max, step = 1, show) => ({ kind: 'range', key, label, min, max, step, show });
  const select = (key, label, options, show, rerender = false) => ({ kind: 'select', key, label, options, show, rerender });
  const check = (key, label, show, rerender = false) => ({ kind: 'check', key, label, show, rerender });
  const color = (key, label, show) => ({ kind: 'color', key, label, show });
  const text = (key, label, show) => ({ kind: 'text', key, label, show });

  const isShape = (...s) => (L) => s.includes(L.shape);
  const notShape = (...s) => (L) => !s.includes(L.shape);
  const segmented = (L) => L.segments > 1;

  const GEOMETRY = {
    lines: [
      range('arms', 'Arms', 2, 8, 1),
      range('length', 'Length', 0, 80, 0.5),
      range('width', 'Thickness', 0.5, 20, 0.5),
      range('gap', 'Gap', -20, 80, 0.5),
      select('tMode', 'T-shape', [['never', 'Off'], ['always', 'Always'], ['firing', 'While firing']]),
      check('rounded', 'Rounded ends'),
      range('bloom', 'Bloom amount', 0, 3, 0.1),
    ],
    dot: [
      range('size', 'Size', 0.5, 40, 0.5),
      select('shape', 'Shape', [['square', 'Square'], ['circle', 'Circle'], ['diamond', 'Diamond']]),
    ],
    ring: [
      range('radius', 'Radius', 1, 150, 0.5),
      range('thickness', 'Thickness', 0.5, 20, 0.5),
      range('segments', 'Segments', 0, 16, 1, null),
      range('segmentGap', 'Segment gap°', 0, 90, 1, segmented),
      range('segmentOffset', 'Rotate°', 0, 360, 1, segmented),
      check('rounded', 'Rounded ends', segmented),
      range('bloom', 'Bloom amount', 0, 3, 0.1),
    ],
    shape: [
      select('shape', 'Shape', [['chevron', 'Chevron'], ['triangle', 'Triangle'], ['arc', 'Arc'], ['rectangle', 'Rectangle'], ['tshape', 'T-shape'], ['corner', 'Corner bracket']], null, true),
      range('count', 'Count', 1, 12, 1),
      range('radius', 'Distance', -80, 150, 0.5),
      range('startAngle', 'Angle°', 0, 360, 1),
      range('width', 'Width', 0.5, 100, 0.5, notShape('arc')),
      range('height', 'Height', 0.5, 100, 0.5, notShape('arc')),
      range('arcAngle', 'Arc span°', 1, 359, 1, isShape('arc')),
      check('filled', 'Filled', isShape('triangle', 'rectangle'), true),
      range('thickness', 'Thickness', 0.5, 20, 0.5, (L) => !(['triangle', 'rectangle'].includes(L.shape) && L.filled)),
      check('inward', 'Point inward', isShape('triangle', 'chevron')),
      check('rounded', 'Rounded ends', isShape('arc')),
      range('bloom', 'Bloom amount', 0, 3, 0.1),
    ],
    text: [
      text('text', 'Text'),
      range('fontSize', 'Size', 4, 160, 1),
      select('fontFamily', 'Font', [
        ['system-ui', 'System'], ['ui-monospace, monospace', 'Monospace'], ['Impact, Haettenschweiler, sans-serif', 'Impact'],
        ['Georgia, serif', 'Serif'], ['"Arial Black", sans-serif', 'Arial Black'], ['"Comic Sans MS", cursive', 'Comic'],
      ]),
      select('fontWeight', 'Weight', [['400', 'Regular'], ['700', 'Bold'], ['900', 'Black']]),
    ],
    image: [
      { kind: 'image', label: 'Image' },
      range('width', 'Width', 1, 600, 1),
      range('height', 'Height', 1, 600, 1),
    ],
  };
  const APPEARANCE = [color('color', 'Color', (L) => L.type !== 'image'), range('opacity', 'Opacity', 0, 1, 0.01), range('blur', 'Blur', 0, 12, 0.1)];
  const OUTLINE = [
    check('outline.enabled', 'Outline', null, true),
    range('outline.thickness', 'Thickness', 0.5, 10, 0.5, (L) => L.outline.enabled),
    color('outline.color', 'Color', (L) => L.outline.enabled),
    range('outline.opacity', 'Opacity', 0, 1, 0.01, (L) => L.outline.enabled),
    range('outline.blur', 'Glow / blur', 0, 12, 0.1, (L) => L.outline.enabled),
  ];
  const TRANSFORM = [
    range('x', 'X', -300, 300, 0.5),
    range('y', 'Y', -300, 300, 0.5),
    range('rotation', 'Rotation°', -180, 180, 1),
    range('scale', 'Scale', 0.1, 6, 0.05),
  ];

  const QUICK_COLORS = ['#00ff66', '#00e5ff', '#ffe600', '#ff2a3d', '#ff3df2', '#ffffff', '#ff9a1f', '#b6ff00', '#9b5cff', '#000000'];

  // Builds one field bound to `target[key]`; `onChange(rerender)` runs after each edit.
  function buildField(f, target, onChange) {
    if (f.show && !f.show(target)) return null;
    const val = f.key ? getPath(target, f.key) : null;
    const set = (v, rerender) => { setPath(target, f.key, v); onChange(rerender || f.rerender); };
    switch (f.kind) {
      case 'range': {
        const num = h('input', { type: 'number', step: f.step, value: round(val, f.step) });
        const sl = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: val });
        sl.addEventListener('input', () => { num.value = sl.value; set(+sl.value); });
        num.addEventListener('input', () => {
          if (num.value === '' || isNaN(+num.value)) return;
          sl.value = num.value;
          set(+num.value);
        });
        return h('div', { class: 'field' }, h('label', {}, f.label), sl, num);
      }
      case 'select':
        return h('div', { class: 'field wide' }, h('label', {}, f.label),
          h('select', { onchange: (e) => set(isNaN(+e.target.value) || f.key !== 'fontWeight' ? e.target.value : +e.target.value) },
            ...f.options.map(([v, l]) => h('option', { value: v, selected: String(val) === String(v) }, l))));
      case 'check':
        return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => set(e.target.checked) }), f.label);
      case 'color': {
        const inp = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(val) ? val : '#ffffff' });
        inp.addEventListener('input', () => set(inp.value));
        return h('div', { class: 'field wide' }, h('label', {}, f.label),
          h('div', {}, inp),
          h('div', { class: 'quick-colors' },
            ...QUICK_COLORS.map((c) => h('button', { style: { background: c }, title: c, onclick: () => { inp.value = c; set(c); } }))));
      }
      case 'text': {
        const inp = h('input', { type: 'text', value: val || '' });
        inp.addEventListener('input', () => set(inp.value));
        return h('div', { class: 'field wide' }, h('label', {}, f.label), inp);
      }
      case 'image':
        return h('div', { class: 'field wide' }, h('label', {}, f.label),
          h('button', { class: 'btn small', onclick: () => pickFile('image/png,image/gif,image/jpeg,image/webp,image/svg+xml', (url, img) => { Object.assign(target, imageSize(url, img)); onChange(true); }) },
            target.src ? 'Replace image…' : 'Choose image…'));
    }
    return null;
  }

  const collapsed = new Set(JSON.parse(localStorageGet('xhs-collapsed') || '[]'));
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function section(title, fields, target, onChange, extra) {
    const body = h('div', { class: 'section-body' }, ...fields.map((f) => buildField(f, target, onChange)), extra || null);
    const sec = h('div', { class: 'section' + (collapsed.has(title) ? ' collapsed' : '') },
      h('div', { class: 'section-head', onclick: () => {
        sec.classList.toggle('collapsed');
        collapsed.has(title) ? collapsed.delete(title) : collapsed.add(title);
        try { localStorage.setItem('xhs-collapsed', JSON.stringify([...collapsed])); } catch {}
      } }, title, h('span', {}, '▾')),
      body);
    return sec;
  }

  function renderInspector() {
    const L = layer();
    const root = $('#inspector');
    if (!L) { fill(root); return; }
    const onChange = (rerender) => {
      // An arc at distance ~0 is invisible, so give it a usable radius when picked.
      if (L.type === 'shape' && L.shape === 'arc' && L.radius < 4) L.radius = 12;
      if (rerender) renderInspector();
      changedLayer(false);
    };
    const nameInput = h('input', { type: 'text', value: L.name || '' });
    nameInput.addEventListener('input', () => { L.name = nameInput.value; changedLayer(false); });
    const typeTitle = { lines: 'Lines', dot: 'Dot', ring: 'Ring', shape: 'Shape', text: 'Text', image: 'Image' }[L.type];
    fill(root, 
      h('div', { class: 'field wide', style: { marginTop: '4px' } }, h('label', {}, 'Layer name'), nameInput),
      section(typeTitle, GEOMETRY[L.type], L, onChange),
      section('Appearance', APPEARANCE, L, onChange),
      section('Outline', OUTLINE, L, onChange),
      section('Position', TRANSFORM, L, onChange,
        h('button', { class: 'btn small', onclick: () => { Object.assign(L, { x: 0, y: 0, rotation: 0, scale: 1 }); onChange(true); } }, 'Reset position'))
    );
  }

  // ======================================================================
  // Animations
  // ======================================================================
  const TRIGGERS = [['left', 'Left click (fire)'], ['right', 'Right click (aim)'], ['middle', 'Middle click'], ['mouse4', 'Mouse 4'], ['mouse5', 'Mouse 5']];
  const PROP_INFO = { spread: ['Spread', 1, 0], scale: ['Scale', 0.05, 1], opacity: ['Opacity', 0.05, 1], rotation: ['Rotate°', 1, 0] };

  const ANIM_TEMPLATES = {
    'Bloom': () => XH.bloomAnimation(6),
    'Recoil kick': () => ({ name: 'Recoil kick', trigger: 'left', mode: 'once', stages: [{ duration: 45, easing: 'easeOut', spread: 5, scale: 1.08 }], releaseDuration: 220, releaseEasing: 'easeOut' }),
    'Pulse': () => ({ name: 'Pulse', trigger: 'left', mode: 'once', stages: [{ duration: 70, easing: 'easeOut', scale: 1.4, opacity: 0.7 }], releaseDuration: 280, releaseEasing: 'elasticOut' }),
    'Spin': () => ({ name: 'Spin', trigger: 'left', mode: 'once', stages: [{ duration: 260, easing: 'backOut', rotation: 90 }], releaseDuration: 0, releaseEasing: 'step' }),
    'Fade on aim': () => ({ name: 'Fade while aiming', trigger: 'right', mode: 'hold', stages: [{ duration: 140, easing: 'easeOut', opacity: 0.2 }], releaseDuration: 140, releaseEasing: 'easeOut' }),
    'Blank': () => ({ name: 'New animation', trigger: 'left', mode: 'once', stages: [{ duration: 100, easing: 'easeOut' }], releaseDuration: 150, releaseEasing: 'easeOut' }),
  };

  function easePreview(name) {
    const fn = XH.getEasing(name);
    let d = '';
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      d += (i ? 'L' : 'M') + (t * 40).toFixed(1) + ',' + (24 - fn(t) * 20).toFixed(1);
    }
    const el = h('span', { class: 'ease-preview' });
    el.innerHTML = `<svg viewBox="0 0 40 28" width="40" height="28"><path d="M0,24H40M0,4H40" stroke="#323844" stroke-width="1"/><path d="${d}" fill="none" stroke="#3dfc8b" stroke-width="1.5"/></svg>`;
    return el;
  }

  function easingField(target, key, onChange) {
    const val = target[key] || 'linear';
    const isCustom = !XH.EASING_NAMES.includes(val);
    const sel = h('select', {},
      ...XH.EASING_NAMES.map((n) => h('option', { value: n, selected: n === val }, n)),
      h('option', { value: '__custom', selected: isCustom }, 'custom curve…'));
    const custom = h('input', { type: 'text', value: isCustom ? val : 'cubic-bezier(0.2, 0.8, 0.2, 1)', placeholder: 'cubic-bezier(x1, y1, x2, y2)', style: { display: isCustom ? '' : 'none', width: '100%' } });
    sel.addEventListener('change', () => {
      target[key] = sel.value === '__custom' ? custom.value : sel.value;
      onChange(true);
    });
    custom.addEventListener('change', () => { target[key] = custom.value.trim(); onChange(true); });
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 } },
      h('div', { class: 'row gap' }, sel, easePreview(val)), custom);
  }

  function numberInput(value, step, onInput, attrs = {}) {
    const inp = h('input', Object.assign({ type: 'number', step, value }, attrs));
    inp.addEventListener('input', () => { if (inp.value !== '' && !isNaN(+inp.value)) onInput(+inp.value); });
    return inp;
  }

  function renderAnimations() {
    const ch = cur();
    const onChange = (rerender) => {
      if (rerender) renderAnimations();
      animator.setCrosshair(ch);
      renderMine();
      schedulePreview();
      commit();
    };
    fill($('#addAnim'), 
      ...Object.entries(ANIM_TEMPLATES).map(([label, make]) =>
        h('button', { class: 'btn', onclick: () => { ch.animations.push(XH.normalizeCrosshair({ animations: [make()] }).animations[0]); onChange(true); } }, '+ ' + label)
      )
    );
    const list = $('#animList');
    if (!ch.animations.length) {
      fill(list, h('div', { class: 'empty' }, 'No animations. Add one above, then click the preview to test it.'),
        h('p', { class: 'note' }, 'Animations react to mouse buttons. "Play once" runs every stage then eases back. "Hold" keeps the last stage while the button is held, which is how bloom works.'));
      return;
    }
    fill(list, 
      ...ch.animations.map((a, ai) => {
        const nameIn = h('input', { type: 'text', value: a.name });
        nameIn.addEventListener('input', () => { a.name = nameIn.value; commit(); });
        const stages = a.stages.map((s, si) =>
          h('div', { class: 'stage-card' },
            h('div', { class: 'stage-card-head' }, `Stage ${si + 1}`,
              h('button', { class: 'icon-btn', title: 'Remove stage', disabled: a.stages.length === 1, onclick: () => { a.stages.splice(si, 1); onChange(true); } }, '✕')),
            h('div', { class: 'field wide' }, h('label', {}, 'Duration ms'), numberInput(s.duration, 10, (v) => { s.duration = Math.max(0, v); onChange(); }, { min: 0 })),
            h('div', { class: 'field wide' }, h('label', {}, 'Easing'), easingField(s, 'easing', onChange)),
            h('div', { class: 'prop-grid' },
              ...Object.entries(PROP_INFO).map(([p, [label, step, def]]) => {
                const on = s[p] != null;
                const num = numberInput(on ? s[p] : def, step, (v) => { s[p] = v; onChange(); }, { disabled: !on });
                return h('label', { class: 'prop', title: `Animate ${label.toLowerCase()} to this value` },
                  h('input', { type: 'checkbox', checked: on, onchange: (e) => { if (e.target.checked) s[p] = def === 0 ? (p === 'spread' ? 5 : 45) : def === 1 && p === 'scale' ? 1.3 : 0.3; else delete s[p]; onChange(true); } }),
                  label, num);
              }))
          )
        );
        return h('div', { class: 'anim-card' },
          h('div', { class: 'anim-head' },
            h('input', { type: 'checkbox', checked: a.enabled !== false, title: 'Enabled', onchange: (e) => { a.enabled = e.target.checked; onChange(); }, style: { accentColor: 'var(--accent)' } }),
            nameIn,
            h('button', { class: 'icon-btn', title: 'Delete animation', onclick: () => { ch.animations.splice(ai, 1); onChange(true); } }, '✕')),
          h('div', { class: 'anim-body' },
            h('div', { class: 'field wide' }, h('label', {}, 'Trigger'),
              h('select', { onchange: (e) => { a.trigger = e.target.value; onChange(); } }, ...TRIGGERS.map(([v, l]) => h('option', { value: v, selected: a.trigger === v }, l)))),
            h('div', { class: 'field wide' }, h('label', {}, 'Mode'),
              h('select', { onchange: (e) => { a.mode = e.target.value; onChange(); } },
                h('option', { value: 'once', selected: a.mode !== 'hold' }, 'Play once per press'),
                h('option', { value: 'hold', selected: a.mode === 'hold' }, 'Hold while pressed'))),
            ...stages,
            h('button', { class: 'btn small', onclick: () => { a.stages.push({ duration: 100, easing: 'easeOut' }); onChange(true); } }, '+ Add stage'),
            h('div', { class: 'field wide' }, h('label', {}, a.mode === 'hold' ? 'Release ms' : 'Return ms'), numberInput(a.releaseDuration, 10, (v) => { a.releaseDuration = Math.max(0, v); onChange(); }, { min: 0 })),
            h('div', { class: 'field wide' }, h('label', {}, 'Return easing'), easingField(a, 'releaseEasing', onChange)),
            h('button', { class: 'btn small', onmousedown: () => { animator.press(a.trigger); schedulePreview(); }, onmouseup: () => { animator.release(a.trigger); schedulePreview(); }, onmouseleave: () => { animator.release(a.trigger); schedulePreview(); } }, '▶ Test (hold to test hold mode)')
          )
        );
      })
    );
  }

  // ======================================================================
  // Behavior
  // ======================================================================
  function renderBehavior() {
    const ch = cur();
    const p = prof();
    const onCh = (rerender) => { if (rerender) renderBehavior(); animator.setCrosshair(ch); schedulePreview(); refreshActiveThumb(); commit(); };
    const onProf = () => { renderBehavior(); commit(); };
    const nudge = (dx, dy) => { p.offsetX = (p.offsetX || 0) + dx; p.offsetY = (p.offsetY || 0) + dy; onProf(); };

    const status = inputStatus.available
      ? h('p', { class: 'note ok' }, '✓ Mouse triggers are active. Fire and aim animations will play in game.')
      : h('div', {},
          h('p', { class: 'note warn' }, inputStatus.error || 'Mouse triggers are unavailable.'),
          api.isElectron && isMac ? h('button', { class: 'btn small', onclick: async () => { await api.requestInputAccess(); toast('After granting access, restart Crosshair Studio.'); } }, 'Open Accessibility prompt') : null);

    fill($('#behavior'), 
      section('Crosshair', [range('opacity', 'Opacity', 0, 1, 0.01), check('pixelSnap', 'Pixel-perfect edges')], ch, onCh),
      section('Aim down sights', [
        check('hideOnADS', 'Hide while aiming (right-click)', null, true),
        select('adsMode', 'Aim mode', [['hold', 'Hold right-click'], ['toggle', 'Toggle on right-click']], (c) => c.hideOnADS),
      ], ch, onCh),
      section(`Position — ${p.name}`, [range('offsetX', 'Offset X', -500, 500, 1), range('offsetY', 'Offset Y', -500, 500, 1)], p, () => commit(),
        h('div', { class: 'row gap', style: { flexWrap: 'wrap' } },
          h('button', { class: 'btn small', onclick: () => nudge(-1, 0) }, '← 1px'),
          h('button', { class: 'btn small', onclick: () => nudge(0, -1) }, '↑ 1px'),
          h('button', { class: 'btn small', onclick: () => nudge(0, 1) }, '↓ 1px'),
          h('button', { class: 'btn small', onclick: () => nudge(1, 0) }, '→ 1px'),
          h('button', { class: 'btn small', onclick: () => { p.offsetX = 0; p.offsetY = 0; onProf(); } }, 'Center'))),
      section('Mouse triggers', [], {}, () => {}, status),
      api.isElectron ? null : h('p', { class: 'note' }, 'You are viewing the editor in a browser. Run the desktop app (npm start) to draw the crosshair over games.')
    );
  }

  // ======================================================================
  // Modals: share, import, export, hotkeys, profiles
  // ======================================================================
  function modal(title, body, actions = []) {
    const root = $('#modalRoot');
    const close = () => { fill(root); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    const box = h('div', { class: 'modal', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'modal-head' }, title, h('button', { class: 'icon-btn', onclick: close }, '✕')),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-foot' }, ...actions.map((a) => h('button', { class: 'btn' + (a.primary ? ' primary' : ''), onclick: () => a.onClick(close) }, a.label))));
    fill(root, box);
    root.onclick = close;
    return close;
  }

  async function openShare() {
    const code = await XH.encodeShareCode(cur());
    const ta = h('textarea', { readOnly: true, value: code });
    const hasImage = cur().layers.some((l) => l.type === 'image' && l.src);
    modal('Share code', [
      h('p', { class: 'note' }, 'Anyone with Crosshair Studio can paste this code into "Import code" to get an exact copy.'),
      ta,
      hasImage ? h('p', { class: 'note warn' }, 'This crosshair contains an image, so the code is long.') : null,
    ], [
      { label: 'Close', onClick: (c) => c() },
      { label: 'Copy code', primary: true, onClick: async (c) => { await navigator.clipboard.writeText(code).catch(() => { ta.select(); document.execCommand('copy'); }); toast('Share code copied'); c(); } },
    ]);
    ta.select();
  }

  function openImport() {
    const ta = h('textarea', { placeholder: 'Paste a share code (starts with XHS1.)' });
    const err = h('p', { class: 'note warn' });
    modal('Import a crosshair', [ta, err], [
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Import', primary: true, onClick: async (c) => {
        try {
          const ch = await XH.decodeShareCode(ta.value);
          c();
          addCrosshair(ch);
          toast(`Imported "${ch.name}"`);
        } catch (e) {
          err.textContent = e.message.startsWith('Not a') ? e.message : "That code couldn't be read. Make sure you copied all of it.";
        }
      } },
    ]);
    setTimeout(() => ta.focus(), 0);
  }

  // Bounding box of the crosshair at rest, padded for outline/blur, as an odd pixel size so the center lands on a pixel.
  function exportSize(ch) {
    const tmp = h('div', { style: { position: 'absolute', left: '-9999px', top: '0' }, html: XH.renderSVG(ch, null, { size: 2000, idPrefix: 'bb' }) });
    document.body.append(tmp);
    let ext = 16;
    try {
      const b = tmp.querySelector('svg > g').getBBox();
      ext = Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.width), Math.abs(b.y + b.height));
    } catch {}
    tmp.remove();
    const pad = Math.max(0, ...ch.layers.map((L) => (L.outline.enabled ? L.outline.thickness + L.outline.blur * 3 : 0) + L.blur * 3)) + 2;
    return Math.ceil(ext + pad) * 2 + 1;
  }

  function svgToPng(svg, px) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = px;
        c.getContext('2d').drawImage(img, 0, 0, px, px);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function openExport() {
    const ch = cur();
    const size = exportSize(ch);
    let fmt = 'png', scale = 1;
    const info = h('p', { class: 'note' });
    const prev = h('div', { class: 'thumb', style: { width: '120px', height: '120px', background: BACKGROUNDS.checker.css } });
    const update = () => {
      info.textContent = fmt === 'png' ? `${size * scale} × ${size * scale} px, transparent background` : `Vector SVG, ${size} × ${size} units`;
      prev.innerHTML = XH.renderSVG(ch, null, { size, pixelSize: 120, idPrefix: 'ex' });
    };
    const segBtns = (opts, get, setv) => {
      const seg = h('div', { class: 'seg' });
      const draw = () => fill(seg, ...opts.map(([v, l]) => h('button', { class: get() === v ? 'active' : '', onclick: () => { setv(v); draw(); update(); } }, l)));
      draw();
      return seg;
    };
    const scaleRow = h('div', { class: 'field wide' }, h('label', {}, 'Scale'), segBtns([[1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], () => scale, (v) => (scale = v)));
    update();
    modal('Export image', [
      h('div', { class: 'row gap', style: { alignItems: 'flex-start' } }, prev,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 } },
          h('div', { class: 'field wide' }, h('label', {}, 'Format'), segBtns([['png', 'PNG'], ['svg', 'SVG']], () => fmt, (v) => { fmt = v; scaleRow.style.display = v === 'png' ? '' : 'none'; })),
          scaleRow, info)),
    ], [
      { label: 'Cancel', onClick: (c) => c() },
      { label: 'Save…', primary: true, onClick: async (c) => {
        const base = (ch.name || 'crosshair').replace(/[^\w\- ]+/g, '').trim() || 'crosshair';
        const svg = XH.renderSVG(ch, null, { size, pixelSize: fmt === 'png' ? size * scale : size, idPrefix: 'ex' });
        try {
          const res = fmt === 'svg'
            ? await api.saveFile({ defaultName: base + '.svg', content: svg, encoding: 'utf8', filters: [{ name: 'SVG image', extensions: ['svg'] }] })
            : await api.saveFile({ defaultName: base + '.png', content: await svgToPng(svg, size * scale), encoding: 'base64', filters: [{ name: 'PNG image', extensions: ['png'] }] });
          if (res.ok) { toast('Exported'); c(); }
        } catch (e) {
          toast('Export failed: ' + (e.message || e));
        }
      } },
    ]);
  }

  function openProfiles() {
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    const draw = () => {
      fill(body, 
        h('p', { class: 'note' }, 'Each game profile remembers its own crosshair, monitor and position offset. Switch profiles from the top bar or the tray menu.'),
        ...data.profiles.map((p) => {
          const inp = h('input', { type: 'text', value: p.name });
          inp.addEventListener('input', () => { p.name = inp.value || 'Untitled'; renderHeader(); renderMine(); renderBehavior(); commit(); });
          return h('div', { class: 'profile-row' }, inp,
            h('button', { class: 'btn small', disabled: p.id === data.activeProfileId, onclick: () => { data.activeProfileId = p.id; syncAnimator(); renderAll(); commit(); draw(); } }, p.id === data.activeProfileId ? 'Active' : 'Use'),
            h('button', { class: 'btn small danger', disabled: data.profiles.length === 1, onclick: () => {
              data.profiles.splice(data.profiles.indexOf(p), 1);
              if (data.activeProfileId === p.id) data.activeProfileId = data.profiles[0].id;
              syncAnimator(); renderAll(); commit(); draw();
            } }, 'Delete'));
        }),
        h('button', { class: 'btn small', onclick: () => {
          const np = { id: XH.uid(), name: 'Game ' + (data.profiles.length + 1), crosshairId: cur().id, offsetX: 0, offsetY: 0, displayId: prof().displayId, scope: XH.clone(prof().scope) };
          data.profiles.push(np);
          renderHeader(); commit(); draw();
        } }, '+ Add game profile'));
    };
    draw();
    modal('Game profiles', body, [{ label: 'Done', primary: true, onClick: (c) => c() }]);
  }

  // ======================================================================
  // Wiring
  // ======================================================================
  function switchTab(group, tab) {
    document.querySelectorAll(`[data-tabs="${group}"] .tab`).forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const panel = document.querySelector(`[data-tabs="${group}"]`).parentElement;
    panel.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.dataset.body !== tab));
    if (tab === 'scope') XH.ScopeTab.render(scopeCtx); // refreshes permission status
    schedulePreview();
  }

  // Helpers the Scope tab (scope-tab.js) and Settings view (settings-view.js) build their UI with.
  const scopeCtx = {
    h, fill, section, F: { range, select, check, color }, prof, commit, toast, api, isMac, bgCss, thumb,
    data: () => data,
    inputStatus: () => inputStatus,
    schedulePreview: () => schedulePreview(),
    openProfiles: () => openProfiles(),
    openScopeTab: () => { setView('editor'); switchTab('right', 'scope'); },
  };

  // Top-level views: the editor, or the settings page.
  function setView(view) {
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('.app').classList.toggle('hidden', view !== 'editor');
    $('#settingsView').classList.toggle('hidden', view !== 'settings');
    if (view === 'settings') XH.SettingsView.open(scopeCtx);
    else schedulePreview();
  }

  function renderAll() {
    renderHeader();
    renderMine();
    renderLibrary();
    renderLayers();
    renderInspector();
    renderAnimations();
    renderBehavior();
    XH.ScopeTab.render(scopeCtx);
    XH.SettingsView.render(scopeCtx);
    renderStageControls();
    $('#nameInput').value = cur().name;
    schedulePreview();
  }

  function bindStatic() {
    document.querySelectorAll('.tabs').forEach((tabs) =>
      tabs.addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) switchTab(tabs.dataset.tabs, t.dataset.tab); }));
    $('#newBtn').onclick = () => addCrosshair(XH.newCrosshair({ name: 'Crosshair ' + (data.crosshairs.length + 1) }));
    $('#importBtn').onclick = openImport;
    $('#newImgBtn').onclick = () => pickFile('image/png,image/gif,image/jpeg,image/webp,image/svg+xml', (url, img) => {
      const L = XH.newLayer('image', imageSize(url, img));
      addCrosshair(XH.newCrosshair({ name: 'Image crosshair', layers: [L] }));
    });
    $('#mineSearch').oninput = renderMine;
    $('#libSearch').oninput = renderLibrary;
    $('#nameInput').oninput = (e) => { cur().name = e.target.value; renderMine(); commit(); };
    $('#undoBtn').onclick = undo;
    $('#redoBtn').onclick = redo;
    $('#shareBtn').onclick = openShare;
    $('#exportBtn').onclick = openExport;
    document.querySelectorAll('#viewSeg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    $('#manageProfilesBtn').onclick = openProfiles;
    $('#profileSelect').onchange = (e) => { data.activeProfileId = e.target.value; syncAnimator(); renderAll(); commit(); };
    $('#displaySelect').onchange = (e) => { prof().displayId = e.target.value === '' ? null : +e.target.value; commit(); };
    $('#overlayToggle').onchange = (e) => { data.settings.overlayVisible = e.target.checked; commit(); };

    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || $('#modalRoot').childElementCount;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
      if (typing) return;
      const L = layer();
      if (!L) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteLayer(L); return; }
      const step = e.shiftKey ? 5 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) { e.preventDefault(); L.x += mv[0]; L.y += mv[1]; renderInspector(); changedLayer(false); }
    });
  }

  async function init() {
    data = XH.normalizeData(await api.load());
    try { displays = await api.listDisplays(); } catch {}
    try { inputStatus = await api.inputStatus(); } catch {}
    syncAnimator();
    bindStatic();
    bindStage();
    renderAll();
    snapshot();
    scheduleSave(); // first run: persist defaults so the overlay has something to draw
    api.onDataChanged((d) => {
      // Changes made from hotkeys or the tray.
      data = XH.normalizeData(d);
      syncAnimator();
      renderAll();
      snapshot();
    });
  }

  init();
})();
