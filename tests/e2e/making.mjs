// End-to-end: the star polygon, twisted
// extrude, SVG import and tracing a picture.
import assert from 'node:assert/strict';
import { launch, shot } from './harness.mjs';

const { win, errors, close } = await launch();
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

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
  await win.waitForTimeout(100);
}
async function idle() {
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  await win.waitForTimeout(150);
}
const regions = (id) =>
  A(async (id) => {
    const a = window.__shaper;
    await a.ensureRegions([{ kind: 'region', sketchId: id, index: 0 }]);
    return a.regionCache.get(id).data.regions.map((r) => r.area);
  }, id);

try {
  await A(() => window.__shaper.home.hide());

  step('the polygon tool draws stars: points, inner size, typed radius');
  await win.keyboard.press('p');
  await win.locator('#tool-panel button', { hasText: 'Star' }).click();
  const fields = await win.locator('#tool-panel').innerText();
  assert.match(fields, /Points/);
  assert.match(fields, /Inner size/);
  await A(() => {
    const st = window.__shaper.settings;
    st.polygonSides = 5;
    st.starInner = 40;
  });
  await clickAt([0, 0, 0]);
  await win.keyboard.type('20');
  await win.keyboard.press('Enter');
  await win.keyboard.press('Escape');
  await idle();
  const star = await A(() => window.__shaper.doc.sketches.at(-1));
  const lines = star.entities.filter((e) => e.type === 'line');
  assert.equal(lines.length, 10);
  const radii = lines.map((l) => Math.hypot(...l.a)).sort((a, b) => a - b);
  near(radii[0], 8, 1e-6);
  near(radii[9], 20, 1e-6);
  const area = 5 * 20 * 8 * Math.sin(Math.PI / 5);
  near((await regions(star.id))[0], area, 0.01);

  step('extrude has twist and size at the end; the result twists around the middle');
  await A(() => window.__shaper.selection.set([{ kind: 'region', sketchId: window.__shaper.doc.sketches.at(-1).id, index: 0 }]));
  await win.keyboard.press('e');
  await win.waitForSelector('#tool-panel :text("Twist")');
  await win.waitForSelector('#tool-panel :text("Size at the end")');
  const body = await A(async () => {
    const a = window.__shaper;
    const tool = a.tools.active;
    Object.assign(tool.values, { distance: 30, twist: 72, endScale: 0.6, mode: 'new' });
    await tool.apply();
    const b = a.doc.bodies.at(-1);
    const m = a.bodyMesh(b.id);
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: b.shapeId }] });
    return { min: m.bbox.min, max: m.bbox.max, volume: r.items[0].volume, steps: a.history.features.map((f) => f.label) };
  });
  near(body.max[2], 30, 1e-3);
  near(body.min[2], 0, 1e-3);
  // A star shrinking to 0.6: volume = area × h × (1 + k + k²) / 3.
  near(body.volume, (area * 30 * (1 + 0.6 + 0.36)) / 3, area * 30 * 0.03);
  assert.equal(body.steps.at(-1), 'Extrude');
  await shot(win, 'making-twisted-star');

  step('an SVG drawing imports as a sketch at its real size, holes and all');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" viewBox="0 0 60 60">
    <path d="M30 2 L50 40 H36 V52 H24 V40 H10 Z"/>
    <circle cx="30" cy="30" r="4"/>
  </svg>`;
  const svgSketch = await A(async (text) => {
    const a = window.__shaper;
    a.selection.clear();
    return a.files.openData('tree.svg', new TextEncoder().encode(text), null);
  }, svg);
  assert.ok(svgSketch, 'the import made a sketch');
  const svgAreas = (await regions(svgSketch)).sort((a, b) => a - b);
  assert.equal(svgAreas.length, 2, 'the tree with a round hole, and the disc');
  near(svgAreas[0], Math.PI * 16, 0.5);
  near(svgAreas[1], (20 * 38) - Math.PI * 16 + 12 * 12, 0.5);

  step('a picture traces into closed outlines from the context bar');
  const png = await A(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 300, 200);
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(100, 100, 60, 0, Math.PI * 2);
    g.fill();
    g.fillRect(190, 40, 80, 120);
    return [...atob(c.toDataURL('image/png').split(',')[1])].map((ch) => ch.charCodeAt(0));
  });
  await A(async (bytes) => {
    const a = window.__shaper;
    a.selection.clear();
    await a.files.openData('shapes.png', new Uint8Array(bytes), null);
    const im = a.doc.images.at(-1);
    // 300 px wide → 150 mm: 0.5 mm a pixel.
    a.cmd.setImage(im.id, { width: 150, height: 100 }, 'Image size');
    a.selection.set([{ kind: 'image', imageId: im.id }]);
  }, png);
  await win.locator('#context-bar button', { hasText: 'Trace outline' }).click();
  await win.waitForFunction(() => window.__shaper.doc.sketches.some((s) => /outline/.test(s.name)), null, { timeout: 20000 });
  await idle();
  const traced = await A(() => window.__shaper.doc.sketches.find((s) => /outline/.test(s.name)).id);
  const tracedAreas = (await regions(traced)).sort((a, b) => a - b);
  assert.equal(tracedAreas.length, 2, 'a disc and a block');
  near(tracedAreas[0], 40 * 60, 40 * 60 * 0.03);
  near(tracedAreas[1], Math.PI * 30 * 30, Math.PI * 30 * 30 * 0.03);
  await shot(win, 'making-traced');

  step('the AI writes text and wraps it around a round face');
  const run = (name, input) => A(([n, i]) => window.__shaper.ai.run(n, i), [name, input]);
  const can = JSON.parse((await run('add_shape', { shape: 'cylinder', radius: 20, height: 40, position: [300, 0, 0] })).text).created[0];
  const words = await run('sketch', { plane: 'XZ', offset: 20, shapes: [{ type: 'text', text: 'HI', x: 300, y: 20, size: 10 }] });
  assert.ok(!words.error, words.text);
  const ws = JSON.parse(words.text);
  assert.ok(ws.regions.filter((r) => r.filled).length >= 2, 'the letters are filled');
  const before = await A(async (id) => (await window.__shaper.kernel.call('measure', { items: [{ kind: 'body', id: window.__shaper.doc.body(id).shapeId }] })).items[0].volume, can.id);
  const wrapped = await run('wrap', { sketch_id: ws.id, body_id: can.id, face: 'round', height: 1 });
  assert.ok(!wrapped.error, wrapped.text);
  const after = await A(async (id) => (await window.__shaper.kernel.call('measure', { items: [{ kind: 'body', id: window.__shaper.doc.body(id).shapeId }] })).items[0].volume, can.id);
  assert.ok(after > before + 50, `raised letters add volume: ${before} → ${after}`);

  step('the home screen lists examples; each builds into an editable design');
  await A(() => window.__shaper.home.show());
  const cards = await win.locator('.example-card').count();
  const all = await A(async () => (await import('./examples/examples.js')).EXAMPLES.map((e) => e.id));
  assert.equal(cards, all.length);
  await A(() => (window.__shaper.doc.markSaved()));
  await win.locator('.example-card[data-example="ornament-snowflake"]').click();
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 1 && window.__shaper.home.el.hidden && window.__shaper.kernel.busy === 0, null, { timeout: 60000 });
  const built = await A(() => ({ name: window.__shaper.files.name, steps: window.__shaper.history.features.map((f) => f.label) }));
  assert.equal(built.name, 'Snowflake ornament');
  assert.ok(built.steps.includes('Extrude'), JSON.stringify(built.steps));
  await shot(win, 'making-example');
  // Every example builds without a hitch, as the pieces it should be.
  const pieces = { 'twisted-star': 1, 'expanding-star': 8, 'ornament-tree': 1, 'ornament-snowflake': 1, mug: 1, 'phone-stand': 1, 'spiral-vase': 1, 'plant-pot': 2 };
  for (const id of all) {
    const res = await A(async (id) => {
      const a = window.__shaper;
      a.doc.markSaved();
      const ok = await a.files.openExample(id);
      return { ok, bodies: a.doc.bodies.length };
    }, id);
    assert.ok(res.ok, `${id} builds`);
    if (pieces[id]) assert.equal(res.bodies, pieces[id], `${id}: ${res.bodies} bodies`);
  }

  assert.deepEqual(errors, []);
  console.log('\nmaking: all passed');
} catch (err) {
  console.error('\nmaking FAILED:', err);
  process.exitCode = 1;
} finally {
  await close();
}
