// End-to-end: the 3D Print dialog checks a design and saves STL / 3MF files
// that read back as closed meshes sitting on the print bed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';
import { parseSTL, parse3MF } from '../../src/core/formats.js';
import { mergeVertices, meshStats } from '../../src/kernel/kernel.js';

const { app, win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const dir = fs.mkdtempSync(path.join(OUT, 'print-'));

// Answer the next native save dialog with `file`.
async function nextSave(file) {
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
}
const checkTexts = () => win.locator('.pd-check').allInnerTexts();

try {
  await A(async () => {
    const a = window.__shaper;
    a.home.hide();
    const box = await a.kernel.call('primitive', { type: 'box', params: { width: 40, depth: 30, height: 20 } });
    a.cmd.applyResult('Box', box);
    const cyl = await a.kernel.call('primitive', { type: 'cylinder', params: { radius: 5, height: 50 } });
    a.cmd.applyResult('Cylinder', cyl);
  });
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 2);

  step('the 3D Print button opens the dialog and checks the design');
  await win.locator('#btn-print').click();
  await win.waitForSelector('.print-modal');
  await win.waitForFunction(() => document.querySelectorAll('.pd-summary > div').length === 4, null, { timeout: 30000 });
  let checks = await checkTexts();
  assert.ok(checks.some((t) => /closed, solid/i.test(t)), checks.join('\n'));
  assert.ok(checks.some((t) => /Fits the print bed \(Typical printer, 220 × 220 × 250 mm\)/.test(t)), checks.join('\n'));
  assert.ok(checks.some((t) => /overlap/.test(t)), 'overlapping bodies are pointed out');
  await shot(win, '70-print-dialog');

  step('a printer that is too small is flagged');
  await win.locator('.pd-row select').first().selectOption('custom');
  const custom = win.locator('.pd-custom input');
  await custom.nth(2).fill('30');
  await custom.nth(2).dispatchEvent('change');
  checks = await checkTexts();
  assert.ok(checks.some((t) => /Too tall/.test(t)), checks.join('\n'));
  await win.locator('.pd-row select').first().selectOption('prusa-mk4');

  step('save a 3MF placed on the bed');
  const f3mf = path.join(dir, 'parts.3mf');
  await nextSave(f3mf);
  await win.locator('.pd-foot .btn.primary').click();
  await win.waitForSelector('.print-modal', { state: 'detached' });
  const objs = await parse3MF(new Uint8Array(fs.readFileSync(f3mf)));
  assert.equal(objs.length, 2);
  let zmin = Infinity;
  for (const o of objs) {
    const w = mergeVertices(o.positions, o.indices);
    const st = meshStats(w.positions, w.indices);
    assert.equal(st.watertight, true, `${o.name} is closed`);
    zmin = Math.min(zmin, st.bbox.min[2]);
  }
  near(zmin, 0, 1e-3);
  assert.equal(await A(() => window.__shaper.settings.printer), 'prusa-mk4', 'printer choice is remembered');

  step('save each body as its own STL');
  await win.keyboard.press('Control+p');
  await win.waitForFunction(() => document.querySelectorAll('.pd-summary > div').length === 4, null, { timeout: 30000 });
  await win.locator('.pd-seg button', { hasText: 'STL' }).click();
  await win.locator('.pd-check-row', { hasText: 'own file' }).locator('input').check();
  await nextSave(path.join(dir, 'parts.stl'));
  await win.locator('.pd-foot .btn.primary').click();
  await win.waitForSelector('.print-modal', { state: 'detached' });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.stl')).sort();
  assert.deepEqual(files, ['parts - Body 1.stl', 'parts - Body 2.stl']);
  const stl = parseSTL(new Uint8Array(fs.readFileSync(path.join(dir, files[0]))).buffer);
  const w = mergeVertices(stl.positions, stl.indices);
  const st = meshStats(w.positions, w.indices);
  assert.equal(st.watertight, true);
  near(st.volume, 40 * 30 * 20, 0.5);
  near(st.bbox.min[2], 0, 1e-3);

  step('only the selected body is printed when something is selected');
  await A(() => window.__shaper.selection.set([{ kind: 'body', bodyId: window.__shaper.doc.bodies[1].id }]));
  await win.locator('#btn-print').click();
  await win.waitForSelector('.print-modal');
  const ticked = await win.locator('.pd-body input:checked').count();
  assert.equal(ticked, 1);
  await win.keyboard.press('Escape');
  await win.waitForSelector('.print-modal', { state: 'detached' });

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nprinting: all steps passed');
} catch (err) {
  await shot(win, 'zz-printing-failure').catch(() => {});
  console.error('\nprinting FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
