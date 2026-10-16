// Sketch drawing tools. Click on the grid, any flat face or an existing
// sketch to draw on that plane. Points snap to existing geometry, the grid
// and horizontal/vertical alignments. Start typing to enter exact sizes.
import { Tool } from './base.js';
import { add, sub, mul, len, dist, angleOf, polar, normAngle, arcFrom3Points, samePoint, sampleSpline, regularPolygon, TAU, sweep } from '../core/geom2d.js';
import { planeFrame, to2D, to3D, rayPlane, GROUND, makePlane, samePlane } from '../core/plane.js';
import { formatLength } from '../core/units.js';

const DEG = Math.PI / 180;

export class SketchTool extends Tool {
  get pickKinds() {
    return ['spoint', 'curve', 'region', 'face', 'body', 'plane'];
  }

  get options() {
    return [];
  }

  activate() {
    this.plane = null;
    this.sketchId = null;
    this.pts = [];
    this.construction = !!this.app.settings.drawConstruction;
    this.cursor = null;
    this.showPanel();
    this.setHint(this.startHint());
  }

  deactivate() {
    const ov = this.app.vp.overlay;
    ov.clear('tool');
    this.app.dim.hide();
    this.app.vp.setGridPlane(null);
    this.app.selection.setHover(null);
  }

  startHint() {
    return 'Click on the grid, a flat face or a sketch to start drawing';
  }

  showPanel() {
    const fields = [...this.options, { type: 'toggle', key: 'construction', label: 'Construction geometry (not used for profiles)', value: this.construction }];
    this.app.panel.show({
      title: this.def.label,
      icon: this.def.icon,
      hint: this.def.panelHint || '',
      fields,
      onChange: (key, value) => this.onOption(key, value),
      onCancel: () => this.done(),
    });
  }

  onOption(key, value) {
    if (key === 'construction') {
      this.construction = value;
      this.app.settings.drawConstruction = value;
      this.app.saveSettings();
    }
  }

  // ---- plane handling ------------------------------------------------------

  planeUnder(e) {
    const app = this.app;
    const hit = e.pick(this.pickKinds);
    if (hit && (hit.kind === 'spoint' || hit.kind === 'curve' || hit.kind === 'region')) {
      const sk = app.doc.sketch(hit.sketchId);
      if (sk) return { plane: sk.plane, sketchId: sk.id, hit };
    }
    if (hit && hit.kind === 'face') {
      const info = app.faceInfo(hit.bodyId, hit.index);
      if (info && info.type === 'plane') {
        const plane = makePlane(info.center, info.normal, info.xDir);
        return { plane, sketchId: app.findSketchOnPlane(plane), hit };
      }
    }
    if (hit && hit.kind === 'plane') {
      const pl = app.doc.plane(hit.planeId);
      if (pl) return { plane: pl.plane, sketchId: app.findSketchOnPlane(pl.plane), hit };
    }
    if (hit && hit.kind === 'body' && hit.normal && hit.point) {
      const plane = makePlane(hit.point, hit.normal);
      return { plane, sketchId: app.findSketchOnPlane(plane), hit };
    }
    const groundHit = rayPlane(e.ray.origin, e.ray.dir, GROUND);
    if (groundHit || Math.abs(e.ray.dir[2]) > 1e-3) return { plane: GROUND, sketchId: app.findSketchOnPlane(GROUND), hit: null };
    return null;
  }

  lockPlane(info) {
    this.plane = info.plane;
    this.sketchId = info.sketchId || null;
    this.frame = planeFrame(this.plane);
    if (!samePlane(this.plane, GROUND)) this.app.vp.setGridPlane(this.plane);
    this.app.selection.setHover(null);
  }

  // Cursor in plane coordinates with snapping.
  pointer(e, opts = {}) {
    if (!this.plane) return null;
    let P = rayPlane(e.ray.origin, e.ray.dir, this.plane);
    if (!P) P = rayPlane(e.ray.origin, e.ray.dir.map((v) => -v), this.plane);
    if (!P) return null;
    const raw = to2D(this.frame, P);
    const snapped = this.app.snapPoint(this.plane, raw, e, { from: this.pts[this.pts.length - 1], extra: this.pts, sketchId: this.sketchId, ...opts });
    this.showSnap(snapped);
    return snapped.p;
  }

