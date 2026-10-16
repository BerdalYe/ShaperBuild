// Navigation cube drawn with CSS 3D transforms. Click a face, edge or
// corner to look from that direction.
import * as THREE from 'three';

const HALF = 30;
const FACES = [
  { name: 'Top', n: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] },
  { name: 'Bottom', n: [0, 0, -1], x: [1, 0, 0], y: [0, -1, 0] },
  { name: 'Front', n: [0, -1, 0], x: [1, 0, 0], y: [0, 0, 1] },
  { name: 'Back', n: [0, 1, 0], x: [-1, 0, 0], y: [0, 0, 1] },
  { name: 'Right', n: [1, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
  { name: 'Left', n: [-1, 0, 0], x: [0, -1, 0], y: [0, 0, 1] },
];

const V = (a) => new THREE.Vector3(...a);

export class ViewCube {
  constructor(container, onPick) {
    this.onPick = onPick;
    this.el = document.createElement('div');
    this.el.className = 'viewcube';
    this.scene = document.createElement('div');
    this.scene.className = 'vc-scene';
    this.el.appendChild(this.scene);
    container.appendChild(this.el);
    this.parts = [];
    for (const f of FACES) {
      this.addPart('vc-face', 2 * HALF, 2 * HALF, V(f.n), V(f.x), V(f.y), V(f.n).multiplyScalar(HALF), f.name);
    }
    // Edges
    const dirs = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const a = V(dirs[i]);
        const b = V(dirs[j]);
        if (Math.abs(a.dot(b)) > 0.5) continue;
        const n = a.clone().add(b).normalize();
        const along = a.clone().cross(b).normalize();
        const up = n.clone().cross(along).normalize();
        this.addPart('vc-edge', 2 * HALF - 16, 10, n, along, up, a.clone().add(b).multiplyScalar(HALF));
      }
    }
    // Corners
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const n = V([sx, sy, sz]).normalize();
          const helper = Math.abs(n.z) > 0.9 ? V([1, 0, 0]) : V([0, 0, 1]);
          const x = helper.clone().cross(n).normalize();
          const y = n.clone().cross(x).normalize();
          this.addPart('vc-corner', 13, 13, n, x, y, V([sx, sy, sz]).multiplyScalar(HALF));
        }
      }
    }
    const home = document.createElement('button');
    home.className = 'vc-home';
    home.title = 'Home view (0)';
    home.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    home.addEventListener('click', () => this.onPick({ home: true }));
    this.el.appendChild(home);
  }

  addPart(cls, w, h, n, x, y, pos, label) {
    const el = document.createElement('div');
    el.className = cls;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.marginLeft = `${-w / 2}px`;
    el.style.marginTop = `${-h / 2}px`;
    if (label) el.textContent = label.toUpperCase();
    const placement = new THREE.Matrix4().makeBasis(x, y, n).setPosition(pos);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPick({ dir: n.clone() });
    });
    this.scene.appendChild(el);
    this.parts.push({ el, placement });
  }

  update(quaternion) {
    const rot = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).invert();
    const flipY = new THREE.Matrix4().makeScale(1, -1, 1);
    for (const { el, placement } of this.parts) {
      const m = flipY.clone().multiply(rot).multiply(placement).multiply(flipY);
      el.style.transform = `matrix3d(${m.elements.map((v) => (Math.abs(v) < 1e-10 ? 0 : v.toFixed(6))).join(',')})`;
    }
  }
}
