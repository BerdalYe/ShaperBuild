// Expressions for every number field: arithmetic, units, functions and
// variables. A value carries its dimension, so "20mm * 3" is a length,
// "area / length" is a length again, and "10mm + 30deg" is an error.
//
//   evaluate('2 * width + 1in', { kind: 'length', factor: 1 })  -> mm
//   evaluate('atan2(3, 4)', { kind: 'angle' })                   -> degrees
//
// Plain numbers take the design's unit in length fields ("10 + 5mm" with
// centimetres is 10.5 cm) and degrees in angle fields. Trigonometry works in
// degrees, as everywhere else in the app.

export const LENGTH_UNITS = { mm: 1, millimeter: 1, millimeters: 1, cm: 10, m: 1000, meter: 1000, meters: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8 };
export const ANGLE_UNITS = { deg: 1, '°': 1, degree: 1, degrees: 1, rad: 180 / Math.PI, rads: 180 / Math.PI, radian: 180 / Math.PI, radians: 180 / Math.PI };

const D2R = Math.PI / 180;
const EPS = 1e-8;

// value: { v, len: power of length, ang: power of angle, plain: no unit yet }
const scalar = (v) => ({ v, len: 0, ang: 0, plain: false });
const plain = (v) => ({ v, len: 0, ang: 0, plain: true });
const angle = (deg) => ({ v: deg, len: 0, ang: 1, plain: false });

class ExprError extends Error {}
const fail = (msg) => {
  throw new ExprError(msg);
};

// Functions (case-sensitive); aliases share an entry.
const FN = {};
const def = (names, n, fn) => names.split(' ').forEach((k) => (FN[k] = { n, fn }));
const toDeg = (x) => {
  if (x.len !== 0 || x.ang > 1) fail('Trigonometry needs an angle');
  return x.v; // plain numbers are degrees
};
const same = (a, b) => a.len === b.len && a.ang === b.ang;
const keep = (x, v) => ({ ...x, v });
const ratio = (x) => {
  if (x.len !== 0 || x.ang !== 0) fail('This function needs a plain number');
  return x.v;
};
const asin = (v) => {
  if (Math.abs(v) > 1 + EPS) fail('Value out of range');
  return Math.asin(Math.max(-1, Math.min(1, v)));
};
def('sqrt', 1, ([x]) => {
  if (x.v < -EPS) fail('Square root of a negative number');
  if (x.len % 2 || x.ang % 2) fail('Square root of this unit is not possible');
  return { v: Math.sqrt(Math.max(0, x.v)), len: x.len / 2, ang: x.ang / 2, plain: x.plain };
});
def('sign sgn', 1, ([x]) => scalar(Math.sign(x.v)));
def('floor', 1, ([x]) => keep(x, Math.floor(x.v + EPS)));
def('ceil ceiling', 1, ([x]) => keep(x, Math.ceil(x.v - EPS)));
def('round', 1, ([x]) => keep(x, Math.round(x.v)));
def('abs absolute', 1, ([x]) => keep(x, Math.abs(x.v)));
def('mod remainder', 2, ([a, b], k) => {
  [a, b] = k.unify(a, b);
  if (Math.abs(b.v) < EPS) fail('Division by zero');
  return keep(a, a.v - b.v * Math.floor(a.v / b.v + EPS));
});
const many = (pick) => (args, k) => {
  if (!args.length) fail('Missing value');
  const ref = args.find((x) => !x.plain) || args[0];
  const xs = args.map((x) => k.unify(ref, x)[1]);
  return keep(ref, pick(xs.map((x) => x.v)));
};
def('min minimum', -1, many((vs) => Math.min(...vs)));
def('max maximum', -1, many((vs) => Math.max(...vs)));
def('avg average mean', -1, many((vs) => vs.reduce((s, v) => s + v, 0) / vs.length));
def('sin', 1, ([x]) => scalar(Math.sin(toDeg(x) * D2R)));
def('cos', 1, ([x]) => scalar(Math.cos(toDeg(x) * D2R)));
def('tan tg', 1, ([x]) => scalar(Math.tan(toDeg(x) * D2R)));
def('cotan cot ctg', 1, ([x]) => scalar(1 / Math.tan(toDeg(x) * D2R)));
def('sec', 1, ([x]) => scalar(1 / Math.cos(toDeg(x) * D2R)));
def('cosec csc', 1, ([x]) => scalar(1 / Math.sin(toDeg(x) * D2R)));
def('arcsin asin', 1, ([x]) => angle(asin(ratio(x)) / D2R));
def('arccos acos', 1, ([x]) => angle((Math.PI / 2 - asin(ratio(x))) / D2R));
def('arctan atan', 1, ([x]) => angle(Math.atan(ratio(x)) / D2R));
def('arctan2 atan2', 2, ([y, x], k) => {
  [y, x] = k.unify(y, x);
  return angle(Math.atan2(y.v, x.v) / D2R);
});
def('arccotan acot actg', 1, ([x]) => angle(Math.atan2(1, ratio(x)) / D2R));
def('arcsec asec', 1, ([x]) => angle((Math.PI / 2 - asin(1 / ratio(x))) / D2R));
def('arccosec acsc', 1, ([x]) => angle(asin(1 / ratio(x)) / D2R));
def('pi', 0, () => plain(Math.PI));
def('radians', 1, ([x]) => scalar(toDeg(x) * D2R));

