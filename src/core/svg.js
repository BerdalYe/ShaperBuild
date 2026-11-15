// Read an SVG drawing into sketch curves (in millimetres, y up): paths,
// rectangles, circles, ellipses, lines, polylines and polygons, with their
// transforms. Straight parts become lines, curved runs become splines
// through points on the curve, so silhouettes (trees, deer, snowflakes,
// logos) come in ready to extrude.

const UNITS = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'style', 'script', 'title', 'desc', 'metadata', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'text']);

// ---- affine transforms: [a, b, c, d, e, f] maps (x, y) to (ax + cy + e, bx + dy + f)

const IDENT = [1, 0, 0, 1, 0, 0];
const mult = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

function parseTransform(text) {
  let m = IDENT;
  if (!text) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(text))) {
    const v = numbers(t[2]);
    let n = IDENT;
    const rad = ((v[0] || 0) * Math.PI) / 180;
    switch (t[1]) {
      case 'matrix':
        if (v.length >= 6) n = v.slice(0, 6);
        break;
      case 'translate':
        n = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
        break;
      case 'scale':
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const [c, s] = [Math.cos(rad), Math.sin(rad)];
        n = [c, s, -s, c, 0, 0];
        if (v.length >= 3) n = mult(mult([1, 0, 0, 1, v[1], v[2]], n), [1, 0, 0, 1, -v[1], -v[2]]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(rad), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(rad), 0, 1, 0, 0];
        break;
    }
    m = mult(m, n);
  }
  return m;
}

function numbers(text) {
  return (String(text || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);
}

function attrs(text) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2] ?? m[3];
  // Inline style wins over attributes for the few we read.
  for (const part of (out.style || '').split(';')) {
    const [k, v] = part.split(':').map((s) => s && s.trim());
    if (k && v) out[k] = v;
  }
  return out;
}

const length = (v, size = 0) => {
  const m = String(v ?? '').match(/^\s*([-+]?[\d.eE+-]+)\s*(%|[a-z]*)\s*$/);
  if (!m) return null;
  return m[2] === '%' ? (Number(m[1]) / 100) * size : Number(m[1]);
};

// ---- path data → subpaths of segments ({ type: 'line', a, b } or
// { type: 'cubic', a, c1, c2, b })

function pathSegments(d) {
  const tokens = String(d || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const subs = [];
  let segs = null;
  let i = 0;
  let cmd = '';
  let cur = [0, 0];
  let start = [0, 0];
  let lastC2 = null;
  let lastQ = null;
  const num = () => Number(tokens[i++]);
  const flag = () => {
    // Arc flags may be written together ("0 01" or "11").
    const tk = tokens[i];
    if (tk.length > 1 && /^[01]/.test(tk)) {
      tokens[i] = tk.slice(1);
      return Number(tk[0]);
    }
    i++;
    return Number(tk);
  };
  const begin = (p) => {
    segs = [];
    subs.push({ segs, closed: false });
    cur = p;
    start = p;
  };
  const line = (b) => {
    if (!segs) begin(cur);
    segs.push({ type: 'line', a: cur, b });
    cur = b;
  };
  const cubic = (c1, c2, b) => {
    if (!segs) begin(cur);
    segs.push({ type: 'cubic', a: cur, c1, c2, b });
    cur = b;
    lastC2 = c2;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const at = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    const C = cmd.toUpperCase();
    const prevC2 = lastC2;
    const prevQ = lastQ;
    lastC2 = null;
    lastQ = null;
    if (C === 'Z') {
      if (segs) {
        if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) line(start);
        subs[subs.length - 1].closed = true;
      }
      segs = null;
      cur = start;
      continue;
    }
    if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) continue;
    switch (C) {
      case 'M': {
        begin(at(num(), num()));
        cmd = rel ? 'l' : 'L'; // more pairs are lines
        break;
      }
      case 'L':
        line(at(num(), num()));
        break;
      case 'H': {
        const x = num();
        line([rel ? cur[0] + x : x, cur[1]]);
        break;
      }
      case 'V': {
        const y = num();
        line([cur[0], rel ? cur[1] + y : y]);
        break;
      }
      case 'C': {
        const c1 = at(num(), num());
        const c2 = at(num(), num());
        cubic(c1, c2, at(num(), num()));
        break;
      }
      case 'S': {
        const c1 = prevC2 ? [2 * cur[0] - prevC2[0], 2 * cur[1] - prevC2[1]] : cur;
        const c2 = at(num(), num());
        cubic(c1, c2, at(num(), num()));
        break;
      }
      case 'Q':
      case 'T': {
        const q = C === 'Q' ? at(num(), num()) : prevQ ? [2 * cur[0] - prevQ[0], 2 * cur[1] - prevQ[1]] : cur;
        const b = at(num(), num());
        const a = cur;
        cubic([a[0] + (2 / 3) * (q[0] - a[0]), a[1] + (2 / 3) * (q[1] - a[1])], [b[0] + (2 / 3) * (q[0] - b[0]), b[1] + (2 / 3) * (q[1] - b[1])], b);
        lastQ = q;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const b = at(num(), num());
        for (const s of arcToCubics(cur, b, rx, ry, rot, large, sweep)) cubic(s[0], s[1], s[2]);
        if (!segs || !segs.length || Math.hypot(cur[0] - b[0], cur[1] - b[1]) > 1e-9) line(b);
        break;
      }
      default:
        i++;
    }
  }
  return subs.filter((s) => s.segs.length);
}

