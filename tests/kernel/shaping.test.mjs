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
  const { parseFont, textEntities, insideText } = await import('../../src/core/text.js');
  const b = fs.readFileSync(new URL('../../src/fonts/Inter-Bold.ttf', import.meta.url));
  const font = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const t = textEntities(font, 'ShaperBuild 3D', { size: 5, at: [0, 20] });
  const sk = { id: 'tx', plane: { origin: [10, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] }, entities: t.entities.map((e, i) => ({ ...e, id: `t${i}` })) };
  const regions = k.sketchRegions(sk).regions;
  // The letters, not their holes (holes are separate regions inside).
  const letters = regions.filter((r) => insideText(t.polygons, [r.centroid[1], r.centroid[2]]));
  assert.ok(letters.length >= 12 && letters.length < regions.length, `${letters.length} letters`);
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

// A small square drawn on a plane facing `normal`, centred at `c`.
function patch(id, c, normal, half = 2) {
  const n = normal;
  const xDir = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [-n[1], n[0], 0];
  const pts = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
  return {
    id,
    plane: { origin: c, xDir, normal: n },
    entities: pts.map((p, i) => ({ id: `q${i}`, type: 'line', a: p, b: pts[(i + 1) % 4] })),
  };
}
const raiseOn = (sketch, id, face, height) => {
  k.sketchRegions(sketch);
  return k.emboss({ profiles: [{ type: 'region', sketchId: sketch.id, index: 0 }], target: { id, face }, height });
};

test('emboss wraps onto a ball', () => {
  const ball = k.primitive({ type: 'sphere', params: { radius: 10 } }).bodies[0];
  const face = ball.mesh.faceInfo.findIndex((f) => f.type === 'sphere');
  const before = volume(ball.id);
  // Facing the ball's side (+X), at its middle height (z = 10).
  const res = raiseOn(patch('sp', [12, 0, 10], [1, 0, 0]), ball.id, face, 1);
  assert.ok(valid(res.bodies[0].id));
  // u, v = ±0.2 rad on a sphere of radius 10, from r = 10 to 11.
  const area = 100 * 0.4 * (2 * Math.sin(0.2));
  const want = (area / 100) * ((11 ** 3 - 10 ** 3) / 3);
  const added = volume(res.bodies[0].id) - before;
  assert.ok(Math.abs(added - want) < 0.5, `ball: ${added} vs ${want}`);
  assert.ok(Math.abs(res.bodies[0].mesh.bbox.max[0] - 11) < 0.05, `on the +X side: ${res.bodies[0].mesh.bbox.max[0]}`);
  // Engraving works the same way.
  const cut = raiseOn(patch('sp2', [12, 0, 10], [1, 0, 0]), ball.id, face, -1);
  const removed = before - volume(cut.bodies[0].id);
  const want2 = (area / 100) * ((10 ** 3 - 9 ** 3) / 3);
  assert.ok(Math.abs(removed - want2) < 0.5, `ball engraving: ${removed} vs ${want2}`);
});

test('emboss wraps onto a cone, a ring and a free-form face', () => {
  const check = (name, body, face, sketch, h = 0.8) => {
    const before = volume(body.id);
    const res = raiseOn(sketch, body.id, face, h);
    assert.ok(valid(res.bodies[0].id), `${name}: valid`);
    const added = volume(res.bodies[0].id) - before;
    // About the patch area (16) times the height.
    assert.ok(added > 16 * h * 0.7 && added < 16 * h * 1.4, `${name}: added ${added}`);
  };
  const cone = k.primitive({ type: 'cone', params: { radius: 12, topRadius: 6, height: 30 } }).bodies[0];
  const side = cone.mesh.faceInfo.findIndex((f) => f.type === 'cone');
  // The cone's side at mid height has radius 9 and leans in.
  const lean = Math.atan2(6, 30);
  check('cone', cone, side, patch('cn', [11, 0, 15], [Math.cos(lean), 0, Math.sin(lean)]));
  const ring = k.primitive({ type: 'torus', params: { major: 20, minor: 6 } }).bodies[0];
  const tf = ring.mesh.faceInfo.findIndex((f) => f.type === 'torus');
  check('ring', ring, tf, patch('to', [28, 0, 6], [1, 0, 0]));
  // A loft from a square to a circle has free-form sides.
  k.sketchRegions({ id: 'ff1', plane: XY, entities: square('x', 15).entities });
  k.sketchRegions({ id: 'ff2', plane: { origin: [0, 0, 40], xDir: [1, 0, 0], normal: [0, 0, 1] }, entities: [{ id: 'c', type: 'circle', c: [0, 0], r: 8 }] });
  const loft = k.loft({ profiles: [{ type: 'region', sketchId: 'ff1', index: 0 }, { type: 'region', sketchId: 'ff2', index: 0 }] }).bodies[0];
  const free = loft.mesh.faceInfo.map((f, i) => ({ f, i })).filter(({ f }) => f.type === 'freeform' && f.center[0] > 5);
  assert.ok(free.length, 'the loft has a free-form side facing +X');
  const fc = free[0].f.center;
  check('free-form', loft, free[0].i, patch('fr', [fc[0] + 3, fc[1], fc[2]], [1, 0, 0]));
});

