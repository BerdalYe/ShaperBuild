// Stable references for the design history. Faces and edges are found again
// after a rebuild by their geometry (type, direction and where they sit in
// the body), and sketch regions by the curves that outline them.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

function boxSize(bb) {
  return bb ? Math.max(len(sub(bb.max, bb.min)), 1e-6) : 1;
}

// Position inside the body's bounding box, 0..1 on each axis.
function relative(p, bb) {
  if (!bb) return [0, 0, 0];
  return [0, 1, 2].map((k) => {
    const s = bb.max[k] - bb.min[k];
    return s > 1e-9 ? (p[k] - bb.min[k]) / s : 0.5;
  });
}

function edgeMid(info) {
  if (info.type === 'circle') {
    if (info.closed) return info.center;
    const m = [(info.a[0] + info.b[0]) / 2, (info.a[1] + info.b[1]) / 2, (info.a[2] + info.b[2]) / 2];
    const v = sub(m, info.center);
    if (len(v) < 1e-9) return m;
    const u = unit(v);
    return [info.center[0] + u[0] * info.radius, info.center[1] + u[1] * info.radius, info.center[2] + u[2] * info.radius];
  }
  return [(info.a[0] + info.b[0]) / 2, (info.a[1] + info.b[1]) / 2, (info.a[2] + info.b[2]) / 2];
}

function edgeDir(info) {
  if (info.type === 'line') return unit(sub(info.b, info.a));
  if (info.type === 'circle') return info.axisDir;
  return null;
}

export function faceSig(info, bbox) {
  if (!info) return null;
  return {
    t: info.type,
    c: info.center,
    n: info.normal || (info.axis ? info.axis.dir : null),
    r: info.radius ?? null,
    a: info.area ?? 0,
    rel: relative(info.center || [0, 0, 0], bbox),
  };
}

export function edgeSig(info, bbox) {
  if (!info) return null;
  const m = edgeMid(info);
  return { t: info.type, m, d: edgeDir(info), l: info.length ?? 0, r: info.radius ?? null, rel: relative(m, bbox) };
}

const LIMIT = 0.9;

function scoreCommon(sig, pos, rel, size, n, r, sizeVal, sizeRef, signed) {
  let s = len(sub(pos, sig.c || sig.m)) / size + len(sub(rel, sig.rel)) * 0.8;
  const d = sig.n || sig.d;
  if (d && n) {
    const k = signed ? dot(d, n) : Math.abs(dot(d, n));
    s += (1 - k) * 6;
  }
  if (sig.r != null && r != null) s += (Math.abs(sig.r - r) / size) * 2;
  if (sizeRef > 1e-9 && sizeVal > 1e-9) s += Math.abs(Math.log(sizeVal / sizeRef)) * 0.25;
  return s;
}

// Index of the face in `faceInfos` that best matches `sig`, or -1.
export function matchFace(sig, faceInfos, bbox) {
  if (!sig || !faceInfos) return -1;
  const size = boxSize(bbox);
  let best = -1;
  let bestScore = Infinity;
  faceInfos.forEach((f, i) => {
    if (!f || f.type !== sig.t || !f.center) return;
    const n = f.normal || (f.axis ? f.axis.dir : null);
    const s = scoreCommon(sig, f.center, relative(f.center, bbox), size, n, f.radius ?? null, f.area ?? 0, sig.a, f.type === 'plane');
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore <= LIMIT ? best : -1;
}

// Index of the edge in `edgeInfos` that best matches `sig`, or -1.
export function matchEdge(sig, edgeInfos, bbox) {
  if (!sig || !edgeInfos) return -1;
  const size = boxSize(bbox);
  let best = -1;
  let bestScore = Infinity;
  edgeInfos.forEach((e, i) => {
    if (!e || e.type !== sig.t || !e.a) return;
    const m = edgeMid(e);
    const s = scoreCommon(sig, m, relative(m, bbox), size, edgeDir(e), e.radius ?? null, e.length ?? 0, sig.l, false);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return bestScore <= LIMIT ? best : -1;
}

// Region outlined by the same curves (most shared, then nearest centre).
export function pickRegion(ref, regions) {
  let best = -1;
  let bestScore = -Infinity;
  const want = new Set(ref.ents || []);
  regions.forEach((r, i) => {
    const have = new Set(r.entities || []);
    let shared = 0;
    for (const id of have) if (want.has(id)) shared++;
    const union = want.size + have.size - shared;
    const jac = union ? shared / union : 0;
    const d = ref.c && r.centroid ? len(sub(r.centroid, ref.c)) : 0;
    const s = jac * 1000 - d;
    if (jac > 0 && s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}

// Short, stable hash of a string (FNV-1a, 52 bits as base-36).
export function hashString(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}
