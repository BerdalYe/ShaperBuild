// Default tool: hover, click to select, double-click for whole bodies,
// drag sketch points and curves, box selection, and the direct extrude
// arrow on selected profiles.
import { Tool } from './base.js';
import { moveSketchPoint, translateEntity, sub, add } from '../core/geom2d.js';
import { solveSketch, refsAt, entityPoints } from '../core/solver.js';
import { planeFrame, to2D, rayPlane } from '../core/plane.js';
import { sampleEntity } from '../core/geom2d.js';

export const SELECT_KINDS = ['handle', 'spoint', 'curve', 'edge', 'region', 'face', 'body'];

export class SelectTool extends Tool {
  get pickKinds() {
    const f = this.app.settings.selectFilter;
    if (f === 'bodies') return ['handle', 'face', 'body', 'region', 'curve', 'spoint'];
    if (f === 'faces') return ['handle', 'face', 'region', 'body'];
    if (f === 'edges') return ['handle', 'edge', 'curve', 'spoint'];
    return SELECT_KINDS;
  }

  activate() {
    this.down = null;
    this.drag = null;
    this.setHint('Click to select · <kbd>Double-click</kbd> a face to select its body · Drag empty space to box-select · Right-drag to orbit');
    this.onSelectionChange();
  }

  deactivate() {
    this.app.vp.overlay.clear('sel-');
    this.removeBox();
  }

