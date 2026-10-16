// Sweep with twist and size change; Wrap & Emboss.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../src/vendor/manifold/manifold.js';
import { Kernel, sweepSections } from '../../src/kernel/kernel.js';

let k;
before(async () => {
  const oc = await OC();
  const mf = await ManifoldModule();
  mf.setup();
  k = new Kernel(oc, mf);
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
const volume = (id) => k.measure({ items: [{ kind: 'body', id }] }).items[0].volume;
const valid = (id) => new k.oc.BRepCheck_Analyzer(k.get(id).shape, true, false).IsValid();
const square = (id, s, extra = []) => ({
  id,
  plane: XY,
  entities: [
    { id: 'a', type: 'line', a: [-s, -s], b: [s, -s] },
    { id: 'b', type: 'line', a: [s, -s], b: [s, s] },
    { id: 'c', type: 'line', a: [s, s], b: [-s, s] },
    { id: 'd', type: 'line', a: [-s, s], b: [-s, -s] },
    ...extra,
  ],
});
const upPath = (h) => [{ type: 'curve', plane: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] }, entity: { type: 'line', a: [0, 0], b: [0, h] } }];

test('section placements follow the path without extra roll', () => {
  // A quarter circle in the XZ plane: the end tangent points along +X.
  const pts = [];
  for (let i = 0; i <= 90; i++) {
    const a = (i * Math.PI) / 180;
    pts.push([20 - 20 * Math.cos(a), 0, 20 * Math.sin(a)]);
  }
  const m = sweepSections(pts, { count: 5 });
  assert.equal(m.length, 5);
  // The last placement turns the start tangent (+Z) into +X and keeps Y.
  const last = m[4];
  const apply = (v) => [last[0] * v[0] + last[4] * v[1] + last[8] * v[2], last[1] * v[0] + last[5] * v[1] + last[9] * v[2], last[2] * v[0] + last[6] * v[1] + last[10] * v[2]];
  apply([0, 0, 1]).forEach((v, i) => assert.ok(Math.abs(v - [1, 0, 0][i]) < 0.02, `tangent ${apply([0, 0, 1])}`));
  apply([0, 1, 0]).forEach((v, i) => assert.ok(Math.abs(v - [0, 1, 0][i]) < 0.02, `side ${apply([0, 1, 0])}`));
  // The first placement is "stay where you are".
  m[0].forEach((v, i) => assert.ok(Math.abs(v - [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][i]) < 1e-9));
});

test('a twisted sweep keeps its volume; a growing one makes a frustum', () => {
  k.sketchRegions(square('tw', 5));
  const tw = k.sweep({ profiles: [{ type: 'region', sketchId: 'tw', index: 0 }], path: upPath(40), twist: 90 });
  const id = tw.bodies[0].id;
  assert.ok(valid(id), 'twisted sweep is a valid solid');
  const v = volume(id);
  assert.ok(Math.abs(v - 4000) / 4000 < 0.02, `twisted volume ${v}`);
  // The top is the square turned by 90° (corners still at ±5): the shape
  // is not a plain box, its middle section is turned 45°.
  const bb = tw.bodies[0].mesh.bbox;
  assert.ok(bb.max[0] > 6.5, `the middle sticks out when turned: ${bb.max[0]}`);
  const gr = k.sweep({ profiles: [{ type: 'region', sketchId: 'tw', index: 0 }], path: upPath(40), endScale: 2 });
  const frustum = (40 * (100 + 400 + 200)) / 3;
  const vg = volume(gr.bodies[0].id);
  assert.ok(Math.abs(vg - frustum) / frustum < 0.02, `grown volume ${vg} vs ${frustum}`);
});

test('twisted sweeps keep holes', () => {
  k.sketchRegions(square('th', 5, [{ id: 'h', type: 'circle', c: [0, 0], r: 2 }]));
  const regions = k.sketchRegions(square('th', 5, [{ id: 'h', type: 'circle', c: [0, 0], r: 2 }])).regions;
  const ring = regions.find((r) => r.area > 50);
  const res = k.sweep({ profiles: [{ type: 'region', sketchId: 'th', index: ring.index }], path: upPath(20), twist: 45 });
  const v = volume(res.bodies[0].id);
  const want = (100 - Math.PI * 4) * 20;
  assert.ok(Math.abs(v - want) / want < 0.02, `ring volume ${v} vs ${want}`);
});

// A 4 × 4 square (optionally with a round hole) on the plane x = 10 that
// touches a cylinder of radius 10, centred 20 up.
const label = (id, hole) => ({
  id,
  plane: { origin: [10, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] },
  entities: [
    { id: 'a', type: 'line', a: [-2, 18], b: [2, 18] },
    { id: 'b', type: 'line', a: [2, 18], b: [2, 22] },
    { id: 'c', type: 'line', a: [2, 22], b: [-2, 22] },
    { id: 'd', type: 'line', a: [-2, 22], b: [-2, 18] },
    ...(hole ? [{ id: 'h', type: 'circle', c: [0, 20], r: 1 }] : []),
  ],
});

