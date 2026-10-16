// 2D technical drawing: lays out projected views on a sheet with overall
// sizes, a title block, notes, and optional 3D, section and detail views,
// as SVG (millimetres) and as line segments for DXF.
import { t, localNumber } from './i18n.js';

// Landscape sizes in mm; portrait swaps them.
export const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], Letter: [279.4, 215.9], Tabloid: [431.8, 279.4] };
export const SCALES = [10, 5, 4, 2, 1, 1 / 2, 1 / 2.5, 1 / 4, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];

const R3 = 1 / Math.sqrt(3);
// View directions: `normal` points from the part towards the viewer.
export const VIEWS = {
  front: { name: 'front', label: 'FRONT', normal: [0, -1, 0], xDir: [1, 0, 0] },
  top: { name: 'top', label: 'TOP', normal: [0, 0, 1], xDir: [1, 0, 0] },
  right: { name: 'right', label: 'RIGHT', normal: [1, 0, 0], xDir: [0, 1, 0] },
  iso: { name: 'iso', label: '3D VIEW', normal: [R3, -R3, R3], xDir: [Math.SQRT1_2, Math.SQRT1_2, 0] },
};

export function scaleText(s) {
  if (s >= 1) return `${+s.toFixed(2)}:1`;
  return `1:${+(1 / s).toFixed(2)}`;
}

const fmt = (v) => localNumber(String(+v.toFixed(Math.abs(v) >= 100 ? 1 : 2)));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f2 = (v) => v.toFixed(2);

export function viewBox(view) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pl of [...view.visible, ...view.hidden])
    for (const [x, y] of pl) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// The parts of a polyline inside a circle (for detail views).
export function clipToCircle(pl, c, r) {
  const out = [];
  let cur = null;
  const inside = (p) => Math.hypot(p[0] - c[0], p[1] - c[1]) <= r;
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1];
    const b = pl[i];
    // Where the segment a→b crosses the circle (0 ≤ s ≤ 1).
    const d = [b[0] - a[0], b[1] - a[1]];
    const f = [a[0] - c[0], a[1] - c[1]];
    const A = d[0] * d[0] + d[1] * d[1];
    const B = 2 * (f[0] * d[0] + f[1] * d[1]);
    const C = f[0] * f[0] + f[1] * f[1] - r * r;
    const disc = B * B - 4 * A * C;
    const cuts = [];
    if (A > 1e-18 && disc > 0) {
      const q = Math.sqrt(disc);
      for (const s of [(-B - q) / (2 * A), (-B + q) / (2 * A)]) if (s > 0 && s < 1) cuts.push(s);
    }
    const at = (s) => [a[0] + d[0] * s, a[1] + d[1] * s];
    const stops = [0, ...cuts, 1];
    for (let k = 1; k < stops.length; k++) {
      const p = at(stops[k - 1]);
      const q = at(stops[k]);
      const mid = at((stops[k - 1] + stops[k]) / 2);
      if (inside(mid)) {
        if (!cur) {
          cur = [p];
          out.push(cur);
        }
        cur.push(q);
      } else cur = null;
    }
  }
  return out.filter((p) => p.length >= 2);
}

// 45° hatch lines filling closed outlines (even-odd), given as segments.
export function hatch(segments, spacing) {
  const m = [Math.SQRT1_2, Math.SQRT1_2];
  const d = [Math.SQRT1_2, -Math.SQRT1_2];
  let lo = Infinity;
  let hi = -Infinity;
  for (const [a, b] of segments)
    for (const p of [a, b]) {
      const v = p[0] * m[0] + p[1] * m[1];
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const out = [];
  for (let c = Math.ceil(lo / spacing) * spacing + spacing / 2; c < hi; c += spacing) {
    const ts = [];
    for (const [a, b] of segments) {
      const sa = a[0] * m[0] + a[1] * m[1];
      const sb = b[0] * m[0] + b[1] * m[1];
      if ((sa <= c && sb > c) || (sb <= c && sa > c)) {
        const k = (c - sa) / (sb - sa);
        const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
        ts.push(p[0] * d[0] + p[1] * d[1]);
      }
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const p = (tt) => [m[0] * c + d[0] * tt, m[1] * c + d[1] * tt];
      out.push([p(ts[i]), p(ts[i + 1])]);
    }
  }
  return out;
}

// Split text into lines of at most `n` characters.
function wrapText(text, n) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (line && line.length + 1 + word.length > n) {
        out.push(line);
        line = '';
      }
      line = line ? `${line} ${word}` : word.length > n ? word.slice(0, n) : word;
    }
    out.push(line);
  }
  return out;
}

