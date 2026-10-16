// DXF: 2D drawings for laser cutters, CNC and other CAD apps. Sketch curves
// are written in their plane's coordinates (millimetres); reading turns
// lines, circles, arcs, polylines, ellipses and splines into sketch curves.
import { sampleSpline, TAU } from './geom2d.js';

const n = (v) => String(+(+v).toFixed(6));

// Sketches -> DXF text (R12 / AC1009, readable by almost every program).
export function writeDXF(sketches, { construction = false } = {}) {
  const out = [];
  const g = (code, value) => out.push(String(code), String(value));
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4); // millimetres
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  const layers = sketches.map((s) => layerName(s.name));
  g(70, layers.length);
  for (const name of layers) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  const poly = (layer, pts, closed) => {
    g(0, 'POLYLINE');
    g(8, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, closed ? 1 : 0);
    for (const p of pts) {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, n(p[0]));
      g(20, n(p[1]));
      g(30, 0);
    }
    g(0, 'SEQEND');
    g(8, layer);
  };
  sketches.forEach((s, i) => {
    const layer = layers[i];
    for (const e of s.entities) {
      if (e.construction && !construction) continue;
      switch (e.type) {
        case 'line':
          g(0, 'LINE');
          g(8, layer);
          g(10, n(e.a[0]));
          g(20, n(e.a[1]));
          g(30, 0);
          g(11, n(e.b[0]));
          g(21, n(e.b[1]));
          g(31, 0);
          break;
        case 'circle':
          g(0, 'CIRCLE');
          g(8, layer);
          g(10, n(e.c[0]));
          g(20, n(e.c[1]));
          g(30, 0);
          g(40, n(e.r));
          break;
        case 'arc':
          g(0, 'ARC');
          g(8, layer);
          g(10, n(e.c[0]));
          g(20, n(e.c[1]));
          g(30, 0);
          g(40, n(e.r));
          g(50, n((e.a0 * 180) / Math.PI));
          g(51, n((e.a1 * 180) / Math.PI));
          break;
        case 'ellipse': {
          const pts = [];
          const cr = Math.cos(e.rot || 0);
          const sr = Math.sin(e.rot || 0);
          for (let k = 0; k < 96; k++) {
            const t = (k / 96) * TAU;
            const x = e.rx * Math.cos(t);
            const y = e.ry * Math.sin(t);
            pts.push([e.c[0] + x * cr - y * sr, e.c[1] + x * sr + y * cr]);
          }
          poly(layer, pts, true);
          break;
        }
        case 'spline': {
          const pts = e.cache && e.cache.length ? e.cache : sampleSpline(e.pts, e.closed);
          poly(layer, e.closed ? pts.slice(0, -1) : pts, !!e.closed);
          break;
        }
        case 'point':
          g(0, 'POINT');
          g(8, layer);
          g(10, n(e.p[0]));
          g(20, n(e.p[1]));
          g(30, 0);
          break;
        default:
      }
    }
  });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}

function layerName(name) {
  return String(name || 'Sketch').replace(/[<>/\\":;?*|=,`]/g, '_').slice(0, 60) || 'Sketch';
}

const UNIT_MM = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254, 10: 914.4 };

// Group code / value pairs.
function pairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return out;
}

// Arc through a polyline bulge between p and q.
function bulgeArc(p, q, b) {
  const theta = 4 * Math.atan(Math.abs(b));
  const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (chord < 1e-12 || theta < 1e-9) return null;
  const r = chord / (2 * Math.sin(theta / 2));
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  // Unit normal to the chord, on the left for counter-clockwise bulges.
  const nx = -(q[1] - p[1]) / chord;
  const ny = (q[0] - p[0]) / chord;
  const s = (b > 0 ? 1 : -1) * (theta > Math.PI ? -1 : 1);
  const c = [mid[0] + nx * h * s, mid[1] + ny * h * s];
  let a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  let a1 = Math.atan2(q[1] - c[1], q[0] - c[0]);
  if (b < 0) [a0, a1] = [a1, a0];
  return { type: 'arc', c, r, a0, a1 };
}

function polyEntities(verts, closed) {
  const out = [];
  const count = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < count; i++) {
    const v = verts[i];
    const w = verts[(i + 1) % verts.length];
    if (Math.hypot(w.p[0] - v.p[0], w.p[1] - v.p[1]) < 1e-9) continue;
    const arc = v.bulge ? bulgeArc(v.p, w.p, v.bulge) : null;
    out.push(arc || { type: 'line', a: v.p, b: w.p });
  }
  return out;
}