export const FUNCTIONS = Object.keys(FN);
const RESERVED = new Set([...FUNCTIONS, ...Object.keys(LENGTH_UNITS), ...Object.keys(ANGLE_UNITS), 'pi', 'e']);

// Variable names: letters, digits and _, not starting with a digit or "__",
// at most 100 characters, and not a unit or function name.
export function nameProblem(name) {
  if (!name) return 'Give the variable a name';
  if (name.length > 100) return 'Names can be at most 100 characters';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return 'Use English letters, digits and _ (not first)';
  if (name.startsWith('__')) return 'Names cannot start with two underscores';
  if (RESERVED.has(name)) return 'That name is a unit or function';
  return null;
}

// Names of variables an expression uses.
export function referencedNames(text) {
  const out = new Set();
  for (const t of tokenize(prepare(String(text ?? '')))) if (t.t === 'id' && !FN[t.v] && !isUnit(t.v) && t.v !== 'pi') out.add(t.v);
  return [...out];
}

const isUnit = (w) => LENGTH_UNITS[w.toLowerCase()] !== undefined || ANGLE_UNITS[w.toLowerCase()] !== undefined;

// Imperial mixed numbers: 1 1/2" is (1 + 1/2) inches. Arguments may be
// separated with ";" so decimal commas still work: max(1,5; 2).
function prepare(src) {
  let s = src.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)(?=\s*(?:"|'|in\b|ft\b|inch|feet|foot))/g, '($1+$2/$3)');
  if (s.includes(';')) s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ',');
  else if (!/[A-Za-z_]\w*\s*\(/.test(s)) s = s.replace(/(\d),(\d)/g, '$1.$2');
  return s;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i);
      if (!m) fail('Bad number');
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ('+-*/()^,'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '°') {
      tokens.push({ t: 'unit', v: c });
      i++;
      continue;
    }
    if (c === '×' || c === '·') {
      tokens.push({ t: 'op', v: '*' });
      i++;
      continue;
    }
    if (c === '÷') {
      tokens.push({ t: 'op', v: '/' });
      i++;
      continue;
    }
    if (c === '−') {
      tokens.push({ t: 'op', v: '-' });
      i++;
      continue;
    }
    const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (m) {
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    fail(`Unexpected "${c}"`);
  }
  return tokens;
}

