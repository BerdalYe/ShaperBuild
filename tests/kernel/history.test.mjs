// Design history: record steps with stable references, then change an
// earlier step or the sketch and replay.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../src/vendor/manifold/manifold.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { symbolize, runFeature, chainKeys, withParams, editableParams } from '../../src/core/replay.js';

let k;
before(async () => {
  const oc = await OC();
  const mf = await ManifoldModule();
  mf.setup();
  k = new Kernel(oc, mf);
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
const rect = (w, h) => [
  { id: 'l1', type: 'line', a: [0, 0], b: [w, 0] },
  { id: 'l2', type: 'line', a: [w, 0], b: [w, h] },
  { id: 'l3', type: 'line', a: [w, h], b: [0, h] },
  { id: 'l4', type: 'line', a: [0, h], b: [0, 0] },
];
const near = (a, b, tol) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// A tiny stand-in for the app: bodies by id, meshes by shape, sketches.
function makeDesign() {
  const meshes = new Map();
  const design = {
    bodies: new Map(), // bodyId -> shapeId
    sketches: new Map(),
    regions: new Map(), // sketchId -> regions
    features: [],
    seq: 0,
    // Run a kernel op like a tool would, then record it as a step.
    run(label, method, args) {
      const sym = symbolize(method, args, {
        bodyOfShape: (sid) => [...design.bodies].find(([, s]) => s === sid)?.[0],
        mesh: (b) => meshes.get(design.bodies.get(b)),
        sketch: (id) => design.sketches.get(id),
        region: (id, i) => design.regions.get(id)?.[i],
      });
      const res = k[method](args);
      const byShape = new Map([...design.bodies].map(([b, s]) => [s, b]));
      const out = res.bodies.map((rb) => {
        meshes.set(rb.id, rb.mesh);
        const id = (rb.replaces && byShape.get(rb.replaces)) || `b${++design.seq}`;
        design.bodies.set(id, rb.id);
        return id;
      });
      const f = { id: `f${design.features.length + 1}`, label, op: 'op', calls: [{ method, args: sym, out }] };
      design.features.push(f);
      return f;
    },
    async replay() {
      const rc = {
        state: new Map(),
        sketches: design.sketches,
        call: async (m, a) => k[m](a),
        meshOf: (sid) => meshes.get(sid),
        setMesh: (sid, m) => meshes.set(sid, m),
        regions: new Map(),
        temps: [],
      };
      for (const f of design.features) await runFeature(f, rc);
      design.bodies = rc.state;
      return rc.state;
    },
    sketch(id, entities, plane = XY) {
      design.sketches.set(id, { id, plane, entities });
      design.regions.set(id, k.sketchRegions({ id, plane, entities }).regions);
    },
  };
  return design;
}

const volume = (sid) => k.measure({ items: [{ kind: 'body', id: sid }] }).items[0].volume;

test('changing an extrude keeps the fillet that came after it', async () => {
  const d = makeDesign();
  d.sketch('s1', rect(40, 30));
  const ext = d.run('Extrude', 'extrude', { profiles: [{ type: 'region', sketchId: 's1', index: 0, normal: [0, 0, 1] }], distance: 20, symmetric: false, mode: 'new' });
  const body = ext.calls[0].out[0];
  // Round the top front edge (y = 0, z = 20).
  const m = k.tessellate(d.bodies.get(body));
  const top = m.edgeInfo.findIndex((e) => e.type === 'line' && Math.abs(e.a[2] - 20) < 1e-6 && Math.abs(e.b[2] - 20) < 1e-6 && Math.abs(e.a[1]) < 1e-6 && Math.abs(e.b[1]) < 1e-6);
  assert.ok(top >= 0);
  d.run('Fillet', 'fillet', { id: d.bodies.get(body), edges: [top], radius: 4 });
  const cut = (1 - Math.PI / 4) * 16 * 40;
  near(volume(d.bodies.get(body)), 40 * 30 * 20 - cut, 1);

  // Make the extrude 35 mm tall: the fillet must still be on the top edge.
  assert.deepEqual(editableParams(ext).map((p) => p.key), ['distance', 'symmetric']);
  d.features[0] = withParams(ext, { distance: 35 });
  await d.replay();
  near(volume(d.bodies.get(body)), 40 * 30 * 35 - cut, 1);
  const cyl = k.tessellate(d.bodies.get(body)).faceInfo.find((f) => f.type === 'cylinder');
  assert.ok(cyl && Math.abs(cyl.center[2] - (35 - 2)) < 1.5, `fillet sits at the top: ${cyl?.center}`);
});

test('editing the sketch updates the body; deleting it does not', async () => {
  const d = makeDesign();
  d.sketch('s1', rect(40, 30));
  d.run('Extrude', 'extrude', { profiles: [{ type: 'region', sketchId: 's1', index: 0, normal: [0, 0, 1] }], distance: 10, mode: 'new' });
  const keys0 = chainKeys(d.features, d.sketches);
  // Unrelated new curves on the same sketch do not change the step.
  d.sketches.set('s1', { ...d.sketches.get('s1'), entities: [...rect(40, 30), { id: 'c9', type: 'circle', c: [100, 100], r: 3 }] });
  assert.deepEqual(chainKeys(d.features, d.sketches), keys0);
  // Making the rectangle wider does.
  d.sketches.set('s1', { ...d.sketches.get('s1'), entities: rect(60, 30) });
  assert.notDeepEqual(chainKeys(d.features, d.sketches), keys0);
  const state = await d.replay();
  near(volume([...state.values()][0]), 60 * 30 * 10, 0.5);
  // Deleting the sketch keeps the body (the step keeps a copy of its curves).
  d.sketches.delete('s1');
  const after = await d.replay();
  near(volume([...after.values()][0]), 40 * 30 * 10, 0.5);
});

test('a cut on a face follows the face when the body gets taller', async () => {
  const d = makeDesign();
  d.sketch('s1', rect(40, 30));
  const ext = d.run('Extrude', 'extrude', { profiles: [{ type: 'region', sketchId: 's1', index: 0, normal: [0, 0, 1] }], distance: 20, mode: 'new' });
  const body = ext.calls[0].out[0];
  // A hole sketched on the top face, attached to it.
  const m = k.tessellate(d.bodies.get(body));
  const topFace = m.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  const { faceSig } = await import('../../src/core/refs.js');
  const topPlane = { origin: [0, 0, 20], xDir: [1, 0, 0], normal: [0, 0, 1] };
  d.sketch('s2', [{ id: 'c1', type: 'circle', c: [20, 15], r: 5 }], topPlane);
  d.sketches.get('s2').attach = { b: body, s: faceSig(m.faceInfo[topFace], m.bbox) };
  d.run('Extrude', 'extrude', { profiles: [{ type: 'region', sketchId: 's2', index: 0, normal: [0, 0, 1] }], distance: -8, mode: 'subtract', targets: [d.bodies.get(body)] });
  near(volume(d.bodies.get(body)), 40 * 30 * 20 - Math.PI * 25 * 8, 1);
  d.features[0] = withParams(ext, { distance: 30 });
  await d.replay();
  // The hole moved up with the top face: still 8 mm deep.
  near(volume(d.bodies.get(body)), 40 * 30 * 30 - Math.PI * 25 * 8, 1);
});

const bbox = (sid) => k.tessellate(sid).bbox;

test('move, split and mirror steps can be changed later', async () => {
  const { moveMatrix } = await import('../../src/core/replay.js');
  const d = makeDesign();
  const box = d.run('Box', 'primitive', { type: 'box', params: { width: 20, depth: 20, height: 20 } });
  const b = box.calls[0].out[0];
  const move = { t: [10, 0, 0], r: [0, 0, 0], pivot: [0, 0, 10] };
  const mv = d.run('Move', 'transform', { ids: [d.bodies.get(b)], matrix: moveMatrix(move), copy: false, move });
  near(bbox(d.bodies.get(b)).min[0], 0, 1e-6);
  assert.deepEqual(editableParams(mv).map((p) => p.key), ['move.t.0', 'move.t.1', 'move.t.2', 'move.r.0', 'move.r.1', 'move.r.2', 'copy']);
  // Split at z = 5 (a fixed plane with an offset), then mirror the box
  // about its own right-hand face.
  const sp = d.run('Split', 'split', { id: d.bodies.get(b), plane: { origin: [0, 0, 5], normal: [0, 0, 1] }, planeFrom: { kind: 'fixed', plane: { origin: [0, 0, 0], normal: [0, 0, 1] }, offset: 5 } });
  assert.equal(sp.calls[0].out.length, 2);
  const vols = () => [...d.bodies.values()].map(volume).sort((x, y) => x - y);
  near(vols()[0], 20 * 20 * 5, 0.5);
  assert.deepEqual(editableParams(sp).map((p) => [p.key, p.value]), [['planeRef.offset', 5]]);

  // Move further: everything after it follows.
  d.features[1] = withParams(mv, { 'move.t.0': 30, 'move.r.2': 90 });
  await d.replay();
  const xs = [...d.bodies.values()].map((s) => bbox(s).min[0]);
  xs.forEach((x) => near(x, 20, 1e-6));
  // Cut higher up.
  d.features[2] = withParams(d.features[2], { 'planeRef.offset': 12 });
  await d.replay();
  near(vols()[0], 20 * 20 * 8, 0.5);
});

test('a mirror about a face follows the face', async () => {
  const d = makeDesign();
  const box = d.run('Box', 'primitive', { type: 'box', params: { width: 20, depth: 20, height: 20 } });
  const b = box.calls[0].out[0];
  const m = k.tessellate(d.bodies.get(b));
  const right = m.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[0] > 0.99);
  d.run('Mirror', 'mirror', { ids: [d.bodies.get(b)], plane: { origin: m.faceInfo[right].center, normal: [1, 0, 0] }, planeFrom: { kind: 'face', id: d.bodies.get(b), index: right }, copy: true });
  assert.equal(d.bodies.size, 2);
  d.features[0] = withParams(box, { 'params.width': 40 });
  await d.replay();
  const xs = [...d.bodies.values()].map((s) => bbox(s).max[0]).sort((x, y) => x - y);
  near(xs[0], 20, 1e-6);
  near(xs[1], 60, 1e-6);
});

test('regions are found again after Trim and after redrawing a curve', async () => {
  const { trimEntity } = await import('../../src/core/geom2d.js');
  const d = makeDesign();
  const ents = [...rect(40, 30), { id: 'l5', type: 'line', a: [20, -10], b: [20, 40] }];
  d.sketch('s1', ents);
  const regions = d.regions.get('s1');
  const left = regions.findIndex((r) => r.centroid[0] < 20);
  d.run('Extrude', 'extrude', { profiles: [{ type: 'region', sketchId: 's1', index: left, normal: [0, 0, 1] }], distance: 10, mode: 'new' });
  const vol = () => volume([...d.bodies.values()][0]);
  near(vol(), 20 * 30 * 10, 0.5);
  // Trim the bit of the middle line that sticks out at the bottom: the
  // line is replaced by a new piece.
  const sk = d.sketches.get('s1');
  const l5 = sk.entities.find((e) => e.id === 'l5');
  const { keep } = trimEntity(l5, [20, -5], sk.entities);
  assert.equal(keep.length, 1);
  assert.equal(keep[0].src, 'l5');
  d.sketch('s1', [...sk.entities.filter((e) => e.id !== 'l5'), { ...keep[0], id: 'p1' }]);
  await d.replay();
  near(vol(), 20 * 30 * 10, 0.5);
  // Delete the left side and draw it again further out: the body follows.
  const now = d.sketches.get('s1').entities.filter((e) => e.id !== 'l4');
  d.sketch('s1', [...now.map((e) => (e.id === 'l1' ? { ...e, a: [-10, 0] } : e.id === 'l3' ? { ...e, b: [-10, 30] } : e)), { id: 'n1', type: 'line', a: [-10, 30], b: [-10, 0] }]);
  await d.replay();
  near(vol(), 30 * 30 * 10, 0.5);
});
