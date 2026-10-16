// Infinite, zoom-adaptive grid drawn with a shader. It lies on the ground
// (XY) plane, or on the active sketch plane.
import * as THREE from 'three';
import { niceStep } from '../core/units.js';

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uStep;
  uniform vec3 uMinor;
  uniform vec3 uMajor;
  uniform float uMinorA;
  uniform float uMajorA;
  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform float uFade;
  uniform vec2 uCenter;
  uniform float uShowAxes;
  uniform float uScale;
  uniform vec2 uOffset;
  varying vec3 vLocal;
  varying vec3 vWorld;

  float gridLine(vec2 p, float step) {
    vec2 c = p / step;
    vec2 d = fwidth(c);
    vec2 g = abs(fract(c - 0.5) - 0.5) / d;
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec2 p = vLocal.xy * uScale + uOffset;
    float minor = gridLine(p, uStep);
    float major = gridLine(p, uStep * 10.0);
    float fade = 1.0 - smoothstep(uFade * 0.35, uFade, length(p - uCenter));
    vec4 col = vec4(uMinor, minor * uMinorA);
    col = mix(col, vec4(uMajor, uMajorA), major);
    if (uShowAxes > 0.5) {
      vec2 d = fwidth(p);
      float ax = 1.0 - min(abs(p.y) / (d.y * 1.2), 1.0);
      float ay = 1.0 - min(abs(p.x) / (d.x * 1.2), 1.0);
      col = mix(col, vec4(uAxisX, 0.85), ax);
      col = mix(col, vec4(uAxisY, 0.85), ay);
    }
    col.a *= fade;
    if (col.a < 0.003) discard;
    gl_FragColor = col;
    #include <colorspace_fragment>
  }
`;

function parseRGBA(css) {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return { color: new THREE.Color(css), alpha: 1 };
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return { color: new THREE.Color(r / 255, g / 255, b / 255), alpha: a };
}

export class Grid {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      extensions: { derivatives: true },
      uniforms: {
        uStep: { value: 10 },
        uMinor: { value: new THREE.Color() },
        uMajor: { value: new THREE.Color() },
        uMinorA: { value: 0.06 },
        uMajorA: { value: 0.13 },
        uAxisX: { value: new THREE.Color('#e5484d') },
        uAxisY: { value: new THREE.Color('#30a46c') },
        uFade: { value: 1000 },
        uCenter: { value: new THREE.Vector2() },
        uShowAxes: { value: 1 },
        uScale: { value: 1 },
        uOffset: { value: new THREE.Vector2() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.step = 10;
    this.plane = null; // null = ground
  }

  setTheme(theme) {
    const mi = parseRGBA(theme.gridMinor);
    const ma = parseRGBA(theme.gridMajor);
    this.material.uniforms.uMinor.value.copy(mi.color);
    this.material.uniforms.uMinorA.value = mi.alpha;
    this.material.uniforms.uMajor.value.copy(ma.color);
    this.material.uniforms.uMajorA.value = ma.alpha;
  }

  // plane: { origin, xDir, normal } (arrays) or null for the ground plane.
  setPlane(plane) {
    this.plane = plane;
    const m = new THREE.Matrix4();
    if (plane) {
      const x = new THREE.Vector3(...plane.xDir).normalize();
      const n = new THREE.Vector3(...plane.normal).normalize();
      const y = n.clone().cross(x);
      m.makeBasis(x, y, n).setPosition(new THREE.Vector3(...plane.origin));
    }
    this.baseMatrix = m;
    this.material.uniforms.uShowAxes.value = plane ? 0 : 1;
  }

  // Resize the grid around the point the camera looks at.
  update(rig, viewportHeight, unitFactor = 1) {
    const size = Math.max(rig.dist, 1) * 12;
    const px = rig.pixelSize(rig.target, viewportHeight);
    this.step = niceStep((px * 14) / unitFactor) * unitFactor;
    const u = this.material.uniforms;
    u.uStep.value = this.step;
    u.uFade.value = Math.max(rig.dist, 1) * 3.2;
    const base = this.baseMatrix || new THREE.Matrix4();
    const inv = base.clone().invert();
    const local = rig.target.clone().applyMatrix4(inv);
    // Snap the centre to the major grid so lines do not swim.
    const major = this.step * 10;
    const cx = Math.round(local.x / major) * major;
    const cy = Math.round(local.y / major) * major;
    u.uCenter.value.set(local.x, local.y);
    u.uScale.value = size;
    u.uOffset.value.set(cx, cy);
    const m = new THREE.Matrix4().makeTranslation(cx, cy, 0).multiply(new THREE.Matrix4().makeScale(size, size, 1));
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(base).multiply(m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }
}
