// 2D geometry used by sketches: curve sampling, closest points,
// intersections, arcs and trimming. Pure functions.

export const TAU = Math.PI * 2;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const angleOf = (v) => Math.atan2(v[1], v[0]);
export const polar = (c, r, a) => {
  // Exact zeros for right angles keep coordinates clean.
  const co = Math.cos(a);
  const si = Math.sin(a);
  return [c[0] + r * (Math.abs(co) < 1e-14 ? 0 : co), c[1] + r * (Math.abs(si) < 1e-14 ? 0 : si)];
};
export const samePoint = (a, b, eps = 1e-6) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;

export function normAngle(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

// Counter-clockwise sweep from a0 to a1 in (0, 2π].
export function sweep(a0, a1) {
  const s = normAngle(a1 - a0);
  return s < 1e-12 ? TAU : s;
}

export function angleInArc(a, a0, a1, eps = 1e-9) {
  return normAngle(a - a0) <= sweep(a0, a1) + eps;
}

export function arcEndpoints(arc) {
  return [polar(arc.c, arc.r, arc.a0), polar(arc.c, arc.r, arc.a1)];
}

export function arcMidpoint(arc) {
  return polar(arc.c, arc.r, arc.a0 + sweep(arc.a0, arc.a1) / 2);
}

// Circle through three points, as an arc from p1 to p3 passing through p2.
export function arcFrom3Points(p1, p2, p3) {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s1 = p1[0] ** 2 + p1[1] ** 2;
  const s2 = p2[0] ** 2 + p2[1] ** 2;
  const s3 = p3[0] ** 2 + p3[1] ** 2;
  const c = [(s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d, (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d];
  const r = dist(c, p1);
  const a1 = angleOf(sub(p1, c));
  const a2 = angleOf(sub(p2, c));
  const a3 = angleOf(sub(p3, c));
  // Choose direction so that p2 is inside the sweep.
  if (angleInArc(a2, a1, a3)) return { c, r, a0: normAngle(a1), a1: normAngle(a3) };
  return { c, r, a0: normAngle(a3), a1: normAngle(a1) };
}

// Arc starting at p0 tangent to direction t, ending at p1.
export function tangentArc(p0, t, p1) {
  const tl = len(t);
  if (tl < 1e-12) return null;
  const n = [-t[1] / tl, t[0] / tl];
  const chord = sub(p1, p0);
  const denom = 2 * dot(chord, n);
  if (Math.abs(denom) < 1e-12) return null;
  const rSigned = dot(chord, chord) / denom;
  const c = add(p0, mul(n, rSigned));
  const r = Math.abs(rSigned);
  const a0 = angleOf(sub(p0, c));
  const a1 = angleOf(sub(p1, c));
  // Left turn (rSigned > 0) means counter-clockwise from p0.
  return rSigned > 0 ? { c, r, a0: normAngle(a0), a1: normAngle(a1) } : { c, r, a0: normAngle(a1), a1: normAngle(a0), reversed: true };
}

export function regularPolygon(c, r, sides, startAngle) {
  const pts = [];
  for (let i = 0; i < sides; i++) pts.push(polar(c, r, startAngle + (i * TAU) / sides));
  return pts;
}

// Centripetal Catmull-Rom through points (display approximation).
export function sampleSpline(pts, closed = false, perSeg = 16) {
  if (pts.length < 2) return pts.slice();
  const P = closed ? pts.slice(0, samePoint(pts[0], pts[pts.length - 1]) ? -1 : undefined) : pts;
  const n = P.length;
  const get = (i) => {
    if (closed) return P[((i % n) + n) % n];
    if (i < 0) return sub(mul(P[0], 2), P[1]);
    if (i >= n) return sub(mul(P[n - 1], 2), P[n - 2]);
    return P[i];
  };
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    const t0 = 0;
    const t1 = t0 + Math.max(1e-6, Math.sqrt(dist(p0, p1)));
    const t2 = t1 + Math.max(1e-6, Math.sqrt(dist(p1, p2)));
    const t3 = t2 + Math.max(1e-6, Math.sqrt(dist(p2, p3)));
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg;
      const A1 = add(mul(p0, (t1 - t) / (t1 - t0)), mul(p1, (t - t0) / (t1 - t0)));
      const A2 = add(mul(p1, (t2 - t) / (t2 - t1)), mul(p2, (t - t1) / (t2 - t1)));
      const A3 = add(mul(p2, (t3 - t) / (t3 - t2)), mul(p3, (t - t2) / (t3 - t2)));
      const B1 = add(mul(A1, (t2 - t) / (t2 - t0)), mul(A2, (t - t0) / (t2 - t0)));
      const B2 = add(mul(A2, (t3 - t) / (t3 - t1)), mul(A3, (t - t1) / (t3 - t1)));
      out.push(add(mul(B1, (t2 - t) / (t2 - t1)), mul(B2, (t - t1) / (t2 - t1))));
    }
  }
  out.push(closed ? P[0] : P[n - 1]);
  return out;
}

// Polyline approximation of any sketch entity.
export function sampleEntity(ent, quality = 64) {
  switch (ent.type) {
    case 'line':
      return [ent.a, ent.b];
    case 'circle': {
      const out = [];
      for (let i = 0; i <= quality; i++) out.push(polar(ent.c, ent.r, (i / quality) * TAU));
      return out;
    }
    case 'arc': {
      const s = sweep(ent.a0, ent.a1);
      const n = Math.max(4, Math.ceil((quality * s) / TAU));
      const out = [];
      for (let i = 0; i <= n; i++) out.push(polar(ent.c, ent.r, ent.a0 + (s * i) / n));
      return out;
    }
    case 'ellipse': {
      const out = [];
      const cr = Math.cos(ent.rot || 0);
      const sr = Math.sin(ent.rot || 0);
      for (let i = 0; i <= quality; i++) {
        const t = (i / quality) * TAU;
        const x = ent.rx * Math.cos(t);
        const y = ent.ry * Math.sin(t);
        out.push([ent.c[0] + x * cr - y * sr, ent.c[1] + x * sr + y * cr]);
      }
      return out;
    }
    case 'spline':
      return ent.cache && ent.cache.length ? ent.cache : sampleSpline(ent.pts, ent.closed);
    case 'point':
      return [ent.p];
    default:
      return [];
  }
}

export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-24 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const q = lerp(a, b, t);
  return { point: q, t, d: dist(p, q) };
}

