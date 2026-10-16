// Construction planes and axes, and which sketch values can still move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { midplane, planeThrough, planeThroughLine, planesMeet, axisThrough, lineMeetsPlane } from '../../src/core/construct.js';
import { freeVariables } from '../../src/core/dof.js';

const near = (a, b, tol = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tol, `${a} != ${b}`));
const top = (z) => ({ origin: [0, 0, z], normal: [0, 0, 1], xDir: [1, 0, 0] });

test('midplane of parallel and of crossing planes', () => {
  const m = midplane(top(0), { origin: [5, 5, 10], normal: [0, 0, -1], xDir: [1, 0, 0] });
  near(m.origin, [0, 0, 5]);
  near(m.normal.map(Math.abs), [0, 0, 1]);
  const x = midplane({ origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] }, { origin: [0, 0, 0], normal: [0, 1, 0], xDir: [1, 0, 0] });
  near(x.normal, [Math.SQRT1_2, Math.SQRT1_2, 0]);
});

test('plane through three points, and through a line at an angle', () => {
  const p = planeThrough([0, 0, 2], [1, 0, 2], [0, 1, 2]);
  near(p.normal, [0, 0, 1]);
  assert.equal(planeThrough([0, 0, 0], [1, 1, 1], [2, 2, 2]), null);
  const q = planeThroughLine({ origin: [0, 0, 0], dir: [1, 0, 0] }, 90, [0, 0, 1]);
  near(q.normal, [0, -1, 0]);
});

test('axes from two planes and two points', () => {
  const l = planesMeet({ origin: [0, 0, 3], normal: [0, 0, 1] }, { origin: [2, 0, 0], normal: [1, 0, 0] });
  near(l.dir.map(Math.abs), [0, 1, 0]);
  near([l.origin[0], l.origin[2]], [2, 3]);
  assert.equal(planesMeet(top(0), top(5)), null);
  const a = axisThrough([0, 0, 0], [0, 0, 10]);
  near(a.dir, [0, 0, 1]);
  assert.equal(a.length, 10);
  near(lineMeetsPlane({ origin: [1, 1, 5], dir: [0, 0, -1] }, top(2)), [1, 1, 2]);
});

test('free sketch values', () => {
  const x = [0, 0, 10, 0];
  const horizontal = { vars: [1, 3], f: (v) => v[3] - v[1] };
  const fix = [{ vars: [0], f: (v) => v[0] }, { vars: [1], f: (v) => v[1] }];
  const length = { vars: [0, 1, 2, 3], f: (v) => Math.hypot(v[2] - v[0], v[3] - v[1]) - 10 };
  assert.deepEqual([...freeVariables([horizontal], x.slice(), 4)], [1, 1, 1, 1]);
  assert.deepEqual([...freeVariables([horizontal, ...fix], x.slice(), 4)], [0, 0, 1, 0]);
  assert.deepEqual([...freeVariables([horizontal, ...fix, length], x.slice(), 4)], [0, 0, 0, 0]);
});
