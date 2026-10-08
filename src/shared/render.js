// Crosshair -> SVG renderer. Shared by the editor, library thumbnails, exports and the overlay.
// All geometry is drawn around the origin (0,0), which is the exact screen center.
(function () {
  const XH = (window.XH = window.XH || {});
  let filterSeq = 0;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r = (v) => Math.round(v * 1000) / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const REST = { spread: 0, scale: 1, opacity: 1, rotation: 0, firing: false, ads: false };

  // ---------- geometry per layer type ----------

  function linesGeom(L, st, fill) {
    const arms = clamp(L.arms | 0, 2, 8);
    const gap = Math.max(0, L.gap + st.spread * (L.bloom ?? 1));
    const w = Math.max(0.5, L.width);
    const len = Math.max(0, L.length);
    const rx = L.rounded ? w / 2 : 0;
    const hideTop = L.tMode === 'always' || (L.tMode === 'firing' && st.firing);
    let out = '';
    for (let i = 0; i < arms; i++) {
      if (i === 0 && hideTop) continue;
      const a = (i * 360) / arms;
      out += `<rect x="${r(-w / 2)}" y="${r(-(gap + len))}" width="${r(w)}" height="${r(len)}" rx="${r(rx)}" transform="rotate(${r(a)})" ${fill}/>`;
    }
    return out;
  }

  function dotGeom(L, st, fill) {
    const s = Math.max(0.5, L.size);
    if (L.shape === 'square') return `<rect x="${r(-s / 2)}" y="${r(-s / 2)}" width="${r(s)}" height="${r(s)}" ${fill}/>`;
    if (L.shape === 'diamond') {
      const h = s / 2;
      return `<polygon points="0,${r(-h)} ${r(h)},0 0,${r(h)} ${r(-h)},0" ${fill}/>`;
    }
    return `<circle cx="0" cy="0" r="${r(s / 2)}" ${fill}/>`;
  }

  function arcPath(radius, startDeg, endDeg) {
    // angles measured clockwise from 12 o'clock
    const p = (deg) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${r(Math.cos(a) * radius)},${r(Math.sin(a) * radius)}`;
    };
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M${p(startDeg)} A${r(radius)},${r(radius)} 0 ${large} 1 ${p(endDeg)}`;
  }

  function ringGeom(L, st, color) {
    const radius = Math.max(0.5, L.radius + st.spread * (L.bloom ?? 1));
    const t = Math.max(0.5, L.thickness);
    const segs = L.segments | 0;
    const stroke = `fill="none" stroke="${color}" stroke-width="${r(t)}"`;
    if (segs <= 1) return `<circle cx="0" cy="0" r="${r(radius)}" ${stroke}/>`;
    const step = 360 / segs;
    const gapDeg = clamp(L.segmentGap, 0, step - 1);
    const off = L.segmentOffset || 0;
    let d = '';
    for (let i = 0; i < segs; i++) {
      const s = off + i * step + gapDeg / 2;
      d += arcPath(radius, s, s + step - gapDeg) + ' ';
    }
    return `<path d="${d.trim()}" ${stroke} stroke-linecap="${L.rounded ? 'round' : 'butt'}"/>`;
  }

  // one shape instance drawn "above" the center, i.e. at (0, -radius), pointing toward the center
  function shapeUnit(L, radius, fill, color) {
    const w = Math.max(0.5, L.width);
    const h = Math.max(0.5, L.height);
    const t = Math.max(0.5, L.thickness);
    const flip = L.inward === false ? -1 : 1; // inward: tip faces the center
    const y0 = -radius; // edge nearest the center
    const strokeAttrs = `fill="none" stroke="${color}" stroke-width="${r(t)}" stroke-linejoin="miter" stroke-linecap="square"`;
    switch (L.shape) {
      case 'triangle': {
        // tip at (0, y0) when pointing inward
        const tip = flip === 1 ? y0 : y0 - h;
        const base = flip === 1 ? y0 - h : y0;
        const pts = `0,${r(tip)} ${r(w / 2)},${r(base)} ${r(-w / 2)},${r(base)}`;
        return L.filled ? `<polygon points="${pts}" ${fill}/>` : `<polygon points="${pts}" ${strokeAttrs}/>`;
      }
      case 'chevron': {
        const tip = flip === 1 ? y0 : y0 - h;
        const arm = flip === 1 ? y0 - h : y0;
        return `<polyline points="${r(-w / 2)},${r(arm)} 0,${r(tip)} ${r(w / 2)},${r(arm)}" ${strokeAttrs}/>`;
      }
      case 'arc': {
        const span = clamp(L.arcAngle, 1, 359);
        return `<path d="${arcPath(Math.max(0.5, radius), -span / 2, span / 2)}" fill="none" stroke="${color}" stroke-width="${r(t)}" stroke-linecap="${L.rounded ? 'round' : 'butt'}"/>`;
      }
      case 'rectangle': {
        const y = y0 - h;
        return L.filled
          ? `<rect x="${r(-w / 2)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ${fill}/>`
          : `<rect x="${r(-w / 2 + t / 2)}" y="${r(y + t / 2)}" width="${r(Math.max(0.5, w - t))}" height="${r(Math.max(0.5, h - t))}" ${strokeAttrs}/>`;
      }
      case 'tshape': {
        // a stem pointing at the center with a bar across the far end
        return (
          `<rect x="${r(-t / 2)}" y="${r(y0 - h)}" width="${r(t)}" height="${r(h)}" ${fill}/>` +
          `<rect x="${r(-w / 2)}" y="${r(y0 - h - t)}" width="${r(w)}" height="${r(t)}" ${fill}/>`
        );
      }
      case 'corner': {
        // a top-left L-bracket whose vertex sits `radius` from the center; a count of 4 fills every corner
        const d = radius / Math.SQRT2;
        return `<polyline points="${r(-d)},${r(-d + h)} ${r(-d)},${r(-d)} ${r(-d + w)},${r(-d)}" ${strokeAttrs}/>`;
      }
      default:
        return '';
    }
  }

  function shapeGeom(L, st, fill, color) {
    const count = clamp(L.count | 0, 1, 12);
    const radius = Math.max(0, L.radius + st.spread * (L.bloom ?? 1));
    const unit = shapeUnit(L, radius, fill, color);
    let out = '';
    for (let i = 0; i < count; i++) {
      const a = (L.startAngle || 0) + (i * 360) / count;
      out += `<g transform="rotate(${r(a)})">${unit}</g>`;
    }
    return out;
  }

  function textGeom(L, st, fill) {
    return `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${r(L.fontSize)}" font-family="${esc(
      L.fontFamily || 'system-ui'
    )}" font-weight="${esc(L.fontWeight || 700)}" ${fill}>${esc(L.text)}</text>`;
  }

  function imageGeom(L) {
    if (!L.src) return '';
    const w = Math.max(1, L.width);
    const h = Math.max(1, L.height);
    return `<image href="${esc(L.src)}" x="${r(-w / 2)}" y="${r(-h / 2)}" width="${r(w)}" height="${r(h)}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  function layerGeom(L, st) {
    const color = esc(L.color || '#ffffff');
    const fill = `fill="${color}"`;
    switch (L.type) {
      case 'lines': return linesGeom(L, st, fill);
      case 'dot': return dotGeom(L, st, fill);
      case 'ring': return ringGeom(L, st, color);
      case 'shape': return shapeGeom(L, st, fill, color);
      case 'text': return textGeom(L, st, fill);
      case 'image': return imageGeom(L);
      default: return '';
    }
  }

  // Outline and blur are SVG filters, so they work identically for every layer type, including images and text.
  function layerFilter(L, id) {
    const o = L.outline || {};
    const hasOutline = o.enabled && o.thickness > 0 && o.opacity > 0;
    const blur = L.blur > 0 ? L.blur : 0;
    if (!hasOutline && !blur) return null;
    let f = `<filter id="${id}" filterUnits="userSpaceOnUse" x="-4000" y="-4000" width="8000" height="8000" color-interpolation-filters="sRGB">`;
    let top = 'SourceGraphic';
    if (hasOutline) {
      f += `<feMorphology in="SourceAlpha" operator="dilate" radius="${r(o.thickness)}" result="dil"/>`;
      f += `<feFlood flood-color="${esc(o.color || '#000')}" flood-opacity="${r(o.opacity)}"/>`;
      f += `<feComposite in2="dil" operator="in" result="ol"/>`;
      if (o.blur > 0) f += `<feGaussianBlur in="ol" stdDeviation="${r(o.blur)}" result="ol"/>`;
      f += `<feMerge result="merged"><feMergeNode in="ol"/><feMergeNode in="SourceGraphic"/></feMerge>`;
      top = 'merged';
    }
    if (blur) f += `<feGaussianBlur in="${top}" stdDeviation="${r(blur)}"/>`;
    f += `</filter>`;
    return f;
  }

  function isAxisAligned(L) {
    const rot = (((L.rotation || 0) % 90) + 90) % 90;
    return rot === 0 && !(L.type === 'lines' && 360 / clamp(L.arms | 0, 2, 8) % 90 !== 0);
  }

  /**
   * Render a crosshair to an SVG string.
   * @param ch     crosshair definition
   * @param state  animation state (spread, scale, opacity, rotation, firing, ads)
   * @param opts   { size: viewport size in units, pixelSize: output width/height, idPrefix, background }
   */
  function renderSVG(ch, state, opts = {}) {
    const st = Object.assign({}, REST, state || {});
    const size = opts.size || 128;
    const prefix = opts.idPrefix || 'xh' + ++filterSeq;
    let defs = '';
    let body = '';
    (ch.layers || []).forEach((L, i) => {
      if (L.visible === false) return;
      const fid = `${prefix}-f${i}`;
      const filter = layerFilter(L, fid);
      if (filter) defs += filter;
      const crisp = ch.pixelSnap !== false && isAxisAligned(L) && ['lines', 'dot', 'shape'].includes(L.type) && L.shape !== 'diamond';
      const tf = `translate(${r(L.x || 0)} ${r(L.y || 0)}) rotate(${r(L.rotation || 0)}) scale(${r(L.scale ?? 1)})`;
      body += `<g transform="${tf}" opacity="${r(clamp(L.opacity ?? 1, 0, 1))}"${filter ? ` filter="url(#${fid})"` : ''}${
        crisp ? ' shape-rendering="crispEdges"' : ''
      }>${layerGeom(L, st)}</g>`;
    });
    const globalOpacity = clamp((ch.opacity ?? 1) * st.opacity, 0, 1);
    const half = size / 2;
    const px = opts.pixelSize || size; // output pixel size; viewBox stays `size` units
    const bg = opts.background ? `<rect x="${-half}" y="${-half}" width="${size}" height="${size}" fill="${esc(opts.background)}"/>` : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${-half} ${-half} ${size} ${size}" overflow="visible">` +
      `<defs>${defs}</defs>${bg}` +
      `<g opacity="${r(globalOpacity)}" transform="rotate(${r(st.rotation)}) scale(${r(st.scale)})">${body}</g></svg>`
    );
  }

  XH.renderSVG = renderSVG;
  XH.REST_STATE = REST;
})();
