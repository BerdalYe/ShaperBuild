// Norwegian translation: every text the app shows has a translation, and
// the translations keep the placeholders and markup of the English text.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { extract } from '../../tools/i18n-extract.mjs';
import { NB } from '../../src/i18n/nb.js';
import { t, tn, setLanguage, localNumber } from '../../src/core/i18n.js';
import { parseLength } from '../../src/core/units.js';

const require = createRequire(import.meta.url);
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s) => [...s.matchAll(/<\/?(\w+)/g)].map((m) => m[0]).sort();

test('every text in the app has a Norwegian translation', () => {
  const missing = [...extract()].filter(([k]) => NB[k] === undefined).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, [], 'run: node tools/i18n-extract.mjs');
});

test('translations keep placeholders and markup', () => {
  for (const [en, nb] of Object.entries(NB)) {
    assert.deepEqual(placeholders(nb), placeholders(en), `placeholders in ${JSON.stringify(en)}`);
    assert.deepEqual(tags(nb), tags(en), `markup in ${JSON.stringify(en)}`);
  }
});

test('t() translates labels, counts and messages built at run time', () => {
  setLanguage('nb');
  try {
    assert.equal(t('Extrude'), 'Ekstruder');
    assert.equal(t('Extrude…'), 'Ekstruder…');
    assert.equal(tn(1, '1 body', '{n} bodies'), '1 objekt');
    assert.equal(tn(3, '1 body', '{n} bodies'), '3 objekter');
    assert.equal(t('Fillet failed (radius too large for the selected edges)'), '«Avrunding» mislyktes (radiusen er for stor for de valgte kantene)');
    assert.equal(t('Wrap & Emboss failed'), '«Preging» mislyktes');
    // History shows kernel errors with a capital letter.
    assert.equal(t('A body it uses no longer exists'), 'Et objekt den bruker, finnes ikke lenger');
    assert.equal(t('Undo {label}', { label: t('Delete Extrude') }), 'Angre Slett «Ekstruder»');
    assert.equal(t('Import part.stl'), 'Importer part.stl');
    assert.equal(t('Set length'), 'Endre lengde');
    // Unknown text (names people typed) is shown as it is.
    assert.equal(t('My bracket v2'), 'My bracket v2');
    assert.equal(localNumber('12.5 mm'), '12,5 mm');
    assert.equal(parseLength('12,5'), 12.5);
    assert.equal(parseLength('max(1,2)'), 2);
  } finally {
    setLanguage('en');
  }
  assert.equal(t('Extrude'), 'Extrude');
  assert.equal(t('{n} bodies', { n: 2 }), '2 bodies');
  assert.equal(localNumber('12.5 mm'), '12.5 mm');
});

test('native menus and dialogs are translated', () => {
  const { NB: MAIN } = require('../../electron/i18n.cjs');
  const src = ['menu.cjs', 'main.cjs'].map((f) => fs.readFileSync(new URL(`../../electron/${f}`, import.meta.url), 'utf8')).join('\n');
  const keys = [...src.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g)].map((m) => m[2].replace(/\\'/g, "'"));
  assert.ok(keys.length > 30);
  const missing = keys.filter((k) => MAIN[k] === undefined && !/^[A-Z0-9]+$/.test(k));
  assert.deepEqual(missing, []);
});
