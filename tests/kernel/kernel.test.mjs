// Runs the real geometry kernel (OpenCascade + Manifold WASM) in Node.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../node_modules/manifold-3d/manifold.js';
import { Kernel, rotationMatrix, translationMatrix } from '../../src/kernel/kernel.js';
import { parseSTL, writeSTL } from '../../src/core/formats.js';

let k;
before(async () => {
  const oc = await OC();
  const mf = await ManifoldModule();
  mf.setup();
  k = new Kernel(oc, mf);
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

function rectSketch(id, x0, y0, x1, y1, extra = []) {
  return {
    id,
    plane: XY,
    entities: [
      { id: 'l1', type: 'line', a: [x0, y0], b: [x1, y0] },
      { id: 'l2', type: 'line', a: [x1, y0], b: [x1, y1] },
      { id: 'l3', type: 'line', a: [x1, y1], b: [x0, y1] },
      { id: 'l4', type: 'line', a: [x0, y1], b: [x0, y0] },
      ...extra,
    ],
  };
}

function volume(id) {
  return k.measure({ items: [{ kind: 'body', id }] }).items[0].volume;
}

function makeBox(w = 10, d = 20, h = 30) {
  const res = k.primitive({ type: 'box', params: { width: w, depth: d, height: h } });
  return res.bodies[0].id;
}

test('sketch regions: rectangle with a circle inside and a crossing line', () => {
  const sk = rectSketch('s1', 0, 0, 40, 20, [
    { id: 'c1', type: 'circle', c: [10, 10], r: 5 },
    { id: 'l5', type: 'line', a: [20, -5], b: [20, 25] },
  ]);
  const { regions } = k.sketchRegions(sk);
  const areas = regions.map((r) => r.area).sort((a, b) => a - b);
  assert.equal(regions.length, 3);
  near(areas[0], Math.PI * 25);
  near(areas[1], 400 - Math.PI * 25);
  near(areas[2], 400);
  assert.ok(regions.every((r) => r.positions.length > 0 && r.indices.length > 0));
});

test('sketch regions: open curves make no region, arcs and splines close shapes', () => {
  assert.equal(k.sketchRegions({ id: 's2', plane: XY, entities: [{ id: 'a', type: 'line', a: [0, 0], b: [5, 5] }] }).regions.length, 0);
  const arcShape = {
    id: 's3',
    plane: XY,
    entities: [
      { id: 'l', type: 'line', a: [-5, 0], b: [5, 0] },
      { id: 'a', type: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI },
    ],
  };
  const r = k.sketchRegions(arcShape).regions;
  assert.equal(r.length, 1);
  near(r[0].area, (Math.PI * 25) / 2, 1e-2);
  const sp = { id: 's4', plane: XY, entities: [{ id: 'sp', type: 'spline', pts: [[0, 0], [10, 5], [20, 0], [10, -5], [0, 0]], closed: true }] };
  assert.equal(k.sketchRegions(sp).regions.length, 1);
});

test('extrude a region into a new body, then push/pull a face', () => {
  const sk = rectSketch('s5', 0, 0, 10, 20);
  const { regions } = k.sketchRegions(sk);
  const res = k.extrude({ profiles: [{ type: 'region', sketchId: 's5', index: 0, normal: [0, 0, 1] }], distance: 5, mode: 'new' });
  assert.equal(res.bodies.length, 1);
  const id = res.bodies[0].id;
  near(volume(id), 1000);
  const mesh = res.bodies[0].mesh;
  assert.equal(mesh.faceInfo.length, 6);
  assert.equal(mesh.edgeInfo.length, 12);
  // Find the top face (+Z) and pull it up by 3.
  const top = mesh.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  assert.ok(top >= 0);
  const pulled = k.extrude({ profiles: [{ type: 'face', id, face: top }], distance: 3, mode: 'union', targets: [id] });
  assert.equal(pulled.bodies[0].replaces, id);
  near(volume(pulled.bodies[0].id), 1600);
  // Coplanar faces are merged after the union, so it is still a box.
  assert.equal(pulled.bodies[0].mesh.faceInfo.length, 6);
  // Push it down (cut) by 2.
  const id2 = pulled.bodies[0].id;
  const top2 = pulled.bodies[0].mesh.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  const pushed = k.extrude({ profiles: [{ type: 'face', id: id2, face: top2 }], distance: -2, mode: 'subtract', targets: [id2] });
  near(volume(pushed.bodies[0].id), 1200);
  assert.ok(regions.length === 1);
});

test('symmetric extrude and subtracting a hole', () => {
  const box = makeBox(20, 20, 10);
  const sk = { id: 's6', plane: { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] }, entities: [{ id: 'c', type: 'circle', c: [0, 0], r: 3 }] };
  k.sketchRegions(sk);
  const res = k.extrude({ profiles: [{ type: 'region', sketchId: 's6', index: 0, normal: [0, 0, 1] }], distance: -10, mode: 'subtract', targets: [box] });
  near(volume(res.bodies[0].id), 4000 - Math.PI * 9 * 10, 0.05);
  const sym = k.extrude({ profiles: [{ type: 'region', sketchId: 's6', index: 0, normal: [0, 0, 1] }], distance: 4, symmetric: true, mode: 'new' });
  near(volume(sym.bodies[0].id), Math.PI * 9 * 8, 0.05);
});

test('revolve a profile around an axis', () => {
  const sk = rectSketch('s7', 5, 0, 10, 10);
  k.sketchRegions(sk);
  const res = k.revolve({ profiles: [{ type: 'region', sketchId: 's7', index: 0, normal: [0, 0, 1] }], axis: { origin: [0, 0, 0], dir: [0, 1, 0] }, angle: 360 });
  // Tube: pi*(10^2-5^2)*10
  near(volume(res.bodies[0].id), Math.PI * 75 * 10, 0.05);
  const half = k.revolve({ profiles: [{ type: 'region', sketchId: 's7', index: 0, normal: [0, 0, 1] }], axis: { origin: [0, 0, 0], dir: [0, 1, 0] }, angle: 180 });
  near(volume(half.bodies[0].id), (Math.PI * 75 * 10) / 2, 0.05);
});

test('fillet and chamfer edges, with a readable error when too large', () => {
  const box = makeBox(10, 10, 10);
  const mesh = k.tessellate(box);
  const line = mesh.edgeInfo.findIndex((e) => e.type === 'line');
  const f = k.fillet({ id: box, edges: [line], radius: 2 });
  near(volume(f.bodies[0].id), 1000 - (4 - Math.PI) * 10, 1e-2);
  assert.ok(f.bodies[0].mesh.faceInfo.some((fi) => fi.type === 'cylinder'));
  const c = k.chamfer({ id: box, edges: [line], distance: 2 });
  near(volume(c.bodies[0].id), 1000 - 2 * 10, 1e-2);
  assert.throws(() => k.fillet({ id: box, edges: [line], radius: 20 }), /Fillet failed/);
  // The kernel keeps working after an OpenCascade exception.
  near(volume(box), 1000);
});

test('shell removes a face and leaves walls', () => {
  const box = makeBox(10, 10, 10);
  const mesh = k.tessellate(box);
  const top = mesh.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  const s = k.shell({ id: box, faces: [top], thickness: 1 });
  near(volume(s.bodies[0].id), 1000 - 8 * 8 * 9, 1e-2);
});

test('booleans: union, subtract, intersect between solids', () => {
  const a = makeBox(10, 10, 10);
  const b = k.transform({ ids: [makeBox(10, 10, 10)], matrix: translationMatrix([5, 0, 0]) }).bodies[0].id;
  const u = k.boolean({ op: 'union', targets: [a], tools: [b] });
  near(volume(u.bodies[0].id), 1500);
  assert.deepEqual(u.removed, [b]);
  const s = k.boolean({ op: 'subtract', targets: [a], tools: [b] });
  near(volume(s.bodies[0].id), 500);
  const i = k.boolean({ op: 'intersect', targets: [a], tools: [b], keepTools: true });
  near(volume(i.bodies[0].id), 500);
  assert.deepEqual(i.removed, []);
});

test('subtract that cuts a body in two gives two bodies', () => {
  const a = makeBox(30, 10, 10);
  const wall = makeBox(2, 20, 20);
  const s = k.boolean({ op: 'subtract', targets: [a], tools: [wall] });
  assert.equal(s.bodies.length, 2);
  assert.equal(s.bodies[0].replaces, a);
  assert.equal(s.bodies[1].from, a);
});

test('transform, mirror and patterns', () => {
  const a = makeBox(10, 10, 10);
  const moved = k.transform({ ids: [a], matrix: translationMatrix([100, 0, 0]) }).bodies[0];
  near(moved.mesh.bbox.min[0], 95);
  const rot = k.transform({ ids: [a], matrix: rotationMatrix([0, 0, 0], [0, 0, 1], Math.PI / 2) }).bodies[0];
  near(volume(rot.id), 1000);
  const m = k.mirror({ ids: [moved.id], plane: { origin: [0, 0, 0], normal: [1, 0, 0] } });
  near(m.bodies[0].mesh.bbox.max[0], -95);
  const lin = k.pattern({ ids: [a], kind: 'linear', count: 4, spacing: 20, direction: [1, 0, 0] });
  assert.equal(lin.bodies.length, 3);
  near(lin.bodies[2].mesh.bbox.min[0], 55);
  const circ = k.pattern({ ids: [moved.id], kind: 'circular', count: 4, axis: { origin: [0, 0, 0], dir: [0, 0, 1] }, angle: 360 });
  assert.equal(circ.bodies.length, 3);
  const joined = k.pattern({ ids: [a], kind: 'linear', count: 3, spacing: 5, direction: [1, 0, 0], union: true });
  assert.equal(joined.bodies.length, 1);
  near(volume(joined.bodies[0].id), 2000);
});

test('primitives', () => {
  const cyl = k.primitive({ type: 'cylinder', params: { radius: 5, height: 10 } }).bodies[0].id;
  near(volume(cyl), Math.PI * 250, 0.01);
  const sph = k.primitive({ type: 'sphere', params: { radius: 5 } }).bodies[0].id;
  near(volume(sph), (4 / 3) * Math.PI * 125, 0.01);
  const cone = k.primitive({ type: 'cone', params: { radius: 5, topRadius: 0, height: 9 } }).bodies[0].id;
  near(volume(cone), (Math.PI * 25 * 9) / 3, 0.01);
  const tor = k.primitive({ type: 'torus', params: { major: 10, minor: 2 } }).bodies[0].id;
  near(volume(tor), 2 * Math.PI ** 2 * 10 * 4, 0.05);
});

test('split a body with a plane', () => {
  const a = makeBox(10, 10, 10);
  const res = k.split({ id: a, plane: { origin: [0, 0, 4], normal: [0, 0, 1] } });
  assert.equal(res.bodies.length, 2);
  const vols = res.bodies.map((b) => volume(b.id)).sort((x, y) => x - y);
  near(vols[0], 400);
  near(vols[1], 600);
});

test('STL import, mesh booleans and conversion to a solid', () => {
  // Build an STL from a box, then read it back like a user import.
  const box = makeBox(10, 10, 10);
  const parts = k.exportMeshes({ ids: [box] }).parts;
  const stl = writeSTL(parts, { binary: true });
  const parsed = parseSTL(stl.buffer);
  assert.equal(parsed.indices.length / 3, 12);
  const imp = k.importMesh(parsed);
  const meshId = imp.bodies[0].id;
  assert.equal(imp.bodies[0].mesh.kind, 'mesh');
  assert.equal(imp.bodies[0].mesh.watertight, true);
  near(volume(meshId), 1000);
  // Subtract a solid cylinder from the mesh -> mesh result.
  const cyl = k.primitive({ type: 'cylinder', params: { radius: 2, height: 20 } }).bodies[0].id;
  const cut = k.boolean({ op: 'subtract', targets: [meshId], tools: [cyl] });
  assert.equal(cut.bodies[0].mesh.kind, 'mesh');
  near(volume(cut.bodies[0].id), 1000 - Math.PI * 4 * 10, 1);
  // Extrude a sketch onto the mesh (union).
  const sk = { id: 's8', plane: { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] }, entities: [{ id: 'c', type: 'circle', c: [0, 0], r: 2 }] };
  k.sketchRegions(sk);
  const ext = k.extrude({ profiles: [{ type: 'region', sketchId: 's8', index: 0, normal: [0, 0, 1] }], distance: 5, mode: 'union', targets: [meshId] });
  near(volume(ext.bodies[0].id), 1000 + Math.PI * 4 * 5, 1);
  // Convert to an editable solid: the box comes back with 6 flat faces.
  const solid = k.meshToSolid({ id: meshId });
  const sm = solid.bodies[0].mesh;
  assert.equal(sm.kind, 'solid');
  assert.equal(sm.faceInfo.length, 6);
  near(volume(solid.bodies[0].id), 1000);
  // ...and can now be filleted.
  const e = sm.edgeInfo.findIndex((x) => x.type === 'line');
  const fil = k.fillet({ id: solid.bodies[0].id, edges: [e], radius: 1 });
  assert.ok(volume(fil.bodies[0].id) < 1000);
});

