// Solid modelling tools.
import { OpTool } from './optool.js';
import { formatLength, niceStep } from '../core/units.js';
import { scaleMatrix } from '../core/replay.js';
import { tn } from '../core/i18n.js';

const AXES = {
  x: { origin: [0, 0, 0], dir: [1, 0, 0] },
  y: { origin: [0, 0, 0], dir: [0, 1, 0] },
  z: { origin: [0, 0, 0], dir: [0, 0, 1] },
};
const PLANES = {
  yz: { origin: [0, 0, 0], normal: [1, 0, 0] },
  xz: { origin: [0, 0, 0], normal: [0, 1, 0] },
  xy: { origin: [0, 0, 0], normal: [0, 0, 1] },
};

const MODE_OPTIONS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'new', label: 'New body' },
  { value: 'union', label: 'Join' },
  { value: 'subtract', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
];

function profileSlot(app, { multiple = true, label = 'Profiles' } = {}) {
  return {
    key: 'profiles',
    label,
    kinds: ['region', 'face'],
    multiple,
    placeholder: 'Click sketch regions or flat faces',
    reject: 'Only sketch regions and flat faces can be used as profiles',
    accept: (it) => {
      if (it.kind === 'region') return it;
      if (it.kind === 'face') return app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null;
      return null;
    },
    summary: (items) => tn(items.length, '1 profile', '{n} profiles'),
  };
}

function bodySlot(key = 'bodies', label = 'Bodies', extra = {}) {
  return {
    key,
    label,
    kinds: ['body'],
    multiple: true,
    placeholder: 'Click bodies',
    summary: (items) => tn(items.length, '1 body', '{n} bodies'),
    ...extra,
  };
}

// A plane taken from a body face, as the history records it.
function planeSource(app, it) {
  return { kind: 'face', id: app.doc.body(it.bodyId).shapeId, index: it.index };
}

// Combine several kernel results into one.
function merge(results) {
  return { bodies: results.flatMap((r) => r.bodies), removed: results.flatMap((r) => r.removed), calls: results.flatMap((r) => r.calls || []) };
}

// Closest point parameter along an axis line for a view ray.
function axisParam(ray, origin, dir) {
  const w0 = [ray.origin[0] - origin[0], ray.origin[1] - origin[1], ray.origin[2] - origin[2]];
  const d = ray.dir;
  const b = d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2];
  const dd = d[0] * w0[0] + d[1] * w0[1] + d[2] * w0[2];
  const e = dir[0] * w0[0] + dir[1] * w0[1] + dir[2] * w0[2];
  const den = 1 - b * b;
  if (Math.abs(den) < 1e-6) return null;
  return (e - b * dd) / den;
}

// ---- Extrude -----------------------------------------------------------

