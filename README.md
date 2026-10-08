# Crosshair Studio

A custom crosshair overlay for PC games: design a crosshair from layers, animate it on mouse clicks, and draw it on top of any game running in windowed or borderless mode. Runs on macOS and Windows (Electron).

## Run

```bash
npm install
npm start
```

### Updates

The installed Windows app updates itself from this repository's GitHub releases: it checks at startup and every 4 hours, downloads in the background, and shows **Restart and update** in Settings and the tray (it also installs on quit). The portable `.exe` doesn't auto-update.

To publish a new version: bump `version` in `package.json`, then run

```bash
npm run release:win
```

This builds the installer and creates a GitHub release with it (needs the `gh` CLI signed in).

### Build installers

```bash
npm run dist:win
```

This writes `dist/Crosshair Studio Setup 1.0.7.exe` (installer) and `dist/Crosshair Studio-1.0.7-portable.exe` (no install) for 64-bit Windows. It can be built from a Mac. The builds are unsigned, so Windows SmartScreen shows "Windows protected your PC": click **More info → Run anyway**. `npm run dist:mac` builds a `.dmg`.

**Windows** needs no permissions: the scope captures the screen and the mouse/keyboard hook works without any prompt.

Closing the editor keeps the crosshair running from the tray / menu-bar icon. Use **Quit** in the tray menu to exit.

**macOS:** the Scope lens needs **Screen Recording** access (System Settings → Privacy & Security → Screen Recording). Fire/aim animations, mouse-button binds and hold-to-zoom need global input. Grant Accessibility access (System Settings → Privacy & Security → Accessibility), then restart the app. Everything else works without it.

## Features

| Area | What you get |
| --- | --- |
| Designer | Layers: **Lines** (2–8 arms, length, thickness, gap, T-shape off/always/while firing, rounded ends), **Dot** (square/circle/diamond), **Ring** (full or segmented), **Shapes** (chevron, triangle, arc, rectangle, T, corner brackets; radial count + angle), **Text/emoji**, **Image** (PNG, GIF incl. animated, JPG, WebP, SVG) |
| Per layer | Color, opacity, blur, outline (thickness, color, opacity, glow), X/Y position, rotation, scale, show/hide, reorder, duplicate |
| Animations | Triggered per mouse button (left, right, middle, 4, 5); multi-stage; animate spread, scale, opacity, rotation; "play once" or "hold while pressed"; easing presets or a custom `cubic-bezier()` curve. Templates: Bloom, Recoil kick, Pulse, Spin, Fade on aim |
| Behavior | Hide while aiming (hold or toggle right-click), overall opacity, pixel-perfect edges |
| Library | 57 built-in presets in 7 categories (Classic, Dot, Circle, Radial, Shapes, Sights, Fun) |
| Collection | Unlimited saved crosshairs, search, duplicate, delete, undo/redo |
| Game profiles | Each profile keeps its own crosshair, monitor and 1px-precise position offset |
| Settings tab | Binds for show/hide, next/previous crosshair and re-center, plus a bind per crosshair: **Switch to it** or **Use while held** (e.g. a sniper crosshair on right click). Any key, combo, or right/middle/side mouse button, with duplicate warnings. Launch at sign-in (optionally hidden in the tray), on-screen name when switching, Esc kill switch on/off |
| Sharing | Share codes (`XHS1.…`), import a code, export PNG (1–8×) or SVG |
| Scope (zoom lens) | Live magnifier over any game: zoom 1.1–20×, zoom step, set/reset zoom, scroll-wheel zoom, animated zoom. Lens shapes: circle, square, rectangle, custom (width, height, roundness), edge softness. Focus ring (color, thickness, opacity, feather), dim outside the lens, convex lens distortion, brightness/contrast/saturation/sharpen. Fixed position (with offset) or follow cursor, with a hotkey to switch. Crosshair stays on top or hides while zoomed |
| Scope binds | Toggle, hold (with delay ms), zoom in, zoom out, set zoom, reset, follow/fixed; any key, key combo, or right/middle/side mouse button. Hold Esc for 3 s to hide everything |
| Scope graphics | Ultra Performance → Ultra quality modes (capture fps + resolution), VSync toggle, keep-capture-warm for instant zoom. Settings are saved per game profile |
| Preview | Game-style backgrounds or your own screenshot, 1–8× zoom, 1:1 inset; click the preview to test fire/aim animations |

## Not included (vs. commercial overlay apps)

- **Exclusive-fullscreen games:** a normal window can't draw over exclusive fullscreen. Run the game in borderless or windowed mode. (Some Windows apps get around this with an Xbox Game Bar widget.)
- **Online community gallery / Steam Workshop:** those need a backend. Use share codes instead.
- **Controller binds** for the scope (keyboard and mouse only).
- **Automatic per-game switching:** pick the profile yourself from the top bar or the tray.

## Project layout

```
main.js              Electron main: overlay window, tray, binds, mouse hook, startup, persistence
bindings.js          shared key/mouse bind matching
scope-main.js        Scope controller: binds, hold/toggle, cursor follow, capture source, Esc kill switch
preload.js           IPC bridge
src/shared/render.js   crosshair → SVG (used by editor, thumbnails, exports and overlay)
src/shared/animator.js button-triggered multi-stage animations + easing
src/shared/model.js    data model, defaults, share codes
src/shared/presets.js  built-in library
src/editor/            editor UI (also opens in a plain browser for development)
src/overlay/           transparent click-through overlay (crosshair + WebGL zoom lens in scope.js)
```

Data is saved to `crosshair-studio.json` in the app's user-data folder.
