// More ways to move bodies: Translate (from one point to another), Rotate
// around an axis, and Align (put a face, edge or point onto another).
// Each makes a Move step that can be changed later in History.
import * as THREE from 'three';
import { OpTool } from './optool.js';
import { turnMatrix } from '../core/replay.js';
import { tn } from '../core/i18n.js';

const bodiesSlot = () => ({
  key: 'bodies',
  label: 'Bodies',
  kinds: ['body'],
  multiple: true,
  placeholder: 'Click bodies to move',
  summary: (items) => tn(items.length, '1 body', '{n} bodies'),
});

// Matrix (column-major array) and History values for "turn by R about
// pivot, then move by t".
function rigid(R, pivot, t) {
  const m = new THREE.Matrix4().makeTranslation(pivot[0] + t[0], pivot[1] + t[1], pivot[2] + t[2]);
  m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(R));
  m.multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
  const e = new THREE.Euler().setFromQuaternion(R, 'XYZ');
  const deg = (v) => (Math.abs(v) < 1e-12 ? 0 : (v * 180) / Math.PI);
  return { matrix: m.elements, move: { t, r: [deg(e.x), deg(e.y), deg(e.z)], pivot } };
}

// ---- Translate -------------------------------------------------------------

export class TranslateTool extends OpTool {
  inputs() {
    const point = (key, label) => ({
      key,
      label,
      kinds: ['vertex', 'spoint', 'face', 'edge', 'region'],
      multiple: false,
      fromSelection: false,
      placeholder: 'Click a corner, sketch point or spot on a face',
      accept: (it) => {
        const at = this.lastPoint || this.app.pointOf(it);
        return at ? { ...it, at } : null;
      },
    });
    return [bodiesSlot(), point('from', 'From'), point('to', 'To')];
  }

  params() {
    const v = this.values || {};
    return [{ type: 'toggle', key: 'copy', label: 'Make a copy', value: v.copy ?? false }];
  }

  hint() {
    return 'Pick the bodies, then the point to move from and the point to move to.';
  }

  onPointerDown(e) {
    const slot = this.slots[this.active];
    this.lastPoint = slot && slot.key !== 'bodies' ? this.app.pointOf(e.pick(this.pickKinds)) : null;
    super.onPointerDown(e);
    this.lastPoint = null;
  }

  get label() {
    return this.values.copy ? 'Copy' : 'Translate';
  }

  updateHandles() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-vector');
    const a = this.items('from')[0]?.at;
    const b = this.items('to')[0]?.at;
    if (a && b) ov.lines('tool-vector', [[a, b]], { color: this.app.vp.theme.inference, width: 2, dashed: true, depthTest: false });
  }

  async compute() {
    const app = this.app;
    const a = this.items('from')[0].at;
    const b = this.items('to')[0].at;
    const t = b.map((v, i) => v - a[i]);
    const { matrix, move } = rigid(new THREE.Quaternion(), a, t);
    return app.kernel.call('transform', { ids: this.items('bodies').map((it) => app.doc.body(it.bodyId).shapeId), matrix, copy: !!this.values.copy, move });
  }
}

// ---- Rotate around axis ------------------------------------------------------

export class RotateAxisTool extends OpTool {
  inputs() {
    return [
      bodiesSlot(),
      {
        key: 'axis',
        label: 'Axis',
        kinds: ['edge', 'curve', 'axis', 'face'],
        multiple: false,
        fromSelection: false,
        placeholder: 'Click an edge, line, axis or round face',
        reject: 'Pick a straight edge, a sketch line, an axis or a round face',
        accept: (it) => (this.axisOf(it) ? it : null),
      },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'angle', key: 'angle', label: 'Angle', value: v.angle ?? 90 },
      { type: 'toggle', key: 'copy', label: 'Make a copy', value: v.copy ?? false },
    ];
  }

  hint() {
    return 'Pick the bodies and the axis to turn them around, then type the angle.';
  }

  get label() {
    return this.values.copy ? 'Copy' : 'Rotate';
  }

  axisOf(it) {
    if (it.kind === 'face') {
      const info = this.app.faceInfo(it.bodyId, it.index);
      return info?.axis || null;
    }
    return this.app.axisOf(it, { circles: true });
  }

  updateHandles() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-axis');
    const it = this.items('axis')[0];
    const ax = it && this.axisOf(it);
    if (!ax) return;
    const L = Math.max(50, this.app.vp.rig.dist * 0.6);
    ov.lines('tool-axis', [[ax.origin.map((o, i) => o - ax.dir[i] * L), ax.origin.map((o, i) => o + ax.dir[i] * L)]], { color: this.app.vp.theme.inference, width: 1.5, dashed: true, depthTest: false });
  }

  async compute() {
    const app = this.app;
    const ax = this.axisOf(this.items('axis')[0]);
    const turn = { origin: [...ax.origin], dir: [...ax.dir], angle: this.values.angle || 0 };
    return app.kernel.call('transform', { ids: this.items('bodies').map((it) => app.doc.body(it.bodyId).shapeId), matrix: turnMatrix(turn), copy: !!this.values.copy, turn });
  }
}

