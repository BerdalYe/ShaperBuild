// End-to-end: 3-point rectangles, control-point splines, green fully
// defined curves, symmetry, sketch patterns, axes, more plane types,
// Translate, Rotate around axis, Align, grid patterns and stretching.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
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
const bbox = (id) => A((id) => window.__shaper.bodyMesh(id).bbox, id);
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
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = false;
    a.vp.setView('top');
  });
  await win.waitForTimeout(400);

  step('3-point rectangle: one side, then the height');
  await A(() => {
    const a = window.__shaper;
    a.settings.rectMode = 'three';
    a.tools.activate('rect');
  });
  await clickAt([0, 0, 0]);
  await clickAt([20, 10, 0]);
  await clickAt([10, 30, 0]);
  await idle();
  const rect = await A(() => {
    const sk = window.__shaper.doc.sketches.at(-1);
    return { n: sk.entities.length, types: sk.constraints.map((c) => c.type).sort() };
  });
  assert.equal(rect.n, 4);
  assert.deepEqual(rect.types, ['parallel', 'parallel', 'perpendicular']);
  await A(() => {
    window.__shaper.settings.rectMode = 'corner';
    window.__shaper.tools.activate('select');
  });

  step('control-point spline');
  await A(() => {
    const a = window.__shaper;
    a.settings.splineKind = 'control';
    a.tools.activate('spline');
  });
  for (const p of [[40, 0, 0], [50, 15, 0], [60, -10, 0], [70, 5, 0]]) await clickAt(p);
  await win.keyboard.press('Enter');
  await idle();
  const sp = await A(() => window.__shaper.doc.sketches.flatMap((s) => s.entities).find((e) => e.type === 'spline'));
  assert.equal(sp.control, true);
  assert.equal(sp.pts.length, 4);
  await A(() => {
    window.__shaper.settings.splineKind = 'fit';
    window.__shaper.tools.activate('select');
  });

  step('fully defined curves turn green');
  const lineSk = await A((XY) => window.__shaper.cmd.addSketch({ ...XY, origin: [0, -40, 0] }, [{ type: 'line', a: [0, 0], b: [10, 0] }]), XY);
  await A((sk) => {
    const a = window.__shaper;
    const en = a.doc.sketch(sk).entities[0];
    a.cmd.addConstraint(sk, [
      { type: 'horizontal', e: en.id },
      { type: 'fix', p: { e: en.id, p: 'a' }, value: [0, 0] },
      { type: 'length', e: en.id, value: 10 },
    ]);
  }, lineSk);
  await idle();
  assert.equal(await A((sk) => window.__shaper.vp.sketchViews.get(sk).defined.size, lineSk), 1);

  step('symmetric: two lines mirrored across the line picked last');
  const symSk = await A((XY) =>
    window.__shaper.cmd.addSketch({ ...XY, origin: [0, 60, 0] }, [
      { type: 'line', a: [-10, 0], b: [-4, 6] },
      { type: 'line', a: [9, 1], b: [5, 7] },
      { type: 'line', a: [0, -10], b: [0, 10] },
    ]), XY);
  const symmetric = await A((sk) => {
    const a = window.__shaper;
    const ents = a.doc.sketch(sk).entities;
    a.selection.set(ents.map((e) => ({ kind: 'curve', sketchId: sk, entityId: e.id })));
    const o = a.constraints.options().find((x) => x.label === 'Symmetric');
    if (!o) return null;
    a.constraints.apply(o);
    const [l1, l2, ax] = a.doc.sketch(sk).entities;
    return { l1, l2, ax, n: a.doc.sketch(sk).constraints.length };
  }, symSk);
  assert.ok(symmetric, 'Symmetric offered');
  assert.equal(symmetric.n, 2);
  // Mirror l1's ends across the (solved) mirror line: they land on l2's.
  const { l1, l2, ax } = symmetric;
  const mirror = (p) => {
    const d = [ax.b[0] - ax.a[0], ax.b[1] - ax.a[1]];
    const t = ((p[0] - ax.a[0]) * d[0] + (p[1] - ax.a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
    const f = [ax.a[0] + d[0] * t, ax.a[1] + d[1] * t];
    return [2 * f[0] - p[0], 2 * f[1] - p[1]];
  };
  for (const [p, q] of [[l1.a, l2.a], [l1.b, l2.b]]) {
    const m = mirror(p);
    near(m[0], q[0], 1e-4);
    near(m[1], q[1], 1e-4);
  }

  step('sketch pattern: three circles in a row');
  const circSk = await A((XY) => window.__shaper.cmd.addSketch({ ...XY, origin: [0, 100, 0] }, [{ type: 'circle', c: [0, 0], r: 2 }]), XY);
  await A((sk) => {
    const a = window.__shaper;
    a.selection.set([{ kind: 'curve', sketchId: sk, entityId: a.doc.sketch(sk).entities[0].id }]);
    a.settings.sketchPattern = { kind: 'linear', count: 3, mode: 'spacing', distance: 10, angle: 0, count2: 1 };
    a.tools.activate('sketchPattern');
  }, circSk);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  const centers = await A((sk) => window.__shaper.doc.sketch(sk).entities.map((e) => e.c[0]).sort((x, y) => x - y), circSk);
  assert.deepEqual(centers, [0, 10, 20]);

  step('an axis standing on a face, then revolving around it');
  await A(() => window.__shaper.vp.setView('iso'));
  const box = await addShape('box', { width: 20, depth: 20, height: 10 });
  const topFace = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.9), box);
  await A(
    ({ box, topFace }) => {
      const a = window.__shaper;
      a.tools.activate('axis');
      const t = a.tools.active;
      t.values.type = 'normal';
      t.refs = [{ hit: { kind: 'face', bodyId: box, index: topFace }, point: [0, 0, 10] }];
      t.render();
      t.update();
    },
    { box, topFace },
  );
  await win.locator('#tool-panel .btn.primary').click();
  const axis = await A(() => window.__shaper.doc.axes[0]);
  near(axis.dir[2], 1, 1e-6);
  near(axis.origin[0], 0, 1e-6);
  assert.ok(await A(() => window.__shaper.items.el.textContent.includes('Axis 1')));
  const prof = await A((XY) =>
    window.__shaper.cmd.addSketch({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] }, [
      { type: 'line', a: [30, 0], b: [34, 0] },
      { type: 'line', a: [34, 0], b: [34, 4] },
      { type: 'line', a: [34, 4], b: [30, 4] },
      { type: 'line', a: [30, 4], b: [30, 0] },
    ]), XY);
  await win.waitForFunction((id) => window.__shaper.regionCache.get(id)?.data?.regions.length === 1, prof);
  const before = await A(() => window.__shaper.doc.bodies.length);
  await runTool('revolve', [[{ kind: 'region', sketchId: prof, index: 0 }], [{ kind: 'axis', axisId: axis.id }]], { angle: 360, mode: 'new' });
  assert.equal(await A(() => window.__shaper.doc.bodies.length), before + 1);
  const ring = await A(() => window.__shaper.doc.bodies.at(-1).id);
  near((await bbox(ring)).max[0], 34, 0.05);
  await shot(win, 'construct-01-axis');

  step('midplane between the top and bottom of the box');
  const bottom = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] < -0.9), box);
  await A(
    ({ box, topFace, bottom }) => {
      const a = window.__shaper;
      a.tools.activate('plane');
      const t = a.tools.active;
      t.values.type = 'mid';
      t.refs = [{ hit: { kind: 'face', bodyId: box, index: topFace } }, { hit: { kind: 'face', bodyId: box, index: bottom } }];
      t.render();
      t.update();
    },
    { box, topFace, bottom },
  );
  await win.locator('#tool-panel .btn.primary').click();
  near((await A(() => window.__shaper.doc.planes.at(-1).plane.origin))[2], 5, 1e-6);

  step('Translate from one corner to a point; Rotate around the axis');
  await A((id) => window.__shaper.cmd.deleteItems([{ kind: 'body', bodyId: id }]), ring);
  await idle();
  await runTool('translate', [[{ kind: 'body', bodyId: box }], [{ kind: 'vertex', bodyId: box, index: 0, at: [-10, -10, 0] }], [{ kind: 'vertex', bodyId: box, index: 0, at: [0, 0, 0] }]]);
  let bb = await bbox(box);
  near(bb.min[0], 0, 1e-4);
  near(bb.min[1], 0, 1e-4);
  await runTool('rotateAxis', [[{ kind: 'body', bodyId: box }], [{ kind: 'axis', axisId: axis.id }]], { angle: 90 });
  bb = await bbox(box);
  near(bb.max[0], 0, 1e-4);
  near(bb.min[0], -20, 1e-4);
  assert.equal(await A(() => window.__shaper.history.features.at(-1).calls[0].args.turn.angle), 90);

  step('Align one box onto the top of another');
  const small = await addShape('box', { width: 4, depth: 4, height: 4 });
  const smallBottom = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] < -0.9), small);
  const boxTop = await A((id) => window.__shaper.bodyMesh(id).faceInfo.findIndex((f) => f.type === 'plane' && f.normal[2] > 0.9), box);
  await runTool('align', [[{ kind: 'face', bodyId: small, index: smallBottom }], [{ kind: 'face', bodyId: box, index: boxTop }]]);
  const sb = await bbox(small);
  near(sb.min[2], 10, 1e-4);
  near((sb.min[0] + sb.max[0]) / 2, -10, 1e-4);

  step('a pattern in two directions; stretching a solid is refused');
  const n0 = await A(() => window.__shaper.doc.bodies.length);
  await runTool('patternLinear', [[{ kind: 'body', bodyId: small }]], { axis: 'x', count: 3, spacing: 10, dir2: 'y', count2: 2, spacing2: 10 });
  assert.equal(await A(() => window.__shaper.doc.bodies.length), n0 + 5);
  await A((id) => {
    const a = window.__shaper;
    a.tools.activate('scale', { force: true });
    const t = a.tools.active;
    t.slots[0].items = [{ kind: 'body', bodyId: id }];
    Object.assign(t.values, { type: 'stretch', fx: 1, fy: 1, fz: 2 });
    t.render();
    t.schedule();
  }, small);
  await idle();
  await win.waitForTimeout(300);
  assert.match(await A(() => window.__shaper.tools.active.error || ''), /meshes only/);
  await win.keyboard.press('Escape');
  await shot(win, 'construct-02-done');

  assert.deepEqual(errors, []);
  console.log('construct: all steps passed');
} catch (err) {
  console.error('construct FAILED:', err.message, errors);
  await shot(win, 'construct-zz-failed').catch(() => {});
  process.exitCode = 1;
} finally {
  await close();
}