export class ExtrudeTool extends OpTool {
  inputs() {
    return [
      profileSlot(this.app),
      {
        key: 'until',
        label: 'Up to',
        kinds: ['face', 'plane'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a flat face to stop at (optional)',
        reject: 'Pick a flat face or a plane to stop at',
        accept: (it) => (this.planeOf(it) ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    const until = this.slots && this.items('until').length;
    return [
      ...(until ? [] : [{ type: 'length', key: 'distance', label: 'Distance', value: v.distance ?? this.app.settings.extrudeDistance ?? 10 }]),
      ...(until ? [] : [{ type: 'toggle', key: 'through', label: 'Through everything', value: v.through ?? false }]),
      { type: 'select', key: 'mode', label: 'Result', value: v.mode ?? 'auto', options: MODE_OPTIONS },
      { type: 'toggle', key: 'symmetric', label: 'Symmetric (both directions)', value: v.symmetric ?? false },
      { type: 'angle', key: 'taper', label: 'Taper (lean the sides in)', value: v.taper ?? 0 },
      { type: 'length', key: 'start', label: 'Start offset', value: v.start ?? 0 },
    ];
  }

  planeOf(it) {
    if (it.kind === 'plane') return this.app.doc.plane(it.planeId)?.plane || null;
    if (it.kind === 'face') {
      const info = this.app.faceInfo(it.bodyId, it.index);
      return info?.type === 'plane' ? { origin: info.center, normal: info.normal } : null;
    }
    return null;
  }

  // The distance to extrude: typed, up to a face, or through everything.
  length() {
    const v = this.values;
    const a = this.anchor();
    const until = this.items('until')[0];
    if (until && a) {
      const pl = this.planeOf(until);
      const den = a.normal.reduce((s, x, i) => s + x * pl.normal[i], 0);
      if (Math.abs(den) < 1e-9) throw new Error('That face is parallel to the extrude direction');
      const t = pl.origin.reduce((s, x, i) => s + (x - a.origin[i]) * pl.normal[i], 0) / den;
      return t - (Math.sign(t) || 1) * (v.start || 0);
    }
    if (v.through && a) {
      // Past the far side of every visible body.
      const sign = Math.sign(v.distance || 1);
      let far = 0;
      for (const b of this.app.doc.bodies) {
        if (b.visible === false) continue;
        const bb = this.app.bodyBox(b.id);
        if (!bb) continue;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) far = Math.max(far, sign * ([x, y, z].reduce((s, c, i) => s + (c - a.origin[i]) * a.normal[i], 0)));
      }
      return sign * (Math.max(far, Math.abs(v.distance || 1)) + 1);
    }
    return v.distance;
  }

  hint() {
    return 'Drag the arrow or type a distance. Negative values go the other way.';
  }

  init(opts) {
    if (opts.dragFrom) {
      this.values.distance = 0;
      this.dragging = true;
      this.onDragStart(opts.dragFrom);
    }
  }

  onParam(k, v) {
    if (k === 'distance') this.app.settings.extrudeDistance = v;
    if (k === 'through') this.render();
  }

  // Where the arrow sits and which way it points.
  anchor() {
    return this.app.profileAnchor(this.items('profiles'));
  }

  updateHandles() {
    const ov = this.app.vp.overlay;
    const a = this.anchor();
    ov.remove('tool-arrow');
    ov.removeLabel('tool-dist');
    if (!a) return;
    let d = this.values.distance || 0;
    try {
      d = this.length() || 0;
    } catch {}
    const tip = a.origin.map((o, i) => o + a.normal[i] * d);
    ov.arrow('tool-arrow', tip, a.normal, { color: this.app.vp.theme.select, length: 64 });
    ov.label('tool-dist', tip, formatLength(d, this.app.units), { className: 'accent', offset: [0, 26] });
  }

  onDragStart(e) {
    const a = this.anchor();
    if (!a) return;
    const t = axisParam(e.ray, a.origin, a.normal);
    this.grab = { a, offset: (t ?? 0) - (this.values.distance || 0) };
  }

  onDrag(e) {
    if (!this.grab) return;
    const { a, offset } = this.grab;
    const t = axisParam(e.ray, a.origin, a.normal);
    if (t === null) return;
    let d = t - offset;
    if (this.app.settings.snap) {
      const step = niceStep(this.app.vp.rig.pixelSize(null, this.app.vp.height) * 6);
      d = Math.round(d / step) * step;
    }
    if (d === this.values.distance) return;
    this.values.distance = d;
    this.app.panel.setValue('distance', d);
    this.schedule();
  }

  onDragEnd() {
    this.grab = null;
    if (Math.abs(this.values.distance) < 1e-9) return;
    this.app.settings.extrudeDistance = this.values.distance;
  }

  // Figure out targets and boolean mode.
  resolve() {
    const app = this.app;
    const profiles = this.items('profiles');
    let d = this.values.distance;
    try {
      d = this.length();
    } catch {}
    let mode = this.values.mode;
    const source = app.profileSourceBody(profiles);
    if (mode === 'auto') {
      if (source) mode = d >= 0 ? 'union' : 'subtract';
      else mode = 'new';
    }
    let targets = [];
    if (mode !== 'new') {
      if (source) targets = [source];
      else targets = app.overlappingBodies(profiles, d);
      if (!targets.length) mode = 'new';
    }
    return { mode, targets };
  }

  previewStyle() {
    const { mode } = this.resolve();
    return { mode };
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    const d = this.length();
    if (!d || Math.abs(d) < 1e-6) return null;
    await app.ensureRegions(profiles);
    const { mode, targets } = this.resolve();
    const v = this.values;
    return app.kernel.call('extrude', {
      profiles: profiles.map((p) => app.profileRef(p)),
      distance: d,
      symmetric: !!v.symmetric,
      mode,
      targets: targets.map((id) => app.doc.body(id).shapeId),
      ...(v.taper ? { taper: v.taper } : {}),
      ...(v.start ? { start: v.start } : {}),
    });
  }
}

// ---- Revolve ---------------------------------------------------------------

export class RevolveTool extends OpTool {
  inputs() {
    return [
      profileSlot(this.app),
      {
        key: 'axis',
        label: 'Axis',
        kinds: ['curve', 'edge', 'axis'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a line, straight edge or axis',
        reject: 'Pick a straight line or edge as the axis',
        accept: (it) => (this.app.axisOf(it) ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'worldAxis',
        label: 'Or world axis',
        value: v.worldAxis ?? 'none',
        options: [
          { value: 'none', label: 'Picked' },
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
        ],
      },
      { type: 'angle', key: 'angle', label: 'Angle', value: v.angle ?? 360 },
      { type: 'length', key: 'pitch', label: 'Rise per turn (helix, springs)', value: v.pitch ?? 0 },
      { type: 'select', key: 'mode', label: 'Result', value: v.mode ?? 'auto', options: MODE_OPTIONS },
    ];
  }

  hint() {
    return 'Pick profiles, then a line or edge to revolve around (or choose a world axis).';
  }

  ready() {
    return this.items('profiles').length > 0 && (this.items('axis').length > 0 || (this.values.worldAxis && this.values.worldAxis !== 'none'));
  }

  axis() {
    const w = this.values.worldAxis;
    if (w && w !== 'none') return AXES[w];
    const it = this.items('axis')[0];
    return it ? this.app.axisOf(it) : null;
  }

  updateHandles() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-axis');
    const ax = this.axis();
    if (!ax) return;
    const L = Math.max(50, this.app.vp.rig.dist * 0.6);
    ov.lines('tool-axis', [[ax.origin.map((o, i) => o - ax.dir[i] * L), ax.origin.map((o, i) => o + ax.dir[i] * L)]], { color: this.app.vp.theme.inference, width: 1.5, dashed: true, depthTest: false });
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    const axis = this.axis();
    if (!axis) return null;
    await app.ensureRegions(profiles);
    let mode = this.values.mode;
    const source = app.profileSourceBody(profiles);
    let targets = [];
    if (mode === 'auto') mode = source ? 'union' : 'new';
    if (mode !== 'new') {
      targets = source ? [source] : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.id);
      if (!targets.length) mode = 'new';
    }
    return app.kernel.call('revolve', {
      profiles: profiles.map((p) => app.profileRef(p)),
      axis,
      angle: this.values.angle,
      mode,
      targets: targets.map((id) => app.doc.body(id).shapeId),
      ...(this.values.pitch ? { pitch: this.values.pitch } : {}),
    });
  }
}

// ---- Sweep -----------------------------------------------------------------

export class SweepTool extends OpTool {
  inputs() {
    return [
      profileSlot(this.app, { multiple: false, label: 'Profile' }),
      { key: 'path', label: 'Path', kinds: ['curve', 'edge'], multiple: true, fromSelection: false, placeholder: 'Click connected curves or edges' },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'select', key: 'mode', label: 'Result', value: v.mode ?? 'new', options: MODE_OPTIONS.filter((o) => o.value !== 'auto') },
      { type: 'angle', key: 'twist', label: 'Twist', value: v.twist ?? 0, hint: 'How far the profile turns from start to end (e.g. 360 for one full turn)' },
      { type: 'number', key: 'endScale', label: 'Size at the end', value: v.endScale ?? 1, min: 0.01, hint: '1 keeps the size; 0.5 ends at half size, 2 at double' },
    ];
  }

  hint() {
    return 'Pick a profile, then the path it should follow. The path should start at the profile. Twist turns the profile along the way.';
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    await app.ensureRegions(profiles);
    const path = this.items('path').map((it) => app.pathRef(it)).filter(Boolean);
    const mode = this.values.mode;
    const targets = mode === 'new' ? [] : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.shapeId);
    const twist = this.values.twist || 0;
    const endScale = this.values.endScale ?? 1;
    return app.kernel.call('sweep', { profiles: profiles.map((p) => app.profileRef(p)), path, mode, targets, twist, endScale });
  }
}

// ---- Wrap & Emboss -------------------------------------------------------------

export class EmbossTool extends OpTool {
  inputs() {
    return [
      {
        key: 'profiles',
        label: 'Shapes',
        kinds: ['region'],
        multiple: true,
        placeholder: 'Click sketch shapes or letters',
        summary: (items) => tn(items.length, '1 shape', '{n} shapes'),
      },
      {
        key: 'face',
        label: 'Onto face',
        kinds: ['face'],
        multiple: false,
        fromSelection: false,
        placeholder: 'Click the face to put them on',
        reject: 'Pick a face of a solid body',
        accept: (it) => (this.app.faceInfo(it.bodyId, it.index) ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'length', key: 'height', label: 'Height', value: v.height ?? 1, hint: 'Positive raises the shapes, negative engraves them' },
      {
        type: 'choice',
        key: 'mode',
        label: 'Result',
        value: v.mode ?? 'auto',
        options: [
          { value: 'auto', label: 'Join / cut' },
          { value: 'new', label: 'New body' },
        ],
      },
    ];
  }

  hint() {
    return 'Pick sketch shapes (text works well), then a face: flat, round, a ball, a cone or a free-form surface. Draw on a plane facing the face: the shapes are wrapped on keeping their size where the plane touches it. A negative height engraves.';
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    const f = this.items('face')[0];
    const height = this.values.height;
    if (!f || !profiles.length || !height) return null;
    await app.ensureRegions(profiles);
    const body = app.doc.body(f.bodyId);
    return app.kernel.call('emboss', { profiles: profiles.map((p) => app.profileRef(p)), target: { id: body.shapeId, face: f.index }, height, mode: this.values.mode || 'auto' });
  }
}

// ---- Loft ------------------------------------------------------------------

export class LoftTool extends OpTool {
  inputs() {
    return [{ ...profileSlot(this.app), min: 2, placeholder: 'Click 2 or more profiles in order' }];
  }

