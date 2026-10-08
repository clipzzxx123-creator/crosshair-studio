// Transparent, click-through window that draws the zoom lens and the active crosshair.
(function () {
  const host = document.getElementById('xh');
  const animator = new XH.Animator();
  let crosshair = null;
  let lastKey = '';
  let timer = 0;
  let geo = null; // { display, window, offsetX, offsetY }
  let scopeMsg = null;
  let lensOpen = false;

  const scope = new XH.ScopeRenderer(document.getElementById('scope'), {
    onError: (msg) => window.api.reportScopeError(msg),
    onActiveChange: (open) => {
      if (open !== lensOpen) { lensOpen = open; placeCrosshair(); }
    },
  });

  function draw() {
    timer = 0;
    if (!crosshair) return;
    const st = animator.state();
    const key = JSON.stringify(st);
    if (key !== lastKey) {
      host.innerHTML = XH.renderSVG(crosshair, st, { size: 800, idPrefix: 'ov' });
      lastKey = key;
    }
    // A timer rather than requestAnimationFrame: rAF can be throttled for unfocused overlay windows.
    if (st.active) timer = setTimeout(draw, 8);
  }
  const schedule = () => { if (!timer) timer = setTimeout(draw, 0); };

  // Crosshair sits at the screen center (plus profile offset). While the lens is open it either
  // hides or moves to the lens center, depending on the scope setting.
  function placeCrosshair() {
    if (!geo) return;
    const { display, window: win } = geo;
    let x = display.width / 2 + geo.offsetX;
    let y = display.height / 2 + geo.offsetY;
    let visible = true;
    if (lensOpen && scopeMsg && scopeMsg.cfg.enabled) {
      if (scopeMsg.cfg.crosshair === 'hide') visible = false;
      else {
        const c = scope.lensCenter();
        if (c) { x = c.x; y = c.y; }
      }
    }
    host.style.left = Math.round(display.x + x - win.x) + 'px';
    host.style.top = Math.round(display.y + y - win.y) + 'px';
    host.style.visibility = visible ? 'visible' : 'hidden';
  }

  function pushScope() {
    if (!geo || !scopeMsg) return;
    scope.update(Object.assign({}, scopeMsg, { display: geo.display, window: geo.window }));
    placeCrosshair();
  }

  // Brief on-screen label with the new crosshair's name, below the crosshair.
  const toastEl = document.getElementById('toast');
  let toastTimer = 0;
  function announce(name) {
    toastEl.textContent = name;
    toastEl.style.left = host.style.left;
    toastEl.style.top = parseInt(host.style.top, 10) + 48 + 'px';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1200);
  }

  window.api.onOverlayUpdate(({ crosshair: ch, offsetX, offsetY, display, window: win, announce: shouldAnnounce }) => {
    // Center on the display, not the window: macOS may shift the window below the menu bar.
    geo = { display, window: win, offsetX, offsetY };
    if (!crosshair || JSON.stringify(crosshair) !== JSON.stringify(ch)) {
      crosshair = ch;
      animator.setCrosshair(ch);
      lastKey = '';
    }
    pushScope();
    placeCrosshair();
    schedule();
    if (shouldAnnounce && ch) announce(ch.name);
  });

  window.api.onOverlayScope((msg) => {
    scopeMsg = msg;
    pushScope();
  });

  window.api.onOverlayCursor((c) => {
    scope.setCursor(c);
    if (lensOpen) placeCrosshair();
  });

  window.api.onOverlayInput(({ type, button }) => {
    if (type === 'down') animator.press(button);
    else animator.release(button);
    schedule();
  });
})();
