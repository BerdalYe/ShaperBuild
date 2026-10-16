// 2D geometric constraint solver for sketches.
//
// Entity coordinates become one variable vector. Each constraint is one or
// more residual functions that must reach zero. Points at identical
// coordinates (shared line ends, centres on corners, …) are treated as
// coincident. Solving is damped least squares (Levenberg–Marquardt):
// first towards drag targets while keeping constraints, then projected
// exactly back onto the constraints.
//
// Constraint shapes (refs are entity ids, point refs are { e, p }):
//   { type: 'horizontal' | 'vertical', e }
//   { type: 'parallel' | 'perpendicular' | 'equal', e, e2 }
//   { type: 'tangent' | 'concentric', e, e2 }
//   { type: 'coincident', p, p2 }        { type: 'midpoint', p, e }
//   { type: 'onCurve', p, e }            { type: 'fix', p, value: [x, y] }
//   { type: 'length', e, value }         { type: 'radius' | 'diameter', e, value }
//   { type: 'angle', e, e2, value }      { type: 'distance', p, p2, value }
//   { type: 'symmetric', p, p2, e }      (p and p2 mirrored across line e)
// Point names: line a/b, circle & arc c, arc s/e (start/end), point p,
// spline p0…pn.
import { freeVariables } from './dof.js';

const TAU = Math.PI * 2;

export const CONSTRAINT_INFO = {
  horizontal: { label: 'Horizontal', glyph: 'H' },
  vertical: { label: 'Vertical', glyph: 'V' },
  parallel: { label: 'Parallel', glyph: '∥' },
  perpendicular: { label: 'Perpendicular', glyph: '⊥' },
  equal: { label: 'Equal', glyph: '=' },
  tangent: { label: 'Tangent', glyph: 'T' },
  concentric: { label: 'Concentric', glyph: '◎' },
  coincident: { label: 'Coincident', glyph: '•' },
  midpoint: { label: 'Midpoint', glyph: 'M' },
  onCurve: { label: 'On curve', glyph: '⊙' },
  fix: { label: 'Fixed', glyph: '⚓' },
  symmetric: { label: 'Symmetric', glyph: '⇹' },
  length: { label: 'Length', dimension: true },
  radius: { label: 'Radius', dimension: true },
  diameter: { label: 'Diameter', dimension: true },
  angle: { label: 'Angle', dimension: true },
  distance: { label: 'Distance', dimension: true },
};

// ---- variables ---------------------------------------------------------

class Vars {
  constructor(entities) {
    this.x = [];
    this.map = new Map(); // entity id -> { type, idx: {...} }
    for (const en of entities) {
      const idx = {};
      const push = (name, v) => {
        idx[name] = this.x.length;
        this.x.push(v);
      };
      switch (en.type) {
        case 'line':
          push('ax', en.a[0]);
          push('ay', en.a[1]);
          push('bx', en.b[0]);
          push('by', en.b[1]);
          break;
        case 'circle':
          push('cx', en.c[0]);
          push('cy', en.c[1]);
          push('r', en.r);
          break;
        case 'arc':
          push('cx', en.c[0]);
          push('cy', en.c[1]);
          push('r', en.r);
          push('a0', en.a0);
          push('a1', unwrapEnd(en.a0, en.a1));
          break;
        case 'ellipse':
          push('cx', en.c[0]);
          push('cy', en.c[1]);
          push('rx', en.rx);
          push('ry', en.ry);
          push('rot', en.rot || 0);
          break;
        case 'spline':
          en.pts.forEach((p, i) => {
            push(`p${i}x`, p[0]);
            push(`p${i}y`, p[1]);
          });
          break;
        case 'point':
          push('px', en.p[0]);
          push('py', en.p[1]);
          break;
        default:
      }
      this.map.set(en.id, { type: en.type, idx, en });
    }
  }

  ent(id) {
    return this.map.get(id);
  }