// Evaluate a B-spline (degree k, knots, control points) at u.
function deBoor(k, knots, ctrl, u) {
  let s = k;
  while (s < ctrl.length - 1 && u >= knots[s + 1]) s++;
  const d = [];
  for (let j = 0; j <= k; j++) d.push([...ctrl[s - k + j]]);
  for (let r = 1; r <= k; r++) {
    for (let j = k; j >= r; j--) {
      const i = s - k + j;
      const den = knots[i + k - r + 1] - knots[i];
      const a = den === 0 ? 0 : (u - knots[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
    }
  }
  return d[k];
}

// DXF text -> { entities, skipped }. Coordinates in millimetres.
export function parseDXF(text) {
  const P = pairs(text);
  let scale = 1;
  for (let i = 0; i < P.length - 1; i++) {
    if (P[i][0] === 9 && P[i][1] === '$INSUNITS') {
      scale = UNIT_MM[parseInt(P[i + 1][1], 10)] ?? 1;
      break;
    }
  }
  // Only the ENTITIES section (blocks are not expanded).
  let start = P.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && P[i - 1]?.[1] === 'SECTION');
  if (start < 0) start = 0;
  const entities = [];
  const skipped = new Map();
  const S = (v) => +v * scale;
  let i = start + 1;
  const readEntity = () => {
    const type = P[i][1];
    const codes = [];
    i++;
    while (i < P.length && P[i][0] !== 0) {
      codes.push(P[i]);
      i++;
    }
    return { type, codes };
  };
  const get = (codes, c, d = 0) => {
    const f = codes.find((x) => x[0] === c);
    return f ? +f[1] : d;
  };
  while (i < P.length) {
    if (P[i][0] !== 0) {
      i++;
      continue;
    }
    if (P[i][1] === 'ENDSEC' || P[i][1] === 'EOF') break;
    const { type, codes } = readEntity();
    switch (type) {
      case 'LINE':
        entities.push({ type: 'line', a: [S(get(codes, 10)), S(get(codes, 20))], b: [S(get(codes, 11)), S(get(codes, 21))] });
        break;
      case 'CIRCLE':
        entities.push({ type: 'circle', c: [S(get(codes, 10)), S(get(codes, 20))], r: S(get(codes, 40)) });
        break;
      case 'ARC':
        entities.push({ type: 'arc', c: [S(get(codes, 10)), S(get(codes, 20))], r: S(get(codes, 40)), a0: (get(codes, 50) * Math.PI) / 180, a1: (get(codes, 51) * Math.PI) / 180 });
        break;
      case 'POINT':
        entities.push({ type: 'point', p: [S(get(codes, 10)), S(get(codes, 20))] });
        break;
      case 'LWPOLYLINE': {
        const closed = (get(codes, 70) & 1) === 1;
        const verts = [];
        for (const [c, v] of codes) {
          if (c === 10) verts.push({ p: [S(v), 0], bulge: 0 });
          else if (c === 20 && verts.length) verts[verts.length - 1].p[1] = S(v);
          else if (c === 42 && verts.length) verts[verts.length - 1].bulge = +v;
        }
        entities.push(...polyEntities(verts, closed));
        break;
      }
      case 'POLYLINE': {
        const closed = (get(codes, 70) & 1) === 1;
        const verts = [];
        while (i < P.length && P[i][1] === 'VERTEX') {
          const v = readEntity();
          verts.push({ p: [S(get(v.codes, 10)), S(get(v.codes, 20))], bulge: get(v.codes, 42) });
        }
        if (P[i]?.[1] === 'SEQEND') readEntity();
        entities.push(...polyEntities(verts, closed));
        break;
      }
      case 'ELLIPSE': {
        const c = [S(get(codes, 10)), S(get(codes, 20))];
        const mx = S(get(codes, 11));
        const my = S(get(codes, 21));
        const ratio = get(codes, 40, 1);
        const t0 = get(codes, 41, 0);
        const t1 = get(codes, 42, TAU);
        const rx = Math.hypot(mx, my);
        const rot = Math.atan2(my, mx);
        if (Math.abs(t1 - t0 - TAU) < 1e-6 || Math.abs(t1 - t0) < 1e-9) entities.push({ type: 'ellipse', c, rx, ry: rx * ratio, rot });
        else {
          // Partial ellipse: a smooth spline through points on it.
          let e1 = t1;
          while (e1 <= t0) e1 += TAU;
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const t = t0 + ((e1 - t0) * k) / 24;
            const x = rx * Math.cos(t);
            const y = rx * ratio * Math.sin(t);
            pts.push([c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
          }
          entities.push({ type: 'spline', pts });
        }
        break;
      }
      case 'SPLINE': {
        const degree = get(codes, 71, 3);
        const closed = (get(codes, 70) & 1) === 1;
        const knots = codes.filter((x) => x[0] === 40).map((x) => +x[1]);
        const ctrl = [];
        const fit = [];
        for (const [c, v] of codes) {
          if (c === 10) ctrl.push([S(v), 0]);
          else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = S(v);
          else if (c === 11) fit.push([S(v), 0]);
          else if (c === 21 && fit.length) fit[fit.length - 1][1] = S(v);
        }
        let pts = fit;
        if (pts.length < 2 && ctrl.length > degree && knots.length === ctrl.length + degree + 1) {
          const u0 = knots[degree];
          const u1 = knots[ctrl.length];
          const m = Math.max(12, ctrl.length * 4);
          pts = [];
          for (let k = 0; k <= m; k++) pts.push(deBoor(degree, knots, ctrl, Math.min(u0 + ((u1 - u0) * k) / m, u1 - 1e-12)));
        }
        if (pts.length >= 2) {
          if (closed && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) pts = pts.slice(0, -1);
          entities.push(pts.length === 2 ? { type: 'line', a: pts[0], b: pts[1] } : { type: 'spline', pts, closed: closed || undefined });
        }
        break;
      }
      default:
        skipped.set(type, (skipped.get(type) || 0) + 1);
    }
  }
  return { entities, skipped: Object.fromEntries(skipped) };
}
