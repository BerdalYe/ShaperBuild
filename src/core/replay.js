// Design history: turning operations into replayable steps and replaying
// them. Kernel arguments are stored with references instead of kernel ids:
//   { $b: bodyId }                      a body
//   { $f: { b, s } } / { $e: { b, s } } a face / edge of a body (signature)
//   { $r: { sk, ents, c, a, plane, attach, snap } }  a sketch region
//   { $c: { sk, ent, plane, attach, snap } }         a sketch curve
// so the step can run again after earlier steps or sketches change.
import { faceSig, edgeSig, matchFace, matchEdge, pickRegion, hashString } from './refs.js';
import { planeFrame, to2D } from './plane.js';

// Kernel operations recorded as replayable steps. Everything else that
// makes bodies (imports) becomes a fixed "base" step.
export const RECORDED = new Set(['extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'shell', 'draft', 'boolean', 'split', 'transform', 'mirror', 'pattern', 'primitive', 'meshToSolid', 'emboss']);

const clone = (v) => JSON.parse(JSON.stringify(v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---- recording ---------------------------------------------------------------

// ctx: { bodyOfShape(shapeId), mesh(bodyId), sketch(id), region(sketchId, index) }
export function symbolize(method, args, ctx) {
  const a = clone(args);
  const body = (sid) => {
    const b = ctx.bodyOfShape(sid);
    if (!b) throw new Error('unknown body');
    return b;
  };
  const fRef = (b, i) => {
    const m = ctx.mesh(b);
    const s = faceSig(m?.faceInfo?.[i], m?.bbox);
    if (!s) throw new Error('unknown face');
    return { b, s };
  };
  const eRef = (b, i) => {
    const m = ctx.mesh(b);
    const s = edgeSig(m?.edgeInfo?.[i], m?.bbox);
    if (!s) throw new Error('unknown edge');
    return { b, s };
  };
  if (typeof a.id === 'string') {
    const b = body(a.id);
    a.id = { $b: b };
    if (Array.isArray(a.edges)) a.edges = a.edges.map((i) => ({ $e: eRef(b, i) }));
    if (Array.isArray(a.faces)) a.faces = a.faces.map((i) => ({ $f: fRef(b, i) }));
  }
  for (const k of ['ids', 'targets', 'tools']) if (Array.isArray(a[k])) a[k] = a[k].map((s) => ({ $b: body(s) }));
  if (Array.isArray(a.profiles)) {
    a.profiles = a.profiles.map((p) => {
      if (p.type === 'face') return { type: 'face', $f: fRef(body(p.id), p.face) };
      const sk = ctx.sketch(p.sketchId);
      const r = ctx.region(p.sketchId, p.index);
      if (!sk || !r) throw new Error('unknown region');
      const ents = r.entities || [];
      const c2 = to2D(planeFrame(sk.plane), r.centroid);
      return { type: 'region', $r: { sk: sk.id, ents, c: r.centroid, c2, a: r.area, plane: sk.plane, attach: sk.attach || null, snap: sk.entities.filter((e) => ents.includes(e.id)) } };
    });
  }
  // Where a plane came from: a body face (follows the face), or a fixed
  // plane. Either way it can be moved along its normal later.
  if (a.planeFrom) {
    const pf = a.planeFrom;
    delete a.planeFrom;
    if (pf.kind === 'face') a.planeRef = { $f: fRef(body(pf.id), pf.index), offset: 0 };
    else a.planeRef = { base: pf.plane || a.plane, offset: pf.offset || 0 };
  }
  if (a.target && typeof a.target.id === 'string') a.target = { $f: fRef(body(a.target.id), a.target.face) };
  if (Array.isArray(a.path)) {
    a.path = a.path.map((p) => {
      if (p.type === 'edge') return { type: 'edge', $e: eRef(body(p.id), p.edge) };
      const sk = p.sketchId ? ctx.sketch(p.sketchId) : null;
      return { type: 'curve', $c: { sk: p.sketchId || null, ent: p.entity.id, plane: sk?.plane || p.plane, attach: sk?.attach || null, snap: p.entity } };
    });
  }
  return a;
}

// ---- keys ----------------------------------------------------------------------

// Every $r / $c reference inside a step.
function sketchRefs(f) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v.$r) out.push({ r: v.$r });
    if (v.$c) out.push({ c: v.$c });
    for (const [k, x] of Object.entries(v)) if (k !== '$r' && k !== '$c') walk(x);
  };
  walk(f.calls || []);
  return out;
}

// A copy of the step with every sketch reference passed through fn.
export function mapSketchRefs(f, fn) {
  if (!f.calls) return f;
  let changed = false;
  const walk = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '$r' || k === '$c') {
        out[k] = fn(x);
        if (out[k] !== x) changed = true;
      } else out[k] = walk(x);
    }
    return out;
  };
  const calls = walk(f.calls);
  return changed ? { ...f, calls } : f;
}

