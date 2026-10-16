// Variables at the top of the History tab: name = value. Type a variable's
// name in any number field ("width / 2"); values typed that way follow the
// variable when it changes.
import { h } from './dom.js';
import { icon } from './icons.js';
import { showMenu, toast } from './overlays.js';
import { formatLength, formatAngle, trimNumber, UNITS } from '../core/units.js';
import { evaluate, solveVariables } from '../core/expr.js';
import { t, localNumber } from '../core/i18n.js';

const KINDS = [
  ['length', 'Length'],
  ['angle', 'Angle'],
  ['number', 'Number'],
];

export class VariablesList {
  constructor(panel, app) {
    this.panel = panel;
    this.app = app;
    this.focusId = null;
    this.renaming = null;
  }

  formatValue(v, r) {
    if (!r || r.error || !Number.isFinite(r.value)) return '–';
    if (v.kind === 'length') return formatLength(r.value, this.app.units);
    if (v.kind === 'angle') return formatAngle(r.value);
    return localNumber(trimNumber(r.value, 4));
  }

  // Why `expr` cannot be the value of variable `v` (null when it can).
  problem(v, expr) {
    const app = this.app;
    const list = app.doc.variables.map((x) => (x.id === v.id ? { ...x, expr } : x));
    const r = solveVariables(list, UNITS[app.units]?.factor ?? 1).get(v.name);
    if (r?.error) return r.error;
    try {
      evaluate(expr, { kind: v.kind, factor: UNITS[app.units]?.factor ?? 1, variables: new Map([...app.variables].filter(([n]) => n !== v.name)) });
      return null;
    } catch (err) {
      return err.message;
    }
  }

  render(scroll) {
    const app = this.app;
    const vars = app.doc.variables;
    const add = h('button.item-btn', { title: 'Add a variable', html: icon('plus') });
    add.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = add.getBoundingClientRect();
      showMenu(
        r.left,
        r.bottom + 4,
        KINDS.map(([kind, label]) => ({
          label,
          action: () => {
            const id = app.cmd.addVariable({ kind, expr: kind === 'angle' ? '45' : kind === 'number' ? '2' : '10' });
            if (id) {
              this.focusId = id;
              this.panel.render();
            }
          },
        })),
      );
    });
    const head = h('div.items-group-head.vars-head', h('span.ig-chev', { html: icon('variable') }), h('span', { text: 'Variables' }), h('span.count', { text: String(vars.length) }), add);
    head.title = t('Type a variable name in any number field, like width / 2');
    scroll.append(head);
    if (!vars.length) {
      scroll.append(h('div.vars-empty', { text: 'Name a size once and use it everywhere: add a variable, then type its name in any number field.' }));
      return;
    }
    const values = app.variables || new Map();
    for (const v of vars) scroll.append(this.row(v, values.get(v.name)));
  }

  row(v, r) {
    const app = this.app;
    const row = h(`div.item.var-row${r?.error ? '.step-bad' : ''}`);
    row.dataset.variable = v.id;
    let nameEl;
    if (this.renaming === v.id) {
      nameEl = h('input.var-name-input', { type: 'text', spellcheck: false, value: v.name });
      const done = (ok) => {
        if (this.renaming !== v.id) return;
        this.renaming = null;
        const name = nameEl.value.trim();
        if (ok && name && name !== v.name) app.cmd.updateVariable(v.id, { name });
        this.panel.render();
      };
      nameEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      nameEl.addEventListener('blur', () => done(true));
      setTimeout(() => {
        nameEl.focus();
        nameEl.select();
      }, 0);
    } else {
      nameEl = h('span.var-name', { str: v.name, title: 'Double-click to rename' });
      nameEl.addEventListener('dblclick', () => {
        this.renaming = v.id;
        this.panel.render();
      });
    }
    const input = h('input.num-input.var-expr', { type: 'text', spellcheck: false, value: v.expr });
    input.dataset.variable = v.id;
    const commit = () => {
      const expr = input.value.trim();
      if (expr === v.expr) return;
      const problem = this.problem(v, expr);
      input.classList.toggle('bad', !!problem);
      if (problem) {
        input.title = t(problem);
        toast(t('{name}: {problem}', { name: v.name, problem: t(problem) }), { type: 'error' });
        return;
      }
      app.cmd.updateVariable(v.id, { expr });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        commit();
        input.blur();
      }
      if (e.key === 'Escape') {
        input.value = v.expr;
        input.blur();
      }
    });
    input.addEventListener('change', commit);
    if (this.focusId === v.id) {
      this.focusId = null;
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    }
    const value = h('span.tag.var-value', { str: this.formatValue(v, r), title: r?.error ? t(r.error) : t(KINDS.find((k) => k[0] === v.kind)?.[1] || '') });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, [
        {
          label: 'Rename',
          icon: 'edit',
          action: () => {
            this.renaming = v.id;
            this.panel.render();
          },
        },
        ...KINDS.filter(([k]) => k !== v.kind).map(([kind, label]) => ({ label: t('Make it a {kind}', { kind: t(label).toLowerCase() }), raw: true, action: () => app.cmd.updateVariable(v.id, { kind }) })),
        '-',
        { label: 'Delete variable', icon: 'trash', danger: true, action: () => app.cmd.removeVariable(v.id) },
      ]);
    });
    row.append(nameEl, h('span.var-eq', { str: '=' }), input, value, more);
    return row;
  }
}
