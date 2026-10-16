// GLB and USDZ (3D with colours and finishes, for viewers, AR and other
// apps), and the material file that gives OBJ exports their colours.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { MATERIALS } from '../view/bodyview.js';

const DEFAULT_COLOR = '#c4ccd6';

// parts: [{ name, positions, indices, color, material }] in millimetres
// with Z up. glTF and USD use metres with Y up.
export function sceneOf(parts) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'ShaperBuild';
  root.scale.setScalar(0.001);
  root.rotation.x = -Math.PI / 2;
  scene.add(root);
  parts.forEach((p, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.positions, 3));
    g.setIndex(Array.from(p.indices));
    g.computeVertexNormals();
    const look = { ...(MATERIALS[p.material] || MATERIALS.plastic), ...(p.look || {}) };
    const m = new THREE.MeshPhysicalMaterial({
      name: p.material || 'plastic',
      color: new THREE.Color(p.color || DEFAULT_COLOR),
      roughness: look.roughness,
      metalness: look.metalness,
      clearcoat: look.clearcoat || 0,
      clearcoatRoughness: look.clearcoatRoughness || 0,
      transmission: look.transmission || 0,
      ior: look.ior || 1.5,
      thickness: look.thickness || 0,
      opacity: look.opacity ?? 1,
      transparent: (look.opacity ?? 1) < 1,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = p.name || `Body ${i + 1}`;
    root.add(mesh);
  });
  scene.updateMatrixWorld(true);
  return scene;
}

function dispose(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}

export async function writeGLB(parts) {
  const scene = sceneOf(parts);
  try {
    const buf = await new GLTFExporter().parseAsync(scene, { binary: true });
    return new Uint8Array(buf);
  } finally {
    dispose(scene);
  }
}

export async function writeUSDZ(parts) {
  const scene = sceneOf(parts);
  try {
    // USDZ keeps standard materials (no clear coat or glass).
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshStandardMaterial({ name: m.name, color: m.color, roughness: m.roughness, metalness: m.metalness, opacity: m.transmission ? 0.35 : m.opacity, transparent: !!m.transmission || m.opacity < 1 });
      m.dispose();
    });
    const data = await new USDZExporter().parseAsync(scene);
    return new Uint8Array(data);
  } finally {
    dispose(scene);
  }
}

// OBJ material library: one material per body, with its colour.
export function writeMTL(parts) {
  const lines = ['# Materials exported from ShaperBuild'];
  parts.forEach((p, i) => {
    // MTL colours are plain sRGB values (as typed), not linear.
    const c = new THREE.Color(p.color || DEFAULT_COLOR).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    const look = { ...(MATERIALS[p.material] || MATERIALS.plastic), ...(p.look || {}) };
    lines.push('', `newmtl ${mtlName(p, i)}`, `Kd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}`, 'Ka 0 0 0', `Ks ${look.metalness >= 0.5 ? '0.9 0.9 0.9' : '0.2 0.2 0.2'}`, `Ns ${Math.round((1 - look.roughness) * 900 + 10)}`, `d ${look.transmission ? '0.35' : look.opacity ?? 1}`, 'illum 2');
  });
  return new TextEncoder().encode(lines.join('\n') + '\n');
}

export const mtlName = (p, i) => `${(p.name || `body_${i + 1}`).replace(/\s+/g, '_')}_mat`;
