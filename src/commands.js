// Document-changing commands shared by tools, panels and menus.
import * as THREE from 'three';
import { toast, confirmDialog } from './ui/overlays.js';
import { samePlane, GROUND } from './core/plane.js';

export class Commands {
  constructor(app) {
    this.app = app;
  }

  get doc() {
    return this.app.doc;
  }

  undo() {
    if (!this.app.tools.isSelect) this.app.tools.cancel();
    if (!this.doc.undo()) toast('Nothing to undo', { ms: 1000 });
  }

  redo() {
    if (!this.app.tools.isSelect) this.app.tools.cancel();
    if (!this.doc.redo()) toast('Nothing to redo', { ms: 1000 });
  }

  setUnits(units) {
    this.doc.apply('Units', (d) => {
      d.units = units;
    });
    this.app.panel.visible && this.app.tools.active?.render?.();
  }

  // ---- sketches ----------------------------------------------------------

  // Add entities to the sketch on `plane` (creating it if needed).
  // Returns the sketch id.
  addSketchEntities(plane, sketchId, entities, label = 'Sketch') {
    const app = this.app;
    return this.doc.apply(label, (d) => {
      let sk = sketchId ? d.sketch(sketchId) : null;
      if (!sk) {
        const existing = d.sketches.find((s) => s.visible !== false && samePlane(s.plane, plane));
        if (existing) sk = existing;
      }
      if (!sk) {
        // Remember which body the sketch was drawn on (for auto join/cut).
        let sourceBody = null;
        for (const b of d.bodies) {
          const m = app.meshCache.get(b.shapeId);
          if (m?.faceInfo?.some((f) => f.type === 'plane' && samePlane(plane, { origin: f.center, normal: f.normal }))) {
            sourceBody = b.id;
            break;
          }
          if (m?.kind === 'mesh' && !samePlane(plane, GROUND)) {
            const bb = m.bbox;
            const o = plane.origin;
            const inside = o.every((v, i) => v >= bb.min[i] - 1e-3 && v <= bb.max[i] + 1e-3);
            if (inside) sourceBody = b.id;
          }
        }
        sk = d.addSketch({ plane, sourceBody });
      }
      const ents = d.withIds(entities);
      d.updateSketch(sk.id, (s) => ({ entities: [...s.entities, ...ents] }));
      return sk.id;
    });
  }

  setSketchEntities(sketchId, entities, label = 'Edit sketch') {
    this.doc.apply(label, (d) => {
      const ents = d.withIds(entities);
      if (!ents.length) d.removeSketch(sketchId);
      else d.updateSketch(sketchId, { entities: ents });
    });
  }

  // ---- kernel results ------------------------------------------------------

  // Apply a kernel result ({ bodies: [{ id, replaces?, from?, mesh }], removed })
  // as one undoable step. opts.sketches: [{ id, matrix, copy }] to transform.
  applyResult(label, result, opts = {}) {
    const app = this.app;
    for (const b of result.bodies) if (b.mesh) app.meshCache.set(b.id, b.mesh);
    const created = [];
    this.doc.apply(label, (d) => {
      const byShape = new Map(d.bodies.map((b) => [b.shapeId, b]));
      for (const r of result.bodies) {
        const kind = r.mesh?.kind || 'solid';
        if (r.replaces && byShape.has(r.replaces)) {
          d.updateBody(byShape.get(r.replaces).id, { shapeId: r.id, kind });
        } else {
          const src = r.from ? byShape.get(r.from) : null;
          const nb = d.addBody({ shapeId: r.id, kind, color: src?.color ?? null, ...(opts.newBody || {}) });
          created.push(nb.id);
        }
      }
      for (const sid of result.removed) {
        const b = byShape.get(sid);
        if (b && !result.bodies.some((r) => r.replaces === sid)) d.removeBody(b.id);
      }
      for (const st of opts.sketches || []) {
        const sk = d.sketch(st.id);
        if (!sk) continue;
        const plane = transformPlane(sk.plane, st.matrix);
        if (st.copy) d.addSketch({ plane, entities: sk.entities, name: `${sk.name} copy` });
        else d.updateSketch(st.id, { plane });
      }
    });
    app.selection.clear();
    return created;
  }

  // ---- items ---------------------------------------------------------------

  rename(kind, id, name) {
    this.doc.apply('Rename', (d) => (kind === 'body' ? d.updateBody(id, { name }) : d.updateSketch(id, { name })));
  }

  setVisible(kind, id, visible) {
    this.doc.apply(visible ? 'Show' : 'Hide', (d) => (kind === 'body' ? d.updateBody(id, { visible }) : d.updateSketch(id, { visible })));
    if (!visible) this.app.selection.prune((it) => (kind === 'body' ? it.bodyId !== id : it.sketchId !== id));
  }

  isolate(bodyId) {
    this.doc.apply('Show only', (d) => {
      for (const b of d.bodies) d.updateBody(b.id, { visible: b.id === bodyId });
      for (const s of d.sketches) d.updateSketch(s.id, { visible: false });
    });
  }

  showAll() {
    this.doc.apply('Show all', (d) => {
      for (const b of d.bodies) if (b.visible === false) d.updateBody(b.id, { visible: true });
      for (const s of d.sketches) if (s.visible === false) d.updateSketch(s.id, { visible: true });
    });
  }

