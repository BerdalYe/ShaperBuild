// Textures for visualization: wood grain, brushed metal, carbon fibre and
// more, drawn by code (so they tile without seams and cost no download), and
// pictures people pick themselves. Bodies get box-projected texture
// coordinates in millimetres; a texture's `scale` is how many millimetres
// one copy of it covers.
import * as THREE from 'three';

// Texture coordinates for each vertex: the two coordinates across its main
// normal direction (box projection), in millimetres.
export function boxUVs(positions, normals) {
  const n = positions.length / 3;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const ax = Math.abs(normals[i * 3]);
    const ay = Math.abs(normals[i * 3 + 1]);
    const az = Math.abs(normals[i * 3 + 2]);
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (az >= ax && az >= ay) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    } else if (ax >= ay) {
      uv[i * 2] = y;
      uv[i * 2 + 1] = z;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    }
  }
  return uv;
}

// ---- noise that tiles ----------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Value noise on a grid of px × py cells that wraps around.
function lattice(px, py, seed) {
  const r = rng(seed);
  const v = new Float32Array(px * py);
  for (let i = 0; i < v.length; i++) v[i] = r();
  return (u, w) => {
    // u, w in 0..1 (one tile).
    const x = u * px;
    const y = w * py;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => v[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Several octaves; cells: [x, y] cells of the first octave.
function fbm(cx, cy, octaves, seed) {
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(lattice(cx << o, cy << o, seed + o * 101));
  return (u, w) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const l of layers) {
      sum += l(u, w) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

// Distance to the nearest point of a jittered g × g grid that wraps around,
// in cells (0 at a point). `keep` < 1 leaves some cells without a point.
function cells(g, seed, keep = 1) {
  const r = rng(seed);
  const pts = new Float32Array(g * g * 2);
  const on = new Uint8Array(g * g);
  for (let i = 0; i < g * g; i++) {
    pts[i * 2] = r();
    pts[i * 2 + 1] = r();
    on[i] = r() < keep ? 1 : 0;
  }
  return (u, w) => {
    const x = u * g;
    const y = w * g;
    const ci = Math.floor(x);
    const cj = Math.floor(y);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        const k = (((j % g) + g) % g) * g + (((i % g) + g) % g);
        if (!on[k]) continue;
        const dx = i + pts[k * 2] - x;
        const dy = j + pts[k * 2 + 1] - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- the built-in textures -------------------------------------------------------
// Each returns per-pixel { c: brightness (multiplies the body colour),
// r: roughness factor, h: height } for u, w in 0..1.

const RECIPES = {
  wood() {
    const warp = fbm(2, 6, 4, 11);
    const fibre = fbm(4, 128, 3, 23);
    return (u, w) => {
      const ring = 0.5 + 0.5 * Math.sin(2 * Math.PI * (11 * w + 1.1 * warp(u, w)));
      const late = Math.pow(ring, 4);
      const f = fibre(u, w);
      const c = 0.66 + 0.26 * (1 - late) + 0.1 * (f - 0.5);
      return { c, r: 0.88 + 0.12 * late, h: 0.5 * (1 - late) + 0.5 * f };
    };
  },
  brushed() {
    const streak = fbm(1, 256, 3, 37);
    const blotch = fbm(3, 3, 3, 41);
    return (u, w) => {
      const s = streak(u, w);
      return { c: 0.94 + 0.06 * s, r: 0.85 + 0.25 * (s - 0.5) + 0.08 * (blotch(u, w) - 0.5), h: s };
    };
  },
  carbon() {
    // 2 × 2 twill: bundles alternate direction in a diagonal pattern.
    const n = 12;
    const fine = fbm(48, 48, 2, 53);
    return (u, w) => {
      const x = u * n;
      const y = w * n;
      const i = Math.floor(x);
      const j = Math.floor(y);
      const along = ((i + j) & 3) < 2;
      const t = along ? y - j : x - i; // across the bundle
      const bundle = Math.sin(Math.PI * t);
      const c = (along ? 0.62 : 0.5) + 0.32 * bundle + 0.05 * (fine(u, w) - 0.5);
      return { c, r: 0.92 + 0.08 * (1 - bundle), h: 0.6 * bundle };
    };
  },
  concrete() {
    const base = fbm(4, 4, 6, 61);
    const grit = fbm(64, 64, 2, 63);
    const pores = cells(48, 67, 0.35);
    return (u, w) => {
      const b = base(u, w);
      const p = pores(u, w);
      const pore = p < 0.16 ? 1 - p / 0.16 : 0;
      return { c: 0.8 + 0.28 * (b - 0.5) + 0.08 * (grit(u, w) - 0.5) - 0.3 * pore, r: 0.95 + 0.05 * pore, h: 0.6 * b + 0.3 * grit(u, w) - 0.8 * pore };
    };
  },
  leather() {
    const grain = cells(40, 71);
    const soft = fbm(6, 6, 4, 73);
    return (u, w) => {
      const g = clamp01(grain(u, w) / 0.7);
      const bump = 1 - g * g;
      return { c: 0.86 + 0.1 * bump + 0.1 * (soft(u, w) - 0.5), r: 0.82 + 0.18 * g, h: bump };
    };
  },
  fabric() {
    const n = 24;
    const fuzz = fbm(64, 64, 2, 79);
    return (u, w) => {
      const x = u * n;
      const y = w * n;
      const over = (Math.floor(x) + Math.floor(y)) & 1;
      const t = over ? y - Math.floor(y) : x - Math.floor(x);
      const thread = Math.sin(Math.PI * t);
      return { c: 0.78 + 0.18 * thread + 0.08 * (fuzz(u, w) - 0.5), r: 1, h: thread };
    };
  },
  marble() {
    const warp = fbm(3, 3, 6, 83);
    const fine = fbm(8, 8, 4, 89);
    return (u, w) => {
      const v = Math.abs(Math.sin(2 * Math.PI * (2 * u + w + 2.2 * warp(u, w))));
      const vein = Math.pow(1 - v, 18) + 0.35 * Math.pow(1 - Math.abs(Math.sin(2 * Math.PI * (5 * w + 3 * fine(u, w)))), 40);
      return { c: 0.97 - 0.55 * clamp01(vein) - 0.06 * fine(u, w), r: 1, h: 0 };
    };
  },
};

// mm covered by one copy of each texture, and how strong its bumps are.
export const TEXTURES = {
  wood: { scale: 90, bump: 0.25 },
  brushed: { scale: 24, bump: 0.12 },
  carbon: { scale: 20, bump: 0.6 },
  concrete: { scale: 140, bump: 0.45 },
  leather: { scale: 30, bump: 0.35 },
  fabric: { scale: 16, bump: 0.5 },
  marble: { scale: 160, bump: 0 },
};

const SIZE = 512;
const made = new Map(); // kind -> { map, roughnessMap, normalMap }

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function texture(c, colour) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// Draw a built-in texture: colour, roughness and normal maps.
function draw(kind) {
  const f = RECIPES[kind]();
  const N = SIZE;
  const height = new Float32Array(N * N);
  const cMap = canvas(N);
  const rMap = canvas(N);
  const nMap = canvas(N);
  const cImg = cMap.getContext('2d').createImageData(N, N);
  const rImg = rMap.getContext('2d').createImageData(N, N);
  const nImg = nMap.getContext('2d').createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const p = f(x / N, y / N);
      const i = y * N + x;
      height[i] = p.h;
      const c = Math.round(clamp01(p.c) * 255);
      const r = Math.round(clamp01(p.r) * 255);
      cImg.data.set([c, c, c, 255], i * 4);
      rImg.data.set([r, r, r, 255], i * 4);
    }
  }
  const bump = (TEXTURES[kind].bump || 0) * 6;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const at = (i, j) => height[((j + N) % N) * N + ((i + N) % N)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * bump;
      const dy = (at(x, y + 1) - at(x, y - 1)) * bump;
      const len = Math.hypot(dx, dy, 1);
      // Canvas rows run downwards; texture v runs upwards.
      nImg.data.set([Math.round((0.5 - (0.5 * dx) / len) * 255), Math.round((0.5 + (0.5 * dy) / len) * 255), Math.round((0.5 + 0.5 / len) * 255), 255], (y * N + x) * 4);
    }
  }
  cMap.getContext('2d').putImageData(cImg, 0, 0);
  rMap.getContext('2d').putImageData(rImg, 0, 0);
  nMap.getContext('2d').putImageData(nImg, 0, 0);
  return { map: texture(cMap, true), roughnessMap: texture(rMap, false), normalMap: bump ? texture(nMap, false) : null };
}

const pictures = new Map(); // data URL -> { texture, ready }

function picture(src) {
  if (!pictures.has(src)) {
    let done;
    const ready = new Promise((r) => (done = r));
    const t = new THREE.TextureLoader().load(src, () => done(), undefined, () => done());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    pictures.set(src, { texture: t, ready });
  }
  return pictures.get(src);
}

const sized = new Map(); // "kind|mm" -> maps, so bodies share them

// The maps for a look ({ texture, textureScale, image, imageScale }), each
// repeated to the right size; null when the look has no texture.
// `onLoad` runs once a picture has loaded (its maps are then ready).
export function mapsFor(look, onLoad) {
  const repeat = (t, mmX, mmY = mmX) => {
    const c = t.clone();
    c.repeat.set(1 / mmX, 1 / mmY);
    c.needsUpdate = true;
    return c;
  };
  if (look.image) {
    const p = picture(look.image);
    const mm = look.imageScale || 50;
    const img = p.texture.image;
    if (!img?.width) {
      p.ready.then(() => onLoad?.());
      return null;
    }
    // The picture keeps its shape: `mm` is its width.
    p.sizes ||= new Map();
    if (!p.sizes.has(mm)) p.sizes.set(mm, { map: repeat(p.texture, mm, (mm * img.height) / img.width), picture: true });
    return p.sizes.get(mm);
  }
  const kind = look.texture;
  if (!kind || !RECIPES[kind]) return null;
  const mm = look.textureScale || TEXTURES[kind].scale;
  const key = `${kind}|${mm}`;
  if (!sized.has(key)) {
    if (!made.has(kind)) made.set(kind, draw(kind));
    const t = made.get(kind);
    sized.set(key, { map: repeat(t.map, mm), roughnessMap: repeat(t.roughnessMap, mm), normalMap: t.normalMap ? repeat(t.normalMap, mm) : null, picture: false });
  }
  return sized.get(key);
}

// Scale a picture down (long side at most `max` pixels) and return it as a
// JPEG data URL, so designs with pictures stay small.
export function shrinkPicture(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = canvas(1);
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This picture could not be read'));
    };
    img.src = url;
  });
}

const swatches = new Map();

// A small picture of a built-in texture for the materials list.
export function swatchImage(kind) {
  if (!RECIPES[kind]) return null;
  if (!swatches.has(kind)) {
    const f = RECIPES[kind]();
    const N = 96;
    const c = canvas(N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    // About a third of the texture, so the pattern reads at this size.
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = Math.round(clamp01(f(x / N / 3, y / N / 3).c) * 255);
        img.data.set([v, v, v, 255], (y * N + x) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    swatches.set(kind, c.toDataURL());
  }
  return swatches.get(kind);
}

// Wait until the pictures these looks use have loaded (before exporting).
export function picturesReady(looks) {
  return Promise.all(looks.filter((l) => l?.image).map((l) => picture(l.image).ready));
}
