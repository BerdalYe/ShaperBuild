// Solid modelling tools.
import { OpTool } from './optool.js';
import { formatLength, niceStep } from '../core/units.js';

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
    summary: (items) => `${items.length} profile${items.length === 1 ? '' : 's'}`,
  };
}

function bodySlot(key = 'bodies', label = 'Bodies', extra = {}) {
  return {
    key,
    label,
    kinds: ['body'],
    multiple: true,
    placeholder: 'Click bodies',
    summary: (items) => `${items.length} bod${items.length === 1 ? 'y' : 'ies'}`,
    ...extra,
  };
}

// Combine several kernel results into one.
function merge(results) {
  return { bodies: results.flatMap((r) => r.bodies), removed: results.flatMap((r) => r.removed) };
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
    return [profileSlot(this.app)];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'length', key: 'distance', label: 'Distance', value: v.distance ?? this.app.settings.extrudeDistance ?? 10 },
      { type: 'select', key: 'mode', label: 'Result', value: v.mode ?? 'auto', options: MODE_OPTIONS },
      { type: 'toggle', key: 'symmetric', label: 'Symmetric (both directions)', value: v.symmetric ?? false },
    ];
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
    const d = this.values.distance || 0;
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
    const d = this.values.distance;
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
    const d = this.values.distance;
    if (!d || Math.abs(d) < 1e-6) return null;
    await app.ensureRegions(profiles);
    const { mode, targets } = this.resolve();
    return app.kernel.call('extrude', {
      profiles: profiles.map((p) => app.profileRef(p)),
      distance: d,
      symmetric: !!this.values.symmetric,
      mode,
      targets: targets.map((id) => app.doc.body(id).shapeId),
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
        kinds: ['curve', 'edge'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a line or straight edge',
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
    return [{ type: 'select', key: 'mode', label: 'Result', value: this.values?.mode ?? 'new', options: MODE_OPTIONS.filter((o) => o.value !== 'auto') }];
  }

  hint() {
    return 'Pick a profile, then the path it should follow. The path should start at the profile.';
  }

  async compute() {
    const app = this.app;
    const profiles = this.items('profiles');
    await app.ensureRegions(profiles);
    const path = this.items('path').map((it) => app.pathRef(it)).filter(Boolean);
    const mode = this.values.mode;
    const targets = mode === 'new' ? [] : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.shapeId);
    return app.kernel.call('sweep', { profiles: profiles.map((p) => app.profileRef(p)), path, mode, targets });
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
        summary: (items) => `${items.length} edge${items.length === 1 ? '' : 's'}`,
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
    return [{ type: 'length', key: 'distance', label: 'Distance', value: this.values?.distance ?? this.app.settings.chamferDistance ?? 1, min: 0 }];
  }

  onParam(k, v) {
    this.app.settings.chamferDistance = v;
  }

  kernelParams() {
    return { distance: this.values.distance };
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
        summary: (items) => `${items.length} face${items.length === 1 ? '' : 's'}`,
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
    return [];
  }

  hint() {
    return 'Combine bodies into one.';
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('boolean', { op: 'union', targets: ids.slice(0, 1), tools: ids.slice(1) });
  }
}

class TargetToolBoolean extends OpTool {
  inputs() {
    return [bodySlot('targets', 'Keep'), bodySlot('tools', this.toolLabel)];
  }

  params() {
    return [{ type: 'toggle', key: 'keepTools', label: `Keep the ${this.toolLabel.toLowerCase()} bodies`, value: this.values?.keepTools ?? false }];
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
    return this.app.kernel.call('boolean', { op: this.op, targets, tools, keepTools: !!this.values.keepTools });
  }
}

