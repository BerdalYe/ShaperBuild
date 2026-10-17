// A photo studio to light visualization renders: a dark backdrop with soft
// light boxes around the part. It is rendered once into an environment map,
// so metals and glossy materials have something to reflect. Z is up.
import * as THREE from 'three';

export class StudioEnvironment extends THREE.Scene {
  constructor() {
    super();
    // Backdrop: darker below the horizon, a little lighter above.
    const dome = new THREE.SphereGeometry(60, 48, 24);
    dome.rotateX(Math.PI / 2);
    const pos = dome.attributes.position;
    const colors = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) / 60;
      const t = Math.max(0, Math.min(1, (z + 0.15) / 1.15));
      c.setRGB(0.05, 0.055, 0.065).lerp(new THREE.Color(0.26, 0.27, 0.29), Math.pow(t, 0.8));
      colors.push(c.r, c.g, c.b);
    }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

    // A floor that bounces a little light back up.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.32, 0.33) }));
    floor.position.z = -6;
    this.add(floor);

    // Light boxes: [width, height, brightness, position, look at].
    const boxes = [
      [26, 26, 2.2, [0, 0, 30], [0, 0, 0]], // big soft light above
      [16, 10, 9, [-22, -18, 16], [0, 0, 0]], // key light, front left
      [5, 24, 4, [26, -6, 8], [0, 0, 0]], // fill strip, right
      [5, 24, 6, [-6, 28, 10], [0, 0, 0]], // rim strip, behind
      [30, 3, 3, [0, -34, 2], [0, 0, 2]], // low strip in front (edge highlights)
    ];
    for (const [w, h, power, p, at] of boxes) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
      m.position.set(...p);
      m.up.set(0, 0, 1);
      m.lookAt(...at);
      this.add(m);
    }
  }

  dispose() {
    this.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}
