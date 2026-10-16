// End-to-end: drives the real Electron app through a typical session.
// Run with: xvfb-run -a node tests/e2e/workflow.mjs   (Linux)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';
import { parseSTL } from '../../src/core/formats.js';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);

// Screen position (page coordinates) of a world point.
async function screen(p) {
  return win.evaluate((p) => {
    const a = window.__shaper;
    const s = a.vp.worldToScreen(p);
    const r = a.vp.canvas.getBoundingClientRect();
    return [r.left + s[0], r.top + s[1]];
  }, p);
}
async function clickAt(p, opts) {
  const [x, y] = await screen(p);
  await win.mouse.move(x, y, { steps: 4 });
  await win.waitForTimeout(60);
  await win.mouse.click(x, y, opts);
  await win.waitForTimeout(120);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(150);
}
const state = () => win.evaluate(() => JSON.parse(JSON.stringify(window.__shaper.doc.state)));
const volume = (bodyIndex = 0) =>
  win.evaluate(async (i) => {
    const a = window.__shaper;
    const b = a.doc.bodies[i];
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] });
    return r.items[0].volume;
  }, bodyIndex);
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

try {
  // Exact clicks: snapping is tested separately.
  await win.evaluate(() => {
    window.__shaper.settings.snap = false;
    window.__shaper.home.hide();
  });
  await win.evaluate(() => window.__shaper.vp.setView('iso'));
  await win.waitForTimeout(500);

  step('draw a 40 × 30 rectangle on the grid');
  await win.keyboard.press('r');
  await clickAt([-20, -15, 0]);
  await clickAt([20, 15, 0]);
  await idle();
  let s = await state();
  assert.equal(s.sketches.length, 1);
  assert.equal(s.sketches[0].entities.length, 4);
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  await shot(win, '03-rectangle');

  step('select the region and extrude it 20 mm with the Extrude tool');
  await win.keyboard.press('Escape');
  await clickAt([0, 0, 0]);
  assert.equal(await win.evaluate(() => window.__shaper.selection.list[0]?.kind), 'region');
  await shot(win, '04-region-selected');
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  const dist = win.locator('#tool-panel .num-input').first();
  await dist.fill('20');
  await win.waitForTimeout(400);
  await idle();
  await shot(win, '05-extrude-preview');
  await dist.press('Enter');
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 1);
  near(await volume(), 40 * 30 * 20, 0.5);
  await win.evaluate(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '06-extruded');

  step('push/pull the top face up by 5 mm (Extrude on a face)');
  await clickAt([5, 5, 20]);
  let sel = await win.evaluate(() => window.__shaper.selection.list.map((i) => i.kind));
  assert.deepEqual(sel, ['face']);
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('5');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  near(await volume(), 40 * 30 * 25, 0.5);
  s = await state();
  assert.equal(s.bodies.length, 1, 'push/pull joins the same body');

  step('fillet a vertical edge (radius 4)');
  const edgeIndex = await win.evaluate(() => {
    const a = window.__shaper;
    const m = a.bodyMesh(a.doc.bodies[0].id);
    const n = (v, t) => Math.abs(v - t) < 0.1;
    return m.edgeInfo.findIndex((e) => e.type === 'line' && n(e.a[0], 20) && n(e.a[1], 15) && n(e.b[0], 20) && n(e.b[1], 15));
  });
  assert.ok(edgeIndex >= 0);
  await clickAt([20, 15, 12.5]);
  sel = await win.evaluate(() => window.__shaper.selection.list.map((i) => `${i.kind}:${i.index}`));
  assert.deepEqual(sel, [`edge:${edgeIndex}`]);
  await win.keyboard.press('f');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('4');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  near(await volume(), 40 * 30 * 25 - (16 - Math.PI * 4) * 25, 0.5);

  step('draw a circle on the top face and cut a hole with a negative extrude');
  await win.keyboard.press('c');
  await clickAt([0, 0, 25]);
  await win.keyboard.type('10');
  await win.keyboard.press('Enter');
  await idle();
  s = await state();
  assert.equal(s.sketches.length, 2);
  assert.equal(s.sketches[1].sourceBody, s.bodies[0].id, 'sketch remembers the face it was drawn on');
  await win.waitForFunction(() => window.__shaper.regionCache.get('s2')?.data?.regions.length === 1);
  await win.keyboard.press('Escape');
  await clickAt([2.5, 0, 25]);
  assert.equal(await win.evaluate(() => window.__shaper.selection.list[0]?.kind), 'region');
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('-10');
  await win.waitForTimeout(300);
  await idle();
  await shot(win, '07-hole-preview');
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  near(await volume(), 40 * 30 * 25 - (16 - Math.PI * 4) * 25 - Math.PI * 25 * 10, 0.5);
  await shot(win, '08-hole');

  step('undo and redo');
  await win.evaluate(() => window.__shaper.cmd.undo());
  await idle();
  near(await volume(), 40 * 30 * 25 - (16 - Math.PI * 4) * 25, 0.5);
  await win.evaluate(() => window.__shaper.cmd.redo());
  await idle();
  near(await volume(), 40 * 30 * 25 - (16 - Math.PI * 4) * 25 - Math.PI * 25 * 10, 0.5);

  step('import an STL file (a 10 mm cube) as a mesh body');
  const cube = await win.evaluate(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'box', params: { width: 10, depth: 10, height: 10 } });
    const { parts } = await a.kernel.call('exportMeshes', { ids: [r.bodies[0].id] });
    await a.kernel.call('release', { ids: [r.bodies[0].id] });
    return { positions: Array.from(parts[0].positions), indices: Array.from(parts[0].indices) };
  });
  const { writeSTL } = await import('../../src/core/formats.js');
  const stlBytes = writeSTL([{ positions: new Float32Array(cube.positions), indices: new Uint32Array(cube.indices) }]);
  const stlPath = path.join(OUT, 'cube.stl');
  fs.writeFileSync(stlPath, stlBytes);
  await win.evaluate((p) => window.__shaper.files.openPath(p), stlPath);
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 2);
  assert.equal(s.bodies[1].kind, 'mesh');
  assert.equal(s.bodies[1].name, 'cube');

  step('move the mesh next to the part, then join it with Union (mesh boolean)');
  await win.evaluate(async () => {
    const a = window.__shaper;
    const b = a.doc.bodies[1];
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 0, 25, 1];
    const res = await a.kernel.call('transform', { ids: [b.shapeId], matrix: m });
    a.cmd.applyResult('Move', res);
  });
  await idle();
  await win.evaluate(() => window.__shaper.selection.set(window.__shaper.doc.bodies.map((b) => ({ kind: 'body', bodyId: b.id }))));
  await win.keyboard.press('u');
  await win.waitForTimeout(300);
  await idle();
  await win.keyboard.press('Enter');
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 1);
  assert.equal(s.bodies[0].kind, 'mesh', 'combining with a mesh gives a mesh');
  await win.evaluate(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '09-mesh-union');
  await win.evaluate(() => window.__shaper.cmd.undo());
  await idle();

  step('save the design, start a new one and open it again');
  const proj = path.join(OUT, 'test-design.shaperbuild');
  assert.equal(await win.evaluate((p) => window.__shaper.files.save({ path: p }), proj), true);
  assert.ok(fs.statSync(proj).size > 1000);
  await win.evaluate(() => window.__shaper.files.reset());
  assert.equal((await state()).bodies.length, 0);
  await win.evaluate((p) => window.__shaper.files.openPath(p), proj);
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 2);
  assert.equal(s.sketches.length, 2);
  near(await volume(0), 40 * 30 * 25 - (16 - Math.PI * 4) * 25 - Math.PI * 25 * 10, 0.5);

  step('export STL and STEP');
  const stlOut = path.join(OUT, 'export.stl');
  await win.evaluate((p) => window.__shaper.files.exportDialog('stl', null, { path: p }), stlOut);
  const parsed = parseSTL(new Uint8Array(fs.readFileSync(stlOut)));
  assert.ok(parsed.indices.length / 3 > 100);
  const stepOut = path.join(OUT, 'export.step');
  await win.evaluate((p) => window.__shaper.files.exportDialog('step', null, { path: p }), stepOut);
  assert.ok(fs.readFileSync(stepOut, 'utf8').startsWith('ISO-10303-21'));
  const mfOut = path.join(OUT, 'export.3mf');
  await win.evaluate((p) => window.__shaper.files.exportDialog('3mf', null, { path: p }), mfOut);
  assert.ok(fs.statSync(mfOut).size > 500);

  step('visualization mode and section view render');
  await win.evaluate(() => window.__shaper.vp.setView('iso', { fit: true }));
  await win.waitForTimeout(500);
  await win.keyboard.press('v');
  await win.waitForTimeout(500);
  await shot(win, '10-visualization');
  await win.keyboard.press('v');
  await win.evaluate(() => window.__shaper.setSection({ enabled: true, origin: [0, 0, 0], normal: [0, -1, 0] }));
  await win.waitForTimeout(400);
  await shot(win, '11-section');
  await win.evaluate(() => window.__shaper.setSection({ enabled: false }));

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nworkflow: all steps passed');
} catch (err) {
  await shot(win, 'zz-failure').catch(() => {});
  console.error('\nworkflow FAILED:', err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