  // Point accessor: { vars, get(x) -> [x, y] } or null.
  point(ref) {
    const m = this.map.get(ref.e);
    if (!m) return null;
    const I = m.idx;
    const direct = (kx, ky) => (I[kx] === undefined ? null : { vars: [I[kx], I[ky]], get: (x) => [x[I[kx]], x[I[ky]]] });
    switch (ref.p) {
      case 'a':
        return direct('ax', 'ay');
      case 'b':
        return direct('bx', 'by');
      case 'c':
        return direct('cx', 'cy');
      case 'p':
        return direct('px', 'py');
      case 's':
      case 'e': {
        if (m.type !== 'arc') return null;
        const ka = ref.p === 's' ? 'a0' : 'a1';
        return {
          vars: [I.cx, I.cy, I.r, I[ka]],
          get: (x) => [x[I.cx] + x[I.r] * Math.cos(x[I[ka]]), x[I.cy] + x[I.r] * Math.sin(x[I[ka]])],
        };
      }
      default: {
        const mm = /^p(\d+)$/.exec(ref.p);
        if (mm) return direct(`p${mm[1]}x`, `p${mm[1]}y`);
        return null;
      }
    }
  }

  // Write variables back into entities.
  apply(entities, x) {
    return entities.map((en) => {
      const m = this.map.get(en.id);
      if (!m) return en;
      const I = m.idx;
      switch (en.type) {
        case 'line':
          return { ...en, a: [x[I.ax], x[I.ay]], b: [x[I.bx], x[I.by]] };
        case 'circle':
          return { ...en, c: [x[I.cx], x[I.cy]], r: Math.abs(x[I.r]) };
        case 'arc':
          return { ...en, c: [x[I.cx], x[I.cy]], r: Math.abs(x[I.r]), a0: norm(x[I.a0]), a1: norm(x[I.a1]) };
        case 'ellipse':
          return { ...en, c: [x[I.cx], x[I.cy]], rx: Math.abs(x[I.rx]), ry: Math.abs(x[I.ry]), rot: x[I.rot] };
        case 'spline':
          return { ...en, cache: null, pts: en.pts.map((_, i) => [x[I[`p${i}x`]], x[I[`p${i}y`]]]) };
        case 'point':
          return { ...en, p: [x[I.px], x[I.py]] };
        default:
          return en;
      }
    });
  }
}

function norm(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

function unwrapEnd(a0, a1) {
  let s = norm(a1 - a0);
  if (s < 1e-12) s = TAU;
  return a0 + s;
}

// Every named point of an entity, for coincidence detection.
export function entityPoints(en) {
  switch (en.type) {
    case 'line':
      return [
        { p: 'a', at: en.a },
        { p: 'b', at: en.b },
      ];
    case 'circle':
      return [{ p: 'c', at: en.c }];
    case 'ellipse':
      return [{ p: 'c', at: en.c }];
    case 'arc':
      return [
        { p: 'c', at: en.c },
        { p: 's', at: [en.c[0] + en.r * Math.cos(en.a0), en.c[1] + en.r * Math.sin(en.a0)] },
        { p: 'e', at: [en.c[0] + en.r * Math.cos(en.a1), en.c[1] + en.r * Math.sin(en.a1)] },
      ];
    case 'spline':
      return en.pts.map((at, i) => ({ p: `p${i}`, at }));
    case 'point':
      return [{ p: 'p', at: en.p }];
    default:
      return [];
  }
}

// Groups of point refs that sit at the same place.
export function coincidentGroups(entities, eps = 1e-6) {
  const all = [];
  for (const en of entities) for (const pt of entityPoints(en)) all.push({ e: en.id, p: pt.p, at: pt.at });
  const groups = [];
  const used = new Set();
  const key = (q) => `${Math.round(q[0] / eps)},${Math.round(q[1] / eps)}`;
  const buckets = new Map();
  all.forEach((q, i) => {
    const k = key(q.at);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const g = [i];
    used.add(i);
    // Neighbouring buckets catch values on either side of a rounding edge.
    const [kx, ky] = key(all[i].at).split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(`${kx + dx},${ky + dy}`) || []) {
          if (used.has(j)) continue;
          if (Math.abs(all[j].at[0] - all[i].at[0]) < eps && Math.abs(all[j].at[1] - all[i].at[1]) < eps) {
            g.push(j);
            used.add(j);
          }
        }
      }
    }
    if (g.length > 1) groups.push(g.map((k) => ({ e: all[k].e, p: all[k].p })));
  }
  return groups;
}

