// Constraint glyphs and dimension labels drawn over sketches, editing of
// dimension values, and the list of constraints that fit a selection.
import { CONSTRAINT_INFO, pointOf, refsAt } from '../core/solver.js';
import { planeFrame, to3D } from '../core/plane.js';
import { formatLength, trimNumber, parseLength, parseAngle } from '../core/units.js';
import { arcMidpoint } from '../core/geom2d.js';
import { toast } from './overlays.js';
import { t } from '../core/i18n.js';

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export class ConstraintLayer {
  constructor(app) {
    this.app = app;
    this.keys = new Set();
    this.editing = null;
  }

  get overlay() {
    return this.app.vp.overlay;
  }

  // Sketches whose constraint glyphs should show (dimensions always show).
  activeSketches() {
    const app = this.app;
    const ids = new Set();
    for (const it of app.selection.list) if (it.sketchId) ids.add(it.sketchId);
    if (app.selection.hover?.sketchId) ids.add(app.selection.hover.sketchId);
    const t = app.tools.active;
    if (t?.sketchId) ids.add(t.sketchId);
    if (app.settings.showConstraints) for (const s of app.doc.sketches) ids.add(s.id);
    return ids;
  }

  update() {
    const app = this.app;
    const seen = new Set();
    const active = this.activeSketches();
    const selected = new Set(app.selection.list.filter((it) => it.kind === 'constraint').map((it) => `${it.sketchId}:${it.cid}`));
    if (!app.visual) {
      for (const sk of app.doc.sketches) {
        if (sk.visible === false || !sk.constraints?.length) continue;
        const f = planeFrame(sk.plane);
        const stack = new Map();
        for (const c of sk.constraints) {
          const info = CONSTRAINT_INFO[c.type];
          if (!info) continue;
          if (!info.dimension && !active.has(sk.id)) continue;
          const place = this.placement(sk, c);
          if (!place) continue;
          // Stack glyphs that share an anchor.
          const sk2 = place.key || '';
          const n = stack.get(sk2) || 0;
          stack.set(sk2, n + 1);
          const key = `cons-${sk.id}-${c.id}`;
          seen.add(key);
          const sel = selected.has(`${sk.id}:${c.id}`);
          const text = info.dimension ? this.dimText(c) : info.glyph;
          this.overlay.label(key, to3D(f, place.at), text, {
            className: `${info.dimension ? 'dim-label' : 'cons-glyph'}${sel ? ' selected' : ''}${active.has(sk.id) ? '' : ' faint'}`,
            offset: [place.offset[0] + (info.dimension ? 0 : n * 17), place.offset[1]],
            interactive: true,
            title: `${t(info.label)} — ${t(info.dimension ? 'click to edit' : 'click to select, Delete to remove')}`,
            onClick: (e) => this.onLabelClick(sk.id, c, e),
          });
        }
      }
    }
    for (const key of this.keys) if (!seen.has(key) && key !== this.editing?.key) this.overlay.removeLabel(key);
    this.keys = seen;
  }

  dimText(c) {
    const u = this.app.units;
    switch (c.type) {
      case 'radius':
        return `R ${formatLength(c.value, u)}`;
      case 'diameter':
        return `⌀ ${formatLength(c.value, u)}`;
      case 'angle':
        return `${trimNumber(Math.abs(c.value), 2)}°`;
      default:
        return formatLength(c.value, u);
    }
  }

  // Where a constraint label sits (plane coordinates + pixel offset).
  placement(sk, c) {
    const ents = sk.entities;
    const ent = (id) => ents.find((e) => e.id === id);
    const mid = (en) => {
      if (!en) return null;
      if (en.type === 'line') return lerp2(en.a, en.b, 0.5);
      if (en.type === 'circle') return [en.c[0], en.c[1] + en.r];
      if (en.type === 'arc') return arcMidpoint(en);
      return null;
    };
    switch (c.type) {
      case 'length': {
        const en = ent(c.e);
        return en ? { at: mid(en), offset: [0, -16] } : null;
      }
      case 'radius':
      case 'diameter': {
        const en = ent(c.e);
        if (!en) return null;
        const a = Math.PI / 4;
        return { at: [en.c[0] + en.r * Math.cos(a), en.c[1] + en.r * Math.sin(a)], offset: [18, -12] };
      }
      case 'angle': {
        const a = ent(c.e);
        const b = ent(c.e2);
        return a && b ? { at: lerp2(mid(a), mid(b), 0.5), offset: [0, 0] } : null;
      }
      case 'distance': {
        const p = pointOf(ents, c.p);
        const q = pointOf(ents, c.p2);
        return p && q ? { at: lerp2(p, q, 0.5), offset: [0, -14] } : null;
      }
      case 'fix':
      case 'coincident':
      case 'midpoint':
      case 'onCurve': {
        const p = pointOf(ents, c.p);
        return p ? { at: p, offset: [12, 12], key: `${p[0]},${p[1]}` } : null;
      }
      default: {
        const en = ent(c.e);
        const m = mid(en);
        return m ? { at: m, offset: [10, 14], key: c.e } : null;
      }
    }
  }

  onLabelClick(sketchId, c, e) {
    if (CONSTRAINT_INFO[c.type].dimension) return this.edit(sketchId, c.id);
    const item = { kind: 'constraint', sketchId, cid: c.id };
    if (e.shiftKey || e.ctrlKey || e.metaKey) this.app.selection.toggle(item);
    else this.app.selection.set([item]);
  }

  // Inline editor for a dimension's value.
  edit(sketchId, cid) {
    const sk = this.app.doc.sketch(sketchId);
    const c = sk?.constraints?.find((x) => x.id === cid);
    if (!c) return;
    const key = `cons-${sketchId}-${cid}`;
    this.update();
    const label = this.overlay.labels.get(key);
    if (!label) return;
    const el = label.el;
    const isAngle = c.type === 'angle';
    const shown = isAngle ? Math.abs(c.value) : c.value;
    const input = document.createElement('input');
    input.className = 'num-input dim-edit';
    input.value = isAngle ? trimNumber(shown, 3) : formatLength(shown, this.app.units, { suffix: false, decimals: 4 });
    el.textContent = '';
    el.append(input);
    el.classList.add('editing');
    this.editing = { key, sketchId, cid };
    input.focus();
    input.select();
    const finish = (save) => {
      if (!this.editing || this.editing.key !== key) return;
      this.editing = null;
      el.classList.remove('editing');
      if (save) {
        let v = isAngle ? parseAngle(input.value) : parseLength(input.value, this.app.units);
        if (isAngle && Number.isFinite(v)) v = Math.sign(c.value || 1) * Math.abs(v);
        if (!Number.isFinite(v)) toast('Not a valid number', { type: 'error' });
        else if (Math.abs(v - c.value) > 1e-12) this.app.cmd.setConstraintValue(sketchId, cid, v);
      }
      this.overlay.removeLabel(key);
      this.update();
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // Constraints that can be added for the current selection:
  // [{ label, glyph, constraint, sketchId }]
  options() {
    const app = this.app;
    const list = app.selection.list;
    if (!list.length) return [];
    const sketchIds = new Set(list.map((it) => it.sketchId));
    if (sketchIds.size !== 1 || list.some((it) => it.kind !== 'curve' && it.kind !== 'spoint')) return [];
    const sketchId = [...sketchIds][0];
    const sk = app.doc.sketch(sketchId);
    if (!sk) return [];
    const ents = list.filter((it) => it.kind === 'curve').map((it) => sk.entities.find((e) => e.id === it.entityId)).filter(Boolean);
    const pts = list.filter((it) => it.kind === 'spoint').map((it) => refsAt(sk.entities, it.point)[0]).filter(Boolean);
    const lines = ents.filter((e) => e.type === 'line');
    const rounds = ents.filter((e) => e.type === 'circle' || e.type === 'arc');
    const out = [];
    const add = (type, extra) => out.push({ label: CONSTRAINT_INFO[type].label, glyph: CONSTRAINT_INFO[type].glyph || '↔', constraint: { type, ...extra }, sketchId });
    if (ents.length === 1 && !pts.length) {
      const e = ents[0];
      if (e.type === 'line') {
        add('horizontal', { e: e.id });
        add('vertical', { e: e.id });
        add('length', { e: e.id });
      }
      if (e.type === 'circle') add('diameter', { e: e.id });
      if (e.type === 'arc') add('radius', { e: e.id });
    }
    if (lines.length === 2 && ents.length === 2) {
      const [a, b] = lines;
      add('parallel', { e: a.id, e2: b.id });
      add('perpendicular', { e: a.id, e2: b.id });
      add('equal', { e: a.id, e2: b.id });
      add('angle', { e: a.id, e2: b.id });
    }
    if (lines.length === 1 && rounds.length === 1 && ents.length === 2) add('tangent', { e: lines[0].id, e2: rounds[0].id });
    if (rounds.length === 2 && ents.length === 2) {
      add('concentric', { e: rounds[0].id, e2: rounds[1].id });
      add('equal', { e: rounds[0].id, e2: rounds[1].id });
      add('tangent', { e: rounds[0].id, e2: rounds[1].id });
    }
    if (pts.length === 1 && ents.length === 1) {
      if (lines.length === 1) add('midpoint', { p: pts[0], e: lines[0].id });
      add('onCurve', { p: pts[0], e: ents[0].id });
    }
    if (pts.length === 2 && !ents.length) {
      add('coincident', { p: pts[0], p2: pts[1] });
      add('distance', { p: pts[0], p2: pts[1] });
    }
    if (pts.length === 1 && !ents.length) add('fix', { p: pts[0] });
    // Do not offer a constraint that already exists.
    const same = (c, d) => c.type === d.type && c.e === d.e && c.e2 === d.e2 && JSON.stringify(c.p) === JSON.stringify(d.p);
    return out.filter((o) => !(sk.constraints || []).some((c) => same(c, o.constraint)));
  }
}
