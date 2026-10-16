// Design history: turning operations into replayable steps and replaying
// them. Kernel arguments are stored with references instead of kernel ids:
//   { $b: bodyId }                      a body
//   { $f: { b, s } } / { $e: { b, s } } a face / edge of a body (signature)
//   { $r: { sk, ents, c, a, plane, attach, snap } }  a sketch region
//   { $c: { sk, ent, plane, attach, snap } }         a sketch curve
// so the step can run again after earlier steps or sketches change.
import { faceSig, edgeSig, matchFace, matchEdge, pickRegion, hashString } from './refs.js';
import { planeFrame } from './plane.js';

// Kernel operations recorded as replayable steps. Everything else that
// makes bodies (imports) becomes a fixed "base" step.
export const RECORDED = new Set(['extrude', 'revolve', 'sweep', 'loft', 'fillet', 'chamfer', 'shell', 'draft', 'boolean', 'split', 'transform', 'mirror', 'pattern', 'primitive', 'meshToSolid']);

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
      return { type: 'region', $r: { sk: sk.id, ents, c: r.centroid, a: r.area, plane: sk.plane, attach: sk.attach || null, snap: sk.entities.filter((e) => ents.includes(e.id)) } };
    });
  }
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

// Curves a reference uses now: the sketch's current version, or the copy
// kept with the step if the sketch (or curve) was deleted.
export function effectiveEntities(ref, sketches) {
  const sk = ref.sk ? sketches.get(ref.sk) : null;
  if (ref.ents) return ref.ents.map((id) => sk?.entities.find((e) => e.id === id) || ref.snap?.find((e) => e.id === id)).filter(Boolean);
  const en = sk?.entities.find((e) => e.id === ref.ent);
  return [en || ref.snap].filter(Boolean);
}

const STRIP = new Set(['error', 'snap', 'label']);

// Key of a step: everything that decides its result, chained to the key
// before it. Sketch edits change the key of steps that use the sketch.
export function featureKey(prev, f, sketches) {
  const own = JSON.stringify(f, (k, v) => (STRIP.has(k) ? undefined : v));
  const deps = sketchRefs(f).map(({ r, c }) => effectiveEntities(r || c, sketches));
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
  const entities = effectiveEntities(ref, rc.sketches);
  if (!entities.length) throw new Error('the sketch shape it uses is gone');
  const plane = placedPlane(ref, rc);
  const normal = planeFrame(plane).n;
  // The region made by the curves it was outlined with...
  let { id, regions } = await regionsOf(rc, plane, entities);
  let i = pickRegion(ref, regions);
  // ...or, if curves were split or replaced, the best match in the whole sketch.
  const sk = ref.sk ? rc.sketches.get(ref.sk) : null;
  if (i < 0 && sk) {
    ({ id, regions } = await regionsOf(rc, plane, sk.entities.filter((e) => !e.construction)));
    i = pickRegion(ref, regions);
  }
  if (i < 0) throw new Error('the sketch shape it uses is no longer closed');
  return { type: 'region', sketchId: id, index: regions[i].index, normal };
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

// Numbers a step lets you change: [argument, kind, label].
const PARAMS = {
  extrude: [
    ['distance', 'length', 'Distance'],
    ['symmetric', 'toggle', 'Both directions'],
  ],
  revolve: [['angle', 'angle', 'Angle']],
  fillet: [['radius', 'length', 'Radius']],
  chamfer: [['distance', 'length', 'Distance']],
  shell: [['thickness', 'length', 'Wall thickness']],
  draft: [['angle', 'angle', 'Angle']],
};
const PRIMITIVE_LABELS = { width: 'Width', depth: 'Depth', height: 'Height', radius: 'Radius', topRadius: 'Top radius', major: 'Ring radius', minor: 'Tube radius' };

// Editable values of a step: [{ key, type, label, value }]. Keys of
// primitive sizes are "params.<name>".
export function editableParams(f) {
  const call = f.calls?.[0];
  if (!call) return [];
  const a = call.args;
  if (call.method === 'pattern') {
    const out = [{ key: 'count', type: 'count', label: 'Copies', value: a.count }];
    if (a.kind === 'circular') out.push({ key: 'angle', type: 'angle', label: 'Total angle', value: a.angle });
    else out.push({ key: 'spacing', type: 'length', label: 'Spacing', value: a.spacing });
    return out;
  }
  if (call.method === 'primitive') {
    return Object.entries(a.params || {})
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({ key: `params.${k}`, type: 'length', label: PRIMITIVE_LABELS[k] || k, value: v }));
  }
  return (PARAMS[call.method] || []).filter(([k]) => k in a).map(([key, type, label]) => ({ key, type, label, value: a[key] }));
}

// A copy of the step with new values (applied to every call of the step).
export function withParams(f, values) {
  return {
    ...f,
    calls: f.calls.map((c) => {
      const args = clone(c.args);
      for (const [k, v] of Object.entries(values)) {
        if (k.startsWith('params.')) {
          if (args.params) args.params[k.slice(7)] = v;
        } else if (k in args) args[k] = v;
      }
      return { ...c, args };
    }),
  };
}

// Short description of a step's main value, e.g. "20 mm".
export function stepSummary(f, fmtLength) {
  const p = editableParams(f);
  if (!p.length) return '';
  const v = p[0];
  if (v.type === 'length') return fmtLength(v.value);
  if (v.type === 'angle') return `${+(+v.value).toFixed(2)}°`;
  if (v.type === 'count') return `× ${v.value}`;
  return '';
}
