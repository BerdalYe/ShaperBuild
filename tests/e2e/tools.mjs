// End-to-end: every tool through the real interface.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';
import { writeSTL } from '../../src/core/formats.js';

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
async function moveTo(p) {
  const [x, y] = await screen(p);
  await win.mouse.move(x, y, { steps: 3 });
  await win.waitForTimeout(40);
}
async function clickAt(p, opts) {
  await moveTo(p);
  const [x, y] = await screen(p);
  await win.mouse.click(x, y, opts);
  await win.waitForTimeout(100);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(120);
}
async function panelValue(i, value) {
  const inp = win.locator('#tool-panel .num-input').nth(i);
  await inp.fill(String(value));
  await win.waitForTimeout(250);
  await idle();
}
async function done() {
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
}
const state = () => A(() => JSON.parse(JSON.stringify(window.__shaper.doc.state)));
const vol = (id) =>
  A(async (id) => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.body(id).shapeId }] });
    return r.items[0].volume;
  }, id);
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const lastSketch = async () => (await state()).sketches.at(-1);
const select = (items) => A((items) => window.__shaper.selection.set(items), items);
const bodies = async () => (await state()).bodies;
const setView = (j) => A((j) => window.__shaper.vp.rig.fromJSON(j), j);

try {
  await A(() => {
    window.__shaper.home.hide();
    window.__shaper.settings.snap = true;
  });
  await setView({ az: 0, el: Math.PI / 2, dist: 260, target: [0, 0, 0], ortho: true });
  await win.waitForTimeout(300);

  step('line tool: closed triangle (snapped to the grid) makes a region');
  await win.keyboard.press('l');
  await clickAt([-60, 20, 0]);
  await clickAt([-20, 20, 0]);
  await clickAt([-40, 50, 0]);
  await clickAt([-60, 20, 0]);
  await idle();
  let sk = await lastSketch();
  assert.equal(sk.entities.length, 3);
  assert.deepEqual(sk.entities[0].a, [-60, 20]);
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);

  step('line tool: typed length and angle');
  await clickAt([0, 60, 0]);
  await win.keyboard.type('25');
  await win.keyboard.press('Tab');
  await win.keyboard.type('90');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  sk = await lastSketch();
  const typed = sk.entities.at(-1);
  near(typed.b[0], 0, 1e-6);
  near(typed.b[1], 85, 1e-6);
  await win.keyboard.press('Escape');

  step('arc (3 points), polygon (typed radius), spline');
  await win.keyboard.press('a');
  await clickAt([20, 20, 0]);
  await clickAt([60, 20, 0]);
  await clickAt([40, 40, 0]);
  sk = await lastSketch();
  const arc = sk.entities.at(-1);
  assert.equal(arc.type, 'arc');
  near(arc.r, 20, 1e-6);
  await win.keyboard.press('p');
  await clickAt([40, -40, 0]);
  await win.keyboard.type('10');
  await win.keyboard.press('Enter');
  sk = await lastSketch();
  assert.equal(sk.entities.filter((e) => e.type === 'line').length >= 6 + 4, true);
  await win.keyboard.press('b');
  await clickAt([-60, -20, 0]);
  await clickAt([-40, -10, 0]);
  await clickAt([-20, -30, 0]);
  await win.keyboard.press('Enter');
  sk = await lastSketch();
  assert.equal(sk.entities.at(-1).type, 'spline');
  assert.equal(sk.entities.at(-1).pts.length, 3);
  await win.keyboard.press('Escape');
  await idle();
  await shot(win, '20-sketch-tools');

  step('trim the piece of a line between two crossings');
  await win.keyboard.press('l');
  await clickAt([0, -70, 0]);
  await clickAt([0, -30, 0]);
  await win.keyboard.press('Escape');
  await clickAt([-20, -50, 0]);
  await clickAt([20, -50, 0]);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  const before = (await lastSketch()).entities.length;
  await win.keyboard.press('t');
  await clickAt([10, -50, 0]);
  await idle();
  sk = await lastSketch();
  assert.equal(sk.entities.length, before);
  const trimmed = sk.entities.find((e) => e.type === 'line' && e.a[1] === -50 && e.b[1] === -50);
  assert.ok(trimmed, 'horizontal line still exists');
  near(Math.max(trimmed.a[0], trimmed.b[0]), 0, 1e-6);
  await win.keyboard.press('Escape');

  step('offset the polygon outwards by 3');
  sk = await lastSketch();
  const hexIds = sk.entities.filter((e) => e.type === 'line' && Math.hypot(e.a[0] - 40, e.a[1] + 40) > 9.9 && Math.hypot(e.a[0] - 40, e.a[1] + 40) < 10.1).map((e) => e.id);
  assert.equal(hexIds.length, 6);
  await select(hexIds.map((entityId) => ({ kind: 'curve', sketchId: sk.id, entityId })));
  await A(() => window.__shaper.tools.activate('offset'));
  await panelValue(0, 3);
  await done();
  sk = await lastSketch();
  assert.equal(sk.entities.length, before + 6);

  step('revolve a rectangle around the Y axis');
  await A(() => window.__shaper.files.reset());
  await setView({ az: 0, el: Math.PI / 2, dist: 260, target: [0, 0, 0], ortho: true });
  await win.keyboard.press('r');
  await clickAt([10, 0, 0]);
  await clickAt([20, 10, 0]);
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  await clickAt([15, 5, 0]);
  await win.keyboard.press('q');
  await win.waitForSelector('#tool-panel:not([hidden])');
  await win.locator('#tool-panel .chip', { hasText: /^Y$/ }).click();
  await idle();
  await done();
  let bs = await bodies();
  assert.equal(bs.length, 1);
  near(await vol(bs[0].id), Math.PI * (400 - 100) * 10, 0.1);

  step('box primitive placed by clicking, then shell, chamfer');
  await A(() => window.__shaper.files.reset());
  await setView({ az: 0.6, el: 0.5, dist: 200, target: [0, 0, 0], ortho: false });
  await A(() => window.__shaper.tools.activate('box'));
  await panelValue(0, 30);
  await panelValue(1, 20);
  await panelValue(2, 10);
  await clickAt([0, 0, 0]);
  await idle();
  await win.keyboard.press('Escape');
  bs = await bodies();
  assert.equal(bs.length, 1);
  near(await vol(bs[0].id), 6000);
  const top = await A(() => {
    const a = window.__shaper;
    return a.bodyMesh(a.doc.bodies[0].id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
  });
  await select([{ kind: 'face', bodyId: bs[0].id, index: top, shapeId: bs[0].shapeId }]);
  await win.keyboard.press('h');
  await panelValue(0, 1);
  await done();
  near(await vol(bs[0].id), 6000 - 28 * 18 * 9, 0.1);
  await shot(win, '21-shell');
  await win.keyboard.press('Control+z');
  await idle();
  near(await vol(bs[0].id), 6000);
  bs = await bodies();
  const edge = await A(() => {
    const a = window.__shaper;
    return a.bodyMesh(a.doc.bodies[0].id).edgeInfo.findIndex((e) => e.type === 'line' && Math.abs(e.a[2] - e.b[2]) > 5);
  });
  await select([{ kind: 'edge', bodyId: bs[0].id, index: edge, shapeId: bs[0].shapeId }]);
  await A(() => window.__shaper.tools.activate('chamfer'));
  await panelValue(0, 2);
  await done();
  near(await vol(bs[0].id), 6000 - 2 * 10, 0.1);

  step('mirror (copy) across YZ, linear pattern, move by typed values');
  bs = await bodies();
  await select([{ kind: 'body', bodyId: bs[0].id }]);
  await A(() => window.__shaper.tools.activate('mirror'));
  await idle();
  await done();
  bs = await bodies();
  assert.equal(bs.length, 2);
  await select([{ kind: 'body', bodyId: bs[0].id }]);
  await A(() => window.__shaper.tools.activate('patternLinear'));
  await panelValue(0, 3);
  await panelValue(1, 40);
  await done();
  bs = await bodies();
  assert.equal(bs.length, 4);
  await select([{ kind: 'body', bodyId: bs[0].id }]);
  await A(() => window.__shaper.tools.activate('move'));
  await win.waitForSelector('#tool-panel:not([hidden]) .num-input');
  await panelValue(2, 15);
  await done();
  const bb = await A((id) => window.__shaper.bodyMesh(id).bbox, bs[0].id);
  near(bb.min[2], 15, 1e-3);
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '22-transforms');

  step('measure the distance between two bodies');
  await A(() => window.__shaper.tools.activate('measure'));
  const b0 = bs[0];
  await A(
    async ([id0, id1]) => {
      const a = window.__shaper;
      const t = a.tools.active;
      t.items = [
        { kind: 'body', bodyId: id0 },
        { kind: 'body', bodyId: id1 },
      ];
      await t.measure();
    },
    [b0.id, bs[2].id],
  );
  const panelText = await win.locator('#tool-panel').innerText();
  assert.match(panelText, /Distance/);
  await win.keyboard.press('Escape');

  step('split a body with a plane');
  await A(() => window.__shaper.files.reset());
  await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'cylinder', params: { radius: 10, height: 20 } });
    a.cmd.applyResult('Cylinder', r);
  });
  bs = await bodies();
  await select([{ kind: 'body', bodyId: bs[0].id }]);
  await A(() => window.__shaper.tools.activate('split'));
  await panelValue(0, 5);
  await done();
  bs = await bodies();
  assert.equal(bs.length, 2);

  step('import an STL and convert it to an editable solid');
  await A(() => window.__shaper.files.reset());
  const cube = await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'box', params: { width: 10, depth: 10, height: 10 } });
    const { parts } = await a.kernel.call('exportMeshes', { ids: [r.bodies[0].id] });
    return { positions: Array.from(parts[0].positions), indices: Array.from(parts[0].indices) };
  });
  const stlPath = path.join(OUT, 'cube2.stl');
  fs.writeFileSync(stlPath, writeSTL([{ positions: new Float32Array(cube.positions), indices: new Uint32Array(cube.indices) }], { binary: false }));
  await A((p) => window.__shaper.files.openPath(p), stlPath);
  await idle();
  bs = await bodies();
  assert.equal(bs[0].kind, 'mesh');
  await select([{ kind: 'body', bodyId: bs[0].id }]);
  await A(() => window.__shaper.cmd.convertToSolid());
  await idle();
  bs = await bodies();
  assert.equal(bs[0].kind, 'solid');
  assert.equal(await A((id) => window.__shaper.bodyMesh(id).faceInfo.length, bs[0].id), 6);

  step('scale an imported mesh by 25.4 (inches to mm)');
  await A((p) => window.__shaper.files.openPath(p), stlPath);
  await idle();
  bs = await bodies();
  const meshBody = bs.find((b) => b.kind === 'mesh');
  await select([{ kind: 'body', bodyId: meshBody.id }]);
  await A(() => window.__shaper.tools.activate('scale'));
  await panelValue(0, 25.4);
  await done();
  near(await vol(meshBody.id), 1000 * 25.4 ** 3, 5);

  step('box selection, delete, undo');
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  const r = await A(() => window.__shaper.vp.canvas.getBoundingClientRect().toJSON());
  await win.mouse.move(r.left + 5, r.top + 5);
  await win.mouse.down();
  await win.mouse.move(r.left + r.width - 5, r.top + r.height - 5, { steps: 6 });
  await win.mouse.up();
  assert.equal(await A(() => window.__shaper.selection.list.length), 2);
  await win.keyboard.press('Delete');
  await idle();
  assert.equal((await bodies()).length, 0);
  await win.keyboard.press('Control+z');
  await idle();
  assert.equal((await bodies()).length, 2);

  step('dialogs open and close');
  await A(() => {
    window.__shaper.dialogs.settings();
  });
  await win.waitForSelector('.modal');
  await shot(win, '23-settings');
  await win.keyboard.press('Escape');
  await A(() => {
    window.__shaper.dialogs.shortcuts();
  });
  await win.waitForSelector('.modal');
  await win.keyboard.press('Escape');
  await A(() => {
    window.__shaper.home.show();
  });
  await win.waitForTimeout(300);
  await shot(win, '24-home-recent');

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\ntools: all steps passed');
} catch (err) {
  await shot(win, 'zz-tools-failure').catch(() => {});
  console.error('\ntools FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
