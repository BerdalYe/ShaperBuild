// End-to-end: every tutorial lesson can be followed to the end with real
// mouse and keyboard input, and the home screen lists them.
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
async function clickAt(p, opts = {}) {
  const [x, y] = await screen(p);
  await win.mouse.move(x, y, { steps: 3 });
  await win.waitForTimeout(60);
  if (opts.double) await win.mouse.dblclick(x, y);
  else await win.mouse.click(x, y);
  await win.waitForTimeout(150);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(200);
}
const title = () => win.locator('.tut-card .tut-title').innerText();
async function expectStep(text) {
  await win.waitForFunction((t) => document.querySelector('.tut-card .tut-title')?.textContent === t, text, { timeout: 20000 });
}
const next = () => win.locator('.tut-card .tut-buttons .btn.primary').click();
// Type into a tool panel field; Enter applies the tool.
async function field(key, value, enter = false) {
  const inp = win.locator(`#tool-panel .num-input[data-key="${key}"]`);
  await inp.fill(String(value));
  await win.waitForTimeout(300);
  await idle();
  if (enter) {
    await inp.press('Enter');
    await idle();
  }
}
async function typeAndEnter(text) {
  await win.keyboard.type(text);
  await win.waitForTimeout(400);
  await idle();
  await win.keyboard.press('Enter');
  await idle();
}
const ctx = (label) => win.locator('#context-bar .cb-btn', { hasText: label }).first().click();
async function view() {
  await A(() => {
    window.__shaper.vp.rig.fromJSON({ az: 0.5, el: 0.6, dist: 260, target: [0, 0, 0], ortho: false });
    window.__shaper.vp.requestRender();
  });
  await win.waitForTimeout(250);
}
async function start(id) {
  await A(() => window.__shaper.files.reset());
  await A((id) => window.__shaper.tutorial.start(id), id);
  await win.waitForSelector('.tut-card');
  await idle();
  await win.waitForFunction(() => {
    const a = window.__shaper;
    return a.pendingMeshes.size === 0 && a.doc.bodies.every((b) => a.vp.bodyViews.has(b.id));
  });
  await view();
  await win.waitForTimeout(300);
}
async function finish(id) {
  await win.locator('.tut-card .btn.primary', { hasText: 'Finish' }).click();
  await win.waitForFunction(() => !document.querySelector('.tut-card'));
  assert.ok(await A((id) => window.__shaper.tutorial.done.has(id), id), `${id} marked done`);
}
// A point of the last sketch, in the world.
const toWorld = (p) =>
  A(async (p) => {
    const { planeFrame, to3D } = await import('/src/core/plane.js');
    return to3D(planeFrame(window.__shaper.doc.sketches.at(-1).plane), p);
  }, p);
const vol = (i = 0) =>
  A(async (i) => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.bodies[i].shapeId }] });
    return r.items[0].volume;
  }, i);

