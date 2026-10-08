// Bind recorder + labels shared by the Scope tab and the Settings view.
// Binds use the global hook's key names, so they match what the main process sees.
(function () {
  const XH = (window.XH = window.XH || {});

  const MOUSE_NAMES = { right: 'Right click', middle: 'Middle click', mouse4: 'Mouse 4', mouse5: 'Mouse 5' };
  const DOM_BUTTON = { 1: 'middle', 2: 'right', 3: 'mouse4', 4: 'mouse5' };
  const DOM_MODS = { ControlLeft: 'Ctrl', ControlRight: 'CtrlRight', AltLeft: 'Alt', AltRight: 'AltRight', ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', MetaLeft: 'Meta', MetaRight: 'MetaRight', OSLeft: 'Meta', OSRight: 'MetaRight' };
  const MOD_NAMES = new Set(Object.values(DOM_MODS));

  // Browser KeyboardEvent.code -> the key names the global hook reports.
  function hookName(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return DOM_MODS[code] || code;
  }

  function prettyBind(b, isMac) {
    if (!b) return 'Not set';
    if (b.kind === 'mouse') return MOUSE_NAMES[b.button] || b.button;
    const names = {
      Meta: isMac ? '⌘' : 'Win', MetaRight: isMac ? 'Right ⌘' : 'Right Win', Ctrl: 'Ctrl', CtrlRight: 'Right Ctrl',
      Alt: isMac ? '⌥' : 'Alt', AltRight: isMac ? 'Right ⌥' : 'Right Alt', Shift: 'Shift', ShiftRight: 'Right Shift',
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Backquote: '`', Minus: '-', Equal: '=',
    };
    const parts = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.alt) parts.push(isMac ? '⌥' : 'Alt');
    if (b.shift) parts.push('Shift');
    if (b.meta) parts.push(isMac ? '⌘' : 'Win');
    parts.push(names[b.code] || b.code);
    return parts.join(' + ');
  }

  // Click a bind button, then press a key / combo or a mouse button. Esc cancels, Backspace clears.
  function recordBind(btn, isMac, done) {
    btn.classList.add('recording');
    btn.textContent = 'Press a key or mouse button…';
    let pendingMod = null;
    const finish = (bind, cancelled) => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', onCtx, true);
      btn.classList.remove('recording');
      done(bind, cancelled);
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') return finish(null, true);
      if (e.code === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) return finish(null, false);
      const name = hookName(e.code);
      if (MOD_NAMES.has(name)) { pendingMod = name; return; } // could be a combo, or the modifier on its own
      finish({ kind: 'key', code: name, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
    };
    const onKeyUp = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pendingMod && hookName(e.code) === pendingMod) finish({ kind: 'key', code: pendingMod });
    };
    const onMouse = (e) => {
      const button = DOM_BUTTON[e.button];
      if (!button) return; // left click keeps working normally
      e.preventDefault();
      e.stopPropagation();
      finish({ kind: 'mouse', button });
    };
    const onCtx = (e) => e.preventDefault();
    setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', onCtx, true);
    }, 0);
  }

  const sameBind = (a, b) => !!a && !!b && a.kind === b.kind &&
    (a.kind === 'mouse' ? a.button === b.button
      : a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta);

  XH.BindUI = { recordBind, prettyBind, sameBind, hookName };
})();