function can() {
  const cyl = k.primitive({ type: 'cylinder', params: { radius: 10, height: 40 } });
  const id = cyl.bodies[0].id;
  const side = cyl.bodies[0].mesh.faceInfo.findIndex((f) => f.type === 'cylinder');
  return { id, side };
}

test('emboss raises and engraves shapes wrapped around a round face', () => {
  const base = Math.PI * 100 * 40;
  const { id, side } = can();
  k.sketchRegions(label('w1'));
  const up = k.emboss({ profiles: [{ type: 'region', sketchId: 'w1', index: 0 }], target: { id, face: side }, height: 2 });
  assert.equal(up.bodies.length, 1);
  assert.equal(up.bodies[0].replaces, id);
  assert.ok(valid(up.bodies[0].id));
  // A wedge of a tube: angle 4/R, radii 10..12, 4 high.
  const raised = (0.4 / 2) * (144 - 100) * 4;
  const v = volume(up.bodies[0].id);
  assert.ok(Math.abs(v - (base + raised)) < 0.5, `raised ${v - base} vs ${raised}`);
  // It sits on the side facing the sketch (+X) and keeps its height.
  const bb = up.bodies[0].mesh.bbox;
  assert.ok(Math.abs(bb.max[0] - 12) < 0.05, `sticks out to x = 12: ${bb.max[0]}`);
  const down = k.emboss({ profiles: [{ type: 'region', sketchId: 'w1', index: 0 }], target: { id, face: side }, height: -1 });
  const engraved = (0.4 / 2) * (100 - 81) * 4;
  const v2 = volume(down.bodies[0].id);
  assert.ok(Math.abs(base - v2 - engraved) < 0.5, `engraved ${base - v2} vs ${engraved}`);
});

test('emboss keeps holes and works on flat faces', () => {
  const { id, side } = can();
  const regions = k.sketchRegions(label('w2', true)).regions;
  const ring = regions.find((r) => r.area > 10);
  const up = k.emboss({ profiles: [{ type: 'region', sketchId: 'w2', index: ring.index }], target: { id, face: side }, height: 2 });
  const raised = (0.4 / 2) * (144 - 100) * 4 * ((16 - Math.PI) / 16);
  const v = volume(up.bodies[0].id) - Math.PI * 100 * 40;
  assert.ok(Math.abs(v - raised) < 0.6, `raised ring ${v} vs ${raised}`);
  // Flat: the top of the can, with the square drawn on the ground.
  const top = k.tessellate(id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  k.sketchRegions({ id: 'w3', plane: XY, entities: label('x').entities.map((e) => ({ ...e, a: e.a && [e.a[0], e.a[1] - 20], b: e.b && [e.b[0], e.b[1] - 20] })) });
  const flat = k.emboss({ profiles: [{ type: 'region', sketchId: 'w3', index: 0 }], target: { id, face: top }, height: 3 });
  assert.ok(Math.abs(volume(flat.bodies[0].id) - (Math.PI * 100 * 40 + 48)) < 0.01);
  assert.ok(Math.abs(flat.bodies[0].mesh.bbox.max[2] - 43) < 0.05, `top at ${flat.bodies[0].mesh.bbox.max[2]}`);
});

test('text wraps around a round face', async () => {
  const fs = await import('node:fs');
  const { parseFont, textEntities } = await import('../../src/core/text.js');
  const b = fs.readFileSync(new URL('../../src/fonts/Inter-Bold.ttf', import.meta.url));
  const font = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const t = textEntities(font, 'ShaperBuild 3D', { size: 5, at: [0, 20] });
  const sk = { id: 'tx', plane: { origin: [10, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] }, entities: t.entities.map((e, i) => ({ ...e, id: `t${i}` })) };
  const regions = k.sketchRegions(sk).regions;
  // The letters, not their holes (holes are separate regions inside).
  const letters = regions.filter((r) => t.entities.length && r.area > 0.05);
  assert.ok(letters.length >= 12, `${letters.length} regions`);
  const { id, side } = can();
  const before = volume(id);
  const res = k.emboss({ profiles: letters.map((r) => ({ type: 'region', sketchId: 'tx', index: r.index })), target: { id, face: side }, height: 0.8 });
  assert.ok(valid(res.bodies[0].id), 'embossed text is a valid solid');
  const added = volume(res.bodies[0].id) - before;
  assert.ok(added > 1, `text adds material: ${added}`);
  // The text runs around the can: wider than the flat sketch would allow at
  // the front (it reaches round to the sides).
  const bb = res.bodies[0].mesh.bbox;
  assert.ok(bb.max[0] > 10.7, `letters stand out: ${bb.max[0]}`);
});
