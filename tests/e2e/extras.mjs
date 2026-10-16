// End-to-end: project edges, draft, autosave + recovery, window state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, waitForReady, OUT } from './harness.mjs';

const step = (msg) => console.log(`• ${msg}`);
const profile = fs.mkdtempSync(path.join(OUT, 'profile-extras-'));
let { win, errors, close, app } = await launch({ userData: profile });
const A = (fn, arg) => win.evaluate(fn, arg);
const idle = async () => {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(150);
};

try {
  await A(() => window.__shaper.home.hide());
  await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'cylinder', params: { radius: 10, height: 20 } });
    a.cmd.applyResult('Cylinder', r);
    const b = await a.kernel.call('primitive', { type: 'box', params: { width: 20, depth: 20, height: 10 }, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 0, 0, 1] });
    a.cmd.applyResult('Box', b);
    a.vp.fit();
  });
  await idle();

  step('project the cylinder top edge (a circle) and a box edge onto the ground');
  const sel = await A(() => {
    const a = window.__shaper;
    const [cyl, box] = a.doc.bodies;
    const ce = a.bodyMesh(cyl.id).edgeInfo.findIndex((e) => e.type === 'circle' && e.center[2] > 19);
    const be = a.bodyMesh(box.id).edgeInfo.findIndex((e) => e.type === 'line' && e.a[2] > 9 && e.b[2] > 9);
    a.selection.set([
      { kind: 'edge', bodyId: cyl.id, index: ce, shapeId: cyl.shapeId },
      { kind: 'edge', bodyId: box.id, index: be, shapeId: box.shapeId },
    ]);
    a.tools.activate('project');
    return [ce, be];
  });
  assert.ok(sel.every((i) => i >= 0));
  await win.waitForTimeout(200);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  const sk = await A(() => JSON.parse(JSON.stringify(window.__shaper.doc.sketches.at(-1))));
  assert.deepEqual(sk.entities.map((e) => e.type).sort(), ['circle', 'line']);
  const circle = sk.entities.find((e) => e.type === 'circle');
  assert.ok(Math.abs(circle.r - 10) < 1e-6 && Math.abs(circle.c[0]) < 1e-6);
  assert.deepEqual(sk.plane.normal, [0, 0, 1]);

  step('draft the four sides of the box by 5°');
  await A(() => {
    const a = window.__shaper;
    const box = a.doc.bodies[1];
    const sides = a.bodyMesh(box.id).faceInfo.map((f, i) => ({ f, i })).filter(({ f }) => f.type === 'plane' && Math.abs(f.normal[2]) < 0.01);
    a.selection.set(sides.map(({ i }) => ({ kind: 'face', bodyId: box.id, index: i, shapeId: box.shapeId })));
    a.tools.activate('draft');
  });
  await idle();
  await win.waitForTimeout(300);
  await win.locator('#tool-panel .btn.primary').click();
  await idle();
  const v = await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.bodies[1].shapeId }] });
    return r.items[0].volume;
  });
  assert.ok(v < 4000 && v > 3000, `draft volume ${v}`);
  await shot(win, '50-project-draft');

  step('autosave writes a recovery copy; a crash offers to restore it');
  await A(() => window.__shaper.files.autosave());
  assert.ok(fs.existsSync(path.join(profile, 'recovery.shaperbuild')));
  // Simulate a crash: kill the process without closing the window.
  app.process().kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 1500));
  // The app reports ready only after the recovery question is answered.
  ({ win, errors, close, app } = await launch({ userData: profile, waitReady: false }));
  await win.waitForSelector('.modal', { timeout: 90000 });
  assert.match(await win.locator('.modal').innerText(), /Recover unsaved work/);
  await win.locator('.modal .btn.primary').click();
  await waitForReady(win);
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 2, null, { timeout: 60000 });
  assert.equal(await A(() => window.__shaper.doc.dirty), true);
  assert.ok(!fs.existsSync(path.join(profile, 'recovery.shaperbuild')), 'recovery copy is removed once restored');

  step('window size is remembered');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 30, y: 40, width: 1200, height: 760 }));
  await new Promise((r) => setTimeout(r, 800));
  await close();
  ({ win, errors, close, app } = await launch({ userData: profile }));
  const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(b.width, 1200);
  assert.equal(b.height, 760);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nextras: all steps passed');
} catch (err) {
  await shot(win, 'zz-extras-failure').catch(() => {});
  console.error('\nextras FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
