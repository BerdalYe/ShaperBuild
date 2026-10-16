// End-to-end: direct manipulation, menus, items panel, theme, sweep/loft.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

async function screen(p) {
  return A((p) => {
    const a = window.__shaper;
    const s = a.vp.worldToScreen(p);
    const r = a.vp.canvas.getBoundingClientRect();
    return [r.left + s[0], r.top + s[1]];
  }, p);
}
async function clickAt(p, opts) {
  const [x, y] = await screen(p);
  await win.mouse.move(x, y, { steps: 3 });
  await win.waitForTimeout(40);
  await win.mouse.click(x, y, opts);
  await win.waitForTimeout(100);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(150);
}
const state = () => A(() => JSON.parse(JSON.stringify(window.__shaper.doc.state)));
const vol = (i = 0) =>
  A(async (i) => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.bodies[i].shapeId }] });
    return r.items[0].volume;
  }, i);

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = true;
    a.vp.rig.fromJSON({ az: 0.5, el: 0.55, dist: 200, target: [0, 0, 0], ortho: false });
  });
  await win.waitForTimeout(300);

  step('drag the extrude arrow of a selected region straight up');
  await win.keyboard.press('r');
  await clickAt([-10, -10, 0]);
  await win.keyboard.type('20');
  await win.keyboard.press('Tab');
  await win.keyboard.type('20');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  await clickAt([0, 0, 0]);
  assert.equal(await A(() => window.__shaper.selection.list[0]?.kind), 'region');
  // The arrow starts at the region centre and points up (+Z).
  const [ax, ay] = await screen([0, 0, 0.5]);
  const [bx, by] = await screen([0, 0, 15]);
  await win.mouse.move(ax, ay - 30, { steps: 2 });
  const handle = await A(([x, y]) => {
    const a = window.__shaper;
    const r = a.vp.canvas.getBoundingClientRect();
    return a.vp.pick(x - r.left, y - r.top, ['handle']);
  }, [ax, ay - 30]);
  assert.equal(handle?.kind, 'handle', 'arrow handle is under the cursor');
  await win.mouse.down();
  await win.mouse.move(bx, by - 30, { steps: 10 });
  await win.mouse.up();
  await idle();
  assert.equal(await A(() => window.__shaper.tools.activeId), 'extrude');
  const dist = await A(() => window.__shaper.tools.active.values.distance);
  assert.ok(dist > 5 && dist < 25, `dragged distance ${dist}`);
  await shot(win, '40-drag-extrude');
  await win.keyboard.press('Enter');
  await idle();
  let s = await state();
  assert.equal(s.bodies.length, 1);
  near(await vol(), 400 * dist, 1);

  step('right-click a face shows the context menu; Hide works');
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  const [fx, fy] = await screen([0, 0, dist]);
  await win.mouse.click(fx, fy, { button: 'right' });
  await win.waitForSelector('.menu');
  await shot(win, '41-context-menu');
  await win.locator('.menu button', { hasText: 'Hide' }).click();
  s = await state();
  assert.equal(s.bodies[0].visible, false);
  await win.keyboard.press('Control+z');

  step('items panel: rename, colour, isolate');
  const row = win.locator('.item', { hasText: 'Body 1' });
  await row.dblclick();
  await win.locator('.item-name input').fill('Plate');
  await win.locator('.item-name input').press('Enter');
  s = await state();
  assert.equal(s.bodies[0].name, 'Plate');
  await win.locator('.item .swatch').first().click();
  await win.locator('.swatches button').nth(2).click();
  s = await state();
  assert.equal(s.bodies[0].color, '#9fd3a8');

  step('revolve a sketch around a sketch line, loft between two profiles, sweep along a path');
  await A(() => window.__shaper.files.reset());
  await A(async () => {
    const a = window.__shaper;
    const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] };
    a.cmd.addSketchEntities(XZ, null, [
      { type: 'line', a: [5, 0], b: [10, 0] },
      { type: 'line', a: [10, 0], b: [10, 20] },
      { type: 'line', a: [10, 20], b: [5, 20] },
      { type: 'line', a: [5, 20], b: [5, 0] },
      { type: 'line', a: [0, -5], b: [0, 25], construction: true },
    ]);
  });
  await idle();
  const sk = (await state()).sketches[0];
  await A(async (sid) => {
    const a = window.__shaper;
    await a.ensureRegions([{ kind: 'region', sketchId: sid, index: 0 }]);
    a.selection.set([{ kind: 'region', sketchId: sid, index: 0, regionKey: a.regionCache.get(sid).key }]);
    a.tools.activate('revolve');
    const t = a.tools.active;
    t.slots[1].items = [{ kind: 'curve', sketchId: sid, entityId: a.doc.sketch(sid).entities[4].id }];
    t.render();
    t.schedule();
  }, sk.id);
  await idle();
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  near(await vol(0), Math.PI * (100 - 25) * 20, 0.2);

  await A(async () => {
    const a = window.__shaper;
    const z0 = { origin: [50, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
    const z1 = { origin: [50, 0, 30], xDir: [1, 0, 0], normal: [0, 0, 1] };
    const s1 = a.cmd.addSketchEntities(z0, null, [
      { type: 'line', a: [-8, -8], b: [8, -8] },
      { type: 'line', a: [8, -8], b: [8, 8] },
      { type: 'line', a: [8, 8], b: [-8, 8] },
      { type: 'line', a: [-8, 8], b: [-8, -8] },
    ]);
    const s2 = a.cmd.addSketchEntities(z1, null, [{ type: 'circle', c: [0, 0], r: 5 }]);
    await a.ensureRegions([
      { kind: 'region', sketchId: s1, index: 0 },
      { kind: 'region', sketchId: s2, index: 0 },
    ]);
    a.selection.set([
      { kind: 'region', sketchId: s1, index: 0, regionKey: a.regionCache.get(s1).key },
      { kind: 'region', sketchId: s2, index: 0, regionKey: a.regionCache.get(s2).key },
    ]);
    a.tools.activate('loft');
  });
  await idle();
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 2);
  const lv = await vol(1);
  const fr = (30 * (256 + Math.PI * 25 + Math.sqrt(256 * Math.PI * 25))) / 3;
  assert.ok(Math.abs(lv - fr) / fr < 0.03, `loft volume ${lv} vs ${fr}`);

  await A(async () => {
    const a = window.__shaper;
    // Own planes, so these do not join the earlier sketches.
    const prof = { origin: [-50, 30, -40], xDir: [1, 0, 0], normal: [0, 0, 1] };
    const path = { origin: [-50, 30, -40], xDir: [1, 0, 0], normal: [0, -1, 0] };
    const p = a.cmd.addSketchEntities(prof, null, [{ type: 'circle', c: [0, 0], r: 2 }]);
    const q = a.cmd.addSketchEntities(path, null, [
      { type: 'line', a: [0, 0], b: [0, 20] },
      { type: 'arc', c: [10, 20], r: 10, a0: Math.PI / 2, a1: Math.PI },
    ]);
    await a.ensureRegions([{ kind: 'region', sketchId: p, index: 0 }]);
    a.selection.set([{ kind: 'region', sketchId: p, index: 0, regionKey: a.regionCache.get(p).key }]);
    a.tools.activate('sweep');
    const t = a.tools.active;
    t.slots[1].items = a.doc.sketch(q).entities.map((e) => ({ kind: 'curve', sketchId: q, entityId: e.id }));
    t.render();
    t.schedule();
  });
  await idle();
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  s = await state();
  assert.equal(s.bodies.length, 3);
  near(await vol(2), Math.PI * 4 * (20 + (Math.PI * 10) / 2), 0.5);
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '42-revolve-loft-sweep');

  step('light theme');
  await A(() => window.__shaper.toggleTheme());
  await win.waitForTimeout(400);
  await shot(win, '43-light-theme');
  await A(() => window.__shaper.toggleTheme());

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\ninteractions: all steps passed');
} catch (err) {
  await shot(win, 'zz-interactions-failure').catch(() => {});
  console.error('\ninteractions FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
