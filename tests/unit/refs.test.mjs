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
