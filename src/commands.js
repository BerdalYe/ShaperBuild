// Document-changing commands shared by tools, panels and menus.
import * as THREE from 'three';
import { toast, confirmDialog } from './ui/overlays.js';
import { samePlane, GROUND } from './core/plane.js';
import { solveSketch, measure, pruneConstraints, dropConstraintsFor, pointOf, CONSTRAINT_INFO } from './core/solver.js';

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
  // `constraints` may refer to the new entities as '#0', '#1', …
  // Returns the sketch id.
  addSketchEntities(plane, sketchId, entities, label = 'Sketch', constraints = []) {
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
      const ref = (v) => (typeof v === 'string' && v[0] === '#' ? ents[+v.slice(1)]?.id : v);
      const refP = (p) => (p ? { ...p, e: ref(p.e) } : p);
      const cons = d.withConstraintIds(constraints.map((c) => ({ ...c, e: ref(c.e), e2: ref(c.e2), p: refP(c.p), p2: refP(c.p2) })).map(stripUndefined));
      d.updateSketch(sk.id, (s) => ({ entities: [...s.entities, ...ents], constraints: [...(s.constraints || []), ...cons] }));
      return sk.id;
    });
  }

  // Replace a sketch's entities. Constraints on removed entities (and on
  // ids in `dropFor`) are dropped.
  setSketchEntities(sketchId, entities, label = 'Edit sketch', { dropFor = [] } = {}) {
    this.doc.apply(label, (d) => {
      const ents = d.withIds(entities);
      if (!ents.length) return d.removeSketch(sketchId);
      const sk = d.sketch(sketchId);
      const cons = pruneConstraints(dropConstraintsFor(sk.constraints, dropFor), ents);
      d.updateSketch(sketchId, { entities: ents, constraints: cons });
    });
  }

  // ---- constraints ---------------------------------------------------------

  // Solve and store; returns false (and changes nothing) if impossible.
  solveAndStore(sketchId, entities, constraints, label, opts = {}) {
    const res = solveSketch(entities, constraints, opts);
    if (!res.ok) {
      toast(opts.failMessage || 'That conflicts with the existing constraints', { type: 'error' });
      return false;
    }
    this.doc.apply(label, (d) => d.updateSketch(sketchId, { entities: res.entities, constraints: d.withConstraintIds(res.constraints) }));
    return true;
  }

  addConstraint(sketchId, c) {
    const sk = this.doc.sketch(sketchId);
    if (!sk) return false;
    const info = CONSTRAINT_INFO[c.type];
    const con = stripUndefined({ ...c });
    const askValue = info?.dimension && con.value === undefined;
    if (askValue) con.value = measure(con, sk.entities);
    if (con.type === 'fix' && !con.value) con.value = pointOf(sk.entities, con.p);
    const ok = this.solveAndStore(sketchId, sk.entities, [...(sk.constraints || []), con], info?.label || 'Constraint');
    if (ok && askValue) {
      const added = this.doc.sketch(sketchId).constraints.at(-1);
      setTimeout(() => this.app.constraints.edit(sketchId, added.id), 50);
    }
    return ok;
  }

  setConstraintValue(sketchId, cid, value) {
    const sk = this.doc.sketch(sketchId);
    const c = sk?.constraints?.find((x) => x.id === cid);
    if (!c || !Number.isFinite(value)) return false;
    if (c.type !== 'angle' && !(value > 0)) {
      toast('The value must be greater than zero', { type: 'error' });
      return false;
    }
    const cons = sk.constraints.map((x) => (x.id === cid ? { ...x, value } : x));
    return this.solveAndStore(sketchId, sk.entities, cons, `Set ${CONSTRAINT_INFO[c.type].label.toLowerCase()}`, { failMessage: 'That value is not possible with the other constraints' });
  }

  removeConstraints(items) {
    const bySketch = new Map();
    for (const it of items) {
      if (!bySketch.has(it.sketchId)) bySketch.set(it.sketchId, new Set());
      bySketch.get(it.sketchId).add(it.cid);
    }
    this.doc.apply('Delete constraint', (d) => {
      for (const [sid, ids] of bySketch) d.updateSketch(sid, (sk) => ({ constraints: (sk.constraints || []).filter((c) => !ids.has(c.id)) }));
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
        if (st.copy) d.addSketch({ plane, entities: sk.entities, constraints: sk.constraints || [], name: `${sk.name} copy` });
        else d.updateSketch(st.id, { plane });
      }
    });
    app.selection.clear();
    return created;
  }

  // ---- items ---------------------------------------------------------------

  rename(kind, id, name) {
    this.doc.apply('Rename', (d) => (kind === 'body' ? d.updateBody(id, { name }) : kind === 'plane' ? d.updatePlane(id, { name }) : d.updateSketch(id, { name })));
  }

  setVisible(kind, id, visible) {
    this.doc.apply(visible ? 'Show' : 'Hide', (d) => (kind === 'body' ? d.updateBody(id, { visible }) : kind === 'plane' ? d.updatePlane(id, { visible }) : d.updateSketch(id, { visible })));
    if (!visible) this.app.selection.prune((it) => (kind === 'body' ? it.bodyId !== id : kind === 'plane' ? it.planeId !== id : it.sketchId !== id));
  }

  // Add a reference plane and select it.
  addPlane(plane, { size = 80, name } = {}) {
    let id = null;
    this.doc.apply('Plane', (d) => {
      id = d.addPlane({ plane, size, ...(name ? { name } : {}) }).id;
    });
    this.app.selection.set([{ kind: 'plane', planeId: id }]);
    return id;
  }

  // Show or hide several items in one undo step: items = [{ kind, id }].
  setVisibleMany(items, visible) {
    if (!items.length) return;
    this.doc.apply(visible ? 'Show' : 'Hide', (d) => {
      for (const { kind, id } of items) kind === 'body' ? d.updateBody(id, { visible }) : kind === 'plane' ? d.updatePlane(id, { visible }) : d.updateSketch(id, { visible });
    });
    if (!visible) {
      const gone = new Set(items.map((x) => x.id));
      this.app.selection.prune((it) => !gone.has(it.bodyId) && !gone.has(it.sketchId) && !gone.has(it.planeId));
    }
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
      for (const p of d.planes) if (p.visible === false) d.updatePlane(p.id, { visible: true });
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
    const planes = new Set();
    const curves = new Map();
    const cons = items.filter((it) => it.kind === 'constraint');
    if (cons.length) {
      this.removeConstraints(cons);
      items = items.filter((it) => it.kind !== 'constraint');
      if (!items.length) {
        this.app.selection.clear();
        return;
      }
    }
    for (const it of items) {
      if (it.bodyId) bodies.add(it.bodyId);
      else if (it.kind === 'sketch') sketches.add(it.sketchId);
      else if (it.kind === 'curve') {
        if (!curves.has(it.sketchId)) curves.set(it.sketchId, new Set());
        curves.get(it.sketchId).add(it.entityId);
      } else if (it.kind === 'region') sketches.add(it.sketchId);
      else if (it.kind === 'plane') planes.add(it.planeId);
    }
    if (!bodies.size && !sketches.size && !curves.size && !planes.size) return;
    this.doc.apply('Delete', (d) => {
      for (const id of planes) d.removePlane(id);
      for (const id of bodies) d.removeBody(id);
      for (const id of sketches) d.removeSketch(id);
      for (const [sid, ids] of curves) {
        if (sketches.has(sid)) continue;
        const sk = d.sketch(sid);
        if (!sk) continue;
        const rest = sk.entities.filter((e) => !ids.has(e.id));
        if (rest.length) d.updateSketch(sid, { entities: rest, constraints: pruneConstraints(sk.constraints, rest) });
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

function stripUndefined(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
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
