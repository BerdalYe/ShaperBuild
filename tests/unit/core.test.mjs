import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseLength, parseAngle, parseNumber, formatLength, formatArea, niceStep } from '../../src/core/units.js';
import * as G from '../../src/core/geom2d.js';
import { planeFrame, to2D, to3D, samePlane, makePlane, rayPlane, GROUND, defaultXDir } from '../../src/core/plane.js';
import { Document, emptyState } from '../../src/core/doc.js';
import { Selection, itemKey } from '../../src/core/selection.js';
import { parseSTL, writeSTL, parseOBJ, writeOBJ, write3MF, parse3MF, crc32 } from '../../src/core/formats.js';
import { mergeVertices, meshVolume, featureEdges, meshTopology, rotationMatrix, mirrorMatrix, transformMesh } from '../../src/kernel/kernel.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const nearPt = (p, q, tol = 1e-9) => p.forEach((v, i) => near(v, q[i], tol));

test('length expressions with units', () => {
  assert.equal(parseLength('25'), 25);
  assert.equal(parseLength('2.5cm'), 25);
  assert.equal(parseLength('1in'), 25.4);
  near(parseLength('1in + 2mm'), 27.4);
  near(parseLength('(10+5)/2'), 7.5);
  near(parseLength('2*3 mm'), 6);
  near(parseLength('3', 'in'), 76.2);
  near(parseLength('1 ft', 'mm'), 304.8);
  near(parseLength('-4'), -4);
  near(parseLength('1,5'), 1.5);
  assert.ok(Number.isNaN(parseLength('abc')));
  assert.ok(Number.isNaN(parseLength('5 parsecs')));
  assert.ok(Number.isNaN(parseLength('')));
  assert.ok(Number.isNaN(parseLength('1/0')));
});

test('angles and plain numbers', () => {
  assert.equal(parseAngle('90'), 90);
  assert.equal(parseAngle('45°'), 45);
  near(parseAngle('pi/2 rad'), 90);
  assert.equal(parseNumber('3*4'), 12);
});

test('formatting', () => {
  assert.equal(formatLength(25), '25 mm');
  assert.equal(formatLength(25.4, 'in'), '1 in');
  assert.equal(formatLength(1234.5678, 'mm'), '1234.57 mm');
  assert.equal(formatLength(12, 'mm', { suffix: false }), '12');
  assert.equal(formatArea(100, 'cm'), '1 cm²');
  assert.equal(niceStep(3.2), 2);
  assert.equal(niceStep(4), 5);
  assert.equal(niceStep(0.7), 0.5);
  assert.equal(niceStep(80), 100);
});

test('arcs from three points keep the middle point on the arc', () => {
  const a = G.arcFrom3Points([1, 0], [0, 1], [-1, 0]);
  nearPt(a.c, [0, 0]);
  near(a.r, 1);
  assert.ok(G.angleInArc(Math.PI / 2, a.a0, a.a1));
  const b = G.arcFrom3Points([1, 0], [0, -1], [-1, 0]);
  assert.ok(G.angleInArc(-Math.PI / 2, b.a0, b.a1));
  assert.equal(G.arcFrom3Points([0, 0], [1, 1], [2, 2]), null);
});

test('intersections', () => {
  nearPt(G.segSeg([0, 0], [2, 2], [0, 2], [2, 0])[0], [1, 1]);
  assert.equal(G.segSeg([0, 0], [1, 0], [0, 1], [1, 1]).length, 0);
  const lc = G.intersect({ type: 'line', a: [-2, 0], b: [2, 0] }, { type: 'circle', c: [0, 0], r: 1 });
  assert.equal(lc.length, 2);
  const cc = G.circleCircle([0, 0], 1, [1, 0], 1);
  assert.equal(cc.length, 2);
  near(cc[0][0], 0.5);
  const arc = { type: 'arc', c: [0, 0], r: 1, a0: 0, a1: Math.PI };
  assert.equal(G.intersect({ type: 'line', a: [-2, 0.5], b: [2, 0.5] }, arc).length, 2);
  assert.equal(G.intersect({ type: 'line', a: [-2, -0.5], b: [2, -0.5] }, arc).length, 0);
});