export class SubtractTool extends TargetToolBoolean {
  get op() {
    return 'subtract';
  }
  get toolLabel() {
    return 'Remove';
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
        kinds: ['face'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a flat face (optional)',
        accept: (it) => (this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
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
    if (f) {
      const info = this.app.faceInfo(f.bodyId, f.index);
      return { origin: info.center, normal: info.normal };
    }
    const p = PLANES[this.values.plane || 'xy'];
    const o = this.values.offset || 0;
    return { origin: p.normal.map((n) => n * o), normal: p.normal };
  }

  updateHandles() {
    this.app.showPlaneOverlay('tool-plane', this.plane());
  }

  async compute() {
    const body = this.app.doc.body(this.items('body')[0].bodyId);
    return this.app.kernel.call('split', { id: body.shapeId, plane: this.plane() });
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
        kinds: ['face'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'Click a flat face (optional)',
        accept: (it) => (this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
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
    if (f) {
      const info = this.app.faceInfo(f.bodyId, f.index);
      return { origin: info.center, normal: info.normal };
    }
    return PLANES[this.values.plane || 'yz'];
  }

  updateHandles() {
    this.app.showPlaneOverlay('tool-plane', this.plane());
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('mirror', { ids, plane: this.plane(), copy: this.values.copy !== false, union: !!this.values.union });
  }
}

// ---- Patterns ----------------------------------------------------------------

export class LinearPatternTool extends OpTool {
  inputs() {
    return [
      bodySlot(),
      { key: 'edge', label: 'Direction', kinds: ['edge', 'curve'], multiple: false, optional: true, fromSelection: false, placeholder: 'Click a straight edge (optional)', accept: (it) => (this.app.axisOf(it) ? it : null) },
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
      { type: 'length', key: 'spacing', label: 'Spacing', value: v.spacing ?? this.app.settings.patternSpacing ?? 20 },
      { type: 'toggle', key: 'union', label: 'Join copies into one body', value: v.union ?? false },
    ];
  }

  direction() {
    const e = this.items('edge')[0];
    if (e) return this.app.axisOf(e).dir;
    return AXES[this.values.axis || 'x'].dir;
  }

  async compute() {
    const ids = this.items('bodies').map((it) => this.app.doc.body(it.bodyId).shapeId);
    return this.app.kernel.call('pattern', { ids, kind: 'linear', count: this.values.count, spacing: this.values.spacing, direction: this.direction(), union: !!this.values.union });
  }
}

export class CircularPatternTool extends OpTool {
  inputs() {
    return [
      bodySlot(),
      { key: 'edge', label: 'Axis', kinds: ['edge', 'curve'], multiple: false, optional: true, fromSelection: false, placeholder: 'Click an edge (optional)', accept: (it) => (this.app.axisOf(it, { circles: true }) ? it : null) },
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
    return this.app.kernel.call('pattern', { ids, kind: 'circular', count: this.values.count, angle: this.values.angle, axis: this.axis(), union: !!this.values.union });
  }
}

// ---- Scale -------------------------------------------------------------------

export class ScaleTool extends OpTool {
  inputs() {
    return [bodySlot()];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'number', key: 'factor', label: 'Scale factor', value: v.factor ?? 2, min: 0.0001 },
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
      { type: 'info', text: 'Tip: imported STL files in inches or meters can be fixed with 25.4 or 1000.' },
    ];
  }

  async compute() {
    const app = this.app;
    const f = this.values.factor;
    if (!(f > 0)) throw new Error('Scale factor must be greater than zero');
    const out = [];
    for (const it of this.items('bodies')) {
      const body = app.doc.body(it.bodyId);
      const bb = app.bodyBox(body.id);
      let c = [0, 0, 0];
      if (this.values.about !== 'origin' && bb) {
        c = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
        if (this.values.about === 'base') c[2] = bb.min.z;
      }
      const m = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, f, 0, c[0] * (1 - f), c[1] * (1 - f), c[2] * (1 - f), 1];
      out.push(await app.kernel.call('transform', { ids: [body.shapeId], matrix: m }));
    }
    return merge(out);
  }
}