// Bodies whose faces or edges a call refers to (they need a mesh).
function meshBodies(args) {
  const out = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (v.$f) out.add(v.$f.b);
    if (v.$e) out.add(v.$e.b);
    if ((v.$r || v.$c)?.attach) out.add((v.$r || v.$c).attach.b);
    Object.values(v).forEach(walk);
  };
  walk(args);
  return out;
}

// Ids of a sketch's curves, and of the curves Trim cut them from.
function presentIds(sk) {
  const ids = new Set();
  for (const e of sk.entities) {
    ids.add(e.id);
    if (e.src) ids.add(e.src);
  }
  return ids;
}

// Curves of the sketch that outline a region reference: the curves it was
// made with, and the pieces Trim cut from them.
function lineageEntities(ref, sk) {
  const want = new Set(ref.ents);
  // Pieces keep the id of the first curve they were cut from.
  for (const e of ref.snap || []) if (e.src && want.has(e.id)) want.add(e.src);
  return sk.entities.filter((e) => !e.construction && (want.has(e.id) || (e.src && want.has(e.src))));
}

const allPresent = (ref, sk) => {
  const ids = presentIds(sk);
  return ref.ents.every((id) => ids.has(id));
};

// Curves a reference uses now: the sketch's current version, or the copy
// kept with the step if the sketch (or curve) was deleted.
export function effectiveEntities(ref, sketches) {
  const sk = ref.sk ? sketches.get(ref.sk) : null;
  if (ref.ents) {
    if (!sk) return ref.snap || [];
    const ids = presentIds(sk);
    return [...lineageEntities(ref, sk), ...(ref.snap || []).filter((e) => !ids.has(e.id) && !(e.src && ids.has(e.src)))];
  }
  const en = sk?.entities.find((e) => e.id === ref.ent);
  return [en || ref.snap].filter(Boolean);
}

// What a reference's result depends on (for the step keys). When some of
// its curves were replaced, the region is looked for in the whole sketch.
function refDeps(ref, sketches) {
  if (!ref.ents) return effectiveEntities(ref, sketches);
  const sk = ref.sk ? sketches.get(ref.sk) : null;
  if (!sk) return ref.snap || [];
  if (allPresent(ref, sk)) return lineageEntities(ref, sk);
  return [sk.entities.filter((e) => !e.construction), ref.snap || []];
}

const STRIP = new Set(['error', 'snap', 'label']);

// Key of a step: everything that decides its result, chained to the key
// before it. Sketch edits change the key of steps that use the sketch.
export function featureKey(prev, f, sketches) {
  const own = JSON.stringify(f, (k, v) => (STRIP.has(k) ? undefined : v));
  const deps = sketchRefs(f).map(({ r, c }) => refDeps(r || c, sketches));
  return hashString(`${prev}|${own}|${JSON.stringify(deps)}`);
}