test('trim removes the clicked piece between crossings', () => {
  const h = { id: 'h', type: 'line', a: [-10, 0], b: [10, 0] };
  const v1 = { id: 'v1', type: 'line', a: [-5, -5], b: [-5, 5] };
  const v2 = { id: 'v2', type: 'line', a: [5, -5], b: [5, 5] };
  const mid = G.trimEntity(h, [0, 0], [h, v1, v2]);
  assert.equal(mid.keep.length, 2);
  nearPt(mid.keep[0].b, [-5, 0]);
  nearPt(mid.keep[1].a, [5, 0]);
  const end = G.trimEntity(h, [8, 0], [h, v1, v2]);
  assert.equal(end.keep.length, 1);
  nearPt(end.keep[0].b, [5, 0]);
  const circle = { id: 'c', type: 'circle', c: [0, 0], r: 5 };
  const line = { id: 'l', type: 'line', a: [-10, 0], b: [10, 0] };
  const t = G.trimEntity(circle, [0, 5], [circle, line]);
  assert.equal(t.keep[0].type, 'arc');
  assert.ok(G.angleInArc(-Math.PI / 2, t.keep[0].a0, t.keep[0].a1));
  assert.ok(!G.angleInArc(Math.PI / 2, t.keep[0].a0, t.keep[0].a1));
  // A lone curve is removed entirely.
  assert.equal(G.trimEntity(circle, [0, 5], [circle]).keep.length, 0);
});

test('polygon offset grows and shrinks a loop', () => {
  const sq = [
    { type: 'line', a: [0, 0], b: [10, 0] },
    { type: 'line', a: [10, 10], b: [10, 0] },
    { type: 'line', a: [10, 10], b: [0, 10] },
    { type: 'line', a: [0, 10], b: [0, 0] },
  ];
  const loop = G.lineLoop(sq);
  assert.equal(loop.length, 4);
  const out = G.offsetPolygon(loop, 1);
  near(Math.abs(G.signedArea(out)), 144);
  const inn = G.offsetPolygon(loop, -1);
  near(Math.abs(G.signedArea(inn)), 64);
  assert.equal(G.lineLoop(sq.slice(0, 3)), null);
});

test('moving a shared point moves both lines', () => {
  const ents = [
    { id: 'a', type: 'line', a: [0, 0], b: [10, 0] },
    { id: 'b', type: 'line', a: [10, 0], b: [10, 10] },
  ];
  const moved = G.moveSketchPoint(ents, [10, 0], [12, 1]);
  assert.deepEqual(moved[0].b, [12, 1]);
  assert.deepEqual(moved[1].a, [12, 1]);
  assert.deepEqual(ents[0].b, [10, 0], 'input unchanged');
});

test('spline sampling is finite even with repeated points', () => {
  const pts = G.sampleSpline([[0, 0], [5, 5], [5, 5], [10, 0]]);
  assert.ok(pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
});

test('planes: frames, round trips and coplanarity', () => {
  const pl = makePlane([1, 2, 3], [0, -1, 0]);
  const f = planeFrame(pl);
  const P = to3D(f, [4, 5]);
  nearPt(to2D(f, P), [4, 5]);
  assert.ok(samePlane(pl, { origin: [9, 2, -4], normal: [0, -1, 0] }));
  assert.ok(!samePlane(pl, { origin: [9, 3, -4], normal: [0, -1, 0] }));
  assert.ok(!samePlane(pl, { origin: [1, 2, 3], normal: [0, 1, 0] }));
  nearPt(defaultXDir([0, -1, 0]), [1, 0, 0]);
  nearPt(rayPlane([0, 0, 10], [0, 0, -1], GROUND), [0, 0, 0]);
  assert.equal(rayPlane([0, 0, 10], [0, 0, 1], GROUND), null);
});

test('document: apply, undo, redo, immutability and dirty state', () => {
  const doc = new Document();
  const events = [];
  doc.on('change', (e) => events.push(e.kind));
  const id = doc.apply('Add', (d) => d.addSketch({ plane: GROUND }).id);
  assert.equal(doc.sketches.length, 1);
  assert.equal(doc.sketch(id).name, 'Sketch 1');
  assert.ok(Object.isFrozen(doc.state.sketches[0]));
  assert.ok(doc.dirty);
  const before = doc.state;
  doc.apply('Body', (d) => d.addBody({ shapeId: 'k1' }));
  assert.equal(doc.state.sketches[0], before.sketches[0], 'untouched objects keep identity');
  assert.equal(doc.bodies[0].name, 'Body 1');
  doc.undo();
  assert.equal(doc.bodies.length, 0);
  doc.redo();
  assert.equal(doc.bodies.length, 1);
  doc.markSaved();
  assert.ok(!doc.dirty);
  assert.deepEqual([...doc.referencedShapes()], ['k1']);
  doc.load(emptyState());
  assert.ok(!doc.canUndo);
  assert.deepEqual(events, ['apply', 'apply', 'undo', 'redo', 'load']);
});

test('selection keys, toggling and pruning', () => {
  const s = new Selection();
  s.toggle({ kind: 'face', bodyId: 'b1', index: 2, point: [1, 2, 3] });
  assert.ok(s.has({ kind: 'face', bodyId: 'b1', index: 2 }));
  s.toggle({ kind: 'face', bodyId: 'b1', index: 2 });
  assert.equal(s.size, 0);
  s.set([
    { kind: 'body', bodyId: 'b1' },
    { kind: 'body', bodyId: 'b2' },
  ]);
  s.prune((it) => it.bodyId !== 'b2');
  assert.equal(s.size, 1);
  assert.equal(itemKey({ kind: 'spoint', sketchId: 's1', point: [1, 2] }), 'spoint:s1:1.000000,2.000000');
});

test('STL binary and ASCII round trips', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  for (const binary of [true, false]) {
    const bytes = writeSTL([{ positions, indices }], { binary });
    const p = parseSTL(bytes);
    assert.equal(p.indices.length, 12);
    const m = mergeVertices(p.positions, p.indices);
    assert.equal(m.positions.length / 3, 4);
    near(meshVolume(m.positions, m.indices), 1 / 6, 1e-6);
  }
  // Binary file whose header starts with "solid" is still read as binary.
  const bin = writeSTL([{ positions, indices }], { binary: true });
  bin.set(new TextEncoder().encode('solid trick'), 0);
  assert.equal(parseSTL(bin).indices.length, 12);
});

