// Suggestions for the current selection, shown at the bottom of the view,
// plus quick size edits for single sketch curves.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { formatLength, parseLength } from '../core/units.js';
import { dist } from '../core/geom2d.js';
import { t, tn } from '../core/i18n.js';

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
      if (only('region')) out.push(tool('move', 'Move'), { label: 'Duplicate', icon: 'duplicate', action: () => app.cmd.duplicate() });
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
      if (!kinds.has('spoint')) out.push({ label: 'Duplicate', icon: 'duplicate', action: () => app.cmd.duplicate() });
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
    const NAMES = { constraint: ['constraint', 'constraints'], body: ['body', 'bodies'], face: ['face', 'faces'], edge: ['edge', 'edges'], region: ['region', 'regions'], curve: ['curve', 'curves'], spoint: ['point', 'points'], sketch: ['sketch', 'sketches'], vertex: ['vertex', 'vertices'], plane: ['plane', 'planes'], axis: ['axis', 'axes'], image: ['image', 'images'] };
    const label = Object.entries(counts)
      .map(([k, n]) => tn(n, `1 ${(NAMES[k] || [k, k])[0]}`, `{n} ${(NAMES[k] || [k, k])[1]}`))
      .join(', ');
    this.el.append(h('span.cb-label', { str: label }));
    const props = this.quickProps(list);
    if (props) this.el.append(h('span.cb-sep'), props);
    const cons = app.constraints.options();
    if (cons.length) {
      this.el.append(h('span.cb-sep'));
      const b = h('button.cb-btn', { html: `<span class="glyph">⊥</span><span>${t('Constrain')}</span>${icon('chevronDown')}` });
      b.querySelector('svg').style.cssText = 'width:14px;height:14px';
      b.addEventListener('click', () => {
        const r = b.getBoundingClientRect();
        const menu = showMenu(
          r.left,
          r.top,
          cons.map((o) => ({ label: `<span class="glyph">${o.glyph}</span>${t(o.label)}`, action: () => app.constraints.apply(o) })),
        );
        const mr = menu.getBoundingClientRect();
        menu.style.top = `${r.top - mr.height - 6}px`;
      });
      this.el.append(b);
    }
    const sug = this.suggestions();
    if (sug.length) this.el.append(h('span.cb-sep'));
    for (const s of sug) {
      const b = h('button.cb-btn', { html: `${icon(s.icon)}<span>${t(s.label)}</span>` });
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
  // (or updates) a dimension constraint, like typing into a dimension label.
  quickProps(list) {
    const app = this.app;
    if (list.length === 1 && list[0].kind === 'image') return this.imageProps(list[0].imageId);
    if (list.length === 1 && list[0].kind === 'constraint') return null;
    // A shape (region), points or the whole sketch: the sketch's sizes.
    const sketches = new Set(list.map((it) => it.sketchId));
    if (sketches.size === 1 && !sketches.has(undefined) && list.some((it) => it.kind !== 'curve') && list.every((it) => ['region', 'sketch', 'spoint', 'curve'].includes(it.kind))) {
      return this.sketchProps(list[0].sketchId);
    }
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
    let done = false;
    const commit = () => {
      const v = parseLength(inp.value, app.units);
      if (done || !(v > 0) || Math.abs(v - value) < 1e-9) return;
      done = true;
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

  // The sizes of a sketch, ready to type over: its dimensions, or for a
  // sketch without them, the width and height of its rectangle and the
  // sizes of its circles. Typing a size adds or changes a dimension, and
  // bodies made from the sketch follow.
  sketchProps(sketchId) {
    const app = this.app;
    const sk = app.doc.sketch(sketchId);
    const rows = sk ? sketchSizes(sk) : [];
    if (!rows.length) return null;
    const box = h('span.cb-prop.cb-sizes');
    for (const row of rows) {
      const inp = h('input.num-input', { type: 'text', value: formatLength(row.value, app.units, { suffix: false }) });
      inp.dataset.size = row.label;
      // Enter applies; the change event that follows when the bar is
      // redrawn must not add the dimension a second time.
      let done = false;
      const commit = () => {
        const v = parseLength(inp.value, app.units);
        if (done || !(v > 0) || Math.abs(v - row.value) < 1e-9) return;
        done = true;
        const keep = app.selection.list;
        if (row.cid) app.cmd.setConstraintValue(sk.id, row.cid, v);
        else app.cmd.addConstraint(sk.id, { type: row.type, e: row.e, value: v });
        app.selection.set(keep);
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') inp.blur();
      });
      inp.addEventListener('change', commit);
      // Show which curve a size belongs to.
      inp.addEventListener('mouseenter', () => app.selection.setHover({ kind: 'curve', sketchId: sk.id, entityId: row.e }));
      inp.addEventListener('mouseleave', () => app.selection.setHover(null));
      box.append(h('span', { text: row.label }), inp, h('span', { text: app.units }));
    }
    box.title = t('Type a new size and press Enter. Bodies made from this sketch follow.');
    return box;
  }
}

const SIZE_TYPES = { line: 'length', circle: 'diameter', arc: 'radius' };

// [{ label, type, e, value, cid? }]: at most four sizes worth showing.
export function sketchSizes(sk) {
  const cons = sk.constraints || [];
  const ents = sk.entities.filter((en) => !en.construction);
  const byId = new Map(sk.entities.map((en) => [en.id, en]));
  const has = (type, id) => cons.some((c) => c.type === type && c.e === id);
  // Level lines read as widths, upright ones as heights.
  const lineLabel = (en) => {
    const dx = Math.abs(en.b[0] - en.a[0]);
    const dy = Math.abs(en.b[1] - en.a[1]);
    if (has('horizontal', en.id) || dy < 1e-9 * Math.max(1, dx)) return 'Width';
    if (has('vertical', en.id) || dx < 1e-9 * Math.max(1, dy)) return 'Height';
    return 'Length';
  };
  const size = (en, type) => (type === 'length' ? dist(en.a, en.b) : type === 'diameter' ? en.r * 2 : en.r);
  const rows = [];
  const seen = new Set();
  for (const c of cons) {
    const en = byId.get(c.e);
    if (!en || SIZE_TYPES[en.type] !== c.type) continue;
    const label = c.type === 'length' ? lineLabel(en) : c.type === 'diameter' ? 'Diameter' : 'Radius';
    rows.push({ label, type: c.type, e: en.id, value: c.value, cid: c.id });
    seen.add(label);
  }
  // Sketches without dimensions (drawn by clicking): offer the obvious ones.
  // Long outlines (text, traced pictures) have no single size worth showing.
  if (ents.length <= 12) {
    for (const en of ents) {
      const type = SIZE_TYPES[en.type];
      if (!type || cons.some((c) => c.type === type && c.e === en.id)) continue;
      const label = type === 'length' ? lineLabel(en) : type === 'diameter' ? 'Diameter' : 'Radius';
      if (label === 'Length' || seen.has(label)) continue;
      rows.push({ label, type, e: en.id, value: size(en, type) });
      seen.add(label);
    }
  }
  return rows.slice(0, 4);
}
