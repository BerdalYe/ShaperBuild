// 2D drawings: projected views with hidden lines, laid out on a sheet.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import OC from '../../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../../src/vendor/manifold/manifold.js';
import { Kernel } from '../../src/kernel/kernel.js';
import { VIEWS, layoutDrawing, drawingSketches, scaleText } from '../../src/core/drawing.js';
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
  for (const text of ['>40<', '>20<', '>30<', '>Block<', `>${scaleText(lay.scale)}<`, '>FRONT<', '>TOP<', '>RIGHT<']) assert.ok(lay.svg.includes(text), `missing ${text}`);
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
