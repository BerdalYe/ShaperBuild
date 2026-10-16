// The History tab of the items panel: every step that made or changed the
// bodies, in order. Click a step to change its numbers; everything after it
// is rebuilt.
import { h } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { editableParams, withParams, stepSummary } from '../core/replay.js';
import { formatLength, parseLength } from '../core/units.js';

const PRIMITIVE_ICONS = { box: 'box', cylinder: 'cylinder', sphere: 'sphere', cone: 'cone', torus: 'torus' };
const BOOLEAN_ICONS = { union: 'union', subtract: 'subtract', intersect: 'intersect' };

function stepIcon(f) {
  if (f.op === 'base') return f.label === 'Design' ? 'solid' : 'import';
  if (f.op === 'delete') return 'trash';
  const c = f.calls?.[0];
  if (!c) return 'solid';
  switch (c.method) {
    case 'primitive':
      return PRIMITIVE_ICONS[c.args.type] || 'box';
    case 'boolean':
      return BOOLEAN_ICONS[c.args.op] || 'union';
    case 'pattern':
      return c.args.kind === 'circular' ? 'patternCircular' : 'patternLinear';
    case 'transform':
      return c.args.scale ? 'scale' : c.args.copy ? 'duplicate' : 'move';
    case 'meshToSolid':
      return 'convert';
    default:
      return c.method;
  }
}

// Bodies a step made or changed.
function stepBodies(f) {
  if (f.op === 'base') return f.bodies.map((x) => x.b);
  if (f.op === 'delete') return [];
  return f.calls.flatMap((c) => c.out || []);
}

// Sketches a step was made from.
function stepSketches(f) {
  const ids = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const ref = v.$r || v.$c;
    if (ref?.sk) ids.add(ref.sk);
    Object.values(v).forEach(walk);
  };
  walk(f.calls || []);
  return [...ids];
}

export class HistoryList {
  constructor(panel, app) {
    this.panel = panel;
    this.app = app;
    this.open = null;
    app.history.on('change', () => panel.tab === 'history' && panel.render());
  }

  get steps() {
    return this.app.history.features;
  }

  render(scroll) {
    const steps = this.steps;
    if (!steps.length) {
      scroll.append(
        h('div.items-empty', {
          html: '<b>No steps yet.</b><br>Every change you make to bodies shows up here, in order: extrude, fillet, move…<br><br>Click a step later to change its numbers. Everything after it updates.',
        }),
      );
      return;
    }
    if (this.open && !steps.some((f) => f.id === this.open)) this.open = null;
    steps.forEach((f, i) => {
      scroll.append(this.row(f, i));
      if (this.open === f.id) scroll.append(this.editor(f));
    });
  }

  footText() {
    const n = this.steps.length;
    const bad = this.steps.filter((f) => f.error).length;
    if (this.app.history.busy) return 'Updating the design…';
    if (bad) return `${bad} step${bad === 1 ? '' : 's'} could not be rebuilt — click to see why`;
    return n ? `${n} step${n === 1 ? '' : 's'} — click a step to change it` : 'Tip: steps appear as you model';
  }

