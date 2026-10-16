// End-to-end: more 3D tool options (taper, start offset, up to a face,
// two-distance chamfer, keep originals), History rollback, renaming and
// merging, display modes, isolate, saved views and pinned measurements.
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
  await win.waitForTimeout(150);
}
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
async function addShape(type, params) {
  await A(
    async ({ type, params }) => {
      const a = window.__shaper;
      a.cmd.applyResult('Shape', await a.kernel.call('primitive', { type, params }));
    },
    { type, params },
  );
  await idle();
  return A(() => window.__shaper.doc.bodies.at(-1).id);
}
const volumeOf = (id) =>
  A(async (id) => {
    const a = window.__shaper;
    return (await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.body(id).shapeId }] })).items[0].volume;
  }, id);
const bbox = (id) => A((id) => window.__shaper.bodyMesh(id).bbox, id);
const steps = () => A(() => window.__shaper.history.features.map((f) => ({ label: f.label, name: f.name || null, back: !!f.rolledBack, error: f.error || null })));
// Run an OpTool with its slots and values filled in, then press Done.
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

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = false;
    a.vp.setView('top');
  });
  await win.waitForTimeout(400);

  step('extrude with a taper and a start offset');
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
  const corners = [[-20, -15], [20, -15], [20, 15], [-20, 15]];
  await A(({ XY, corners }) => window.__shaper.cmd.addSketch(XY, corners.map((a, i) => ({ type: 'line', a, b: corners[(i + 1) % 4] }))), { XY, corners });
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  const region = { kind: 'region', sketchId: 's1', index: 0 };
  await runTool('extrude', [[region]], { distance: 20, taper: 10, start: 5 });
  const tapered = await A(() => window.__shaper.doc.bodies.at(-1).id);
  const bb = await bbox(tapered);
  near(bb.min[2], 5, 1e-3);
  near(bb.max[2], 25, 1e-3);
  // A prismatoid: the sides lean in by 20·tan(10°) on every edge.
  const k = 20 * Math.tan((10 * Math.PI) / 180);
  const area = (w, d) => w * d;
  const expect = (20 / 6) * (area(40, 30) + 4 * area(40 - k, 30 - k) + area(40 - 2 * k, 30 - 2 * k));
  near(await volumeOf(tapered), expect, 1);
  const ext = await A(() => window.__shaper.history.features.at(-1));
  assert.equal(ext.calls[0].args.taper, 10);
  assert.equal(ext.calls[0].args.start, 5);

  step('the taper can be changed in History');
  await A(() => {
    const a = window.__shaper;
    a.items.setTab('history');
    a.items.historyList.open = null;
    a.items.render();
  });
  await win.locator('.step', { hasText: 'Extrude' }).first().click();
  const taperInp = win.locator('.step-edit .num-input[data-key="taper"]');
  await taperInp.fill('0');
  await taperInp.press('Enter');
  await idle();
  near(await volumeOf(tapered), 40 * 30 * 20, 1);

  step('extrude up to a plane');
  const planeId = await A(() => window.__shaper.cmd.addPlane({ origin: [0, 0, 60], normal: [0, 0, 1], xDir: [1, 0, 0] }));
  await runTool('extrude', [[region], [{ kind: 'plane', planeId }]], { mode: 'new' });
  const tall = await A(() => window.__shaper.doc.bodies.at(-1).id);
  near((await bbox(tall)).max[2], 60, 1e-3);
  near((await bbox(tall)).min[2], 0, 1e-3);

  step('chamfer with two distances');
  const box = await addShape('box', { width: 20, depth: 20, height: 10 });
  const edge = await A((id) => window.__shaper.bodyMesh(id).edgeInfo.findIndex((e) => e.type === 'line' && e.a[2] > 9 && e.b[2] > 9 && Math.abs(e.a[1] - e.b[1]) < 1e-6), box);
  assert.ok(edge >= 0);
  const before = await volumeOf(box);
  await runTool('chamfer', [[{ kind: 'edge', bodyId: box, index: edge }]], { distance: 2, two: true, distance2: 4 });
  near(before - (await volumeOf(box)), 0.5 * 2 * 4 * 20, 0.01);
  assert.equal(await A(() => window.__shaper.history.features.at(-1).calls[0].args.distance2), 4);

  step('union that keeps the originals');
  const other = await addShape('box', { width: 10, depth: 10, height: 30 });
  const count = await A(() => window.__shaper.doc.bodies.length);
  await runTool('union', [[{ kind: 'body', bodyId: box }, { kind: 'body', bodyId: other }]], { keepTargets: true });
  assert.equal(await A(() => window.__shaper.doc.bodies.length), count + 1);
  assert.ok(await A(({ box, other }) => !!window.__shaper.doc.body(box) && !!window.__shaper.doc.body(other), { box, other }));

  step('roll back the history, add a step there, roll forward');
  const all = await steps();
  const n = all.length;
  const unionId = await A(() => window.__shaper.history.features.at(-1).id);
  const chamferStep = await A(() => window.__shaper.history.features.at(-3).id);
  await A((id) => window.__shaper.history.rollTo(id), chamferStep);
  await idle();
  let now = await steps();
  assert.deepEqual(now.map((s) => s.back), [...Array(n - 2).fill(false), true, true]);
  assert.equal(await A(() => window.__shaper.doc.bodies.length), count - 1, 'the second box and the union are gone');
  await win.waitForSelector('.rollback-bar');
  await shot(win, 'b3-rollback');
  // A new step goes in at the bar.
  await addShape('sphere', { radius: 3 });
  now = await steps();
  assert.equal(now.length, n + 1);
  assert.equal(now[n - 2].back, false);
  assert.deepEqual(now.slice(n - 1).map((s) => s.back), [true, true]);
  await A(() => window.__shaper.history.rollTo(null));
  await idle();
  assert.ok((await steps()).every((s) => !s.back && !s.error));
  assert.equal(await A(() => window.__shaper.doc.bodies.length), count + 2);
  assert.equal(await A(() => window.__shaper.history.features.at(-1).id), unionId);

  step('rename a step');
  await A(() => window.__shaper.items.render());
  await win.locator('.step').last().locator('.item-name').dblclick();
  const nameInp = win.locator('.step-name-input');
  await nameInp.fill('Join the boxes');
  await nameInp.press('Enter');
  await idle();
  assert.equal(await A(() => window.__shaper.history.features.at(-1).name), 'Join the boxes');
  assert.match(await win.locator('.step').last().innerText(), /Join the boxes/);

  step('display: wireframe, zebra and hidden edges');
  await A(() => window.__shaper.vp.setView('iso', { fit: true }));
  await A(() => window.__shaper.setDisplay('wireframe'));
  assert.equal(await A((id) => window.__shaper.vp.bodyViews.get(id).mesh.visible, box), false);
  await A(() => window.__shaper.setDisplay('zebra', { hiddenEdges: true }));
  await win.waitForTimeout(200);
  const z = await A((id) => {
    const v = window.__shaper.vp.bodyViews.get(id);
    return { shader: v.mesh.material.type, hidden: !!v.hiddenEdges?.visible };
  }, box);
  assert.equal(z.shader, 'ShaderMaterial');
  assert.ok(z.hidden);
  assert.ok(await A(() => document.querySelector('[data-vc="display"]').classList.contains('on')));
  await shot(win, 'b3-zebra');
  await A(() => window.__shaper.setDisplay('shaded', { hiddenEdges: false }));
  assert.equal(await A((id) => window.__shaper.vp.bodyViews.get(id).mesh.material.type !== 'ShaderMaterial', box), true);

  step('isolate the selection');
  await A((id) => window.__shaper.selection.set([{ kind: 'body', bodyId: id }]), other);
  await win.keyboard.press('Shift+I');
  await win.waitForTimeout(200);
  const iso = await A((other) => {
    const a = window.__shaper;
    return { shown: [...a.vp.bodyViews].filter(([, v]) => v.group.visible).map(([id]) => id), bar: !document.getElementById('isolate-bar').hidden, plane: a.vp.planeViews.get('p1')?.group.visible, other };
  }, other);
  assert.deepEqual(iso.shown, [other]);
  assert.ok(iso.bar);
  assert.equal(iso.plane, false);
  // History lists only the steps of the isolated body.
  assert.ok((await win.locator('.step').count()) < (await steps()).length);
  await shot(win, 'b3-isolate');
  await win.locator('#isolate-show-all').click();
  await win.waitForTimeout(200);
  assert.equal(await A(() => [...window.__shaper.vp.bodyViews.values()].every((v) => v.group.visible)), true);
  assert.equal(await A(() => document.getElementById('isolate-bar').hidden), true);

  step('save a view and go back to it');
  await A(() => window.__shaper.vp.setView('front'));
  await win.waitForFunction(() => !window.__shaper.vp.rig.anim);
  const saved = await A(() => window.__shaper.vp.rig.toJSON());
  await win.locator('[data-vc="views"]').click();
  await win.locator('.menu button', { hasText: 'Save this view' }).click();
  await win.locator('.modal input').fill('Front check');
  await win.locator('.modal .btn.primary').click();
  await win.waitForTimeout(100);
  assert.deepEqual(await A(() => window.__shaper.doc.state.views.map((v) => v.name)), ['Front check']);
  await A(() => window.__shaper.vp.setView('top'));
  await win.waitForFunction(() => !window.__shaper.vp.rig.anim);
  await win.locator('[data-vc="views"]').click();
  await win.locator('.menu .saved-view', { hasText: 'Front check' }).click();
  await win.waitForFunction(() => !window.__shaper.vp.rig.anim);
  const back = await A(() => window.__shaper.vp.rig.toJSON());
  near(back.az, saved.az, 1e-6);
  near(back.el, saved.el, 1e-6);
  await win.locator('[data-vc="views"]').click();
  await win.locator('.menu .saved-view-row .icon-btn').click();
  assert.equal(await A(() => window.__shaper.doc.state.views.length), 0);
  await A(() => window.__shaper.doc.undo());
  assert.equal(await A(() => window.__shaper.doc.state.views.length), 1, 'deleting a view can be undone');

  step('pin a measurement');
  await A(() => window.__shaper.vp.setView('iso', { fit: true }));
  await A(
    ({ box }) => {
      const a = window.__shaper;
      const m = a.bodyMesh(box);
      const e = m.edgeInfo.find((x) => x.type === 'line');
      a.selection.set([{ kind: 'edge', bodyId: box, index: m.edgeInfo.indexOf(e) }]);
      a.tools.activate('measure', { force: true });
      const t = a.tools.active;
      t.items = [
        { kind: 'vertex', bodyId: box, point: [-10, -10, 0] },
        { kind: 'vertex', bodyId: box, point: [10, -10, 0] },
      ];
      t.measure();
    },
    { box },
  );
  await win.waitForSelector('#tool-panel .btn:has-text("Pin")');
  await win.locator('#tool-panel .btn', { hasText: 'Pin' }).click();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(150);
  assert.equal(await A(() => window.__shaper.tools.activeId), 'select');
  assert.equal(await A(() => window.__shaper.vp.overlay.labels.has('pin-label-0')), true, 'the pin stays after the tool closes');
  await shot(win, 'b3-pin');
  await A(() => window.__shaper.clearPins());
  assert.equal(await A(() => window.__shaper.vp.overlay.labels.has('pin-label-0')), false);

  step('invert visibility');
  const visBefore = await A(() => window.__shaper.doc.bodies.filter((b) => b.visible !== false).length);
  await A(() => window.__shaper.items.setTab('items'));
  await win.locator('[data-action="invert-visibility"]').click();
  assert.equal(await A(() => window.__shaper.doc.bodies.filter((b) => b.visible !== false).length), 0);
  await win.locator('[data-action="invert-visibility"]').click();
  assert.equal(await A(() => window.__shaper.doc.bodies.filter((b) => b.visible !== false).length), visBefore);

  step('merge the history into one step');
  const vols = await A(async () => {
    const a = window.__shaper;
    const out = [];
    for (const b of a.doc.bodies) out.push((await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] })).items[0].volume);
    return out;
  });
  await A(() => window.__shaper.items.setTab('history'));
  await win.locator('.steps-head .item-btn[title="More"]').click();
  await win.locator('.menu button', { hasText: 'Merge history' }).click();
  await win.locator('.modal .btn.primary').click();
  await idle();
  const merged = await steps();
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, 'Design');
  const after = await A(async () => {
    const a = window.__shaper;
    const out = [];
    for (const b of a.doc.bodies) out.push((await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] })).items[0].volume);
    return out;
  });
  assert.deepEqual(after.map((v) => Math.round(v)), vols.map((v) => Math.round(v)));

  assert.deepEqual(errors, []);
  console.log('modes: all steps passed');
} catch (err) {
  console.error(err);
  await shot(win, 'b3-failure').catch(() => {});
  console.error('console errors:', errors);
  await close();
  process.exit(1);
}
await close();