// ---- residuals -----------------------------------------------------------

function lineAcc(V, id) {
  const m = V.ent(id);
  if (!m || m.type !== 'line') return null;
  const I = m.idx;
  return { vars: [I.ax, I.ay, I.bx, I.by], a: (x) => [x[I.ax], x[I.ay]], b: (x) => [x[I.bx], x[I.by]] };
}

function roundAcc(V, id) {
  const m = V.ent(id);
  if (!m || (m.type !== 'circle' && m.type !== 'arc')) return null;
  const I = m.idx;
  return { vars: [I.cx, I.cy, I.r], c: (x) => [x[I.cx], x[I.cy]], r: (x) => x[I.r] };
}

const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len2 = (v) => Math.hypot(v[0], v[1]) || 1e-12;
const crossN = (u, v) => (u[0] * v[1] - u[1] * v[0]) / (len2(u) * len2(v));
const dotN = (u, v) => (u[0] * v[0] + u[1] * v[1]) / (len2(u) * len2(v));

// Residuals for one constraint: [{ vars, f }] or null if it no longer applies.
export function residuals(V, c, entities) {
  const R = [];
  const add = (vars, f) => R.push({ vars: [...new Set(vars)], f });
  switch (c.type) {
    case 'horizontal':
    case 'vertical': {
      const L = lineAcc(V, c.e);
      if (!L) return null;
      const k = c.type === 'horizontal' ? 1 : 0;
      add(L.vars, (x) => L.b(x)[k] - L.a(x)[k]);
      break;
    }
    case 'parallel':
    case 'perpendicular': {
      const A = lineAcc(V, c.e);
      const B = lineAcc(V, c.e2);
      if (!A || !B) return null;
      const fn = c.type === 'parallel' ? crossN : dotN;
      add([...A.vars, ...B.vars], (x) => fn(sub2(A.b(x), A.a(x)), sub2(B.b(x), B.a(x))));
      break;
    }
    case 'angle': {
      const A = lineAcc(V, c.e);
      const B = lineAcc(V, c.e2);
      if (!A || !B) return null;
      // Signed angle from the first line to the second, in degrees.
      const t = (c.value * Math.PI) / 180;
      add([...A.vars, ...B.vars], (x) => {
        const u = sub2(A.b(x), A.a(x));
        const v = sub2(B.b(x), B.a(x));
        let d = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) - t;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        return d;
      });
      break;
    }
    case 'equal': {
      const A = lineAcc(V, c.e);
      const B = lineAcc(V, c.e2);
      if (A && B) {
        add([...A.vars, ...B.vars], (x) => len2(sub2(A.b(x), A.a(x))) - len2(sub2(B.b(x), B.a(x))));
        break;
      }
      const P = roundAcc(V, c.e);
      const Q = roundAcc(V, c.e2);
      if (!P || !Q) return null;
      add([...P.vars, ...Q.vars], (x) => P.r(x) - Q.r(x));
      break;
    }
    case 'length': {
      const L = lineAcc(V, c.e);
      if (!L) return null;
      add(L.vars, (x) => len2(sub2(L.b(x), L.a(x))) - c.value);
      break;
    }
    case 'radius':
    case 'diameter': {
      const P = roundAcc(V, c.e);
      if (!P) return null;
      const k = c.type === 'diameter' ? 2 : 1;
      add(P.vars, (x) => k * P.r(x) - c.value);
      break;
    }
    case 'concentric': {
      const P = roundAcc(V, c.e);
      const Q = roundAcc(V, c.e2);
      if (!P || !Q) return null;
      add([...P.vars, ...Q.vars], (x) => P.c(x)[0] - Q.c(x)[0]);
      add([...P.vars, ...Q.vars], (x) => P.c(x)[1] - Q.c(x)[1]);
      break;
    }
    case 'tangent': {
      let L = lineAcc(V, c.e);
      let P = roundAcc(V, c.e2);
      if (!L || !P) {
        L = lineAcc(V, c.e2);
        P = roundAcc(V, c.e);
      }
      if (L && P) {
        add([...L.vars, ...P.vars], (x) => {
          const a = L.a(x);
          const d = sub2(L.b(x), a);
          return Math.abs((d[0] * (P.c(x)[1] - a[1]) - d[1] * (P.c(x)[0] - a[0])) / len2(d)) - Math.abs(P.r(x));
        });
        break;
      }
      const A = roundAcc(V, c.e);
      const B = roundAcc(V, c.e2);
      if (!A || !B) return null;
      // Keep the current kind of tangency (outside or inside).
      const ea = entities.find((e) => e.id === c.e);
      const eb = entities.find((e) => e.id === c.e2);
      const d0 = Math.hypot(ea.c[0] - eb.c[0], ea.c[1] - eb.c[1]);
      const inside = d0 < Math.max(ea.r, eb.r);
      add([...A.vars, ...B.vars], (x) => len2(sub2(A.c(x), B.c(x))) - (inside ? Math.abs(A.r(x) - B.r(x)) : A.r(x) + B.r(x)));
      break;
    }
    case 'coincident':
    case 'distance': {
      const p = V.point(c.p);
      const q = V.point(c.p2);
      if (!p || !q) return null;
      if (c.type === 'distance') add([...p.vars, ...q.vars], (x) => len2(sub2(p.get(x), q.get(x))) - c.value);
      else {
        add([...p.vars, ...q.vars], (x) => p.get(x)[0] - q.get(x)[0]);
        add([...p.vars, ...q.vars], (x) => p.get(x)[1] - q.get(x)[1]);
      }
      break;
    }
    case 'midpoint': {
      const p = V.point(c.p);
      const L = lineAcc(V, c.e);
      if (!p || !L) return null;
      for (const k of [0, 1]) add([...p.vars, ...L.vars], (x) => p.get(x)[k] - (L.a(x)[k] + L.b(x)[k]) / 2);
      break;
    }
    case 'onCurve': {
      const p = V.point(c.p);
      if (!p) return null;
      const L = lineAcc(V, c.e);
      if (L) {
        add([...p.vars, ...L.vars], (x) => crossN(sub2(L.b(x), L.a(x)), sub2(p.get(x), L.a(x))) * len2(sub2(p.get(x), L.a(x))));
        break;
      }
      const P = roundAcc(V, c.e);
      if (!P) return null;
      add([...p.vars, ...P.vars], (x) => len2(sub2(p.get(x), P.c(x))) - Math.abs(P.r(x)));
      break;
    }
    case 'symmetric': {
      // p and p2 mirror each other across line e.
      const p = V.point(c.p);
      const q = V.point(c.p2);
      const L = lineAcc(V, c.e);
      if (!p || !q || !L) return null;
      const vars = [...p.vars, ...q.vars, ...L.vars];
      const axis = (x) => {
        const d = sub2(L.b(x), L.a(x));
        return [d, Math.hypot(d[0], d[1]) || 1];
      };
      add(vars, (x) => {
        const [d, l] = axis(x);
        const P = p.get(x);
        const Q = q.get(x);
        return ((Q[0] - P[0]) * d[0] + (Q[1] - P[1]) * d[1]) / l;
      });
      add(vars, (x) => {
        const [d, l] = axis(x);
        const P = p.get(x);
        const Q = q.get(x);
        const a = L.a(x);
        const M = [(P[0] + Q[0]) / 2 - a[0], (P[1] + Q[1]) / 2 - a[1]];
        return (d[0] * M[1] - d[1] * M[0]) / l;
      });
      break;
    }
    case 'fix': {
      const p = V.point(c.p);
      if (!p || !c.value) return null;
      add(p.vars, (x) => p.get(x)[0] - c.value[0]);
      add(p.vars, (x) => p.get(x)[1] - c.value[1]);
      break;
    }
    default:
      return null;
  }
  return R;
}

