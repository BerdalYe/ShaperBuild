// End-to-end: reference planes — add one with the Plane tool, draw on it,
// split a body with it, and keep it when saving.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';

const { app, win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const idle = () => win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });

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
  await win.mouse.move(x, y, { steps: 3 });
  await win.waitForTimeout(40);
  await win.mouse.click(x, y);
  await win.waitForTimeout(120);
}

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = false;
    a.vp.rig.fromJSON({ az: 0.5, el: 0.55, dist: 260, target: [0, 0, 20], ortho: false });
  });

  step('add a plane 30 mm above the grid with the Plane tool');
  await win.keyboard.press('Control+k');
  await win.keyboard.type('plane');
  await win.keyboard.press('Enter');
  assert.equal(await A(() => window.__shaper.tools.activeId), 'plane');
  await A(() => document.getElementById('viewport').querySelector('canvas').focus());
  await win.keyboard.type('30');
  await win.waitForTimeout(250);
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__shaper.doc.planes.length === 1);
  const pl = await A(() => window.__shaper.doc.planes[0]);
  near(pl.plane.origin[2], 30);
  assert.deepEqual(pl.plane.normal, [0, 0, 1]);
  assert.equal(await A(() => window.__shaper.selection.list[0]?.kind), 'plane');
  assert.ok((await win.locator('.items-group-head', { hasText: 'Planes' }).count()) === 1);
  await shot(win, '80-plane');

  step('draw a rectangle on the plane');
  await A(() => window.__shaper.selection.clear());
  await win.keyboard.press('r');
  await clickAt([-10, -10, 30]);
  await clickAt([10, 10, 30]);
  await win.keyboard.press('Escape');
  await idle();
  const sk = await A(() => window.__shaper.doc.sketches[0]);
  near(sk.plane.origin[2], 30);
  assert.equal(sk.entities.length, 4);

  step('the sketch exports to DXF and imports back as a new sketch');
  const dxf = path.join(fs.mkdtempSync(path.join(OUT, 'dxf-')), 'square.dxf');
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, dxf);
  await A(() => window.__shaper.selection.set([{ kind: 'sketch', sketchId: window.__shaper.doc.sketches[0].id }]));
  await A(() => window.__shaper.files.exportDXF());
  assert.match(fs.readFileSync(dxf, 'utf8'), /\nLINE\n/);
  await A((f) => window.__shaper.files.openPath(f, { import: true }), dxf);
  await win.waitForFunction(() => window.__shaper.doc.sketches.length === 2);
  const imported = await A(() => window.__shaper.doc.sketches[1]);
  assert.equal(imported.name, 'square');
  assert.equal(imported.entities.length, 4);
  near(Math.max(...imported.entities.map((e) => Math.abs(e.a[0]))), 10);
  await A(() => window.__shaper.cmd.deleteItems([{ kind: 'sketch', sketchId: window.__shaper.doc.sketches[1].id }]));

  step('a picture to trace: import, set its real width, draw on it, move it');
  // A 4 × 2 pixel PNG.
  const png = path.join(path.dirname(dxf), 'photo.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEUlEQVR4nGP4z8Dwn4GBgQEAJ+AD/btYp9QAAAAASUVORK5CYII=', 'base64'));
  await A(() => window.__shaper.selection.clear());
  await A((f) => window.__shaper.files.openPath(f, { import: true }), png);
  await win.waitForFunction(() => window.__shaper.doc.images.length === 1);
  let im = await A(() => window.__shaper.doc.images[0]);
  assert.equal(im.name, 'photo');
  near(im.width, 100);
  near(im.height, 50);
  assert.ok(im.src.startsWith('data:image/png;base64,'));
  const widthBox = win.locator('#context-bar .cb-prop input.num-input');
  await widthBox.fill('200');
  await widthBox.press('Enter');
  im = await A(() => window.__shaper.doc.images[0]);
  near(im.width, 200);
  near(im.height, 100);
  await shot(win, '81-image');
  await A(() => {
    const a = window.__shaper;
    a.selection.set([{ kind: 'image', imageId: a.doc.images[0].id }]);
    a.tools.activate('move', { force: true });
    const t = a.tools.active;
    t.values.x = 15;
    t.toGizmo();
    t.apply();
  });
  await win.waitForFunction(() => Math.abs(window.__shaper.doc.images[0].plane.origin[0] - 15) < 1e-6);
  await A(() => window.__shaper.cmd.deleteItems([{ kind: 'image', imageId: window.__shaper.doc.images[0].id }]));
  assert.equal(await A(() => window.__shaper.doc.images.length), 0);
  await win.keyboard.press('Control+z');
  assert.equal(await A(() => window.__shaper.doc.images.length), 1, 'undo brings the image back');

  step('a tilted plane from a face');
  await A(async () => {
    const a = window.__shaper;
    const res = await a.kernel.call('primitive', { type: 'box', params: { width: 40, depth: 40, height: 20 } });
    a.cmd.applyResult('Box', res);
  });
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 1 && window.__shaper.bodyMesh(window.__shaper.doc.bodies[0].id));
  await A(() => {
    const a = window.__shaper;
    const m = a.bodyMesh(a.doc.bodies[0].id);
    const top = m.faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.99);
    a.selection.set([{ kind: 'face', bodyId: a.doc.bodies[0].id, index: top, shapeId: a.doc.bodies[0].shapeId }]);
    a.tools.activate('plane');
    const t = a.tools.active;
    t.values.offset = 0;
    t.values.tilt = 90;
    t.apply();
  });
  await win.waitForFunction(() => window.__shaper.doc.planes.length === 2);
  const tilted = await A(() => window.__shaper.doc.planes[1].plane);
  near(tilted.origin[2], 20);
  near(Math.abs(tilted.normal[2]), 0, 1e-6);

  step('split the box with the tilted plane');
  await A(() => {
    const a = window.__shaper;
    a.selection.clear();
    a.tools.activate('split');
    const t = a.tools.active;
    t.slots[0].items = [{ kind: 'body', bodyId: a.doc.bodies[0].id }];
    t.slots[1].items = [{ kind: 'plane', planeId: a.doc.planes[1].id }];
    t.render();
    t.schedule();
  });
  await idle();
  await win.waitForTimeout(400);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 2, 'the box is cut in two');

  step('planes are saved with the design and can be hidden and deleted');
  await A(async () => {
    const a = window.__shaper;
    const bytes = await a.files.serialize({ thumbnail: false });
    await a.files.loadProject(bytes, null, 'Planes');
  });
  await win.waitForFunction(() => window.__shaper.doc.planes.length === 2);
  assert.equal(await A(() => window.__shaper.doc.images.length), 1, 'images are saved too');
  await win.locator('.items-group-head', { hasText: 'Planes' }).hover();
  await win.locator('.items-group-head', { hasText: 'Planes' }).locator('.item-btn').click();
  assert.equal(await A(() => window.__shaper.doc.planes.every((p) => p.visible === false)), true);
  await A(() => window.__shaper.cmd.deleteItems([{ kind: 'plane', planeId: window.__shaper.doc.planes[0].id }]));
  assert.equal(await A(() => window.__shaper.doc.planes.length), 1);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nplanes: all steps passed');
} catch (err) {
  await shot(win, 'zz-planes-failure').catch(() => {});
  console.error('\nplanes FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
