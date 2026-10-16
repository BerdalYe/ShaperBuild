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
