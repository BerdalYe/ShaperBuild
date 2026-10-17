// Move / rotate bodies and sketches with an on-screen gizmo or exact values.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OpTool } from './optool.js';
import { toast } from '../ui/overlays.js';
import { t, tn } from '../core/i18n.js';

const DEG = Math.PI / 180;

export class TransformTool extends OpTool {
  inputs() {
    return [
      {
        key: 'items',
        label: 'Objects',
        kinds: ['body', 'sketch', 'region', 'curve', 'plane', 'image'],
        multiple: true,
        placeholder: 'Click bodies, sketches, planes or images',
        accept: (it) => {
          if (it.kind === 'region' || it.kind === 'curve') return { kind: 'sketch', sketchId: it.sketchId };
          return it;
        },
        summary: (items) => tn(items.length, '1 object', '{n} objects'),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      {
        type: 'choice',
        key: 'gizmo',
        label: 'Handle',
        value: v.gizmo ?? 'translate',
        options: [
          { value: 'translate', label: 'Move', icon: 'move' },
          { value: 'rotate', label: 'Rotate', icon: 'rotate' },
        ],
      },
      { type: 'length', key: 'x', label: 'Move X', value: v.x ?? 0 },
      { type: 'length', key: 'y', label: 'Move Y', value: v.y ?? 0 },
      { type: 'length', key: 'z', label: 'Move Z', value: v.z ?? 0 },
      { type: 'angle', key: 'rx', label: 'Rotate X', value: v.rx ?? 0 },
      { type: 'angle', key: 'ry', label: 'Rotate Y', value: v.ry ?? 0 },
      { type: 'angle', key: 'rz', label: 'Rotate Z', value: v.rz ?? 0 },
      { type: 'toggle', key: 'copy', label: 'Make a copy', value: v.copy ?? false },
    ];
  }

  hint() {
    return 'Drag an arrow or ring: the move is saved when you let go. Or type exact values and press Enter.';
  }

  init() {
    const vp = this.app.vp;
    this.proxy = new THREE.Object3D();
    vp.scene.add(this.proxy);
    this.controls = new TransformControls(vp.camera, vp.canvas);
    this.controls.setSize(0.9);
    this.helper = this.controls.getHelper();
    vp.scene.add(this.helper);
    this.controls.addEventListener('change', () => vp.requestRender());
    this.controls.addEventListener('objectChange', () => this.fromGizmo());
    // Letting go of the gizmo saves the move; the tool stays open for the next one.
    this.controls.addEventListener('mouseUp', () => (this.pending = this.commitDrag()));
    this.offCam = vp.on('camera', () => {
      if (this.controls.camera !== vp.camera) this.controls.camera = vp.camera;
    });
    this.setupPivot();
  }

  deactivate() {
    this.restoreViews();
    this.controls?.detach();
    this.controls?.dispose();
    this.helper?.removeFromParent();
    this.proxy?.removeFromParent();
    this.offCam?.();
    super.deactivate();
  }

  get pickKinds() {
    return ['face', 'body', 'region', 'curve', 'plane', 'image'];
  }

  onPointerDown(e) {
    if (this.controls.axis !== null || this.controls.dragging) return;
    super.onPointerDown(e);
    this.setupPivot();
  }

  onPointerMove(e) {
    if (this.controls.dragging) return;
    super.onPointerMove(e);
  }

  setupPivot() {
    const box = new THREE.Box3();
    for (const it of this.items('items')) {
      const b = this.app.itemBox(it);
      if (b) box.union(b);
    }
    this.restoreViews();
    if (box.isEmpty()) {
      this.controls.detach();
      return;
    }
    this.pivot = box.getCenter(new THREE.Vector3());
    this.values.x = this.values.y = this.values.z = 0;
    this.values.rx = this.values.ry = this.values.rz = 0;
    this.proxy.position.copy(this.pivot);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.updateMatrixWorld();
    this.controls.attach(this.proxy);
    this.controls.setMode(this.values.gizmo || 'translate');
    this.applySnap();
    this.render();
  }

  onSnapChange() {
    this.applySnap();
  }

  applySnap() {
    const snap = this.app.settings.snap;
    this.controls.setTranslationSnap(snap ? this.app.vp.grid.step : null);
    this.controls.setRotationSnap(snap ? 15 * DEG : null);
  }

  onParam(k, v) {
    if (k === 'gizmo') {
      this.controls.setMode(v);
      return;
    }
    if (['x', 'y', 'z', 'rx', 'ry', 'rz'].includes(k)) this.toGizmo();
  }

  // Panel values -> gizmo
  toGizmo() {
    const v = this.values;
    this.proxy.position.set(this.pivot.x + v.x, this.pivot.y + v.y, this.pivot.z + v.z);
    this.proxy.rotation.set(v.rx * DEG, v.ry * DEG, v.rz * DEG, 'XYZ');
    this.proxy.updateMatrixWorld();
    this.previewViews();
  }

  // Gizmo -> panel values
  fromGizmo() {
    const p = this.proxy.position;
    const r = this.proxy.rotation;
    const vals = { x: p.x - this.pivot.x, y: p.y - this.pivot.y, z: p.z - this.pivot.z, rx: r.x / DEG, ry: r.y / DEG, rz: r.z / DEG };
    Object.assign(this.values, vals);
    for (const [k, val] of Object.entries(vals)) this.app.panel.setValue(k, val);
    this.previewViews();
  }

  matrix() {
    // M = T(position) * R * T(-pivot)
    const m = new THREE.Matrix4().compose(this.proxy.position, this.proxy.quaternion, new THREE.Vector3(1, 1, 1));
    return m.multiply(new THREE.Matrix4().makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z));
  }