export function closestOnPolyline(p, pts) {
  let best = { point: pts[0], d: Infinity, seg: 0, t: 0 };
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = closestOnSegment(p, pts[i], pts[i + 1]);
    if (c.d < best.d) best = { ...c, seg: i };
  }
  return best;
}

export function closestOnEntity(p, ent) {
  switch (ent.type) {
    case 'line':
      return closestOnSegment(p, ent.a, ent.b);
    case 'circle': {
      const v = sub(p, ent.c);
      const a = len(v) < 1e-12 ? 0 : angleOf(v);
      const q = polar(ent.c, ent.r, a);
      return { point: q, d: dist(p, q), angle: normAngle(a) };
    }
    case 'arc': {
      const v = sub(p, ent.c);
      const a = len(v) < 1e-12 ? ent.a0 : angleOf(v);
      if (angleInArc(a, ent.a0, ent.a1)) {
        const q = polar(ent.c, ent.r, a);
        return { point: q, d: dist(p, q), angle: normAngle(a) };
      }
      const [e0, e1] = arcEndpoints(ent);
      return dist(p, e0) < dist(p, e1) ? { point: e0, d: dist(p, e0), angle: ent.a0 } : { point: e1, d: dist(p, e1), angle: ent.a1 };
    }
    case 'point':
      return { point: ent.p, d: dist(p, ent.p) };
    default:
      return closestOnPolyline(p, sampleEntity(ent));
  }
}

// ---- intersections -------------------------------------------------------

export function segSeg(a, b, c, d, eps = 1e-9) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-14) return [];
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return [];
  return [add(a, mul(r, t))];
}

// Infinite line through a,b against circle (c, r).
export function lineCircle(a, b, c, r) {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A < 1e-24) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  if (disc < -1e-12 * Math.max(1, Math.abs(B * B))) return [];
  disc = Math.max(0, disc);
  const sq = Math.sqrt(disc);
  const ts = disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
  return ts.map((t) => ({ t, p: add(a, mul(d, t)) }));
}

