// End-to-end: exports with colours (GLB, USDZ, OBJ + MTL), screenshots at a
// chosen size, the visualization panel (material search, finish, light,
// camera), decals, drawings with a section and a detail view, versions of
// a saved design, the home screen card menu, and touch gestures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
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
const dir = fs.mkdtempSync(path.join(OUT, 'studio-'));
const file = (name) => path.join(dir, name);
// Set a range slider and let go of it.
async function slide(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await win.waitForTimeout(100);
}

try {
  await A(() => {
    const a = window.__shaper;
    a.home.hide();
    a.settings.snap = false;
  });
  const box = await addShape('box', { width: 40, depth: 30, height: 20 });
  await addShape('cylinder', { radius: 6, height: 30 });
  await A(() => window.__shaper.vp.setView('iso', { fit: true }));
  await win.waitForTimeout(400);

  step('export GLB, USDZ and OBJ with a material file');
  await A(({ box }) => window.__shaper.cmd.setColor([box], '#ff8800'), { box });
  for (const fmt of ['glb', 'usdz', 'obj']) {
    const target = file(`parts.${fmt}`);
    const out = await A(({ fmt, target }) => window.__shaper.files.exportDialog(fmt, null, { path: target }), { fmt, target });
    assert.equal(out, target);
  }
  assert.equal(fs.readFileSync(file('parts.glb')).subarray(0, 4).toString(), 'glTF');
  assert.equal(fs.readFileSync(file('parts.usdz')).subarray(0, 2).toString(), 'PK');
  const obj = fs.readFileSync(file('parts.obj'), 'utf8');
  assert.match(obj, /^mtllib parts\.mtl$/m);
  assert.match(obj, /^usemtl /m);
  const mtl = fs.readFileSync(file('parts.mtl'), 'utf8');
  assert.match(mtl, /Kd 1\.0000 0\.5\d+ 0\.0000/, 'the orange body keeps its colour');

  step('screenshot at a chosen size with a transparent background');
  await A((target) => window.__shaper.files.exportPNG({ path: target, pixels: [800, 600], transparent: true }), file('shot.png'));
  const png = fs.readFileSync(file('shot.png'));
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 600);
  await A(() => {
    window.__shaper.dialogs.screenshot();
  });
  await win.waitForSelector('.shot-sizes');
  assert.ok((await win.locator('.shot-size').count()) >= 4);
  await win.locator('.modal .btn', { hasText: 'Cancel' }).click();

  step('visualization: search materials, pick gold, change the finish');
  await A(({ box }) => {
    const a = window.__shaper;
    a.setVisualization(true);
    a.selection.set([{ kind: 'body', bodyId: box }]);
  }, { box });
  await win.waitForSelector('#materials:not([hidden]) .mp-search');
  await win.locator('.mp-search').fill('gold');
  await win.waitForTimeout(150);
  assert.equal(await win.locator('.mp-mat').count(), 1);
  await win.locator('.mp-mat[data-material="gold"]').click();
  await win.waitForTimeout(150);
  assert.deepEqual(await A((id) => ({ m: window.__shaper.doc.body(id).material, c: window.__shaper.doc.body(id).color }), box), { m: 'gold', c: '#e3b65a' });
  await win.locator('.mp-search').fill('');
  await win.waitForTimeout(150);
  assert.ok((await win.locator('.mp-mat').count()) > 20);
  await slide(win.locator('.mp-slider', { hasText: 'Roughness' }).locator('input'), 0.8);
  assert.equal(await A((id) => window.__shaper.doc.body(id).look?.roughness, box), 0.8);
  assert.equal(await A((id) => window.__shaper.vp.bodyViews.get(id).material.roughness, box), 0.8);

  step('light and camera');
  await slide(win.locator('.mp-slider', { hasText: 'Sun height' }).locator('input'), 30);
  assert.equal(await A(() => window.__shaper.settings.lighting.elevation), 30);
  const sunZ = await A(() => {
    const vp = window.__shaper.vp;
    const d = vp.sun.position.clone().sub(vp.sun.target.position).normalize();
    return d.z;
  });
  assert.ok(Math.abs(sunZ - Math.sin((30 * Math.PI) / 180)) < 1e-6);
  await slide(win.locator('.mp-slider', { hasText: 'Field of view' }).locator('input'), 50);
  assert.equal(await A(() => window.__shaper.vp.rig.persp.fov), 50);

  step('place a decal on the box');
  await A(() => window.__shaper.selection.clear());
  await A(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#d22';
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#fff';
    g.fillRect(8, 8, 48, 16);
    window.__shaper.tools.activate('decal', { force: true, src: c.toDataURL('image/png'), aspect: 0.5, name: 'Logo' });
  });
  const [x, y] = await screen([0, -15, 10]);
  await win.mouse.move(x, y, { steps: 3 });
  await win.mouse.click(x, y);
  await win.waitForTimeout(300);
  const decal = await A(() => window.__shaper.doc.decals[0]);
  assert.equal(decal.bodyId, box);
  assert.ok(Math.abs(decal.normal[1] + 1) < 1e-6, 'it faces out of the front face');
  const tris = await A((id) => window.__shaper.vp.decalViews.get(id).mesh.geometry.attributes.position.count, decal.id);
  assert.ok(tris > 0);
  await win.waitForSelector('.mp-decal.on');
  await slide(win.locator('.mp-slider', { hasText: 'Size' }).locator('input'), 25);
  assert.equal(await A(() => window.__shaper.doc.decals[0].size), 25);
  await shot(win, 'b4-visual');
  await A(() => window.__shaper.setVisualization(false));

  step('drawing with a section, a detail view and notes');
  await A(() => {
    window.__shaper.drawing.open();
  });
  await win.waitForSelector('.dd-preview svg');
  await win.locator('.dd-check input[data-option="section"]').check();
  await win.waitForFunction(() => document.querySelector('.dd-preview svg')?.innerHTML.includes('SECTION A–A'), null, { timeout: 30000 });
  assert.ok(await win.locator('.dd-preview .hatch').count());
  await win.locator('.dd-check input[data-option="detail"]').check();
  await win.waitForFunction(() => document.querySelector('.dd-preview svg')?.innerHTML.includes('DETAIL B'));
  await win.locator('textarea[data-field="notes"]').fill('Remove sharp edges.');
  await win.locator('textarea[data-field="notes"]').dispatchEvent('change');
  await win.locator('input[data-field="material"]').fill('PLA');
  await win.locator('input[data-field="material"]').dispatchEvent('change');
  await win.waitForFunction(() => document.querySelector('.dd-preview svg')?.innerHTML.includes('Remove sharp edges.'));
  await shot(win, 'b4-drawing');
  await win.locator('.drawing-modal .btn', { hasText: 'Close' }).click();
  await win.waitForTimeout(200);
  assert.deepEqual(await A(() => ({ n: window.__shaper.doc.state.drawing.notes, m: window.__shaper.doc.state.drawing.material })), { n: 'Remove sharp edges.', m: 'PLA' });

  step('versions: save twice, then restore the first save');
  const design = file('Part.shaperbuild');
  await A((p) => window.__shaper.files.save({ path: p }), design);
  await addShape('sphere', { radius: 4 });
  await A((p) => window.__shaper.files.save({ path: p }), design);
  const versions = await A((p) => window.native.listVersions(p), design);
  assert.equal(versions.length, 1);
  await A(() => {
    window.__shaper.files.showVersions();
  });
  await win.locator('.version-row .btn', { hasText: 'Restore as latest' }).click();
  await win.locator('.modal .btn.primary', { hasText: 'Restore' }).click();
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 2, null, { timeout: 30000 });
  await idle();
  assert.equal((await A((p) => window.native.listVersions(p), design)).length, 2, 'the replaced file is kept too');

  step('home screen: duplicate and rename a design');
  await A(() => window.__shaper.home.show());
  await win.waitForSelector(`.recent-card[data-path="${design.replace(/\\/g, '\\\\')}"]`);
  await win.locator('.recent-card').first().click({ button: 'right' });
  await win.locator('.menu button', { hasText: 'Duplicate' }).click();
  const copy = file('Part copy.shaperbuild');
  await win.waitForFunction((p) => [...document.querySelectorAll('.recent-card')].some((c) => c.dataset.path === p), copy);
  assert.ok(fs.existsSync(copy));
  await win.locator(`.recent-card[data-path="${copy.replace(/\\/g, '\\\\')}"]`).click({ button: 'right' });
  await win.locator('.menu button', { hasText: 'Rename' }).click();
  await win.locator('.modal input').fill('Bracket');
  await win.locator('.modal .btn.primary').click();
  await win.waitForFunction((p) => [...document.querySelectorAll('.recent-card')].some((c) => c.dataset.path === p), file('Bracket.shaperbuild'));
  assert.ok(fs.existsSync(file('Bracket.shaperbuild')) && !fs.existsSync(copy));
  await A(() => window.__shaper.home.hide());

  step('touch: drag to orbit, pinch to zoom, tap to select');
  const cdp = await win.context().newCDPSession(win);
  const rect = await A(() => {
    const r = window.__shaper.vp.canvas.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([px, py], i) => ({ x: px, y: py, id: i })) });
  const az0 = await A(() => window.__shaper.vp.rig.az);
  const ex = rect.x + rect.w * 0.15;
  const ey = rect.y + rect.h * 0.8;
  await touch('touchStart', [[ex, ey]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[ex + i * 15, ey]]);
  await touch('touchEnd', []);
  assert.ok(Math.abs((await A(() => window.__shaper.vp.rig.az)) - az0) > 0.05, 'one finger orbits');
  const d0 = await A(() => window.__shaper.vp.rig.dist);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  await touch('touchStart', [
    [cx - 40, cy],
    [cx + 40, cy],
  ]);
  for (let i = 1; i <= 5; i++)
    await touch('touchMove', [
      [cx - 40 - i * 12, cy],
      [cx + 40 + i * 12, cy],
    ]);
  await touch('touchEnd', []);
  assert.ok((await A(() => window.__shaper.vp.rig.dist)) < d0 * 0.8, 'spreading two fingers zooms in');
  await A(() => window.__shaper.vp.fit());
  await win.waitForTimeout(400);
  await A(() => window.__shaper.selection.clear());
  const [bx, by] = await screen([0, -15, 10]);
  await touch('touchStart', [[bx, by]]);
  await touch('touchEnd', []);
  await win.waitForTimeout(200);
  assert.equal(await A(() => window.__shaper.selection.list[0]?.bodyId), box, 'a tap selects');

  step('a .shapr file explains how to bring the design in');
  await A(() => {
    window.__shaper.files.openData('Part.shapr', new Uint8Array([80, 75, 3, 4]), null);
  });
  await win.waitForSelector('.modal-head:has-text("This file cannot be opened")');
  assert.match(await win.locator('.modal-body').innerText(), /export it as STEP/);
  await win.locator('.modal .btn.primary').click();

  step('open-source licences and privacy');
  await A(() => {
    window.__shaper.dialogs.licences();
  });
  await win.waitForSelector('.lic-row');
  assert.equal(await win.locator('.lic-row').count(), 9);
  await win.waitForFunction(() => document.querySelector('.lic-text')?.textContent.includes('MIT License'));
  await win.locator('.lic-row', { hasText: 'Open CASCADE' }).click();
  await win.waitForFunction(() => document.querySelector('.lic-text')?.textContent.includes('GNU LESSER GENERAL PUBLIC LICENSE'));
  await win.locator('.lic-row', { hasText: 'Manifold' }).click();
  await win.waitForFunction(() => document.querySelector('.lic-text')?.textContent.includes('Apache License'));
  await win.locator('.modal .btn.primary', { hasText: 'Close' }).click();
  await A(() => {
    window.__shaper.dialogs.privacy();
  });
  await win.waitForSelector('.modal-head:has-text("Privacy")');
  assert.match(await win.locator('.modal-body').innerText(), /does not collect personal data/);
  await win.locator('.modal .btn.primary', { hasText: 'Close' }).click();

  assert.deepEqual(errors, []);
  console.log('studio: all steps passed');
} catch (err) {
  console.error(err);
  await shot(win, 'b4-failure').catch(() => {});
  console.error('console errors:', errors);
  await close();
  process.exit(1);
}
await close();
