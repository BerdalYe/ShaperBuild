import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveSketch, coincidentGroups, measure, pruneConstraints } from '../../src/core/solver.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const len = (l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);

const rect = () => [
  { id: 'l1', type: 'line', a: [0, 0], b: [10, 0] },
  { id: 'l2', type: 'line', a: [10, 0], b: [10, 5] },
  { id: 'l3', type: 'line', a: [10, 5], b: [0, 5] },
  { id: 'l4', type: 'line', a: [0, 5], b: [0, 0] },
];
const rectConstraints = [
  { id: 'c1', type: 'horizontal', e: 'l1' },
  { id: 'c2', type: 'vertical', e: 'l2' },
  { id: 'c3', type: 'horizontal', e: 'l3' },
  { id: 'c4', type: 'vertical', e: 'l4' },
];

test('shared corners are found as coincident groups', () => {
  const g = coincidentGroups(rect());
  assert.equal(g.length, 4);
  assert.ok(g.every((x) => x.length === 2));
});

test('dragging a rectangle corner keeps it a rectangle', () => {
  const r = solveSketch(rect(), rectConstraints, { drags: [{ ref: { e: 'l2', p: 'b' }, to: [14, 8] }] });
  assert.ok(r.ok);
  const [l1, l2, l3, l4] = r.entities;
  near(l2.b[0], 14, 1e-3);
  near(l2.b[1], 8, 1e-3);
  near(l1.a[1], l1.b[1]);
  near(l2.a[0], l2.b[0]);
  near(l3.a[1], l3.b[1]);
  near(l4.a[0], l4.b[0]);
  near(l1.b[0], l2.a[0]);
  near(l3.b[0], l4.a[0]);
});

test('changing a length dimension stretches the connected lines', () => {
  const cons = [...rectConstraints, { id: 'd1', type: 'length', e: 'l1', value: 25 }, { id: 'd2', type: 'length', e: 'l2', value: 5 }, { id: 'f', type: 'fix', p: { e: 'l1', p: 'a' }, value: [0, 0] }];
  const r = solveSketch(rect(), cons);
  assert.ok(r.ok);
  near(len(r.entities[0]), 25);
  near(len(r.entities[2]), 25);
  near(len(r.entities[1]), 5);
  near(r.entities[0].a[0], 0);
  near(r.entities[0].a[1], 0);
});

test('diameter, concentric and equal radius', () => {
  const ents = [
    { id: 'c1', type: 'circle', c: [0, 0], r: 5 },
    { id: 'c2', type: 'circle', c: [1, 2], r: 3 },
  ];
  const r = solveSketch(ents, [
    { id: 'k1', type: 'diameter', e: 'c1', value: 20 },
    { id: 'k2', type: 'concentric', e: 'c1', e2: 'c2' },
  ]);
  assert.ok(r.ok);
  near(r.entities[0].r, 10);
  near(r.entities[1].c[0], r.entities[0].c[0]);
  const r2 = solveSketch(ents, [{ id: 'k3', type: 'equal', e: 'c1', e2: 'c2' }]);
  near(r2.entities[0].r, r2.entities[1].r);
});

test('line tangent to a circle', () => {
  const ents = [
    { id: 'c', type: 'circle', c: [0, 0], r: 5 },
    { id: 'l', type: 'line', a: [-10, 7], b: [10, 7] },
  ];
  const r = solveSketch(ents, [
    { id: 't', type: 'tangent', e: 'l', e2: 'c' },
    { id: 'h', type: 'horizontal', e: 'l' },
    { id: 'f', type: 'fix', p: { e: 'c', p: 'c' }, value: [0, 0] },
    { id: 'd', type: 'radius', e: 'c', value: 5 },
  ]);
  assert.ok(r.ok);
  near(Math.abs(r.entities[1].a[1]), 5);
});

