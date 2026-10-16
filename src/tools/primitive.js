// Basic shapes: pick a size, then click on the grid or a flat face to place.
import * as THREE from 'three';
import { Tool } from './base.js';
import { LatestRunner } from '../kernel/client.js';
import { rayPlane, GROUND, makePlane, planeFrame, to2D, to3D } from '../core/plane.js';
import { toast } from '../ui/overlays.js';

const SHAPES = {
  box: { label: 'Box', fields: [['width', 'Width', 20], ['depth', 'Depth', 20], ['height', 'Height', 20]] },
  cylinder: { label: 'Cylinder', fields: [['radius', 'Radius', 10], ['height', 'Height', 20]] },
  sphere: { label: 'Sphere', fields: [['radius', 'Radius', 10]] },
  cone: { label: 'Cone', fields: [['radius', 'Base radius', 10], ['topRadius', 'Top radius', 0], ['height', 'Height', 20]] },
  torus: { label: 'Torus', fields: [['major', 'Ring radius', 15], ['minor', 'Tube radius', 4]] },
};

export class PrimitiveTool extends Tool {
  get pickKinds() {
    return ['face', 'body'];
  }

  get shape() {
    return this.def.shape;
  }

  activate() {
    const saved = this.app.settings.primitives?.[this.shape] || {};
    this.params = Object.fromEntries(SHAPES[this.shape].fields.map(([k, , v]) => [k, saved[k] ?? v]));
    this.runner = new LatestRunner(() => this.app.kernel.call('primitive', { type: this.shape, params: this.params }));
    this.previewId = null;
    this.render();
    this.refresh();
    this.setHint('Click on the grid or a flat face to place the shape · type sizes in the panel');
  }

  deactivate() {
    this.runner.cancel();
    if (this.previewId) this.app.kernel.call('release', { ids: [this.previewId] }).catch(() => {});
    this.app.vp.overlay.clear('tool');
  }

  render() {
    this.app.panel.show({
      title: SHAPES[this.shape].label,
      icon: this.def.icon,
      hint: 'Set the size, then click where it should go.',
      fields: SHAPES[this.shape].fields.map(([key, label]) => ({ type: 'length', key, label, value: this.params[key], min: 0 })),
      onChange: (k, v) => {
        this.params[k] = v;
        this.app.settings.primitives = { ...(this.app.settings.primitives || {}), [this.shape]: { ...this.params } };
        this.app.saveSettings();
        this.refresh();
      },
      onCancel: () => this.done(),
    });
  }

  async refresh() {
    const res = await this.runner.request();
    if (res.stale) return;
    if (res.error) {
      toast(res.error.message, { type: 'error' });
      return;
    }
    if (this.previewId) this.app.kernel.call('release', { ids: [this.previewId] }).catch(() => {});
    const b = res.value.bodies[0];
    this.previewId = b.id;
    this.mesh = b.mesh;
    this.app.vp.overlay.body('tool-prim', b.mesh, { color: this.app.vp.theme.preview, opacity: 0.55 });
    this.place(this.lastPlacement);
  }

  placementAt(e) {
    const app = this.app;
    const hit = e.pick(this.pickKinds);
    let plane = GROUND;
    if (hit?.kind === 'face') {
      const info = app.faceInfo(hit.bodyId, hit.index);
      if (info?.type === 'plane') plane = makePlane(info.center, info.normal, info.xDir);
    } else if (hit?.kind === 'body' && hit.normal) plane = makePlane(hit.point, hit.normal);
    const P = rayPlane(e.ray.origin, e.ray.dir, plane);
    if (!P) return null;
    const f = planeFrame(plane);
    const s = app.snapPoint(plane, to2D(f, P), e, {});
    return { plane, point: to3D(f, s.p), frame: f };
  }

  place(pl) {
    this.lastPlacement = pl;
    const item = this.app.vp.overlay.items.get('tool-prim');
    if (!item || !pl) return;
    const m = this.matrixFor(pl);
    for (const obj of item.objects) {
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(m);
      obj.matrixWorldNeedsUpdate = true;
    }
    this.app.vp.requestRender();
  }

  matrixFor(pl) {
    const f = pl.frame;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...f.x), new THREE.Vector3(...f.y), new THREE.Vector3(...f.n));
    basis.setPosition(new THREE.Vector3(...pl.point));
    return basis;
  }

  onPointerMove(e) {
    const pl = this.placementAt(e);
    if (pl) this.place(pl);
  }

  async onPointerDown(e) {
    const pl = this.placementAt(e);
    if (!pl) return;
    try {
      const res = await this.app.kernel.call('primitive', { type: this.shape, params: this.params, matrix: this.matrixFor(pl).elements });
      this.app.cmd.applyResult(SHAPES[this.shape].label, res);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.done();
      return true;
    }
    return false;
  }
}
