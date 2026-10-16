// Three.js objects for one reference plane: a faint square with a border.
import * as THREE from 'three';
import { makePickMeshMaterial, fillIdColors } from './pick.js';
import { planeFrame } from '../core/plane.js';

export class PlaneView {
  constructor(pl, ctx) {
    this.ctx = ctx;
    this.pl = pl;
    this.group = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.pickBase = ctx.registry.alloc(1, () => ({ kind: 'plane', planeId: this.pl.id }));
    this.fillMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: ctx.clippingPlanes });
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75, clippingPlanes: ctx.clippingPlanes });
    // Drawn first and without depth in the pick pass, so bodies and
    // sketches in front of (or behind) a plane are still picked first.
    this.pickMat = makePickMeshMaterial({ offset: 0 });
    this.pickMat.depthWrite = false;
    this.update(pl);
    this.setHighlight(null);
  }

  update(pl) {
    this.pl = pl;
    this.disposeGeometry();
    const f = planeFrame(pl.plane);
    const s = (pl.size || 80) / 2;
    const at = (u, v) => [0, 1, 2].map((k) => f.o[k] + f.x[k] * u + f.y[k] * v);
    const corners = [at(-s, -s), at(s, -s), at(s, s), at(-s, s)];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    const pick = new Float32Array(12);
    fillIdColors(pick, 0, 4, this.pickBase);
    geom.setAttribute('pickColor', new THREE.BufferAttribute(pick, 3));
    this.geometry = geom;
    this.fill = new THREE.Mesh(geom, this.fillMat);
    this.fill.renderOrder = 2;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    this.lineGeometry = lg;
    this.border = new THREE.LineLoop(lg, this.lineMat);
    this.group.add(this.fill, this.border);
    this.pickMesh = new THREE.Mesh(geom, this.pickMat);
    this.pickMesh.renderOrder = -10;
    this.pickMesh.userData.pickKind = 'plane';
    this.pickGroup.add(this.pickMesh);
    this.group.visible = this.pickGroup.visible = pl.visible !== false;
  }

  setHighlight(color) {
    const theme = this.ctx.theme;
    const c = color || theme.preview;
    this.fillMat.color.set(c);
    this.lineMat.color.set(c);
    this.fillMat.opacity = color ? 0.16 : 0.06;
    this.lineMat.opacity = color ? 1 : 0.6;
  }

  disposeGeometry() {
    this.group.clear();
    this.pickGroup.clear();
    this.geometry?.dispose();
    this.lineGeometry?.dispose();
  }

  dispose() {
    this.ctx.registry.free(this.pickBase, 1);
    this.disposeGeometry();
    this.fillMat.dispose();
    this.lineMat.dispose();
    this.pickMat.dispose();
    this.group.removeFromParent();
    this.pickGroup.removeFromParent();
  }
}
