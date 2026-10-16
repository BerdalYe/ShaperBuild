// Default tool: hover, click to select, double-click for whole bodies,
// drag sketch points and curves, box selection, and the direct extrude
// arrow on selected profiles.
import { Tool } from './base.js';
import { moveSketchPoint, translateEntity, sub, add } from '../core/geom2d.js';
import { solveSketch, refsAt, entityPoints } from '../core/solver.js';
import { planeFrame, to2D, rayPlane } from '../core/plane.js';
import { sampleEntity } from '../core/geom2d.js';

export const SELECT_KINDS = ['handle', 'spoint', 'curve', 'edge', 'region', 'face', 'body', 'plane', 'image'];

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

  // With "Bodies only", a face stands for its whole body.
  filtered(hit) {
    if (hit?.kind === 'face' && this.app.settings.selectFilter === 'bodies') return { kind: 'body', bodyId: hit.bodyId, point: hit.point };
    return hit;
  }

  onPointerMove(e) {
    if (this.down) return this.dragMove(e);
    const hit = this.filtered(e.pick(this.pickKinds));
    this.app.selection.setHover(hit && hit.kind !== 'handle' ? hit : null);
    this.app.vp.canvas.style.cursor = hit?.kind === 'handle' ? 'grab' : hit?.kind === 'spoint' ? 'move' : '';
  }

  onPointerDown(e) {
    const hit = this.filtered(e.pick(this.pickKinds));
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
    // While dragging a box: B, F, E or A changes what it selects.
    if (this.drag?.kind === 'box' && !e.ctrl && !e.alt) {
      const f = { b: 'bodies', f: 'faces', e: 'edges', a: 'all' }[e.key.toLowerCase()];
      if (f) {
        this.app.setSelectFilter(f);
        return true;
      }
    }
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
    // Alt-drag a point where curves meet: pull just one curve's end away.
    const single = g.kind === 'point' && e.alt ? refsAt(sk.entities, g.from)[0] : null;
    if (single && !sk.constraints?.length) {
      const res = solveSketch(sk.entities, [], { drags: [{ ref: single, to: p }], loose: [single] });
      g.entities = res.entities;
    } else if (sk.constraints?.length) {
      // Let the constraint solver decide how the rest of the sketch follows.
      let drags;
      if (g.kind === 'point') drags = refsAt(sk.entities, g.from).slice(0, 1).map((ref) => ({ ref, to: p }));
      else {
        const d = sub(p, g.start);
        drags = sk.entities.filter((en) => g.ids.has(en.id)).flatMap((en) => entityPoints(en).map((pt) => ({ ref: { e: en.id, p: pt.p }, to: add(pt.at, d) })));
      }
      const res = solveSketch(sk.entities, sk.constraints, { drags, loose: single ? [single] : [] });
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
      this.app.vp.container.append(this.boxEl);
    }
    Object.assign(this.boxEl.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
    // Right to left selects everything the box touches (dashed outline).
    this.boxEl.className = `select-box${x1 < x0 ? ' crossing' : ''}`;
  }

  removeBox() {
    this.boxEl?.remove();
    this.boxEl = null;
  }

  // Left to right: items fully inside the box. Right to left: everything
  // the box touches. The selection filter decides what kinds count.
  finishBox(x0, y0, x1, y1, add) {
    this.removeBox();
    const app = this.app;
    const vp = app.vp;
    const filter = app.settings.selectFilter;
    const crossing = x1 < x0;
    const r = { l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1) };
    const inside = (p) => {
      const s = vp.worldToScreen(p);
      return s && s[0] >= r.l && s[0] <= r.r && s[1] >= r.t && s[1] <= r.b;
    };
    const test = (pts) => (crossing ? pts.some(inside) : pts.length > 0 && pts.every(inside));
    const items = [];
    // Points of a body's shaded mesh (or of one face), at most ~4000.
    const meshPoints = (view, ranges) => {
      const pos = view.geometry.attributes.position;
      const spans = ranges || [[0, pos.count]];
      const total = spans.reduce((n, [, c]) => n + c, 0);
      const stride = Math.max(1, Math.floor(total / 4000));
      const out = [];
      for (const [lo, n] of spans) for (let i = lo; i < lo + n; i += stride) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
      return out;
    };
    // The box lies on a body without touching its outline.
    const centre = crossing ? vp.hitsUnder((r.l + r.r) / 2, (r.t + r.b) / 2) : [];
    for (const [id, view] of vp.bodyViews) {
      if (!view.group.visible) continue;
      if (filter === 'faces' && view.faceVerts.length) {
        view.faceVerts.forEach((ranges, index) => {
          if (ranges && (test(meshPoints(view, ranges)) || centre.some((c) => c.bodyId === id && c.index === index))) items.push({ kind: 'face', bodyId: id, index });
        });
        continue;
      }
      if (filter === 'edges') continue;
      if (test(meshPoints(view)) || centre.some((c) => c.bodyId === id)) items.push({ kind: 'body', bodyId: id });
    }
    if (filter !== 'faces' && filter !== 'bodies') {
      for (const [sid, view] of vp.sketchViews) {
        if (!view.group.visible) continue;
        for (const en of view.sketch.entities) {
          const pts = sampleEntity(en, 24).map((p) => [view.frame.o[0] + view.frame.x[0] * p[0] + view.frame.y[0] * p[1], view.frame.o[1] + view.frame.x[1] * p[0] + view.frame.y[1] * p[1], view.frame.o[2] + view.frame.x[2] * p[0] + view.frame.y[2] * p[1]]);
          if (test(pts)) items.push({ kind: 'curve', sketchId: sid, entityId: en.id });
        }
      }
    }
    if (add) items.forEach((it) => app.selection.has(it) || app.selection.add(it));
    else app.selection.set(items);
  }
}