// kind: 'length' (result in mm), 'angle' (degrees) or 'number'.
// factor: millimetres per plain number in length fields (the design unit).
// variables: Map name -> { value, kind } with value in mm / degrees.
export function evaluate(text, { kind = 'number', factor = 1, variables } = {}) {
  const tokens = tokenize(prepare(String(text ?? '')));
  if (!tokens.length) fail('Type a value');
  // One unit at the very end of plain numbers applies to all of them:
  // "10+5 mm" is 15 mm and "pi/2 rad" is 90°.
  const last = tokens[tokens.length - 1];
  const unitTokens = tokens.filter((t) => t.t === 'unit' || (t.t === 'id' && isUnit(t.v)));
  if (tokens.length > 2 && unitTokens.length === 1 && unitTokens[0] === last && kind !== 'number') {
    try {
      const v = run(tokens.slice(0, -1), { kind: 'number', factor: 1, variables, plainOnly: true });
      return tidy(run([{ t: 'num', v }, last], { kind, factor, variables }));
    } catch (err) {
      if (!(err instanceof ExprError)) throw err;
    }
  }
  return tidy(run(tokens, { kind, factor, variables }));
}

// Results are exact to 1e-9 (so 1 1/2" is 38.1 mm, not 38.0999…).
const tidy = (v) => Math.round(v * 1e9) / 1e9;

function run(tokens, { kind, factor, variables, plainOnly = false }) {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.t === 'op' && peek().v === v;

  // Plain numbers in a sum with a length or angle take that dimension.
  const promote = (x, like) => {
    if (!x.plain) return x;
    if (like.len === 1 && like.ang === 0) return { v: x.v * factor, len: 1, ang: 0, plain: false };
    if (like.ang === 1 && like.len === 0) return { v: x.v, len: 0, ang: 1, plain: false };
    return x;
  };
  const unify = (a, b) => {
    a = promote(a, b);
    b = promote(b, a);
    if (!same(a, b)) {
      if ((a.len && b.ang) || (a.ang && b.len)) fail('Length and angle cannot be mixed');
      fail('The units do not match');
    }
    return [a, b];
  };
  const k = { unify };

  function withUnit(val) {
    const u = peek();
    if (!u) return val;
    const w = u.t === 'unit' ? u.v : u.t === 'id' && isUnit(u.v) ? u.v.toLowerCase() : null;
    if (w === null) return val;
    pos++;
    if (!val.plain) fail('Two units in a row');
    if (LENGTH_UNITS[w] !== undefined) {
      if (kind === 'angle') fail('Length and angle cannot be mixed');
      return { v: val.v * LENGTH_UNITS[w], len: 1, ang: 0, plain: false };
    }
    if (kind === 'length') fail('Length and angle cannot be mixed');
    return { v: val.v * ANGLE_UNITS[w], len: 0, ang: 1, plain: false };
  }

  function primary() {
    const tok = peek();
    if (!tok) fail('Incomplete expression');
    let val;
    if (tok.t === 'num') {
      pos++;
      val = plain(tok.v);
    } else if (tok.t === 'op' && tok.v === '(') {
      pos++;
      val = sum();
      if (!isOp(')')) fail('Missing )');
      pos++;
    } else if (tok.t === 'id') {
      pos++;
      const f = FN[tok.v];
      if (f && isOp('(')) {
        pos++;
        const args = [];
        if (!isOp(')')) {
          args.push(sum());
          while (isOp(',')) {
            pos++;
            args.push(sum());
          }
        }
        if (!isOp(')')) fail('Missing )');
        pos++;
        if (f.n >= 0 && args.length !== f.n) fail(`${tok.v}() takes ${f.n} value${f.n === 1 ? '' : 's'}`);
        val = f.fn(args, k);
      } else if (tok.v === 'pi') val = plain(Math.PI);
      else if (variables?.has(tok.v)) {
        const vr = variables.get(tok.v);
        if (vr.error) fail(`${tok.v} has an error`);
        val = vr.kind === 'length' ? { v: vr.value, len: 1, ang: 0, plain: false } : vr.kind === 'angle' ? angle(vr.value) : scalar(vr.value);
      } else if (f) fail(`${tok.v} needs ( )`);
      else fail(`Unknown name "${tok.v}"`);
    } else fail('Unexpected token');
    return withUnit(val);
  }

  function power() {
    const base = primary();
    if (isOp('^')) {
      pos++;
      const e = unary();
      if (e.len || e.ang) fail('Powers must be plain numbers');
      return { v: Math.pow(base.v, e.v), len: base.len * e.v, ang: base.ang * e.v, plain: base.plain };
    }
    return base;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const neg = peek().v === '-';
      pos++;
      const x = unary();
      return neg ? { ...x, v: -x.v } : x;
    }
    return power();
  }

  function product() {
    let left = unary();
    for (;;) {
      if (!isOp('*') && !isOp('/')) break;
      const op = peek().v;
      pos++;
      const right = unary();
      if (op === '*') left = { v: left.v * right.v, len: left.len + right.len, ang: left.ang + right.ang, plain: left.plain && right.plain };
      else {
        if (Math.abs(right.v) < 1e-300) fail('Division by zero');
        left = { v: left.v / right.v, len: left.len - right.len, ang: left.ang - right.ang, plain: left.plain && right.plain };
      }
    }
    return left;
  }

  function sum() {
    let left = product();
    for (;;) {
      let op = null;
      if (isOp('+') || isOp('-')) {
        op = peek().v;
        pos++;
      } else if (kind === 'length' && !left.plain && left.len === 1 && peek()?.t === 'num') op = '+'; // 1' 6"
      else break;
      let right = product();
      [left, right] = unify(left, right);
      left = { ...left, v: op === '+' ? left.v + right.v : left.v - right.v };
    }
    return left;
  }

  const r = sum();
  if (pos < tokens.length) fail('Unexpected input');
  if (!Number.isFinite(r.v)) fail('Not a number');
  if (plainOnly && !r.plain) fail('Not plain');
  if (r.plain) return kind === 'length' ? r.v * factor : r.v;
  if (kind === 'length') {
    if (r.len === 1 && r.ang === 0) return r.v;
    fail(r.ang ? 'Length and angle cannot be mixed' : 'The result is not a length');
  }
  if (kind === 'angle') {
    if (r.ang === 1 && r.len === 0) return r.v;
    if (r.ang === 0 && r.len === 0) return r.v;
    fail('The result is not an angle');
  }
  if (r.len === 0 && r.ang === 0) return r.v;
  fail('The result must be a plain number');
}

