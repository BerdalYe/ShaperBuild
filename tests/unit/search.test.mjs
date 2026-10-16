// Tool search ranking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScore } from '../../src/ui/commandlist.js';

const entries = [
  { label: 'Circle', keywords: 'hole diameter disc draw' },
  { label: 'Fillet', keywords: 'round radius smooth edge' },
  { label: 'How to move around (navigation)', keywords: 'help orbit pan zoom' },
  { label: 'Subtract', keywords: 'cut difference remove hole boolean' },
  { label: 'Top view', keywords: 'view camera standard' },
  { label: 'Export STL…', keywords: '3d print printing slicer mesh file' },
];
const best = (q) =>
  entries
    .map((e) => ({ e, s: matchScore(q, e) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.e.label);

test('a whole keyword beats a match in the middle of a word', () => {
  assert.equal(best('round')[0], 'Fillet');
});

test('label prefixes rank first', () => {
  assert.equal(best('sub')[0], 'Subtract');
  assert.equal(best('top view')[0], 'Top view');
});

test('every word of the query must match', () => {
  assert.deepEqual(best('hole'), ['Circle', 'Subtract']);
  assert.deepEqual(best('print stl'), ['Export STL…']);
  assert.deepEqual(best('zzz'), []);
});
