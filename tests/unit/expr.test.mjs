// Expressions in number fields: units, functions and variables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, solveVariables, referencedNames, nameProblem, dependents, renameIn } from '../../src/core/expr.js';

const L = (s, factor = 1, variables) => evaluate(s, { kind: 'length', factor, variables });
const A = (s, variables) => evaluate(s, { kind: 'angle', variables });
const N = (s, variables) => evaluate(s, { kind: 'number', variables });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('lengths: units, plain numbers and imperial', () => {
  assert.equal(L('25'), 25);
  assert.equal(L('25', 10), 250); // plain numbers use the design unit
  near(L('1in + 2mm'), 27.4);
  assert.equal(L('10 + 5 mm', 10), 15); // one unit at the end applies to all
  assert.equal(L('10cm + 5mm'), 105);
  assert.equal(L('2 * 5mm'), 10);
  assert.equal(L(`1' 1"`), 330.2);
  assert.equal(L('1 1/2"'), 38.1);
  assert.equal(L('0 1/2"'), 12.7);
  assert.equal(L('100mm * 100mm / 50mm'), 200); // area / length is a length
  assert.equal(L('12,5'), 12.5); // decimal comma
});

test('angles and trigonometry in degrees', () => {
  assert.equal(A('45'), 45);
  assert.equal(A('pi/2 rad'), 90);
  near(A('atan2(3, 4)'), 36.8698976);
  assert.equal(A('asin(0.5)'), 30);
  near(N('sin(30)'), 0.5);
  near(N('cos(60 deg)'), 0.5);
  near(N('radians(180)'), Math.PI);
  near(N('pi()'), Math.PI);
});

test('functions and their aliases', () => {
  assert.equal(N('sqrt(16)'), 4);
  assert.equal(N('sgn(-3)'), -1);
  assert.equal(N('floor(2.7) + ceiling(2.1) + round(2.5)'), 8);
  assert.equal(N('abs(-2) + absolute(-1)'), 3);
  assert.equal(N('mod(7, 3) + remainder(8, 3)'), 3);
  assert.equal(N('max(1, 5, 3) + minimum(4, 2)'), 7);
  assert.equal(N('avg(1, 2, 3) + mean(2, 4)'), 5);
  assert.equal(L('max(10mm, 2cm)'), 20);
  assert.equal(L('max(1,5; 2)'), 2); // ";" separates when commas are decimals
  near(N('tan(45) + tg(45) + cot(45)'), 3);
  near(A('acos(0) + arctan(1)'), 135);
});

test('errors are reported', () => {
  assert.throws(() => L('10mm + 30deg'), /Length and angle/);
  assert.throws(() => L('(10mm)^2'), /not a length/);
  assert.throws(() => N('1/0'), /Division by zero/);
  assert.throws(() => N('sqrt(-1)'), /negative/);
  assert.throws(() => N('foo + 1'), /Unknown name/);
  assert.throws(() => N('(1 + 2'), /Missing \)/);
  assert.throws(() => N('atan2(1)'), /takes 2/);
});

test('variables', () => {
  const vars = solveVariables(
    [
      { name: 'width', kind: 'length', expr: '20' },
      { name: 'half', kind: 'length', expr: 'width / 2' },
      { name: 'tilt', kind: 'angle', expr: '30' },
      { name: 'n', kind: 'number', expr: '3' },
      { name: 'loop1', kind: 'length', expr: 'loop2' },
      { name: 'loop2', kind: 'length', expr: 'loop1 + 1' },
    ],
    10,
  );
  assert.equal(vars.get('width').value, 200); // 20 cm
  assert.equal(vars.get('half').value, 100);
  assert.equal(L('width * n + half', 10, vars), 700);
  assert.equal(A('tilt * 2', vars), 60);
  assert.ok(vars.get('loop1').error && vars.get('loop2').error);
  assert.deepEqual(referencedNames('2*width + sin(tilt) + 3mm + pi'), ['width', 'tilt']);
  assert.deepEqual(dependents([{ name: 'w', expr: '1' }, { name: 'h', expr: 'w*2' }, { name: 'd', expr: 'h+1' }], 'w'), ['h', 'd']);
  assert.equal(renameIn('w*2 + ww + w', 'w', 'width'), 'width*2 + ww + width');
});

test('variable names', () => {
  assert.equal(nameProblem('width_1'), null);
  assert.equal(nameProblem('_private'), null);
  assert.ok(nameProblem('2x'));
  assert.ok(nameProblem('__x'));
  assert.ok(nameProblem('mm'));
  assert.ok(nameProblem('sin'));
  assert.ok(nameProblem('a'.repeat(101)));
});