// ---- Align -----------------------------------------------------------------

// What a pick means for aligning: a plane, a line or a point.
function referenceOf(app, it) {
  const v = (a) => new THREE.Vector3(...a);
  switch (it.kind) {
    case 'face': {
      const info = app.faceInfo(it.bodyId, it.index);
      if (!info) return null;
      if (info.type === 'plane') return { kind: 'plane', at: v(info.center), dir: v(info.normal).normalize() };
      if (info.axis) return { kind: 'line', at: v(info.axis.origin), dir: v(info.axis.dir).normalize(), round: true };
      return { kind: 'point', at: v(info.center) };
    }
    case 'edge': {
      const e = app.edgeInfo(it.bodyId, it.index);
      if (!e) return null;
      if (e.type === 'line') return { kind: 'line', at: v(e.a).add(v(e.b)).multiplyScalar(0.5), dir: v(e.b).sub(v(e.a)).normalize() };
      if (e.type === 'circle') return { kind: 'line', at: v(e.center), dir: v(e.axisDir).normalize(), round: true };
      return { kind: 'point', at: v(e.a).add(v(e.b)).multiplyScalar(0.5) };
    }
    case 'vertex':
    case 'spoint': {
      const p = app.pointOf(it);
      return p ? { kind: 'point', at: v(p) } : null;
    }
    case 'plane': {
      const pl = app.doc.plane(it.planeId);
      return pl ? { kind: 'plane', at: v(pl.plane.origin), dir: v(pl.plane.normal).normalize() } : null;
    }
    case 'region': {
      const sk = app.doc.sketch(it.sketchId);
      const c = app.regionCache.get(it.sketchId)?.data?.regions[it.index]?.centroid;
      return sk ? { kind: 'plane', at: v(c || sk.plane.origin), dir: v(sk.plane.normal).normalize() } : null;
    }
    case 'axis':
    case 'curve': {
      const ax = app.axisOf(it, { circles: true });
      return ax ? { kind: 'line', at: v(ax.origin), dir: v(ax.dir).normalize() } : null;
    }
    default:
      return null;
  }
}

export class AlignTool extends OpTool {
  inputs() {
    const kinds = ['face', 'edge', 'vertex'];
    return [
      { key: 'moving', label: 'Move this', kinds, multiple: false, placeholder: 'Click a face, edge or corner of the body to move', accept: (it) => (it.bodyId && referenceOf(this.app, it) ? it : null) },
      { key: 'target', label: 'Onto', kinds: [...kinds, 'plane', 'axis', 'curve', 'region', 'spoint'], multiple: false, fromSelection: false, placeholder: 'Click where it should go', accept: (it) => (referenceOf(this.app, it) ? it : null) },
    ];
  }

  params() {
    const v = this.values || {};
    return [
      { type: 'toggle', key: 'flip', label: 'Flip (face the other way)', value: v.flip ?? false },
      { type: 'toggle', key: 'copy', label: 'Make a copy', value: v.copy ?? false },
    ];
  }

  hint() {
    return 'Click a face, edge or corner of the body to move, then where it should go. Faces end up touching, round faces and edges share an axis.';
  }

  get label() {
    return 'Align';
  }

  // The move that puts the moving reference onto the target.
  alignment() {
    const a = referenceOf(this.app, this.items('moving')[0]);
    const b = referenceOf(this.app, this.items('target')[0]);
    if (!a || !b) return null;
    let R = new THREE.Quaternion();
    if (a.dir && b.dir && a.kind === b.kind) {
      // Faces end up facing each other (flip: facing the same way);
      // lines end up pointing the same way (flip: opposite).
      const want = b.dir.clone().multiplyScalar(a.kind === 'plane' ? (this.values.flip ? 1 : -1) : this.values.flip ? -1 : 1);
      R = new THREE.Quaternion().setFromUnitVectors(a.dir, want);
    }
    const pivot = a.at.clone();
    let to = b.at.clone();
    if (a.kind === 'line' && b.kind === 'line' && a.round && b.round) {
      // Same axis, keeping the position along it.
      const along = pivot.clone().sub(b.at).dot(b.dir);
      to = b.at.clone().add(b.dir.clone().multiplyScalar(along));
    } else if (b.kind === 'plane' && a.kind !== 'plane') {
      // Onto the plane, straight across.
      to = pivot.clone().sub(b.dir.clone().multiplyScalar(pivot.clone().sub(b.at).dot(b.dir)));
    } else if (b.kind === 'line' && a.kind === 'point') {
      to = b.at.clone().add(b.dir.clone().multiplyScalar(pivot.clone().sub(b.at).dot(b.dir)));
    }
    return rigid(R, pivot.toArray(), to.sub(pivot).toArray());
  }

  async compute() {
    const app = this.app;
    const al = this.alignment();
    if (!al) return null;
    const body = app.doc.body(this.items('moving')[0].bodyId);
    return app.kernel.call('transform', { ids: [body.shapeId], matrix: al.matrix, copy: !!this.values.copy, move: al.move });
  }
}