export function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = add(c1, mul(sub(c2, c1), a / d));
  const off = mul([-(c2[1] - c1[1]) / d, (c2[0] - c1[0]) / d], h);
  return h < 1e-12 ? [m] : [add(m, off), sub(m, off)];
}

function onEntity(p, ent, eps = 1e-7) {
  if (ent.type === 'line') {
    const c = closestOnSegment(p, ent.a, ent.b);
    return c.d < eps * Math.max(1, dist(ent.a, ent.b));
  }
  if (ent.type === 'arc') return angleInArc(angleOf(sub(p, ent.c)), ent.a0, ent.a1, 1e-9);
  return true;
}

const isRound = (e) => e.type === 'circle' || e.type === 'arc';

export function intersect(e1, e2) {
  if (e1.type === 'point' || e2.type === 'point') return [];
  if (e1.type === 'line' && e2.type === 'line') return segSeg(e1.a, e1.b, e2.a, e2.b);
  if (e1.type === 'line' && isRound(e2)) return intersect(e2, e1);
  if (isRound(e1) && e2.type === 'line') {
    return lineCircle(e2.a, e2.b, e1.c, e1.r)
      .filter(({ t }) => t >= -1e-9 && t <= 1 + 1e-9)
      .map(({ p }) => p)
      .filter((p) => onEntity(p, e1));
  }
  if (isRound(e1) && isRound(e2)) return circleCircle(e1.c, e1.r, e2.c, e2.r).filter((p) => onEntity(p, e1) && onEntity(p, e2));
  // Splines and ellipses: intersect their polylines.
  const p1 = sampleEntity(e1, 96);
  const p2 = sampleEntity(e2, 96);
  const out = [];
  for (let i = 0; i + 1 < p1.length; i++) {
    for (let j = 0; j + 1 < p2.length; j++) out.push(...segSeg(p1[i], p1[i + 1], p2[j], p2[j + 1]));
  }
  return dedupe(out);
}

function dedupe(pts, eps = 1e-6) {
  const out = [];
  for (const p of pts) if (!out.some((q) => samePoint(p, q, eps))) out.push(p);
  return out;
}

// ---- trimming ------------------------------------------------------------

// Removes the piece of `ent` between the intersections around `at`.
// Returns { keep: replacement entities, removed: the piece taken away }.
export function trimEntity(ent, at, others) {
  const cuts = [];
  for (const o of others) {
    if (o.id === ent.id) continue;
    cuts.push(...intersect(ent, o));
    // Endpoints of other curves touching this one also split it.
    for (const ep of endpoints(o)) if (closestOnEntity(ep, ent).d < 1e-6) cuts.push(ep);
  }
  if (ent.type === 'line') {
    const L = dist(ent.a, ent.b);
    const ts = cuts.map((p) => closestOnSegment(p, ent.a, ent.b).t).filter((t) => t > 1e-6 && t < 1 - 1e-6);
    const tc = closestOnSegment(at, ent.a, ent.b).t;
    const lo = Math.max(0, ...ts.filter((t) => t < tc));
    const hi = Math.min(1, ...ts.filter((t) => t > tc));
    const keep = [];
    if (lo * L > 1e-6) keep.push({ ...ent, b: lerp(ent.a, ent.b, lo) });
    if ((1 - hi) * L > 1e-6) keep.push({ ...ent, id: undefined, a: lerp(ent.a, ent.b, hi) });
    return { keep, removed: { type: 'line', a: lerp(ent.a, ent.b, lo), b: lerp(ent.a, ent.b, hi) } };
  }
  if (ent.type === 'circle') {
    const angs = dedupeAngles(cuts.map((p) => normAngle(angleOf(sub(p, ent.c)))));
    if (angs.length < 2) return { keep: [], removed: ent };
    const ac = normAngle(angleOf(sub(at, ent.c)));
    const sorted = angs.sort((a, b) => a - b);
    let start = sorted[sorted.length - 1];
    let end = sorted[0];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      if (angleInArc(ac, a, b)) {
        start = a;
        end = b;
        break;
      }
    }
    // Keep the rest of the circle: from `end` round to `start`.
    return {
      keep: [{ id: ent.id, type: 'arc', c: ent.c, r: ent.r, a0: end, a1: start, construction: ent.construction }],
      removed: { type: 'arc', c: ent.c, r: ent.r, a0: start, a1: end },
    };
  }
  if (ent.type === 'arc') {
    const s = sweep(ent.a0, ent.a1);
    const ts = cuts.map((p) => normAngle(angleOf(sub(p, ent.c)) - ent.a0)).filter((t) => t > 1e-6 && t < s - 1e-6);
    const tc = normAngle(angleOf(sub(at, ent.c)) - ent.a0);
    const lo = Math.max(0, ...ts.filter((t) => t < tc));
    const hi = Math.min(s, ...ts.filter((t) => t > tc));
    const keep = [];
    if (lo * ent.r > 1e-6) keep.push({ ...ent, a1: normAngle(ent.a0 + lo) });
    if ((s - hi) * ent.r > 1e-6) keep.push({ ...ent, id: undefined, a0: normAngle(ent.a0 + hi) });
    return { keep, removed: { type: 'arc', c: ent.c, r: ent.r, a0: normAngle(ent.a0 + lo), a1: normAngle(ent.a0 + hi) } };
  }
  // Splines, ellipses and points are removed whole.
  return { keep: [], removed: ent };
}