try {
  await A(() => {
    window.__shaper.settings.snap = true;
  });

  step('home lists every tutorial and the next one to do');
  await win.waitForSelector('.home-lesson');
  const lessonCount = await A(() => document.querySelectorAll('.home-lesson').length);
  assert.ok(lessonCount >= 12, `${lessonCount} lessons on the home screen`);
  assert.match(await win.locator('.home-next').innerText(), /The basics/);
  await shot(win, '70-home');

  step('the tutorials list opens from the home screen');
  await win.locator('.hn-all').click();
  await win.waitForSelector('.lessons-modal .lesson');
  await shot(win, '71-tutorials');
  await win.locator('.lessons-modal .btn', { hasText: 'Close' }).click();
  await win.waitForFunction(() => !document.querySelector('.lessons-modal'));

  step('lesson: shapes, moving and cutting');
  await start('shapes');
  await next();
  await expectStep('Pick the Box');
  await win.locator('#tools .tool-btn[data-tool="box"]').click();
  await expectStep('Place the box');
  await field('width', 60);
  await field('depth', 40);
  await field('height', 20);
  await clickAt([0, 0, 0]);
  await idle();
  await expectStep('Now a cylinder');
  await win.locator('#tools .tool-btn[data-tool="cylinder"]').click();
  await expectStep('Put it on the box');
  await field('radius', 8);
  await field('height', 40);
  await clickAt([0, 0, 20]);
  await idle();
  await expectStep('Select the cylinder');
  await win.keyboard.press('Escape');
  await clickAt([0, 0, 27], { double: true });
  await expectStep('Move it down');
  await ctx('Move');
  await expectStep('Push it through the box');
  await field('z', -30, true);
  await expectStep('Select both bodies');
  await clickAt([30, 0, 10], { double: true });
  await clickAt([0, 0, 24], { double: true });
  await expectStep('Cut the hole');
  await shot(win, '72-lesson-shapes');
  await ctx('Subtract');
  await idle();
  await win.keyboard.press('Enter');
  await idle();
  await expectStep('Well done!');
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 1);
  const holed = await vol();
  assert.ok(Math.abs(holed - (60 * 40 * 20 - Math.PI * 64 * 20)) < 5, `box with a hole: ${holed}`);
  await finish('shapes');

  step('lesson: exact sizes');
  await start('sizes');
  await next();
  await expectStep('A rectangle of 50 × 30');
  await win.keyboard.press('r');
  await clickAt([-25, -15, 0]);
  await win.keyboard.type('50');
  await win.keyboard.press('Tab');
  await win.keyboard.type('30');
  await win.keyboard.press('Enter');
  await idle();
  await expectStep('A circle inside it');
  await win.keyboard.press('c');
  await clickAt([0, 0, 0]);
  await typeAndEnter('12');
  await expectStep('Put the tool away');
  await win.keyboard.press('Escape');
  await expectStep('Change a size');
  await win.locator('.dim-label', { hasText: /^50/ }).click();
  await win.waitForSelector('.dim-edit');
  await win.locator('.dim-edit').fill('70');
  await win.locator('.dim-edit').press('Enter');
  await expectStep('Add a dimension');
  await win.keyboard.press('l');
  await clickAt([60, -15, 0]);
  await clickAt([60, 15, 0]);
  await win.keyboard.press('Escape');
  await win.keyboard.press('d');
  await clickAt([60, 0, 0]);
  await win.waitForSelector('.dim-edit');
  await win.locator('.dim-edit').fill('25');
  await win.locator('.dim-edit').press('Enter');
  await expectStep('Well done!');
  const lengths = await A(() => window.__shaper.doc.sketches[0].constraints.filter((c) => c.type === 'length').map((c) => c.value).sort((a, b) => a - b));
  assert.deepEqual(lengths, [25, 30, 70]);
  await finish('sizes');

  step('lesson: push and pull');
  await start('pushpull');
  await next();
  await expectStep('Select the top face');
  await clickAt([0, 0, 20]);
  await expectStep('Pull it up');
  await ctx('Extrude');
  await typeAndEnter('10');
  await expectStep('Push a side in');
  await clickAt([20, 0, 10]);
  await win.keyboard.press('e');
  await typeAndEnter('-5');
  await expectStep('Well done!');
  const pushed = await vol();
  assert.ok(Math.abs(pushed - 35 * 40 * 30) < 1, `pushed and pulled: ${pushed}`);
  await finish('pushpull');

  step('lesson: round, bevel and hollow');
  await start('edges');
  await next();
  await expectStep('Round an edge');
  await clickAt([0, -20, 25]);
  await ctx('Fillet');
  await typeAndEnter('4');
  await expectStep('Bevel another edge');
  await clickAt([25, 5, 25]);
  await ctx('Chamfer');
  await typeAndEnter('3');
  await expectStep('Hollow it out');
  await clickAt([0, 5, 25]);
  await ctx('Shell');
  await typeAndEnter('2');
  await expectStep('Look inside');
  await win.keyboard.press('x');
  await expectStep('Well done!');
  await win.keyboard.press('Escape');
  const shelled = await vol();
  assert.ok(shelled < 50 * 40 * 25 * 0.5, `the box is hollow: ${shelled}`);
  await finish('edges');

  step('lesson: revolve');
  await start('revolve');
  await next();
  await expectStep('Draw the shape');
  await win.keyboard.press('r');
  await clickAt([10, -10, 0]);
  await clickAt([20, 10, 0]);
  await idle();
  await expectStep('Select it');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => window.__shaper.regionCache.get(window.__shaper.doc.sketches[0].id)?.data?.regions.length === 1);
  await clickAt([15, 0, 0]);
  await expectStep('Revolve it');
  await ctx('Revolve');
  await expectStep('Pick the axis');
  await win.locator('#tool-panel .chip', { hasText: /^Y$/ }).click();
  await idle();
  await win.keyboard.press('Enter');
  await idle();
  await expectStep('Well done!');
  const ring = await vol();
  assert.ok(Math.abs(ring - Math.PI * (20 * 20 - 10 * 10) * 20) < 20, `ring volume ${ring}`);
  await finish('revolve');

  step('lesson: a plate with holes');
  await start('holes');
  await next();
  await expectStep('Draw on the top face');
  await win.keyboard.press('c');
  await clickAt([-30, 0, 6]);
  await typeAndEnter('10');
  await expectStep('Repeat the circle');
  await win.keyboard.press('Escape');
  await win.locator('#tools .tool-btn[data-tool="sketchPattern"]').click();
  const hole = await A(() => window.__shaper.doc.sketches.at(-1).entities.find((e) => e.type === 'circle'));
  await clickAt(await toWorld([hole.c[0] + hole.r, hole.c[1]]));
  await field('count', 4);
  await field('distance', 18, true);
  await expectStep('Select the holes');
  await win.keyboard.press('Escape');
  const centers = await A(() => window.__shaper.doc.sketches.at(-1).entities.filter((e) => e.type === 'circle').map((e) => e.c));
  assert.equal(centers.length, 4);
  // Beside the centre point (a click on it picks the point).
  await A(() => window.__shaper.vp.rig.fromJSON({ az: 0.3, el: 1.0, dist: 150, target: [0, 0, 6], ortho: false }));
  await win.waitForTimeout(250);
  for (const c of centers) await clickAt(await toWorld([c[0] + hole.r * 0.6, c[1] + hole.r * 0.3]));
  await expectStep('Cut them through');
  await ctx('Extrude');
  await typeAndEnter('-6');
  await expectStep('Well done!');
  const plate = await vol();
  assert.ok(Math.abs(plate - (80 * 40 * 6 - 4 * Math.PI * hole.r * hole.r * 6)) < 5, `plate with holes: ${plate}`);
  await finish('holes');

  step('lesson: text');
  await start('text');
  await next();
  await expectStep('Pick the Text tool');
  await win.locator('#tools .tool-btn[data-tool="text"]').click();
  await expectStep('Write your name');
  await win.locator('#tool-panel textarea[data-key="text"]').fill('ADA');
  await win.waitForTimeout(300);
  await clickAt([0, 0, 8]);
  await idle();
  await expectStep('Engrave it');
  await ctx('Extrude');
  await typeAndEnter('-1');
  await expectStep('Well done!');
  assert.ok((await vol()) < 80 * 30 * 8 - 10, 'letters are cut in');
  await finish('text');

  step('lesson: history');
  await start('history');
  await next();
  await expectStep('Round an edge');
  await clickAt([0, -20, 20]);
  await ctx('Fillet');
  await typeAndEnter('2');
  await expectStep('Open the History');
  await win.locator('#items .items-tab[data-tab="history"]').click();
  await expectStep('Change the fillet');
  await win.locator('#items .step', { hasText: 'Fillet' }).locator('.step-icon').click();
  const radius = win.locator('#items .step-edit .num-input[data-key$="radius"]');
  await radius.fill('8');
  await radius.press('Enter');
  await idle();
  await expectStep('Well done!');
  await finish('history');

  step('lesson: variables');
  await start('variables');
  await next();
  await expectStep('Open the History');
  await win.locator('#items .items-tab[data-tab="history"]').click();
  await expectStep('Add a variable');
  await win.locator('#items .vars-head .item-btn').click();
  await win.locator('.menu button', { hasText: 'Length' }).click();
  await expectStep('Name it and set it');
  await win.locator('#items .var-name').dblclick();
  const nameInput = win.locator('#items .var-name-input');
  await nameInput.fill('width');
  await nameInput.press('Enter');
  await win.waitForTimeout(200);
  const expr = win.locator('#items .var-expr');
  await expr.fill('40');
  await expr.press('Enter');
  await expectStep('Use it');
  await win.locator('#tools .tool-btn[data-tool="box"]').click();
  await field('width', 'width');
  await clickAt([0, 0, 0]);
  await idle();
  await expectStep('Change it once');
  await win.keyboard.press('Escape');
  const expr2 = win.locator('#items .var-expr');
  await expr2.fill('80');
  await expr2.press('Enter');
  await idle();
  await expectStep('Well done!');
  const wide = await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.bodies[0].shapeId }] });
    return r.items[0].volume;
  });
  const p = await A(() => window.__shaper.settings.primitives.box);
  assert.ok(Math.abs(wide - 80 * p.depth * p.height) < 1, `box follows the variable: ${wide}`);
  await finish('variables');

  step('lesson: materials and pictures');
  await start('visual');
  await next();
  await expectStep('Switch to Visualization');
  await win.locator('#mode-seg [data-mode="visual"]').click();
  await expectStep('Pick a material');
  await win.locator('#materials .mp-mat').nth(3).click();
  await expectStep('Set the light');
  // Drag the first light slider.
  const slider = win.locator('#materials .mp-slider', { hasText: 'Light direction' }).locator('input');
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  await win.mouse.move(box.x + 4, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 5 });
  await win.mouse.up();
  await expectStep('Save a picture');
  await shot(win, '73-lesson-visual');
  await next();
  await expectStep('Well done!');
  await finish('visual');
  await win.locator('#mode-seg [data-mode="model"]').click();

  step('lesson: 3D print');
  await start('print');
  await next();
  await expectStep('Open 3D Print');
  await win.locator('#btn-print').click();
  await expectStep('Read the checks');
  await next();
  await expectStep('Save the file');
  await next();
  await expectStep('Well done!');
  await finish('print');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('.print-modal'));

  step('lesson: drawing');
  await start('drawing');
  await next();
  await expectStep('Open the drawing');
  await win.locator('#btn-export').click();
  await win.locator('.menu button', { hasText: '2D drawing' }).click();
  await expectStep('Choose what it shows');
  await shot(win, '74-lesson-drawing');
  await next();
  await expectStep('Well done!');
  await finish('drawing');
  await win.keyboard.press('Escape');

  step('the last step offers the next lesson');
  await start('pushpull');
  for (let i = 0; i < 4; i++) {
    await win.locator('.tut-card .tut-buttons .btn').last().click();
    await win.waitForTimeout(150);
  }
  await expectStep('Well done!');
  assert.match(await win.locator('.tut-card .tut-next').innerText(), /Next:/);
  await win.locator('.tut-card .tut-buttons .btn', { hasText: 'Previous' }).click();
  await win.locator('.tut-card .tut-link').click();

  step('home shows progress');
  await A(() => window.__shaper.home.show());
  await win.waitForSelector('.home-lesson.done');
  const doneCards = await A(() => document.querySelectorAll('.home-lesson.done').length);
  assert.ok(doneCards >= 11, `${doneCards} lessons marked done`);
  assert.match(await win.locator('.home-next').innerText(), /The basics/);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nlessons: all passed');
} catch (err) {
  await shot(win, 'zz-lessons-failure').catch(() => {});
  console.error('\nlessons FAILED:', err.stack || err.message);
  console.error('current step:', await title().catch(() => '?'));
  console.error('state:', await A(() => JSON.stringify({ tool: window.__shaper.tools.activeId, sel: window.__shaper.selection.list, labels: window.__shaper.tutorial.labels })).catch(() => '?'));
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