  showSnap(s) {
    const ov = this.app.vp.overlay;
    const t = this.app.vp.theme;
    ov.remove('tool-guide');
    ov.removeLabel('tool-snaplabel');
    if (!s.snap) {
      ov.dots('tool-snap', [to3D(this.frame, s.p)], { color: t.sketchActive, size: 7 });
      return;
    }
    ov.dots('tool-snap', [to3D(this.frame, s.p)], { color: t.snap, size: 10 });
    if (s.snap.guides?.length) ov.lines('tool-guide', s.snap.guides.map(([a, b]) => [to3D(this.frame, a), to3D(this.frame, b)]), { color: t.inference, width: 1.2, dashed: true, depthTest: false, opacity: 0.9 });
    if (s.snap.label) ov.label('tool-snaplabel', to3D(this.frame, s.p), s.snap.label, { className: 'snap', offset: [0, -16] });
  }

  // ---- event flow ------------------------------------------------------------

  onPointerMove(e) {
    const app = this.app;
    if (!this.plane) {
      const info = this.planeUnder(e);
      this.hoverInfo = info;
      app.selection.setHover(info?.hit && info.hit.kind === 'face' ? info.hit : null);
      const ov = app.vp.overlay;
      if (info) {
        const f = planeFrame(info.plane);
        const P = rayPlane(e.ray.origin, e.ray.dir, info.plane) || rayPlane(e.ray.origin, e.ray.dir.map((v) => -v), info.plane);
        if (P) {
          this.frame = f;
          this.plane = info.plane;
          const s = app.snapPoint(info.plane, to2D(f, P), e, { sketchId: info.sketchId, extra: [] });
          this.showSnap(s);
          this.plane = null;
        }
      } else ov.clear('tool-snap');
      return;
    }
    this.cursor = this.pointer(e);
    if (this.cursor) this.preview(this.cursor, e);
  }

  onPointerDown(e) {
    if (!this.plane) {
      const info = this.planeUnder(e);
      if (!info) return;
      this.lockPlane(info);
    }
    const p = this.pointer(e);
    if (!p) return;
    this.cursor = p;
    this.click(p, e);
    // Show the size boxes right away so values can be typed without moving.
    if (this.pts.length) this.preview(p, e);
  }

  onDblClick() {
    this.finish?.();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.pts.length) {
        this.reset();
        return true;
      }
      this.done();
      return true;
    }
    if (e.key === 'Enter') {
      this.finish?.();
      return true;
    }
    if (this.pts.length && this.app.dim.takeKey(e)) return true;
    return false;
  }

  reset() {
    this.pts = [];
    this.app.vp.overlay.clear('tool-rb');
    this.app.vp.overlay.clear('tool-dim');
    this.app.dim.hide();
    this.setHint(this.continueHint ? this.continueHint() : this.startHint());
  }

  // Add entities (plane coordinates) to the sketch on the current plane.
  // Constraints may refer to the new entities as '#0', '#1', …
  commit(entities, label, constraints = []) {
    const ents = entities.map((en) => ({ ...en, construction: this.construction || undefined }));
    this.sketchId = this.app.cmd.addSketchEntities(this.plane, this.sketchId, ents, label || this.def.label, constraints);
  }

  // Rubber-band drawing helpers.
  rubber(polylines) {
    const t = this.app.vp.theme;
    this.app.vp.overlay.lines('tool-rb', polylines.map((pl) => pl.map((p) => to3D(this.frame, p))), { color: t.select, width: 2, dashed: this.construction });
  }

  dims(fields, e, onCommit) {
    this.app.dim.show(fields, e.x, e.y, { onCommit: (values) => onCommit(values), onChange: () => this.cursor && this.preview(this.cursor, e) });
  }

  get locked() {
    return this.app.dim.locked;
  }

  dimLabel(key, a, b, text) {
    const ov = this.app.vp.overlay;
    ov.label(`tool-dim-${key}`, to3D(this.frame, mul(add(a, b), 0.5)), text, { className: 'muted', offset: [0, -14] });
  }

  fmt(v) {
    return formatLength(v, this.app.units);
  }
}

// ---- Line ----------------------------------------------------------------

export class LineTool extends SketchTool {
  continueHint() {
    return 'Click to add the next point · click the first point to close · <kbd>Enter</kbd> / double-click to finish · type a length';
  }

  endFor(cursor) {
    const a = this.pts[this.pts.length - 1];
    const L = this.locked;
    let dir = sub(cursor, a);
    let length = len(dir);
    let ang = angleOf(dir);
    if ('angle' in L) ang = L.angle * DEG;
    if ('length' in L) length = L.length;
    if (!('length' in L) && 'angle' in L) {
      // Project the cursor onto the locked direction.
      const u = [Math.cos(ang), Math.sin(ang)];
      length = dir[0] * u[0] + dir[1] * u[1];
    }
    return polar(a, length, ang);
  }