  params() {
    return [{ type: 'select', key: 'mode', label: 'Result', value: this.values?.mode ?? 'new', options: MODE_OPTIONS.filter((o) => o.value !== 'auto') }];
  }

  hint() {
    return 'Pick profiles in the order the shape should pass through them.';
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    await app.ensureRegions(profiles);
    const mode = this.values.mode;
    const targets = mode === 'new' ? [] : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.shapeId);
    return app.kernel.call('loft', { profiles: profiles.map((p) => app.profileRef(p)), mode, targets });
  }
}

// ---- Fillet / Chamfer --------------------------------------------------------

class EdgeTool extends OpTool {
  inputs() {
    return [
      {
        key: 'edges',
        label: 'Edges',
        kinds: ['edge'],
        multiple: true,
        placeholder: 'Click edges',
        reject: 'Pick edges of solid bodies',
        accept: (it) => (this.app.doc.body(it.bodyId)?.kind === 'solid' ? it : null),
        summary: (items) => tn(items.length, '1 edge', '{n} edges'),
      },
    ];
  }

  hint() {
    return 'Click edges, then type a size. Click an edge again to remove it.';
  }

  async compute() {
    const app = this.app;
    const groups = new Map();
    for (const it of this.items('edges')) {
      if (!groups.has(it.bodyId)) groups.set(it.bodyId, []);
      groups.get(it.bodyId).push(it.index);
    }
    const results = [];
    for (const [bodyId, edges] of groups) {
      const body = app.doc.body(bodyId);
      results.push(await app.kernel.call(this.op, { id: body.shapeId, edges, ...this.kernelParams() }));
    }
    return merge(results);
  }
}

export class FilletTool extends EdgeTool {
  get op() {
    return 'fillet';
  }

