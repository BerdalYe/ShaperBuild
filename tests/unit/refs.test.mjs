// Finding faces, edges and sketch regions again after the design changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faceSig, edgeSig, matchFace, matchEdge, pickRegion, hashString } from '../../src/core/refs.js';
import { chainKeys, withParams, editableParams, stepSummary } from '../../src/core/replay.js';

const box = (h) => ({ min: [0, 0, 0], max: [40, 30, h] });
const faces = (h) => [
  { type: 'plane', center: [20, 15, 0], normal: [0, 0, -1], area: 1200 },
  { type: 'plane', center: [20, 15, h], normal: [0, 0, 1], area: 1200 },
  { type: 'plane', center: [20, 0, h / 2], normal: [0, -1, 0], area: 40 * h },
  { type: 'plane', center: [40, 15, h / 2], normal: [1, 0, 0], area: 30 * h },
];

test('the top face is found again when the body gets taller', () => {
  const sig = faceSig(faces(20)[1], box(20));
  assert.equal(matchFace(sig, faces(35), box(35)), 1);
  // The bottom face points the other way: never confused with the top.
  assert.equal(matchFace(faceSig(faces(20)[0], box(20)), faces(35), box(35)), 0);
  // Nothing like it: no match.
  assert.equal(matchFace(sig, [{ type: 'cylinder', center: [0, 0, 0], axis: { dir: [0, 0, 1] }, radius: 3 }], box(35)), -1);
});

test('an edge is found again by where it sits in the body', () => {
  const edges = (h) => [
    { type: 'line', a: [40, 30, 0], b: [40, 30, h], length: h },
    { type: 'line', a: [0, 30, 0], b: [0, 30, h], length: h },
    { type: 'line', a: [0, 0, h], b: [40, 0, h], length: 40 },
  ];
  const sig = edgeSig(edges(20)[0], box(20));
  assert.equal(matchEdge(sig, edges(35), box(35)), 0);
  assert.equal(matchEdge(edgeSig(edges(20)[2], box(20)), edges(35), box(35)), 2);
});

test('regions are matched by the curves around them', () => {
  const regions = [
    { index: 0, entities: ['c1'], centroid: [0, 0, 0] },
    { index: 1, entities: ['l1', 'l2', 'l3', 'l4', 'c1'], centroid: [5, 5, 0] },
  ];
  assert.equal(pickRegion({ ents: ['l1', 'l2', 'l3', 'l4'], c: [5, 5, 0] }, regions), 1);
  assert.equal(pickRegion({ ents: ['c1'], c: [0, 0, 0] }, regions), 0);
  assert.equal(pickRegion({ ents: ['zz'], c: [0, 0, 0] }, regions), -1);
});

test('step keys change only when something the step uses changes', () => {
  const ref = { sk: 's1', ents: ['a'], c: [0, 0, 0], plane: null, snap: [{ id: 'a', type: 'circle', c: [0, 0], r: 2 }] };
  const f = { id: 'f1', label: 'Extrude', op: 'op', calls: [{ method: 'extrude', args: { profiles: [{ type: 'region', $r: ref }], distance: 5, symmetric: false }, out: ['b1'] }] };
  const sk = (r) => new Map([['s1', { id: 's1', entities: [{ id: 'a', type: 'circle', c: [0, 0], r }, { id: 'b', type: 'line', a: [9, 9], b: [9, 12] }] }]]);
  const k = chainKeys([f], sk(2));
  assert.deepEqual(chainKeys([{ ...f, label: 'Renamed', error: 'x' }], sk(2)), k);
  assert.notDeepEqual(chainKeys([f], sk(3)), k);
  const g = withParams(f, { distance: 8 });
  assert.notDeepEqual(chainKeys([g], sk(2)), k);
  assert.equal(f.calls[0].args.distance, 5, 'the original step is unchanged');
  assert.deepEqual(editableParams(g).map((p) => [p.key, p.value]), [['distance', 8], ['symmetric', false]]);
  assert.equal(stepSummary(g, (v) => `${v} mm`), '8 mm');
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('move matrices match the Move tool (three.js)', async () => {
  const THREE = await import('three');
  const { moveMatrix, scaleMatrix } = await import('../../src/core/replay.js');
  const move = { t: [3, -4, 5], r: [10, 20, 30], pivot: [1, 2, 3] };
  const DEG = Math.PI / 180;
  const pivot = new THREE.Vector3(...move.pivot);
  const pos = pivot.clone().add(new THREE.Vector3(...move.t));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(10 * DEG, 20 * DEG, 30 * DEG, 'XYZ'));
  const m = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-1, -2, -3));
  moveMatrix(move).forEach((v, i) => assert.ok(Math.abs(v - m.elements[i]) < 1e-9, `element ${i}`));
  const s = scaleMatrix({ factor: 2, center: [1, 1, 1] });
  assert.deepEqual([s[0], s[12], s[13], s[14]], [2, -1, -1, -1]);
});

test('Trim keeps track of the curve a piece came from', async () => {
  const { trimEntity } = await import('../../src/core/geom2d.js');
  const line = { id: 'e1', type: 'line', a: [0, 0], b: [10, 0] };
  const cut = { id: 'e2', type: 'line', a: [5, -1], b: [5, 1] };
  const cut2 = { id: 'e3', type: 'line', a: [7, -1], b: [7, 1] };
  const { keep } = trimEntity(line, [6, 0], [line, cut, cut2]);
  assert.equal(keep[0].id, 'e1');
  assert.equal(keep[1].id, undefined);
  assert.equal(keep[1].src, 'e1');
  // Cutting a piece again still points at the first curve.
  const again = trimEntity({ ...keep[1], id: 'e9' }, [9, 0], [cut2, { id: 'e4', type: 'line', a: [8, -1], b: [8, 1] }]);
  assert.equal(again.keep.find((e) => !e.id)?.src ?? 'e1', 'e1');
});