function dedupeAngles(angs, eps = 1e-7) {
  const out = [];
  for (const a of angs) if (!out.some((b) => Math.abs(normAngle(a - b + Math.PI) - Math.PI) < eps)) out.push(a);
  return out;
}

export function endpoints(ent) {
  switch (ent.type) {
    case 'line':
      return [ent.a, ent.b];
    case 'arc':
      return arcEndpoints(ent);
    case 'spline':
      return ent.closed ? [] : [ent.pts[0], ent.pts[ent.pts.length - 1]];
    case 'point':
      return [ent.p];
    default:
      return [];
  }
}

// Points worth snapping to: endpoints, midpoints, centres, quadrants.
export function keyPoints(ent) {
  const out = [];
  switch (ent.type) {
    case 'line':
      out.push({ p: ent.a, kind: 'end' }, { p: ent.b, kind: 'end' }, { p: lerp(ent.a, ent.b, 0.5), kind: 'mid' });
      break;
    case 'circle':
      out.push({ p: ent.c, kind: 'center' });
      for (let i = 0; i < 4; i++) out.push({ p: polar(ent.c, ent.r, (i * Math.PI) / 2), kind: 'quadrant' });
      break;
    case 'arc': {
      const [a, b] = arcEndpoints(ent);
      out.push({ p: a, kind: 'end' }, { p: b, kind: 'end' }, { p: ent.c, kind: 'center' }, { p: arcMidpoint(ent), kind: 'mid' });
      break;
    }
    case 'ellipse':
      out.push({ p: ent.c, kind: 'center' });
      break;
    case 'spline':
      ent.pts.forEach((p, i) => out.push({ p, kind: i === 0 || i === ent.pts.length - 1 ? 'end' : 'point' }));
      break;
    case 'point':
      out.push({ p: ent.p, kind: 'end' });
      break;
    default:
  }
  return out;
}

export function entityLength(ent) {
  switch (ent.type) {
    case 'line':
      return dist(ent.a, ent.b);
    case 'circle':
      return TAU * ent.r;
    case 'arc':
      return sweep(ent.a0, ent.a1) * ent.r;
    default: {
      const pts = sampleEntity(ent, 128);
      let s = 0;
      for (let i = 0; i + 1 < pts.length; i++) s += dist(pts[i], pts[i + 1]);
      return s;
    }
  }
}