  params() {
    return [{ type: 'length', key: 'radius', label: 'Radius', value: this.values?.radius ?? this.app.settings.filletRadius ?? 2, min: 0 }];
  }

  onParam(k, v) {
    this.app.settings.filletRadius = v;
  }

  kernelParams() {
    return { radius: this.values.radius };
  }
}

export class ChamferTool extends EdgeTool {
  get op() {
    return 'chamfer';
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'length', key: 'distance', label: 'Distance', value: v.distance ?? this.app.settings.chamferDistance ?? 1, min: 0 },
      { type: 'toggle', key: 'two', label: 'Two distances', value: v.two ?? false },
      ...(v.two ? [{ type: 'length', key: 'distance2', label: 'Second distance', value: v.distance2 ?? (v.distance ?? 1) * 2, min: 0 }] : []),
    ];
  }

  onParam(k, v) {
    if (k === 'distance') this.app.settings.chamferDistance = v;
    if (k === 'two') this.render();
  }

  kernelParams() {
    const v = this.values;
    return v.two ? { distance: v.distance, distance2: v.distance2 ?? v.distance * 2 } : { distance: v.distance };
  }
}

// ---- Shell -----------------------------------------------------------------

export class ShellTool extends OpTool {
  inputs() {
    return [
      {
        key: 'faces',
        label: 'Open faces',
        kinds: ['face'],
        multiple: true,
        placeholder: 'Click faces to remove',
        accept: (it) => (this.app.doc.body(it.bodyId)?.kind === 'solid' ? it : null),
        summary: (items) => tn(items.length, '1 face', '{n} faces'),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'length', key: 'thickness', label: 'Thickness', value: v.thickness ?? this.app.settings.shellThickness ?? 1, min: 0 },
      {
        type: 'choice',
        key: 'side',
        label: 'Walls',
        value: v.side ?? 'in',
        options: [
          { value: 'in', label: 'Inside' },
          { value: 'out', label: 'Outside' },
        ],
      },
    ];
  }

