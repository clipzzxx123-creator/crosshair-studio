// Settings view: app hotkeys, per-crosshair switch binds, startup and general options.
// Uses the editor's helpers through `ctx` (see editor.js).
(function () {
  const XH = (window.XH = window.XH || {});
  const { recordBind, prettyBind, sameBind } = XH.BindUI;

  const APP_BINDS = [
    ['toggle', 'Show / hide crosshair'],
    ['next', 'Next crosshair'],
    ['prev', 'Previous crosshair'],
    ['center', 'Re-center position'],
  ];
  const SCOPE_LABELS = {
    toggle: 'Scope: toggle zoom', hold: 'Scope: hold to zoom', zoomIn: 'Scope: zoom in', zoomOut: 'Scope: zoom out',
    setZoom: 'Scope: set zoom', reset: 'Scope: reset zoom', follow: 'Scope: follow / fixed',
  };

  let appInfo = null;
  let update = null; // auto-update state from the main process
  let listening = false;

  function updateCard(ctx) {
    const { h, api } = ctx;
    const version = appInfo && appInfo.version ? appInfo.version : '';
    if (!api.getUpdate || !update) return card(h, 'Updates', h('p', { class: 'note' }, `Version ${version || 'unknown'}. Automatic updates run in the installed Windows app.`));
    const lines = {
      idle: 'Updates are checked when the app starts and every 4 hours.',
      checking: 'Checking for updates…',
      latest: 'You have the latest version.',
      downloading: `Downloading version ${update.version || ''}… ${update.progress || 0}%`,
      ready: `Version ${update.version} is ready. Restart to install it. It also installs the next time you quit.`,
      error: `Couldn't check for updates: ${update.error || 'unknown error'}`,
      unsupported: update.reason || 'Automatic updates aren\'t available here.',
    };
    const cls = update.status === 'ready' ? 'note ok' : update.status === 'error' ? 'note warn' : 'note';
    return card(h, 'Updates',
      h('p', { class: 'note' }, `Crosshair Studio ${version}`),
      h('p', { class: cls }, lines[update.status] || ''),
      update.status === 'ready'
        ? h('button', { class: 'btn primary small', onclick: () => api.installUpdate() }, 'Restart and update')
        : update.status !== 'unsupported'
          ? h('button', { class: 'btn small', disabled: update.status === 'checking' || update.status === 'downloading', onclick: async () => { update = await api.checkUpdate(); render(ctx); } }, 'Check for updates')
          : null);
  }

  // Every bind in use, with a label, so duplicates can be flagged.
  function allBinds(ctx) {
    const d = ctx.data();
    const out = [];
    for (const [k, label] of APP_BINDS) if (d.settings.binds[k]) out.push({ id: 'app:' + k, label, bind: d.settings.binds[k] });
    for (const [id, cb] of Object.entries(d.settings.crosshairBinds)) {
      const ch = d.crosshairs.find((c) => c.id === id);
      if (ch && cb.bind) out.push({ id: 'xh:' + id, label: `Switch to "${ch.name}"`, bind: cb.bind });
    }
    const sc = ctx.prof().scope;
    if (sc.enabled) for (const [k, b] of Object.entries(sc.binds)) if (b) out.push({ id: 'scope:' + k, label: SCOPE_LABELS[k] || 'Scope', bind: b });
    return out;
  }
  function conflictsFor(ctx, id, bind) {
    if (!bind) return [];
    return allBinds(ctx).filter((x) => x.id !== id && sameBind(x.bind, bind)).map((x) => x.label);
  }

  function bindControl(ctx, id, getBind, setBind) {
    const { h, isMac, commit, toast } = ctx;
    const b = getBind();
    const btn = h('button', { class: 'bind-btn', title: 'Click, then press a key, key combo or mouse button' }, prettyBind(b, isMac));
    btn.onclick = () => recordBind(btn, isMac, (bind, cancelled) => {
      if (!cancelled) {
        setBind(bind);
        commit();
        if (bind) toast(prettyBind(bind, isMac) + ' bound');
      }
      render(ctx);
    });
    const clear = h('button', { class: 'icon-btn', title: 'Clear', onclick: () => { setBind(null); commit(); render(ctx); } }, '✕');
    const clashes = conflictsFor(ctx, id, b);
    const warn = clashes.length ? h('div', { class: 'note warn bind-warn' }, '⚠ Also used for: ' + clashes.join(', ')) : null;
    return { btn, clear, warn };
  }

  function card(h, title, ...body) {
    return h('section', { class: 'settings-card' }, h('h3', {}, title), ...body);
  }

  function render(ctx) {
    const { h, fill, data, prof, commit, api, isMac, thumb, toast } = ctx;
    const root = document.getElementById('settingsView');
    if (!root || root.classList.contains('hidden')) return;
    const d = data();
    const s = d.settings;

    // ----- app hotkeys -----
    const appRows = APP_BINDS.map(([key, label]) => {
      const c = bindControl(ctx, 'app:' + key, () => s.binds[key], (b) => (s.binds[key] = b));
      return h('div', {}, h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, label), c.btn, c.clear), c.warn);
    });

    // ----- per-crosshair binds -----
    const activeId = prof().crosshairId;
    const xhRows = d.crosshairs.map((ch) => {
      const cb = s.crosshairBinds[ch.id];
      const c = bindControl(ctx, 'xh:' + ch.id, () => cb && cb.bind, (b) => {
        if (b) s.crosshairBinds[ch.id] = { bind: b, mode: (cb && cb.mode) || 'switch' };
        else delete s.crosshairBinds[ch.id];
      });
      const isWheel = !!(cb && cb.bind && cb.bind.kind === 'wheel');
      const mode = h('select', {
        disabled: !cb || isWheel,
        title: 'Switch: changes your crosshair until you switch again. Hold: uses it only while the bind is held.',
        onchange: (e) => { if (s.crosshairBinds[ch.id]) { s.crosshairBinds[ch.id].mode = e.target.value; commit(); } },
      },
        h('option', { value: 'switch', selected: !cb || cb.mode !== 'hold' }, 'Switch to it'),
        h('option', { value: 'hold', selected: cb && cb.mode === 'hold' && !isWheel }, 'Use while held'));
      if (isWheel) mode.title = 'A scroll can’t be held, so scroll binds always switch.';
      return h('div', {},
        h('div', { class: 'set-row xh-row' },
          thumb(ch, 36, 56),
          h('span', { class: 'set-label' }, ch.name, ch.id === activeId ? h('span', { class: 'badge' }, 'ACTIVE') : null),
          c.btn, mode, c.clear),
        c.warn);
    });

    // ----- general -----
    const checkRow = (label, checked, onchange, note) =>
      h('label', { class: 'check set-check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }),
        h('span', {}, label, note ? h('span', { class: 'note block' }, note) : null));

    const loginRow = api.isElectron && api.setOpenAtLogin
      ? checkRow('Launch Crosshair Studio when I sign in', !!(appInfo && appInfo.openAtLogin), async (on) => {
          appInfo = Object.assign(appInfo || {}, { openAtLogin: await api.setOpenAtLogin(on) });
          render(ctx);
        })
      : h('p', { class: 'note' }, 'Launch at startup is available in the desktop app.');

    const inputNote = ctx.inputStatus().available
      ? h('p', { class: 'note ok' }, '✓ Keyboard and mouse binds work everywhere, including in games.')
      : h('div', {},
          h('p', { class: 'note warn' }, (ctx.inputStatus().error || 'Global input is unavailable.') +
            ' Until then only keyboard binds work, and "Use while held" acts like "Switch to it".'),
          api.isElectron && isMac ? h('button', { class: 'btn small', onclick: async () => { await api.requestInputAccess(); toast('After granting Accessibility access, restart Crosshair Studio.'); } }, 'Open Accessibility prompt') : null);

    const sc = prof().scope;
    const scopeBinds = Object.entries(sc.binds).filter(([, b]) => b).map(([k, b]) => `${(SCOPE_LABELS[k] || k).replace('Scope: ', '')}: ${prettyBind(b, isMac)}`);

    fill(root,
      h('div', { class: 'settings-inner' },
        h('h2', {}, 'Settings'),
        updateCard(ctx),
        card(h, 'Crosshair hotkeys',
          h('p', { class: 'note' }, 'Bind any key, key combo, right / middle / side mouse button, or scroll up / down (Shift + scroll works too). Click a bind, then press or scroll. Esc cancels, Backspace clears.'),
          ...appRows),
        card(h, 'Switch crosshairs',
          h('p', { class: 'note' }, '"Switch to it" changes your crosshair until you switch again. "Use while held" swaps to it only while the bind is held, for example a sniper crosshair on right click. Scroll binds always switch. Tip: bind Next / Previous crosshair to scroll up / down to flick through them.'),
          d.crosshairs.length > 1 ? null : h('p', { class: 'note warn' }, 'You have one crosshair. Add more from the Library or with + New to switch between them.'),
          ...xhRows),
        card(h, 'Scope binds',
          h('p', { class: 'note' }, sc.enabled ? (scopeBinds.join(' · ') || 'No scope binds set.') : 'The scope is off for this game profile.'),
          h('button', { class: 'btn small', onclick: () => ctx.openScopeTab() }, 'Edit in the Scope tab')),
        card(h, 'General',
          loginRow,
          checkRow('Start hidden in the tray when launched at sign-in', s.startHidden !== false, (v) => { s.startHidden = v; commit(); }),
          checkRow('Show the crosshair name on screen when switching', s.switchToast !== false, (v) => { s.switchToast = v; commit(); }),
          checkRow('Hold Esc for 3 seconds to hide everything', s.escKill !== false, (v) => { s.escKill = v; commit(); },
            'An emergency off switch. It hides the crosshair and closes the scope.')),
        card(h, 'Input', inputNote),
        card(h, 'Game profiles',
          h('p', { class: 'note' }, d.profiles.map((p) => p.name + (p.id === d.activeProfileId ? ' (active)' : '')).join(' · ')),
          h('button', { class: 'btn small', onclick: () => ctx.openProfiles() }, 'Manage game profiles')),
        h('p', { class: 'note settings-foot' }, 'Crosshair Studio' + (appInfo && appInfo.version ? ' ' + appInfo.version : ''))
      )
    );
  }

  async function open(ctx) {
    if (ctx.api.appInfo && !appInfo) {
      try { appInfo = await ctx.api.appInfo(); } catch {}
    }
    if (ctx.api.getUpdate) {
      try { update = await ctx.api.getUpdate(); } catch {}
      if (!listening) {
        listening = true;
        ctx.api.onUpdateState((st) => { update = st; render(ctx); });
      }
    }
    render(ctx);
  }

  XH.SettingsView = { render, open };
})();
