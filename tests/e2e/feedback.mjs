// End-to-end: startup screen, tooltips on the view controls and tools,
// Snap in the Move tool, resizable side panels and the designs folder.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const width = (sel) => A((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width), sel);

async function drag(sel, dx) {
  const box = await win.locator(sel).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx / 2, y, { steps: 4 });
  await win.mouse.move(x + dx, y, { steps: 4 });
  await win.mouse.up();
  await win.waitForTimeout(200);
}

try {
  step('the startup screen is gone once the app is ready');
  await win.waitForFunction(() => document.getElementById('boot').hidden);
  assert.match(await A(() => document.getElementById('boot-foot').textContent), /Version \d+\.\d+\.\d+/);
  await A(() => window.__shaper.home.hide());

  step('view controls explain themselves on hover');
  await win.locator('[data-vc="fit"]').hover();
  await win.waitForSelector('.tooltip', { timeout: 3000 });
  assert.match(await win.locator('.tooltip').innerText(), /Zoom to fit[\s\S]*Show everything/);
  await shot(win, '80-tooltip-view');
  await win.mouse.move(600, 400);
  await win.waitForFunction(() => !document.querySelector('.tooltip'));

  step('tools explain themselves on hover');
  await win.locator('#tools .tool-btn[data-tool="fillet"]').hover();
  await win.waitForSelector('.tooltip .desc', { timeout: 3000 });
  assert.match(await win.locator('.tooltip').innerText(), /Fillet[\s\S]*Round edges/);
  await shot(win, '81-tooltip-tool');
  await win.mouse.move(600, 400);

  step('turning Snap off in the Move tool takes effect at once');
  await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'box', params: { width: 20, depth: 20, height: 20 } });
    a.cmd.applyResult('Box', r);
    a.selection.set([{ kind: 'body', bodyId: a.doc.bodies[0].id }]);
    a.settings.snap = true;
    a.tools.activate('move');
  });
  await win.waitForTimeout(300);
  const snapOn = await A(() => window.__shaper.tools.active.controls?.translationSnap ?? null);
  assert.ok(snapOn > 0, `snapping while Snap is on (${snapOn})`);
  await win.locator('#btn-snap').click();
  assert.equal(await A(() => window.__shaper.tools.active.controls?.translationSnap ?? null), null, 'no snapping after Snap is turned off');
  await win.locator('#btn-snap').click();
  assert.ok((await A(() => window.__shaper.tools.active.controls?.translationSnap)) > 0, 'snapping again');
  await win.keyboard.press('Escape');

  step('the settings icon is a gear');
  assert.match(await A(() => document.getElementById('btn-settings').innerHTML), /<circle cx="12" cy="12" r="3"/);

  step('the items panel and the tools menu can be resized');
  const items0 = await width('#items');
  await drag('.panel-resizer.left', 120);
  const items1 = await width('#items');
  assert.ok(items1 > items0 + 100, `items panel wider: ${items0} → ${items1}`);
  const tools0 = await width('#tools');
  await drag('.panel-resizer.right', -100);
  const tools1 = await width('#tools');
  assert.ok(tools1 > tools0 + 80, `tools menu wider: ${tools0} → ${tools1}`);
  // A wider tools menu shows more tools in a row.
  const perRow = await A(() => getComputedStyle(document.querySelector('#tools .tools-grid')).gridTemplateColumns.split(' ').length);
  assert.ok(perRow >= 4, `${perRow} tools per row`);
  await shot(win, '82-resized-panels');
  const saved = await A(() => JSON.parse(localStorage.getItem('shaperbuild.settings.v1') || '{}'));
  assert.equal(saved.itemsWidth, items1);
  step('very small or large widths are limited, and a double-click resets');
  await drag('.panel-resizer.left', -600);
  assert.equal(await width('#items'), 180);
  await win.locator('.panel-resizer.left').dblclick();
  await win.waitForTimeout(450);
  assert.equal(await width('#items'), 248);
  await win.locator('.panel-resizer.right').dblclick();
  await win.waitForTimeout(250);
  assert.equal(await width('#tools'), 236);

  step('settings show the designs folder');
  A(() => window.__shaper.dialogs.settings());
  await win.waitForSelector('.folder-pick .folder-path');
  await win.waitForFunction(() => document.querySelector('.folder-pick .folder-path').textContent.length > 0);
  const folder = await win.locator('.folder-pick .folder-path').textContent();
  assert.match(folder, /ShaperBuild$/);
  assert.ok(fs.existsSync(folder), `the folder exists: ${folder}`);
  await shot(win, '83-settings-folder');
  await win.keyboard.press('Escape');

  step('save dialogs start in the designs folder');
  const start = await A(() => window.native.getFolders());
  assert.equal(start.designs, folder);
  assert.ok(path.isAbsolute(folder));
  void OUT;

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nfeedback: all passed');
} catch (err) {
  await shot(win, 'zz-feedback-failure').catch(() => {});
  console.error('\nfeedback FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
