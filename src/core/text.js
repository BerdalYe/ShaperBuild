// Text as sketch geometry: glyph outlines become lines and smooth splines,
// so letters can be extruded (raised text) or cut (engraved text).
import { parse } from '../vendor/opentype/opentype.min.mjs';

export const FONTS = {
  bold: { label: 'Bold', file: 'Inter-Bold.ttf' },
  regular: { label: 'Regular', file: 'Inter-Regular.ttf' },
};

const cache = new Map();

// Load a bundled font ('bold' / 'regular') or parse font file bytes.
export async function loadFont(key, bytes) {
  if (bytes) {
    const font = parse(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    cache.set(key, font);
    return font;
  }
  if (cache.has(key)) return cache.get(key);
  const def = FONTS[key] || FONTS.bold;
  const res = await fetch(new URL(`../fonts/${def.file}`, import.meta.url));
  if (!res.ok) throw new Error(`Could not load the ${def.label} font`);
  const font = parse(await res.arrayBuffer());
  cache.set(key, font);
  return font;
}

export function parseFont(arrayBuffer) {
  return parse(arrayBuffer);
}

// Height of capital letters as a fraction of the font size.
function capRatio(font) {
  const os2 = font.tables.os2;
  const cap = os2 && os2.sCapHeight > 0 ? os2.sCapHeight : font.ascender * 0.7;
  return cap / font.unitsPerEm;
}

const quad = (a, c, b, t) => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
const cubic = (a, c1, c2, b, t) => {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const same = (a, b, eps) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

function angleBetween(u, v) {
  const lu = len(u);
  const lv = len(v);
  if (lu < 1e-12 || lv < 1e-12) return 0;
  const c = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
  return Math.acos(Math.max(-1, Math.min(1, c)));
}

// Path commands -> contours of segments in sketch coordinates (y up).
function contoursOf(commands, map) {
  const contours = [];
  let cur = null;
  let start = null;
  let last = null;
  const push = (seg) => {
    if (!cur) cur = [];
    cur.push(seg);
  };
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur?.length) contours.push(cur);
      cur = [];
      start = last = map(c.x, c.y);
    } else if (c.type === 'L') {
      const p = map(c.x, c.y);
      push({ type: 'L', a: last, b: p });
      last = p;
    } else if (c.type === 'Q') {
      const ctrl = map(c.x1, c.y1);
      const p = map(c.x, c.y);
      const pts = [last];
      for (const t of [0.25, 0.5, 0.75, 1]) pts.push(quad(last, ctrl, p, t));
      push({ type: 'C', pts, t0: sub(ctrl, last), t1: sub(p, ctrl) });
      last = p;
    } else if (c.type === 'C') {
      const c1 = map(c.x1, c.y1);
      const c2 = map(c.x2, c.y2);
      const p = map(c.x, c.y);
      const pts = [last];
      for (const t of [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]) pts.push(cubic(last, c1, c2, p, t));
      push({ type: 'C', pts, t0: sub(same(c1, last, 1e-9) ? c2 : c1, last), t1: sub(p, same(c2, p, 1e-9) ? c1 : c2) });
      last = p;
    } else if (c.type === 'Z') {
      if (last && start && !same(last, start, 1e-9)) push({ type: 'L', a: last, b: start });
      if (cur?.length) contours.push(cur);
      cur = null;
      last = start;
    }
  }
  if (cur?.length) contours.push(cur);
  return contours;
}

// Glyph outlines for one line of text, letter by letter with kerning.
// (Ligatures and other substitutions are not needed for 3D text and some
// fonts use lookups the font library cannot apply.)
function layout(font, line, fontSize, spacing) {
  const scale = fontSize / font.unitsPerEm;
  const commands = [];
  let x = 0;
  let prev = null;
  for (const ch of Array.from(line)) {
    const g = font.charToGlyph(ch);
    if (prev) {
      try {
        x += font.getKerningValue(prev, g) * scale;
      } catch {}
    }
    commands.push(...g.getPath(x, 0, fontSize).commands);
    x += (g.advanceWidth || 0) * scale + spacing;
    prev = g;
  }
  return { commands, width: x };
}

const SMOOTH = (12 * Math.PI) / 180;