// Values of a design's variables, in order, with errors for bad ones.
// list: [{ name, kind, expr }]. Returns Map name -> { value, kind, error }.
export function solveVariables(list, factor = 1) {
  const byName = new Map(list.map((v) => [v.name, v]));
  const out = new Map();
  const visiting = new Set();
  const solve = (name) => {
    if (out.has(name)) return out.get(name);
    const v = byName.get(name);
    if (visiting.has(name)) {
      const r = { value: NaN, kind: v.kind, error: 'Refers to itself' };
      out.set(name, r);
      return r;
    }
    visiting.add(name);
    for (const dep of referencedNames(v.expr)) if (byName.has(dep)) solve(dep);
    visiting.delete(name);
    let r;
    try {
      r = { value: evaluate(v.expr, { kind: v.kind, factor, variables: out }), kind: v.kind };
    } catch (err) {
      r = { value: NaN, kind: v.kind, error: err.message };
    }
    if (!out.has(name)) out.set(name, r);
    return out.get(name);
  };
  for (const v of list) solve(v.name);
  return out;
}

// Variables that use `name` (directly or through others).
export function dependents(list, name) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const v of list) {
      if (out.has(v.name) || v.name === name) continue;
      if (referencedNames(v.expr).some((n) => n === name || out.has(n))) {
        out.add(v.name);
        grew = true;
      }
    }
  }
  return [...out];
}

// Rename a variable inside an expression.
export function renameIn(text, from, to) {
  return String(text).replace(new RegExp(`(^|[^A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, 'g'), `$1${to}`);
}
