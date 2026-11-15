// Tracing pictures into sketch outlines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeMask, maskOutlines, loopArea, simplifyLoop, loopToEntities, traceImage } from '../../src/core/trace.js';

// A w × h picture, white, with dark pixels where `dark(x, y)` says.
function picture(w, h, dark, { alpha = false } = {}) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = dark(x + 0.5, y + 0.5);
      px[i] = px[i + 1] = px[i + 2] = alpha ? 0 : d ? 20 : 240;
      px[i + 3] = alpha ? (d ? 255 : 0) : 255;
    }
  return px;
}

test('a square with a hole: one outline each, the right areas, apart from each other', () => {
  const W = 40;
  const px = picture(W, W, (x, y) => x > 5 && x < 35 && y > 5 && y < 35 && !(x > 15 && x < 25 && y > 15 && y < 25));
  const mask = shapeMask(px, W, W);
  const loops = maskOutlines(mask, W, W);
  assert.equal(loops.length, 2);
  const areas = loops.map((l) => Math.abs(loopArea(l))).sort((a, b) => a - b);
  // Through the middle of the edge pixels: half a pixel inside each side.
  assert.ok(Math.abs(areas[1] - 30 * 30) < 40, `outer ${areas[1]}`);
  assert.ok(Math.abs(areas[0] - 10 * 10) < 25, `hole ${areas[0]}`);
  const square = simplifyLoop(loops.find((l) => Math.abs(loopArea(l)) > 500), 0.8);
  const ents = loopToEntities(square);
  assert.ok(ents.length >= 4 && ents.length <= 8, `a square has 4 sides, give or take its cut corners: ${ents.length}`);
});

test('dark on light, light on dark, and transparent pictures all find the shape', () => {
  const disk = (x, y) => Math.hypot(x - 20, y - 20) < 12;
  const a = shapeMask(picture(40, 40, disk), 40, 40);
  const b = shapeMask(picture(40, 40, (x, y) => !disk(x, y)), 40, 40);
  const c = shapeMask(picture(40, 40, disk, { alpha: true }), 40, 40);
  const count = (m) => m.reduce((s, v) => s + v, 0);
  assert.equal(count(a), count(b), 'the inverted picture gives the same shape');
  assert.equal(count(a), count(c));
  assert.equal(a[20 * 40 + 20], 1, 'the middle of the disk is the shape');
});

test('a disk becomes one smooth closed curve at the real size; specks are dropped', () => {
  const W = 200;
  const px = picture(W, W, (x, y) => Math.hypot(x - 100, y - 100) < 60 || (x > 2 && x < 4 && y > 2 && y < 4));
  const { entities } = traceImage(px, W, W, { width: 100 });
  assert.equal(entities.length, 1);
  const [e] = entities;
  assert.equal(e.type, 'spline');
  assert.equal(e.closed, true);
  // 60 px of 200 px over 100 mm = 30 mm, measured to the middle of the edge pixels.
  for (const p of e.pts) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 30) < 0.8, `radius ${Math.hypot(p[0], p[1])}`);
});