test('OBJ round trip and polygon faces', () => {
  const p = parseOBJ('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  assert.equal(p.indices.length, 6);
  const out = new TextDecoder().decode(writeOBJ([{ positions: p.positions, indices: p.indices, name: 'quad' }]));
  assert.match(out, /^o quad$/m);
  assert.equal(parseOBJ(out).indices.length, 6);
});

test('3MF round trip through the zip writer', async () => {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const bytes = write3MF([{ positions, indices, name: 'tet' }]);
  const meshes = await parse3MF(bytes);
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].name, 'tet');
  assert.equal(meshes[0].indices.length, 12);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('mesh helpers: feature edges and transforms', () => {
  // Unit cube made of 12 triangles has 12 feature edges (diagonals are flat).
  const v = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3];
  const edges = featureEdges(new Float32Array(v), new Uint32Array(f));
  assert.equal(edges.length / 6, 12);
  const topo = meshTopology(new Float32Array(v), new Uint32Array(f));
  assert.equal(topo.edges.length / 6, 12);
  assert.equal(topo.watertight, true);
  assert.equal(topo.positions.length, 12 * 9);
  // Flat cube faces keep flat normals (no smoothing across 90° edges).
  assert.deepEqual(Array.from(topo.normals.slice(0, 3)).map((x) => Math.round(x)), [0, 0, -1]);
  const open = meshTopology(new Float32Array(v), new Uint32Array(f.slice(0, 33)));
  assert.equal(open.watertight, false);
  // Welding is exact and quick.
  const big = new Float32Array(300000 * 3).map((_, i) => Math.floor(i / 9) % 1000);
  const t0 = performance.now();
  mergeVertices(big, null);
  assert.ok(performance.now() - t0 < 500);
  near(meshVolume(new Float32Array(v), new Uint32Array(f)), 1, 1e-9);
  const r = transformMesh(new Float32Array([1, 0, 0]), rotationMatrix([0, 0, 0], [0, 0, 1], Math.PI / 2)).positions;
  nearPt(Array.from(r), [0, 1, 0], 1e-6);
  const m = transformMesh(new Float32Array([3, 1, 1]), mirrorMatrix([1, 0, 0], [1, 0, 0])).positions;
  nearPt(Array.from(m), [-1, 1, 1], 1e-6);
});

test('index.html CSP hash matches the import map', () => {
  const html = fs.readFileSync(new URL('../../src/index.html', import.meta.url), 'utf8');
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = crypto.createHash('sha256').update(map).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), 'update the sha256 in the CSP meta tag after editing the import map');
});