  preview(p, e) {
    if (!this.pts.length) return;
    const a = this.pts[this.pts.length - 1];
    const b = this.endFor(p);
    this.rubber([[a, b]]);
    const d = sub(b, a);
    let ang = angleOf(d) / DEG;
    if (ang < 0) ang += 360;
    this.dims(
      [
        { key: 'length', label: 'L', type: 'length', value: len(d) },
        { key: 'angle', label: '∠', type: 'angle', value: ang },
      ],
      e,
      () => this.place(this.endFor(this.cursor || b)),
    );
  }

  click(p) {
    if (!this.pts.length) {
      this.pts = [p];
      this.setHint(this.continueHint());
      return;
    }
    this.place(this.endFor(p));
  }

  place(b) {
    const a = this.pts[this.pts.length - 1];
    if (dist(a, b) < 1e-6) return;
    const closing = this.pts.length > 1 && samePoint(b, this.pts[0], 1e-6);
    // Lines drawn level or upright stay that way; typed lengths become dimensions.
    const cons = [];
    if (Math.abs(b[1] - a[1]) < 1e-9) cons.push({ type: 'horizontal', e: '#0' });
    else if (Math.abs(b[0] - a[0]) < 1e-9) cons.push({ type: 'vertical', e: '#0' });
    if ('length' in this.locked) cons.push({ type: 'length', e: '#0', value: dist(a, b) });
    this.commit([{ type: 'line', a, b }], 'Line', cons);
    this.app.dim.hide();
    if (closing) {
      this.reset();
      return;
    }
    this.pts.push(b);
  }

  finish() {
    this.reset();
  }
}

// ---- Rectangle -----------------------------------------------------------

export class RectTool extends SketchTool {
  get options() {
    return [
      {
        type: 'choice',
        key: 'mode',
        label: 'Start from',
        value: this.app.settings.rectMode || 'corner',
        options: [
          { value: 'corner', label: 'Corner' },
          { value: 'center', label: 'Center' },
        ],
      },
    ];
  }

  onOption(key, value) {
    if (key === 'mode') {
      this.app.settings.rectMode = value;
      this.app.saveSettings();
    } else super.onOption(key, value);
  }

  get mode() {
    return this.app.settings.rectMode || 'corner';
  }

  corners(p) {
    const a = this.pts[0];
    const L = this.locked;
    let dx = p[0] - a[0];
    let dy = p[1] - a[1];
    const center = this.mode === 'center';
    if ('width' in L) dx = Math.sign(dx || 1) * (center ? L.width / 2 : L.width);
    if ('height' in L) dy = Math.sign(dy || 1) * (center ? L.height / 2 : L.height);
    if (center) return [sub(a, [dx, dy]), add(a, [dx, dy])];
    return [a, [a[0] + dx, a[1] + dy]];
  }

  outline(c0, c1) {
    return [c0, [c1[0], c0[1]], c1, [c0[0], c1[1]], c0];
  }

  preview(p, e) {
    if (!this.pts.length) return;
    const [c0, c1] = this.corners(p);
    this.rubber([this.outline(c0, c1)]);
    const w = Math.abs(c1[0] - c0[0]);
    const hgt = Math.abs(c1[1] - c0[1]);
    this.dims(
      [
        { key: 'width', label: 'W', type: 'length', value: w },
        { key: 'height', label: 'H', type: 'length', value: hgt },
      ],
      e,
      () => this.place(this.cursor || p),
    );
  }

  click(p) {
    if (!this.pts.length) {
      this.pts = [p];
      this.setHint('Click the opposite corner · type width, <kbd>Tab</kbd>, height');
      return;
    }
    this.place(p);
  }

  place(p) {
    const [c0, c1] = this.corners(p);
    if (Math.abs(c1[0] - c0[0]) < 1e-6 || Math.abs(c1[1] - c0[1]) < 1e-6) return;
    const o = this.outline(c0, c1);
    const cons = [
      { type: 'horizontal', e: '#0' },
      { type: 'vertical', e: '#1' },
      { type: 'horizontal', e: '#2' },
      { type: 'vertical', e: '#3' },
    ];
    if ('width' in this.locked) cons.push({ type: 'length', e: '#0', value: Math.abs(c1[0] - c0[0]) });
    if ('height' in this.locked) cons.push({ type: 'length', e: '#1', value: Math.abs(c1[1] - c0[1]) });
    this.commit(
      o.slice(0, 4).map((a, i) => ({ type: 'line', a, b: o[i + 1] })),
      'Rectangle',
      cons,
    );
    this.reset();
  }
}

// ---- Circle ----------------------------------------------------------------

export class CircleTool extends SketchTool {
  radius(p) {
    if ('diameter' in this.locked) return this.locked.diameter / 2;
    return dist(this.pts[0], p);
  }

