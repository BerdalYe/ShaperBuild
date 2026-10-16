// Three.js objects for one reference image: a see-through picture on a plane.
import * as THREE from 'three';
import { makePickMeshMaterial, fillIdColors } from './pick.js';
import { planeFrame } from '../core/plane.js';

export class ImageView {
  constructor(im, ctx) {
    this.ctx = ctx;
    this.im = im;
    this.group = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.pickBase = ctx.registry.alloc(1, () => ({ kind: 'image', imageId: this.im.id }));
    this.mat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false, clippingPlanes: ctx.clippingPlanes });
    this.lineMat = new THREE.LineBasicMaterial({ transparent: true, clippingPlanes: ctx.clippingPlanes });
    // Like planes: picked only where nothing else is.
    this.pickMat = makePickMeshMaterial({ offset: 0 });
    this.pickMat.depthWrite = false;
    this.update(im);
    this.setHighlight(null);
  }

  update(im) {
    const srcChanged = !this.im || this.im.src !== im.src || !this.mat.map;
    this.im = im;
    if (srcChanged) {
      this.mat.map?.dispose();
      const tex = new THREE.TextureLoader().load(im.src, () => this.ctx.requestRender?.());
      tex.colorSpace = THREE.SRGBColorSpace;
      this.mat.map = tex;
      this.mat.needsUpdate = true;
    }
    this.mat.opacity = im.opacity ?? 0.6;
    this.disposeGeometry();
    const f = planeFrame(im.plane);
    const w = im.width / 2;
    const hh = im.height / 2;
    // Lift the picture a hair off its plane so sketches on it stay on top.
    const lift = 0.002;
    const at = (u, v) => [0, 1, 2].map((k) => f.o[k] + f.x[k] * u + f.y[k] * v - f.n[k] * lift);
    const corners = [at(-w, -hh), at(w, -hh), at(w, hh), at(-w, hh)];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    const pick = new Float32Array(12);
    fillIdColors(pick, 0, 4, this.pickBase);
    geom.setAttribute('pickColor', new THREE.BufferAttribute(pick, 3));
    this.geometry = geom;
    this.mesh = new THREE.Mesh(geom, this.mat);
    this.mesh.renderOrder = 1;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
    this.lineGeometry = lg;
    this.border = new THREE.LineLoop(lg, this.lineMat);
    this.group.add(this.mesh, this.border);
    this.pickMesh = new THREE.Mesh(geom, this.pickMat);
    this.pickMesh.renderOrder = -10;
    this.pickMesh.userData.pickKind = 'image';
    this.pickGroup.add(this.pickMesh);
    this.group.visible = this.pickGroup.visible = im.visible !== false;
  }

  setHighlight(color) {
    this.lineMat.color.set(color || this.ctx.theme.edge);
    this.lineMat.opacity = color ? 1 : 0.35;
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
    this.mat.map?.dispose();
    this.mat.dispose();
    this.lineMat.dispose();
    this.pickMat.dispose();
    this.group.removeFromParent();
    this.pickGroup.removeFromParent();
  }
}
