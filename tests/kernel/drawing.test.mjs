// 2D drawings: projected views with hidden lines, laid out on a sheet.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../src/vendor/manifold/manifold.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { VIEWS, layoutDrawing, drawingSketches, scaleText, clipToCircle, hatch } from '../../src/core/drawing.js';
import { writeDXF, parseDXF } from '../../src/core/dxf.js';

let k;
let views;
before(async () => {
  const oc = await OC();
  const mf = await ManifoldModule();
  mf.setup();
  k = new Kernel(oc, mf);
  // A 40 × 30 × 20 block with a vertical hole.
  const box = k.primitive({ type: 'box', params: { width: 40, depth: 30, height: 20 } }).bodies[0].id;
  const cyl = k.primitive({ type: 'cylinder', params: { radius: 5, height: 40 } }).bodies[0].id;
  const part = k.boolean({ op: 'subtract', targets: [box], tools: [cyl] }).bodies[0].id;
  const res = k.drawingViews({ ids: [part], views: Object.values(VIEWS) });
  views = Object.fromEntries(res.views.map((v) => [v.name, v]));
});

const extent = (v) => {
  const pts = [...v.visible, ...v.hidden].flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

test('views have the part’s true sizes and show the hole as hidden lines', () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);
  const [fw, fh] = extent(views.front);
  near(fw, 40);
  near(fh, 20);
  const [tw, td] = extent(views.top);
  near(tw, 40);
  near(td, 30);
  const [rw, rh] = extent(views.right);
  near(rw, 30);
  near(rh, 20);
  assert.ok(views.front.hidden.length > 0, 'the hole is hidden in the front view');
  assert.ok(views.top.visible.length > 4, 'the hole is visible from the top');
});

test('the sheet uses a standard scale and has sizes and a title block', () => {
  const lay = layoutDrawing(views, { sheet: 'A4', title: 'Block', date: '2026-01-01' });
  assert.ok([2, 1, 0.5].includes(lay.scale), `scale ${lay.scale}`);
  assert.match(lay.svg, /^<svg[^>]+width="297mm" height="210mm"/);
  for (const text of ['>40<', '>20<', '>30<', '>Block<', `>${scaleText(lay.scale)}<`, '>FRONT VIEW<', '>TOP VIEW<', '>RIGHT VIEW<']) assert.ok(lay.svg.includes(text), `missing ${text}`);
  assert.ok(lay.svg.includes('class="hid"'));
  const third = layoutDrawing(views, { projection: 'third' });
  assert.ok(third.svg.includes('3rd angle'));
});

test('the drawing exports to DXF with layers', () => {
  const lay = layoutDrawing(views, { sheet: 'A3' });
  const sketches = drawingSketches(lay);
  assert.deepEqual(sketches.map((s) => s.name).sort(), ['DIMENSIONS', 'FRAME', 'HIDDEN', 'VISIBLE']);
  const back = parseDXF(writeDXF(sketches));
  assert.equal(back.entities.length, lay.segments.length);
});

test('a section through the middle shows the hole and hatches the cut', () => {
  const box = k.primitive({ type: 'box', params: { width: 40, depth: 30, height: 20 } }).bodies[0].id;
  const cyl = k.primitive({ type: 'cylinder', params: { radius: 5, height: 40 } }).bodies[0].id;
  const part = k.boolean({ op: 'subtract', targets: [box], tools: [cyl] }).bodies[0].id;
  const sec = k.drawingSection({ ids: [part], view: VIEWS.front, at: [0, 0, 10] });
  // The cut face is the 40 × 20 rectangle with the 10 mm hole taken out.
  const pts = sec.cut.flat();
  const xs = pts.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 40) < 1e-3);
  assert.ok(pts.some((p) => Math.abs(Math.abs(p[0]) - 5) < 1e-3), 'the hole edges are on the cut');
  // The hole is seen, not hidden, in the section.
  assert.ok(sec.visible.length > 4);
  const lay = layoutDrawing({ ...views, section: sec }, { sectionAt: 0 });
  assert.ok(lay.svg.includes('class="hatch"'));
  assert.ok(lay.svg.includes('SECTION A–A'));
  assert.ok(lay.segments.some((s) => s.layer === 'HATCH'));
});

test('hatching fills between outlines and skips holes', () => {
  const sq = (x0, y0, x1, y1) => [
    [[x0, y0], [x1, y0]],
    [[x1, y0], [x1, y1]],
    [[x1, y1], [x0, y1]],
    [[x0, y1], [x0, y0]],
  ];
  const lines = hatch([...sq(0, 0, 10, 10), ...sq(4, 4, 6, 6)], 1);
  assert.ok(lines.length > 10);
  // No hatch line crosses the middle of the hole.
  for (const [a, b] of lines) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    assert.ok(!(mid[0] > 4.2 && mid[0] < 5.8 && mid[1] > 4.2 && mid[1] < 5.8));
  }
});

test('a detail view clips its parent view to the circle', () => {
  const parts = clipToCircle([[-10, 0], [10, 0]], [0, 0], 3);
  assert.equal(parts.length, 1);
  assert.ok(Math.abs(parts[0][0][0] + 3) < 1e-9 && Math.abs(parts[0].at(-1)[0] - 3) < 1e-9);
  const lay = layoutDrawing(views, { detail: { view: 'front', at: [20, 10], radius: 5, factor: 2 } });
  assert.ok(lay.svg.includes('DETAIL B'));
  assert.ok(lay.placed.detail.s > lay.scale);
});

test('portrait sheets, fixed scales, title block fields and notes', () => {
  const lay = layoutDrawing(views, { sheet: 'A3', portrait: true, scale: 1, drawnBy: 'Kari', material: 'PLA', revision: 'B', number: 'SB-001', notes: 'Break all sharp edges.\nPrint with 20% infill.' });
  assert.equal(lay.width, 297);
  assert.equal(lay.height, 420);
  assert.equal(lay.scale, 1);
  for (const s of ['>Kari<', '>PLA<', '>B<', '>SB-001<', '>Break all sharp edges.<', '>Print with 20% infill.<']) assert.ok(lay.svg.includes(s), `missing ${s}`);
});
