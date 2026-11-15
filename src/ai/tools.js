// Tools an AI assistant can use to build in ShaperBuild. They run the app's
// own tools (Extrude, Fillet, Subtract…), so every step shows up in History
// and can be undone like one made by hand. Used by the chat panel and by
// AI apps connected over MCP.
import DEFS from './tools.json' with { type: 'json' };

// Standard sketch planes. In a plane, x and y are the sketch's own axes:
// XY: x→X, y→Y (on the ground) · XZ: x→X, y→Z (front) · YZ: x→Y, y→Z (side).
const PLANES = {
  XY: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], xDir: [0, 1, 0], normal: [1, 0, 0] },
};

// Face names → outward direction.
const SIDES = { top: [0, 0, 1], bottom: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], back: [0, 1, 0], front: [0, -1, 0] };

// The tools' names, descriptions and inputs (also read by the MCP bridge,
// which runs without the app's window).
export const AI_TOOLS = DEFS.tools;
export const INSTRUCTIONS = DEFS.instructions;

const r3 = (v) => Math.round(v * 1000) / 1000;
const rv = (p) => p.map(r3);

class ToolError extends Error {}

// ---- the design ------------------------------------------------------------

function bodyOf(app, id) {
  const b = app.doc.body(id) || app.doc.bodies.find((x) => x.name?.toLowerCase() === String(id).toLowerCase());
  if (!b) throw new ToolError(`No body "${id}". Bodies: ${app.doc.bodies.map((x) => x.id).join(', ') || 'none'}`);
  return b;
}

function sketchOf(app, id) {
  const s = app.doc.sketch(id) || app.doc.sketches.find((x) => x.name?.toLowerCase() === String(id).toLowerCase());
  if (!s) throw new ToolError(`No sketch "${id}". Sketches: ${app.doc.sketches.map((x) => x.id).join(', ') || 'none'}`);
  return s;
}

function itemOf(app, id) {
  if (app.doc.body(id)) return { kind: 'body', bodyId: id };
  if (app.doc.sketch(id)) return { kind: 'sketch', sketchId: id };
  const b = app.doc.bodies.find((x) => x.name?.toLowerCase() === String(id).toLowerCase());
  if (b) return { kind: 'body', bodyId: b.id };
  return { kind: 'sketch', sketchId: sketchOf(app, id).id };
}

function bodySummary(app, b) {
  const m = app.bodyMesh(b.id);
  const out = { id: b.id, name: b.name };
  if (m?.bbox) {
    out.min = rv(m.bbox.min);
    out.max = rv(m.bbox.max);
    out.size = rv(m.bbox.max.map((v, i) => v - m.bbox.min[i]));
  }
  if (b.kind === 'mesh') out.kind = 'mesh';
  return out;
}

async function regionsOf(app, sketchId) {
  await app.ensureRegions([{ kind: 'region', sketchId, index: 0 }]);
  const c = app.regionCache.get(sketchId);
  return { key: c?.key, regions: c?.data?.regions || [] };
}

// "+Z", "-Y"… for a direction along an axis, else the vector.
function axisName(n) {
  const i = n.findIndex((v) => Math.abs(v) > 0.999);
  return i < 0 ? rv(n) : `${n[i] > 0 ? '+' : '-'}${'XYZ'[i]}`;
}

async function sketchSummary(app, sk) {
  const { regions } = await regionsOf(app, sk.id);
  return {
    id: sk.id,
    name: sk.name,
    ...(sk.visible === false ? { hidden: true } : {}),
    plane: { origin: rv(sk.plane.origin), normal: rv(sk.plane.normal) },
    extrude_direction: axisName(sk.plane.normal),
    curves: sk.entities.length,
    regions: regions.map((r) => ({ index: r.index, area: r3(r.area), center: rv(r.centroid) })),
  };
}

// Sketches used up by a step are hidden, as people do by hand, so their
// outlines don't clutter the model. Part of the same undo step.
function hideSketches(app, ids) {
  const hide = [...new Set(ids)].filter((id) => app.doc.sketch(id)?.visible !== false);
  if (hide.length) app.doc.replaceSilently((d) => hide.forEach((id) => d.updateSketch(id, { visible: false })));
}

