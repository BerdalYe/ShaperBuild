// Sketch editing: trim, offset and construction toggling.
import { Tool } from './base.js';
import { OpTool } from './optool.js';
import { trimEntity, sampleEntity, offsetEntity, lineLoop, offsetPolygon, translateEntity, rotateEntity } from '../core/geom2d.js';
import { planeFrame, to2D, to3D, rayPlane, makePlane, GROUND } from '../core/plane.js';
import { toast } from '../ui/overlays.js';
import { t, tn } from '../core/i18n.js';

export class TrimTool extends Tool {
  get pickKinds() {
    return ['curve'];
  }

  activate() {
    this.setHint('Click the part of a curve you want to remove · <kbd>Esc</kbd> to finish');
    this.app.panel.show({ title: 'Trim', icon: 'trim', hint: 'Hover a curve to see which piece will be removed. Pieces are bounded by intersections with other curves.', fields: [], onCancel: () => this.done() });
  }

  deactivate() {
    this.app.vp.overlay.clear('tool');
  }

  compute(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return null;
    const sk = this.app.doc.sketch(hit.sketchId);
    const ent = sk?.entities.find((x) => x.id === hit.entityId);
    if (!ent) return null;
    const f = planeFrame(sk.plane);
    const P = rayPlane(e.ray.origin, e.ray.dir, sk.plane) || rayPlane(e.ray.origin, e.ray.dir.map((v) => -v), sk.plane);
    if (!P) return null;
    const at = to2D(f, P);
    return { sk, ent, f, ...trimEntity(ent, at, sk.entities) };
  }

  onPointerMove(e) {
    const r = this.compute(e);
    const ov = this.app.vp.overlay;
    if (!r) return ov.remove('tool-trim');
    ov.lines('tool-trim', [sampleEntity(r.removed, 64).map((p) => to3D(r.f, p))], { color: this.app.vp.theme.previewCut, width: 3.5, depthTest: false });
  }

  onPointerDown(e) {
    const r = this.compute(e);
    if (!r) return;
    this.app.vp.overlay.remove('tool-trim');
    const ents = [];
    for (const en of r.sk.entities) {
      if (en.id !== r.ent.id) ents.push(en);
      else ents.push(...r.keep);
    }
    this.app.cmd.setSketchEntities(r.sk.id, ents, 'Trim', { dropFor: [r.ent.id] });
  }

  onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.done();
      return true;
    }
    return false;
  }
}

export class OffsetTool extends Tool {
  get pickKinds() {
    return ['curve'];
  }

  activate() {
    this.distance = this.app.settings.offsetDistance || 2;
    this.items = this.app.selection.ofKind('curve');
    this.render();
    this.update();
  }

  deactivate() {
    this.app.vp.overlay.clear('tool');
  }

  render() {
    this.app.panel.show({
      title: 'Offset',
      icon: 'offset',
      hint: 'Select sketch curves. A closed loop of lines is offset as one shape. Use a negative distance to go inwards.',
      fields: [
        { type: 'slot', key: 'curves', label: 'Curves', count: this.items.length, active: true, placeholder: 'Click curves', onClear: () => ((this.items = []), this.render(), this.update()) },
        { type: 'length', key: 'distance', label: 'Distance', value: this.distance },
      ],
      onChange: (k, v) => {
        this.distance = v;
        this.app.settings.offsetDistance = v;
        this.update();
      },
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okEnabled: this.items.length > 0,
    });
  }

  highlights() {
    return this.items.map((item) => ({ item, color: this.app.vp.theme.select }));
  }