test('parallel, perpendicular and angle', () => {
  const ents = [
    { id: 'a', type: 'line', a: [0, 0], b: [10, 1] },
    { id: 'b', type: 'line', a: [0, 5], b: [9, 7] },
    { id: 'c', type: 'line', a: [20, 0], b: [21, 10] },
  ];
  const r = solveSketch(ents, [
    { id: 'p', type: 'parallel', e: 'a', e2: 'b' },
    { id: 'q', type: 'perpendicular', e: 'a', e2: 'c' },
  ]);
  assert.ok(r.ok);
  const d = (l) => [l.b[0] - l.a[0], l.b[1] - l.a[1]];
  const [A, B, C] = r.entities.map(d);
  near((A[0] * B[1] - A[1] * B[0]) / (Math.hypot(...A) * Math.hypot(...B)), 0);
  near((A[0] * C[0] + A[1] * C[1]) / (Math.hypot(...A) * Math.hypot(...C)), 0);
  const ang = measure({ type: 'angle', e: 'a', e2: 'b' }, r.entities);
  near(ang, 0, 1e-4);
  const r2 = solveSketch(ents, [{ id: 'g', type: 'angle', e: 'a', e2: 'c', value: 45 }]);
  near(Math.abs(measure({ type: 'angle', e: 'a', e2: 'c' }, r2.entities)), 45, 1e-4);
});

test('midpoint, on-curve, distance and arcs', () => {
  const ents = [
    { id: 'l', type: 'line', a: [0, 0], b: [10, 0] },
    { id: 'p', type: 'point', p: [3, 2] },
    { id: 'q', type: 'point', p: [20, 3] },
    { id: 'arc', type: 'arc', c: [30, 0], r: 4, a0: 0, a1: Math.PI },
  ];
  const r = solveSketch(ents, [
    { id: 'm', type: 'midpoint', p: { e: 'p', p: 'p' }, e: 'l' },
    { id: 'o', type: 'onCurve', p: { e: 'q', p: 'p' }, e: 'arc' },
    { id: 'd', type: 'distance', p: { e: 'l', p: 'a' }, p2: { e: 'l', p: 'b' }, value: 12 },
  ]);
  assert.ok(r.ok);
  const [l, p, q, arc] = r.entities;
  near(p.p[0], (l.a[0] + l.b[0]) / 2);
  near(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), 12);
  near(Math.hypot(q.p[0] - arc.c[0], q.p[1] - arc.c[1]), arc.r);
});

test('arc end stays joined to a line while the line is dimensioned', () => {
  const ents = [
    { id: 'l', type: 'line', a: [-5, 0], b: [5, 0] },
    { id: 'arc', type: 'arc', c: [0, 0], r: 5, a0: 0, a1: Math.PI },
  ];
  const r = solveSketch(ents, [{ id: 'd', type: 'length', e: 'l', value: 16 }]);
  assert.ok(r.ok);
  const [l, arc] = r.entities;
  near(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), 16);
  const s = [arc.c[0] + arc.r * Math.cos(arc.a0), arc.c[1] + arc.r * Math.sin(arc.a0)];
  const e = [arc.c[0] + arc.r * Math.cos(arc.a1), arc.c[1] + arc.r * Math.sin(arc.a1)];
  const ends = [l.a, l.b];
  assert.ok(ends.some((q) => Math.hypot(q[0] - s[0], q[1] - s[1]) < 1e-6));
  assert.ok(ends.some((q) => Math.hypot(q[0] - e[0], q[1] - e[1]) < 1e-6));
});

test('conflicting constraints are reported', () => {
  const ents = [{ id: 'l', type: 'line', a: [0, 0], b: [10, 0] }];
  const r = solveSketch(ents, [
    { id: 'a', type: 'length', e: 'l', value: 10 },
    { id: 'b', type: 'length', e: 'l', value: 20 },
  ]);
  assert.equal(r.ok, false);
});

test('measuring and pruning', () => {
  const ents = rect();
  near(measure({ type: 'length', e: 'l1' }, ents), 10);
  near(measure({ type: 'distance', p: { e: 'l1', p: 'a' }, p2: { e: 'l3', p: 'a' } }, ents), Math.hypot(10, 5));
  assert.equal(pruneConstraints(rectConstraints, ents.slice(1)).length, 3);
});

test('solving a 60-line sketch stays fast', () => {
  const ents = [];
  const cons = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const b = ((i + 1) / 60) * Math.PI * 2;
    ents.push({ id: `l${i}`, type: 'line', a: [Math.cos(a) * 50, Math.sin(a) * 50], b: [Math.cos(b) * 50, Math.sin(b) * 50] });
    if (i) cons.push({ id: `e${i}`, type: 'equal', e: 'l0', e2: `l${i}` });
  }
  const t0 = performance.now();
  const r = solveSketch(ents, cons, { drags: [{ ref: { e: 'l0', p: 'a' }, to: [55, 0] }] });
  const ms = performance.now() - t0;
  assert.ok(r.ok);
  assert.ok(ms < 1500, `took ${ms} ms`);
});