export function chainKeys(features, sketches) {
  const keys = [];
  let prev = 'root';
  for (const f of features) {
    prev = featureKey(prev, f, sketches);
    keys.push(prev);
  }
  return keys;
}

// ---- replay --------------------------------------------------------------------

// rc (replay context): {
//   state: Map(bodyId -> shapeId), sketches: Map(id -> sketch),
//   call(method, args) -> Promise, meshOf(shapeId), setMesh(shapeId, mesh),
//   regions: Map(tempId -> regions), temps: [ids] }

function meshFor(rc, b) {
  const sid = rc.state.get(b);
  if (!sid) throw new Error('a body it uses no longer exists');
  return rc.meshOf(sid);
}

// A sketch plane that moves with the face it was drawn on.
export function placedPlane(ref, rc) {
  const plane = ref.plane;
  const at = ref.attach;
  if (!at || !rc.state.has(at.b)) return plane;
  const m = meshFor(rc, at.b);
  const i = matchFace(at.s, m?.faceInfo, m?.bbox);
  const info = i >= 0 ? m.faceInfo[i] : null;
  if (!info || info.type !== 'plane') return plane;
  const n = planeFrame(plane).n;
  if (Math.abs(dot(n, info.normal)) < 0.999) return plane;
  const off = dot([info.center[0] - plane.origin[0], info.center[1] - plane.origin[1], info.center[2] - plane.origin[2]], n);
  if (Math.abs(off) < 1e-9) return plane;
  return { ...plane, origin: [plane.origin[0] + n[0] * off, plane.origin[1] + n[1] * off, plane.origin[2] + n[2] * off] };
}

async function regionsOf(rc, plane, entities) {
  const id = `h_${hashString(JSON.stringify([plane, entities]))}`;
  if (!rc.regions.has(id)) {
    const res = await rc.call('sketchRegions', { id, plane, entities });
    rc.regions.set(id, res.regions);
    rc.temps.push(id);
  }
  return { id, regions: rc.regions.get(id) };
}

async function resolveRegion(ref, rc) {
  const plane = placedPlane(ref, rc);
  const frame = planeFrame(plane);
  const sk = ref.sk ? rc.sketches.get(ref.sk) : null;
  // Pieces cut by Trim count as the curve they came from.
  const srcOf = new Map();
  for (const e of [...(sk?.entities || []), ...(ref.snap || [])]) if (e.src) srcOf.set(e.id, e.src);
  const root = (id) => srcOf.get(id) || id;
  const want = { ...ref, ents: [...new Set((ref.ents || []).map(root))] };
  const opts = { origin: root, at: (r) => (r.centroid ? to2D(frame, r.centroid) : null) };
  const attempt = async (entities, geometric) => {
    if (!entities.length) return null;
    const { id, regions } = await regionsOf(rc, plane, entities);
    const i = pickRegion(want, regions, { ...opts, geometric });
    return i >= 0 ? { type: 'region', sketchId: id, index: regions[i].index, normal: frame.n } : null;
  };
  let out = null;
  if (sk) {
    // The region made by the curves it was outlined with (unrelated new
    // curves in the sketch do not change it)...
    if (allPresent(ref, sk)) out = await attempt(lineageEntities(ref, sk), false);
    // ...or, if curves were replaced or cut, the best match in the whole sketch.
    if (!out) out = await attempt(sk.entities.filter((e) => !e.construction), true);
  }
  // The copy of its curves kept with the step.
  if (!out) out = await attempt(effectiveEntities(ref, rc.sketches), true);
  if (!out) throw new Error(sk || ref.snap?.length ? 'the sketch shape it uses is no longer closed' : 'the sketch shape it uses is gone');
  return out;
}

