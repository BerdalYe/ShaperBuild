// End-to-end: the design history. Make a part, then go back and change an
// early step, a sketch and a fillet; everything after it must update.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);

async function screen(p) {
  return A((p) => {
    const a = window.__shaper;
    const s = a.vp.worldToScreen(p);
    const r = a.vp.canvas.getBoundingClientRect();
    return [r.left + s[0], r.top + s[1]];
  }, p);
}
async function clickAt(p) {
  const [x, y] = await screen(p);
  await win.mouse.move(x, y, { steps: 4 });
  await win.waitForTimeout(60);
  await win.mouse.click(x, y);
  await win.waitForTimeout(120);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await A(() => window.__shaper.history.settle());
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(100);
}
const volume = () =>
  A(async () => {
    const a = window.__shaper;
    let v = 0;
    for (const b of a.doc.bodies) v += (await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] })).items[0].volume;
    return v;
  });
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const steps = () => A(() => window.__shaper.history.features.map((f) => ({ label: f.label, op: f.op, error: f.error || null, off: !!f.suppressed })));
const PI = Math.PI;
// Volume of the part: w × d box of height H, one rounded vertical edge
// (radius r) and a hole of radius 5, 10 deep.
const part = (w, d, H, r = 4) => w * d * H - (r * r - (PI * r * r) / 4) * H - PI * 25 * 10;

async function typeIn(label, key, value) {
  await A(() => {
    const p = window.__shaper.items;
    p.historyList.open = null;
    p.render();
  });
  await win.locator('.step', { hasText: label }).first().click();
  const inp = win.locator(`.step-edit .num-input[data-key="${key}"]`);
  await inp.fill(String(value));
  await inp.press('Enter');
  await idle();
}

