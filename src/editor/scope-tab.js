// Scope tab: zoom lens settings, keybinds and the in-editor lens preview.
// Uses the editor's helpers through `ctx` (see editor.js).
(function () {
  const XH = (window.XH = window.XH || {});

  const PREVIEW_KEY = 'xhs-scope-preview';
  let previewOn = true;
  try { previewOn = localStorage.getItem(PREVIEW_KEY) !== '0'; } catch {}

  const BIND_ROWS = [
    ['toggle', 'Toggle zoom', 'Press once to turn the lens on, again to turn it off.'],
    ['hold', 'Hold to zoom', 'The lens is on only while this is held.'],
    ['zoomIn', 'Zoom in', 'Adds the zoom step. Only works while the lens is on.'],
    ['zoomOut', 'Zoom out', 'Subtracts the zoom step. Only works while the lens is on.'],
    ['setZoom', 'Set zoom', 'Jumps to the "Set zoom to" level.'],
    ['reset', 'Reset zoom', 'Back to the default zoom level.'],
    ['follow', 'Switch follow / fixed', 'Swaps between a fixed lens and one that follows the cursor.'],
  ];
  const { recordBind, prettyBind } = XH.BindUI;

  const isVisible = () => {
    const body = document.querySelector('[data-body="scope"]');
    return body && !body.classList.contains('hidden');
  };

  // ---------- status ----------
  async function renderStatus(ctx, box) {
    const { h, fill, api, isMac, toast } = ctx;
    if (!api.isElectron || !api.scopeStatus) {
      fill(box, h('p', { class: 'note' }, 'The live zoom lens runs in the desktop app (npm start). Here you can set it up and preview it on the stage.'));
      return;
    }
    let st = {};
    try { st = await api.scopeStatus(); } catch {}
    const lines = [];
    if (isMac && st.screen !== 'granted') {
      lines.push(h('p', { class: 'note warn' }, 'The lens needs Screen Recording access to see your game.'),
        h('button', { class: 'btn small', onclick: async () => { await api.requestScreenAccess(); toast('Allow Crosshair Studio under Screen Recording, then restart it.'); } }, 'Request Screen Recording access'));
    }
    if (!st.hook) {
      lines.push(h('p', { class: 'note warn' },
        'Mouse-button binds, hold-to-zoom, scroll zoom and the Esc kill switch need global input access. Without it, keyboard binds still work (hold acts as toggle).'));
      if (isMac) lines.push(h('button', { class: 'btn small', onclick: async () => { await api.requestInputAccess(); toast('After granting Accessibility access, restart Crosshair Studio.'); } }, 'Open Accessibility prompt'));
    }
    if (st.error) lines.push(h('p', { class: 'note warn' }, st.error));
    if (!lines.length) lines.push(h('p', { class: 'note ok' }, '✓ Ready. Use your binds in game to zoom.'));
    fill(box, ...lines);
  }

  // ---------- tab ----------
  function render(ctx) {
    const { h, fill, section, F, prof, commit, schedulePreview, isMac, toast } = ctx;
    const root = document.getElementById('scopePanel');
    if (!root) return;
    const sc = prof().scope;
    const onChange = (rerender) => { if (rerender) render(ctx); schedulePreview(); commit(); };

    const enable = h('label', { class: 'switch big' },
      h('input', { type: 'checkbox', checked: sc.enabled, onchange: (e) => { sc.enabled = e.target.checked; onChange(true); } }),
      h('span', { class: 'switch-track' }),
      h('span', { class: 'switch-label' }, 'Enable Scope'));
    const preview = h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: previewOn, onchange: (e) => { previewOn = e.target.checked; try { localStorage.setItem(PREVIEW_KEY, previewOn ? '1' : '0'); } catch {} schedulePreview(); } }),
      'Preview lens on the stage');
    const statusBox = h('div', {});
    renderStatus(ctx, statusBox);

    const shapeIs = (...s) => (t) => s.includes(t.shape);
    const bindRows = BIND_ROWS.map(([key, label, tip]) => {
      const btn = h('button', { class: 'bind-btn', title: 'Click, then press a key or mouse button' }, prettyBind(sc.binds[key], isMac));
      btn.onclick = () => recordBind(btn, isMac, (bind, cancelled) => {
        if (!cancelled) {
          sc.binds[key] = bind;
          // One input should do one thing: clear it from any other scope action.
          if (bind) for (const [other] of BIND_ROWS) if (other !== key && JSON.stringify(sc.binds[other]) === JSON.stringify(bind)) sc.binds[other] = null;
          commit();
          if (bind) toast(`${label}: ${prettyBind(bind, isMac)}`);
        }
        render(ctx);
      });
      const row = h('div', { class: 'bind-row', title: tip },
        h('span', {}, label), btn,
        h('button', { class: 'icon-btn', title: 'Clear', onclick: () => { sc.binds[key] = null; onChange(true); } }, '✕'));
      if (key !== 'hold') return row;
      const delay = h('input', { type: 'number', min: 0, step: 10, value: sc.holdDelay });
      delay.addEventListener('input', () => { if (delay.value !== '' && !isNaN(+delay.value)) { sc.holdDelay = Math.max(0, +delay.value); commit(); } });
      return h('div', {}, row, h('div', { class: 'field wide sub' }, h('label', {}, 'Hold delay ms'), delay));
    });

    fill(root,
      h('div', { class: 'scope-head' }, enable, preview),
      statusBox,
      section('Zoom', [
        F.range('zoom', 'Zoom level', 1.1, 20, 0.1),
        F.range('zoomStep', 'Zoom step', 0.1, 5, 0.1),
        F.range('setZoomValue', 'Set zoom to', 1.1, 20, 0.1),
        F.check('wheelZoom', 'Scroll wheel zooms while the lens is on (the game still gets the scroll too)'),
        F.check('animate', 'Animate zoom', null, true),
        F.range('animMs', 'Animation ms', 0, 1000, 10, (t) => t.animate),
      ], sc, onChange),
      section('Lens shape', [
        F.select('shape', 'Shape', [['circle', 'Circle'], ['square', 'Square'], ['rectangle', 'Rectangle'], ['custom', 'Custom']], null, true),
        F.range('size', 'Size', 40, 1400, 1, shapeIs('circle', 'square')),
        F.range('width', 'Width', 40, 2400, 1, shapeIs('rectangle', 'custom')),
        F.range('height', 'Height', 40, 1600, 1, shapeIs('rectangle', 'custom')),
        F.range('roundness', 'Roundness', 0, 800, 1, shapeIs('custom')),
        F.range('edgeFeather', 'Edge softness', 0, 60, 0.5),
      ], sc, onChange),
      section('Focus ring', [
        F.check('outline.enabled', 'Show ring', null, true),
        F.range('outline.thickness', 'Thickness', 0.5, 24, 0.5, (t) => t.outline.enabled),
        F.color('outline.color', 'Color', (t) => t.outline.enabled),
        F.range('outline.opacity', 'Opacity', 0, 1, 0.01, (t) => t.outline.enabled),
        F.range('outline.feather', 'Feather', 0, 24, 0.5, (t) => t.outline.enabled),
      ], sc, onChange),
      section('Background', [
        F.check('dim.enabled', 'Dim outside the lens', null, true),
        F.color('dim.color', 'Color', (t) => t.dim.enabled),
        F.range('dim.opacity', 'Opacity', 0, 1, 0.01, (t) => t.dim.enabled),
      ], sc, onChange),
      section('Lens effects', [
        F.check('distortion', 'Convex lens distortion', null, true),
        F.range('distortionStrength', 'Strength', 0.05, 0.9, 0.01, (t) => t.distortion),
        F.range('brightness', 'Brightness', 0.2, 2, 0.01),
        F.range('contrast', 'Contrast', 0.2, 2.5, 0.01),
        F.range('saturation', 'Saturation', 0, 2.5, 0.01),
        F.range('sharpen', 'Sharpen', 0, 2, 0.05),
      ], sc, onChange,
        h('button', { class: 'btn small', onclick: () => { Object.assign(sc, { brightness: 1, contrast: 1, saturation: 1, sharpen: 0 }); onChange(true); } }, 'Reset filters')),
      section('Position', [
        F.select('position', 'Lens', [['fixed', 'Fixed position'], ['follow', 'Follow cursor']], null, true),
        F.range('offsetX', 'Offset X', -1500, 1500, 1, (t) => t.position === 'fixed'),
        F.range('offsetY', 'Offset Y', -1000, 1000, 1, (t) => t.position === 'fixed'),
        F.select('crosshair', 'Crosshair', [['show', 'Keep on top of the lens'], ['hide', 'Hide while zoomed']]),
      ], sc, onChange,
        sc.position === 'fixed'
          ? h('button', { class: 'btn small', onclick: () => { sc.offsetX = 0; sc.offsetY = 0; onChange(true); } }, 'Center lens')
          : h('p', { class: 'note' }, 'The lens magnifies whatever is under your cursor.')),
      section('Keybinds', [], sc, onChange,
        h('div', { class: 'bind-table' }, ...bindRows,
          h('p', { class: 'note' }, 'Click a bind, then press a key, a key combo, or right / middle / side mouse button. Esc cancels, Backspace clears. Hold Esc for 3 seconds in game to hide everything.'))),
      section('Graphics', [
        F.select('quality', 'Quality', [
          ['ultraPerformance', 'Ultra Performance'], ['performance', 'Performance'], ['balanced', 'Balanced'], ['quality', 'Quality'], ['ultra', 'Ultra'],
        ]),
        F.check('vsync', 'VSync (turn off for lower latency, experimental)'),
        F.check('keepWarm', 'Keep capture running for instant zoom'),
      ], sc, onChange,
        h('p', { class: 'note' }, 'Lower quality captures fewer frames at a lower resolution and is lighter on slower PCs. Ultra captures up to 120 fps at full resolution.'))
    );
  }

  // ---------- stage preview ----------
  function preview(ctx) {
    const el = document.getElementById('stageLens');
    const stage = document.getElementById('stage');
    if (!el || !stage) return;
    const sc = ctx.prof().scope;
    if (!isVisible() || !previewOn) { el.hidden = true; return; }
    el.hidden = false;
    const W = stage.clientWidth, H = stage.clientHeight;
    let hw, hh, radius;
    switch (sc.shape) {
      case 'square': hw = hh = sc.size / 2; radius = '0'; break;
      case 'rectangle': hw = sc.width / 2; hh = sc.height / 2; radius = '0'; break;
      case 'custom': hw = sc.width / 2; hh = sc.height / 2; radius = Math.min(sc.roundness, hw, hh) + 'px'; break;
      default: hw = hh = sc.size / 2; radius = '50%';
    }
    const fixed = sc.position === 'fixed';
    const cx = W / 2 + (fixed ? sc.offsetX : 0);
    const cy = H / 2 + (fixed ? sc.offsetY : 0);
    const hex2rgba = (hex, a) => {
      const n = parseInt((hex || '#ffffff').slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };
    const shadows = [];
    if (sc.outline.enabled) shadows.push(`0 0 ${sc.outline.feather}px ${sc.outline.thickness}px ${hex2rgba(sc.outline.color, sc.outline.opacity)}`);
    if (sc.dim.enabled) shadows.push(`0 0 0 4000px ${hex2rgba(sc.dim.color, sc.dim.opacity)}`);
    Object.assign(el.style, {
      left: cx - hw + 'px', top: cy - hh + 'px', width: hw * 2 + 'px', height: hh * 2 + 'px',
      borderRadius: radius, boxShadow: shadows.join(', ') || 'none',
    });
    const inner = el.firstElementChild;
    Object.assign(inner.style, {
      background: ctx.bgCss(),
      width: W + 'px', height: H + 'px',
      left: -(cx - hw) + 'px', top: -(cy - hh) + 'px',
      transformOrigin: `${cx}px ${cy}px`,
      transform: `scale(${sc.zoom})`,
      filter: `brightness(${sc.brightness}) contrast(${sc.contrast}) saturate(${sc.saturation})`,
    });
    el.lastElementChild.textContent = `${sc.zoom.toFixed(1)}×${fixed ? '' : ' · follows cursor'}${sc.enabled ? '' : ' · scope off'}`;
  }

  XH.ScopeTab = { render, preview };
})();