  preview(p, e) {
    if (!this.pts.length) return;
    const c = this.pts[0];
    const r = this.radius(p);
    const pts = [];
    for (let i = 0; i <= 96; i++) pts.push(polar(c, r, (i / 96) * TAU));
    this.rubber([pts, [c, polar(c, r, angleOf(sub(p, c)))]]);
    this.dims([{ key: 'diameter', label: '⌀', type: 'length', value: r * 2 }], e, () => this.place(this.cursor || p));
  }

  click(p) {
    if (!this.pts.length) {
      this.pts = [p];
      this.setHint('Click to set the size · type a diameter');
      return;
    }
    this.place(p);
  }

  place(p) {
    const r = this.radius(p);
    if (r < 1e-6) return;
    const cons = 'diameter' in this.locked ? [{ type: 'diameter', e: '#0', value: r * 2 }] : [];
    this.commit([{ type: 'circle', c: this.pts[0], r }], 'Circle', cons);
    this.reset();
  }
}

// ---- Arc -----------------------------------------------------------------

export class ArcTool extends SketchTool {
  get options() {
    return [
      {
        type: 'choice',
        key: 'mode',
        label: 'Arc type',
        value: this.app.settings.arcMode || '3pt',
        options: [
          { value: '3pt', label: '3 points' },
          { value: 'center', label: 'Center' },
        ],
      },
    ];
  }

  onOption(key, value) {
    if (key === 'mode') {
      this.app.settings.arcMode = value;
      this.app.saveSettings();
      this.reset();
    } else super.onOption(key, value);
  }

  get mode() {
    return this.app.settings.arcMode || '3pt';
  }

  startHint() {
    return this.mode === '3pt' ? 'Click the start point of the arc' : 'Click the center of the arc';
  }

  arcFor(p) {
    const P = this.pts;
    if (this.mode === '3pt') {
      if (P.length === 2) return arcFrom3Points(P[0], p, P[1]);
      return null;
    }
    if (P.length === 2) {
      const c = P[0];
      const r = dist(c, P[1]);
      const a0 = normAngle(angleOf(sub(P[1], c)));
      let a1 = normAngle(angleOf(sub(p, c)));
      if ('angle' in this.locked) a1 = normAngle(a0 + this.locked.angle * DEG);
      // Follow the mouse direction: track the swept angle continuously.
      const prev = this.lastSweep ?? 0;
      let s = normAngle(a1 - a0);
      if (prev > Math.PI * 1.5 && s < Math.PI / 2) s += TAU;
      if (prev < -Math.PI * 1.5 && s > -Math.PI / 2) s -= TAU;
      if (this.ccw === undefined) this.ccw = s < Math.PI;
      if (!this.ccw) s = s - TAU;
      this.lastSweep = s;
      return s >= 0 ? { c, r, a0, a1 } : { c, r, a0: a1, a1: a0 };
    }
    return null;
  }

  preview(p, e) {
    const P = this.pts;
    if (!P.length) return;
    if (P.length === 1) {
      this.rubber([[P[0], p]]);
      if (this.mode === 'center') this.dims([{ key: 'radius', label: 'R', type: 'length', value: dist(P[0], p) }], e, () => this.click(this.cursor || p));
      return;
    }
    const arc = this.arcFor(p);
    if (!arc) return;
    const s = sweep(arc.a0, arc.a1);
    const pts = [];
    for (let i = 0; i <= 64; i++) pts.push(polar(arc.c, arc.r, arc.a0 + (s * i) / 64));
    this.rubber([pts]);
    this.dims(
      [
        { key: 'radius', label: 'R', type: 'length', value: arc.r },
        { key: 'angle', label: '∠', type: 'angle', value: (s / DEG) % 360 || 360 },
      ],
      e,
      () => this.click(this.cursor || p),
    );
  }

  click(p) {
    const P = this.pts;
    if (this.mode === 'center' && P.length === 1 && 'radius' in this.locked) {
      // Typed radius: place the start point in the cursor direction.
      p = polar(P[0], this.locked.radius, angleOf(sub(p, P[0])));
    }
    if (P.length < 2) {
      P.push(p);
      this.app.dim.hide();
      this.ccw = undefined;
      this.lastSweep = undefined;
      this.setHint(this.mode === '3pt' ? (P.length === 1 ? 'Click the end point' : 'Click a point on the arc') : P.length === 1 ? 'Click the start of the arc' : 'Click the end of the arc');
      return;
    }
    const arc = this.arcFor(p);
    if (!arc || arc.r < 1e-6) return;
    this.commit([{ type: 'arc', c: arc.c, r: arc.r, a0: arc.a0, a1: arc.a1 }], 'Arc');
    this.reset();
  }
}

