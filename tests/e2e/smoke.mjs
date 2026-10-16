// Starts the app, checks the geometry engine works and takes screenshots.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
try {
  await win.waitForTimeout(600);
  await shot(win, '01-home');
  await win.evaluate(() => window.__shaper.home.hide());
  const vol = await win.evaluate(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'sphere', params: { radius: 10 } });
    a.cmd.applyResult('Sphere', r);
    const m = await a.kernel.call('measure', { items: [{ kind: 'body', id: r.bodies[0].id }] });
    return m.items[0].volume;
  });
  assert.ok(Math.abs(vol - (4 / 3) * Math.PI * 1000) < 1);
  await win.evaluate(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '02-sphere');
  assert.deepEqual(errors, []);
  console.log('smoke: passed');
} catch (err) {
  console.error('smoke FAILED:', err.message, errors);
  process.exitCode = 1;
} finally {
  await close();
}