  setColor(ids, color) {
    this.doc.apply('Colour', (d) => ids.forEach((id) => d.updateBody(id, { color })));
  }

  selectedBodyIds() {
    return [...new Set(this.app.selection.list.map((it) => it.bodyId).filter(Boolean))];
  }

  async duplicate(ids = this.selectedBodyIds()) {
    const app = this.app;
    const sketches = app.selection.list.filter((it) => it.kind === 'sketch').map((it) => it.sketchId);
    if (!ids.length && !sketches.length) return toast('Select bodies to duplicate');
    let result = { bodies: [], removed: [] };
    if (ids.length) {
      result = await app.kernel.call('transform', { ids: ids.map((id) => this.doc.body(id).shapeId), matrix: new THREE.Matrix4().elements, copy: true });
    }
    // Name copies after their originals.
    const names = new Map(ids.map((id) => [this.doc.body(id).shapeId, this.doc.body(id).name]));
    this.applyResult('Duplicate', result, { sketches: sketches.map((id) => ({ id, matrix: new THREE.Matrix4().elements, copy: true })) });
    this.doc.replaceSilently((d) => {
      for (const r of result.bodies) {
        const b = d.bodies.find((x) => x.shapeId === r.id);
        if (b && names.has(r.from)) d.updateBody(b.id, { name: `${names.get(r.from)} copy` });
      }
    });
    toast(`Duplicated ${ids.length + sketches.length} item${ids.length + sketches.length === 1 ? '' : 's'} — use Move to place the copy`, { ms: 2200 });
  }

  deleteSelection() {
    const list = this.app.selection.list;
    if (!list.length) return;
    this.deleteItems(list);
  }

  // Delete bodies, sketches or sketch curves. Faces/edges delete their body.
  deleteItems(items) {
    const bodies = new Set();
    const sketches = new Set();
    const curves = new Map();
    for (const it of items) {
      if (it.bodyId) bodies.add(it.bodyId);
      else if (it.kind === 'sketch') sketches.add(it.sketchId);
      else if (it.kind === 'curve') {
        if (!curves.has(it.sketchId)) curves.set(it.sketchId, new Set());
        curves.get(it.sketchId).add(it.entityId);
      } else if (it.kind === 'region') sketches.add(it.sketchId);
    }
    if (!bodies.size && !sketches.size && !curves.size) return;
    this.doc.apply('Delete', (d) => {
      for (const id of bodies) d.removeBody(id);
      for (const id of sketches) d.removeSketch(id);
      for (const [sid, ids] of curves) {
        if (sketches.has(sid)) continue;
        const sk = d.sketch(sid);
        if (!sk) continue;
        const rest = sk.entities.filter((e) => !ids.has(e.id));
        if (rest.length) d.updateSketch(sid, { entities: rest });
        else d.removeSketch(sid);
      }
    });
    this.app.selection.clear();
  }

  selectAll() {
    const sel = this.doc.bodies.filter((b) => b.visible !== false).map((b) => ({ kind: 'body', bodyId: b.id }));
    this.app.selection.set(sel);
  }

  async convertToSolid(ids) {
    const app = this.app;
    ids = ids || this.selectedBodyIds().filter((id) => this.doc.body(id)?.kind === 'mesh');
    if (!ids.length) {
      const meshes = this.doc.bodies.filter((b) => b.kind === 'mesh');
      if (meshes.length === 1) ids = [meshes[0].id];
      else return toast(meshes.length ? 'Select the mesh bodies to convert' : 'There are no mesh bodies. Import an STL, OBJ or 3MF file first.');
    }
    for (const id of ids) {
      const b = this.doc.body(id);
      const m = app.meshCache.get(b.shapeId);
      const tris = m?.triangles || 0;
      if (tris > 20000) {
        const ok = await confirmDialog('Convert large mesh?', `"${b.name}" has ${tris.toLocaleString()} triangles. Converting can take a while and the solid will have many faces. Continue?`, { ok: 'Convert' });
        if (!ok) continue;
      }
      try {
        app.busy(true, `Converting ${b.name}…`);
        const res = await app.kernel.call('meshToSolid', { id: b.shapeId });
        this.applyResult('Convert to solid', res);
        toast(`${b.name} is now a solid body`, { type: 'ok' });
      } catch (err) {
        toast(err.message, { type: 'error', ms: 6000 });
      } finally {
        app.busy(false);
      }
    }
  }

  exportBodies(ids, format) {
    this.app.files.exportDialog(format, ids);
  }
}

// Apply a column-major 4x4 to a sketch plane.
export function transformPlane(plane, m) {
  const M = new THREE.Matrix4().fromArray(m);
  const o = new THREE.Vector3(...plane.origin).applyMatrix4(M);
  const N = new THREE.Matrix3().getNormalMatrix(M);
  const n = new THREE.Vector3(...plane.normal).applyMatrix3(N).normalize();
  const x = new THREE.Vector3(...plane.xDir).transformDirection(M);
  return { origin: o.toArray(), normal: n.toArray(), xDir: x.toArray() };
}