  hint() {
    return 'Click the faces to open up. The rest of the body becomes a thin wall.';
  }

  onParam(k, v) {
    if (k === 'thickness') this.app.settings.shellThickness = v;
  }

  async compute() {
    const faces = this.items('faces');
    const bodyId = faces[0].bodyId;
    if (faces.some((f) => f.bodyId !== bodyId)) throw new Error('Pick faces from a single body');
    const body = this.app.doc.body(bodyId);
    return this.app.kernel.call('shell', { id: body.shapeId, faces: faces.map((f) => f.index), thickness: this.values.thickness, outward: this.values.side === 'out' });
  }
}

// ---- Booleans ----------------------------------------------------------------

export class UnionTool extends OpTool {
  inputs() {
    return [bodySlot('bodies', 'Bodies', { min: 2, placeholder: 'Click 2 or more bodies' })];
  }

  params() {
    return [{ type: 'toggle', key: 'keepTargets', label: 'Keep the originals', value: this.values?.keepTargets ?? false }];
  }

  hint() {
    return 'Combine bodies into one.';
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('boolean', { op: 'union', targets: ids.slice(0, 1), tools: ids.slice(1), ...(this.values.keepTargets ? { keepTargets: true } : {}) });
  }
}

class TargetToolBoolean extends OpTool {
  inputs() {
    return [bodySlot('targets', 'Keep'), bodySlot('tools', this.toolLabel)];
  }

  params() {
    return [
      { type: 'toggle', key: 'keepTargets', label: 'Keep the bodies it changes', value: this.values?.keepTargets ?? false },
      { type: 'toggle', key: 'keepTools', label: this.keepLabel, value: this.values?.keepTools ?? false },
    ];
  }

  fillFromSelection() {
    // First selected body is the target, the rest are tools.
    const bodies = [];
    for (const it of this.app.selection.list) {
      const id = it.bodyId;
      if (id && (it.kind === 'body' || it.kind === 'face') && !bodies.includes(id)) bodies.push(id);
    }
    if (bodies.length) this.slots[0].items = [{ kind: 'body', bodyId: bodies[0] }];
    if (bodies.length > 1) this.slots[1].items = bodies.slice(1).map((bodyId) => ({ kind: 'body', bodyId }));
  }

  async compute() {
    const sid = (it) => this.app.doc.body(it.bodyId).shapeId;
    const targets = this.items('targets').map(sid);
    const tools = this.items('tools').map(sid);
    if (targets.some((t) => tools.includes(t))) throw new Error('A body cannot be both kept and used as a tool');
    return this.app.kernel.call('boolean', { op: this.op, targets, tools, keepTools: !!this.values.keepTools, ...(this.values.keepTargets ? { keepTargets: true } : {}) });
  }
}

export class SubtractTool extends TargetToolBoolean {
  get op() {
    return 'subtract';
  }
  get toolLabel() {
    return 'Remove';
  }
  get keepLabel() {
    return 'Keep the bodies used to cut';
  }
  hint() {
    return 'Cut the second set of bodies out of the first.';
  }
}

export class IntersectTool extends TargetToolBoolean {
  get op() {
    return 'intersect';
  }
  get toolLabel() {
    return 'With';
  }
  get keepLabel() {
    return 'Keep the second set of bodies';
  }
  hint() {
    return 'Keep only the volume the bodies share.';
  }
}

// ---- Split -------------------------------------------------------------------

