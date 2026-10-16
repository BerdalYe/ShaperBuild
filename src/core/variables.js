// Variables in a design, and the values linked to them. A linked value
// keeps the text it was typed as ("width / 2"): history steps in `exprs`
// ({ argument path: text }) and sketch dimensions in `expr`. When a
// variable changes, `relink` works the new values out again.
import { evaluate, solveVariables, referencedNames, renameIn, dependents } from './expr.js';
import { editableParams, withParams } from './replay.js';
import { solveSketch } from './solver.js';
import { UNITS } from './units.js';

const factorOf = (units) => UNITS[units]?.factor ?? 1;

// Map name -> { value, kind, error } for a document state (or draft).
export function variableValues(state) {
  return solveVariables(state.variables || [], factorOf(state.units));
}

// The text to keep with a typed value: only when it uses a variable.
export function linkedText(text, values) {
  const s = String(text ?? '').trim();
  if (!s || !values?.size) return null;
  return referencedNames(s).some((n) => values.has(n)) ? s : null;
}

const KIND = { length: 'length', angle: 'angle', number: 'number', count: 'number' };

// Work out every linked value again in a draft (inside doc.apply). Returns
// the labels of values that could not be updated.
export function relink(d) {
  const values = variableValues(d);
  const factor = factorOf(d.units);
  const problems = [];
  const calc = (text, kind) => evaluate(text, { kind: KIND[kind] || 'number', factor, variables: values });
  d.history = d.history.map((f) => {
    if (!f.exprs) return f;
    const params = editableParams(f);
    const next = {};
    for (const [key, text] of Object.entries(f.exprs)) {
      const p = params.find((x) => x.key === key);
      if (!p) continue;
      try {
        let v = calc(text, p.type);
        if (p.type === 'count') v = Math.round(v);
        if (Math.abs(v - p.value) > 1e-9) next[key] = v;
      } catch {
        problems.push(f.label);
      }
    }
    return Object.keys(next).length ? withParams(f, next) : f;
  });
  for (const sk of d.sketches) {
    if (!(sk.constraints || []).some((c) => c.expr)) continue;
    let changed = false;
    const cons = sk.constraints.map((c) => {
      if (!c.expr) return c;
      try {
        const v = calc(c.expr, c.type === 'angle' ? 'angle' : 'length');
        if (Math.abs(v - c.value) < 1e-9) return c;
        changed = true;
        return { ...c, value: v };
      } catch {
        problems.push(sk.name);
        return c;
      }
    });
    if (!changed) continue;
    const res = solveSketch(sk.entities, cons);
    if (res.ok) d.updateSketch(sk.id, { entities: res.entities, constraints: res.constraints });
    else problems.push(sk.name);
  }
  return problems;
}

// Where a variable is used: other variables, history steps and sketches.
export function usesOf(state, name) {
  const out = dependents(state.variables || [], name).map((n) => n);
  const uses = (text) => referencedNames(text).includes(name);
  for (const f of state.history || []) if (Object.values(f.exprs || {}).some(uses)) out.push(f.label);
  for (const sk of state.sketches || []) if ((sk.constraints || []).some((c) => c.expr && uses(c.expr))) out.push(sk.name);
  return [...new Set(out)];
}

// Rename a variable in every text that uses it.
export function renameEverywhere(d, from, to) {
  d.variables = d.variables.map((v) => ({ ...v, name: v.name === from ? to : v.name, expr: renameIn(v.expr, from, to) }));
  d.history = d.history.map((f) => (f.exprs ? { ...f, exprs: Object.fromEntries(Object.entries(f.exprs).map(([k, s]) => [k, renameIn(s, from, to)])) } : f));
  for (const sk of d.sketches) {
    if (!(sk.constraints || []).some((c) => c.expr)) continue;
    d.updateSketch(sk.id, { constraints: sk.constraints.map((c) => (c.expr ? { ...c, expr: renameIn(c.expr, from, to) } : c)) });
  }
}

// A plain number typed for a length variable keeps its unit, so changing
// the design's unit later does not change the variable ("20" -> "20 mm").
export function withUnit(expr, kind, units) {
  if (kind !== 'length') return expr;
  try {
    const a = evaluate(expr, { kind: 'length', factor: 1 });
    const b = evaluate(expr, { kind: 'length', factor: 2 });
    if (a !== b && !/[A-Za-z"'°]/.test(expr)) return `${expr.trim()} ${units}`;
  } catch {}
  return expr;
}
