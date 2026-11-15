// Trace a picture into outlines: pick the dark (or opaque) shapes, follow
// their edges, simplify, and turn the outlines into sketch curves: straight
// lines at corners, smooth splines along curves. Pure functions: the caller
// reads the pixels.

// Which pixels are the shape: `rgba` is the picture's pixels (4 bytes each).
// Transparent pictures: the opaque parts. Others: a threshold between light
// and dark (Otsu), with the background being whatever covers most of the
// border.
export function shapeMask(rgba, w, h) {
  const n = w * h;
  const lum = new Float32Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    if (a < 0.5) transparent++;
    // On white, as the picture shows on a page.
    lum[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
  }
  const mask = new Uint8Array(n);
  if (transparent > n * 0.05) {
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0;
    return mask;
  }
  const t = otsu(lum);
  for (let i = 0; i < n; i++) mask[i] = lum[i] < t ? 1 : 0;
  // The border is mostly background: flip if it came out as the shape.
  let border = 0;
  let count = 0;
  for (let x = 0; x < w; x++) {
    border += mask[x] + mask[(h - 1) * w + x];
    count += 2;
  }
  for (let y = 0; y < h; y++) {
    border += mask[y * w] + mask[y * w + w - 1];
    count += 2;
  }
  if (border > count / 2) for (let i = 0; i < n; i++) mask[i] ^= 1;
  return mask;
}

function otsu(lum) {
  const hist = new Float64Array(256);
  for (const v of lum) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = lum.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      t = i + 0.5;
    }
  }
  return t;
}

// The outlines of the mask: closed loops of points (pixel units, y down),
// along the middle of each pixel edge. Outer outlines and holes both come
// back; the sketch works out which is inside which.
export function maskOutlines(mask, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // Directed edges between pixel corners, the shape on their right (y down).
  const out = new Map();
  const key = (x, y) => y * (w + 1) + x;
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    const e = { x0, y0, x1, y1, used: false };
    const list = out.get(k);
    if (list) list.push(e);
    else out.set(k, [e]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const list of out.values()) {
    for (const first of list) {
      if (first.used) continue;
      const pts = [];
      let e = first;
      while (e && !e.used) {
        e.used = true;
        pts.push([(e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2]);
        const next = (out.get(key(e.x1, e.y1)) || []).filter((c) => !c.used);
        if (next.length <= 1) e = next[0];
        else {
          // Where two shapes touch at a corner, turn right: they stay apart.
          const dx = e.x1 - e.x0;
          const dy = e.y1 - e.y0;
          e = next.find((c) => c.x1 - c.x0 === -dy && c.y1 - c.y0 === dx) || next[0];
        }
      }
      if (pts.length >= 4) loops.push(pts);
    }
  }
  return loops;
}

export function loopArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Douglas–Peucker on a closed loop.
export function simplifyLoop(pts, tol) {
  if (pts.length < 4) return pts.slice();
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen([...pts.slice(far), pts[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function simplifyOpen(pts, tol) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [a, b] = [pts[i0], pts[i1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([i0, at], [at, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// A closed outline as sketch curves: lines where it has corners sharper than
// `cornerDeg`, splines through the points elsewhere.
export function loopToEntities(pts, { cornerDeg = 40 } = {}) {
  const n = pts.length;
  if (n < 3) return [];
  const turn = (i) => {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const b = Math.atan2(r[1] - q[1], r[0] - q[0]);
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return (d * 180) / Math.PI;
  };
  const corners = [];
  for (let i = 0; i < n; i++) if (turn(i) > cornerDeg) corners.push(i);
  if (!corners.length) return [{ type: 'spline', pts: pts.map((p) => p.slice()), closed: true }];
  const ents = [];
  for (let c = 0; c < corners.length; c++) {
    const i0 = corners[c];
    const i1 = corners[(c + 1) % corners.length];
    const run = [];
    for (let i = i0; ; i = (i + 1) % n) {
      run.push(pts[i]);
      if (i === i1 && run.length > 1) break;
      if (run.length > n + 1) break;
    }
    if (run.length === 2) ents.push({ type: 'line', a: run[0], b: run[1] });
    else ents.push({ type: 'spline', pts: run });
  }
  return ents;
}

// The whole job: pixels → sketch curves in millimetres, centred, y up.
// `width` is the picture's real width in mm.
export function traceImage(rgba, w, h, { width, height = (width * h) / w, minArea = 12, tolerance = 0.8 } = {}) {
  const mask = shapeMask(rgba, w, h);
  const loops = maskOutlines(mask, w, h).filter((l) => Math.abs(loopArea(l)) >= minArea);
  const sx = width / w;
  const sy = height / h;
  const entities = [];
  for (const loop of loops) {
    const simple = simplifyLoop(loop, tolerance).map(([x, y]) => [(x - w / 2) * sx, (h / 2 - y) * sy]);
    entities.push(...loopToEntities(simple));
  }
  return { entities, loops: loops.length };
}
