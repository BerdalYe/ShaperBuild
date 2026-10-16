// Axis tool: add a reference axis — through two points, where two planes
// meet, through the middle of a round face, along an edge or line, or at
// right angles to a face. Axes can turn Revolve, Circular pattern and
// Rotate around.
import { Tool } from './base.js';
import { axisThrough, planesMeet } from '../core/construct.js';
import { planeFrame, makePlane } from '../core/plane.js';
import { toast } from '../ui/overlays.js';
import { t } from '../core/i18n.js';

const TYPES = [
  { value: 'points', label: 'Two points', need: 2, kinds: ['vertex', 'spoint', 'face', 'region'], hint: 'Click two points: body corners, sketch points or anywhere on a face' },
  { value: 'planes', label: 'Two planes', need: 2, kinds: ['face', 'plane', 'region'], hint: 'Click two flat faces or planes; the axis is where they meet' },
  { value: 'round', label: 'Round face', need: 1, kinds: ['face', 'edge'], hint: 'Click a round face (or a circular edge); the axis runs through its middle' },
  { value: 'edge', label: 'Along an edge', need: 1, kinds: ['edge', 'curve', 'axis'], hint: 'Click a straight edge or sketch line' },
  { value: 'normal', label: 'At right angles to a face', need: 1, kinds: ['face', 'plane', 'region'], hint: 'Click a flat face where the axis should stand up' },
];

export class AxisTool extends Tool {
  get type() {
    return TYPES.find((x) => x.value === this.values.type) || TYPES[0];
  }

  get pickKinds() {
    return this.type.kinds;
  }

  activate() {
    this.values = { type: this.app.settings.axisType || 'points', length: 80 };
    this.refs = [];
    this.render();
    this.update();
  }

  deactivate() {
    this.app.vp.overlay.clear('tool-axis');
    this.app.selection.setHover(null);
  }

  render() {
    const v = this.values;
    const ty = this.type;
    this.setHint(ty.hint);
    this.app.panel.show({
      title: this.def.label,
      icon: this.def.icon,
      hint: ty.hint,
      fields: [
        { type: 'choice', key: 'type', label: 'Type', value: v.type, options: TYPES.map(({ value, label }) => ({ value, label })) },
        { type: 'info', text: t('Picked {n} of {total}', { n: this.refs.length, total: ty.need }) },
        { type: 'length', key: 'length', label: 'Length shown', value: v.length, min: 1 },
      ],
      onChange: (k, val) => {
        this.values[k] = val;
        if (k === 'type') {
          this.app.settings.axisType = val;
          this.refs = [];
          this.render();
        }
        this.update();
      },
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okLabel: 'Add axis',
      okEnabled: () => !!this.result(),
    });
  }

  // A flat thing under a pick: { origin, normal } or null.
  planeOf(hit) {
    const app = this.app;
    if (hit.kind === 'face') {
      const info = app.faceInfo(hit.bodyId, hit.index);
      return info?.type === 'plane' ? makePlane(info.center, info.normal, info.xDir) : null;
    }
    if (hit.kind === 'plane') return app.doc.plane(hit.planeId)?.plane || null;
    if (hit.kind === 'region' || hit.kind === 'curve') return app.doc.sketch(hit.sketchId)?.plane || null;
    return null;
  }

  // The new axis, or null while something is missing.
  result() {
    const app = this.app;
    const r = this.refs;
    const ty = this.type;
    if (r.length < ty.need) return null;
    const len = this.values.length || 80;
    switch (ty.value) {
      case 'points': {
        const a = axisThrough(r[0].point, r[1].point);
        return a ? { origin: r[0].point.map((v, i) => (v + r[1].point[i]) / 2), dir: a.dir, length: Math.max(len, a.length) } : null;
      }
      case 'planes': {
        const a = this.planeOf(r[0].hit);
        const b = this.planeOf(r[1].hit);
        const line = a && b ? planesMeet(a, b) : null;
        return line ? { ...line, length: len } : null;
      }
      case 'round': {
        const h = r[0].hit;
        if (h.kind === 'edge') {
          const ax = app.axisOf(h, { circles: true });
          return ax && app.edgeInfo(h.bodyId, h.index)?.type === 'circle' ? { ...ax, length: len } : null;
        }
        const info = app.faceInfo(h.bodyId, h.index);
        return info?.axis ? { origin: info.axis.origin, dir: info.axis.dir, length: len } : null;
      }
      case 'edge': {
        const ax = app.axisOf(r[0].hit);
        return ax ? { ...ax, length: len } : null;
      }
      case 'normal': {
        const pl = this.planeOf(r[0].hit);
        if (!pl) return null;
        const f = planeFrame(pl);
        const p = r[0].point || f.o;
        // Stand on the plane at the clicked point.
        const off = (p[0] - f.o[0]) * f.n[0] + (p[1] - f.o[1]) * f.n[1] + (p[2] - f.o[2]) * f.n[2];
        const at = p.map((v, i) => v - f.n[i] * off);
        return { origin: at.map((v, i) => v + (f.n[i] * len) / 2), dir: f.n, length: len };
      }
      default:
        return null;
    }
  }

  update() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-axis');
    const ax = this.result();
    if (ax) {
      const h = ax.length / 2;
      ov.lines('tool-axis', [[ax.origin.map((o, i) => o - ax.dir[i] * h), ax.origin.map((o, i) => o + ax.dir[i] * h)]], { color: this.app.vp.theme.preview, width: 2, dashed: true, depthTest: false });
    }
    this.app.panel.refreshOk?.();
  }

  highlights() {
    return this.refs.filter((r) => r.hit.kind !== 'vertex' && r.hit.kind !== 'spoint').map((r) => ({ item: this.app.selectionItem(r.hit), color: this.app.vp.theme.select }));
  }

  onPointerMove(e) {
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit && hit.kind !== 'vertex' && hit.kind !== 'spoint' ? this.app.selectionItem(hit) : null);
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return;
    const ty = this.type;
    if (this.refs.length >= ty.need) this.refs = [];
    this.refs.push({ hit, point: this.app.pointOf(hit) });
    this.render();
    this.update();
    this.app.refreshHighlights();
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
    return false;
  }

  apply() {
    const ax = this.result();
    if (!ax) return toast(this.type.hint, { type: 'error' });
    this.done();
    this.app.cmd.addAxis(ax);
  }
}