export class SplitTool extends OpTool {
  inputs() {
    return [
      bodySlot('body', 'Body', { multiple: false, placeholder: 'Click a body', accept: (it) => (this.app.doc.body(it.bodyId)?.kind === 'solid' ? it : null) }),
      {
        key: 'face',
        label: 'Cut with',
        kinds: ['face', 'plane'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a flat face or plane (optional)',
        accept: (it) => (it.kind === 'plane' || this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'plane',
        label: 'Or plane',
        value: v.plane ?? 'xy',
        options: [
          { value: 'xy', label: 'XY' },
          { value: 'xz', label: 'XZ' },
          { value: 'yz', label: 'YZ' },
        ],
      },
      { type: 'length', key: 'offset', label: 'Offset', value: v.offset ?? 0 },
    ];
  }

  hint() {
    return 'Split a body into two with a flat face or a plane.';
  }

  plane() {
    const f = this.items('face')[0];
    if (f?.kind === 'plane') {
      const pl = this.app.doc.plane(f.planeId).plane;
      return { origin: pl.origin, normal: pl.normal };
    }
    if (f) {
      const info = this.app.faceInfo(f.bodyId, f.index);
      return { origin: info.center, normal: info.normal };
    }
    const p = PLANES[this.values.plane || 'xy'];
    const o = this.values.offset || 0;
    return { origin: p.normal.map((n) => n * o), normal: p.normal };
  }

  // For the history: where the plane came from.
  planeFrom() {
    const f = this.items('face')[0];
    if (f && f.kind !== 'plane') return planeSource(this.app, f);
    if (f) return { kind: 'fixed', plane: this.plane() };
    const p = PLANES[this.values.plane || 'xy'];
    return { kind: 'fixed', plane: { origin: [0, 0, 0], normal: p.normal }, offset: this.values.offset || 0 };
  }

  updateHandles() {
    this.app.showPlaneOverlay('tool-plane', this.plane());
  }

  async compute() {
    const body = this.app.doc.body(this.items('body')[0].bodyId);
    return this.app.kernel.call('split', { id: body.shapeId, plane: this.plane(), planeFrom: this.planeFrom() });
  }
}

// ---- Mirror ------------------------------------------------------------------

export class MirrorTool extends OpTool {
  inputs() {
    return [
      bodySlot(),
      {
        key: 'face',
        label: 'Mirror plane',
        kinds: ['face', 'plane'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a flat face or plane (optional)',
        accept: (it) => (it.kind === 'plane' || this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'plane',
        label: 'Or plane',
        value: v.plane ?? 'yz',
        options: [
          { value: 'yz', label: 'YZ' },
          { value: 'xz', label: 'XZ' },
          { value: 'xy', label: 'XY' },
        ],
      },
      { type: 'toggle', key: 'copy', label: 'Keep the original (make a copy)', value: v.copy ?? true },
      { type: 'toggle', key: 'union', label: 'Join the copy with the original', value: v.union ?? false },
    ];
  }

  plane() {
    const f = this.items('face')[0];
    if (f?.kind === 'plane') {
      const pl = this.app.doc.plane(f.planeId).plane;
      return { origin: pl.origin, normal: pl.normal };
    }
    if (f) {
      const info = this.app.faceInfo(f.bodyId, f.index);
      return { origin: info.center, normal: info.normal };
    }
    return PLANES[this.values.plane || 'yz'];
  }

  planeFrom() {
    const f = this.items('face')[0];
    if (f && f.kind !== 'plane') return planeSource(this.app, f);
    return { kind: 'fixed', plane: this.plane() };
  }

  updateHandles() {
    this.app.showPlaneOverlay('tool-plane', this.plane());
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('mirror', { ids, plane: this.plane(), planeFrom: this.planeFrom(), copy: this.values.copy !== false, union: !!this.values.union });
  }
}

// ---- Patterns ----------------------------------------------------------------

export class LinearPatternTool extends OpTool {
  inputs() {
    return [
      bodySlot(),
      { key: 'edge', label: 'Direction', kinds: ['edge', 'curve', 'axis'], multiple: false, optional: true, fromSelection: false, placeholder: 'Click a straight edge or axis (optional)', accept: (it) => (this.app.axisOf(it) ? it : null) },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'axis',
        label: 'Or axis',
        value: v.axis ?? 'x',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
        ],
      },
      { type: 'count', key: 'count', label: 'Count', value: v.count ?? 3, min: 2, max: 500 },
      {
        type: 'choice',
        key: 'mode',
        label: 'Distance is',
        value: v.mode ?? 'spacing',
        options: [
          { value: 'spacing', label: 'Between copies' },
          { value: 'total', label: 'Total' },
        ],
      },
      { type: 'length', key: 'spacing', label: 'Distance', value: v.spacing ?? this.app.settings.patternSpacing ?? 20 },
      ...this.moreFields(2, v),
      ...this.moreFields(3, v),
      { type: 'toggle', key: 'union', label: 'Join copies into one body', value: v.union ?? false },
    ];
  }

  // A second and third direction (grid patterns).
  moreFields(k, v) {
    const on = (v[`dir${k}`] ?? 'none') !== 'none';
    if (k === 3 && (v.dir2 ?? 'none') === 'none') return [];
    const out = [
      {
        type: 'choice',
        key: `dir${k}`,
        label: k === 2 ? 'Second direction' : 'Third direction',
        value: v[`dir${k}`] ?? 'none',
        options: [
          { value: 'none', label: 'None' },
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
        ],
      },
    ];
    if (on) out.push({ type: 'count', key: `count${k}`, label: 'Count', value: v[`count${k}`] ?? 2, min: 2, max: 500 }, { type: 'length', key: `spacing${k}`, label: 'Distance', value: v[`spacing${k}`] ?? 20 });
    return out;
  }

  onParam(k) {
    if (k === 'dir2' || k === 'dir3') this.render();
  }

  direction() {
    const e = this.items('edge')[0];
    if (e) return this.app.axisOf(e).dir;
    return AXES[this.values.axis || 'x'].dir;
  }

  // Distance between neighbouring copies.
  step(total, count) {
    return this.values.mode === 'total' ? total / Math.max(1, count - 1) : total;
  }

  async compute() {
    const v = this.values;
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    const more = [2, 3]
      .filter((k) => (v[`dir${k}`] ?? 'none') !== 'none' && (k === 2 || (v.dir2 ?? 'none') !== 'none'))
      .map((k) => ({ direction: AXES[v[`dir${k}`]].dir, count: v[`count${k}`] ?? 2, spacing: this.step(v[`spacing${k}`] ?? 20, v[`count${k}`] ?? 2) }));
    return this.app.kernel.call('pattern', { ids, kind: 'linear', count: v.count, spacing: this.step(v.spacing, v.count), direction: this.direction(), ...(more.length ? { more } : {}), union: !!v.union });
  }
}

export class CircularPatternTool extends OpTool {
  inputs() {
    return [
      bodySlot(),
      { key: 'edge', label: 'Axis', kinds: ['edge', 'curve', 'axis'], multiple: false, optional: true, fromSelection: false, placeholder: 'Click an edge or axis (optional)', accept: (it) => (this.app.axisOf(it, { circles: true }) ? it : null) },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'axis',
        label: 'Or axis',
        value: v.axis ?? 'z',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
        ],
      },
      { type: 'count', key: 'count', label: 'Count', value: v.count ?? 6, min: 2, max: 500 },
      { type: 'angle', key: 'angle', label: 'Total angle', value: v.angle ?? 360 },
      { type: 'toggle', key: 'keepTurn', label: 'Keep the direction (copies are not turned)', value: v.keepTurn ?? false },
      { type: 'toggle', key: 'union', label: 'Join copies into one body', value: v.union ?? false },
    ];
  }