  row(f, i) {
    const app = this.app;
    const open = this.open === f.id;
    const row = h(`div.item.step${open ? '.selected' : ''}${f.suppressed ? '.step-off' : ''}${f.error ? '.step-bad' : ''}`);
    row.dataset.step = f.id;
    const num = h('span.step-num', { text: String(i + 1) });
    const ic = h('span.step-icon', { html: icon(stepIcon(f)) });
    const name = h('span.item-name', { text: f.label, title: f.error ? `${f.label}: ${f.error}` : f.label });
    const summary = stepSummary(f, (v) => formatLength(v, app.units));
    row.append(num, ic, name);
    if (f.suppressed) row.append(h('span.tag', { text: 'off', title: 'This step is turned off' }));
    else if (f.error) row.append(h('span.step-warn', { html: icon('close'), title: f.error }));
    else if (summary) row.append(h('span.tag', { text: summary }));
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menu(e, f);
    });
    row.append(more);
    row.addEventListener('click', () => {
      this.open = open ? null : f.id;
      this.panel.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu(e, f);
    });
    const bodies = stepBodies(f).filter((b) => app.doc.body(b));
    row.addEventListener('mouseenter', () => bodies.length && app.selection.setHover({ kind: 'body', bodyId: bodies[0] }));
    row.addEventListener('mouseleave', () => app.selection.setHover(null));
    return row;
  }

  menu(e, f) {
    const app = this.app;
    const bodies = stepBodies(f).filter((b) => app.doc.body(b));
    const sketches = stepSketches(f).filter((s) => app.doc.sketch(s));
    showMenu(e.clientX, e.clientY, [
      editableParams(f).length && {
        label: 'Change values',
        icon: 'settings',
        action: () => {
          this.open = f.id;
          this.panel.render();
        },
      },
      sketches.length && { label: 'Select its sketch', icon: 'sketch', action: () => this.selectSketches(sketches) },
      bodies.length && { label: 'Select its bodies', icon: 'select', action: () => app.selection.set(bodies.map((b) => ({ kind: 'body', bodyId: b }))) },
      { label: f.suppressed ? 'Turn on' : 'Turn off', icon: f.suppressed ? 'eye' : 'eyeOff', action: () => this.run(() => app.history.toggleSuppress(f.id)) },
      '-',
      { label: 'Delete step', icon: 'trash', danger: true, action: () => this.run(() => app.history.removeStep(f.id)) },
    ].filter(Boolean));
  }

  selectSketches(ids) {
    const app = this.app;
    for (const id of ids) if (app.doc.sketch(id)?.visible === false) app.cmd.setVisible('sketch', id, true);
    app.selection.set(ids.map((id) => ({ kind: 'sketch', sketchId: id })));
  }

  // Leave any tool first: it may hold a preview made from the old bodies.
  run(fn) {
    const app = this.app;
    if (!app.tools.isSelect) app.tools.cancel();
    fn();
  }

  editor(f) {
    const app = this.app;
    const box = h('div.step-edit');
    if (f.error) box.append(h('div.step-error', { text: f.error }));
    const params = editableParams(f);
    const commit = (key, value) => {
      const cur = editableParams(app.history.features.find((x) => x.id === f.id) || f).find((p) => p.key === key);
      if (!cur || cur.value === value) return;
      this.run(() => app.history.replaceStep(f.id, withParams(f, { [key]: value }), { label: `Edit ${f.label}` }));
    };
    for (const p of params) box.append(this.field(p, commit));
    if (!params.length) {
      const why = f.op === 'base' ? 'This step adds bodies from a file or an older design. It has no values to change.' : f.op === 'delete' ? 'This step deletes bodies.' : 'This step has no values to change.';
      box.append(h('div.step-note', { text: why }));
    }
    const sketches = stepSketches(f).filter((s) => app.doc.sketch(s));
    const actions = h('div.step-actions');
    if (sketches.length) {
      const b = h('button.btn', { text: 'Edit sketch', title: 'Select the sketch this step was made from. Change its curves or dimensions and the step updates.' });
      b.addEventListener('click', () => this.selectSketches(sketches));
      actions.append(b);
    }
    const off = h('button.btn', { text: f.suppressed ? 'Turn on' : 'Turn off', title: 'Skip this step without deleting it' });
    off.addEventListener('click', () => this.run(() => app.history.toggleSuppress(f.id)));
    const del = h('button.btn', { text: 'Delete', title: 'Remove this step from the history' });
    del.addEventListener('click', () => this.run(() => app.history.removeStep(f.id)));
    actions.append(off, del);
    box.append(actions);
    return box;
  }

  field(p, commit) {
    const app = this.app;
    const row = h('label.step-field', h('span.step-field-label', { text: p.label }));
    if (p.type === 'toggle') {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!p.value;
      cb.addEventListener('change', () => commit(p.key, cb.checked));
      row.append(cb);
      return row;
    }
    const show = (v) => (p.type === 'length' ? formatLength(v, app.units, { suffix: false }) : String(+(+v).toFixed(4)));
    const inp = h('input.num-input', { type: 'text', spellcheck: false, value: show(p.value) });
    inp.dataset.key = p.key;
    const parse = () => {
      const t = inp.value.trim();
      if (p.type === 'length') return parseLength(t, app.units);
      const v = Number(t.replace(/°$/, ''));
      return p.type === 'count' ? Math.round(v) : v;
    };
    const valid = (v) => {
      if (!Number.isFinite(v)) return false;
      if (p.type === 'count') return v >= 2 && v <= 500;
      if (p.type === 'angle' && p.check !== 'any' && Math.abs(v) > 360) return false;
      if (p.check === 'nonzero') return Math.abs(v) > 1e-6;
      if (p.check === 'positive') return v > 1e-6;
      return true;
    };
    const apply = () => {
      const v = parse();
      if (!valid(v)) {
        inp.classList.add('bad');
        return;
      }
      inp.classList.remove('bad');
      commit(p.key, v);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') apply();
      if (e.key === 'Escape') {
        inp.value = show(p.value);
        inp.blur();
      }
    });
    inp.addEventListener('change', apply);
    const unit = p.type === 'length' ? app.units : p.type === 'angle' ? '°' : '';
    row.append(inp, h('span.step-unit', { text: unit }));
    return row;
  }
}
