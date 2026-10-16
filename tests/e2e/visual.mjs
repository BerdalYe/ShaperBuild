// End-to-end: materials in visualization mode.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);

try {
  await A(async () => {
    const a = window.__shaper;
    a.home.hide();
    const shapes = [
      ['box', { width: 30, depth: 30, height: 30 }],
      ['sphere', { radius: 16 }],
      ['cylinder', { radius: 12, height: 35 }],
      ['torus', { major: 14, minor: 5 }],
    ];
    for (let i = 0; i < shapes.length; i++) {
      const [id] = a.cmd.applyResult('Shape', await a.kernel.call('primitive', { type: shapes[i][0], params: shapes[i][1] }));
      const b = a.doc.body(id);
      a.cmd.applyResult('Move', await a.kernel.call('transform', { ids: [b.shapeId], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i * 45 - 70, 0, 0, 1] }));
    }
  });
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 4);

  step('visualization mode swaps the tools for the materials panel');
  await win.locator('#mode-seg button[data-mode="visual"]').click();
  await win.waitForSelector('#materials:not([hidden])');
  assert.equal(await win.locator('#tools').isVisible(), false);

  step('materials apply to the selected body, or to all bodies');
  const mats = ['metal', 'glass', 'glossy', 'chrome'];
  for (let i = 0; i < 4; i++) {
    await A((i) => window.__shaper.selection.set([{ kind: 'body', bodyId: window.__shaper.doc.bodies[i].id }]), i);
    await win.locator(`.mp-mat[data-material="${mats[i]}"]`).click();
  }
  assert.deepEqual(await A(() => window.__shaper.doc.bodies.map((b) => b.material)), mats);
  assert.ok((await A(() => [...window.__shaper.vp.bodyViews.values()][1].material.transmission)) > 0.5, 'glass lets light through');
  await A(() => {
    window.__shaper.selection.clear();
    window.__shaper.vp.fit();
  });
  await win.waitForTimeout(800);
  await shot(win, '90-materials');
  await win.locator('.mp-color').nth(1).click();
  assert.equal(await A(() => new Set(window.__shaper.doc.bodies.map((b) => b.color)).size), 1, 'a colour with nothing selected paints every body');
  await win.keyboard.press('Control+z');
  assert.equal(await A(() => window.__shaper.doc.bodies[0].color), null, 'undo restores the colours');

  step('modeling mode shows the plain finish again; materials are saved');
  await win.locator('#mode-seg button[data-mode="model"]').click();
  assert.equal(await A(() => [...window.__shaper.vp.bodyViews.values()][1].material.transmission), 0);
  assert.equal(await win.locator('#tools').isVisible(), true);
  await A(async () => {
    const a = window.__shaper;
    const bytes = await a.files.serialize({ thumbnail: false });
    await a.files.loadProject(bytes, null, 'Materials');
  });
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 4);
  assert.deepEqual(await A(() => window.__shaper.doc.bodies.map((b) => b.material)), mats);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nvisual: all steps passed');
} catch (err) {
  await shot(win, 'zz-visual-failure').catch(() => {});
  console.error('\nvisual FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