// Bodies whose boxes don't meet any other body: often a part that should
// sit on or in another one.
function notTouching(app) {
  const boxes = app.doc.bodies.map((b) => [b.id, app.bodyMesh(b.id)?.bbox]).filter(([, bb]) => bb);
  if (boxes.length < 2) return [];
  const meet = (a, b) => a.min.every((v, i) => v <= b.max[i] + 0.01 && b.min[i] <= a.max[i] + 0.01);
  return boxes.filter(([id, bb]) => !boxes.some(([id2, bb2]) => id2 !== id && meet(bb, bb2))).map(([id]) => id);
}

// "0, 3" or [0, 3] → [0, 3]; anything else → null. (Some AI services send
// lists as text.)
function numberList(v) {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === 'string' && /^\s*\d+(\s*,\s*\d+)*\s*$/.test(v)) return v.split(',').map(Number);
  return null;
}

// Face index from a number or a side name.
function faceIndex(app, bodyId, sel) {
  const m = app.bodyMesh(bodyId);
  const faces = m?.faceInfo || [];
  if (typeof sel === 'string' && /^\d+$/.test(sel.trim())) sel = Number(sel);
  if (typeof sel === 'number') {
    if (!faces[sel]) throw new ToolError(`Body ${bodyId} has no face ${sel} (it has ${faces.length})`);
    return sel;
  }
  const dir = SIDES[String(sel).toLowerCase()];
  if (!dir) throw new ToolError(`Unknown face "${sel}": use a number or ${Object.keys(SIDES).join(', ')}`);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let best = -1;
  faces.forEach((f, i) => {
    if (f.type !== 'plane' || dot(f.normal, dir) < 0.9) return;
    if (best < 0 || dot(f.center, dir) > dot(faces[best].center, dir) + 1e-6 || (Math.abs(dot(f.center, dir) - dot(faces[best].center, dir)) < 1e-6 && f.area > faces[best].area)) best = i;
  });
  if (best < 0) throw new ToolError(`Body ${bodyId} has no flat ${sel} face`);
  return best;
}

function edgeIndices(app, bodyId, sel) {
  const m = app.bodyMesh(bodyId);
  const edges = m?.edgeInfo || [];
  sel = numberList(sel) ?? sel;
  if (Array.isArray(sel)) {
    for (const i of sel) if (!edges[i]) throw new ToolError(`Body ${bodyId} has no edge ${i} (it has ${edges.length})`);
    return sel;
  }
  const s = String(sel).toLowerCase();
  const all = edges.map((_, i) => i);
  if (s === 'all') return all;
  if (s === 'vertical') return all.filter((i) => edges[i].type === 'line' && Math.abs(edges[i].b[2] - edges[i].a[2]) > 0.999 * edges[i].length);
  const fi = faceIndex(app, bodyId, s);
  const f = m.faceInfo[fi];
  const on = (p) => p && Math.abs((p[0] - f.center[0]) * f.normal[0] + (p[1] - f.center[1]) * f.normal[1] + (p[2] - f.center[2]) * f.normal[2]) < 1e-4;
  return all.filter((i) => on(edges[i].a) && on(edges[i].b) && (!edges[i].center || on(edges[i].center)));
}

// ---- running the app's tools ------------------------------------------------

// Run one of the app's tools with its inputs filled in, as if done by hand.
// Returns which bodies it made, changed and removed.
async function runTool(app, id, { slots = {}, values = {}, before } = {}) {
  const tools = app.tools;
  if (!tools.isSelect) tools.cancel();
  app.selection.clear();
  tools.activate(id, { force: true });
  const tool = tools.active;
  for (const [key, items] of Object.entries(slots)) {
    const slot = tool.slots?.find((s) => s.key === key);
    if (!slot) throw new ToolError(`internal: ${id} has no input "${key}"`);
    slot.items = items;
  }
  before?.(tool);
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    tool.values[k] = v;
    tool.onParam?.(k, v);
  }
  const was = new Map(app.doc.bodies.map((b) => [b.id, b.shapeId]));
  const steps = app.doc.past.length;
  await tool.apply();
  if (tools.active === tool) {
    const why = tool.error || 'Something it needs is missing';
    tools.cancel();
    throw new ToolError(why);
  }
  if (app.doc.past.length === steps) throw new ToolError('Nothing changed');
  return changes(app, was);
}