// One contour -> sketch entities: straight lines stay lines, runs of curves
// that join smoothly become one spline each (corners stay sharp).
function contourEntities(segs, eps) {
  const out = [];
  const runs = [];
  for (const s of segs) {
    if (s.type === 'L') {
      if (len(sub(s.b, s.a)) > eps) runs.push({ line: s });
      continue;
    }
    const prev = runs[runs.length - 1];
    if (prev && !prev.line && angleBetween(prev.t1, s.t0) < SMOOTH) {
      prev.pts.push(...s.pts.slice(1));
      prev.t1 = s.t1;
    } else runs.push({ pts: [...s.pts], t0: s.t0, t1: s.t1 });
  }
  // A curve run that wraps around smoothly to the start of the contour.
  if (runs.length > 1) {
    const first = runs[0];
    const lastRun = runs[runs.length - 1];
    if (!first.line && !lastRun.line && angleBetween(lastRun.t1, first.t0) < SMOOTH) {
      first.pts = [...lastRun.pts, ...first.pts.slice(1)];
      first.t0 = lastRun.t0;
      runs.pop();
    }
  }
  if (runs.length === 1 && !runs[0].line) {
    const pts = runs[0].pts;
    if (same(pts[0], pts[pts.length - 1], eps) && angleBetween(runs[0].t1, runs[0].t0) < SMOOTH) {
      return [{ type: 'spline', pts: pts.slice(0, -1), closed: true }];
    }
  }
  for (const r of runs) {
    if (r.line) out.push({ type: 'line', a: r.line.a, b: r.line.b });
    else {
      const pts = r.pts.filter((p, i) => i === 0 || len(sub(p, r.pts[i - 1])) > eps * 0.5);
      if (pts.length === 2) out.push({ type: 'line', a: pts[0], b: pts[1] });
      else if (pts.length > 2) out.push({ type: 'spline', pts });
    }
  }
  return out;
}

// Sketch entities for `text`. `size` is the height of capital letters (mm).
// The text is centred on `at` (plane coordinates), running along +x.
export function textEntities(font, text, { size = 10, at = [0, 0], align = 'center', spacing = 0 } = {}) {
  const lines = String(text).split('\n');
  const fontSize = size / capRatio(font);
  const lineGap = size * 1.6;
  const all = [];
  const polys = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const eps = size * 1e-4;
  const rows = lines.map((line, row) => ({ ...layout(font, line, fontSize, spacing), y0: -row * lineGap }));
  const widest = Math.max(0, ...rows.map((r) => r.width));
  for (const r of rows) {
    const dx = align === 'center' ? (widest - r.width) / 2 : align === 'right' ? widest - r.width : 0;
    const map = (x, y) => [x + dx, -y + r.y0];
    for (const contour of contoursOf(r.commands, map)) {
      const ents = contourEntities(contour, eps);
      if (!ents.length) continue;
      all.push(...ents);
      // Polygon of the contour for inside/outside tests.
      const poly = [];
      for (const s of contour) {
        if (s.type === 'L') poly.push(s.a);
        else poly.push(...s.pts.slice(0, -1));
      }
      polys.push(poly);
      for (const p of poly) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  if (!all.length) return { entities: [], polygons: [], width: 0, height: 0 };
  // Centre the block on `at`.
  const cx = align === 'center' ? (minX + maxX) / 2 : align === 'right' ? maxX : minX;
  const cy = (minY + maxY) / 2;
  const off = [at[0] - cx, at[1] - cy];
  const mv = (p) => [p[0] + off[0], p[1] + off[1]];
  const entities = all.map((e) => (e.type === 'line' ? { type: 'line', a: mv(e.a), b: mv(e.b) } : { ...e, pts: e.pts.map(mv) }));
  return { entities, polygons: polys.map((poly) => poly.map(mv)), width: maxX - minX, height: maxY - minY };
}

// Non-zero winding test: is `p` inside the filled part of the letters?
// (Works for fonts whose outlines overlap as well as for separate holes.)
export function insideText(polygons, p) {
  let wn = 0;
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && cross > 0) wn++;
      } else if (b[1] <= p[1] && cross < 0) wn--;
    }
  }
  return wn !== 0;
}

// Polylines for previewing text before it is placed.
export function textPreview(entities) {
  return entities.map((e) => (e.type === 'line' ? [e.a, e.b] : e.closed ? [...e.pts, e.pts[0]] : e.pts));
}
