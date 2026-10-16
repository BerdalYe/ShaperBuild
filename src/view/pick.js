// GPU picking. Pickable things are drawn into a small offscreen buffer
// around the cursor with a unique colour per item; reading the pixels tells
// us exactly what is visible under (and near) the cursor.
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const PICK_LINE_WIDTH = 11;
export const PICK_POINT_SIZE = 16;

export class PickRegistry {
  constructor() {
    this.map = new Map();
    this.next = 1;
  }

  // Reserve `count` consecutive ids; `describe(i)` returns the descriptor.
  alloc(count, describe) {
    const base = this.next;
    this.next += count;
    if (this.next > 0xfffff0) this.next = 1;
    const block = { base, count, describe };
    for (let i = 0; i < count; i++) this.map.set(base + i, block);
    return base;
  }

  free(base, count) {
    for (let i = 0; i < count; i++) this.map.delete(base + i);
  }

  lookup(id) {
    const block = this.map.get(id);
    if (!block) return null;
    return block.describe(id - block.base);
  }
}

export function idColor(id, out = [0, 0, 0]) {
  out[0] = (id & 255) / 255;
  out[1] = ((id >> 8) & 255) / 255;
  out[2] = ((id >> 16) & 255) / 255;
  return out;
}

const pickVertex = /* glsl */ `
  attribute vec3 pickColor;
  varying vec3 vPick;
  #include <clipping_planes_pars_vertex>
  void main() {
    vPick = pickColor;
    #include <begin_vertex>
    #include <project_vertex>
    #include <clipping_planes_vertex>
  }
`;
const pickFragment = /* glsl */ `
  varying vec3 vPick;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    gl_FragColor = vec4(vPick, 1.0);
  }
`;

export function makePickMeshMaterial({ offset = 1, side = THREE.DoubleSide } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: pickVertex,
    fragmentShader: pickFragment,
    side,
    clipping: true,
    polygonOffset: offset !== 0,
    polygonOffsetFactor: offset,
    polygonOffsetUnits: offset,
  });
}

const pointVertex = /* glsl */ `
  attribute vec3 pickColor;
  uniform float size;
  varying vec3 vPick;
  #include <clipping_planes_pars_vertex>
  void main() {
    vPick = pickColor;
    #include <begin_vertex>
    #include <project_vertex>
    #include <clipping_planes_vertex>
    gl_PointSize = size;
    // Pull points slightly towards the camera so they win over lines.
    gl_Position.z -= 0.000006 * gl_Position.w;
  }
`;
const pointFragment = /* glsl */ `
  varying vec3 vPick;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vPick, 1.0);
  }
`;

export function makePickPointMaterial(size = PICK_POINT_SIZE) {
  return new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: { size: { value: size } },
    clipping: true,
  });
}

export function makePickLineMaterial(width = PICK_LINE_WIDTH) {
  const m = new LineMaterial({ vertexColors: true, linewidth: width, worldUnits: false, toneMapped: false, clipping: true });
  m.isPickMaterial = true;
  return m;
}

// Fill a Float32Array of RGB per vertex with one id.
export function fillIdColors(arr, start, count, id) {
  const c = idColor(id);
  for (let i = start; i < start + count; i++) {
    arr[i * 3] = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
}

// Offscreen render target and pixel readback.
export class Picker {
  constructor(renderer, radius = 12) {
    this.renderer = renderer;
    this.radius = radius;
    this.size = radius * 2 + 1;
    this.target = new THREE.WebGLRenderTarget(this.size, this.size, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      samples: 0,
    });
    this.pixels = new Uint8Array(this.size * this.size * 4);
  }

  // Render `scene` around CSS pixel (x, y) and return ids by distance.
  read(scene, camera, x, y, width, height, lineMaterials) {
    const r = this.radius;
    const s = this.size;
    const renderer = this.renderer;
    camera.setViewOffset(width, height, x - r, y - r, s, s);
    for (const m of lineMaterials) m.resolution.set(s, s);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    // Fat lines read their resolution from the renderer viewport, so make it
    // match the small pick target while rendering.
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    renderer.setViewport(0, 0, s, s);
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(this.target, 0, 0, s, s, this.pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setViewport(prevViewport);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.toneMapping = prevTone;
    camera.clearViewOffset();
    // Collect each id with its nearest pixel distance to the centre.
    const found = new Map();
    const p = this.pixels;
    for (let j = 0; j < s; j++) {
      for (let i = 0; i < s; i++) {
        const o = (j * s + i) * 4;
        if (p[o + 3] === 0) continue;
        const id = p[o] | (p[o + 1] << 8) | (p[o + 2] << 16);
        if (!id) continue;
        // Row 0 is the bottom of the image.
        const dx = i - r;
        const dy = s - 1 - j - r;
        const d = Math.hypot(dx, dy);
        const prev = found.get(id);
        if (prev === undefined || d < prev) found.set(id, d);
      }
    }
    return found;
  }
}

// Nudge a LineMaterial towards the camera so lines lying exactly on faces or
// on other lines draw cleanly instead of flickering.
export function biasLine(material, amount) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('gl_Position = clip;', `gl_Position = clip; gl_Position.z -= ${amount.toExponential(3)} * gl_Position.w;`);
  };
  material.customProgramCacheKey = () => `bias${amount}`;
  return material;
}