test('ASCII STL parsing', () => {
  const ascii = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
  const p = parseSTL(new TextEncoder().encode(ascii).buffer);
  assert.equal(p.indices.length, 3);
  assert.deepEqual(Array.from(p.positions.slice(3, 6)), [1, 0, 0]);
});

test('open (non-watertight) meshes import but refuse booleans', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const imp = k.importMesh({ positions, indices: new Uint32Array([0, 1, 2]) });
  assert.equal(imp.bodies[0].mesh.watertight, false);
  const b = makeBox(1, 1, 1);
  assert.throws(() => k.boolean({ op: 'union', targets: [imp.bodies[0].id], tools: [b] }), /not watertight/);
});

test('STEP round trip and BRep serialisation', () => {
  const a = makeBox(10, 10, 10);
  const { data } = k.exportSTEP({ ids: [a] });
  assert.ok(new TextDecoder().decode(data.slice(0, 20)).startsWith('ISO-10303-21'));
  const imp = k.importSTEP({ data });
  near(volume(imp.bodies[0].id), 1000);
  const ser = k.serialize({ ids: [a] });
  const back = k.deserialize({ items: { body1: ser[a] } });
  near(volume(back.map.body1), 1000);
});

test('measure: distance and angle between faces', () => {
  const a = makeBox(10, 10, 10);
  const b = k.transform({ ids: [makeBox(10, 10, 10)], matrix: translationMatrix([20, 0, 0]) }).bodies[0].id;
  const ma = k.tessellate(a);
  const mb = k.tessellate(b);
  const fa = ma.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[0] > 0.99);
  const fb = mb.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[0] < -0.99);
  const m = k.measure({ items: [{ kind: 'face', id: a, index: fa }, { kind: 'face', id: b, index: fb }] });
  near(m.pair.distance, 10);
  near(m.pair.angle, 0);
  near(m.items[0].area, 100);
});