// ---- least squares -------------------------------------------------------

// rows: [{ vars, f, w }]. Minimises sum (w f)^2 starting from x (in place).
function levenberg(x, rows, { iterations = 60, tol = 1e-12 } = {}) {
  const n = x.length;
  let mu = 1e-3;
  const cost = (xx) => {
    let s = 0;
    for (const r of rows) s += (r.w * r.f(xx)) ** 2;
    return s;
  };
  let c0 = cost(x);
  const A = new Float64Array(n * n);
  const g = new Float64Array(n);
  const scale = Math.max(1, ...x.map(Math.abs));
  for (let it = 0; it < iterations && c0 > tol; it++) {
    // Normal equations (JᵀJ + μD) δ = -Jᵀr; sketches are small, so dense.
    A.fill(0);
    g.fill(0);
    for (const r of rows) {
      const f0 = r.w * r.f(x);
      const vs = r.vars;
      const J = new Array(vs.length);
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        const h = 1e-7 * Math.max(1, Math.abs(x[v]));
        const old = x[v];
        x[v] = old + h;
        const fp = r.w * r.f(x);
        x[v] = old - h;
        const fm = r.w * r.f(x);
        x[v] = old;
        J[i] = (fp - fm) / (2 * h);
      }
      for (let i = 0; i < vs.length; i++) {
        if (J[i] === 0) continue;
        const row = vs[i] * n;
        g[vs[i]] += J[i] * f0;
        for (let j = 0; j < vs.length; j++) A[row + vs[j]] += J[i] * J[j];
      }
    }
    let improved = false;
    let stepSize = 0;
    for (let tries = 0; tries < 10; tries++) {
      const M = A.slice();
      for (let i = 0; i < n; i++) M[i * n + i] += mu * (A[i * n + i] + 1e-9) + 1e-14;
      const d = cholesky(M, g, n);
      if (!d) {
        mu *= 10;
        continue;
      }
      const xn = x.slice();
      stepSize = 0;
      for (let i = 0; i < n; i++) {
        xn[i] -= d[i];
        stepSize = Math.max(stepSize, Math.abs(d[i]));
      }
      const c1 = cost(xn);
      if (c1 < c0) {
        for (let i = 0; i < n; i++) x[i] = xn[i];
        c0 = c1;
        mu = Math.max(mu / 4, 1e-12);
        improved = true;
        break;
      }
      mu *= 6;
    }
    // Stop when nothing improves or the steps become negligible.
    if (!improved || stepSize < 1e-11 * scale) break;
  }
  return c0;
}