function changes(app, was) {
  const now = app.doc.bodies;
  const out = {
    created: now.filter((b) => !was.has(b.id)).map((b) => bodySummary(app, b)),
    changed: now.filter((b) => was.has(b.id) && was.get(b.id) !== b.shapeId).map((b) => bodySummary(app, b)),
    removed: [...was.keys()].filter((id) => !app.doc.body(id)),
  };
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  return out;
}

async function profiles(app, { sketch_id, regions, body_id, face }) {
  if (body_id !== undefined && face !== undefined) {
    const b = bodyOf(app, body_id);
    return [{ kind: 'face', bodyId: b.id, index: faceIndex(app, b.id, face) }];
  }
  if (!sketch_id) throw new ToolError('Give sketch_id (and regions), or body_id and face');
  const sk = sketchOf(app, sketch_id);
  const { key, regions: all } = await regionsOf(app, sk.id);
  if (!all.length) throw new ToolError(`Sketch ${sk.id} has no closed regions`);
  const picked = regions === undefined || regions === 'all' ? all.map((r) => r.index) : [].concat(numberList(regions) ?? regions);
  for (const i of picked) if (!all.some((r) => r.index === i)) throw new ToolError(`Sketch ${sk.id} has no region ${i} (it has ${all.map((r) => r.index).join(', ')})`);
  return picked.map((index) => ({ kind: 'region', sketchId: sk.id, index, regionKey: key }));
}

// ---- sketch shapes ---------------------------------------------------------

