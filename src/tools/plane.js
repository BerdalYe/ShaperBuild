// Plane tool: add a reference plane to draw on, at a distance from (and an
// angle to) the grid planes, a flat face, a sketch or another plane.
import { Tool } from './base.js';
import { planeFrame, makePlane } from '../core/plane.js';
import { midplane, planeThrough, planeNormalTo, planeThroughLine, planeAt } from '../core/construct.js';
import { toast } from '../ui/overlays.js';
import { t } from '../core/i18n.js';

const DEG = Math.PI / 180;
// Ways to make a plane: what to pick (kinds, how many) and the hint.
const TYPES = [
  { value: 'offset', label: 'Offset', hint: 'Start from a grid plane, or click a flat face, sketch or plane in the view.' },
  { value: 'mid', label: 'Midplane', need: 2, kinds: ['face', 'plane', 'region', 'curve'], hint: 'Click two flat faces or planes; the new plane lies halfway between them.' },
  { value: 'three', label: '3 points', need: 3, kinds: ['vertex', 'spoint', 'face', 'region'], hint: 'Click three points: body corners, sketch points or spots on faces.' },
  { value: 'curve', label: 'Across a curve', need: 1, kinds: ['edge', 'curve'], hint: 'Click an edge or sketch curve; the plane cuts across it at the position you choose.' },
  { value: 'line', label: 'Through a line', need: 1, kinds: ['edge', 'curve', 'axis'], hint: 'Click a straight edge, sketch line or axis, then set the angle.' },
  { value: 'parallel', label: 'Parallel at a point', need: 2, kinds: ['face', 'plane', 'region', 'vertex', 'spoint'], hint: 'Click a flat face or plane, then the point the new plane goes through.' },
];
const BASES = {
  xy: { label: 'Top (XY)', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] } },
  xz: { label: 'Front (XZ)', plane: { origin: [0, 0, 0], normal: [0, -1, 0], xDir: [1, 0, 0] } },
  yz: { label: 'Right (YZ)', plane: { origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] } },
};

export class PlaneTool extends Tool {
  get pickKinds() {
    return ['face', 'region', 'curve', 'plane', 'image'];
  }

  get type() {
    return TYPES.find((x) => x.value === this.values.type) || TYPES[0];
  }

  activate() {
    this.values = { type: 'offset', base: 'xy', offset: 20, tilt: 0, at: 50, angle: 90 };
    this.picked = null;
    this.refs = [];
    // Start from a selected flat face, sketch or plane.
    for (const it of this.app.selection.list) {
      const p = this.planeOf(it);
      if (p) {
        this.picked = p;
        this.values.base = 'picked';
        break;
      }
    }
    this.render();
    this.update();
    this.setHint('Click a flat face, sketch or plane to start from it — or pick Top, Front or Right. Type the distance.');
  }

  deactivate() {
    this.app.vp.overlay.clear('tool-plane');
    this.app.selection.setHover(null);
  }

  planeOf(it) {
    const app = this.app;
    if (it.kind === 'face') {
      const info = app.faceInfo(it.bodyId, it.index);
      return info?.type === 'plane' ? { plane: makePlane(info.center, info.normal, info.xDir), label: 'Picked face' } : null;
    }
    if (it.kind === 'region' || it.kind === 'curve' || it.kind === 'sketch') {
      const sk = app.doc.sketch(it.sketchId);
      if (!sk) return null;
      // Centre the new plane on the sketch, not on its origin far away.
      const c = it.kind === 'region' ? app.regionCache.get(it.sketchId)?.data?.regions[it.index]?.centroid : null;
      return { plane: c ? { ...sk.plane, origin: c } : sk.plane, label: 'Picked sketch' };
    }
    if (it.kind === 'plane' || it.kind === 'image') {
      const pl = it.kind === 'plane' ? app.doc.plane(it.planeId) : app.doc.image(it.imageId);
      return pl ? { plane: pl.plane, label: pl.name } : null;
    }
    return null;
  }

  render() {
    const v = this.values;
    const ty = this.type;
    const fields = [{ type: 'select', key: 'type', label: 'Type', value: v.type, options: TYPES.map(({ value, label }) => ({ value, label })) }];
    if (ty.value === 'offset') {
      const options = Object.entries(BASES).map(([value, b]) => ({ value, label: b.label }));
      if (this.picked) options.push({ value: 'picked', label: this.picked.label });
      fields.push(
        { type: 'choice', key: 'base', label: 'Start from', value: v.base, options },
        { type: 'length', key: 'offset', label: 'Distance', value: v.offset },
        { type: 'angle', key: 'tilt', label: 'Tilt', value: v.tilt },
      );
    } else {
      fields.push({ type: 'info', text: t('Picked {n} of {total}', { n: this.refs.length, total: ty.need }) });
      if (ty.value === 'curve') fields.push({ type: 'number', key: 'at', label: 'Position along it (%)', value: v.at, min: 0, max: 100, step: 5 });
      if (ty.value === 'line') fields.push({ type: 'angle', key: 'angle', label: 'Angle', value: v.angle });
    }
    this.setHint(ty.hint);
    this.app.panel.show({
      title: this.def.label,
      icon: this.def.icon,
      hint: ty.hint,
      fields,
      onChange: (k, val) => {
        this.values[k] = val;
        if (k === 'type') {
          this.refs = [];
          this.render();
        }
        this.update();
      },
      okEnabled: () => !!this.result(),
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okLabel: 'Add plane',
    });
  }

