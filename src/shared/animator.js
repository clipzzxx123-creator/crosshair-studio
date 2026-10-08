// Button-triggered, multi-stage animations with easing.
// An animation = { trigger: 'left'|'right'|'middle'|'mouse4'|'mouse5', mode: 'once'|'hold',
//                  stages: [{ duration, easing, spread?, scale?, opacity?, rotation? }],
//                  releaseDuration, releaseEasing }
// 'once' plays every stage then eases back to rest. 'hold' plays the stages, holds the last
// value while the button is down, and eases back to rest on release.
(function () {
  const XH = (window.XH = window.XH || {});

  const PROPS = ['spread', 'scale', 'opacity', 'rotation'];
  const REST = { spread: 0, scale: 1, opacity: 1, rotation: 0 };

  function bounceOut(t) {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }

  const EASINGS = {
    linear: (t) => t,
    easeIn: (t) => t * t * t,
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    backOut: (t) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    elasticOut: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    bounceOut,
    step: (t) => (t < 1 ? 0 : 1),
  };

  // CSS-style cubic-bezier(x1, y1, x2, y2) solved with Newton's method + bisection fallback.
  function cubicBezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;
      t = x;
      while (hi - lo > 1e-6) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }

  const bezierCache = new Map();
  function getEasing(name) {
    if (EASINGS[name]) return EASINGS[name];
    const m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(name || '');
    if (!m) return EASINGS.linear;
    if (!bezierCache.has(name)) bezierCache.set(name, cubicBezier(+m[1], +m[2], +m[3], +m[4]));
    return bezierCache.get(name);
  }

  // A timeline per property: list of segments { from, to, start, dur, ease }.
  function sample(segs, prop, now) {
    if (!segs || !segs.length) return REST[prop];
    if (now <= segs[0].start) return segs[0].from;
    for (const s of segs) {
      if (now < s.start + s.dur) {
        const t = s.dur <= 0 ? 1 : (now - s.start) / s.dur;
        return s.from + (s.to - s.from) * s.ease(Math.max(0, Math.min(1, t)));
      }
    }
    return segs[segs.length - 1].to;
  }

  class Animator {
    constructor() {
      this.crosshair = null;
      this.tracks = new Map(); // animation index -> { prop: segs[] }
      this.down = new Set();
      this.adsToggled = false;
    }

    setCrosshair(ch) {
      this.crosshair = ch;
      this.tracks.clear();
    }

    _current(idx, now) {
      const tr = this.tracks.get(idx) || {};
      const v = {};
      for (const p of PROPS) v[p] = sample(tr[p], p, now);
      return v;
    }

    _play(idx, anim, now) {
      const cur = this._current(idx, now);
      const tr = {};
      for (const p of PROPS) {
        let t = now, val = cur[p];
        const segs = [];
        for (const st of anim.stages || []) {
          const to = st[p] ?? val; // a stage that doesn't mention a prop just holds it
          const dur = Math.max(0, +st.duration || 0);
          segs.push({ from: val, to, start: t, dur, ease: getEasing(st.easing) });
          t += dur;
          val = to;
        }
        if (anim.mode !== 'hold') {
          segs.push({ from: val, to: REST[p], start: t, dur: Math.max(0, +anim.releaseDuration || 0), ease: getEasing(anim.releaseEasing) });
        }
        tr[p] = segs;
      }
      this.tracks.set(idx, tr);
    }

    _release(idx, anim, now) {
      const cur = this._current(idx, now);
      const tr = {};
      const dur = Math.max(0, +anim.releaseDuration || 0);
      for (const p of PROPS) tr[p] = [{ from: cur[p], to: REST[p], start: now, dur, ease: getEasing(anim.releaseEasing) }];
      this.tracks.set(idx, tr);
    }

    press(button, now = performance.now()) {
      if (this.down.has(button)) return;
      this.down.add(button);
      const ch = this.crosshair;
      if (!ch) return;
      if (button === 'right' && ch.adsMode === 'toggle') this.adsToggled = !this.adsToggled;
      (ch.animations || []).forEach((a, i) => {
        if (a.enabled !== false && a.trigger === button) this._play(i, a, now);
      });
    }

    release(button, now = performance.now()) {
      if (!this.down.has(button)) return;
      this.down.delete(button);
      const ch = this.crosshair;
      if (!ch) return;
      (ch.animations || []).forEach((a, i) => {
        if (a.enabled !== false && a.trigger === button && a.mode === 'hold') this._release(i, a, now);
      });
    }

    reset() {
      this.down.clear();
      this.tracks.clear();
      this.adsToggled = false;
    }

    /** Combined state at `now`. Spread/rotation add up, scale/opacity multiply. */
    state(now = performance.now()) {
      const s = { spread: 0, scale: 1, opacity: 1, rotation: 0 };
      let active = false;
      for (const [idx] of this.tracks) {
        const v = this._current(idx, now);
        s.spread += v.spread;
        s.scale *= v.scale;
        s.opacity *= v.opacity;
        s.rotation += v.rotation;
        const tr = this.tracks.get(idx);
        for (const p of PROPS) {
          const last = tr[p][tr[p].length - 1];
          if (last && now < last.start + last.dur) active = true;
        }
      }
      const ch = this.crosshair || {};
      s.firing = this.down.has('left');
      s.ads = ch.adsMode === 'toggle' ? this.adsToggled : this.down.has('right');
      if (ch.hideOnADS && s.ads) s.opacity = 0;
      s.active = active;
      return s;
    }
  }

  XH.Animator = Animator;
  XH.EASING_NAMES = Object.keys(EASINGS);
  XH.getEasing = getEasing;
})();