  onPointerMove(e) {
    if (this.down) return this.dragMove(e);
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit && hit.kind !== 'handle' ? hit : null);
    this.app.vp.canvas.style.cursor = hit?.kind === 'handle' ? 'grab' : hit?.kind === 'spoint' ? 'move' : '';
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    this.down = { x: e.x, y: e.y, hit, e };
    this.drag = null;
  }

  dragMove(e) {
    const d = this.down;
    if (!this.drag) {
      if (Math.hypot(e.x - d.x, e.y - d.y) < 4) return;
      const hit = d.hit;
      if (hit?.kind === 'handle' && hit.key === 'sel-extrude') {
        // Hand over to the extrude tool, already dragging.
        this.down = null;
        this.app.tools.activate('extrude', { dragFrom: d.e, force: true });
        this.app.tools.active.onPointerMove?.(e);
        return;
      }
      if (hit?.kind === 'spoint') this.drag = this.startPointDrag(hit);
      else if (hit?.kind === 'curve') this.drag = this.startCurveDrag(hit, d.e);
      else if (!hit) this.drag = { kind: 'box' };
      else this.drag = { kind: 'none' };
    }
    const g = this.drag;
    if (g.kind === 'box') this.updateBox(d.x, d.y, e.x, e.y);
    else if (g.kind === 'point' || g.kind === 'curve') this.updateSketchDrag(g, e);
  }

  onPointerUp(e) {
    const d = this.down;
    this.down = null;
    if (!d) return;
    const g = this.drag;
    this.drag = null;
    if (g) {
      if (g.kind === 'box') this.finishBox(d.x, d.y, e.x, e.y, e.shift || e.ctrl);
      else if ((g.kind === 'point' || g.kind === 'curve') && g.entities) this.app.cmd.setSketchEntities(g.sketch.id, g.entities, g.kind === 'point' ? 'Move point' : 'Move curve');
      return;
    }
    this.click(d.hit, e);
  }

  click(hit, e) {
    const sel = this.app.selection;
    if (!hit || hit.kind === 'handle') {
      if (!hit && !e.shift && !e.ctrl) sel.clear();
      return;
    }
    const item = this.app.selectionItem(hit);
    const additive = this.app.settings.additiveSelect || e.shift || e.ctrl;
    if (additive) sel.toggle(item);
    else if (sel.size === 1 && sel.has(item)) sel.clear();
    else sel.set([item]);
  }

  onDblClick(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return;
    const sel = this.app.selection;
    if (hit.kind === 'face' || hit.kind === 'edge' || hit.kind === 'body' || hit.kind === 'vertex') {
      const keep = sel.list.filter((it) => it.bodyId !== hit.bodyId);
      sel.set([...keep, { kind: 'body', bodyId: hit.bodyId }]);
    } else if (hit.kind === 'curve' || hit.kind === 'region' || hit.kind === 'spoint') {
      const sk = this.app.doc.sketch(hit.sketchId);
      if (!sk) return;
      const keep = sel.list.filter((it) => it.sketchId !== hit.sketchId);
      sel.set([...keep, ...sk.entities.map((en) => ({ kind: 'curve', sketchId: sk.id, entityId: en.id }))]);
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.down) {
        this.down = null;
        this.drag = null;
        this.removeBox();
        this.app.syncView();
        return true;
      }
      this.app.selection.clear();
      return true;
    }
    return false;
  }

  // ---- direct extrude arrow ----------------------------------------------

  onSelectionChange() {
    const app = this.app;
    const ov = app.vp.overlay;
    ov.remove('sel-extrude');
    const anchor = app.profileAnchor(app.selection.list);
    if (anchor) ov.arrow('sel-extrude', anchor.origin, anchor.normal, { color: app.vp.theme.select, length: 64 });
  }

  // ---- sketch dragging ---------------------------------------------------

  sketchPointer(sketch, e) {
    const p = rayPlane(e.ray.origin, e.ray.dir, sketch.plane);
    const back = p ? null : rayPlane(e.ray.origin, e.ray.dir.map((v) => -v), sketch.plane);
    const P = p || back;
    return P ? to2D(planeFrame(sketch.plane), P) : null;
  }

  startPointDrag(hit) {
    const sketch = this.app.doc.sketch(hit.sketchId);
    if (!sketch) return { kind: 'none' };
    return { kind: 'point', sketch, from: hit.point };
  }

  startCurveDrag(hit, e) {
    const sketch = this.app.doc.sketch(hit.sketchId);
    if (!sketch) return { kind: 'none' };
    const start = this.sketchPointer(sketch, e);
    const sel = this.app.selection;
    // Move every selected curve of this sketch if the grabbed one is selected.
    const grabbed = { kind: 'curve', sketchId: sketch.id, entityId: hit.entityId };
    const ids = sel.has(grabbed) ? sel.list.filter((it) => it.kind === 'curve' && it.sketchId === sketch.id).map((it) => it.entityId) : [hit.entityId];
    return { kind: 'curve', sketch, start, ids: new Set(ids) };
  }

  updateSketchDrag(g, e) {
    const app = this.app;
    let p = this.sketchPointer(g.sketch, e);
    if (!p) return;
    p = app.snapSketchPoint(g.sketch, p, e, { exclude: g.kind === 'point' ? g.from : null });
    const sk = g.sketch;
    if (g.kind === 'curve' && !g.start) return;
    if (sk.constraints?.length) {
      // Let the constraint solver decide how the rest of the sketch follows.
      let drags;
      if (g.kind === 'point') drags = refsAt(sk.entities, g.from).slice(0, 1).map((ref) => ({ ref, to: p }));
      else {
        const d = sub(p, g.start);
        drags = sk.entities.filter((en) => g.ids.has(en.id)).flatMap((en) => entityPoints(en).map((pt) => ({ ref: { e: en.id, p: pt.p }, to: add(pt.at, d) })));
      }
      const res = solveSketch(sk.entities, sk.constraints, { drags });
      if (res.ok) g.entities = res.entities;
    } else if (g.kind === 'point') g.entities = moveSketchPoint(sk.entities, g.from, p);
    else {
      const d = sub(p, g.start);
      g.entities = sk.entities.map((en) => (g.ids.has(en.id) ? translateEntity(en, d) : en));
    }
    if (g.entities) app.previewSketch(sk.id, g.entities);
  }

  // ---- box selection -----------------------------------------------------

  updateBox(x0, y0, x1, y1) {
    if (!this.boxEl) {
      this.boxEl = document.createElement('div');
      this.boxEl.style.cssText = 'position:absolute;border:1px solid var(--accent);background:rgba(61,139,255,.12);pointer-events:none;z-index:4;border-radius:2px';
      this.app.vp.container.append(this.boxEl);
    }
    Object.assign(this.boxEl.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
  }

  removeBox() {
    this.boxEl?.remove();
    this.boxEl = null;
  }

  finishBox(x0, y0, x1, y1, add) {
    this.removeBox();
    const app = this.app;
    const vp = app.vp;
    const r = { l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) };
    const inside = (p) => {
      const s = vp.worldToScreen(p);
      return s && s[0] >= r.l && s[0] <= r.r && s[1] >= r.t && s[1] <= r.b;
    };
    const items = [];
    for (const [id, view] of vp.bodyViews) {
      if (!view.group.visible) continue;
      const bb = view.geometry.boundingBox;
      const corners = [];
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push([x, y, z]);
      if (corners.every(inside)) items.push({ kind: 'body', bodyId: id });
    }
    for (const [sid, view] of vp.sketchViews) {
      if (!view.group.visible) continue;
      for (const en of view.sketch.entities) {
        const pts = sampleEntity(en, 24).map((p) => [view.frame.o[0] + view.frame.x[0] * p[0] + view.frame.y[0] * p[1], view.frame.o[1] + view.frame.x[1] * p[0] + view.frame.y[1] * p[1], view.frame.o[2] + view.frame.x[2] * p[0] + view.frame.y[2] * p[1]]);
        if (pts.every(inside)) items.push({ kind: 'curve', sketchId: sid, entityId: en.id });
      }
    }
    if (add) items.forEach((it) => app.selection.has(it) || app.selection.add(it));
    else app.selection.set(items);
  }
}