function sketchEntities(shapes) {
  const ents = [];
  const cons = [];
  const at = (s, k = 'x') => Number(s[k] ?? 0);
  for (const s of shapes) {
    const base = ents.length;
    switch (s.type) {
      case 'rect': {
        const w = Number(s.width);
        const h = Number(s.height);
        if (!(w > 0 && h > 0)) throw new ToolError('A rect needs a positive width and height');
        const [x, y] = [at(s), at(s, 'y')];
        const cr = Math.min(Number(s.corner_radius || 0), w / 2, h / 2);
        if (cr > 1e-9) {
          // Rounded corners: four sides and four quarter arcs.
          const [x0, x1, y0, y1] = [x - w / 2, x + w / 2, y - h / 2, y + h / 2];
          const q = Math.PI / 2;
          const side = (a, b) => (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9 ? ents.push({ type: 'line', a, b }) : null);
          side([x0 + cr, y0], [x1 - cr, y0]);
          ents.push({ type: 'arc', c: [x1 - cr, y0 + cr], r: cr, a0: -q, a1: 0 });
          side([x1, y0 + cr], [x1, y1 - cr]);
          ents.push({ type: 'arc', c: [x1 - cr, y1 - cr], r: cr, a0: 0, a1: q });
          side([x1 - cr, y1], [x0 + cr, y1]);
          ents.push({ type: 'arc', c: [x0 + cr, y1 - cr], r: cr, a0: q, a1: 2 * q });
          side([x0, y1 - cr], [x0, y0 + cr]);
          ents.push({ type: 'arc', c: [x0 + cr, y0 + cr], r: cr, a0: 2 * q, a1: 3 * q });
          break;
        }
        const c = [
          [x - w / 2, y - h / 2],
          [x + w / 2, y - h / 2],
          [x + w / 2, y + h / 2],
          [x - w / 2, y + h / 2],
        ];
        for (let i = 0; i < 4; i++) ents.push({ type: 'line', a: c[i], b: c[(i + 1) % 4] });
        cons.push({ type: 'horizontal', e: `#${base}` }, { type: 'vertical', e: `#${base + 1}` }, { type: 'horizontal', e: `#${base + 2}` }, { type: 'vertical', e: `#${base + 3}` });
        cons.push({ type: 'length', e: `#${base}`, value: w }, { type: 'length', e: `#${base + 1}`, value: h });
        break;
      }
      case 'circle': {
        const r = Number(s.radius ?? (s.diameter ? s.diameter / 2 : NaN));
        if (!(r > 0)) throw new ToolError('A circle needs a positive radius');
        ents.push({ type: 'circle', c: [at(s), at(s, 'y')], r });
        cons.push({ type: 'diameter', e: `#${base}`, value: r * 2 });
        break;
      }
      case 'regular_polygon': {
        const n = Math.round(Number(s.sides ?? 6));
        const r = Number(s.radius);
        if (!(n >= 3 && r > 0)) throw new ToolError('A regular_polygon needs sides ≥ 3 and a positive radius');
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([at(s) + r * Math.cos((i / n) * Math.PI * 2 + Math.PI / 2), at(s, 'y') + r * Math.sin((i / n) * Math.PI * 2 + Math.PI / 2)]);
        for (let i = 0; i < n; i++) ents.push({ type: 'line', a: pts[i], b: pts[(i + 1) % n] });
        break;
      }
      case 'polygon': {
        const pts = (s.points || []).map((p) => [Number(p[0]), Number(p[1])]);
        if (pts.length < 3) throw new ToolError('A polygon needs at least 3 points');
        for (let i = 0; i < pts.length; i++) ents.push({ type: 'line', a: pts[i], b: pts[(i + 1) % pts.length] });
        break;
      }
      case 'line':
        if (!Array.isArray(s.from) || !Array.isArray(s.to)) throw new ToolError('A line needs from: [x, y] and to: [x, y]');
        ents.push({ type: 'line', a: s.from.map(Number), b: s.to.map(Number) });
        break;
      case 'spline': {
        const pts = (s.points || []).map((p) => [Number(p[0]), Number(p[1])]);
        if (pts.length < 2) throw new ToolError('A spline needs at least 2 points');
        ents.push({ type: 'spline', pts, ...(s.closed ? { closed: true } : {}) });
        break;
      }
      case 'ellipse': {
        const rx = Number(s.radius_x ?? s.rx);
        const ry = Number(s.radius_y ?? s.ry);
        if (!(rx > 0 && ry > 0)) throw new ToolError('An ellipse needs a positive radius_x and radius_y');
        ents.push({ type: 'ellipse', c: [at(s), at(s, 'y')], rx, ry, rot: (Number(s.angle || 0) * Math.PI) / 180 });
        break;
      }
      case 'slot': {
        const len = Number(s.length);
        const r = Number(s.width) / 2;
        if (!(r > 0 && len >= 2 * r)) throw new ToolError('A slot needs a width and a length at least as long as the width');
        const t = (Number(s.angle || 0) * Math.PI) / 180;
        const d = [Math.cos(t), Math.sin(t)];
        const n = [-d[1], d[0]];
        const h = len / 2 - r;
        const c1 = [at(s) - d[0] * h, at(s, 'y') - d[1] * h];
        const c2 = [at(s) + d[0] * h, at(s, 'y') + d[1] * h];
        const off = (c, k) => [c[0] + n[0] * r * k, c[1] + n[1] * r * k];
        if (h < 1e-9) {
          ents.push({ type: 'circle', c: c1, r });
          break;
        }
        ents.push({ type: 'line', a: off(c1, -1), b: off(c2, -1) });
        ents.push({ type: 'arc', c: c2, r, a0: t - Math.PI / 2, a1: t + Math.PI / 2 });
        ents.push({ type: 'line', a: off(c2, 1), b: off(c1, 1) });
        ents.push({ type: 'arc', c: c1, r, a0: t + Math.PI / 2, a1: t + (3 * Math.PI) / 2 });
        break;
      }
      case 'arc': {
        const d = Math.PI / 180;
        ents.push({ type: 'arc', c: [at(s), at(s, 'y')], r: Number(s.radius), a0: Number(s.start_angle ?? 0) * d, a1: Number(s.end_angle ?? 180) * d });
        break;
      }
      default:
        throw new ToolError(`Unknown shape type "${s.type}": use rect, circle, ellipse, slot, polygon, regular_polygon, line, arc or spline`);
    }
  }
  return { ents, cons };
}

