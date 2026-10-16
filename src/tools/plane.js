// Plane tool: add a reference plane to draw on, at a distance from (and an
// angle to) the grid planes, a flat face, a sketch or another plane.
import { Tool } from './base.js';
import { planeFrame, makePlane } from '../core/plane.js';
import { toast } from '../ui/overlays.js';

const DEG = Math.PI / 180;
const BASES = {
  xy: { label: 'Top (XY)', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] } },
  xz: { label: 'Front (XZ)', plane: { origin: [0, 0, 0], normal: [0, -1, 0], xDir: [1, 0, 0] } },
  yz: { label: 'Right (YZ)', plane: { origin: [0, 0, 0], normal: [1, 0, 0], xDir: [0, 1, 0] } },
};

export class PlaneTool extends Tool {
  get pickKinds() {
    return ['face', 'region', 'curve', 'plane'];
  }

  activate() {
    this.values = { base: 'xy', offset: 20, tilt: 0 };
    this.picked = null;
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
    if (it.kind === 'plane') {
      const pl = app.doc.plane(it.planeId);
      return pl ? { plane: pl.plane, label: pl.name } : null;
    }
    return null;
  }

  render() {
    const v = this.values;
    const options = Object.entries(BASES).map(([value, b]) => ({ value, label: b.label }));
    if (this.picked) options.push({ value: 'picked', label: this.picked.label });
    this.app.panel.show({
      title: this.def.label,
      icon: this.def.icon,
      hint: 'Start from a grid plane, or click a flat face, sketch or plane in the view.',
      fields: [
        { type: 'choice', key: 'base', label: 'Start from', value: v.base, options },
        { type: 'length', key: 'offset', label: 'Distance', value: v.offset },
        { type: 'angle', key: 'tilt', label: 'Tilt', value: v.tilt },
      ],
      onChange: (k, val) => {
        this.values[k] = val;
        this.update();
      },
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okLabel: 'Add plane',
    });
  }

  basePlane() {
    if (this.values.base === 'picked' && this.picked) return this.picked.plane;
    return (BASES[this.values.base] || BASES.xy).plane;
  }

  // The new plane: moved along the base normal, then tilted about its x axis.
  result() {
    const f = planeFrame(this.basePlane());
    const d = this.values.offset || 0;
    const t = (this.values.tilt || 0) * DEG;
    const origin = [0, 1, 2].map((k) => f.o[k] + f.n[k] * d);
    const normal = [0, 1, 2].map((k) => f.n[k] * Math.cos(t) - f.y[k] * Math.sin(t));
    return { origin, normal, xDir: f.x };
  }

  update() {
    this.app.showPlaneOverlay('tool-plane', this.result());
  }

  onPointerMove(e) {
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit && this.planeOf(this.app.selectionItem(hit)) ? this.app.selectionItem(hit) : null);
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
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
    this.done();
    app.cmd.addPlane(plane, { size: Math.round(size) });
    toast('Plane added. Pick a sketch tool and click on the plane to draw on it.', { ms: 3500 });
  }
}
