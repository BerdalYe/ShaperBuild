// Sketch editing: trim, offset and construction toggling.
import { Tool } from './base.js';
import { OpTool } from './optool.js';
import { trimEntity, sampleEntity, offsetEntity, lineLoop, offsetPolygon } from '../core/geom2d.js';
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
