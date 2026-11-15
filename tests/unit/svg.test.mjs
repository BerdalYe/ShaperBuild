// SVG drawings → sketch curves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSVG } from '../../src/core/svg.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const PX = 25.4 / 96;
const points = (ents) => ents.flatMap((e) => (e.type === 'line' ? [e.a, e.b] : e.pts));

test('sizes follow the width in mm over the viewBox; y points up; centred', () => {
  const { entities, width, height } = parseSVG('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100"/><rect x="0" y="0" width="20" height="10"/></svg>');
  assert.equal(entities.length, 8);
  assert.ok(entities.every((e) => e.type === 'line'));
  near(width, 100);
  near(height, 50);
  const pts = points(entities);
  near(Math.min(...pts.map((p) => p[0])), -50);
  near(Math.max(...pts.map((p) => p[1])), 25);
  // The small rect is in the top-left corner of the picture: top-left here too.
  const small = entities.slice(4);
  assert.ok(points(small).every((p) => p[0] <= -40 + 1e-9 && p[1] >= 20 - 1e-9));
});

test('circles become one closed smooth curve; no size means pixels', () => {
  const { entities } = parseSVG('<svg><circle cx="50" cy="50" r="10"/></svg>');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].type, 'spline');
  assert.equal(entities[0].closed, true);
  for (const p of entities[0].pts) near(Math.hypot(p[0], p[1]), 10 * PX, 1e-3);
});

test('paths: relative moves, repeats, arcs with packed flags, curves, transforms and groups', () => {
  const svg = `<svg width="100" height="100" viewBox="0 0 100 100">
    <g transform="translate(10 0) scale(2)">
      <path d="m0 0 10 0 0 10z"/>
    </g>
    <path transform="rotate(90)" d="M0,0 L10,0"/>
    <path d="M0 0a5 5 0 105 5"/>
    <path d="M0 0 C 0 10 10 10 10 0 S 20 -10 20 0"/>
    <defs><circle r="99"/></defs>
    <rect width="5" height="5" style="display: none"/>
  </svg>`;
  const { entities } = parseSVG(svg, { place: 'origin' });
  const lines = entities.filter((e) => e.type === 'line');
  const splines = entities.filter((e) => e.type === 'spline');
  assert.equal(lines.length, 4, 'triangle (3) and the turned line (1)');
  assert.equal(splines.length, 2, 'the arc, and the two smooth curves as one');
  // The triangle was scaled 2× and moved 10 right: 20 px wide.
  const tri = lines.slice(0, 3);
  const xs = points(tri).map((p) => p[0]);
  near((Math.max(...xs) - Math.min(...xs)) / PX, 20, 1e-6);
  // The turned line runs along y.
  const turned = lines[3];
  near(turned.a[0], turned.b[0], 1e-9);
  near(Math.abs(turned.b[1] - turned.a[1]) / PX, 10, 1e-9);
  // The large arc ends where the path says: 5 right and 5 down from its start.
  const arc = splines[0].pts;
  near((arc[arc.length - 1][0] - arc[0][0]) / PX, 5, 1e-6);
  near((arc[arc.length - 1][1] - arc[0][1]) / PX, -5, 1e-6);
});

test('a shape with corners and curves keeps its corners and closes', () => {
  // A D shape: a straight side and a half circle.
  const { entities } = parseSVG('<svg viewBox="0 0 20 20" width="20mm"><path d="M0 0 L0 20 A10 10 0 0 0 0 0 Z"/></svg>');
  assert.deepEqual(entities.map((e) => e.type).sort(), ['line', 'spline']);
  const [l] = entities.filter((e) => e.type === 'line');
  const [s] = entities.filter((e) => e.type === 'spline');
  const ends = [s.pts[0], s.pts[s.pts.length - 1]];
  for (const p of [l.a, l.b]) assert.ok(ends.some((q) => q[0] === p[0] && q[1] === p[1]), 'the ends meet exactly');
});

test('nothing to draw gives no curves', () => {
  assert.deepEqual(parseSVG('<svg><text>hi</text></svg>').entities, []);
});
