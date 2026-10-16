// Construction geometry: reference planes and axes made from other things.
// Planes are { origin, normal, xDir }; axes are { origin, dir }.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a);
  return l > 1e-12 ? mul(a, 1 / l) : null;
};

// Any direction at right angles to n.
export function perpendicular(n) {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, a));
}

// A plane with x direction at right angles to its normal.
export function planeAt(origin, normal, xHint = null) {
  const n = unit(normal);
  if (!n) return null;
  let x = xHint ? sub(xHint, mul(n, dot(xHint, n))) : null;
  x = (x && unit(x)) || perpendicular(n);
  return { origin: [...origin], normal: n, xDir: x };
}

// Halfway between two planes (parallel or not): the plane of points at equal
// distance from both. Parallel planes give the plane in the middle; planes
// at an angle give the plane that halves the angle.
export function midplane(a, b) {
  let nb = b.normal;
  // Faces of a slab point away from each other: compare as lines, not arrows.
  if (dot(a.normal, nb) < 0) nb = mul(nb, -1);
  const mid = add(a.origin, b.origin).map((v) => v / 2);
  const n = unit(add(a.normal, nb));
  if (!n) return null;
  if (len(cross(a.normal, nb)) < 1e-9) {
    // Parallel: halfway along the normal from a's origin.
    const d = dot(sub(b.origin, a.origin), a.normal) / 2;
    return planeAt(add(a.origin, mul(a.normal, d)), a.normal, a.xDir);
  }
  // At an angle: through the line where they meet.
  const line = planesMeet(a, { origin: b.origin, normal: nb });
  return planeAt(line ? line.origin : mid, n, line ? line.dir : a.xDir);
}

// Through three points (null when they are on one line).
export function planeThrough(p1, p2, p3) {
  const n = unit(cross(sub(p2, p1), sub(p3, p1)));
  if (!n) return null;
  return planeAt(p1, n, sub(p2, p1));
}

// At right angles to a curve at a point on it (tangent = curve direction).
export function planeNormalTo(point, tangent) {
  return planeAt(point, tangent);
}

// Through a straight line, turned by `angle` degrees about it from the
// reference normal (or from the plane the line and the up axis span).
export function planeThroughLine(line, angle = 0, refNormal = null) {
  const d = unit(line.dir);
  if (!d) return null;
  let base = refNormal ? sub(refNormal, mul(d, dot(refNormal, d))) : null;
  base = (base && unit(base)) || perpendicular(d);
  const t = (angle * Math.PI) / 180;
  const other = cross(d, base);
  const n = add(mul(base, Math.cos(t)), mul(other, Math.sin(t)));
  return planeAt(line.origin, n, d);
}

// The line where two planes meet (null when parallel).
export function planesMeet(a, b) {
  const dir = cross(a.normal, b.normal);
  const l = len(dir);
  if (l < 1e-9) return null;
  const d = mul(dir, 1 / l);
  // Point on both planes closest to a's origin.
  const da = dot(a.normal, a.origin);
  const db = dot(b.normal, b.origin);
  const n1n2 = dot(a.normal, b.normal);
  const det = 1 - n1n2 * n1n2;
  const c1 = (da - db * n1n2) / det;
  const c2 = (db - da * n1n2) / det;
  let o = add(mul(a.normal, c1), mul(b.normal, c2));
  // Move the point along the line to near a's origin, so it is easy to see.
  o = add(o, mul(d, dot(sub(a.origin, o), d)));
  return { origin: o, dir: d };
}

// Axis through two points.
export function axisThrough(p1, p2) {
  const d = unit(sub(p2, p1));
  return d ? { origin: [...p1], dir: d, length: len(sub(p2, p1)) } : null;
}

// Where a line meets a plane (null when parallel).
export function lineMeetsPlane(line, plane) {
  const den = dot(line.dir, plane.normal);
  if (Math.abs(den) < 1e-12) return null;
  const t = dot(sub(plane.origin, line.origin), plane.normal) / den;
  return add(line.origin, mul(line.dir, t));
}

// Nearest point to p on a line.
export function closestOnLine(line, p) {
  return add(line.origin, mul(line.dir, dot(sub(p, line.origin), line.dir)));
}
