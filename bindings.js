// Shared keybind helpers for the main process.
// A bind is { kind: 'key', code, ctrl?, alt?, shift?, meta? } or { kind: 'mouse', button }.
// Key codes use uiohook key names ('A', 'F6', 'Shift', 'ArrowUp', ...).

const MOD_CODES = { Ctrl: 'ctrl', CtrlRight: 'ctrl', Alt: 'alt', AltRight: 'alt', Shift: 'shift', ShiftRight: 'shift', Meta: 'meta', MetaRight: 'meta' };

// Tracks which keys are held so modifiers can be matched and auto-repeat ignored.
function createKeyState(UiohookKey) {
  const keyName = {};
  if (UiohookKey) for (const [name, code] of Object.entries(UiohookKey)) keyName[code] = name;
  const down = new Set();
  const mods = () => {
    const m = { ctrl: false, alt: false, shift: false, meta: false };
    for (const k of down) if (MOD_CODES[k]) m[MOD_CODES[k]] = true;
    return m;
  };
  return {
    /** Returns the press event, or null for unknown keys and auto-repeat. */
    keyDown(e) {
      const name = keyName[e.keycode];
      if (!name || down.has(name)) return null;
      down.add(name);
      return { kind: 'key', code: name, mods: mods() };
    },
    keyUp(e) {
      const name = keyName[e.keycode];
      if (!name) return null;
      down.delete(name);
      return { kind: 'key', code: name };
    },
  };
}

/** Does a press event trigger this bind? Modifiers must match exactly, unless the bind is a lone modifier. */
function matches(bind, ev) {
  if (!bind || !ev || bind.kind !== ev.kind) return false;
  if (bind.kind === 'mouse') return bind.button === ev.button;
  if (bind.code !== ev.code) return false;
  if (MOD_CODES[bind.code]) return true;
  const m = ev.mods || {};
  return !!bind.ctrl === !!m.ctrl && !!bind.alt === !!m.alt && !!bind.shift === !!m.shift && !!bind.meta === !!m.meta;
}

/** Does a release event end a held bind? Only the main key / button counts. */
function releases(bind, ev) {
  if (!bind || !ev || bind.kind !== ev.kind) return false;
  return bind.kind === 'mouse' ? bind.button === ev.button : bind.code === ev.code;
}

// Electron accelerator for keyboard binds, used when the global input hook isn't available.
const ACCEL_KEYS = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Equal: '=', Minus: '-', Comma: ',', Period: '.',
  Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
};
function toAccelerator(bind) {
  if (!bind || bind.kind !== 'key' || MOD_CODES[bind.code]) return null;
  let key = ACCEL_KEYS[bind.code] || bind.code;
  if (/^Numpad\d$/.test(key)) key = 'num' + key.slice(6);
  const parts = [];
  if (bind.meta) parts.push(process.platform === 'darwin' ? 'Command' : 'Super');
  if (bind.ctrl) parts.push('Control');
  if (bind.alt) parts.push('Alt');
  if (bind.shift) parts.push('Shift');
  return [...parts, key].join('+');
}

module.exports = { MOD_CODES, createKeyState, matches, releases, toAccelerator };
