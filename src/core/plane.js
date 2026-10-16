// Sketch planes: { origin, xDir, normal } as plain arrays.

export const GROUND = Object.freeze({ origin: [0, 0, 0], xDir: [1, 0, 0], normal: [0, 0, 1] });

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function planeFrame(plane) {
  const n = norm3(plane.normal);
  const xd = plane.xDir || defaultXDir(n);
  const d = dot3(xd, n);
  const x = norm3([xd[0] - n[0] * d, xd[1] - n[1] * d, xd[2] - n[2] * d]);
  const y = cross3(n, x);
  return { o: plane.origin, x, y, n };
}

export function to3D(f, p) {
  return [f.o[0] + f.x[0] * p[0] + f.y[0] * p[1], f.o[1] + f.x[1] * p[0] + f.y[1] * p[1], f.o[2] + f.x[2] * p[0] + f.y[2] * p[1]];
}

export function to2D(f, P) {
  const v = [P[0] - f.o[0], P[1] - f.o[1], P[2] - f.o[2]];
  return [dot3(v, f.x), dot3(v, f.y)];
}

// Direction in the plane (2D) to world direction.
export function dir3D(f, d) {
  return [f.x[0] * d[0] + f.y[0] * d[1], f.x[1] * d[0] + f.y[1] * d[1], f.x[2] * d[0] + f.y[2] * d[1]];
}

export function defaultXDir(n) {
  n = norm3(n);
  if (Math.abs(n[2]) > 0.9) return [1, 0, 0];
  return norm3(cross3([0, 0, 1], n));
}

export function makePlane(origin, normal, xDir) {
  const n = norm3(normal);
  return { origin: [...origin], normal: n, xDir: xDir ? norm3(xDir) : defaultXDir(n) };
}

export function samePlane(a, b, eps = 1e-5) {
  const na = norm3(a.normal);
  const nb = norm3(b.normal);
  if (dot3(na, nb) < 1 - 1e-6) return false;
  const off = [b.origin[0] - a.origin[0], b.origin[1] - a.origin[1], b.origin[2] - a.origin[2]];
  return Math.abs(dot3(off, na)) < eps;
}

export function rayPlane(origin, dir, plane) {
  const n = norm3(plane.normal);
  const den = dot3(dir, n);
  if (Math.abs(den) < 1e-9) return null;
  const t = dot3([plane.origin[0] - origin[0], plane.origin[1] - origin[1], plane.origin[2] - origin[2]], n) / den;
  if (t < 0) return null;
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
}

export function offsetPlane(plane, d) {
  const n = norm3(plane.normal);
  return { ...plane, origin: [plane.origin[0] + n[0] * d, plane.origin[1] + n[1] * d, plane.origin[2] + n[2] * d] };
}

export function flipPlane(plane) {
  return { ...plane, normal: plane.normal.map((v) => -v), xDir: [...plane.xDir] };
}
