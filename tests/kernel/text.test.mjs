// Text tool geometry: glyph outlines become sketch curves whose regions
// extrude into closed solids.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../src/vendor/manifold/manifold.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { parseFont, textEntities, insideText } from '../../src/core/text.js';

let k;
let font;
before(async () => {
  const oc = await OC();
  const mf = await ManifoldModule();
  mf.setup();
  k = new Kernel(oc, mf);
  const b = fs.readFileSync(new URL('../../src/fonts/Inter-Bold.ttf', import.meta.url));
  font = parseFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };

test('capital letters get the requested height and are centred', () => {
  const t = textEntities(font, 'H', { size: 10, at: [5, 5] });
  assert.ok(Math.abs(t.height - 10) < 0.05, `height ${t.height}`);
  const ys = t.entities.flatMap((e) => (e.type === 'line' ? [e.a[1], e.b[1]] : e.pts.map((p) => p[1])));
  assert.ok(Math.abs(Math.min(...ys) - 0) < 0.05 && Math.abs(Math.max(...ys) - 10) < 0.05);
  // "H" is all straight lines.
  assert.ok(t.entities.every((e) => e.type === 'line'));
});

test('round letters use smooth splines; holes are outside the fill', () => {
  const t = textEntities(font, 'O', { size: 20 });
  assert.ok(t.entities.some((e) => e.type === 'spline'));
  assert.ok(t.entities.length <= 4, `few curves for O: ${t.entities.length}`);
  assert.equal(insideText(t.polygons, [0, 0]), false, 'centre of O is a hole');
  const ring = t.polygons[0].reduce((m, p) => (p[0] > m[0] ? p : m), [-Infinity, 0]);
  assert.equal(insideText(t.polygons, [ring[0] - 1, ring[1]]), true, 'the ring is filled');
});

test('text regions extrude into closed solids', () => {
  const t = textEntities(font, 'Hi 8', { size: 10 });
  const sk = { id: 'tx', plane: XY, entities: t.entities.map((e, i) => ({ ...e, id: `e${i}` })) };
  const { regions } = k.sketchRegions(sk);
  const filled = regions.filter((r) => {
    // Centroid of the largest triangle lies well inside the region.
    let best = null;
    for (let i = 0; i < r.indices.length; i += 3) {
      const P = (j) => [r.positions[r.indices[i + j] * 3], r.positions[r.indices[i + j] * 3 + 1]];
      const [a, b, c] = [P(0), P(1), P(2)];
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
      if (!best || area > best.area) best = { area, p: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3] };
    }
    return insideText(t.polygons, best.p);
  });
  // H, i (stem and dot), 8 (one filled shape with two holes).
  assert.equal(filled.length, 4, `filled regions: ${filled.length} of ${regions.length}`);
  const res = k.extrude({ profiles: filled.map((r) => ({ type: 'region', sketchId: 'tx', index: r.index, normal: [0, 0, 1] })), distance: 2, mode: 'new' });
  assert.ok(res.bodies.length >= 1);
  const { parts } = k.printMeshes({ ids: res.bodies.map((b) => b.id) });
  for (const p of parts) assert.equal(p.stats.watertight, true);
  const area = filled.reduce((s, r) => s + r.area, 0);
  const vol = parts.reduce((s, p) => s + p.stats.volume, 0);
  assert.ok(Math.abs(vol - area * 2) < area * 0.02, `volume ${vol} vs ${area * 2}`);
});
