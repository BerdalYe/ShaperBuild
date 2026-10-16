// End-to-end: folders in Items, Wrap & Emboss, Sweep twist, and changing
// Move / Split / Emboss / Sweep steps later from History.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await A(() => window.__shaper.history.settle());
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(100);
}
const volumeOf = (bodyId) =>
  A(async (id) => {
    const a = window.__shaper;
    const b = a.doc.body(id);
    return (await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] })).items[0].volume;
  }, bodyId);
const bodyBox = (bodyId) => A((id) => window.__shaper.bodyMesh(id).bbox, bodyId);
const steps = () => A(() => window.__shaper.history.features.map((f) => ({ id: f.id, label: f.label, error: f.error || null })));
async function addShape(type, params, label) {
  await A(
    async ({ type, params, label }) => {
      const a = window.__shaper;
      const res = await a.kernel.call('primitive', { type, params });
      a.cmd.applyResult(label, res);
    },
    { type, params, label },
  );
  await idle();
  return A(() => window.__shaper.doc.bodies.at(-1).id);
}
// Run an OpTool with its slots filled in, then press its OK button.
async function runTool(id, slots, values = {}) {
  await A(
    ({ id, slots, values }) => {
      const a = window.__shaper;
      a.selection.clear();
      a.tools.activate(id, { force: true });
      const t = a.tools.active;
      Object.assign(t.values, values);
      slots.forEach((items, i) => (t.slots[i].items = items));
      t.render();
      t.schedule();
    },
    { id, slots, values },
  );
  await idle();
  await win.waitForTimeout(300);
  await idle();
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
}
async function editStep(index, key, value) {
  await A(
    ({ index, key, value }) => {
      const p = window.__shaper.items;
      p.setTab('history');
      p.historyList.open = window.__shaper.history.features[index].id;
      p.render();
    },
    { index, key, value },
  );
  const inp = win.locator(`.step-edit .num-input[data-key="${key}"]`);
  await inp.fill(String(value));
  await inp.press('Enter');
  await idle();
}

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = false;
    a.vp.rig.fromJSON({ az: 0.6, el: 0.45, dist: 220, target: [0, 0, 15], ortho: false });
  });

  step('Wrap & Emboss: a label wrapped round a can, raised 1 mm');
  const can = await addShape('cylinder', { radius: 10, height: 40 }, 'Cylinder');
  const canVol = await volumeOf(can);
  await A(() => {
    const a = window.__shaper;
    const sq = [
      { type: 'line', a: [-3, 17], b: [3, 17] },
      { type: 'line', a: [3, 17], b: [3, 23] },
      { type: 'line', a: [3, 23], b: [-3, 23] },
      { type: 'line', a: [-3, 23], b: [-3, 17] },
    ];
    a.cmd.addSketch({ origin: [10, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] }, sq, { name: 'Label' });
  });
  const labelSketch = await A(() => window.__shaper.doc.sketches.at(-1).id);
  await win.waitForFunction((id) => window.__shaper.regionCache.get(id)?.data?.regions.length === 1, labelSketch);
  const side = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'cylinder'), can);
  await runTool('emboss', [[{ kind: 'region', sketchId: labelSketch, index: 0 }], [{ kind: 'face', bodyId: can, index: side }]], { height: 1 });
  const wedge = (h) => (0.6 / 2) * ((10 + h) ** 2 - 100) * 6;
  near((await volumeOf(can)) - canVol, wedge(1));
  near((await bodyBox(can)).max[0], 11, 0.05);
  await shot(win, '93-emboss');

  step('Wrap & Emboss onto a ball');
  const ball = await addShape('sphere', { radius: 10 }, 'Sphere');
  await A(() => {
    const a = window.__shaper;
    a.cmd.addSketch({ origin: [12, 0, 10], xDir: [0, 1, 0], normal: [1, 0, 0] }, [
      { type: 'line', a: [-2, -2], b: [2, -2] },
      { type: 'line', a: [2, -2], b: [2, 2] },
      { type: 'line', a: [2, 2], b: [-2, 2] },
      { type: 'line', a: [-2, 2], b: [-2, -2] },
    ], { name: 'Badge' });
  });
  const badge = await A(() => window.__shaper.doc.sketches.at(-1).id);
  await win.waitForFunction((id) => window.__shaper.regionCache.get(id)?.data?.regions.length === 1, badge);
  const ballVol = await volumeOf(ball);
  const ballFace = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'sphere'), ball);
  await runTool('emboss', [[{ kind: 'region', sketchId: badge, index: 0 }], [{ kind: 'face', bodyId: ball, index: ballFace }]], { height: 1 });
  const onBall = (((100 * 0.4 * 2 * Math.sin(0.2)) / 100) * (11 ** 3 - 10 ** 3)) / 3;
  near((await volumeOf(ball)) - ballVol, onBall);
  await A((id) => window.__shaper.cmd.deleteItems([{ kind: 'body', bodyId: id }]), ball);
  await idle();

  step('History: make the emboss an engraving instead');
  let st = await steps();
  const embossStep = st.map((x) => x.label).indexOf('Wrap & Emboss');
  assert.ok(embossStep >= 0);
  await editStep(embossStep, 'height', -0.5);
  near(canVol - (await volumeOf(can)), (0.6 / 2) * (100 - 9.5 ** 2) * 6);
  assert.equal((await steps()).at(-1).error, null);

  step('Sweep with a twist, changed later in History');
  await A(() => {
    const a = window.__shaper;
    const s = 4;
    a.cmd.addSketch({ origin: [40, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }, [
      { type: 'line', a: [-s, -s], b: [s, -s] },
      { type: 'line', a: [s, -s], b: [s, s] },
      { type: 'line', a: [s, s], b: [-s, s] },
      { type: 'line', a: [-s, s], b: [-s, -s] },
    ], { name: 'Profile' });
    a.cmd.addSketch({ origin: [40, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] }, [{ type: 'line', a: [0, 0], b: [0, 30] }], { name: 'Path' });
  });
  const [prof, path] = await A(() => window.__shaper.doc.sketches.slice(-2).map((s) => s.id));
  await win.waitForFunction((id) => window.__shaper.regionCache.get(id)?.data?.regions.length === 1, prof);
  const pathCurve = await A((id) => window.__shaper.doc.sketch(id).entities[0].id, path);
  await runTool('sweep', [[{ kind: 'region', sketchId: prof, index: 0 }], [{ kind: 'curve', sketchId: path, entityId: pathCurve }]], { twist: 90, endScale: 1 });
  const twisted = await A(() => window.__shaper.doc.bodies.at(-1).id);
  near(await volumeOf(twisted), 64 * 30, 64 * 30 * 0.02);
  assert.ok((await bodyBox(twisted)).max[0] > 40 + 4 * 1.3, 'the twisted middle sticks out');
  await shot(win, '94-sweep-twist');
  st = await steps();
  await editStep(st.length - 1, 'endScale', 0.5);
  const frustum = (30 * (64 + 16 + 32)) / 3;
  near(await volumeOf(twisted), frustum, frustum * 0.03);

  step('Move a box, then change how far it moved in History');
  const box = await addShape('box', { width: 10, depth: 10, height: 10 }, 'Box');
  await A((id) => {
    const a = window.__shaper;
    a.selection.set([{ kind: 'body', bodyId: id }]);
    a.tools.activate('move', { force: true });
    const t = a.tools.active;
    t.values.y = -30;
    t.toGizmo();
    t.apply();
  }, box);
  await idle();
  near((await bodyBox(box)).min[1], -35, 0.05);
  st = await steps();
  assert.equal(st.at(-1).label, 'Move');
  await editStep(st.length - 1, 'move.t.1', -50);
  near((await bodyBox(box)).min[1], -55, 0.05);

  step('Split with an offset plane, then move the cut in History');
  await runTool('split', [[{ kind: 'body', bodyId: box }], []], { plane: 'xy', offset: 3 });
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 4);
  st = await steps();
  await editStep(st.length - 1, 'planeRef.offset', 7);
  const halves = await A(async () => {
    const a = window.__shaper;
    const out = [];
    for (const b of a.doc.bodies.slice(-2)) out.push((await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] })).items[0].volume);
    return out.sort((x, y) => x - y);
  });
  near(halves[0], 300);
  near(halves[1], 700);

  step('folders: new folder from the selection, rename it, drag another body in');
  await A(() => window.__shaper.items.setTab('items'));
  await A((id) => window.__shaper.selection.set([{ kind: 'body', bodyId: id }]), can);
  await win.locator('.ih-btn[data-action="new-folder"]').click();
  const nameBox = win.locator('.folder-head .item-name input');
  await nameBox.fill('Cans');
  await nameBox.press('Enter');
  const folder = await A(() => window.__shaper.doc.folders[0]);
  assert.equal(folder.name, 'Cans');
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, can), folder.id);
  await win.locator('.item', { hasText: (await A((id) => window.__shaper.doc.body(id).name, twisted)) }).first().dragTo(win.locator('.folder-head'));
  await idle();
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, twisted), folder.id, 'dragging a row into a folder');
  assert.equal(await win.locator('.folder-items .item').count(), 2);
  await shot(win, '95-folders');

  step('hide and show a whole folder');
  await win.locator('.folder-head').hover();
  await win.locator('.folder-head .item-btn').first().click();
  assert.equal(await A((ids) => ids.every((id) => window.__shaper.doc.body(id).visible === false), [can, twisted]), true);
  await win.locator('.folder-head .item-btn').first().click();
  assert.equal(await A((ids) => ids.every((id) => window.__shaper.doc.body(id).visible !== false), [can, twisted]), true);

  step('folders inside folders: new folder inside, drag a body and a folder around');
  await win.locator('.folder-head').first().click({ button: 'right' });
  await win.locator('.menu button', { hasText: 'New folder inside' }).click();
  const subBox = win.locator('.folder-head .item-name input');
  await subBox.fill('Parts');
  await subBox.press('Enter');
  const sub = await A(() => window.__shaper.doc.folders.find((f) => f.name === 'Parts'));
  assert.equal(sub.parent, folder.id, 'the new folder is inside the first one');
  const half = await A(() => window.__shaper.doc.bodies.at(-1));
  await win.locator('.item', { hasText: half.name }).first().dragTo(win.locator(`.items-group.folder[data-folder="${sub.id}"] > .folder-head`));
  await idle();
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, half.id), sub.id);
  assert.equal(await win.locator(`.items-group.folder[data-folder="${folder.id}"] .items-group.folder[data-folder="${sub.id}"] .item`, { hasText: half.name }).count(), 1, 'shown nested');
  // A folder never goes inside itself or its own subfolder.
  assert.equal(await A(({ a, b }) => window.__shaper.cmd.moveToFolder([{ kind: 'folder', folderId: a }], b), { a: folder.id, b: sub.id }), false);
  // Drag the subfolder out to the top level, then back in.
  await win.locator(`.items-group.folder[data-folder="${sub.id}"] > .folder-head`).dragTo(win.locator('.items-group-head', { hasText: 'Bodies' }));
  await idle();
  assert.equal(await A((id) => window.__shaper.doc.folder(id).parent ?? null, sub.id), null);
  await win.locator(`.items-group.folder[data-folder="${sub.id}"] > .folder-head`).dragTo(win.locator(`.items-group.folder[data-folder="${folder.id}"] > .folder-head`));
  await idle();
  assert.equal(await A((id) => window.__shaper.doc.folder(id).parent, sub.id), folder.id);
  await shot(win, '96-nested-folders');
  // Hiding the outer folder hides what is in the inner one too.
  await A((id) => window.__shaper.cmd.setFolderVisible(id, false), folder.id);
  assert.equal(await A((id) => window.__shaper.doc.body(id).visible, half.id), false);
  await A((id) => window.__shaper.cmd.setFolderVisible(id, true), folder.id);
  // Deleting the outer folder (keeping its things) moves them up a level.
  await A((id) => window.__shaper.cmd.deleteFolder(id), folder.id);
  assert.equal(await A((id) => window.__shaper.doc.folder(id).parent ?? null, sub.id), null);
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder ?? null, can), null);
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, half.id), sub.id);
  await A(() => window.__shaper.cmd.undo());
  assert.equal(await A((id) => window.__shaper.doc.folder(id).parent, sub.id), folder.id);

  step('move a sketch in with the menu; folders are saved; rebuilt bodies stay in them');
  await A(
    ({ sk, f }) => window.__shaper.cmd.moveToFolder([{ kind: 'sketch', sketchId: sk }], f),
    { sk: labelSketch, f: folder.id },
  );
  await A(async () => {
    const a = window.__shaper;
    await a.files.loadProject(await a.files.serialize({ thumbnail: false }), null, 'Folders');
  });
  await idle();
  assert.equal(await A(() => window.__shaper.doc.folders.length), 2);
  assert.equal(await A((id) => window.__shaper.doc.folder(id).parent, sub.id), folder.id, 'nesting is saved');
  assert.equal(await A((id) => window.__shaper.doc.sketch(id).folder, labelSketch), folder.id);
  await editStep(0, 'params.height', 50);
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, can), folder.id, 'a rebuilt body keeps its folder');
  near((await bodyBox(can)).max[2], 50, 0.05);

  step('delete the folder but keep what is in it; undo brings it back');
  await A((id) => window.__shaper.cmd.deleteFolder(id), folder.id);
  assert.equal(await A(() => window.__shaper.doc.folders.length), 1);
  assert.equal(await A((id) => window.__shaper.doc.body(id)?.folder ?? null, can), null);
  await A(() => window.__shaper.cmd.undo());
  assert.equal(await A((id) => window.__shaper.doc.body(id).folder, can), folder.id);
  await A((id) => window.__shaper.cmd.deleteFolder(id, { contents: true }), folder.id);
  await idle();
  assert.equal(await A((ids) => ids.filter((id) => window.__shaper.doc.body(id)).length, [can, twisted, half.id]), 0, 'everything in it is deleted, nested too');
  assert.equal(await A(() => window.__shaper.doc.folders.length), 0);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\norganize: all steps passed');
} catch (err) {
  await shot(win, 'zz-organize-failure').catch(() => {});
  console.error('\norganize FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