// views: { front, top, right, iso?, section? } from the kernel (section
// also has `cut` outlines). opts.detail: { view, at: [x, y], radius,
// factor } in that view's coordinates.
export function layoutDrawing(views, opts = {}) {
  const {
    sheet = 'A4',
    portrait = false,
    projection = 'first',
    hidden = true,
    dims = true,
    title = 'Part',
    date = new Date().toISOString().slice(0, 10),
    units = 'mm',
    scale: fixedScale = null,
    drawnBy = '',
    material = '',
    revision = '',
    number = '',
    notes = '',
    detail = null,
    sectionAt = null,
  } = opts;
  const [W0, H0] = SHEETS[sheet] || SHEETS.A4;
  const [W, H] = portrait ? [H0, W0] : [W0, H0];
  const margin = 10;
  const titleH = 30;
  const tbW = Math.min(180, W - 2 * margin - 10);
  const gap = 22;
  // Notes sit left of the title block; long notes take room above it.
  const noteLines = notes.trim() ? wrapText(notes.slice(0, 1200), Math.max(20, Math.floor((W - 2 * margin - tbW - 10) / 1.55))) : [];
  const lineH = 3.6;
  const fitBeside = Math.max(0, Math.floor((titleH - 4) / lineH));
  const notesAbove = Math.max(0, noteLines.length - fitBeside);
  // Room is left under the bottom views for their names.
  const area = { x0: margin + 6, y0: margin + 6, x1: W - margin - 6, y1: H - margin - titleH - 14 - notesAbove * lineH };
  const b = Object.fromEntries(Object.entries(views).map(([k, v]) => [k, viewBox(v)]));
  // Columns and rows of the three main views.
  const grid = projection === 'third' ? { top: [0, 0], front: [0, 1], right: [1, 1] } : { right: [0, 0], front: [1, 0], top: [1, 1] };
  const colW = [0, 0];
  const rowH = [0, 0];
  for (const [k, [c, r]] of Object.entries(grid)) {
    colW[c] = Math.max(colW[c], b[k].w);
    rowH[r] = Math.max(rowH[r], b[k].h);
  }
  // Extra views go in a column on the right.
  const extras = [views.section && 'section', detail && views[detail.view] && 'detail', views.iso && 'iso'].filter(Boolean);
  // The largest standard scale up to s.
  const standard = (s) => SCALES.find((v) => v <= s * (1 + 1e-9)) || s;
  const isoRoom = extras.length ? (extras.length > 1 ? 0.34 : 0.3) : 0;
  const availW = (area.x1 - area.x0) * (1 - isoRoom) - gap;
  const availH = area.y1 - area.y0 - gap;
  const fit = Math.min(availW / Math.max(colW[0] + colW[1], 1e-9), availH / Math.max(rowH[0] + rowH[1], 1e-9));
  const scale = fixedScale || SCALES.find((s) => s <= fit) || fit;
  const usedW = (colW[0] + colW[1]) * scale + gap;
  const usedH = (rowH[0] + rowH[1]) * scale + gap;
  const left = area.x0 + Math.max(0, ((area.x1 - area.x0) * (1 - isoRoom) - usedW) / 2);
  const top = area.y0 + Math.max(0, (area.y1 - area.y0 - usedH) / 2);
  const colX = [left + (colW[0] * scale) / 2, left + colW[0] * scale + gap + (colW[1] * scale) / 2];
  const rowY = [top + (rowH[0] * scale) / 2, top + rowH[0] * scale + gap + (rowH[1] * scale) / 2];

  const svg = [];
  const segs = [];
  const add = (layer, pts) => {
    for (let i = 1; i < pts.length; i++) segs.push({ layer, a: pts[i - 1], b: pts[i] });
  };
  const placed = {};
  const label = (x, y, text) => svg.push(`<text class="lbl" x="${f2(x)}" y="${f2(y)}">${esc(text)}</text>`);
  // Draw view `key` (polylines from `v`) centred at cx, cy at scale s.
  const place = (key, v, bb, cx, cy, s, { caption, hiddenToo = true, clip = null } = {}) => {
    const mx = (bb.x0 + bb.x1) / 2;
    const my = (bb.y0 + bb.y1) / 2;
    const P = ([x, y]) => [cx + (x - mx) * s, cy - (y - my) * s];
    const path = (polys) => polys.map((pl) => 'M' + pl.map((p) => P(p).map(f2).join(' ')).join('L')).join('');
    const cut = (polys) => (clip ? polys.flatMap((pl) => clipToCircle(pl, clip.at, clip.radius)) : polys);
    if (hidden && hiddenToo && v.hidden.length) {
      const hv = cut(v.hidden);
      if (hv.length) svg.push(`<path class="hid" d="${path(hv)}"/>`);
      for (const pl of hv) add('HIDDEN', pl.map(P));
    }
    const vis = cut(v.visible);
    svg.push(`<path class="vis" d="${path(vis)}"/>`);
    for (const pl of vis) add('VISIBLE', pl.map(P));
    const box = { x0: cx - (bb.w * s) / 2, x1: cx + (bb.w * s) / 2, y0: cy - (bb.h * s) / 2, y1: cy + (bb.h * s) / 2 };
    label(cx, box.y1 + (key === 'iso' ? 7 : 12), caption || t(VIEWS[key].label));
    placed[key] = { box, bb, cx, cy, s, mx, my, P };
    return placed[key];
  };
  for (const [k, [c, r]] of Object.entries(grid)) place(k, views[k], b[k], colX[c], rowY[r], scale);

  // Extra views, stacked in the right-hand column.
  if (extras.length) {
    const x0 = left + usedW + gap;
    const roomW = area.x1 - x0;
    const slotH = (area.y1 - area.y0) / extras.length;
    extras.forEach((key, i) => {
      const cy = area.y0 + slotH * i + (slotH - 14) / 2;
      const cx = x0 + roomW / 2;
      if (roomW < 30) return;
      if (key === 'iso') {
        const s = Math.min(scale, roomW / Math.max(b.iso.w, 1e-9), (slotH - 16) / Math.max(b.iso.h, 1e-9));
        if (s > 0) place('iso', views.iso, b.iso, cx, cy, s);
      } else if (key === 'section') {
        const s = standard(Math.min(scale, roomW / Math.max(b.section.w, 1e-9), (slotH - 16) / Math.max(b.section.h, 1e-9)));
        const pv = place('section', views.section, b.section, cx, cy, s, { caption: `${t('SECTION A–A')}${s !== scale ? ` (${scaleText(s)})` : ''}`, hiddenToo: false });
        // Hatch the cut faces.
        const outline = [];
        for (const pl of views.section.cut || []) for (let j = 1; j < pl.length; j++) outline.push([pv.P(pl[j - 1]), pv.P(pl[j])]);
        const lines = hatch(outline, 1.6);
        if (lines.length) svg.push(`<path class="hatch" d="${lines.map(([p, q]) => `M${f2(p[0])} ${f2(p[1])}L${f2(q[0])} ${f2(q[1])}`).join('')}"/>`);
        for (const [p, q] of lines) add('HATCH', [p, q]);
      } else if (key === 'detail') {
        const parent = views[detail.view];
        const r0 = detail.radius;
        const want = scale * (detail.factor || 2);
        const s = standard(Math.min(want, roomW / (2 * r0), (slotH - 16) / (2 * r0)));
        const bb = { x0: detail.at[0] - r0, x1: detail.at[0] + r0, y0: detail.at[1] - r0, y1: detail.at[1] + r0, w: 2 * r0, h: 2 * r0 };
        place('detail', parent, bb, cx, cy, s, { caption: `${t('DETAIL B')} (${scaleText(s)})`, clip: { at: detail.at, radius: r0 } });
        svg.push(`<circle class="thin" cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r0 * s)}" fill="none"/>`);
        // Mark the detail on its parent view.
        const pp = placed[detail.view];
        if (pp) {
          const [px, py] = pp.P(detail.at);
          svg.push(`<circle class="mark" cx="${f2(px)}" cy="${f2(py)}" r="${f2(r0 * pp.s)}"/>`);
          svg.push(`<text class="mk" x="${f2(px + r0 * pp.s * 0.75 + 1)}" y="${f2(py - r0 * pp.s * 0.75 - 1)}">B</text>`);
        }
      }
    });
  }

  // Section line A–A across the top view (where the cut is).
  if (views.section && placed.top && sectionAt !== null) {
    const pt = placed.top;
    const y = pt.P([0, sectionAt])[1];
    const xa = pt.box.x0 - 6;
    const xb = pt.box.x1 + 6;
    svg.push(`<line class="cutline" x1="${f2(xa)}" y1="${f2(y)}" x2="${f2(xb)}" y2="${f2(y)}"/>`);
    add('CUT', [
      [xa, y],
      [xb, y],
    ]);
    // The arrows point the way the section is seen: from the front, towards
    // the half that is kept (up the sheet in the top view).
    for (const x of [xa, xb]) {
      svg.push(`<line class="thin" x1="${f2(x)}" y1="${f2(y + 7)}" x2="${f2(x)}" y2="${f2(y + 1)}" marker-end="url(#arr)"/>`);
      svg.push(`<text class="mk" x="${f2(x)}" y="${f2(y + 11)}">A</text>`);
    }
  }

  // Overall sizes: width and height on the front view, depth on the top view.
  if (dims) {
    const dim = (a, bp, off, value, vertical) => {
      const n = vertical ? [-1, 0] : [0, 1];
      const o = [n[0] * off, n[1] * off];
      const p1 = [a[0] + o[0], a[1] + o[1]];
      const p2 = [bp[0] + o[0], bp[1] + o[1]];
      const ext = (p, q) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const s = [p[0] + ((q[0] - p[0]) / d) * 1.5, p[1] + ((q[1] - p[1]) / d) * 1.5];
        const e = [q[0] + ((q[0] - p[0]) / d) * 2, q[1] + ((q[1] - p[1]) / d) * 2];
        svg.push(`<line class="dim" x1="${f2(s[0])}" y1="${f2(s[1])}" x2="${f2(e[0])}" y2="${f2(e[1])}"/>`);
        add('DIMENSIONS', [s, e]);
      };
      ext(a, p1);
      ext(bp, p2);
      svg.push(`<line class="dim" x1="${f2(p1[0])}" y1="${f2(p1[1])}" x2="${f2(p2[0])}" y2="${f2(p2[1])}" marker-start="url(#arr)" marker-end="url(#arr)"/>`);
      add('DIMENSIONS', [p1, p2]);
      const mx = (p1[0] + p2[0]) / 2;
      const my = (p1[1] + p2[1]) / 2;
      const text = esc(fmt(value));
      if (vertical) svg.push(`<text class="dt" transform="translate(${f2(mx - 1.2)} ${f2(my)}) rotate(-90)">${text}</text>`);
      else svg.push(`<text class="dt" x="${f2(mx)}" y="${f2(my - 1.2)}">${text}</text>`);
    };
    const f = placed.front;
    if (f) {
      dim([f.box.x0, f.box.y1], [f.box.x1, f.box.y1], 8, f.bb.w, false);
      dim([f.box.x0, f.box.y1], [f.box.x0, f.box.y0], 8, f.bb.h, true);
    }
    const tp = placed.top;
    if (tp) dim([tp.box.x0, tp.box.y1], [tp.box.x0, tp.box.y0], 8, tp.bb.h, true);
  }

  // Frame and title block: the title across the top row, then two rows of
  // labelled fields.
  const tx = W - margin - tbW;
  const ty = H - margin - titleH;
  const cell = (x, y, w, key, value, big = false) => {
    svg.push(`<rect class="thin" x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${big ? 12 : 9}" fill="none"/>`);
    svg.push(`<text class="tk" x="${f2(x + 2)}" y="${f2(y + 3)}">${esc(t(key))}</text>`);
    svg.push(`<text class="${big ? 'tt' : 'tv'}" x="${f2(x + 2)}" y="${f2(y + (big ? 10 : 7.6))}">${esc(value)}</text>`);
  };
  svg.push(`<rect class="frame" x="${margin}" y="${margin}" width="${W - 2 * margin}" height="${H - 2 * margin}"/>`);
  svg.push(`<rect class="frame" x="${f2(tx)}" y="${f2(ty)}" width="${f2(tbW)}" height="${titleH}"/>`);
  const q = tbW / 4;
  cell(tx, ty, tbW - q, 'TITLE', title, true);
  cell(tx + tbW - q, ty, q, 'DRAWING NO.', number, true);
  cell(tx, ty + 12, q, 'DRAWN BY', drawnBy);
  cell(tx + q, ty + 12, q, 'DATE', date);
  cell(tx + 2 * q, ty + 12, q, 'SCALE', scaleText(scale));
  cell(tx + 3 * q, ty + 12, q, 'SHEET', `${sheet}${portrait ? ` ${t('portrait')}` : ''}`);
  cell(tx, ty + 21, q, 'MATERIAL', material);
  cell(tx + q, ty + 21, q, 'REVISION', revision);
  cell(tx + 2 * q, ty + 21, q * 2, 'UNITS · PROJECTION', `${units} · ${t(projection === 'third' ? '3rd angle' : '1st angle')}`);
  svg.push(`<text class="tk" x="${margin + 2}" y="${H - margin - 2}">${esc(t('Drawn with ShaperBuild'))}</text>`);
  for (const [x0, y0, x1, y1] of [
    [margin, margin, W - margin, margin],
    [W - margin, margin, W - margin, H - margin],
    [W - margin, H - margin, margin, H - margin],
    [margin, H - margin, margin, margin],
  ])
    add('FRAME', [
      [x0, y0],
      [x1, y1],
    ]);

  // Notes, bottom left (above the title block's band when long).
  if (noteLines.length) {
    const nx = margin + 4;
    const bottom = H - margin - 6;
    const yStart = bottom - (noteLines.length - 1) * lineH;
    svg.push(`<text class="tk" x="${nx}" y="${f2(yStart - lineH)}">${esc(t('NOTES'))}</text>`);
    noteLines.forEach((ln, i) => svg.push(`<text class="nt" x="${nx}" y="${f2(yStart + i * lineH)}">${esc(ln)}</text>`));
  }

  const style = `
    .vis{fill:none;stroke:#000;stroke-width:0.5;stroke-linecap:round;stroke-linejoin:round}
    .hid{fill:none;stroke:#000;stroke-width:0.25;stroke-dasharray:2 1.2}
    .hatch{fill:none;stroke:#000;stroke-width:0.15}
    .cutline{stroke:#000;stroke-width:0.35;stroke-dasharray:6 1.5 1 1.5}
    .mark{fill:none;stroke:#000;stroke-width:0.25;stroke-dasharray:3 1}
    .dim,.thin{stroke:#000;stroke-width:0.18}
    .frame{fill:none;stroke:#000;stroke-width:0.5}
    text{font-family:Arial,Helvetica,sans-serif;fill:#000}
    .dt{font-size:3.2px;text-anchor:middle}
    .lbl{font-size:3px;text-anchor:middle;letter-spacing:0.3px}
    .mk{font-size:3.6px;font-weight:bold;text-anchor:middle}
    .tt{font-size:5.4px;font-weight:bold}
    .tk{font-size:2px;fill:#555}
    .tv{font-size:3.2px}
    .nt{font-size:2.8px}`;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><defs><style>${style}</style><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="3.2" markerHeight="3.2" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1.5L10 5L0 8.5z" fill="#000"/></marker></defs><rect width="${W}" height="${H}" fill="#fff"/>${svg.join('')}</svg>`;
  return { svg: out, scale, width: W, height: H, segments: segs, placed };
}

// Drawing segments as DXF sketches (paper millimetres, y up).
export function drawingSketches(layout) {
  const byLayer = new Map();
  for (const s of layout.segments) {
    if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
    byLayer.get(s.layer).push({ type: 'line', a: [s.a[0], layout.height - s.a[1]], b: [s.b[0], layout.height - s.b[1]] });
  }
  return [...byLayer].map(([name, entities]) => ({ name, entities }));
}