// Move every point of the sketch that coincides with `from` to `to`.
// Returns new entities (input is not modified).
export function moveSketchPoint(entities, from, to, eps = 1e-6) {
  return entities.map((ent) => {
    switch (ent.type) {
      case 'line': {
        const e = { ...ent };
        if (samePoint(e.a, from, eps)) e.a = to;
        if (samePoint(e.b, from, eps)) e.b = to;
        return e;
      }
      case 'circle':
      case 'ellipse':
        return samePoint(ent.c, from, eps) ? { ...ent, c: to } : ent;
      case 'arc': {
        if (samePoint(ent.c, from, eps)) return { ...ent, c: to };
        const [p0, p1] = arcEndpoints(ent);
        const pm = arcMidpoint(ent);
        const hit0 = samePoint(p0, from, eps);
        const hit1 = samePoint(p1, from, eps);
        if (!hit0 && !hit1) return ent;
        const arc = arcFrom3Points(hit0 ? to : p0, pm, hit1 ? to : p1);
        return arc ? { ...ent, ...arc } : ent;
      }
      case 'spline':
        return ent.pts.some((p) => samePoint(p, from, eps)) ? { ...ent, cache: null, pts: ent.pts.map((p) => (samePoint(p, from, eps) ? to : p)) } : ent;
      case 'point':
        return samePoint(ent.p, from, eps) ? { ...ent, p: to } : ent;
      default:
        return ent;
    }
  });
}

export function translateEntity(ent, d) {
  const t = (p) => add(p, d);
  switch (ent.type) {
    case 'line':
      return { ...ent, a: t(ent.a), b: t(ent.b) };
    case 'circle':
    case 'arc':
    case 'ellipse':
      return { ...ent, c: t(ent.c) };
    case 'spline':
      return { ...ent, cache: null, pts: ent.pts.map(t) };
    case 'point':
      return { ...ent, p: t(ent.p) };
    default:
      return ent;
  }
}

// Offset a closed or open chain of lines/arcs is complex; this offsets single
// entities (lines sideways, circles/arcs radially).
export function offsetEntity(ent, d) {
  if (ent.type === 'line') {
    const v = sub(ent.b, ent.a);
    const l = len(v) || 1;
    const n = [-v[1] / l, v[0] / l];
    return { ...ent, a: add(ent.a, mul(n, d)), b: add(ent.b, mul(n, d)) };
  }
  if (ent.type === 'circle' || ent.type === 'arc') return ent.r + d > 1e-6 ? { ...ent, r: ent.r + d } : null;
  if (ent.type === 'ellipse') return ent.rx + d > 1e-6 && ent.ry + d > 1e-6 ? { ...ent, rx: ent.rx + d, ry: ent.ry + d } : null;
  return null;
}

export function bounds2(points) {
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const p of points) {
    lo[0] = Math.min(lo[0], p[0]);
    lo[1] = Math.min(lo[1], p[1]);
    hi[0] = Math.max(hi[0], p[0]);
    hi[1] = Math.max(hi[1], p[1]);
  }
  return { lo, hi };
}

// If `lines` form one closed loop, return its vertices in order.
export function lineLoop(lines, eps = 1e-6) {
  if (lines.length < 3 || lines.some((l) => l.type !== 'line')) return null;
  const rest = lines.slice(1);
  const verts = [lines[0].a, lines[0].b];
  while (rest.length) {
    const last = verts[verts.length - 1];
    const i = rest.findIndex((l) => samePoint(l.a, last, eps) || samePoint(l.b, last, eps));
    if (i < 0) return null;
    const l = rest.splice(i, 1)[0];
    verts.push(samePoint(l.a, last, eps) ? l.b : l.a);
  }
  if (!samePoint(verts[0], verts[verts.length - 1], eps)) return null;
  verts.pop();
  return verts;
}

export function signedArea(verts) {
  let s = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// Offset a closed polygon with mitred corners; positive grows it.
export function offsetPolygon(verts, d) {
  const n = verts.length;
  const ccw = signedArea(verts) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const v = sub(b, a);
    const l = len(v) || 1;
    const out = ccw ? [v[1] / l, -v[0] / l] : [-v[1] / l, v[0] / l];
    lines.push([add(a, mul(out, d)), add(b, mul(out, d))]);
  }
  const res = [];
  for (let i = 0; i < n; i++) {
    const [p1, p2] = lines[(i + n - 1) % n];
    const [p3, p4] = lines[i];
    const r = sub(p2, p1);
    const s2 = sub(p4, p3);
    const den = cross(r, s2);
    if (Math.abs(den) < 1e-12) res.push(p3);
    else res.push(add(p1, mul(r, cross(sub(p3, p1), s2) / den)));
  }
  return res;
}