// An SVG arc as cubic Bézier pieces: [[c1, c2, end], …].
function arcToCubics(p0, p1, rx, ry, phiDeg, large, sweep) {
  if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-12) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return [[p0, p1, p1]];
  const phi = (phiDeg * Math.PI) / 180;
  const [cp, sp] = [Math.cos(phi), Math.sin(phi)];
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cp * dx + sp * dy;
  const y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const h = dt / n;
  const kk = (4 / 3) * Math.tan(h / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
  const dpt = (t) => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
  const out = [];
  for (let j = 0; j < n; j++) {
    const a0 = t1 + j * h;
    const a1 = a0 + h;
    const [q0, q1, d0, d1] = [pt(a0), pt(a1), dpt(a0), dpt(a1)];
    out.push([
      [q0[0] + kk * d0[0], q0[1] + kk * d0[1]],
      [q1[0] - kk * d1[0], q1[1] - kk * d1[1]],
      j === n - 1 ? p1 : q1,
    ]);
  }
  return out;
}

// ---- shapes → subpaths

function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  const p = (x, y) => [cx + x, cy + y];
  const segs = [
    { type: 'cubic', a: p(rx, 0), c1: p(rx, k * ry), c2: p(k * rx, ry), b: p(0, ry) },
    { type: 'cubic', a: p(0, ry), c1: p(-k * rx, ry), c2: p(-rx, k * ry), b: p(-rx, 0) },
    { type: 'cubic', a: p(-rx, 0), c1: p(-rx, -k * ry), c2: p(-k * rx, -ry), b: p(0, -ry) },
    { type: 'cubic', a: p(0, -ry), c1: p(k * rx, -ry), c2: p(rx, -k * ry), b: p(rx, 0) },
  ];
  return [{ segs, closed: true }];
}

function polyPath(pts, closed) {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) segs.push({ type: 'line', a: pts[i], b: pts[i + 1] });
  if (closed && pts.length > 2) segs.push({ type: 'line', a: pts[pts.length - 1], b: pts[0] });
  return segs.length ? [{ segs, closed }] : [];
}

function shapePaths(tag, a) {
  const n = (k) => Number(length(a[k]) ?? 0);
  switch (tag) {
    case 'path':
      return pathSegments(a.d);
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')];
      if (!(w > 0 && h > 0)) return [];
      let rx = a.rx !== undefined ? n('rx') : a.ry !== undefined ? n('ry') : 0;
      let ry = a.ry !== undefined ? n('ry') : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return polyPath([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
      return pathSegments(`M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`);
    }
    case 'circle':
      return n('r') > 0 ? ellipsePath(n('cx'), n('cy'), n('r'), n('r')) : [];
    case 'ellipse':
      return n('rx') > 0 && n('ry') > 0 ? ellipsePath(n('cx'), n('cy'), n('rx'), n('ry')) : [];
    case 'line':
      return polyPath([[n('x1'), n('y1')], [n('x2'), n('y2')]], false);
    case 'polyline':
    case 'polygon': {
      const v = numbers(a.points);
      const pts = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      return polyPath(pts, tag === 'polygon');
    }
    default:
      return [];
  }
}

// ---- subpaths → sketch entities

const near = (p, q, tol) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;

function bez(s, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * s.a[k] + 3 * u * u * t * s.c1[k] + 3 * u * t * t * s.c2[k] + t * t * t * s.b[k]);
}

// The direction a segment leaves its start / arrives at its end.
function tangent(s, end) {
  const pairs = s.type === 'line' ? [[s.a, s.b]] : end ? [[s.c2, s.b], [s.c1, s.b], [s.a, s.b]] : [[s.a, s.c1], [s.a, s.c2], [s.a, s.b]];
  for (const [p, q] of pairs) {
    const d = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(d[0], d[1]);
    if (l > 1e-12) return [d[0] / l, d[1] / l];
  }
  return [1, 0];
}

