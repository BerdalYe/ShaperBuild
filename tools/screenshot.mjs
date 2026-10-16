// Builds a small demo part and saves docs/screenshot.png.
// Linux: xvfb-run -a -s "-screen 0 1600x1000x24" node tools/screenshot.mjs
import { launch } from '../tests/e2e/harness.mjs';

const { win, close } = await launch();
try {
  await win.evaluate(async () => {
    const a = window.__shaper;
    a.home.hide();
    const k = a.kernel;
    const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] };
    const rect = (x0, y0, x1, y1) => [
      { type: 'line', a: [x0, y0], b: [x1, y0] },
      { type: 'line', a: [x1, y0], b: [x1, y1] },
      { type: 'line', a: [x1, y1], b: [x0, y1] },
      { type: 'line', a: [x0, y1], b: [x0, y0] },
    ];
    // Base plate
    const s1 = a.cmd.addSketchEntities(XY, null, rect(-40, -25, 40, 25), 'Rectangle');
    await a.ensureRegions([{ kind: 'region', sketchId: s1, index: 0 }]);
    let r = await k.call('extrude', { profiles: [{ type: 'region', sketchId: s1, index: 0, normal: [0, 0, 1] }], distance: 8, mode: 'new' });
    a.cmd.applyResult('Extrude', r);
    let body = a.doc.bodies[0];
    // Upright wall
    const top = { origin: [0, 0, 8], xDir: [1, 0, 0], normal: [0, 0, 1] };
    const s2 = a.cmd.addSketchEntities(top, null, rect(-40, -25, -30, 25), 'Rectangle');
    await a.ensureRegions([{ kind: 'region', sketchId: s2, index: 0 }]);
    const regions2 = a.regionCache.get(s2).data.regions;
    const wallIndex = regions2.findIndex((x) => x.centroid[0] < -30);
    r = await k.call('extrude', { profiles: [{ type: 'region', sketchId: s2, index: wallIndex, normal: [0, 0, 1] }], distance: 32, mode: 'union', targets: [body.shapeId] });
    a.cmd.applyResult('Extrude', r);
    body = a.doc.bodies[0];
    // Holes in the plate
    const s3 = a.cmd.addSketchEntities(top, null, [
      { type: 'circle', c: [10, -12], r: 4 },
      { type: 'circle', c: [10, 12], r: 4 },
      { type: 'circle', c: [28, 0], r: 6 },
    ], 'Circle');
    // Same plane as the wall outline, so the circles join that sketch.
    await a.ensureRegions([{ kind: 'region', sketchId: s3, index: 0 }]);
    const holes = a.regionCache
      .get(s3)
      .data.regions.map((reg, i) => ({ reg, i }))
      .filter(({ reg }) => reg.area < 200)
      .map(({ i }) => ({ type: 'region', sketchId: s3, index: i, normal: [0, 0, 1] }));
    r = await k.call('extrude', { profiles: holes, distance: -8, mode: 'subtract', targets: [body.shapeId] });
    a.cmd.applyResult('Extrude', r);
    body = a.doc.bodies[0];
    // Round the vertical corners of the plate and the wall top
    const mesh = a.bodyMesh(body.id);
    const corners = mesh.edgeInfo
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'line' && Math.abs(e.a[0] - e.b[0]) < 1e-6 && Math.abs(e.a[1] - e.b[1]) < 1e-6 && Math.abs(e.a[0]) > 39 && Math.abs(e.a[1]) > 24)
      .filter(({ e }) => e.a[0] > 0)
      .map(({ i }) => i);
    r = await k.call('fillet', { id: body.shapeId, edges: corners, radius: 8 });
    a.cmd.applyResult('Fillet', r);
    body = a.doc.bodies[0];
    const m2 = a.bodyMesh(body.id);
    const wallTop = m2.edgeInfo
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.type === 'line' && Math.abs(e.a[2] - 40) < 1e-6 && Math.abs(e.b[2] - 40) < 1e-6 && Math.abs(e.a[0] - e.b[0]) < 1e-6)
      .map(({ i }) => i);
    r = await k.call('fillet', { id: body.shapeId, edges: wallTop, radius: 3 });
    a.cmd.applyResult('Fillet', r);
    // A sketch on the wall ready for the next feature
    const wall = { origin: [-30, 0, 24], xDir: [0, 1, 0], normal: [1, 0, 0] };
    a.cmd.addSketchEntities(wall, null, [{ type: 'circle', c: [0, 4], r: 7 }, ...rect(-14, -12, 14, -6)], 'Sketch');
    a.cmd.rename('body', a.doc.bodies[0].id, 'Bracket');
    for (const s of a.doc.sketches.slice(0, -1)) a.cmd.setVisible('sketch', s.id, false);
    a.files.rename('Bracket');
    a.doc.markSaved();
    a.vp.rig.fromJSON({ az: 0.62, el: 0.5, dist: 150, target: [0, 0, 12], ortho: false });
    a.vp.requestRender();
  });
  await win.waitForFunction(() => window.__shaper.kernel.busy === 0);
  await win.waitForTimeout(800);
  // Select the hole region on the wall sketch to show the extrude arrow.
  await win.evaluate(() => {
    const a = window.__shaper;
    const sk = a.doc.sketches.at(-1);
    const regions = a.regionCache.get(sk.id)?.data?.regions || [];
    const i = regions.findIndex((r) => Math.abs(r.area - Math.PI * 49) < 1);
    if (i >= 0) a.selection.set([{ kind: 'region', sketchId: sk.id, index: i, regionKey: a.regionCache.get(sk.id).key }]);
  });
  await win.waitForTimeout(600);
  await win.screenshot({ path: 'docs/screenshot.png' });
  console.log('saved docs/screenshot.png');
} finally {
  await close();
}