export async function resolveArgs(sym, rc) {
  const a = clone(sym);
  const shape = (b) => {
    const s = rc.state.get(b);
    if (!s) throw new Error('a body it uses no longer exists');
    return s;
  };
  const face = (ref) => {
    const m = meshFor(rc, ref.b);
    const i = matchFace(ref.s, m?.faceInfo, m?.bbox);
    if (i < 0) throw new Error('the face it was applied to could not be found');
    return i;
  };
  const edge = (ref) => {
    const m = meshFor(rc, ref.b);
    const i = matchEdge(ref.s, m?.edgeInfo, m?.bbox);
    if (i < 0) throw new Error('an edge it was applied to could not be found');
    return i;
  };
  if (a.id?.$b) a.id = shape(a.id.$b);
  if (Array.isArray(a.edges)) a.edges = a.edges.map((x) => edge(x.$e));
  if (Array.isArray(a.faces)) a.faces = a.faces.map((x) => face(x.$f));
  for (const k of ['ids', 'targets', 'tools']) if (Array.isArray(a[k])) a[k] = a[k].map((x) => shape(x.$b));
  if (Array.isArray(a.profiles)) {
    const out = [];
    for (const p of a.profiles) out.push(p.$r ? await resolveRegion(p.$r, rc) : { type: 'face', id: shape(p.$f.b), face: face(p.$f) });
    a.profiles = out;
  }
  if (a.planeRef) {
    const pr = a.planeRef;
    let base = pr.base;
    if (pr.$f) {
      const m = meshFor(rc, pr.$f.b);
      const info = m.faceInfo[face(pr.$f)];
      if (info.type !== 'plane') throw new Error('the face it used is no longer flat');
      base = { origin: info.center, normal: info.normal };
    }
    const n = planeFrame(base).n;
    const o = pr.offset || 0;
    a.plane = { ...base, origin: base.origin.map((v, i) => v + n[i] * o) };
    delete a.planeRef;
  }
  if (a.target?.$f) a.target = { id: shape(a.target.$f.b), face: face(a.target.$f) };
  if (Array.isArray(a.path)) {
    a.path = a.path.map((p) => {
      if (p.$e) return { type: 'edge', id: shape(p.$e.b), edge: edge(p.$e) };
      const [entity] = effectiveEntities(p.$c, rc.sketches);
      if (!entity) throw new Error('the path it follows is gone');
      return { type: 'curve', plane: placedPlane(p.$c, rc), entity };
    });
  }
  return a;
}

// Apply a kernel result to the replay state, keeping body ids stable.
export function applyCallResult(rc, f, call, res) {
  const byShape = new Map([...rc.state].map(([b, s]) => [s, b]));
  res.bodies.forEach((rb, i) => {
    if (rb.mesh) rc.setMesh(rb.id, rb.mesh);
    let id = rb.replaces ? byShape.get(rb.replaces) : null;
    if (!id) {
      id = call.out?.[i];
      if (!id || rc.state.has(id)) id = `${f.id}.${i}`;
    }
    rc.state.set(id, rb.id);
  });
  for (const sid of res.removed || []) {
    const b = byShape.get(sid);
    if (b && !res.bodies.some((r) => r.replaces === sid)) rc.state.delete(b);
  }
}

// Run one step against the replay state.
export async function runFeature(f, rc) {
  if (f.op === 'base') {
    for (const x of f.bodies) rc.state.set(x.b, x.s);
    for (const b of f.removed || []) rc.state.delete(b);
    return;
  }
  if (f.op === 'delete') {
    for (const b of f.bodies) rc.state.delete(b);
    return;
  }
  for (const call of f.calls) {
    if (rc.ensureMesh) {
      for (const b of meshBodies(call.args)) if (rc.state.has(b)) await rc.ensureMesh(rc.state.get(b));
    }
    const args = await resolveArgs(call.args, rc);
    const res = await rc.call(call.method, args);
    applyCallResult(rc, f, call, res);
  }
}

// ---- editing ---------------------------------------------------------------