  onPointerMove(e) {
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit);
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return;
    const key = `${hit.sketchId}/${hit.entityId}`;
    const i = this.items.findIndex((it) => `${it.sketchId}/${it.entityId}` === key);
    if (i >= 0) this.items.splice(i, 1);
    else this.items.push({ kind: 'curve', sketchId: hit.sketchId, entityId: hit.entityId });
    this.render();
    this.update();
    this.app.refreshHighlights();
  }

  results() {
    const bySketch = new Map();
    for (const it of this.items) {
      const sk = this.app.doc.sketch(it.sketchId);
      const en = sk?.entities.find((x) => x.id === it.entityId);
      if (!en) continue;
      if (!bySketch.has(sk.id)) bySketch.set(sk.id, { sk, ents: [] });
      bySketch.get(sk.id).ents.push(en);
    }
    const out = [];
    for (const { sk, ents } of bySketch.values()) {
      const loop = lineLoop(ents);
      let created = [];
      if (loop) {
        const v = offsetPolygon(loop, this.distance);
        created = v.map((a, i) => ({ type: 'line', a, b: v[(i + 1) % v.length] }));
      } else created = ents.map((en) => offsetEntity(en, this.distance)).filter(Boolean);
      out.push({ sk, created: created.map(({ id, ...rest }) => rest) });
    }
    return out;
  }

  update() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-offset');
    const lines = [];
    for (const { sk, created } of this.results()) {
      const f = planeFrame(sk.plane);
      for (const en of created) lines.push(sampleEntity(en, 64).map((p) => to3D(f, p)));
    }
    if (lines.length) ov.lines('tool-offset', lines, { color: this.app.vp.theme.preview, width: 2, dashed: true });
  }

  apply() {
    const res = this.results();
    if (!res.length) return toast('Select curves to offset', { type: 'error' });
    for (const { sk, created } of res) this.app.cmd.setSketchEntities(sk.id, [...sk.entities, ...created], 'Offset');
    this.done();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.done();
      return true;
    }
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    return false;
  }
}

// Pattern for sketch curves: copies in a row (one or two directions) or
// around a point. The copies are ordinary curves in the same sketch.
export class SketchPatternTool extends Tool {
  get pickKinds() {
    return ['curve', 'spoint'];
  }

  activate() {
    const s = this.app.settings.sketchPattern || {};
    this.values = { kind: 'linear', count: 3, mode: 'spacing', distance: 20, angle: 0, count2: 1, distance2: 20, total: 360, rotate: true, ...s };
    this.center = null;
    this.items = this.app.selection.ofKind('curve');
    this.render();
    this.update();
    this.setHint('Click curves to repeat · for a circular pattern, click a point to turn around');
  }

  deactivate() {
    this.app.vp.overlay.clear('tool');
  }

  render() {
    const v = this.values;
    const fields = [
      { type: 'slot', key: 'curves', label: 'Curves', count: this.items.length, active: true, placeholder: 'Click curves', onClear: () => ((this.items = []), this.render(), this.update()) },
      {
        type: 'choice',
        key: 'kind',
        label: 'Type',
        value: v.kind,
        options: [
          { value: 'linear', label: 'Linear', icon: 'patternLinear' },
          { value: 'circular', label: 'Circular', icon: 'patternCircular' },
        ],
      },
      { type: 'count', key: 'count', label: 'Count', value: v.count, min: 2, max: 200 },
    ];
    if (v.kind === 'linear') {
      fields.push(
        {
          type: 'choice',
          key: 'mode',
          label: 'Distance is',
          value: v.mode,
          options: [
            { value: 'spacing', label: 'Between copies' },
            { value: 'total', label: 'Total' },
          ],
        },
        { type: 'length', key: 'distance', label: 'Distance', value: v.distance },
        { type: 'angle', key: 'angle', label: 'Direction', value: v.angle },
        { type: 'count', key: 'count2', label: 'Rows (second direction)', value: v.count2, min: 1, max: 200 },
      );
      if (v.count2 > 1) fields.push({ type: 'length', key: 'distance2', label: 'Row distance', value: v.distance2 });
    } else {
      fields.push(
        {
          type: 'choice',
          key: 'mode',
          label: 'Angle is',
          value: v.mode,
          options: [
            { value: 'total', label: 'Total' },
            { value: 'spacing', label: 'Between copies' },
          ],
        },
        { type: 'angle', key: 'total', label: 'Angle', value: v.total },
        { type: 'toggle', key: 'rotate', label: 'Turn the copies (off: they keep their direction)', value: v.rotate },
        { type: 'info', text: this.center ? t('Turning around the point you clicked') : t('Turning around the sketch origin — click a point to change it') },
      );
    }
    this.app.panel.show({
      title: 'Sketch pattern',
      icon: v.kind === 'circular' ? 'patternCircular' : 'patternLinear',
      fields,
      onChange: (k, val) => {
        this.values[k] = val;
        this.app.settings.sketchPattern = { ...this.values };
        if (k === 'kind' || k === 'count2') this.render();
        this.update();
      },
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okEnabled: this.items.length > 0,
    });
  }

  highlights() {
    return this.items.map((item) => ({ item, color: this.app.vp.theme.select }));
  }

