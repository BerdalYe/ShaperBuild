// End-to-end: variables and formulas in number fields, − / + and dragging
// on number fields, keyboard shortcut sets and the key editor, selection
// filters, box direction, select-through, snap options and grid lock.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
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
const size = (bodyId) =>
  A((id) => {
    const b = window.__shaper.bodyMesh(id).bbox;
    return b.max.map((v, i) => v - b.min[i]);
  }, bodyId);
const lastBody = () => A(() => window.__shaper.doc.bodies.at(-1).id);
const firstField = () => win.locator('#tool-panel input[data-key="width"]');

try {
  await A(() => window.__shaper.home.hide());

  step('a variable used in the Box tool');
  const vid = await A(() => window.__shaper.cmd.addVariable({ name: 'width', kind: 'length', expr: '30' }));
  assert.equal(await A(() => window.__shaper.doc.variables[0].expr), '30 mm'); // plain numbers keep their unit
  await A(() => window.__shaper.tools.activate('box'));
  await firstField().fill('width / 2');
  await firstField().press('Tab');
  const [cx, cy] = await screen([0, 0, 0]);
  await win.mouse.move(cx, cy, { steps: 3 });
  await win.mouse.click(cx, cy);
  await idle();
  const boxId = await lastBody();
  near((await size(boxId))[0], 15);
  assert.deepEqual(await A(() => window.__shaper.history.features[0].exprs), { 'params.width': 'width / 2' });

  step('changing the variable changes the box');
  await A((id) => window.__shaper.cmd.updateVariable(id, { expr: '50' }), vid);
  await idle();
  near((await size(boxId))[0], 25);

  step('History shows the variable and the formula');
  await A(() => {
    const p = window.__shaper.items;
    p.setTab('history');
    p.historyList.open = window.__shaper.history.features[0].id;
    p.render();
  });
  assert.equal(await win.locator('.var-row .var-name').first().innerText(), 'width');
  assert.equal(await win.locator('.step-edit input.num-input').first().inputValue(), 'width / 2');
  await shot(win, 'inputs-01-variables');

  step('a sketch dimension typed with the variable follows it');
  const sk = await A(() => window.__shaper.cmd.addSketch({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] }, [{ type: 'line', a: [40, 0], b: [60, 10] }]));
  await A((sk) => {
    const a = window.__shaper;
    const en = a.doc.sketch(sk).entities[0];
    a.cmd.addConstraint(sk, { type: 'length', e: en.id });
  }, sk);
  await win.waitForSelector('input.dim-edit', { timeout: 5000 });
  await win.locator('input.dim-edit').fill('width - 10');
  await win.locator('input.dim-edit').press('Enter');
  const dim = () => A((sk) => window.__shaper.doc.sketch(sk).constraints.find((c) => c.type === 'length'), sk);
  assert.equal((await dim()).expr, 'width - 10');
  near((await dim()).value, 40);
  await A((id) => window.__shaper.cmd.updateVariable(id, { expr: '30' }), vid);
  await idle();
  near((await dim()).value, 20);
  near((await size(boxId))[0], 15);

  step('renaming updates every formula; a used variable cannot be deleted');
  await A((id) => window.__shaper.cmd.updateVariable(id, { name: 'w' }), vid);
  assert.equal(await A(() => window.__shaper.history.features[0].exprs['params.width']), 'w / 2');
  assert.equal((await dim()).expr, 'w - 10');
  assert.equal(await A((id) => window.__shaper.cmd.removeVariable(id), vid), false);
  assert.equal(await A(() => window.__shaper.doc.variables.length), 1);
  assert.equal(await A(() => window.__shaper.cmd.addVariable({ name: '2x' })), null);
  await A(() => window.__shaper.items.setTab('items'));

  step('− / + buttons and dragging the name change a number');
  await A(() => window.__shaper.tools.activate('box', { force: true }));
  const before = await A(() => window.__shaper.panel.values.width);
  const widthField = win.locator('#tool-panel .tp-field', { has: win.locator('input[data-key="width"]') });
  await widthField.locator('.nf-btn').last().click();
  near(await A(() => window.__shaper.panel.values.width), before + 1);
  const label = widthField.locator('label.scrub');
  const lb = await label.boundingBox();
  await win.mouse.move(lb.x + 5, lb.y + lb.height / 2);
  await win.mouse.down();
  await win.mouse.move(lb.x + 35, lb.y + lb.height / 2, { steps: 6 });
  await win.mouse.up();
  near(await A(() => window.__shaper.panel.values.width), before + 6);
  await win.keyboard.press('Escape');

  step('Ctrl+4 shows the top view');
  await win.locator('#viewport canvas').first().click({ position: { x: 20, y: 20 } }).catch(() => {});
  await win.keyboard.press('Control+4');
  await win.waitForTimeout(600);
  const dir = await A(() => {
    const cam = window.__shaper.vp.camera;
    const d = new cam.position.constructor();
    cam.getWorldDirection(d);
    return d.toArray();
  });
  near(dir[2], -1, 0.02);

  step('Shapr3D-style keys: V is Revolve, X finds a tool');
  await A(() => {
    const a = window.__shaper;
    a.settings.keymap = { preset: 'shapr', keys: {} };
    a.reloadKeymap();
  });
  await win.keyboard.press('v');
  assert.equal(await A(() => window.__shaper.tools.activeId), 'revolve');
  await win.keyboard.press('Escape');
  await win.keyboard.press('x');
  assert.ok(await A(() => document.activeElement?.classList.contains('ts-input')));
  await win.keyboard.press('Escape');

  step('a key changed in the editor');
  await A(() => {
    window.__shaper.dialogs.keymapEditor();
  });
  const row = win.locator('.ks-row', { has: win.locator('span', { hasText: /^Extrude$/ }) });
  await row.locator('button').click();
  await win.keyboard.press('j');
  assert.equal(await A(() => window.__shaper.keyFor('tool:extrude')), 'J');
  await shot(win, 'inputs-02-keys');
  await win.locator('.modal-foot button.primary').click();
  await win.keyboard.press('j');
  assert.equal(await A(() => window.__shaper.tools.activeId), 'extrude');
  await win.keyboard.press('Escape');
  await A(() => {
    const a = window.__shaper;
    a.settings.keymap = { preset: 'shaperbuild', keys: {} };
    a.reloadKeymap();
    a.tools.activate('select');
    a.vp.setView('iso');
  });
  await win.waitForTimeout(500);

  step('selection filters: faces, bodies');
  const top = await screen([0, 0, 20]);
  await win.selectOption('#filter-select', 'faces');
  await win.mouse.click(top[0], top[1]);
  assert.equal(await A(() => window.__shaper.selection.list[0]?.kind), 'face');
  await win.selectOption('#filter-select', 'bodies');
  await A(() => window.__shaper.selection.clear());
  await win.mouse.click(top[0], top[1]);
  assert.equal(await A(() => window.__shaper.selection.list.map((it) => it.kind).join()), 'body');
  await win.selectOption('#filter-select', 'all');
  await A(() => window.__shaper.selection.clear());

  step('box left to right: fully inside only; right to left: touching');
  const corners = [];
  for (const x of [-7.5, 7.5]) for (const y of [-10, 10]) for (const z of [0, 20]) corners.push(await screen([x, y, z]));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const left = Math.min(...xs) - 30;
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  const topY = Math.min(...ys) - 30;
  const botY = Math.max(...ys) + 30;
  const drag = async (x0, y0, x1, y1) => {
    await win.mouse.move(x0, y0);
    await win.mouse.down();
    await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await win.mouse.move(x1, y1, { steps: 4 });
    await win.mouse.up();
    await win.waitForTimeout(150);
  };
  await drag(left, topY, mid, botY);
  assert.equal(await A(() => window.__shaper.selection.list.filter((it) => it.kind === 'body').length), 0);
  await drag(mid, botY, left, topY);
  assert.deepEqual(await A(() => window.__shaper.selection.list.filter((it) => it.kind === 'body').map((it) => it.bodyId)), [boxId]);
  await A(() => window.__shaper.selection.clear());

  step('select through lists the faces under the pointer');
  await win.mouse.move(top[0], top[1]);
  await A(() => window.__shaper.selectThrough());
  const entries = await win.locator('.menu button').count();
  assert.ok(entries >= 2, `${entries} entries`);
  await win.locator('.menu button').nth(1).click();
  const picked = await A(() => window.__shaper.selection.list[0]);
  assert.equal(picked.kind, 'face');

  step('snap options and grid lock');
  await win.locator('#btn-snap-more').click();
  const grid = win.locator('.menu .menu-check', { hasText: /^Grid$/ }).locator('input');
  await grid.uncheck();
  assert.equal(await A(() => window.__shaper.settings.snapTo.grid), false);
  await grid.check();
  await win.mouse.click(5, 300);
  await win.locator('#btn-grid-size').click();
  const locked = await A(() => window.__shaper.settings.gridLock);
  assert.ok(locked > 0);
  await A(() => window.__shaper.vp.stepZoom(4));
  await win.waitForTimeout(300);
  assert.equal(await A(() => window.__shaper.vp.grid.step), locked);
  await win.locator('#btn-grid-size').click();
  assert.equal(await A(() => window.__shaper.settings.gridLock), null);

  step('Shift+V makes a line horizontal or vertical');
  await A((sk) => {
    const a = window.__shaper;
    const en = a.doc.sketch(sk).entities[0];
    a.selection.set([{ kind: 'curve', sketchId: sk, entityId: en.id }]);
  }, sk);
  await win.keyboard.press('Shift+V');
  assert.ok(await A((sk) => window.__shaper.doc.sketch(sk).constraints.some((c) => c.type === 'horizontal' || c.type === 'vertical'), sk));

  assert.deepEqual(errors, []);
  console.log('inputs: all steps passed');
} catch (err) {
  console.error('inputs FAILED:', err.message, errors);
  await shot(win, 'inputs-zz-failed').catch(() => {});
  process.exitCode = 1;
} finally {
  await close();
}
