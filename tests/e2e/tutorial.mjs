// End-to-end: first launch offers the tutorial, and every step of it can be
// completed with real mouse and keyboard input. Also covers tool search,
// keyboard navigation and the navigation help card.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch({ tutorial: true });
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
  await win.mouse.move(x, y, { steps: 3 });
  await win.waitForTimeout(40);
  await win.mouse.click(x, y);
  await win.waitForTimeout(120);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(150);
}
const title = () => win.locator('.tut-card .tut-title').innerText();
async function expectStep(text) {
  await win.waitForFunction((t) => document.querySelector('.tut-card .tut-title')?.textContent === t, text, { timeout: 15000 });
}
async function drag(button, from, to, opts = {}) {
  await win.mouse.move(from[0], from[1]);
  if (opts.key) await win.keyboard.down(opts.key);
  await win.mouse.down({ button });
  await win.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
  await win.mouse.move(to[0], to[1], { steps: 6 });
  await win.mouse.up({ button });
  if (opts.key) await win.keyboard.up(opts.key);
}

try {
  step('first launch shows the welcome dialog');
  await win.waitForSelector('.modal', { timeout: 20000 });
  assert.match(await win.locator('.modal').innerText(), /Welcome to ShaperBuild/);
  await shot(win, '60-welcome');
  await win.locator('.modal .btn.primary', { hasText: 'Start the tutorial' }).click();
  await win.waitForSelector('.tut-card');
  assert.equal(await A(() => localStorage.getItem('shaperbuild.tutorialSeen.v1')), '1');
  await win.locator('.tut-card .btn.primary').click();

  const vp = await A(() => {
    const r = document.getElementById('viewport').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  step('orbit with the right button');
  await expectStep('Orbit: turn the view');
  await shot(win, '61-tutorial-orbit');
  await drag('right', [vp.x, vp.y], [vp.x + 160, vp.y + 40]);
  await expectStep('Pan: slide the view');

  step('pan with the middle button');
  await drag('middle', [vp.x, vp.y], [vp.x - 120, vp.y + 30]);
  await expectStep('Zoom: get closer');

  step('zoom with the wheel');
  await win.mouse.move(vp.x, vp.y);
  for (let i = 0; i < 4; i++) {
    await win.mouse.wheel(0, -120);
    await win.waitForTimeout(60);
  }
  await expectStep('Your view controls');
  await shot(win, '62-tutorial-view-controls');
  await win.locator('.tut-card .btn.primary').click();
  await expectStep('All tools are on the right');
  await win.locator('.tut-card .btn.primary').click();

  step('pick the rectangle tool and draw');
  await expectStep('Pick the Rectangle tool');
  await shot(win, '63-tutorial-rect');
  await win.locator('#tools .tool-btn[data-tool="rect"]').click();
  await expectStep('Draw a rectangle');
  await A(() => {
    // Known view so the clicks land on the grid.
    window.__shaper.vp.rig.fromJSON({ az: 0.5, el: 0.55, dist: 200, target: [0, 0, 0], ortho: false });
    window.__shaper.vp.requestRender();
  });
  await win.waitForTimeout(200);
  await clickAt([-20, -15, 0]);
  await clickAt([20, 15, 0]);
  await expectStep('Finish the sketch');
  await win.keyboard.press('Escape');
  await expectStep('Select the shape');
  await win.waitForFunction(() => window.__shaper.regionCache.get('s1')?.data?.regions.length === 1);
  await clickAt([0, 0, 0]);
  await expectStep('Extrude it');
  await shot(win, '64-tutorial-extrude');
  await win.locator('#context-bar .cb-btn', { hasText: 'Extrude' }).click();
  await expectStep('Pull it up');
  // Typing goes straight into the distance field.
  await win.keyboard.type('20');
  await win.waitForTimeout(400);
  await idle();
  await win.keyboard.press('Enter');
  await idle();
  await expectStep('Select an edge');
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 1);

  step('select a top edge and fillet it');
  await clickAt([20, 0, 20]);
  await expectStep('Round it with Fillet');
  await win.locator('#context-bar .cb-btn', { hasText: 'Fillet' }).click();
  await expectStep('Set the radius');
  await win.keyboard.type('3');
  await win.waitForTimeout(400);
  await idle();
  await win.keyboard.press('Enter');
  await idle();
  await expectStep('Everything you made');
  await shot(win, '65-tutorial-items');
  await win.locator('.tut-card .btn.primary').click();
  await expectStep('Ready to print');
  await win.locator('.tut-card .btn.primary').click();
  await expectStep('You’re ready!');
  await win.locator('.tut-card .btn.primary', { hasText: 'Finish' }).click();
  await win.waitForFunction(() => !document.querySelector('.tut-card'));
  assert.equal(await A(() => window.__shaper.tutorial.active), false);
  const vol = await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.bodies[0].shapeId }] });
    return r.items[0].volume;
  });
  assert.ok(vol < 40 * 30 * 20 - 1 && vol > 40 * 30 * 20 - 200, `filleted volume ${vol}`);

  step('search finds tools and commands');
  await win.keyboard.press('Control+k');
  assert.equal(await A(() => document.activeElement?.classList.contains('ts-input')), true);
  await win.keyboard.type('round');
  await win.waitForTimeout(100);
  assert.equal((await win.locator('.ts-row').first().innerText()).split('\n')[0], 'Fillet');
  await shot(win, '66-search');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Control+k');
  await win.keyboard.type('top view');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(600);
  const el = await A(() => window.__shaper.vp.rig.el);
  assert.ok(Math.abs(el - Math.PI / 2) < 0.01, `top view elevation ${el}`);

  step('keyboard orbit, pan and zoom');
  await A(() => document.getElementById('viewport').querySelector('canvas').focus());
  const before = await A(() => window.__shaper.vp.rig.toJSON());
  await win.keyboard.press('ArrowLeft');
  await win.keyboard.press('Shift+ArrowUp');
  await win.keyboard.press('Equal');
  await win.waitForTimeout(500);
  const after = await A(() => window.__shaper.vp.rig.toJSON());
  assert.ok(Math.abs(after.az - before.az) > 0.2, 'arrow orbits');
  assert.ok(after.dist < before.dist, '+ zooms in');

  step('orbit mode drags with the left button; Esc leaves it');
  await win.locator('[data-vc="orbit"]').click();
  assert.equal(await A(() => window.__shaper.vp.navMode), 'orbit');
  const az0 = await A(() => window.__shaper.vp.rig.az);
  await drag('left', [vp.x - 200, vp.y + 150], [vp.x - 40, vp.y + 150]);
  assert.ok(Math.abs((await A(() => window.__shaper.vp.rig.az)) - az0) > 0.3, 'left-drag orbits in orbit mode');
  assert.equal(await A(() => window.__shaper.selection.size), 0, 'no selection while orbiting');
  await win.keyboard.press('Escape');
  assert.equal(await A(() => window.__shaper.vp.navMode), null);

  step('hold Space and drag to orbit');
  const az1 = await A(() => window.__shaper.vp.rig.az);
  await drag('left', [vp.x - 200, vp.y + 150], [vp.x - 60, vp.y + 150], { key: 'Space' });
  assert.ok(Math.abs((await A(() => window.__shaper.vp.rig.az)) - az1) > 0.3, 'space-drag orbits');

  step('navigation help card');
  await win.locator('[data-vc="help"]').click();
  await win.waitForSelector('.nav-help');
  await shot(win, '67-nav-help');
  await win.keyboard.press('Escape');
  assert.equal(await win.locator('.nav-help').count(), 0);

  step('items panel: hide a whole group, then show all');
  await win.locator('.items-group-head', { hasText: 'Bodies' }).hover();
  await win.locator('.items-group-head', { hasText: 'Bodies' }).locator('.item-btn').click();
  assert.equal(await A(() => window.__shaper.doc.bodies[0].visible), false);
  await win.locator('.items-head .ih-btn[title="Show all items"]').click();
  assert.equal(await A(() => window.__shaper.doc.bodies[0].visible), true);

  step('X-ray makes bodies see-through');
  await A(() => document.getElementById('viewport').querySelector('canvas').focus());
  await win.keyboard.press('Shift+X');
  assert.equal(await A(() => window.__shaper.vp.xray), true);
  assert.equal(await A(() => [...window.__shaper.vp.bodyViews.values()][0].material.transparent), true);
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(500);
  await shot(win, '68-xray');
  await win.locator('[data-vc="xray"]').click();
  assert.equal(await A(() => window.__shaper.vp.xray), false);

  step('tutorial is not offered again');
  assert.equal(await A(() => window.__shaper.tutorial.seen), true);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\ntutorial: all steps passed');
} catch (err) {
  await shot(win, 'zz-tutorial-failure').catch(() => {});
  console.error('\ntutorial FAILED:', err.stack || err.message);
  console.error('current step:', await title().catch(() => '?'));
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