// Matrix (column-major, like three.js) of a move: rotate around `pivot`
// (degrees, X then Y then Z like three.js 'XYZ'), then move by `t`.
export function moveMatrix({ t = [0, 0, 0], r = [0, 0, 0], pivot = [0, 0, 0] }) {
  const [x, y, z] = r.map((v) => (v * Math.PI) / 180);
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const R = [
    [c * e, -c * f, d],
    [a * f + b * e * d, a * e - b * f * d, -b * c],
    [b * f - a * e * d, b * e + a * f * d, a * c],
  ];
  const tr = [0, 1, 2].map((i) => pivot[i] + t[i] - (R[i][0] * pivot[0] + R[i][1] * pivot[1] + R[i][2] * pivot[2]));
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, tr[0], tr[1], tr[2], 1];
}

// Matrix of a turn by `angle` degrees about the axis through `origin` along
// `dir` (Rotate around axis).
export function turnMatrix({ origin, dir, angle }) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const [x, y, z] = dir.map((v) => v / l);
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 - c;
  const R = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
  const t = [0, 1, 2].map((i) => origin[i] - (R[i][0] * origin[0] + R[i][1] * origin[1] + R[i][2] * origin[2]));
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
}

// Matrix of a uniform scale around `center`.
// `factors` ([x, y, z]) stretches each direction on its own (meshes only).
export function scaleMatrix({ factor, factors, center = [0, 0, 0] }) {
  const [x, y, z] = factors || [factor, factor, factor];
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, center[0] * (1 - x), center[1] * (1 - y), center[2] * (1 - z), 1];
}

// Numbers a step lets you change: [argument path, kind, label, check].
// check: 'positive' (> 0), 'nonzero', 'any'; counts are whole numbers ≥ 2.
const PARAMS = {
  extrude: [
    ['distance', 'length', 'Distance', 'nonzero'],
    ['symmetric', 'toggle', 'Both directions'],
  ],
  revolve: [['angle', 'angle', 'Angle', 'nonzero']],
  sweep: [
    ['twist', 'angle', 'Twist', 'any'],
    ['endScale', 'number', 'Size at the end', 'positive'],
  ],
  fillet: [['radius', 'length', 'Radius', 'positive']],
  chamfer: [['distance', 'length', 'Distance', 'positive']],
  shell: [['thickness', 'length', 'Wall thickness', 'positive']],
  draft: [
    ['angle', 'angle', 'Angle', 'nonzero'],
    ['planeRef.offset', 'length', 'Fixed plane offset', 'any'],
  ],
  split: [['planeRef.offset', 'length', 'Cut plane offset', 'any']],
  mirror: [
    ['planeRef.offset', 'length', 'Mirror plane offset', 'any'],
    ['copy', 'toggle', 'Keep the original'],
    ['union', 'toggle', 'Join copy and original'],
  ],
  emboss: [['height', 'length', 'Height (minus engraves)', 'nonzero']],
  pattern: [
    ['count', 'count', 'Copies'],
    ['spacing', 'length', 'Spacing', 'nonzero'],
    ['angle', 'angle', 'Total angle', 'nonzero'],
    ['more.0.count', 'count', 'Copies (second direction)'],
    ['more.0.spacing', 'length', 'Spacing (second direction)', 'nonzero'],
    ['more.1.count', 'count', 'Copies (third direction)'],
    ['more.1.spacing', 'length', 'Spacing (third direction)', 'nonzero'],
    ['keepTurn', 'toggle', 'Keep the direction'],
    ['union', 'toggle', 'Join copies'],
  ],
  transform: [
    ['move.t.0', 'length', 'Move X', 'any'],
    ['move.t.1', 'length', 'Move Y', 'any'],
    ['move.t.2', 'length', 'Move Z', 'any'],
    ['move.r.0', 'angle', 'Rotate X', 'any'],
    ['move.r.1', 'angle', 'Rotate Y', 'any'],
    ['move.r.2', 'angle', 'Rotate Z', 'any'],
    ['scale.factor', 'number', 'Scale factor', 'positive'],
    ['scale.factors.0', 'number', 'Scale X', 'positive'],
    ['scale.factors.1', 'number', 'Scale Y', 'positive'],
    ['scale.factors.2', 'number', 'Scale Z', 'positive'],
    ['turn.angle', 'angle', 'Angle', 'nonzero'],
    ['copy', 'toggle', 'Make a copy'],
  ],
};
const PRIMITIVE_LABELS = { width: 'Width', depth: 'Depth', height: 'Height', radius: 'Radius', topRadius: 'Top radius', major: 'Ring radius', minor: 'Tube radius' };

