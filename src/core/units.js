// Units and numeric input. Internally everything is millimetres and degrees.
import { localNumber } from './i18n.js';
import { evaluate } from './expr.js';

export const UNITS = {
  mm: { label: 'mm', name: 'Millimeters', factor: 1, decimals: 2 },
  cm: { label: 'cm', name: 'Centimeters', factor: 10, decimals: 3 },
  m: { label: 'm', name: 'Meters', factor: 1000, decimals: 4 },
  in: { label: 'in', name: 'Inches', factor: 25.4, decimals: 3 },
  ft: { label: 'ft', name: 'Feet', factor: 304.8, decimals: 4 },
};

// The design's variables, used by every number field (see expr.js).
let scope = new Map();
export function setVariables(values) {
  scope = values || new Map();
}
export function variableScope() {
  return scope;
}

// "25", "1in + 2mm", "(10+5)/2", "3 cm", "width / 2" -> millimetres (NaN if invalid).
export function parseLength(text, unit = 'mm') {
  try {
    return evaluate(text, { kind: 'length', factor: UNITS[unit]?.factor ?? 1, variables: scope });
  } catch {
    return NaN;
  }
}

// "45", "90°", "pi/2 rad" -> degrees (NaN if invalid).
export function parseAngle(text) {
  try {
    return evaluate(text, { kind: 'angle', variables: scope });
  } catch {
    return NaN;
  }
}

export function parseNumber(text) {
  try {
    return evaluate(text, { kind: 'number', variables: scope });
  } catch {
    return NaN;
  }
}

// Why a typed value is not valid (null when it is).
export function parseProblem(text, kind, unit = 'mm') {
  try {
    evaluate(text, { kind: kind === 'count' ? 'number' : kind, factor: UNITS[unit]?.factor ?? 1, variables: scope });
    return null;
  } catch (err) {
    return err.message;
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