  previewViews() {
    const m = this.matrix();
    const vp = this.app.vp;
    this.moved = [];
    for (const it of this.items('items')) {
      const view = it.kind === 'body' ? vp.bodyViews.get(it.bodyId) : it.kind === 'plane' ? vp.planeViews.get(it.planeId) : it.kind === 'image' ? vp.imageViews.get(it.imageId) : vp.sketchViews.get(it.sketchId);
      if (!view) continue;
      for (const g of [view.group, view.pickGroup]) {
        g.matrixAutoUpdate = false;
        g.matrix.copy(m);
        g.matrixWorldNeedsUpdate = true;
      }
      this.moved.push(view);
    }
    vp.requestRender();
  }

  restoreViews() {
    for (const view of this.moved || []) {
      for (const g of [view.group, view.pickGroup]) {
        g.matrix.identity();
        g.matrixAutoUpdate = true;
        g.matrixWorldNeedsUpdate = true;
      }
    }
    this.moved = [];
    this.app.vp.requestRender();
  }

  schedule() {
    // Preview is drawn locally; nothing to compute in the kernel.
    this.setError(null);
  }

  ready() {
    return this.items('items').length > 0;
  }

  async apply() {
    if (!this.ready()) return toast('Select bodies, sketches, planes or images to move', { type: 'error' });
    await this.pending;
    if (await this.commit()) this.done();
  }

  async commitDrag() {
    if (!this.ready()) return;
    this.controls.enabled = false;
    try {
      const ok = await this.commit();
      if (ok && this.app.tools.active === this) this.setupPivot();
    } finally {
      this.controls.enabled = true;
    }
  }

  // Save the current move or rotation. False when it could not be done.
  async commit() {
    const m = this.matrix();
    if (m.equals(new THREE.Matrix4())) return true;
    const app = this.app;
    const bodies = this.items('items').filter((it) => it.kind === 'body');
    const sketches = this.items('items').filter((it) => it.kind === 'sketch');
    let result = { bodies: [], removed: [] };
    if (bodies.length) {
      try {
        app.busy(true, 'Moving…');
        const v = this.values;
        // The values themselves too, so the step can be changed in History.
        const move = { t: [v.x || 0, v.y || 0, v.z || 0], r: [v.rx || 0, v.ry || 0, v.rz || 0], pivot: this.pivot.toArray() };
        result = await app.kernel.call('transform', { ids: bodies.map((b) => app.doc.body(b.bodyId).shapeId), matrix: m.elements, copy: !!this.values.copy, move });
      } catch (err) {
        toast(err.message, { type: 'error' });
        return false;
      } finally {
        app.busy(false);
      }
    }
    this.restoreViews();
    const copy = !!this.values.copy;
    const ids = (list) => new Set(list.map((x) => x.id));
    const had = { sketch: ids(app.doc.sketches), plane: ids(app.doc.planes), image: ids(app.doc.images) };
    const created = app.cmd.applyResult(copy ? 'Copy' : 'Move', result, {
      sketches: sketches.map((s) => ({ id: s.sketchId, matrix: m.elements, copy })),
      planes: this.items('items').filter((it) => it.kind === 'plane').map((it) => ({ id: it.planeId, matrix: m.elements, copy })),
      images: this.items('items').filter((it) => it.kind === 'image').map((it) => ({ id: it.imageId, matrix: m.elements, copy })),
    });
    if (copy) {
      // Go on with the copies, so the next drag moves them instead of making more.
      const slot = this.slots.find((s) => s.key === 'items');
      slot.items = [
        ...created.map((bodyId) => ({ kind: 'body', bodyId })),
        ...app.doc.sketches.filter((x) => !had.sketch.has(x.id)).map((x) => ({ kind: 'sketch', sketchId: x.id })),
        ...app.doc.planes.filter((x) => !had.plane.has(x.id)).map((x) => ({ kind: 'plane', planeId: x.id })),
        ...app.doc.images.filter((x) => !had.image.has(x.id)).map((x) => ({ kind: 'image', imageId: x.id })),
      ];
      this.values.copy = false;
    }
    return true;
  }
}