  basePlane() {
    if (this.values.base === 'picked' && this.picked) return this.picked.plane;
    return (BASES[this.values.base] || BASES.xy).plane;
  }

  // A flat thing under a pick (plane), or null.
  planeOfHit(hit) {
    const p = this.planeOf(this.app.selectionItem(hit));
    return p ? p.plane : null;
  }

  // The new plane for the picked things (types other than Offset).
  pickedResult() {
    const app = this.app;
    const r = this.refs;
    const ty = this.type;
    if (r.length < ty.need) return null;
    switch (ty.value) {
      case 'mid': {
        const a = this.planeOfHit(r[0].hit);
        const b = this.planeOfHit(r[1].hit);
        return a && b ? midplane(a, b) : null;
      }
      case 'three':
        return r.every((x) => x.point) ? planeThrough(r[0].point, r[1].point, r[2].point) : null;
      case 'curve': {
        const pts = app.curvePoints(app.selectionItem(r[0].hit));
        if (!pts) return null;
        // Walk the given share of the curve's length.
        const segs = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          const l = Math.hypot(...pts[i].map((v, k) => v - pts[i - 1][k]));
          segs.push(l);
          total += l;
        }
        let want = (Math.min(100, Math.max(0, this.values.at ?? 50)) / 100) * total;
        for (let i = 0; i < segs.length; i++) {
          if (want <= segs[i] || i === segs.length - 1) {
            const s = segs[i] ? Math.min(1, want / segs[i]) : 0;
            const p = pts[i].map((v, k) => v + (pts[i + 1][k] - v) * s);
            const tan = pts[i + 1].map((v, k) => v - pts[i][k]);
            return planeNormalTo(p, tan);
          }
          want -= segs[i];
        }
        return null;
      }
      case 'line': {
        const ax = app.axisOf(app.selectionItem(r[0].hit));
        if (!ax) return null;
        // Turned from the face or sketch the line belongs to, if any.
        const h = r[0].hit;
        const ref = h.kind === 'curve' ? app.doc.sketch(h.sketchId)?.plane.normal : null;
        return planeThroughLine(ax, this.values.angle || 0, ref || null);
      }
      case 'parallel': {
        const flat = r.find((x) => this.planeOfHit(x.hit));
        const pt = r.find((x) => x !== flat && x.point);
        const pl = flat && this.planeOfHit(flat.hit);
        return pl && pt ? planeAt(pt.point, pl.normal, pl.xDir) : null;
      }
      default:
        return null;
    }
  }

  // The new plane: moved along the base normal, then tilted about its x axis.
  result() {
    if (this.type.value !== 'offset') return this.pickedResult();
    const f = planeFrame(this.basePlane());
    const d = this.values.offset || 0;
    const t = (this.values.tilt || 0) * DEG;
    const origin = [0, 1, 2].map((k) => f.o[k] + f.n[k] * d);
    const normal = [0, 1, 2].map((k) => f.n[k] * Math.cos(t) - f.y[k] * Math.sin(t));
    return { origin, normal, xDir: f.x };
  }

  update() {
    const res = this.result();
    if (res) this.app.showPlaneOverlay('tool-plane', res);
    else this.app.vp.overlay.clear('tool-plane');
    this.app.panel.refreshOk?.();
  }

  get kindsNow() {
    return this.type.kinds || this.pickKinds;
  }

  onPointerMove(e) {
    const hit = e.pick(this.kindsNow);
    if (this.type.value !== 'offset') {
      this.app.selection.setHover(hit && hit.kind !== 'vertex' && hit.kind !== 'spoint' ? this.app.selectionItem(hit) : null);
      return;
    }
    this.app.selection.setHover(hit && this.planeOf(this.app.selectionItem(hit)) ? this.app.selectionItem(hit) : null);
  }

  onPointerDown(e) {
    const hit = e.pick(this.kindsNow);
    if (this.type.value !== 'offset') {
      if (!hit) return;
      if (this.refs.length >= this.type.need) this.refs = [];
      this.refs.push({ hit, point: this.app.pointOf(hit) });
      this.render();
      this.update();
      return;
    }
    const p = hit && this.planeOf(this.app.selectionItem(hit));
    if (!p) return;
    this.picked = p;
    this.values.base = 'picked';
    this.render();
    this.update();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.done();
      return true;
    }
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    if (/^[0-9.,-]$/.test(e.key) && !e.ctrl && !e.alt) {
      const inp = this.app.panel.inputs.get('offset');
      if (inp) {
        inp.focus();
        inp.value = e.key;
        inp.dispatchEvent(new Event('input'));
        return true;
      }
    }
    return false;
  }

  apply() {
    const app = this.app;
    const box = app.vp.contentBox();
    const size = box.isEmpty() ? 80 : Math.max(40, Math.min(400, box.getSize(box.min.clone()).length() * 0.8));
    const plane = this.result();
    if (!plane) return toast(this.type.hint, { type: 'error' });
    this.done();
    app.cmd.addPlane(plane, { size: Math.round(size) });
    toast('Plane added. Pick a sketch tool and click on the plane to draw on it.', { ms: 3500 });
  }
}
