// Zoom lens: captures the target display and draws a magnified, shaped lens with WebGL.
// One fragment shader does masking (rounded-rect SDF), convex distortion, image filters,
// the focus-ring outline and the optional dimmed background.
(function () {
  const XH = (window.XH = window.XH || {});

  // capture: fraction of display resolution captured; px: canvas resolution (number or 'dpr')
  const QUALITY = {
    ultraPerformance: { fps: 30, capture: 0.5, px: 0.5 },
    performance: { fps: 45, capture: 0.75, px: 0.75 },
    balanced: { fps: 60, capture: 1, px: 1 },
    quality: { fps: 60, capture: 1, px: 'dpr' },
    ultra: { fps: 120, capture: 1, px: 'dpr' },
  };

  const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const FS = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uCanvas;     // canvas size in device px
uniform float uScale;     // device px per CSS px
uniform vec2 uWinOff;     // window origin within the display (CSS px)
uniform vec2 uDisp;       // display size (CSS px)
uniform vec2 uTexel;      // 1 / video size
uniform vec2 uCenter;     // lens center (display CSS px)
uniform vec2 uHalf;       // lens half size
uniform float uRadius;    // corner radius
uniform float uZoom;
uniform float uOpen;      // 0..1 open animation
uniform float uFeather;
uniform float uDistort;
uniform vec3 uAdj;        // brightness, contrast, saturation
uniform float uSharpen;
uniform vec4 uOutline;    // rgb, alpha
uniform float uOutlineW;
uniform float uOutlineFeather;
uniform vec4 uDim;        // rgb, alpha
uniform float uHasFrame;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 samp(vec2 disp) { return texture2D(uTex, disp / uDisp).rgb; }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uScale;
  vec2 p = frag + uWinOff;
  vec2 hb = max(uHalf * (0.85 + 0.15 * uOpen), vec2(1.0));
  float r = min(uRadius, min(hb.x, hb.y));
  vec2 q = p - uCenter;
  float d = sdRound(q, hb, r);
  float aa = 0.75;

  vec4 res = vec4(0.0);
  float outside = smoothstep(-aa, aa, d);
  float dimA = uDim.a * outside * uOpen;
  res = vec4(uDim.rgb * dimA, dimA);

  float lensA = (1.0 - smoothstep(-max(uFeather, aa), 0.0, d)) * uOpen * uHasFrame;
  if (lensA > 0.0) {
    vec2 n = q / hb;
    float k = uDistort;
    vec2 qs = q * (1.0 - k + k * clamp(dot(n, n), 0.0, 1.0));
    vec2 src = uCenter + qs / uZoom;
    vec3 c = samp(src);
    if (uSharpen > 0.0) {
      vec2 o = uDisp * uTexel;
      vec3 blur = (samp(src + vec2(o.x, 0.0)) + samp(src - vec2(o.x, 0.0)) + samp(src + vec2(0.0, o.y)) + samp(src - vec2(0.0, o.y))) * 0.25;
      c += uSharpen * (c - blur);
    }
    c *= uAdj.x;
    c = (c - 0.5) * uAdj.y + 0.5;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, uAdj.z);
    c = clamp(c, 0.0, 1.0);
    res = vec4(c, 1.0) * lensA + res * (1.0 - lensA);
  }

  if (uOutline.a > 0.0 && uOutlineW > 0.0) {
    float f = max(uOutlineFeather, aa);
    float oa = (1.0 - smoothstep(uOutlineW, uOutlineW + f, d)) * smoothstep(-f, 0.0, d) * uOutline.a * uOpen;
    res = vec4(uOutline.rgb, 1.0) * oa + res * (1.0 - oa);
  }
  gl_FragColor = res;
}`;

  const hexRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  class ScopeRenderer {
    constructor(canvas, { onError, onActiveChange } = {}) {
      this.canvas = canvas;
      this.onError = onError || (() => {});
      this.onActiveChange = onActiveChange || (() => {});
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.stream = null;
      this.streamKey = '';
      this.starting = null;
      this.state = null;
      this.cursor = { x: 0, y: 0 };
      this.zoomShown = 2;
      this.open = 0;
      this.last = 0;
      this.loop = 0;
      this.hasFrame = false;
      this._initGL();
    }

    _initGL() {
      const gl = (this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false }));
      if (!gl) { this.onError('WebGL is unavailable, so the zoom lens cannot draw.'); return; }
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      this.prog = prog;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        this.u[info.name] = gl.getUniformLocation(prog, info.name);
      }
    }

    // ---------- capture ----------
    async _ensureStream(cfg, display) {
      const want = cfg.enabled && (cfg.keepWarm || this.state.active);
      const q = QUALITY[cfg.quality] || QUALITY.balanced;
      const key = [display.width, display.height, cfg.quality].join('|');
      if (!want) { this._stopStream(); return; }
      if (this.stream && this.streamKey === key) return;
      if (this.starting) return this.starting;
      // After a failed start, wait before asking again instead of retrying on every update.
      if (this.failedKey === key && performance.now() - this.failedAt < 5000) return;
      this._stopStream();
      const dpr = window.devicePixelRatio || 1;
      this.starting = navigator.mediaDevices
        .getDisplayMedia({
          audio: false,
          video: {
            frameRate: { ideal: q.fps, max: q.fps },
            width: { max: Math.round(display.width * dpr * q.capture) },
            height: { max: Math.round(display.height * dpr * q.capture) },
          },
        })
        .then(async (stream) => {
          this.stream = stream;
          this.streamKey = key;
          this.video.srcObject = stream;
          await this.video.play();
          this.failedKey = null;
          this.onError(null);
          stream.getVideoTracks()[0].addEventListener('ended', () => { if (this.stream === stream) this._stopStream(); });
        })
        .catch((e) => {
          this.failedKey = key;
          this.failedAt = performance.now();
          this.onError(
            /Permission|NotAllowed/i.test(e.name + e.message)
              ? 'Screen capture was blocked. Allow Crosshair Studio under System Settings → Privacy & Security → Screen Recording, then restart it.'
              : 'Screen capture failed: ' + e.message
          );
        })
        .finally(() => { this.starting = null; this._kick(); });
      return this.starting;
    }

    _stopStream() {
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.streamKey = '';
      this.hasFrame = false;
      this.video.srcObject = null;
    }

    // ---------- state ----------
    update(state) {
      const wasActive = this.state && this.state.active;
      this.state = state;
      if (state.cursor) this.cursor = state.cursor;
      if (!wasActive && state.active && !state.cfg.animate) this.zoomShown = state.zoom;
      if (!wasActive && state.active && state.cfg.animate) this.zoomShown = Math.max(1, state.zoom * 0.8);
      this._ensureStream(state.cfg, state.display);
      this._kick();
    }
    setCursor(c) { this.cursor = c; this._kick(); }

    _kick() {
      if (this.loop) return;
      this.last = performance.now();
      const step = () => {
        this.loop = 0;
        if (this._frame()) this._schedule(step);
      };
      this._schedule(step);
    }
    _schedule(fn) {
      const cfg = this.state && this.state.cfg;
      // VSync off: draw as soon as each captured frame arrives instead of waiting for the display refresh.
      if (cfg && !cfg.vsync && this.stream && this.video.requestVideoFrameCallback && this.open > 0.999) {
        this.loop = -1;
        this.video.requestVideoFrameCallback(() => fn());
      } else {
        this.loop = requestAnimationFrame(fn);
      }
    }

    // Returns true while there is something to draw.
    _frame() {
      const s = this.state;
      const gl = this.gl;
      if (!s || !gl) return false;
      const cfg = s.cfg;
      const now = performance.now();
      const dt = Math.min(100, now - this.last);
      this.last = now;

      const targetOpen = s.active && cfg.enabled ? 1 : 0;
      const tau = Math.max(1, (cfg.animMs || 1) / 3);
      const k = cfg.animate ? 1 - Math.exp(-dt / tau) : 1;
      this.open += (targetOpen - this.open) * k;
      this.zoomShown += (s.zoom - this.zoomShown) * k;
      if (Math.abs(targetOpen - this.open) < 0.002) this.open = targetOpen;
      if (Math.abs(s.zoom - this.zoomShown) < 0.002) this.zoomShown = s.zoom;
      this.onActiveChange(this.open > 0);

      // resize canvas
      const q = QUALITY[cfg.quality] || QUALITY.balanced;
      const dpr = window.devicePixelRatio || 1;
      const scale = q.px === 'dpr' ? dpr : Math.min(dpr, q.px * dpr);
      const W = Math.round(window.innerWidth * scale), H = Math.round(window.innerHeight * scale);
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (this.open <= 0) return false;

      const v = this.video;
      if (this.stream && v.readyState >= 2 && v.videoWidth) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
        this.hasFrame = true;
      }

      const d = s.display, w = s.window;
      let cx, cy;
      if (s.follow) { cx = this.cursor.x; cy = this.cursor.y; }
      else { cx = d.width / 2 + (cfg.offsetX || 0); cy = d.height / 2 + (cfg.offsetY || 0); }
      let hw, hh, rad;
      switch (cfg.shape) {
        case 'square': hw = hh = cfg.size / 2; rad = 0; break;
        case 'rectangle': hw = cfg.width / 2; hh = cfg.height / 2; rad = 0; break;
        case 'custom': hw = cfg.width / 2; hh = cfg.height / 2; rad = cfg.roundness; break;
        default: hw = hh = cfg.size / 2; rad = cfg.size / 2;
      }
      const U = this.u;
      gl.uniform1i(U.uTex, 0);
      gl.uniform2f(U.uCanvas, W, H);
      gl.uniform1f(U.uScale, scale);
      gl.uniform2f(U.uWinOff, w.x - d.x, w.y - d.y);
      gl.uniform2f(U.uDisp, d.width, d.height);
      gl.uniform2f(U.uTexel, 1 / (v.videoWidth || d.width), 1 / (v.videoHeight || d.height));
      gl.uniform2f(U.uCenter, cx, cy);
      gl.uniform2f(U.uHalf, hw, hh);
      gl.uniform1f(U.uRadius, rad);
      gl.uniform1f(U.uZoom, Math.max(1, this.zoomShown));
      gl.uniform1f(U.uOpen, this.open);
      gl.uniform1f(U.uFeather, cfg.edgeFeather || 0);
      gl.uniform1f(U.uDistort, cfg.distortion ? cfg.distortionStrength : 0);
      gl.uniform3f(U.uAdj, cfg.brightness, cfg.contrast, cfg.saturation);
      gl.uniform1f(U.uSharpen, cfg.sharpen || 0);
      const o = cfg.outline;
      gl.uniform4f(U.uOutline, ...hexRgb(o.color), o.enabled ? o.opacity : 0);
      gl.uniform1f(U.uOutlineW, o.thickness);
      gl.uniform1f(U.uOutlineFeather, o.feather || 0);
      gl.uniform4f(U.uDim, ...hexRgb(cfg.dim.color), cfg.dim.enabled ? cfg.dim.opacity : 0);
      gl.uniform1f(U.uHasFrame, this.hasFrame ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true; // keep drawing while open: the captured image is live
    }

    lensCenter() {
      const s = this.state;
      if (!s) return null;
      if (s.follow) return { x: this.cursor.x, y: this.cursor.y };
      return { x: s.display.width / 2 + (s.cfg.offsetX || 0), y: s.display.height / 2 + (s.cfg.offsetY || 0) };
    }
  }

  XH.ScopeRenderer = ScopeRenderer;
  XH.SCOPE_QUALITY = QUALITY;
})();
