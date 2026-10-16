// Suggestions for the current selection, shown at the bottom of the view,
// plus quick size edits for single sketch curves.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { formatLength, parseLength } from '../core/units.js';
import { dist } from '../core/geom2d.js';

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
    if (only('image') && list.length === 1) {
      const im = app.doc.image(list[0].imageId);
      out.push(tool('line', 'Trace with lines', 'line'), tool('spline', 'Spline'), tool('move', 'Move'));
      if (im) out.push({ label: 'Look at', icon: 'lookAt', action: () => app.vp.lookAtPlane(im.plane) });
    }
    if (only('plane') && list.length === 1) {
      const pl = app.doc.plane(list[0].planeId);
      out.push(tool('rect', 'Draw a rectangle', 'rect'), tool('circle', 'Circle'), tool('text', 'Text'));
      if (pl) out.push({ label: 'Look at', icon: 'lookAt', action: () => app.vp.lookAtPlane(pl.plane) });
    }
    if (only('curve', 'spoint', 'sketch')) {
      if (kinds.has('curve')) out.push({ label: 'Construction', icon: 'construction', action: () => app.tools.activate('construction') });
      if (kinds.has('curve')) out.push(tool('offset', 'Offset'));
      out.push(tool('move', 'Move'));
    }
    return out;
  }

  render() {
    // Clearing blurs a focused size box, whose change handler can update
    // the document and render again; skip that nested call.
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.renderBar();
    } finally {
      this.rendering = false;
    }
  }

  renderBar() {
    const app = this.app;
    const list = app.selection.list;
    clear(this.el);
    if (!list.length || !app.tools.isSelect || app.visual) {
      this.el.hidden = true;
      return;
    }
    const counts = {};
    for (const it of list) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const NAMES = { constraint: ['constraint', 'constraints'], body: ['body', 'bodies'], face: ['face', 'faces'], edge: ['edge', 'edges'], region: ['region', 'regions'], curve: ['curve', 'curves'], spoint: ['point', 'points'], sketch: ['sketch', 'sketches'], vertex: ['vertex', 'vertices'], plane: ['plane', 'planes'], image: ['image', 'images'] };
    const label = Object.entries(counts)
      .map(([k, n]) => `${n} ${(NAMES[k] || [k, k])[n === 1 ? 0 : 1]}`)
      .join(', ');
    this.el.append(h('span.cb-label', { text: label }));
    const props = this.quickProps(list);
    if (props) this.el.append(h('span.cb-sep'), props);
    const cons = app.constraints.options();
    if (cons.length) {
      this.el.append(h('span.cb-sep'));
      const b = h('button.cb-btn', { html: `<span class="glyph">⊥</span><span>Constrain</span>${icon('chevronDown')}` });
      b.querySelector('svg').style.cssText = 'width:14px;height:14px';
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        const menu = showMenu(
          r.left,
          r.top,
          cons.map((o) => ({ label: `<span class="glyph">${o.glyph}</span>${o.label}`, action: () => app.cmd.addConstraint(o.sketchId, o.constraint) })),
        );
        const mr = menu.getBoundingClientRect();
        menu.style.top = `${r.top - mr.height - 6}px`;
      });
      this.el.append(b);
    }
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

  // Real width (height follows) and see-through amount of an image.
  imageProps(id) {
    const app = this.app;
    const im = app.doc.image(id);
    if (!im) return null;
    const inp = h('input.num-input', { type: 'text', value: formatLength(im.width, app.units, { suffix: false }), title: 'Real width of the picture' });
    let done = false;
    const commit = () => {
      const v = parseLength(inp.value, app.units);
      if (done || !(v > 0) || Math.abs(v - im.width) < 1e-9) return;
      done = true;
      app.cmd.setImage(id, { width: v, height: (im.height / im.width) * v }, 'Image size');
      app.selection.set([{ kind: 'image', imageId: id }]);
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') inp.blur();
    });
    inp.addEventListener('change', commit);
    const op = h('input.cb-range', { type: 'range', min: 10, max: 100, step: 5, value: Math.round((im.opacity ?? 0.6) * 100), title: 'How see-through the picture is' });
    op.addEventListener('input', () => {
      const view = app.vp.imageViews.get(id);
      if (view) {
        view.mat.opacity = op.value / 100;
        app.vp.requestRender();
      }
    });
    op.addEventListener('change', () => {
      app.cmd.setImage(id, { opacity: op.value / 100 }, 'Image opacity');
      app.selection.set([{ kind: 'image', imageId: id }]);
    });
    return h('span.cb-prop', h('span', { text: 'Width' }), inp, h('span', { text: app.units }), h('span', { text: 'Opacity', style: { marginLeft: '8px' } }), op);
  }

  // Editable size for a single selected line, circle or arc. Setting it adds
  // (or updates) a dimension constraint, like typing into a Shapr3D label.
  quickProps(list) {
    const app = this.app;
    if (list.length === 1 && list[0].kind === 'image') return this.imageProps(list[0].imageId);
    if (list.length === 1 && list[0].kind === 'constraint') return null;
    if (list.length !== 1 || list[0].kind !== 'curve') return null;
    const it = list[0];
    const sk = app.doc.sketch(it.sketchId);
    const en = sk?.entities.find((e) => e.id === it.entityId);
    if (!en) return null;
    const type = { line: 'length', circle: 'diameter', arc: 'radius' }[en.type];
    if (!type) return null;
    const label = { length: 'Length', diameter: 'Diameter', radius: 'Radius' }[type];
    const value = type === 'length' ? dist(en.a, en.b) : type === 'diameter' ? en.r * 2 : en.r;
    const existing = (sk.constraints || []).find((c) => c.type === type && c.e === en.id);
    const inp = h('input.num-input', { type: 'text', value: formatLength(value, app.units, { suffix: false }) });
    const commit = () => {
      const v = parseLength(inp.value, app.units);
      if (!(v > 0) || Math.abs(v - value) < 1e-9) return;
      if (existing) app.cmd.setConstraintValue(sk.id, existing.id, v);
      else app.cmd.addConstraint(sk.id, { type, e: en.id, value: v });
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
