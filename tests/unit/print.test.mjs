// 3D print helpers: bed fit, number formatting and placing parts on the bed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bedFit, buildPrintFile, fmt } from '../../src/ui/printdialog.js';
import { parse3MF } from '../../src/core/formats.js';

test('bed fit allows a quarter turn and checks height', () => {
  assert.equal(bedFit([200, 100, 50], [250, 210, 220]), 'fits');
  assert.equal(bedFit([100, 240, 50], [250, 210, 220]), 'rotate');
  assert.equal(bedFit([300, 100, 50], [250, 210, 220]), 'too-big');
  assert.equal(bedFit([100, 100, 230], [250, 210, 220]), 'too-tall');
});

test('numbers are short but keep whole tens', () => {
  assert.equal(fmt(220), '220');
  assert.equal(fmt(12.5), '12.5');
  assert.equal(fmt(10), '10');
  assert.equal(fmt(0.75), '0.75');
  assert.equal(fmt(3.1), '3.1');
});

test('parts are centred on the bed with the lowest point at zero', async () => {
  // A single triangle standing between z = -5 and z = 5, around x = 100.
  const part = {
    name: 'T',
    positions: new Float32Array([90, 0, -5, 110, 0, -5, 100, 0, 5]),
    indices: new Uint32Array([0, 1, 2]),
    stats: { bbox: { min: [90, 0, -5], max: [110, 0, 5] } },
  };
  const bytes = buildPrintFile([part], { format: '3mf', place: true, bed: [200, 100, 100] });
  const [obj] = await parse3MF(bytes);
  assert.deepEqual(Array.from(obj.positions), [90, 50, 0, 110, 50, 0, 100, 50, 10]);
  const kept = buildPrintFile([part], { format: '3mf', place: false });
  assert.deepEqual(Array.from((await parse3MF(kept))[0].positions), Array.from(part.positions));
});
