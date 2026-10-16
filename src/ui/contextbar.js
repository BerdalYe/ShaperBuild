// Suggestions for the current selection, shown at the bottom of the view,
// plus quick size edits for single sketch curves.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { formatLength, parseLength } from '../core/units.js';
import { dist, angleOf, polar } from '../core/geom2d.js';

export class ContextBar {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  // [{ label, icon, action }]
  suggestions() {
    const app = this.app;
    const list = app.selection.list;
    const kinds = new Set(list.map((it) => it.kind));
    const only = (...k) => [...kinds].every((x) => k.includes(x));
    const tool = (id, label, ic) => ({ label, icon: ic || id, action: () => app.tools.activate(id, { force: true }) });
    const out = [];
    if (!list.length) return out;
    if (only('region', 'face')) {
      const planar = list.every((it) => it.kind === 'region' || app.faceInfo(it.bodyId, it.index)?.type === 'plane');
      if (planar) out.push(tool('extrude', 'Extrude'), tool('revolve', 'Revolve'));
      if (list.filter((it) => it.kind === 'region' || it.kind === 'face').length >= 2 && planar) out.push(tool('loft', 'Loft'));
      if (kinds.has('face') && !kinds.has('region')) out.push(tool('shell', 'Shell'));
      if (kinds.has('region')) out.push(tool('sweep', 'Sweep'));
    }
    if (only('edge')) out.push(tool('fillet', 'Fillet'), tool('chamfer', 'Chamfer'));
    if (only('body', 'face')) {
      const bodies = new Set(list.map((it) => it.bodyId));
      if (kinds.has('body') || bodies.size > 1) {
        out.push(tool('move', 'Move'), tool('mirror', 'Mirror'), tool('patternLinear', 'Pattern', 'patternLinear'));
        if (bodies.size >= 2) out.push(tool('union', 'Union'), tool('subtract', 'Subtract'), tool('intersect', 'Intersect'));
        out.push(tool('scale', 'Scale'));
        if ([...bodies].some((id) => app.doc.body(id)?.kind === 'mesh')) out.push({ label: 'Convert to solid', icon: 'convert', action: () => app.cmd.convertToSolid() });
      }
    }
    if (only('curve', 'spoint', 'sketch')) {
      if (kinds.has('curve')) out.push({ label: 'Construction', icon: 'construction', action: () => app.tools.activate('construction') });
      if (kinds.has('curve')) out.push(tool('offset', 'Offset'));
      out.push(tool('move', 'Move'));
    }
    return out;
  }

  render() {
    const app = this.app;
    const list = app.selection.list;
    clear(this.el);
    if (!list.length || !app.tools.isSelect || app.visual) {
      this.el.hidden = true;
      return;
    }
    const counts = {};
    for (const it of list) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const NAMES = { body: ['body', 'bodies'], face: ['face', 'faces'], edge: ['edge', 'edges'], region: ['region', 'regions'], curve: ['curve', 'curves'], spoint: ['point', 'points'], sketch: ['sketch', 'sketches'], vertex: ['vertex', 'vertices'] };
    const label = Object.entries(counts)
      .map(([k, n]) => `${n} ${(NAMES[k] || [k, k])[n === 1 ? 0 : 1]}`)
      .join(', ');
    this.el.append(h('span.cb-label', { text: label }));
    const props = this.quickProps(list);
    if (props) this.el.append(h('span.cb-sep'), props);
    const sug = this.suggestions();
    if (sug.length) this.el.append(h('span.cb-sep'));
    for (const s of sug) {
      const b = h('button.cb-btn', { html: `${icon(s.icon)}<span>${s.label}</span>` });
      b.addEventListener('click', s.action);
      this.el.append(b);
    }
    this.el.append(h('span.cb-sep'));
    const del = h('button.cb-btn', { title: 'Delete (Del)', html: icon('trash') });
    del.addEventListener('click', () => app.cmd.deleteSelection());
    this.el.append(del);
    this.el.hidden = false;
  }

  // Editable size for a single selected line, circle or arc.
  quickProps(list) {
    if (list.length !== 1 || list[0].kind !== 'curve') return null;
    const app = this.app;
    const it = list[0];
    const sk = app.doc.sketch(it.sketchId);
    const en = sk?.entities.find((e) => e.id === it.entityId);
    if (!en) return null;
    let label;
    let value;
    let applyFn;
    if (en.type === 'line') {
      label = 'Length';
      value = dist(en.a, en.b);
      applyFn = (v) => ({ ...en, b: polar(en.a, v, angleOf([en.b[0] - en.a[0], en.b[1] - en.a[1]])) });
    } else if (en.type === 'circle') {
      label = 'Diameter';
      value = en.r * 2;
      applyFn = (v) => ({ ...en, r: v / 2 });
    } else if (en.type === 'arc') {
      label = 'Radius';
      value = en.r;
      applyFn = (v) => ({ ...en, r: v });
    } else return null;
    const inp = h('input.num-input', { type: 'text', value: formatLength(value, app.units, { suffix: false }) });
    const commit = () => {
      const v = parseLength(inp.value, app.units);
      if (!(v > 0) || Math.abs(v - value) < 1e-9) return;
      const ents = sk.entities.map((e) => (e.id === en.id ? applyFn(v) : e));
      app.cmd.setSketchEntities(sk.id, ents, `Set ${label.toLowerCase()}`);
      app.selection.set([it]);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') inp.blur();
    });
    inp.addEventListener('change', commit);
    return h('span.cb-prop', h('span', { text: label }), inp, h('span', { text: app.units }));
  }
}
