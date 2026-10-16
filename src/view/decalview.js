// A decal: a picture projected onto a body's surface (visualization only).
// decal: { id, bodyId, src (image data URL), aspect (height / width),
//   at, normal, size (width in mm), rotation (degrees), opacity, wrap }
import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

// Turn and position of the projector box for a decal.
export function decalOrientation(decal) {
  const n = new THREE.Vector3(...decal.normal).normalize();
  const helper = new THREE.Object3D();
  // Z is up in the world; for faces facing up or down, Y is "up" instead.
  helper.up.set(...(Math.abs(n.z) > 0.95 ? [0, 1, 0] : [0, 0, 1]));
  helper.position.set(...decal.at);
  helper.lookAt(helper.position.clone().add(n));
  helper.rotateZ(((decal.rotation || 0) * Math.PI) / 180);
  return helper.rotation.clone();
}

export class DecalView {
  constructor(decal, ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.material = new THREE.MeshStandardMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.5,
      metalness: 0,
      clippingPlanes: ctx.clippingPlanes,
    });
    this.decal = null;
  }

  // bodyMesh: the THREE.Mesh of the body the decal sits on.
  update(decal, bodyMesh) {
    if (!this.decal || this.decal.src !== decal.src) {
      this.material.map?.dispose();
      const tex = new THREE.TextureLoader().load(decal.src, () => this.ctx.requestRender?.());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.material.map = tex;
      this.material.needsUpdate = true;
    }
    this.material.opacity = decal.opacity ?? 1;
    const same = this.decal && this.bodyMesh === bodyMesh && ['at', 'normal', 'size', 'rotation', 'aspect', 'wrap'].every((k) => this.decal[k] === decal[k]);
    this.decal = decal;
    if (same && this.mesh) return;
    this.bodyMesh = bodyMesh;
    this.clearMesh();
    if (!bodyMesh) return;
    const w = decal.size || 20;
    const hgt = w * (decal.aspect || 1);
    // Depth of the projection: how far round the surface the picture wraps.
    const depth = Math.max(w, hgt) * (decal.wrap ? 1 : 0.3);
    bodyMesh.updateMatrixWorld(true);
    const geo = new DecalGeometry(bodyMesh, new THREE.Vector3(...decal.at), decalOrientation(decal), new THREE.Vector3(w, hgt, depth));
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  clearMesh() {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    this.group.remove(this.mesh);
    this.mesh = null;
  }

  dispose() {
    this.clearMesh();
    this.material.map?.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}