  onPointerMove(e) {
    this.app.selection.setHover(e.pick(this.pickKinds));
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return;
    if (hit.kind === 'spoint') {
      this.center = { sketchId: hit.sketchId, p: hit.point };
      if (this.values.kind !== 'circular') this.values.kind = 'circular';
    } else {
      const key = `${hit.sketchId}/${hit.entityId}`;
      const i = this.items.findIndex((it) => `${it.sketchId}/${it.entityId}` === key);
      if (i >= 0) this.items.splice(i, 1);
      else this.items.push({ kind: 'curve', sketchId: hit.sketchId, entityId: hit.entityId });
    }
    this.render();
    this.update();
    this.app.refreshHighlights();
  }

  // The copies, per sketch: [{ sk, created }].
  results() {
    const v = this.values;
    const bySketch = new Map();
    for (const it of this.items) {
      const sk = this.app.doc.sketch(it.sketchId);
      const en = sk?.entities.find((x) => x.id === it.entityId);
      if (!en) continue;
      if (!bySketch.has(sk.id)) bySketch.set(sk.id, { sk, ents: [] });
      bySketch.get(sk.id).ents.push(en);
    }
    const n = Math.max(2, Math.round(v.count || 2));
    const out = [];
    for (const { sk, ents } of bySketch.values()) {
      const created = [];
      const strip = ({ id, ...rest }) => rest;
      if (v.kind === 'linear') {
        const a = ((v.angle || 0) * Math.PI) / 180;
        const step = v.mode === 'total' ? (v.distance || 0) / (n - 1) : v.distance || 0;
        const d1 = [Math.cos(a) * step, Math.sin(a) * step];
        const rows = Math.max(1, Math.round(v.count2 || 1));
        const d2 = [-Math.sin(a) * (v.distance2 || 0), Math.cos(a) * (v.distance2 || 0)];
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < n; i++) {
            if (!i && !j) continue;
            const d = [d1[0] * i + d2[0] * j, d1[1] * i + d2[1] * j];
            for (const en of ents) created.push(strip(translateEntity(en, d)));
          }
        }
      } else {
        const c = this.center && this.center.sketchId === sk.id ? this.center.p : [0, 0];
        const total = ((v.total || 360) * Math.PI) / 180;
        const full = Math.abs(Math.abs(v.total || 360) - 360) < 1e-9;
        const step = v.mode === 'spacing' ? total : full ? total / n : total / (n - 1);
        for (let i = 1; i < n; i++) {
          for (const en of ents) {
            if (v.rotate !== false) created.push(strip(rotateEntity(en, c, step * i)));
            else {
              // Keep the direction: move the curve with its middle point.
              const pts = sampleEntity(en, 8);
              const mid = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
              const moved = rotateEntity({ type: 'point', p: mid }, c, step * i).p;
              created.push(strip(translateEntity(en, [moved[0] - mid[0], moved[1] - mid[1]])));
            }
          }
        }
      }
      out.push({ sk, created });
    }
    return out;
  }

  update() {
    const ov = this.app.vp.overlay;
    ov.remove('tool-pattern');
    const lines = [];
    for (const { sk, created } of this.results()) {
      const f = planeFrame(sk.plane);
      for (const en of created) lines.push(sampleEntity(en, 48).map((p) => to3D(f, p)));
    }
    if (lines.length) ov.lines('tool-pattern', lines, { color: this.app.vp.theme.preview, width: 2, dashed: true });
  }

  apply() {
    const res = this.results();
    if (!res.length) return toast('Select curves to repeat', { type: 'error' });
    for (const { sk, created } of res) this.app.cmd.setSketchEntities(sk.id, [...sk.entities, ...created], 'Sketch pattern');
    this.done();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.done();
      return true;
    }
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    return false;
  }
}

// Toggle construction on the selected curves (an instant action).
export function toggleConstruction(app) {
  const curves = app.selection.ofKind('curve');
  if (!curves.length) {
    toast('Select sketch curves first, then choose Construction');
    return;
  }
  const bySketch = new Map();
  for (const c of curves) {
    if (!bySketch.has(c.sketchId)) bySketch.set(c.sketchId, new Set());
    bySketch.get(c.sketchId).add(c.entityId);
  }
  app.doc.apply('Construction', (d) => {
    for (const [sid, ids] of bySketch) {
      d.updateSketch(sid, (sk) => {
        const anyNormal = sk.entities.some((en) => ids.has(en.id) && !en.construction);
        return { entities: sk.entities.map((en) => (ids.has(en.id) ? { ...en, construction: anyNormal || undefined } : en)) };
      });
    }
  });
}

