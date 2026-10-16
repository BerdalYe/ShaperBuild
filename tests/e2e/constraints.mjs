// End-to-end: sketch constraints and driving dimensions.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const len = (l) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);

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
  await win.mouse.click(x, y);
  await win.waitForTimeout(100);
}
const sketch = () => A(() => JSON.parse(JSON.stringify(window.__shaper.doc.sketches.at(-1))));
const isRect = (ents) => {
  const [l1, l2, l3, l4] = ents;
  near(l1.a[1], l1.b[1]);
  near(l3.a[1], l3.b[1]);
  near(l2.a[0], l2.b[0]);
  near(l4.a[0], l4.b[0]);
  near(l1.b[0], l2.a[0]);
  near(l2.b[1], l3.a[1]);
};

try {
  await A(() => {
    window.__shaper.home.hide();
    window.__shaper.settings.snap = true;
    window.__shaper.vp.rig.fromJSON({ az: 0, el: Math.PI / 2, dist: 220, target: [0, 0, 0], ortho: true });
  });
  await win.waitForTimeout(300);

  step('a rectangle with typed sizes gets H/V constraints and two dimensions');
  await win.keyboard.press('r');
  await clickAt([-30, -10, 0]);
  await win.keyboard.type('40');
  await win.keyboard.press('Tab');
  await win.keyboard.type('20');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  let sk = await sketch();
  assert.equal(sk.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical').length, 4);
  assert.deepEqual(sk.constraints.filter((c) => c.type === 'length').map((c) => c.value).sort(), [20, 40]);
  await win.waitForTimeout(200);
  assert.equal(await win.locator('.dim-label').count(), 2);
  await shot(win, '30-dimensions');

  step('editing the width label to 60 stretches the rectangle');
  const widthLabel = win.locator('.dim-label', { hasText: /^40/ });
  await widthLabel.click();
  await win.waitForSelector('.dim-edit');
  await win.locator('.dim-edit').fill('60');
  await win.locator('.dim-edit').press('Enter');
  await win.waitForTimeout(200);
  sk = await sketch();
  near(len(sk.entities[0]), 60);
  near(len(sk.entities[2]), 60);
  near(len(sk.entities[1]), 20);
  isRect(sk.entities);

  step('dragging a corner keeps the rectangle and its sizes');
  const corner = sk.entities[1].b;
  const [cx, cy] = await screen([corner[0], corner[1], 0]);
  await win.mouse.move(cx, cy, { steps: 3 });
  await win.mouse.down();
  const [tx, ty] = await screen([corner[0] + 15, corner[1] + 8, 0]);
  await win.mouse.move(tx, ty, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(200);
  sk = await sketch();
  isRect(sk.entities);
  near(len(sk.entities[0]), 60);
  near(len(sk.entities[1]), 20);
  assert.ok(Math.abs(sk.entities[1].b[0] - corner[0]) > 1, 'the rectangle moved');

  step('remove the height dimension, then drag: the height changes but it stays a rectangle');
  const heightC = sk.constraints.find((c) => c.type === 'length' && c.value === 20);
  await A(([sid, cid]) => window.__shaper.cmd.removeConstraints([{ sketchId: sid, cid }]), [sk.id, heightC.id]);
  sk = await sketch();
  const c2 = sk.entities[1].b;
  const [dx, dy] = await screen([c2[0], c2[1], 0]);
  await win.mouse.move(dx, dy, { steps: 3 });
  await win.mouse.down();
  const [ex, ey] = await screen([c2[0], c2[1] + 10, 0]);
  await win.mouse.move(ex, ey, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(200);
  sk = await sketch();
  isRect(sk.entities);
  near(len(sk.entities[0]), 60);
  near(len(sk.entities[1]), 30, 0.6);

  step('circle with typed diameter, then make a line tangent to it');
  await win.keyboard.press('c');
  await clickAt([0, 50, 0]);
  await win.keyboard.type('20');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  sk = await sketch();
  const circle = sk.entities.at(-1);
  assert.equal(circle.type, 'circle');
  assert.ok(sk.constraints.some((c) => c.type === 'diameter' && c.value === 20));
  await win.keyboard.press('l');
  await clickAt([-40, 30, 0]);
  await clickAt([40, 34, 0]);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  sk = await sketch();
  const line = sk.entities.at(-1);
  await A(
    ([sid, a, b]) =>
      window.__shaper.selection.set([
        { kind: 'curve', sketchId: sid, entityId: a },
        { kind: 'curve', sketchId: sid, entityId: b },
      ]),
    [sk.id, line.id, circle.id],
  );
  await win.locator('.cb-btn', { hasText: 'Constrain' }).click();
  await win.locator('.menu button', { hasText: 'Tangent' }).click();
  await win.waitForTimeout(200);
  sk = await sketch();
  const L = sk.entities.find((e) => e.id === line.id);
  const C = sk.entities.find((e) => e.id === circle.id);
  const d = Math.abs((L.b[0] - L.a[0]) * (C.c[1] - L.a[1]) - (L.b[1] - L.a[1]) * (C.c[0] - L.a[0])) / len(L);
  near(d, C.r, 1e-5);
  near(C.r, 10, 1e-6);
  await shot(win, '31-tangent');

  step('select a constraint glyph and delete it; undo brings it back');
  await A((sid) => window.__shaper.selection.set([{ kind: 'sketch', sketchId: sid }]), sk.id);
  await win.waitForTimeout(200);
  const before = sk.constraints.length;
  await win.locator('.cons-glyph').first().click();
  assert.equal(await A(() => window.__shaper.selection.list[0]?.kind), 'constraint');
  await win.keyboard.press('Delete');
  await win.waitForTimeout(100);
  assert.equal((await sketch()).constraints.length, before - 1);
  await win.keyboard.press('Control+z');
  assert.equal((await sketch()).constraints.length, before);

  step('dimension tool on the circle, then a too-small value is refused');
  await A(() => window.__shaper.selection.clear());
  await win.keyboard.press('Escape');
  await win.keyboard.press('d');
  const cc = (await sketch()).entities.find((e) => e.type === 'circle');
  const already = (await sketch()).constraints.filter((c) => c.type === 'diameter').length;
  assert.equal(already, 1);
  // Remove the existing diameter so the tool can add one.
  await A(([sid, cid]) => window.__shaper.cmd.removeConstraints([{ sketchId: sid, cid }]), [sk.id, (await sketch()).constraints.find((c) => c.type === 'diameter').id]);
  await clickAt([cc.c[0] - cc.r, cc.c[1], 0]);
  await win.waitForSelector('.dim-edit');
  await win.locator('.dim-edit').fill('16');
  await win.locator('.dim-edit').press('Enter');
  await win.waitForTimeout(200);
  near((await sketch()).entities.find((e) => e.type === 'circle').r, 8, 1e-6);

  step('regions still work after solving (the rectangle extrudes)');
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => {
    const a = window.__shaper;
    const sk = a.doc.sketches.at(-1);
    return a.regionCache.get(sk.id)?.key === a.sketchKey(sk);
  });
  const regions = await A(() => {
    const a = window.__shaper;
    return a.regionCache.get(a.doc.sketches.at(-1).id).data.regions.map((r) => r.area);
  });
  assert.ok(regions.some((a) => Math.abs(a - 60 * 30) < 20), `regions ${regions}`);

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nconstraints: all steps passed');
} catch (err) {
  await shot(win, 'zz-constraints-failure').catch(() => {});
  console.error('\nconstraints FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
