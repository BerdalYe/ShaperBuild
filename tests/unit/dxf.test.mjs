// DXF reading and writing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeDXF, parseDXF } from '../../src/core/dxf.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const at = (e, a) => [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];

test('sketch curves survive a DXF round trip', () => {
  const sketch = {
    name: 'Plate',
    entities: [
      { type: 'line', a: [0, 0], b: [40, 0] },
      { type: 'circle', c: [10, 10], r: 3 },
      { type: 'arc', c: [20, 0], r: 5, a0: 0, a1: Math.PI / 2 },
      { type: 'line', a: [0, 0], b: [0, 9], construction: true },
      { type: 'spline', pts: [[0, 0], [5, 5], [10, 0]] },
      { type: 'point', p: [1, 2] },
    ],
  };
  const text = writeDXF([sketch]);
  assert.match(text, /\$INSUNITS\n70\n4/);
  const { entities, skipped } = parseDXF(text);
  assert.deepEqual(skipped, {});
  const kinds = entities.map((e) => e.type);
  assert.deepEqual(kinds.filter((k) => k !== 'line' || true).slice(0, 3), ['line', 'circle', 'arc']);
  assert.equal(entities.filter((e) => e.type === 'point').length, 1);
  // Construction lines are left out.
  assert.equal(entities.filter((e) => e.type === 'line' && e.a[0] === 0 && e.b[0] === 0).length, 0);
  const arc = entities.find((e) => e.type === 'arc');
  near(arc.r, 5);
  near(arc.a1, Math.PI / 2, 1e-5);
  // The spline comes back as a polyline through its curve.
  assert.ok(entities.filter((e) => e.type === 'line').length > 5);
});

test('inch drawings are scaled to millimetres', () => {
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '1', '20', '0', '40', '0.5', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const [c] = parseDXF(dxf).entities;
  near(c.c[0], 25.4);
  near(c.r, 12.7);
});

test('polyline bulges become arcs on the right side', () => {
  // Rounded slot: two straight sides and two half-circle ends (bulge 1).
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '20', '20', '0', '42', '1', '10', '20', '20', '10', '10', '0', '20', '10', '42', '1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const { entities } = parseDXF(dxf);
  const arcs = entities.filter((e) => e.type === 'arc');
  assert.equal(arcs.length, 2);
  assert.equal(entities.filter((e) => e.type === 'line').length, 2);
  // Counter-clockwise from (20,0) to (20,10): the arc bulges out to x = 25.
  const right = arcs.find((a) => a.c[0] > 10);
  near(right.r, 5);
  near(right.c[0], 20);
  near(right.c[1], 5);
  let a1 = right.a1;
  while (a1 <= right.a0) a1 += Math.PI * 2;
  near(at(right, (right.a0 + a1) / 2)[0], 25, 1e-9);
  near(at(right, right.a0)[1], 0, 1e-9);
});

test('DXF splines from control points are sampled', () => {
  // Degree-2 B-spline: a parabola-like curve from (0,0) to (10,0).
  const codes = ['0', 'SPLINE', '8', '0', '70', '8', '71', '2', '72', '6', '73', '3', '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1', '10', '0', '20', '0', '10', '5', '20', '10', '10', '10', '20', '0'];
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', ...codes, '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const [s] = parseDXF(dxf).entities;
  assert.equal(s.type, 'spline');
  near(s.pts[0][0], 0);
  near(s.pts[s.pts.length - 1][0], 10, 1e-6);
  const mid = s.pts[Math.floor(s.pts.length / 2)];
  near(mid[1], 5, 0.2);
});
