// Which sketch values can still move: the null space of the constraint
// equations. A variable is free when some motion that keeps every
// constraint satisfied changes it.

// rows: [{ vars: [index], f(x) -> residual }], x: values, n: count.
// Returns a Uint8Array with 1 for each free variable.
export function freeVariables(rows, x, n) {
  const m = rows.length;
  const free = new Uint8Array(n);
  if (!m) return free.fill(1);
  // Jacobian by central differences (only the variables a row uses).
  const J = Array.from({ length: m }, () => new Float64Array(n));
  let big = 0;
  rows.forEach((r, i) => {
    for (const v of new Set(r.vars)) {
      const old = x[v];
      const h = 1e-6 * Math.max(1, Math.abs(old));
      x[v] = old + h;
      const fp = r.f(x);
      x[v] = old - h;
      const fm = r.f(x);
      x[v] = old;
      const d = (fp - fm) / (2 * h);
      J[i][v] += d;
      big = Math.max(big, Math.abs(d));
    }
  });
  const tol = 1e-7 * Math.max(1, big);
  // Reduced row echelon form with partial pivoting.
  const pivotRow = new Map(); // column -> row
  let rank = 0;
  for (let c = 0; c < n && rank < m; c++) {
    let best = rank;
    for (let r = rank + 1; r < m; r++) if (Math.abs(J[r][c]) > Math.abs(J[best][c])) best = r;
    if (Math.abs(J[best][c]) < tol) continue;
    [J[rank], J[best]] = [J[best], J[rank]];
    const row = J[rank];
    const p = row[c];
    for (let k = 0; k < n; k++) row[k] /= p;
    for (let r = 0; r < m; r++) {
      if (r === rank) continue;
      const f = J[r][c];
      if (Math.abs(f) < 1e-300) continue;
      const R = J[r];
      for (let k = 0; k < n; k++) R[k] -= f * row[k];
    }
    pivotRow.set(c, rank);
    rank++;
  }
  // Free columns move freely; a pivot column moves when it depends on one.
  for (let f = 0; f < n; f++) {
    if (pivotRow.has(f)) continue;
    free[f] = 1;
    for (const [c, r] of pivotRow) if (Math.abs(J[r][f]) > tol) free[c] = 1;
  }
  return free;
}
