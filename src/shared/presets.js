// Built-in library of original crosshair designs, grouped by category.
(function () {
  const XH = (window.XH = window.XH || {});
  const L = (type, o) => XH.newLayer(type, o);
  const noOutline = { enabled: false };
  const glow = (color, t = 2, blur = 2, opacity = 0.8) => ({ enabled: true, color, thickness: t, blur, opacity });

  const GREEN = '#00ff66', CYAN = '#00e5ff', YELLOW = '#ffe600', RED = '#ff2a3d', PINK = '#ff3df2',
    WHITE = '#ffffff', ORANGE = '#ff9a1f', LIME = '#b6ff00', PURPLE = '#9b5cff';

  const P = (category, name, layers, extra = {}) =>
    XH.normalizeCrosshair(Object.assign({ id: 'preset-' + category + '-' + name, name, category, builtin: true, layers, animations: [] }, extra));

  const bloom = (amt) => ({ animations: [XH.bloomAnimation(amt)] });

  const presets = [
    // ---------------- Classic ----------------
    P('Classic', 'Classic Cross', [L('lines', { color: GREEN })]),
    P('Classic', 'Classic + Dot', [L('lines', { color: GREEN }), L('dot', { color: GREEN })]),
    P('Classic', 'Thin Cross', [L('lines', { color: CYAN, width: 1, length: 7, gap: 3 })]),
    P('Classic', 'Thick Cross', [L('lines', { color: YELLOW, width: 3, length: 7, gap: 5, outline: { thickness: 1.5 } })]),
    P('Classic', 'Tiny Cross', [L('lines', { color: WHITE, width: 1, length: 3, gap: 2 })]),
    P('Classic', 'Plus (No Gap)', [L('lines', { color: GREEN, width: 2, length: 6, gap: 0 })]),
    P('Classic', 'Long Cross', [L('lines', { color: RED, width: 1, length: 22, gap: 6 }), L('dot', { color: RED, size: 2 })]),
    P('Classic', 'T-Shape', [L('lines', { color: CYAN, tMode: 'always', length: 7, gap: 4 })]),
    P('Classic', 'T When Firing', [L('lines', { color: GREEN, tMode: 'firing' })], bloom(5)),
    P('Classic', 'X Cross', [L('lines', { color: PINK, rotation: 45, length: 6, gap: 4 })]),
    P('Classic', 'Rounded Cross', [L('lines', { color: LIME, rounded: true, width: 3, length: 7, gap: 4 })]),
    P('Classic', 'Dynamic Bloom', [L('lines', { color: GREEN }), L('dot', { color: GREEN })], bloom(8)),

    // ---------------- Dot ----------------
    P('Dot', 'Small Dot', [L('dot', { color: GREEN, size: 2 })]),
    P('Dot', 'Big Dot', [L('dot', { color: RED, size: 6, shape: 'circle' })]),
    P('Dot', 'Square Dot', [L('dot', { color: YELLOW, size: 4, shape: 'square' })]),
    P('Dot', 'Diamond', [L('dot', { color: CYAN, size: 7, shape: 'diamond' })]),
    P('Dot', 'Outlined Dot', [L('dot', { color: WHITE, size: 3, shape: 'circle', outline: { thickness: 1.5 } })]),
    P('Dot', 'Glow Dot', [L('dot', { color: RED, size: 4, shape: 'circle', outline: glow(RED, 2, 3) })]),
    P('Dot', 'Pixel', [L('dot', { color: WHITE, size: 1, outline: noOutline })]),

    // ---------------- Circle ----------------
    P('Circle', 'Ring', [L('ring', { color: GREEN, radius: 10 })]),
    P('Circle', 'Ring + Dot', [L('ring', { color: CYAN, radius: 12 }), L('dot', { color: CYAN, shape: 'circle', size: 3 })]),
    P('Circle', 'Segmented Ring', [L('ring', { color: YELLOW, radius: 14, segments: 4, segmentGap: 40, segmentOffset: 45 }), L('dot', { color: YELLOW, size: 2 })]),
    P('Circle', 'Circle Cross', [L('ring', { color: GREEN, radius: 14, thickness: 1 }), L('lines', { color: GREEN, width: 1, length: 8, gap: 10 })]),
    P('Circle', 'Double Ring', [L('ring', { color: PINK, radius: 8, thickness: 1 }), L('ring', { color: PINK, radius: 16, thickness: 1, segments: 8, segmentGap: 20 })]),
    P('Circle', 'Halo', [L('ring', { color: CYAN, radius: 16, thickness: 2, outline: glow(CYAN, 2, 4, 0.7) }), L('dot', { color: WHITE, size: 2, shape: 'circle' })]),
    P('Circle', 'Expanding Ring', [L('ring', { color: GREEN, radius: 8 }), L('dot', { color: GREEN, shape: 'circle', size: 2 })], bloom(10)),

    // ---------------- Radial ----------------
    P('Radial', 'Tri', [L('lines', { color: CYAN, arms: 3, length: 7, gap: 4 })]),
    P('Radial', 'Y Shape', [L('lines', { color: GREEN, arms: 3, rotation: 180, length: 7, gap: 3 }), L('dot', { color: GREEN })]),
    P('Radial', 'Penta', [L('lines', { color: YELLOW, arms: 5, length: 6, gap: 5 })]),
    P('Radial', 'Hex', [L('lines', { color: PINK, arms: 6, length: 6, gap: 5, width: 1.5 })]),
    P('Radial', 'Hepta', [L('lines', { color: ORANGE, arms: 7, length: 6, gap: 6, width: 1.5 })]),
    P('Radial', 'Octo Star', [L('lines', { color: LIME, arms: 8, length: 8, gap: 3, width: 1.5 })]),
    P('Radial', 'Starburst', [L('lines', { color: WHITE, arms: 8, length: 10, gap: 8, width: 1 }), L('dot', { color: RED, shape: 'circle', size: 3 })]),

    // ---------------- Shapes ----------------
    P('Shapes', 'Chevron', [L('shape', { color: ORANGE, shape: 'chevron', width: 14, height: 7, thickness: 2, radius: 0, startAngle: 180 })]),
    P('Shapes', 'Chevron + Dot', [L('shape', { color: RED, shape: 'chevron', width: 16, height: 8, thickness: 2, radius: 4, startAngle: 180 }), L('dot', { color: RED, size: 2 })]),
    P('Shapes', 'Inward Triangles', [L('shape', { color: CYAN, shape: 'triangle', count: 3, radius: 4, width: 6, height: 10 })]),
    P('Shapes', 'Four Triangles', [L('shape', { color: YELLOW, shape: 'triangle', count: 4, radius: 5, width: 6, height: 6, startAngle: 0 })]),
    P('Shapes', 'Brackets', [L('shape', { color: GREEN, shape: 'arc', count: 2, radius: 12, arcAngle: 70, thickness: 2, startAngle: 90 }), L('dot', { color: GREEN, size: 2 })]),
    P('Shapes', 'Quad Arcs', [L('shape', { color: PINK, shape: 'arc', count: 4, radius: 12, arcAngle: 40, thickness: 2, startAngle: 45 })]),
    P('Shapes', 'Corners', [L('shape', { color: WHITE, shape: 'corner', count: 4, radius: 16, width: 6, height: 6, thickness: 1.5, startAngle: 0 }), L('dot', { color: RED, size: 2 })]),
    P('Shapes', 'Box', [L('shape', { color: GREEN, shape: 'rectangle', count: 1, radius: -8, width: 16, height: 16, thickness: 1.5, filled: false, startAngle: 0 })]),
    P('Shapes', 'Tees', [L('shape', { color: CYAN, shape: 'tshape', count: 4, radius: 4, width: 8, height: 6, thickness: 2, startAngle: 0 })]),
    P('Shapes', 'Pips', [L('shape', { color: YELLOW, shape: 'rectangle', count: 4, radius: 6, width: 3, height: 3, filled: true, startAngle: 0 }), L('dot', { color: YELLOW, size: 2 })]),

    // ---------------- Scope / sights ----------------
    P('Sights', 'Red Dot Sight', [L('dot', { color: RED, size: 4, shape: 'circle', outline: glow(RED, 1.5, 2.5, 0.9) })]),
    P('Sights', 'Holographic', [
      L('ring', { color: RED, radius: 18, thickness: 1.5, outline: glow(RED, 1, 2, 0.6) }),
      L('dot', { color: RED, size: 3, shape: 'circle', outline: glow(RED, 1, 2, 0.6) }),
      L('shape', { color: RED, shape: 'rectangle', count: 4, radius: 18, width: 1.5, height: 5, filled: true, startAngle: 0, outline: noOutline }),
    ]),
    P('Sights', 'Amber Chevron Sight', [
      L('shape', { color: ORANGE, shape: 'chevron', width: 12, height: 8, thickness: 2, radius: 0, startAngle: 180, outline: glow(ORANGE, 1, 1.5, 0.6) }),
      L('lines', { color: ORANGE, arms: 2, rotation: 0, width: 1, length: 10, gap: 0, y: 8, outline: noOutline, tMode: 'always' }),
    ]),
    P('Sights', 'Mil-Dot', [
      L('lines', { color: WHITE, width: 1, length: 40, gap: 2, outline: noOutline }),
      L('shape', { color: WHITE, shape: 'rectangle', count: 4, radius: 9, width: 3, height: 3, filled: true, startAngle: 0, outline: noOutline }),
      L('shape', { color: WHITE, shape: 'rectangle', count: 4, radius: 19, width: 3, height: 3, filled: true, startAngle: 0, outline: noOutline }),
      L('shape', { color: WHITE, shape: 'rectangle', count: 4, radius: 29, width: 3, height: 3, filled: true, startAngle: 0, outline: noOutline }),
    ]),
    P('Sights', 'Duplex', [
      L('lines', { color: WHITE, width: 3, length: 30, gap: 14, outline: noOutline }),
      L('lines', { color: WHITE, width: 1, length: 14, gap: 0, outline: noOutline }),
    ]),
    P('Sights', 'Tactical Ring', [
      L('ring', { color: GREEN, radius: 20, thickness: 1, segments: 4, segmentGap: 30 }),
      L('lines', { color: GREEN, width: 1, length: 6, gap: 3 }),
    ]),

    // ---------------- Fun ----------------
    P('Fun', 'Target Emoji', [L('text', { text: '🎯', fontSize: 22, outline: noOutline })]),
    P('Fun', 'Heart', [L('text', { text: '♥', fontSize: 18, color: PINK })]),
    P('Fun', 'Star', [L('text', { text: '★', fontSize: 18, color: YELLOW })]),
    P('Fun', 'Skull', [L('text', { text: '☠', fontSize: 20, color: WHITE })]),
    P('Fun', 'Callsign', [L('lines', { color: CYAN, length: 5, gap: 3 }), L('text', { text: 'ALPHA', fontSize: 9, y: 18, color: CYAN, fontFamily: 'ui-monospace, monospace' })]),
    P('Fun', 'Neon Purple', [L('lines', { color: PURPLE, width: 2, length: 7, gap: 4, outline: glow(PURPLE, 1.5, 3, 0.9) }), L('dot', { color: WHITE, size: 2, outline: glow(PURPLE, 1.5, 3, 0.9) })]),
    P('Fun', 'Spin On Fire', [L('lines', { color: LIME, arms: 3, length: 7, gap: 4 }), L('dot', { color: LIME })], {
      animations: [{
        id: 'spin', name: 'Spin on shot', enabled: true, trigger: 'left', mode: 'once',
        stages: [{ duration: 220, easing: 'backOut', rotation: 120, spread: 4 }],
        releaseDuration: 0, releaseEasing: 'step',
      }],
    }),
    P('Fun', 'Pulse', [L('ring', { color: PINK, radius: 10 }), L('dot', { color: PINK, shape: 'circle', size: 3 })], {
      animations: [{
        id: 'pulse', name: 'Pulse on shot', enabled: true, trigger: 'left', mode: 'once',
        stages: [{ duration: 70, easing: 'easeOut', scale: 1.5, opacity: 0.6 }],
        releaseDuration: 260, releaseEasing: 'elasticOut',
      }],
    }),
  ];

  XH.PRESETS = presets;
  XH.PRESET_CATEGORIES = [...new Set(presets.map((p) => p.category))];
})();
