// 2D technical drawing: lays out projected views on a sheet with overall
// sizes and a title block, as SVG (millimetres) and as line segments for DXF.

export const SHEETS = { A4: [297, 210], A3: [420, 297], Letter: [279.4, 215.9] };
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

const fmt = (v) => String(+v.toFixed(Math.abs(v) >= 100 ? 1 : 2));
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function bbox(view) {
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

// views: { front, top, right, iso } from the kernel (iso optional).
export function layoutDrawing(views, opts = {}) {
  const { sheet = 'A4', projection = 'first', hidden = true, dims = true, title = 'Part', date = new Date().toISOString().slice(0, 10), units = 'mm' } = opts;
  const [W, H] = SHEETS[sheet] || SHEETS.A4;
  const margin = 10;
  const titleH = 24;
  const gap = 22;
  const area = { x0: margin + 6, y0: margin + 6, x1: W - margin - 6, y1: H - margin - titleH - 6 };
  const b = Object.fromEntries(Object.entries(views).map(([k, v]) => [k, bbox(v)]));
  // Columns and rows of the three main views.
  const grid = projection === 'third' ? { top: [0, 0], front: [0, 1], right: [1, 1] } : { right: [0, 0], front: [1, 0], top: [1, 1] };
  const colW = [0, 0];
  const rowH = [0, 0];
  for (const [k, [c, r]] of Object.entries(grid)) {
    colW[c] = Math.max(colW[c], b[k].w);
    rowH[r] = Math.max(rowH[r], b[k].h);
  }
  const isoRoom = views.iso ? 0.3 : 0;
  const availW = (area.x1 - area.x0) * (1 - isoRoom) - gap;
  const availH = area.y1 - area.y0 - gap;
  const fit = Math.min(availW / Math.max(colW[0] + colW[1], 1e-9), availH / Math.max(rowH[0] + rowH[1], 1e-9));
  const scale = SCALES.find((s) => s <= fit) || fit;
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
  const place = (key, cx, cy, s) => {
    const v = views[key];
    const bb = b[key];
    const mx = (bb.x0 + bb.x1) / 2;
    const my = (bb.y0 + bb.y1) / 2;
    const P = ([x, y]) => [cx + (x - mx) * s, cy - (y - my) * s];
    const path = (polys) => polys.map((pl) => 'M' + pl.map((p) => P(p).map((t) => t.toFixed(3)).join(' ')).join('L')).join('');
    if (hidden && key !== 'iso' && v.hidden.length) {
      svg.push(`<path class="hid" d="${path(v.hidden)}"/>`);
      for (const pl of v.hidden) add('HIDDEN', pl.map(P));
    }
    svg.push(`<path class="vis" d="${path(v.visible)}"/>`);
    for (const pl of v.visible) add('VISIBLE', pl.map(P));
    const box = { x0: cx - (bb.w * s) / 2, x1: cx + (bb.w * s) / 2, y0: cy - (bb.h * s) / 2, y1: cy + (bb.h * s) / 2 };
    svg.push(`<text class="lbl" x="${cx.toFixed(2)}" y="${(box.y1 + (key === 'iso' ? 7 : 12)).toFixed(2)}">${VIEWS[key].label}</text>`);
    placed[key] = { box, bb };
  };
  for (const [k, [c, r]] of Object.entries(grid)) place(k, colX[c], rowY[r], scale);
  if (views.iso) {
    const x0 = left + usedW + gap;
    const room = [area.x1 - x0, (area.y1 - area.y0) * 0.6];
    const s = Math.min(scale, room[0] / Math.max(b.iso.w, 1e-9), room[1] / Math.max(b.iso.h, 1e-9));
    if (room[0] > 30 && s > 0) place('iso', x0 + room[0] / 2, area.y0 + room[1] / 2, s);
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
        svg.push(`<line class="dim" x1="${s[0].toFixed(2)}" y1="${s[1].toFixed(2)}" x2="${e[0].toFixed(2)}" y2="${e[1].toFixed(2)}"/>`);
        add('DIMENSIONS', [s, e]);
      };
      ext(a, p1);
      ext(bp, p2);
      svg.push(`<line class="dim" x1="${p1[0].toFixed(2)}" y1="${p1[1].toFixed(2)}" x2="${p2[0].toFixed(2)}" y2="${p2[1].toFixed(2)}" marker-start="url(#arr)" marker-end="url(#arr)"/>`);
      add('DIMENSIONS', [p1, p2]);
      const mx = (p1[0] + p2[0]) / 2;
      const my = (p1[1] + p2[1]) / 2;
      const text = esc(fmt(value));
      if (vertical) svg.push(`<text class="dt" transform="translate(${(mx - 1.2).toFixed(2)} ${my.toFixed(2)}) rotate(-90)">${text}</text>`);
      else svg.push(`<text class="dt" x="${mx.toFixed(2)}" y="${(my - 1.2).toFixed(2)}">${text}</text>`);
    };
    const f = placed.front;
    if (f) {
      dim([f.box.x0, f.box.y1], [f.box.x1, f.box.y1], 8, f.bb.w, false);
      dim([f.box.x0, f.box.y1], [f.box.x0, f.box.y0], 8, f.bb.h, true);
    }
    const t = placed.top;
    if (t) dim([t.box.x0, t.box.y1], [t.box.x0, t.box.y0], 8, t.bb.h, true);
  }

  // Frame and title block.
  const tbW = 120;
  const tx = W - margin - tbW;
  const ty = H - margin - titleH;
  const frame = [
    `<rect class="frame" x="${margin}" y="${margin}" width="${W - 2 * margin}" height="${H - 2 * margin}"/>`,
    `<rect class="frame" x="${tx}" y="${ty}" width="${tbW}" height="${titleH}"/>`,
    `<line class="thin" x1="${tx}" y1="${ty + 12}" x2="${tx + tbW}" y2="${ty + 12}"/>`,
    `<line class="thin" x1="${tx + 40}" y1="${ty + 12}" x2="${tx + 40}" y2="${ty + titleH}"/>`,
    `<line class="thin" x1="${tx + 80}" y1="${ty + 12}" x2="${tx + 80}" y2="${ty + titleH}"/>`,
    `<text class="tt" x="${tx + 3}" y="${ty + 8.5}">${esc(title)}</text>`,
    `<text class="tk" x="${tx + 3}" y="${ty + 16}">SCALE</text><text class="tv" x="${tx + 3}" y="${ty + 21.5}">${scaleText(scale)}</text>`,
    `<text class="tk" x="${tx + 43}" y="${ty + 16}">UNITS · PROJECTION</text><text class="tv" x="${tx + 43}" y="${ty + 21.5}">${units} · ${projection === 'third' ? '3rd angle' : '1st angle'}</text>`,
    `<text class="tk" x="${tx + 83}" y="${ty + 16}">DATE · ${sheet}</text><text class="tv" x="${tx + 83}" y="${ty + 21.5}">${esc(date)}</text>`,
    `<text class="tk" x="${margin + 2}" y="${H - margin - 2}">Drawn with ShaperBuild</text>`,
  ];
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

  const style = `
    .vis{fill:none;stroke:#000;stroke-width:0.5;stroke-linecap:round;stroke-linejoin:round}
    .hid{fill:none;stroke:#000;stroke-width:0.25;stroke-dasharray:2 1.2}
    .dim,.thin{stroke:#000;stroke-width:0.18}
    .frame{fill:none;stroke:#000;stroke-width:0.5}
    text{font-family:Arial,Helvetica,sans-serif;fill:#000}
    .dt{font-size:3.2px;text-anchor:middle}
    .lbl{font-size:3px;text-anchor:middle;letter-spacing:0.3px}
    .tt{font-size:6px;font-weight:bold}
    .tk{font-size:2.2px;fill:#555}
    .tv{font-size:3.6px}`;
  const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><defs><style>${style}</style><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="3.2" markerHeight="3.2" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1.5L10 5L0 8.5z" fill="#000"/></marker></defs><rect width="${W}" height="${H}" fill="#fff"/>${frame.join('')}${svg.join('')}</svg>`;
  return { svg: out, scale, width: W, height: H, segments: segs };
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