function sketchPlane(app, { plane = 'XY', offset = 0, body_id, face }) {
  let p;
  if (body_id !== undefined && face !== undefined) {
    const b = bodyOf(app, body_id);
    const f = app.faceInfo(b.id, faceIndex(app, b.id, face));
    if (f?.type !== 'plane') throw new ToolError('That face is not flat');
    p = { origin: f.center, xDir: f.xDir, normal: f.normal };
  } else {
    p = PLANES[String(plane).toUpperCase()];
    if (!p) throw new ToolError(`Unknown plane "${plane}": use XY, XZ or YZ, or body_id with face`);
  }
  if (offset) p = { ...p, origin: p.origin.map((v, i) => v + p.normal[i] * offset) };
  return p;
}

// ---- the tools ---------------------------------------------------------------

const DO = {
  async get_design(app) {
    const out = {
      units_shown: app.units,
      bodies: app.doc.bodies.map((b) => ({ ...bodySummary(app, b), ...(b.visible === false ? { hidden: true } : {}) })),
      sketches: await Promise.all(app.doc.sketches.map((s) => sketchSummary(app, s))),
      steps: app.history.features.length,
    };
    const apart = notTouching(app);
    if (apart.length) out.not_touching_other_bodies = apart;
    return out;
  },

  async get_body(app, { body_id }) {
    const b = bodyOf(app, body_id);
    const m = app.bodyMesh(b.id);
    const faces = (m?.faceInfo || []).slice(0, 200).map((f, i) => ({ index: i, type: f.type, center: rv(f.center || [0, 0, 0]), ...(f.normal ? { normal: rv(f.normal) } : {}), area: r3(f.area || 0), ...(f.radius ? { radius: r3(f.radius) } : {}) }));
    const edges = (m?.edgeInfo || []).slice(0, 300).map((e, i) => ({ index: i, type: e.type, length: r3(e.length || 0), ...(e.a ? { from: rv(e.a), to: rv(e.b) } : {}), ...(e.radius ? { radius: r3(e.radius) } : {}) }));
    return { ...bodySummary(app, b), faces, edges };
  },

  async add_shape(app, a) {
    const shape = a.shape;
    const params = {
      box: { width: a.width ?? 20, depth: a.depth ?? a.width ?? 20, height: a.height ?? 20 },
      cylinder: { radius: a.radius ?? 10, height: a.height ?? 20 },
      sphere: { radius: a.radius ?? 10 },
      cone: { radius: a.radius ?? 10, topRadius: a.top_radius ?? 0, height: a.height ?? 20 },
      torus: { major: a.major ?? 15, minor: a.minor ?? 4 },
    }[shape];
    if (!params) throw new ToolError(`Unknown shape "${shape}"`);
    const [x, y, z] = (a.position || [0, 0, 0]).map(Number);
    // Turned around X, then Y, then Z (degrees), about `position`.
    const [ax, ay, az] = (a.rotation || [0, 0, 0]).map((v) => (Number(v || 0) * Math.PI) / 180);
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
    const R = [
      [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
      [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
      [-sy, cy * sx, cy * cx],
    ];
    const matrix = [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, x, y, z, 1];
    const was = new Map(app.doc.bodies.map((b) => [b.id, b.shapeId]));
    const res = await app.kernel.call('primitive', { type: shape, params, matrix });
    app.cmd.applyResult(shape[0].toUpperCase() + shape.slice(1), res);
    const out = changes(app, was);
    if (a.name && out.created?.[0]) {
      app.cmd.rename('body', out.created[0].id, a.name);
      out.created[0].name = a.name;
    }
    return out;
  },

  async sketch(app, a) {
    if (!Array.isArray(a.shapes) || !a.shapes.length) throw new ToolError('Give at least one shape');
    const plane = sketchPlane(app, a);
    const { ents, cons } = sketchEntities(a.shapes);
    const id = app.cmd.addSketchEntities(plane, null, ents, 'Sketch', cons, { fresh: true });
    return sketchSummary(app, app.doc.sketch(id));
  },

  async extrude(app, a) {
    const items = await profiles(app, a);
    const out = await runTool(app, 'extrude', { slots: { profiles: items }, values: { distance: a.distance, mode: a.mode || 'auto', symmetric: !!a.symmetric, through: !!a.through } });
    hideSketches(app, items.map((it) => it.sketchId).filter(Boolean));
    return out;
  },

  async revolve(app, a) {
    const items = await profiles(app, a);
    const out = await runTool(app, 'revolve', { slots: { profiles: items }, values: { worldAxis: String(a.axis).toLowerCase(), angle: a.angle ?? 360, mode: a.mode || 'auto' } });
    hideSketches(app, items.map((it) => it.sketchId));
    return out;
  },

  async loft(app, a) {
    const list = Array.isArray(a.profiles) ? a.profiles : [];
    if (list.length < 2) throw new ToolError('Give at least 2 profiles: [{sketch_id, region}, …] in order');
    const items = [];
    for (const p of list) {
      const got = await profiles(app, { sketch_id: p.sketch_id, regions: [Number(p.region ?? 0)] });
      items.push(...got);
    }
    const out = await runTool(app, 'loft', { slots: { profiles: items }, values: { mode: a.mode && a.mode !== 'auto' ? a.mode : 'new' } });
    hideSketches(app, items.map((it) => it.sketchId));
    return out;
  },

  async sweep(app, a) {
    const items = await profiles(app, { sketch_id: a.sketch_id, regions: [Number(a.region ?? 0)] });
    const path = sketchOf(app, a.path_sketch_id);
    if (!path.entities.length) throw new ToolError(`Sketch ${path.id} has no curves`);
    const out = await runTool(app, 'sweep', {
      slots: { profiles: items, path: path.entities.map((e) => ({ kind: 'curve', sketchId: path.id, entityId: e.id })) },
      values: { mode: a.mode && a.mode !== 'auto' ? a.mode : 'new', twist: Number(a.twist || 0), endScale: Number(a.end_scale ?? 1) },
    });
    hideSketches(app, [items[0].sketchId, path.id]);
    return out;
  },

  async fillet(app, a) {
    const b = bodyOf(app, a.body_id);
    const edges = edgeIndices(app, b.id, a.edges);
    if (!edges.length) throw new ToolError('No edges matched');
    return runTool(app, 'fillet', { slots: { edges: edges.map((index) => ({ kind: 'edge', bodyId: b.id, index })) }, values: { radius: a.radius } });
  },

  async chamfer(app, a) {
    const b = bodyOf(app, a.body_id);
    const edges = edgeIndices(app, b.id, a.edges);
    if (!edges.length) throw new ToolError('No edges matched');
    return runTool(app, 'chamfer', { slots: { edges: edges.map((index) => ({ kind: 'edge', bodyId: b.id, index })) }, values: { distance: a.distance } });
  },

  async shell(app, a) {
    const b = bodyOf(app, a.body_id);
    const faces = [].concat(a.open_faces).map((f) => ({ kind: 'face', bodyId: b.id, index: faceIndex(app, b.id, f) }));
    return runTool(app, 'shell', { slots: { faces }, values: { thickness: a.thickness, side: a.outside ? 'out' : 'in' } });
  },

  async boolean(app, a) {
    const ids = (a.body_ids || []).map((id) => bodyOf(app, id).id);
    if (ids.length < 2) throw new ToolError('Give at least two bodies');
    const body = (bodyId) => ({ kind: 'body', bodyId });
    if (a.operation === 'union') return runTool(app, 'union', { slots: { bodies: ids.map(body) } });
    if (a.operation !== 'subtract' && a.operation !== 'intersect') throw new ToolError('operation is union, subtract or intersect');
    return runTool(app, a.operation, { slots: { targets: [body(ids[0])], tools: ids.slice(1).map(body) }, values: { keepTools: !!a.keep_tools } });
  },

  async move(app, a) {
    const items = (a.ids || []).map((id) => itemOf(app, id));
    if (!items.length) throw new ToolError('Give the ids to move');
    return runTool(app, 'move', {
      slots: { items },
      before: (tool) => tool.setupPivot(),
      values: { x: a.x || 0, y: a.y || 0, z: a.z || 0, rx: a.rotate_x || 0, ry: a.rotate_y || 0, rz: a.rotate_z || 0, copy: !!a.copy },
    });
  },

  async pattern(app, a) {
    const bodies = (a.body_ids || []).map((id) => ({ kind: 'body', bodyId: bodyOf(app, id).id }));
    const axis = String(a.axis || (a.kind === 'circular' ? 'Z' : 'X')).toLowerCase();
    if (a.kind === 'circular') return runTool(app, 'patternCircular', { slots: { bodies }, values: { axis, count: a.count, angle: a.angle ?? 360, union: !!a.join } });
    return runTool(app, 'patternLinear', { slots: { bodies }, values: { axis, count: a.count, spacing: a.spacing ?? 20, mode: 'spacing', union: !!a.join } });
  },

  async mirror(app, a) {
    const bodies = (a.body_ids || []).map((id) => ({ kind: 'body', bodyId: bodyOf(app, id).id }));
    return runTool(app, 'mirror', { slots: { bodies }, values: { plane: String(a.plane).toLowerCase(), copy: a.keep_original ?? true, union: !!a.join } });
  },

  async set_color(app, a) {
    const ids = (a.body_ids || []).map((id) => bodyOf(app, id).id);
    if (!/^#[0-9a-f]{6}$/i.test(a.color || '')) throw new ToolError('color is like "#e53935"');
    app.cmd.setColor(ids, a.color.toLowerCase());
    return { colored: ids };
  },

  async rename(app, a) {
    const it = itemOf(app, a.id);
    app.cmd.rename(it.kind, it.bodyId || it.sketchId, a.name);
    return { renamed: it.bodyId || it.sketchId, name: a.name };
  },

  async delete(app, a) {
    const items = (a.ids || []).map((id) => itemOf(app, id));
    app.cmd.deleteItems(items);
    return { deleted: items.map((it) => it.bodyId || it.sketchId) };
  },

  async undo(app, a) {
    const n = Math.max(1, Math.min(50, Math.round(a.steps || 1)));
    const undone = [];
    for (let i = 0; i < n; i++) {
      const label = app.doc.undo();
      if (!label) break;
      undone.push(label);
    }
    return { undone };
  },

  async screenshot(app, a) {
    const view = a.view || 'all';
    // "all": four views in one picture, to check shape and placement.
    const views = view === 'all' ? ['iso', 'front', 'top', 'right'] : [view];
    const [w, h] = views.length > 1 ? [480, 360] : [800, 600];
    const canvas = document.createElement('canvas');
    canvas.width = views.length > 1 ? w * 2 : w;
    canvas.height = views.length > 1 ? h * 2 : h;
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < views.length; i++) {
      app.vp.setView(views[i], { fit: true });
      app.vp.rig.tick(performance.now() + 60000); // finish the camera move at once
      const img = new Image();
      img.src = app.vp.capture({ width: w, height: h });
      await img.decode();
      const [x, y] = [(i % 2) * w, Math.floor(i / 2) * h];
      g.drawImage(img, x, y, w, h);
      if (views.length > 1) {
        g.font = 'bold 18px sans-serif';
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x + 8, y + 8, g.measureText(views[i]).width + 16, 28);
        g.fillStyle = '#ffffff';
        g.fillText(views[i], x + 16, y + 29);
      }
    }
    if (views.length > 1) {
      g.fillStyle = '#888888';
      g.fillRect(w - 1, 0, 2, canvas.height);
      g.fillRect(0, h - 1, canvas.width, 2);
    }
    // A JPEG is a tenth of the size of the PNG the view gives.
    const text = views.length > 1 ? 'Four views: iso (top left), front = looking along +Y (top right), top = looking down (bottom left), right = looking along -X (bottom right)' : `View: ${view}`;
    return { image: canvas.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg', text };
  },
};

// Run a tool by name. Returns { text, image?, mime? } (image: base64) and
// never throws: problems come back as { text, error: true } so the AI can
// read them and try again.
export async function runAiTool(app, name, input = {}) {
  const fn = DO[name];
  if (!fn) return { text: `Unknown tool "${name}"`, error: true };
  try {
    const out = await fn(app, input || {});
    if (out && out.image) return { text: out.text || '', image: out.image, mime: out.mime || 'image/png' };
    return { text: JSON.stringify(out ?? { ok: true }) };
  } catch (err) {
    if (!app.tools.isSelect) app.tools.cancel();
    return { text: err instanceof ToolError ? err.message : `Error: ${err.message}`, error: true };
  }
}