  axis() {
    const e = this.items('edge')[0];
    if (e) return this.app.axisOf(e, { circles: true });
    return AXES[this.values.axis || 'z'];
  }

  updateHandles() {
    const ov = this.app.vp.overlay;
    const ax = this.axis();
    const L = Math.max(50, this.app.vp.rig.dist * 0.6);
    ov.lines('tool-axis', [[ax.origin.map((o, i) => o - ax.dir[i] * L), ax.origin.map((o, i) => o + ax.dir[i] * L)]], { color: this.app.vp.theme.inference, width: 1.5, dashed: true, depthTest: false });
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('pattern', { ids, kind: 'circular', count: this.values.count, angle: this.values.angle, axis: this.axis(), union: !!this.values.union, ...(this.values.keepTurn ? { keepTurn: true } : {}) });
  }
}

// ---- Scale -------------------------------------------------------------------

export class ScaleTool extends OpTool {
  inputs() {
    return [bodySlot()];
  }

  params() {
    const v = this.values || {};
    const stretch = v.type === 'stretch';
    return [
      {
        type: 'choice',
        key: 'type',
        label: 'Type',
        value: v.type ?? 'uniform',
        options: [
          { value: 'uniform', label: 'Uniform' },
          { value: 'stretch', label: 'X, Y and Z', title: 'Stretch each direction on its own (meshes only)' },
        ],
      },
      ...(stretch
        ? [
            { type: 'number', key: 'fx', label: 'Scale X', value: v.fx ?? 1, min: 0.0001 },
            { type: 'number', key: 'fy', label: 'Scale Y', value: v.fy ?? 1, min: 0.0001 },
            { type: 'number', key: 'fz', label: 'Scale Z', value: v.fz ?? 2, min: 0.0001 },
          ]
        : [{ type: 'number', key: 'factor', label: 'Scale factor', value: v.factor ?? 2, min: 0.0001 }]),
      {
        type: 'choice',
        key: 'about',
        label: 'Around',
        value: v.about ?? 'center',
        options: [
          { value: 'center', label: 'Body center' },
          { value: 'origin', label: 'Origin' },
          { value: 'base', label: 'Base' },
        ],
      },
      { type: 'toggle', key: 'copy', label: 'Make a copy', value: v.copy ?? false },
      { type: 'info', text: 'Tip: imported STL files in inches or meters can be fixed with 25.4 or 1000.' },
    ];
  }

