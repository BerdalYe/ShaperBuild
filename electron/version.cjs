// Compare dotted version numbers like "1.10.0" and "1.9.2".
function parts(v) {
  return String(v)
    .replace(/^v/, '')
    .split(/[-+]/)[0]
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
}

function isNewer(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

module.exports = { isNewer };
