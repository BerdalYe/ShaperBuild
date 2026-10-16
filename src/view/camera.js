// CAD camera: Z-up turntable orbit around a pivot, pan, zoom to cursor,
// perspective/orthographic, and animated standard views.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

export const VIEWS = {
  iso: { az: 35 * DEG, el: 28 * DEG },
  front: { az: 0, el: 0 },
  back: { az: 180 * DEG, el: 0 },
  right: { az: 90 * DEG, el: 0 },
  left: { az: -90 * DEG, el: 0 },
  top: { az: 0, el: 90 * DEG },
  bottom: { az: 0, el: -90 * DEG },
};

export class CameraRig {
  constructor() {
    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
    this.useOrtho = false;
    this.target = new THREE.Vector3(0, 0, 0);
    this.dist = 220;
    this.az = VIEWS.iso.az;
    this.el = VIEWS.iso.el;
    this.aspect = 1;
    this.anim = null;
    this.sceneRadius = 100;
    this.update();
  }

  get camera() {
    return this.useOrtho ? this.ortho : this.persp;
  }

  static quat(az, el) {
    const q = new THREE.Quaternion().setFromAxisAngle(Z, az);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2 - el));
    return q;
  }

  get quaternion() {
    return CameraRig.quat(this.az, this.el);
  }

  // Unit vector from target towards the camera.
  get back() {
    return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this.update();
  }

  // Visible height (world units) at the target distance.
  get viewHeight() {
    return 2 * this.dist * Math.tan((this.persp.fov * DEG) / 2);
  }

  update() {
    const q = this.quaternion;
    const pos = new THREE.Vector3(0, 0, this.dist).applyQuaternion(q).add(this.target);
    for (const cam of [this.persp, this.ortho]) {
      cam.position.copy(pos);
      cam.quaternion.copy(q);
    }
    const r = Math.max(this.sceneRadius, 1);
    this.persp.aspect = this.aspect;
    this.persp.near = Math.max(this.dist * 0.002, 0.01);
    this.persp.far = this.dist + r * 8 + 1000;
    this.persp.updateProjectionMatrix();
    const h = this.viewHeight / 2;
    this.ortho.left = -h * this.aspect;
    this.ortho.right = h * this.aspect;
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.near = -(this.dist + r * 8 + 1000);
    this.ortho.far = this.dist + r * 8 + 1000;
    this.ortho.updateProjectionMatrix();
    for (const cam of [this.persp, this.ortho]) cam.updateMatrixWorld(true);
  }

  // World units per CSS pixel at a given world point.
  pixelSize(point, viewportHeight) {
    if (this.useOrtho) return this.viewHeight / viewportHeight;
    const d = point ? Math.max(1e-6, point.clone().sub(this.persp.position).dot(this.back.negate())) : this.dist;
    return (2 * d * Math.tan((this.persp.fov * DEG) / 2)) / viewportHeight;
  }

  orbit(dx, dy, pivot) {
    this.stopAnim();
    const oldQ = this.quaternion;
    this.az -= dx * 0.008;
    this.el = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.el + dy * 0.008));
    if (pivot) {
      const delta = this.quaternion.multiply(oldQ.invert());
      this.target.sub(pivot).applyQuaternion(delta).add(pivot);
    }
    this.update();
  }

  pan(dx, dy, viewportHeight, at) {
    this.stopAnim();
    const s = this.pixelSize(at || this.target, viewportHeight);
    const q = this.quaternion;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    this.update();
  }

  // Zoom by factor (<1 zooms in) keeping `point` fixed on screen.
  zoom(factor, point) {
    this.stopAnim();
    const f = Math.max(0.2, Math.min(5, factor));
    const newDist = Math.max(0.05, Math.min(1e6, this.dist * f));
    const k = newDist / this.dist;
    // Scaling the camera about `point` keeps that point fixed on screen.
    if (point) this.target.sub(point).multiplyScalar(k).add(point);
    this.dist = newDist;
    this.update();
  }

  // Animate to a new view. view: { az, el, target?, dist? }
  animateTo(view, ms = 350) {
    const from = { az: this.az, el: this.el, target: this.target.clone(), dist: this.dist };
    let toAz = view.az ?? this.az;
    // Rotate the short way round.
    while (toAz - from.az > Math.PI) toAz -= Math.PI * 2;
    while (toAz - from.az < -Math.PI) toAz += Math.PI * 2;
    const to = { az: toAz, el: view.el ?? this.el, target: view.target ? view.target.clone() : from.target.clone(), dist: view.dist ?? this.dist };
    this.anim = { from, to, t0: performance.now(), ms };
  }

  stopAnim() {
    this.anim = null;
  }

  // Advance the animation; returns true while animating.
  tick(now) {
    if (!this.anim) return false;
    const { from, to, t0, ms } = this.anim;
    let t = Math.min(1, (now - t0) / ms);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.az = from.az + (to.az - from.az) * t;
    this.el = from.el + (to.el - from.el) * t;
    this.target.lerpVectors(from.target, to.target, t);
    this.dist = from.dist + (to.dist - from.dist) * t;
    this.update();
    if (t >= 1) {
      this.anim = null;
      return false;
    }
    return true;
  }

  // Frame a bounding box. Returns the view parameters.
  fitView(box, { az = this.az, el = this.el, margin = 1.25 } = {}) {
    if (!box || box.isEmpty()) return { az, el, target: new THREE.Vector3(), dist: 220 };
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const fov = this.persp.fov * DEG;
    const fitH = r / Math.sin(fov / 2);
    const fitW = r / Math.sin(Math.atan(Math.tan(fov / 2) * this.aspect));
    return { az, el, target: sphere.center.clone(), dist: Math.max(fitH, fitW) * margin * 0.9 };
  }

  // Look straight at a plane (sketch or face).
  viewForPlane(normal, center) {
    const n = normal.clone().normalize();
    const el = Math.asin(Math.max(-1, Math.min(1, n.z)));
    let az = this.az;
    if (Math.abs(n.z) < 0.999) az = Math.atan2(n.x, -n.y);
    return { az, el, target: center.clone() };
  }

  toJSON() {
    return { az: this.az, el: this.el, dist: this.dist, target: this.target.toArray(), ortho: this.useOrtho };
  }

  fromJSON(j) {
    if (!j) return;
    this.az = j.az;
    this.el = j.el;
    this.dist = j.dist;
    this.target.fromArray(j.target);
    this.useOrtho = !!j.ortho;
    this.update();
  }
}