test('loft between two profiles and sweep along a path', () => {
  const s1 = rectSketch('lo1', -5, -5, 5, 5);
  const s2 = { id: 'lo2', plane: { origin: [0, 0, 10], xDir: [1, 0, 0], normal: [0, 0, 1] }, entities: [{ id: 'c', type: 'circle', c: [0, 0], r: 3 }] };
  k.sketchRegions(s1);
  k.sketchRegions(s2);
  const lo = k.loft({ profiles: [{ type: 'region', sketchId: 'lo1', index: 0 }, { type: 'region', sketchId: 'lo2', index: 0 }] });
  const v = volume(lo.bodies[0].id);
  assert.ok(v > Math.PI * 9 * 10 && v < 1000, `loft volume ${v}`);
  const prof = { id: 'sw1', plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }, entities: [{ id: 'c', type: 'circle', c: [0, 0], r: 1 }] };
  k.sketchRegions(prof);
  const path = [{ type: 'curve', plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] }, entity: { type: 'line', a: [0, 0], b: [0, 20] } }];
  const sw = k.sweep({ profiles: [{ type: 'region', sketchId: 'sw1', index: 0 }], path });
  near(volume(sw.bodies[0].id), Math.PI * 20, 0.05);
});

test('memory management: retainOnly frees unused shapes', () => {
  const a = makeBox();
  const before = k.store.size;
  const dropped = k.retainOnly([a]);
  assert.equal(k.store.size, 1);
  assert.equal(dropped, before - 1);
});