// Solves M d = b for symmetric positive definite M (Cholesky).
function cholesky(M, b, n) {
  const L = M;
  for (let j = 0; j < n; j++) {
    let s = L[j * n + j];
    for (let k = 0; k < j; k++) s -= L[j * n + k] * L[j * n + k];
    if (s <= 0) return null;
    const d = Math.sqrt(s);
    L[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = L[i * n + j];
      for (let k = 0; k < j; k++) t -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = t / d;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const out = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * out[k];
    out[i] = s / L[i * n + i];
  }
  return out;
}

// ---- public API ----------------------------------------------------------

// Solve a sketch. drags: [{ ref: point ref, to: [x, y] }] pull points
// towards targets. loose: point refs not joined to points they touch.
// Returns { ok, entities, constraints, residual }.
export function solveSketch(entities, constraints = [], { drags = [], tolerance = 1e-7, loose = [] } = {}) {
  const V = new Vars(entities);
  const x0 = V.x.slice();
  const hard = [];
  const kept = [];
  for (const c of constraints) {
    const R = residuals(V, c, entities);
    if (!R) continue; // refers to something that no longer exists
    kept.push(c);
    hard.push(...R);
  }
  const isLoose = (r) => loose.some((l) => l.e === r.e && l.p === r.p);
  for (const g0 of coincidentGroups(entities)) {
    const g = g0.filter((r) => !isLoose(r));
    for (let i = 1; i < g.length; i++) hard.push(...residuals(V, { type: 'coincident', p: g[0], p2: g[i] }, entities));
  }
  const x = V.x.slice();
  if (!hard.length && !drags.length) return { ok: true, entities, constraints: kept, residual: 0 };
  // Phase 1: follow the drag targets while honouring constraints.
  if (drags.length) {
    const rows = hard.map((r) => ({ ...r, w: 100 }));
    for (const d of drags) {
      const p = V.point(d.ref);
      if (!p) continue;
      rows.push({ vars: p.vars, f: (xx) => p.get(xx)[0] - d.to[0], w: 1 });
      rows.push({ vars: p.vars, f: (xx) => p.get(xx)[1] - d.to[1], w: 1 });
    }
    // Light pull towards the old shape so unrelated geometry stays put.
    for (let i = 0; i < x.length; i++) rows.push({ vars: [i], f: (xx) => xx[i] - x0[i], w: 1e-3 });
    levenberg(x, rows, { iterations: 80 });
  }
  // Phase 2: land exactly on the constraints with minimal movement.
  const x1 = x.slice();
  const rows2 = hard.map((r) => ({ ...r, w: 1 }));
  for (let i = 0; i < x.length; i++) rows2.push({ vars: [i], f: (xx) => xx[i] - x1[i], w: 1e-5 });
  levenberg(x, rows2, { iterations: 100, tol: 1e-26 });
  const residual = Math.max(0, ...hard.map((r) => Math.abs(r.f(x))));
  const ok = residual < tolerance * Math.max(1, ...x.map(Math.abs));
  // Make coincident points exactly equal again (removes solver round-off).
  for (const g of coincidentGroups(entities)) {
    const settable = g
      .filter((r) => !isLoose(r))
      .map((ref) => V.point(ref))
      .filter((p) => p && p.vars.length === 2);
    if (settable.length < 2) continue;
    const [i0, i1] = settable[0].vars;
    for (const p of settable.slice(1)) {
      x[p.vars[0]] = x[i0];
      x[p.vars[1]] = x[i1];
    }
  }
  return { ok, entities: V.apply(entities, x), constraints: kept, residual };
}

// Entities the constraints hold completely in place (shown green): every
// value of theirs is outside the free motions the constraints allow.
export function definedEntities(entities, constraints = []) {
  const out = new Set();
  if (!constraints.length) return out;
  const V = new Vars(entities);
  if (!V.x.length || V.x.length > 800) return out;
  const rows = [];
  for (const c of constraints) {
    const R = residuals(V, c, entities);
    if (R) rows.push(...R);
  }
  for (const g of coincidentGroups(entities)) {
    for (let i = 1; i < g.length; i++) rows.push(...residuals(V, { type: 'coincident', p: g[0], p2: g[i] }, entities));
  }
  const free = freeVariables(rows, V.x.slice(), V.x.length);
  for (const [id, m] of V.map) {
    const idx = Object.values(m.idx);
    if (idx.length && idx.every((i) => !free[i])) out.add(id);
  }
  return out;
}

// Coordinates of a named point.
export function pointOf(entities, ref) {
  const en = entities.find((e) => e.id === ref.e);
  if (!en) return null;
  return entityPoints(en).find((p) => p.p === ref.p)?.at || null;
}

// Named points of the sketch located at `at`.
export function refsAt(entities, at, eps = 1e-6) {
  const out = [];
  for (const en of entities) for (const p of entityPoints(en)) if (Math.abs(p.at[0] - at[0]) < eps && Math.abs(p.at[1] - at[1]) < eps) out.push({ e: en.id, p: p.p });
  return out;
}

// Current measured value for a dimension constraint (used when creating it).
export function measure(c, entities) {
  const V = new Vars(entities);
  const R = residuals(V, { ...c, value: 0 }, entities);
  if (!R || !R.length) return null;
  const v = R[0].f(V.x);
  if (c.type === 'angle') {
    const A = lineAcc(V, c.e);
    const B = lineAcc(V, c.e2);
    const u = sub2(A.b(V.x), A.a(V.x));
    const w = sub2(B.b(V.x), B.a(V.x));
    return (Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]) * 180) / Math.PI;
  }
  return v; // residual with value 0 equals the measured quantity
}

// Drop constraints that mention any of `entityIds`.
export function dropConstraintsFor(constraints = [], entityIds) {
  const ids = new Set(entityIds);
  return constraints.filter((c) => !ids.has(c.e) && !ids.has(c.e2) && !ids.has(c.p?.e) && !ids.has(c.p2?.e));
}

// Keep constraints whose entities all still exist.
export function pruneConstraints(constraints = [], entities) {
  const ids = new Set(entities.map((e) => e.id));
  const ok = (id) => id === undefined || ids.has(id);
  return constraints.filter((c) => ok(c.e) && ok(c.e2) && ok(c.p?.e) && ok(c.p2?.e));
}