// Project body edges onto a sketch plane as sketch curves.
export class ProjectTool extends OpTool {
  inputs() {
    return [
      { key: 'edges', label: 'Edges', kinds: ['edge'], multiple: true, placeholder: 'Click body edges', summary: (items) => tn(items.length, '1 edge', '{n} edges') },
      {
        key: 'onto',
        label: 'Onto',
        kinds: ['face', 'region', 'curve'],
        multiple: false,
        optional: true,
        fromSelection: false,
        placeholder: 'A flat face or sketch (default: ground)',
        accept: (it) => (it.kind !== 'face' || this.app.faceInfo(it.bodyId, it.index)?.type === 'plane' ? it : null),
      },
    ];
  }

  params() {
    return [];
  }

  hint() {
    return 'Copies body edges into a sketch so you can build on them.';
  }

  get okLabel() {
    return 'Project';
  }

  plane() {
    const app = this.app;
    const o = this.items('onto')[0];
    if (o?.kind === 'face') {
      const info = app.faceInfo(o.bodyId, o.index);
      return makePlane(info.center, info.normal, info.xDir);
    }
    if (o?.sketchId) return app.doc.sketch(o.sketchId)?.plane || GROUND;
    return GROUND;
  }

  // Projected sketch entities for the selected edges.
  entities() {
    const app = this.app;
    const plane = this.plane();
    const f = planeFrame(plane);
    const out = [];
    for (const it of this.items('edges')) {
      const info = app.edgeInfo(it.bodyId, it.index);
      const view = app.vp.bodyViews.get(it.bodyId);
      if (!info || !view) continue;
      const poly = [];
      const segs = view.data.edgeSegments;
      for (const [start, count] of view.edgeSegRanges[it.index] || []) {
        for (let s = start; s < start + count; s++) {
          if (!poly.length) poly.push([segs[s * 6], segs[s * 6 + 1], segs[s * 6 + 2]]);
          poly.push([segs[s * 6 + 3], segs[s * 6 + 4], segs[s * 6 + 5]]);
        }
      }
      const p2 = poly.map((P) => to2D(f, P));
      if (info.type === 'line') {
        const a = to2D(f, info.a);
        const b = to2D(f, info.b);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) out.push({ type: 'line', a, b });
        continue;
      }
      const parallel = info.type === 'circle' && Math.abs(info.axisDir[0] * f.n[0] + info.axisDir[1] * f.n[1] + info.axisDir[2] * f.n[2]) > 0.9999;
      if (parallel) {
        const c = to2D(f, info.center);
        if (info.closed) {
          out.push({ type: 'circle', c, r: info.radius });
          continue;
        }
        const ang = (q) => Math.atan2(q[1] - c[1], q[0] - c[0]);
        const a0 = ang(to2D(f, info.a));
        const a1 = ang(to2D(f, info.b));
        const mid = p2[Math.floor(p2.length / 2)] || to2D(f, info.a);
        const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const inside = norm(ang(mid) - a0) <= norm(a1 - a0);
        out.push(inside ? { type: 'arc', c, r: info.radius, a0: norm(a0), a1: norm(a1) } : { type: 'arc', c, r: info.radius, a0: norm(a1), a1: norm(a0) });
        continue;
      }
      if (p2.length >= 2) {
        const step = Math.max(1, Math.ceil(p2.length / 24));
        const pts = p2.filter((_, i) => i % step === 0);
        const last = p2[p2.length - 1];
        const closed = Math.hypot(last[0] - p2[0][0], last[1] - p2[0][1]) < 1e-6;
        if (!closed && pts[pts.length - 1] !== last) pts.push(last);
        out.push(closed ? { type: 'spline', pts: [...pts, pts[0]], closed: true } : { type: 'spline', pts });
      }
    }
    return out;
  }

  schedule() {
    this.app.panel.refreshOk();
    const ov = this.app.vp.overlay;
    ov.remove('tool-proj');
    const f = planeFrame(this.plane());
    const lines = this.entities().map((en) => sampleEntity(en, 48).map((p) => to3D(f, p)));
    if (lines.length) ov.lines('tool-proj', lines, { color: this.app.vp.theme.preview, width: 2.2, depthTest: false });
  }

  ready() {
    return this.items('edges').length > 0;
  }

  async apply() {
    const ents = this.entities();
    if (!ents.length) return toast('Nothing to project', { type: 'error' });
    const plane = this.plane();
    const onto = this.items('onto')[0];
    this.app.cmd.addSketchEntities(plane, onto?.sketchId || null, ents, 'Project');
    this.done();
  }
}
