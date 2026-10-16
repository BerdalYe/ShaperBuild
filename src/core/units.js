// Units and numeric input. Internally everything is millimetres and degrees.
import { localNumber, readNumberText } from './i18n.js';

export const UNITS = {
  mm: { label: 'mm', name: 'Millimeters', factor: 1, decimals: 2 },
  cm: { label: 'cm', name: 'Centimeters', factor: 10, decimals: 3 },
  m: { label: 'm', name: 'Meters', factor: 1000, decimals: 4 },
  in: { label: 'in', name: 'Inches', factor: 25.4, decimals: 3 },
  ft: { label: 'ft', name: 'Feet', factor: 304.8, decimals: 4 },
};

const UNIT_ALIASES = {
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  cm: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "'": 'ft',
};

const ANGLE_ALIASES = { deg: 1, '°': 1, degree: 1, degrees: 1, rad: 180 / Math.PI, rads: 180 / Math.PI, radian: 180 / Math.PI };

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
      if (!m) throw new Error('Bad number');
      tokens.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ('+-*/()^'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '°') {
      tokens.push({ t: 'unit', v: c });
      i++;
      continue;
    }
    const m = src.slice(i).match(/^[a-z]+/i);
    if (m) {
      const w = m[0].toLowerCase();
      if (w === 'pi') tokens.push({ t: 'num', v: Math.PI });
      else tokens.push({ t: 'unit', v: w });
      i += m[0].length;
      continue;
    }
    throw new Error(`Unexpected "${c}"`);
  }
  return tokens;
}

// Evaluates an arithmetic expression where values may carry a unit.
// kind: 'length' (result in mm) or 'angle' (result in degrees).
function evaluate(src, kind, defaultFactor) {
  const tokens = tokenize(String(src).replace(/,/g, '.'));
  // A single unit at the very end applies to the whole expression:
  // "10+5 mm" is 15 mm and "pi/2 rad" is 90°.
  const units = tokens.filter((t) => t.t === 'unit');
  if (units.length === 1 && tokens[tokens.length - 1].t === 'unit' && tokens.length > 2) {
    const u = tokens.pop();
    const f = kind === 'angle' ? ANGLE_ALIASES[u.v] : UNIT_ALIASES[u.v] ? UNITS[UNIT_ALIASES[u.v]].factor : undefined;
    if (f === undefined) throw new Error(`Unknown unit "${u.v}"`);
    return evaluateTokens(tokens, kind, 1) * f;
  }
  return evaluateTokens(tokens, kind, defaultFactor);
}

function evaluateTokens(tokens, kind, defaultFactor) {
  let pos = 0;
  const peek = () => tokens[pos];
  const unitFactor = (u) => {
    if (kind === 'angle') return ANGLE_ALIASES[u];
    const key = UNIT_ALIASES[u];
    return key ? UNITS[key].factor : undefined;
  };
  // A value: { v, unit: boolean }
  const promote = (x) => (x.unit ? x.v : x.v * defaultFactor);

  function primary() {
    const tok = peek();
    if (!tok) throw new Error('Incomplete expression');
    let val;
    if (tok.t === 'num') {
      pos++;
      val = { v: tok.v, unit: false };
    } else if (tok.t === 'op' && tok.v === '(') {
      pos++;
      val = expr();
      if (!peek() || peek().v !== ')') throw new Error('Missing )');
      pos++;
    } else throw new Error('Unexpected token');
    const u = peek();
    if (u && u.t === 'unit') {
      const f = unitFactor(u.v);
      if (f === undefined) throw new Error(`Unknown unit "${u.v}"`);
      pos++;
      if (val.unit) throw new Error('Two units in a row');
      val = { v: val.v * f, unit: true };
    }
    return val;
  }

  function unary() {
    const tok = peek();
    if (tok && tok.t === 'op' && (tok.v === '-' || tok.v === '+')) {
      pos++;
      const x = unary();
      return { v: tok.v === '-' ? -x.v : x.v, unit: x.unit };
    }
    return power();
  }

  function power() {
    const base = primary();
    const tok = peek();
    if (tok && tok.t === 'op' && tok.v === '^') {
      pos++;
      const exp = unary();
      return { v: Math.pow(base.v, exp.v), unit: base.unit };
    }
    return base;
  }

  function term() {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/')) break;
      pos++;
      const right = unary();
      if (tok.v === '*') left = { v: left.v * right.v, unit: left.unit || right.unit };
      else {
        if (right.v === 0) throw new Error('Division by zero');
        left = left.unit && right.unit ? { v: left.v / right.v, unit: false } : { v: left.v / right.v, unit: left.unit };
      }
    }
    return left;
  }

  function expr() {
    let left = term();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) break;
      pos++;
      const right = term();
      if (left.unit !== right.unit) {
        left = { v: promote(left), unit: true };
        const r = promote(right);
        left.v = tok.v === '+' ? left.v + r : left.v - r;
      } else left = { v: tok.v === '+' ? left.v + right.v : left.v - right.v, unit: left.unit };
    }
    return left;
  }

  const result = expr();
  if (pos < tokens.length) throw new Error('Unexpected input');
  const v = promote(result);
  if (!Number.isFinite(v)) throw new Error('Not a number');
  return v;
}

// "25", "1in + 2mm", "(10+5)/2", "3 cm" -> millimetres (NaN if invalid).
export function parseLength(text, unit = 'mm') {
  try {
    return evaluate(readNumberText(text), 'length', UNITS[unit]?.factor ?? 1);
  } catch {
    return NaN;
  }
}

// "45", "90°", "pi/2 rad" -> degrees (NaN if invalid).
export function parseAngle(text) {
  try {
    return evaluate(readNumberText(text), 'angle', 1);
  } catch {
    return NaN;
  }
}

export function parseNumber(text) {
  try {
    return evaluate(readNumberText(text), 'count', 1);
  } catch {
    return NaN;
  }
}

export function trimNumber(v, decimals) {
  if (!Number.isFinite(v)) return '–';
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function toUnit(mm, unit = 'mm') {
  return mm / (UNITS[unit]?.factor ?? 1);
}

export function formatLength(mm, unit = 'mm', { suffix = true, decimals } = {}) {
  const u = UNITS[unit] || UNITS.mm;
  const v = localNumber(trimNumber(mm / u.factor, decimals ?? u.decimals));
  return suffix ? `${v} ${u.label}` : v;
}

export function formatArea(mm2, unit = 'mm') {
  const u = UNITS[unit] || UNITS.mm;
  return `${localNumber(trimNumber(mm2 / u.factor ** 2, u.decimals))} ${u.label}²`;
}

export function formatVolume(mm3, unit = 'mm') {
  const u = UNITS[unit] || UNITS.mm;
  return `${localNumber(trimNumber(mm3 / u.factor ** 3, u.decimals))} ${u.label}³`;
}

export function formatAngle(deg, decimals = 2) {
  return `${localNumber(trimNumber(deg, decimals))}°`;
}

// Grid spacing that looks good at the current zoom: 1, 2 or 5 × 10^n mm.
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