function getPath(obj, path) {
  let v = obj;
  for (const k of path.split('.')) {
    if (v == null || typeof v !== 'object' || !(k in v)) return undefined;
    v = v[k];
  }
  return v;
}

function setPath(obj, path, value) {
  const ks = path.split('.');
  let v = obj;
  for (const k of ks.slice(0, -1)) {
    if (v == null || typeof v !== 'object' || !(k in v)) return false;
    v = v[k];
  }
  if (v == null || typeof v !== 'object' || !(ks.at(-1) in v)) return false;
  v[ks.at(-1)] = value;
  return true;
}

// Editable values of a step: [{ key, type, label, value, check }]. Keys are
// argument paths, e.g. "distance", "params.width" or "move.t.0".
export function editableParams(f) {
  const call = f.calls?.[0];
  if (!call) return [];
  const a = call.args;
  if (call.method === 'primitive') {
    return Object.entries(a.params || {})
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({ key: `params.${k}`, type: 'length', label: PRIMITIVE_LABELS[k] || k, value: v, check: 'positive' }));
  }
  // A plain copy (Duplicate) has nothing to change.
  if (call.method === 'transform' && !a.move && !a.scale && !a.turn) return [];
  return (PARAMS[call.method] || [])
    .filter(([key]) => getPath(a, key) !== undefined)
    .filter(([key]) => !(call.method === 'pattern' && key === (a.kind === 'circular' ? 'spacing' : 'angle')))
    .map(([key, type, label, check]) => ({ key, type, label, value: getPath(a, key), check: check || (type === 'count' ? 'count' : 'any') }));
}

// A copy of the step with new values (applied to every call of the step).
export function withParams(f, values) {
  return {
    ...f,
    calls: f.calls.map((c) => {
      const args = clone(c.args);
      for (const [k, v] of Object.entries(values)) setPath(args, k, v);
      // Values that a matrix is made from.
      if (args.move) args.matrix = moveMatrix(args.move);
      if (args.scale) args.matrix = scaleMatrix(args.scale);
      if (args.turn) args.matrix = turnMatrix(args.turn);
      return { ...c, args };
    }),
  };
}

// Short description of a step's main value, e.g. "20 mm".
export function stepSummary(f, fmtLength) {
  const call = f.calls?.[0];
  const a = call?.args;
  if (call?.method === 'transform' && a.move) {
    const d = Math.hypot(...a.move.t);
    const rot = Math.max(...a.move.r.map(Math.abs));
    if (d > 1e-9) return fmtLength(d);
    if (rot > 1e-9) return `${+rot.toFixed(2)}°`;
    return '';
  }
  if (call?.method === 'transform' && a.scale) return `× ${+(+a.scale.factor).toFixed(4)}`;
  const p = editableParams(f).filter((x) => x.type !== 'toggle');
  if (!p.length) return '';
  const v = p[0];
  if (v.type === 'length') return fmtLength(v.value);
  if (v.type === 'angle') return `${+(+v.value).toFixed(2)}°`;
  if (v.type === 'count') return `× ${v.value}`;
  if (v.type === 'number') return `${+(+v.value).toFixed(4)}`;
  return '';
}