function toEntities(sub, tol) {
  // Drop pieces too small to matter, keeping the chain joined.
  const segs = [];
  for (const s of sub.segs) {
    const size = s.type === 'line' ? Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) : Math.max(...[s.c1, s.c2, s.b].map((p) => Math.hypot(p[0] - s.a[0], p[1] - s.a[1])));
    if (size < tol) {
      if (segs.length) segs[segs.length - 1] = { ...segs[segs.length - 1], b: s.b };
      else if (sub.segs.length > 1) continue;
      continue;
    }
    if (segs.length) s.a = segs[segs.length - 1].b;
    segs.push({ ...s });
  }
  if (!segs.length) return [];
  if (sub.closed) segs[segs.length - 1].b = segs[0].a;
  // Group curves into smooth runs; a corner or a straight piece ends a run.
  const ents = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const pts = [run[0].a];
    for (const s of run) {
      const size = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) + Math.hypot(s.c1[0] - s.a[0], s.c1[1] - s.a[1]);
      const k = Math.max(2, Math.min(12, Math.ceil(size / (tol * 40))));
      for (let j = 1; j <= k; j++) pts.push(j === k ? s.b : bez(s, j / k));
    }
    ents.push({ type: 'spline', pts });
    run = [];
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.type === 'line') {
      flush();
      ents.push({ type: 'line', a: s.a, b: s.b });
      continue;
    }
    if (run.length) {
      const t0 = tangent(run[run.length - 1], true);
      const t1 = tangent(s, false);
      if (t0[0] * t1[0] + t0[1] * t1[1] < Math.cos((12 * Math.PI) / 180)) flush();
    }
    run.push(s);
  }
  flush();
  // A closed loop of smooth curves only: one closed spline.
  if (sub.closed && ents.length === 1 && ents[0].type === 'spline') {
    const pts = ents[0].pts.slice(0, -1);
    const t0 = tangent(segs[segs.length - 1], true);
    const t1 = tangent(segs[0], false);
    if (t0[0] * t1[0] + t0[1] * t1[1] > Math.cos((12 * Math.PI) / 180) && pts.length >= 3) return [{ type: 'spline', pts, closed: true }];
  }
  return ents;
}

// Parse the SVG text. Returns { entities, width, height } in millimetres
// with y up, the drawing's bottom-left corner at (0, 0) when `place` is
// 'origin', or centred on (0, 0) when 'center' (the default).
export function parseSVG(text, { place = 'center' } = {}) {
  text = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack = [{ m: IDENT, skip: false, tag: '' }];
  const subs = [];
  let unit = 25.4 / 96;
  let root = true;
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let t;
  while ((t = re.exec(text))) {
    const [, closing, rawTag, rest, selfClose] = t;
    const tag = rawTag.replace(/^svg:/, '');
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    const a = attrs(rest);
    let m = top.m;
    let skip = top.skip || SKIP.has(tag) || a.display === 'none';
    if (tag === 'svg' && root) {
      root = false;
      // Units: the size given in mm/in/… over the viewBox.
      const vb = numbers(a.viewBox);
      const wm = String(a.width || '').match(/^\s*([\d.eE+-]+)\s*([a-z]*)\s*$/);
      if (vb.length === 4 && vb[2] > 0) {
        const per = wm ? (Number(wm[1]) * (UNITS[wm[2]] ?? UNITS.px)) / vb[2] : UNITS.px;
        unit = per;
        m = [1, 0, 0, 1, -vb[0], -vb[1]];
      } else if (wm) unit = UNITS[wm[2]] ?? UNITS.px;
    } else if (a.transform) m = mult(m, parseTransform(a.transform));
    if (!skip && !['svg', 'g', 'a', 'switch'].includes(tag)) {
      for (const s of shapePaths(tag, a)) {
        const mp = (p) => apply(m, p);
        subs.push({ closed: s.closed, segs: s.segs.map((g) => (g.type === 'line' ? { type: 'line', a: mp(g.a), b: mp(g.b) } : { type: 'cubic', a: mp(g.a), c1: mp(g.c1), c2: mp(g.c2), b: mp(g.b) })) });
      }
    }
    if (!selfClose) stack.push({ m, skip, tag });
  }
  // To millimetres, y up.
  const mm = (p) => [p[0] * unit, -p[1] * unit];
  for (const s of subs) for (const g of s.segs) for (const k of ['a', 'b', 'c1', 'c2']) if (g[k]) g[k] = mm(g[k]);
  const all = subs.flatMap((s) => s.segs.flatMap((g) => [g.a, g.b]));
  if (!all.length) return { entities: [], width: 0, height: 0 };
  const min = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))];
  const max = [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  const shift = place === 'origin' ? min : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
  for (const s of subs) for (const g of s.segs) for (const k of ['a', 'b', 'c1', 'c2']) if (g[k]) g[k] = [g[k][0] - shift[0], g[k][1] - shift[1]];
  const size = Math.max(max[0] - min[0], max[1] - min[1]);
  const tol = Math.max(1e-4, size * 1e-5);
  const entities = subs.flatMap((s) => toEntities(s, tol));
  // Join ends that nearly meet, so outlines close into regions.
  const ends = [];
  for (const e of entities) {
    if (e.type === 'line') ends.push([e, 'a'], [e, 'b']);
    else if (!e.closed) ends.push([e, 0], [e, e.pts.length - 1]);
  }
  const get = ([e, k]) => (e.type === 'line' ? e[k] : e.pts[k]);
  const set = ([e, k], p) => (e.type === 'line' ? (e[k] = p) : (e.pts[k] = p));
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) if (get(ends[i]) !== get(ends[j]) && near(get(ends[i]), get(ends[j]), tol * 10)) set(ends[j], get(ends[i]));
  return { entities, width: max[0] - min[0], height: max[1] - min[1] };
}