// ---- Polygon -------------------------------------------------------------

export class PolygonTool extends SketchTool {
  get options() {
    return [{ type: 'count', key: 'sides', label: 'Sides', value: this.app.settings.polygonSides || 6, min: 3, max: 64 }];
  }

  onOption(key, value) {
    if (key === 'sides') {
      this.app.settings.polygonSides = Math.round(value);
      this.app.saveSettings();
    } else super.onOption(key, value);
  }

  verts(p) {
    const c = this.pts[0];
    const n = this.app.settings.polygonSides || 6;
    const r = 'radius' in this.locked ? this.locked.radius : dist(c, p);
    return regularPolygon(c, r, n, angleOf(sub(p, c)));
  }

  preview(p, e) {
    if (!this.pts.length) return;
    const v = this.verts(p);
    this.rubber([[...v, v[0]]]);
    this.dims([{ key: 'radius', label: 'R', type: 'length', value: dist(this.pts[0], p) }], e, () => this.place(this.cursor || p));
  }

  click(p) {
    if (!this.pts.length) {
      this.pts = [p];
      this.setHint('Click to set the size and rotation · type a radius');
      return;
    }
    this.place(p);
  }

  place(p) {
    const v = this.verts(p);
    if (dist(v[0], this.pts[0]) < 1e-6) return;
    const cons = v.slice(1).map((_, i) => ({ type: 'equal', e: '#0', e2: `#${i + 1}` }));
    this.commit(
      v.map((a, i) => ({ type: 'line', a, b: v[(i + 1) % v.length] })),
      'Polygon',
      cons,
    );
    this.reset();
  }
}

// ---- Spline --------------------------------------------------------------

export class SplineTool extends SketchTool {
  continueHint() {
    return 'Click to add points · click the first point to close · <kbd>Enter</kbd> / double-click to finish';
  }

  preview(p) {
    if (!this.pts.length) return;
    const pts = [...this.pts, p];
    this.rubber([sampleSpline(pts, false, 12)]);
  }

  click(p) {
    if (this.pts.length > 2 && samePoint(p, this.pts[0], 1e-6)) {
      this.commit([{ type: 'spline', pts: [...this.pts, this.pts[0]], closed: true }], 'Spline');
      this.reset();
      return;
    }
    if (this.pts.length && samePoint(p, this.pts[this.pts.length - 1], 1e-6)) return;
    this.pts.push(p);
    this.setHint(this.continueHint());
  }

  finish() {
    // A double-click adds the same point twice; drop duplicates.
    const pts = this.pts.filter((p, i, a) => i === 0 || !samePoint(p, a[i - 1], 1e-6));
    if (pts.length >= 2) this.commit([{ type: 'spline', pts }], 'Spline');
    this.reset();
  }
}

// ---- Ellipse -------------------------------------------------------------

export class EllipseTool extends SketchTool {
  shape(p) {
    const c = this.pts[0];
    if (this.pts.length === 1) {
      const rx = dist(c, p);
      return { c, rx, ry: rx * 0.6, rot: angleOf(sub(p, c)) };
    }
    const axisEnd = this.pts[1];
    const rot = angleOf(sub(axisEnd, c));
    const rx = dist(c, axisEnd);
    const v = sub(p, c);
    const ry = Math.max(1e-6, Math.abs(-Math.sin(rot) * v[0] + Math.cos(rot) * v[1]));
    return { c, rx, ry, rot };
  }

  preview(p, e) {
    if (!this.pts.length) return;
    const s = this.shape(p);
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * TAU;
      const x = s.rx * Math.cos(t);
      const y = s.ry * Math.sin(t);
      pts.push([s.c[0] + x * Math.cos(s.rot) - y * Math.sin(s.rot), s.c[1] + x * Math.sin(s.rot) + y * Math.cos(s.rot)]);
    }
    this.rubber([pts]);
    void e;
  }

  click(p) {
    if (this.pts.length < 2) {
      this.pts.push(p);
      this.setHint(this.pts.length === 1 ? 'Click the end of the first axis' : 'Click to set the width');
      return;
    }
    const s = this.shape(p);
    if (s.rx < 1e-6 || s.ry < 1e-6) return;
    this.commit([{ type: 'ellipse', ...s }], 'Ellipse');
    this.reset();
  }
}

// ---- Point -----------------------------------------------------------------

export class PointTool extends SketchTool {
  preview() {}

  click(p) {
    this.commit([{ type: 'point', p }], 'Point');
  }
}