try {
  await A(() => {
    window.__shaper.settings.snap = false;
    window.__shaper.home.hide();
    window.__shaper.vp.setView('iso');
  });
  await win.waitForTimeout(400);

  step('model a part: rectangle, extrude 20, push/pull +5, fillet, hole');
  await win.keyboard.press('r');
  await clickAt([-20, -15, 0]);
  await clickAt([20, 15, 0]);
  await idle();
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  await win.keyboard.press('Escape');
  await clickAt([0, 0, 0]);
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('20');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(400);
  await clickAt([5, 5, 20]);
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('5');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  await clickAt([20, 15, 12.5]);
  assert.equal(await A(() => window.__shaper.selection.list[0]?.kind), 'edge');
  await win.keyboard.press('f');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('4');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  await win.keyboard.press('c');
  await clickAt([0, 0, 25]);
  await win.keyboard.type('10');
  await win.keyboard.press('Enter');
  await idle();
  assert.ok(await A(() => !!window.__shaper.doc.sketches[1].attach), 'the sketch remembers the face it is on');
  await win.waitForFunction(() => window.__shaper.regionCache.get('s2')?.data?.regions.length === 1);
  await win.keyboard.press('Escape');
  await clickAt([2.5, 0, 25]);
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await win.locator('#tool-panel .num-input').first().fill('-10');
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .num-input').first().press('Enter');
  await idle();
  near(await volume(), part(40, 30, 25));
  assert.deepEqual(
    (await steps()).map((s) => s.label),
    ['Extrude', 'Extrude', 'Fillet', 'Extrude'],
  );

  step('the History tab lists the steps');
  await win.keyboard.press('Shift+H');
  await win.waitForSelector('.items-tab.on[data-tab="history"]');
  assert.equal(await win.locator('.step').count(), 4);
  assert.match(await win.locator('.step').first().innerText(), /Extrude[\s\S]*20/);
  await shot(win, '90-history');

  step('make the first extrude 30 mm: push/pull, fillet and hole follow');
  await typeIn('Extrude', 'distance', 30);
  near(await volume(), part(40, 30, 35));
  const hole = await A(() => {
    const a = window.__shaper;
    const m = a.bodyMesh(a.doc.bodies[0].id);
    return m.faceInfo.filter((f) => f.type === 'cylinder' && Math.abs(f.radius - 5) < 1e-6).map((f) => f.center[2]);
  });
  assert.ok(hole.length && hole.every((z) => z > 25 && z < 35), `the hole is cut from the new top face: ${hole}`);
  near(await A(() => window.__shaper.doc.sketches[1].plane.origin[2]), 35, 1e-6);
  assert.deepEqual((await steps()).map((s) => s.error), [null, null, null, null]);
  await shot(win, '91-history-edited');

  step('change the fillet radius');
  await typeIn('Fillet', 'radius', 2);
  near(await volume(), part(40, 30, 35, 2));

  step('a wider rectangle in the sketch updates the part');
  await A(() => {
    const a = window.__shaper;
    const sk = a.doc.sketch('s1');
    const sx = (p) => [p[0] * 1.5, p[1]];
    a.cmd.setSketchEntities('s1', sk.entities.map((e) => (e.type === 'line' ? { ...e, a: sx(e.a), b: sx(e.b) } : e)), 'Edit sketch');
  });
  await idle();
  near(await volume(), part(60, 30, 35, 2));

  step('turn a step off and on');
  await A(() => window.__shaper.history.toggleSuppress(window.__shaper.history.features[2].id));
  await idle();
  near(await volume(), 60 * 30 * 35 - PI * 25 * 10);
  assert.equal(await win.locator('.step.step-off').count(), 1);
  await A(() => window.__shaper.history.toggleSuppress(window.__shaper.history.features[2].id));
  await idle();
  near(await volume(), part(60, 30, 35, 2));

  step('a step that cannot be made shows an error, and undo fixes it');
  await typeIn('Fillet', 'radius', 40);
  assert.ok((await steps())[2].error, 'the fillet reports a problem');
  assert.equal(await win.locator('.step.step-bad').count(), 1);
  await shot(win, '92-history-error');
  await A(() => window.__shaper.cmd.undo());
  await idle();
  assert.equal((await steps())[2].error, null);
  near(await volume(), part(60, 30, 35, 2));

  step('undo and redo turning a step on');
  await A(() => window.__shaper.cmd.undo());
  await idle();
  near(await volume(), 60 * 30 * 35 - PI * 25 * 10);
  await A(() => window.__shaper.cmd.redo());
  await idle();
  near(await volume(), part(60, 30, 35, 2));

  step('the history is saved with the design and still editable');
  await A(async () => {
    const a = window.__shaper;
    const bytes = await a.files.serialize({ thumbnail: false });
    await a.files.loadProject(bytes, null, 'History');
  });
  await idle();
  assert.equal((await steps()).length, 4);
  near(await volume(), part(60, 30, 35, 2));
  await typeIn('Extrude', 'distance', 15);
  near(await volume(), part(60, 30, 20, 2));

  step('delete a step');
  await A(() => window.__shaper.history.removeStep(window.__shaper.history.features[3].id));
  await idle();
  near(await volume(), 60 * 30 * 20 - (4 - PI) * 20);

  step('deleting the sketch keeps the body as it is');
  const before = await volume();
  await A(() => window.__shaper.cmd.deleteItems([{ kind: 'sketch', sketchId: 's1' }]));
  await idle();
  near(await volume(), before);
  await typeIn('Fillet', 'radius', 3);
  near(await volume(), 60 * 30 * 20 - (9 - (PI * 9) / 4) * 20);

  step('deleting a body is a step too');
  await A(() => window.__shaper.cmd.deleteItems([{ kind: 'body', bodyId: window.__shaper.doc.bodies[0].id }]));
  await idle();
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 0);
  assert.equal((await steps()).at(-1).op, 'delete');

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nhistory: all steps passed');
} catch (err) {
  await shot(win, 'zz-history-failure').catch(() => {});
  console.error('\nhistory FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