test('emboss inside a tube raises towards the middle', () => {
  const outer = k.primitive({ type: 'cylinder', params: { radius: 10, height: 40 } }).bodies[0].id;
  const inner = k.primitive({ type: 'cylinder', params: { radius: 6, height: 40 } }).bodies[0].id;
  const tube = k.boolean({ op: 'subtract', targets: [outer], tools: [inner] }).bodies[0];
  const m = k.tessellate(tube.id);
  const wall = m.faceInfo.findIndex((f) => f.type === 'cylinder' && Math.abs(f.radius - 6) < 1e-6);
  const before = volume(tube.id);
  // Drawn on a plane through the middle, facing the inside wall at x = 6.
  const res = raiseOn(patch('tb', [0, 0, 20], [1, 0, 0], 1), tube.id, wall, 1);
  const added = volume(res.bodies[0].id) - before;
  const want = (2 / 6 / 2) * (36 - 25) * 2;
  assert.ok(Math.abs(added - want) < 0.3, `inside: ${added} vs ${want}`);
  const mm = res.bodies[0].mesh;
  assert.ok(Math.abs(mm.bbox.max[0] - 10) < 0.05, 'the outside is unchanged');
});

test('control-point splines: the kernel curve matches the drawn one', async () => {
  const { controlSplinePoints } = await import('../../src/core/geom2d.js');
  const pts = [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ];
  const closed = { id: 'cs', plane: XY, entities: [{ id: 's', type: 'spline', pts, closed: true, control: true }] };
  const res = k.sketchRegions(closed);
  assert.equal(res.regions.length, 1);
  // The exact display curve and the 2D sampling describe the same shape.
  const exact = res.curves.s;
  const drawn = controlSplinePoints(pts, true, 64);
  for (const p of exact) {
    const d = Math.min(...drawn.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    assert.ok(d < 0.05, `off by ${d}`);
  }
  // An open one starts and ends on its first and last control points.
  const open = { id: 'co', plane: XY, entities: [{ id: 's', type: 'spline', pts: [[0, 0], [10, 10], [20, -10], [30, 0]], control: true }] };
  const line = k.sketchRegions(open).curves.s;
  assert.ok(Math.hypot(line[0][0], line[0][1]) < 1e-6);
  assert.ok(Math.hypot(line.at(-1)[0] - 30, line.at(-1)[1]) < 1e-6);
});

test('linear patterns in two and three directions; circular copies that keep their turn', () => {
  const box = k.primitive({ type: 'box', params: { width: 4, depth: 4, height: 4 } }).bodies[0];
  const grid = k.pattern({ ids: [box.id], count: 3, spacing: 10, direction: [1, 0, 0], more: [{ direction: [0, 1, 0], count: 2, spacing: 10 }] });
  assert.equal(grid.bodies.length, 5); // 3 × 2 places, less the original
  const cube = k.pattern({ ids: [box.id], count: 2, spacing: 10, direction: [1, 0, 0], more: [{ direction: [0, 1, 0], count: 2, spacing: 10 }, { direction: [0, 0, 1], count: 2, spacing: 10 }] });
  assert.equal(cube.bodies.length, 7);
  const far = Math.max(...cube.bodies.map((b) => b.mesh.bbox.max[2]));
  assert.ok(Math.abs(far - 14) < 1e-6);
  // A long box turned round Z stays lying along X when it keeps its turn.
  const bar = k.primitive({ type: 'box', params: { width: 10, depth: 2, height: 2 } }).bodies[0];
  const around = k.pattern({ ids: [bar.id], kind: 'circular', count: 4, angle: 360, axis: { origin: [0, -20, 0], dir: [0, 0, 1] }, keepTurn: true });
  for (const b of around.bodies) {
    const s = b.mesh.bbox.max.map((v, i) => v - b.mesh.bbox.min[i]);
    assert.ok(Math.abs(s[0] - 10) < 1e-6 && Math.abs(s[1] - 2) < 1e-6, `kept its turn: ${s}`);
  }
});

test('extrude with a taper and a start offset; helical revolve; two-distance chamfer; keep originals', () => {
  const sq = square('tp', 10);
  k.sketchRegions(sq);
  const region = [{ type: 'region', sketchId: 'tp', index: 0, normal: [0, 0, 1] }];
  // A positive taper leans the walls in: a frustum 20 → 20 − 2·10·tan 10°.
  const tapered = k.extrude({ profiles: region, distance: 10, taper: 10, mode: 'new' }).bodies[0];
  const top = 20 - 2 * 10 * Math.tan((10 * Math.PI) / 180);
  const frustum = (10 / 3) * (400 + top * top + 20 * top);
  assert.ok(Math.abs(volume(tapered.id) - frustum) < 0.5, `taper volume ${volume(tapered.id)} vs ${frustum}`);
  assert.ok(valid(tapered.id));
  // Both directions: each half narrows away from the sketch.
  const both = k.extrude({ profiles: region, distance: 10, symmetric: true, taper: 10, mode: 'new' }).bodies[0];
  assert.ok(Math.abs(volume(both.id) - 2 * frustum) < 1, `symmetric taper volume ${volume(both.id)} vs ${2 * frustum}`);
  assert.ok(Math.abs(both.mesh.bbox.min[2] + 10) < 1e-6 && Math.abs(both.mesh.bbox.max[2] - 10) < 1e-6);
  assert.ok(valid(both.id));
  const lifted = k.extrude({ profiles: region, distance: 10, start: 5, mode: 'new' }).bodies[0];
  assert.ok(Math.abs(lifted.mesh.bbox.min[2] - 5) < 1e-6 && Math.abs(lifted.mesh.bbox.max[2] - 15) < 1e-6);
  // Two turns of a 2 × 2 square, 5 apart: the volume of a ring (Pappus).
  const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
  const prof = { id: 'hx', plane: XZ, entities: [[8, 0, 10, 0], [10, 0, 10, 2], [10, 2, 8, 2], [8, 2, 8, 0]].map((q, i) => ({ id: `h${i}`, type: 'line', a: [q[0], q[1]], b: [q[2], q[3]] })) };
  k.sketchRegions(prof);
  const spring = k.revolve({ profiles: [{ type: 'region', sketchId: 'hx', index: 0, normal: [0, -1, 0] }], axis: { origin: [0, 0, 0], dir: [0, 0, 1] }, angle: 720, pitch: 5, mode: 'new' }).bodies[0];
  assert.ok(Math.abs(volume(spring.id) - 2 * Math.PI * 9 * 4 * 2) < 2, `helix volume ${volume(spring.id)}`);
  assert.ok(Math.abs(spring.mesh.bbox.max[2] - 12) < 0.01);
  assert.ok(valid(spring.id));
  const box = k.primitive({ type: 'box', params: { width: 20, depth: 20, height: 10 } }).bodies[0];
  const e = box.mesh.edgeInfo.findIndex((x) => x.type === 'line' && Math.abs(x.a[2] - 10) < 1e-6 && Math.abs(x.b[2] - 10) < 1e-6);
  const ch = k.chamfer({ id: box.id, edges: [e], distance: 2, distance2: 4 }).bodies[0];
  assert.ok(Math.abs(4000 - volume(ch.id) - 80) < 1e-3);
  const other = k.primitive({ type: 'box', params: { width: 10, depth: 10, height: 30 } }).bodies[0];
  const kept = k.boolean({ op: 'union', targets: [box.id], tools: [other.id], keepTargets: true });
  assert.equal(kept.removed.length, 0);
  assert.ok(kept.bodies.every((b) => !b.replaces));
});
