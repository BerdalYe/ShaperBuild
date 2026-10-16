// Sketch editing: trim, offset and construction toggling.
import { Tool } from './base.js';
import { trimEntity, sampleEntity, offsetEntity, lineLoop, offsetPolygon } from '../core/geom2d.js';
import { planeFrame, to2D, to3D, rayPlane } from '../core/plane.js';
import { toast } from '../ui/overlays.js';

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