  get label() {
    return this.values?.copy ? 'Copy' : this.def.label;
  }

  onParam(k) {
    if (k === 'type') this.render();
  }

  async compute() {
    const app = this.app;
    const v = this.values;
    const stretch = v.type === 'stretch';
    const f = v.factor;
    const fs = [v.fx ?? 1, v.fy ?? 1, v.fz ?? 2];
    if (stretch ? !fs.every((x) => x > 0) : !(f > 0)) throw new Error('Scale factor must be greater than zero');
    const out = [];
    for (const it of this.items('bodies')) {
      const body = app.doc.body(it.bodyId);
      if (stretch && body.kind !== 'mesh') throw new Error('Stretching X, Y and Z separately works on meshes only. Use Uniform for solids.');
      const bb = app.bodyBox(body.id);
      let c = [0, 0, 0];
      if (this.values.about !== 'origin' && bb) {
        c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
        if (this.values.about === 'base') c[2] = bb.min.z;
      }
      const scale = stretch ? { factors: fs, center: c } : { factor: f, center: c };
      out.push(await app.kernel.call('transform', { ids: [body.shapeId], matrix: scaleMatrix(scale), scale, copy: !!v.copy }));
    }
    return merge(out);
  }
}


// ---- Draft -------------------------------------------------------------------

export class DraftTool extends OpTool {
  inputs() {
    return [
      {
        key: 'faces',
        label: 'Faces',
        kinds: ['face'],
        multiple: true,
        placeholder: 'Click the side faces to tilt',
        accept: (it) => (this.app.doc.body(it.bodyId)?.kind === 'solid' ? it : null),
        summary: (items) => tn(items.length, '1 face', '{n} faces'),
      },
      {
        key: 'neutral',
        label: 'Fixed face',
        kinds: ['face'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Face that keeps its size (optional)',
        accept: (it) => (this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'angle', key: 'angle', label: 'Angle', value: v.angle ?? 3 },
      {
        type: 'choice',
        key: 'pull',
        label: 'Pull direction',
        value: v.pull ?? 'z',
        options: [
          { value: 'x', label: 'X' },
          { value: 'y', label: 'Y' },
          { value: 'z', label: 'Z' },
        ],
      },
    ];
  }

  hint() {
    return 'Tilts faces so a part can come out of a mould. The fixed face (or the bottom of the body) keeps its size.';
  }

  plane() {
    const app = this.app;
    const n = this.items('neutral')[0];
    if (n) {
      const info = app.faceInfo(n.bodyId, n.index);
      return { origin: info.center, normal: info.normal };
    }
    const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[this.values.pull || 'z'];
    const f = this.items('faces')[0];
    const bb = f ? app.bodyBox(f.bodyId) : null;
    const k = { x: 'x', y: 'y', z: 'z' }[this.values.pull || 'z'];
    const origin = [0, 0, 0];
    if (bb) origin[['x', 'y', 'z'].indexOf(k)] = bb.min[k];
    return { origin, normal: axis };
  }

  async compute() {
    const faces = this.items('faces');
    const bodyId = faces[0].bodyId;
    if (faces.some((f) => f.bodyId !== bodyId)) throw new Error('Pick faces from a single body');
    const body = this.app.doc.body(bodyId);
    const n = this.items('neutral')[0];
    const planeFrom = n ? planeSource(this.app, n) : { kind: 'fixed', plane: this.plane() };
    return this.app.kernel.call('draft', { id: body.shapeId, faces: faces.map((f) => f.index), angle: this.values.angle, plane: this.plane(), planeFrom });
  }
}
