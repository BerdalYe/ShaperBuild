// Document-changing commands shared by tools, panels and menus.
import * as THREE from 'three';
import { toast, confirmDialog } from './ui/overlays.js';
import { t, tn } from './core/i18n.js';
import { samePlane, GROUND } from './core/plane.js';
import { solveSketch, measure, pruneConstraints, dropConstraintsFor, pointOf, CONSTRAINT_INFO } from './core/solver.js';
import { nameProblem } from './core/expr.js';
import { relink, renameEverywhere, usesOf, withUnit } from './core/variables.js';

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
      relink(d);
    });
    this.app.panel.visible && this.app.tools.active?.render?.();
  }

  // ---- variables ---------------------------------------------------------

  // Add a variable; returns its id, or null (with a message) if not valid.
  addVariable({ name, kind = 'length', expr = '10' } = {}) {
    const vars = this.doc.variables;
    if (!name) {
      const base = kind === 'angle' ? 'angle' : kind === 'number' ? 'number' : 'length';
      let n = 1;
      while (vars.some((v) => v.name === `${base}${n}`)) n++;
      name = `${base}${n}`;
    }
    const problem = nameProblem(name) || (vars.some((v) => v.name === name) ? 'There is already a variable with that name' : null);
    if (problem) {
      toast(problem, { type: 'error' });
      return null;
    }
    return this.doc.apply('Add variable', (d) => {
      const id = d.nextId('variable');
      d.variables.push({ id, name, kind, expr: withUnit(String(expr), kind, d.units) });
      relink(d);
      return id;
    });
  }

  // Change a variable's name, kind or value; everything that uses it follows.
  updateVariable(id, patch) {
    const cur = this.doc.variables.find((v) => v.id === id);
    if (!cur) return false;
    const name = patch.name ?? cur.name;
    if (name !== cur.name) {
      const problem = nameProblem(name) || (this.doc.variables.some((v) => v.name === name) ? 'There is already a variable with that name' : null);
      if (problem) {
        toast(problem, { type: 'error' });
        return false;
      }
    }
    let problems = [];
    this.doc.apply(name !== cur.name ? 'Rename variable' : 'Edit variable', (d) => {
      if (name !== cur.name) renameEverywhere(d, cur.name, name);
      d.variables = d.variables.map((v) => (v.id === id ? { ...v, ...patch, name, expr: withUnit(String(patch.expr ?? v.expr), patch.kind ?? v.kind, d.units) } : v));
      problems = relink(d);
    });
    if (problems.length) toast(t('Some values could not use the new value: {list}', { list: [...new Set(problems)].map((p) => t(p)).join(', ') }), { type: 'error', ms: 5000 });
    return true;
  }

  // Delete a variable unless something uses it.
  removeVariable(id) {
    const v = this.doc.variables.find((x) => x.id === id);
    if (!v) return false;
    const uses = usesOf(this.doc.state, v.name);
    if (uses.length) {
      toast(t('{name} is used by: {list}. Change those first.', { name: v.name, list: uses.map((u) => t(u)).join(', ') }), { type: 'error', ms: 6000 });
      return false;
    }
    this.doc.apply('Delete variable', (d) => {
      d.variables = d.variables.filter((x) => x.id !== id);
    });
    return true;
  }

  // ---- sketches ----------------------------------------------------------

  // Add entities to the sketch on `plane` (creating it if needed).
  // `constraints` may refer to the new entities as '#0', '#1', …
  // Returns the sketch id.
  // A new, separate sketch (e.g. an imported DXF drawing).
  addSketch(plane, entities, { name, label = 'Sketch' } = {}) {
    let id = null;
    this.doc.apply(label, (d) => {
      id = d.addSketch({ plane, entities: d.withIds(entities), ...(name ? { name } : {}) }).id;
    });
    return id;
  }

  addSketchEntities(plane, sketchId, entities, label = 'Sketch', constraints = []) {
    const app = this.app;
    return this.doc.apply(label, (d) => {
      let sk = sketchId ? d.sketch(sketchId) : null;
      if (!sk) {
        const existing = d.sketches.find((s) => s.visible !== false && samePlane(s.plane, plane));
        if (existing) sk = existing;
      }
      if (!sk) {
        // Remember which body the sketch was drawn on (for auto join/cut),
        // and its face, so the sketch moves with it when the design changes.
        let sourceBody = null;
        let attach = null;
        for (const b of d.bodies) {
          const m = app.meshCache.get(b.shapeId);
          const fi = m?.faceInfo?.findIndex((f) => f.type === 'plane' && samePlane(plane, { origin: f.center, normal: f.normal })) ?? -1;
          if (fi >= 0) {
            sourceBody = b.id;
            attach = app.history.attachFor(plane, b.id, fi);
            break;
          }
          if (m?.kind === 'mesh' && !samePlane(plane, GROUND)) {
            const bb = m.bbox;
            const o = plane.origin;
            const inside = o.every((v, i) => v >= bb.min[i] - 1e-3 && v <= bb.max[i] + 1e-3);
            if (inside) sourceBody = b.id;
          }
        }
        sk = d.addSketch({ plane, sourceBody, ...(attach ? { attach } : {}) });
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
      if (!ents.length) {
        this.app.history.keepSketchShapes(d, [sketchId]);
        return d.removeSketch(sketchId);
      }
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

  // Remove constraints by id (Unlock, Disconnect).
  removeConstraintIds(sketchId, ids, label = 'Delete constraint') {
    const drop = new Set(ids);
    this.doc.apply(label, (d) => d.updateSketch(sketchId, (sk) => ({ constraints: (sk.constraints || []).filter((c) => !drop.has(c.id)) })));
  }

  addConstraint(sketchId, c) {
    const sk = this.doc.sketch(sketchId);
    if (!sk) return false;
    // Several at once (Symmetric for two lines adds one per end).
    if (Array.isArray(c)) {
      const info = CONSTRAINT_INFO[c[0]?.type];
      return this.solveAndStore(sketchId, sk.entities, [...(sk.constraints || []), ...c.map((x) => stripUndefined({ ...x }))], info?.label || 'Constraint');
    }
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

  // `expr`: the text it was typed as, kept when it uses a variable.
  setConstraintValue(sketchId, cid, value, expr = null) {
    const sk = this.doc.sketch(sketchId);
    const c = sk?.constraints?.find((x) => x.id === cid);
    if (!c || !Number.isFinite(value)) return false;
    if (c.type !== 'angle' && !(value > 0)) {
      toast('The value must be greater than zero', { type: 'error' });
      return false;
    }
    const cons = sk.constraints.map((x) => {
      if (x.id !== cid) return x;
      const { expr: _old, ...rest } = x;
      return expr ? { ...rest, value, expr } : { ...rest, value };
    });
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
    // How to make this result again (before the document changes).
    const recipe = app.history.recipe(result);
    this.doc.apply(label, (d) => {
      const byShape = new Map(d.bodies.map((b) => [b.shapeId, b]));
      const outIds = [];
      for (const r of result.bodies) {
        const kind = r.mesh?.kind || 'solid';
        if (r.replaces && byShape.has(r.replaces)) {
          d.updateBody(byShape.get(r.replaces).id, { shapeId: r.id, kind });
          outIds.push(byShape.get(r.replaces).id);
        } else {
          const src = r.from ? byShape.get(r.from) : null;
          const nb = d.addBody({ shapeId: r.id, kind, color: src?.color ?? null, ...(src?.folder ? { folder: src.folder } : {}), ...(opts.newBody || {}) });
          created.push(nb.id);
          outIds.push(nb.id);
        }
      }
      app.history.record(d, label, result, outIds, recipe);
      for (const sid of result.removed) {
        const b = byShape.get(sid);
        if (b && !result.bodies.some((r) => r.replaces === sid)) d.removeBody(b.id);
      }
      // Planes and images move with their plane.
      for (const st of opts.planes || []) {
        const pl = d.plane(st.id);
        if (!pl) continue;
        const plane = transformPlane(pl.plane, st.matrix);
        if (st.copy) d.addPlane({ plane, size: pl.size, name: t('{name} copy', { name: pl.name }) });
        else d.updatePlane(st.id, { plane });
      }
      for (const st of opts.images || []) {
        const im = d.image(st.id);
        if (!im) continue;
        const plane = transformPlane(im.plane, st.matrix);
        if (st.copy) d.addImage({ ...im, id: undefined, plane, name: t('{name} copy', { name: im.name }) });
        else d.updateImage(st.id, { plane });
      }
      for (const st of opts.sketches || []) {
        const sk = d.sketch(st.id);
        if (!sk) continue;
        const plane = transformPlane(sk.plane, st.matrix);
        if (st.copy) d.addSketch({ plane, entities: sk.entities, constraints: sk.constraints || [], name: t('{name} copy', { name: sk.name }) });
        // A sketch moved off its face no longer follows that face.
        else d.updateSketch(st.id, { plane, ...(sk.attach && !samePlane(plane, sk.plane) ? { attach: null } : {}) });
      }
    });
    app.history.afterRecord();
    app.selection.clear();
    return created;
  }

  // ---- items ---------------------------------------------------------------

  rename(kind, id, name) {
    this.doc.apply('Rename', (d) => updateItem(d, kind, id, { name }));
  }

  setVisible(kind, id, visible) {
    this.doc.apply(visible ? 'Show' : 'Hide', (d) => updateItem(d, kind, id, { visible }));
    if (!visible) this.app.selection.prune((it) => (kind === 'body' ? it.bodyId : kind === 'plane' ? it.planeId : kind === 'axis' ? it.axisId : kind === 'image' ? it.imageId : it.sketchId) !== id);
  }

  // Add a reference image and select it.
  addImage(props) {
    let id = null;
    this.doc.apply('Image', (d) => {
      id = d.addImage(props).id;
    });
    this.app.selection.set([{ kind: 'image', imageId: id }]);
    return id;
  }

  setImage(id, patch, label = 'Image') {
    this.doc.apply(label, (d) => d.updateImage(id, patch));
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

  // Add a reference axis and select it.
  addAxis(axis, { name } = {}) {
    let id = null;
    this.doc.apply('Axis', (d) => {
      id = d.addAxis({ ...axis, ...(name ? { name } : {}) }).id;
    });
    this.app.selection.set([{ kind: 'axis', axisId: id }]);
    return id;
  }

  // Show or hide several items in one undo step: items = [{ kind, id }].
  setVisibleMany(items, visible) {
    if (!items.length) return;
    this.doc.apply(visible ? 'Show' : 'Hide', (d) => {
      for (const { kind, id } of items) updateItem(d, kind, id, { visible });
    });
    if (!visible) {
      const gone = new Set(items.map((x) => x.id));
      this.app.selection.prune((it) => !gone.has(it.bodyId) && !gone.has(it.sketchId) && !gone.has(it.planeId) && !gone.has(it.axisId) && !gone.has(it.imageId));
    }
  }

  // ---- folders ---------------------------------------------------------------

  // Selection entries that can go in a folder (folders too), as { kind, id }.
  folderTargets(items) {
    const out = new Map();
    for (const it of items) {
      const pair =
        it.kind === 'body' || it.kind === 'face' || it.kind === 'edge'
          ? ['body', it.bodyId]
          : it.kind === 'sketch' || it.kind === 'region' || it.kind === 'curve'
            ? ['sketch', it.sketchId]
            : it.kind === 'plane'
              ? ['plane', it.planeId]
              : it.kind === 'axis'
                ? ['axis', it.axisId]
              : it.kind === 'image'
                ? ['image', it.imageId]
                : it.kind === 'folder'
                  ? ['folder', it.folderId]
                  : null;
      if (pair?.[1]) out.set(pair.join(':'), { kind: pair[0], id: pair[1] });
    }
    return [...out.values()];
  }

  // A folder and every folder inside it (at any depth).
  folderTree(folderId) {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.doc.folders) {
        if (f.parent && ids.has(f.parent) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  // What is in a folder (and, with `deep`, in the folders inside it), as
  // selection entries.
  folderItems(folderId, { deep = true } = {}) {
    const doc = this.doc;
    const ids = deep ? this.folderTree(folderId) : new Set([folderId]);
    const inside = (x) => ids.has(x.folder);
    return [
      ...doc.bodies.filter(inside).map((x) => ({ kind: 'body', bodyId: x.id })),
      ...doc.sketches.filter(inside).map((x) => ({ kind: 'sketch', sketchId: x.id })),
      ...doc.planes.filter(inside).map((x) => ({ kind: 'plane', planeId: x.id })),
      ...doc.axes.filter(inside).map((x) => ({ kind: 'axis', axisId: x.id })),
      ...doc.images.filter(inside).map((x) => ({ kind: 'image', imageId: x.id })),
    ];
  }

  // Put items or folders in a folder (folderId = null: the top level).
  // A folder never goes inside itself.
  placeInFolder(d, targets, folderId) {
    for (const t of targets) {
      if (t.kind === 'folder') {
        if (folderId && this.folderTree(t.id).has(folderId)) continue;
        d.updateFolder(t.id, { parent: folderId || null });
      } else updateItem(d, t.kind, t.id, { folder: folderId || null });
    }
  }

  // A new folder (inside `parent` if given), holding `items`. Returns its id.
  newFolder(items = [], parent = null) {
    let id = null;
    this.doc.apply('New folder', (d) => {
      id = d.addFolder({ parent: parent || null }).id;
      this.placeInFolder(d, this.folderTargets(items), id);
    });
    return id;
  }

  // Put items in a folder (or take them out with folderId = null).
  moveToFolder(items, folderId) {
    const targets = this.folderTargets(items).filter((t) => !(t.kind === 'folder' && folderId && this.folderTree(t.id).has(folderId)));
    if (!targets.length) return false;
    const name = folderId ? this.doc.folder(folderId)?.name : null;
    this.doc.apply(folderId ? `Move to ${name || 'folder'}` : 'Take out of folder', (d) => this.placeInFolder(d, targets, folderId));
    return true;
  }

  renameFolder(id, name) {
    this.doc.apply('Rename folder', (d) => d.updateFolder(id, { name }));
  }

  // Delete a folder; with `contents`, also everything in it (and the
  // folders inside it). Otherwise what it holds moves up a level.
  deleteFolder(id, { contents = false } = {}) {
    if (contents) {
      const tree = this.folderTree(id);
      this.deleteItems(this.folderItems(id), {
        also: (d) => {
          d.folders = d.folders.filter((f) => !tree.has(f.id));
        },
        label: 'Delete folder',
      });
    } else this.doc.apply('Delete folder', (d) => d.removeFolder(id));
  }

  setFolderVisible(id, visible) {
    const items = this.folderTargets(this.folderItems(id));
    this.setVisibleMany(items, visible);
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
      for (const a of d.axes) if (a.visible === false) d.updateAxis(a.id, { visible: true });
      for (const p of d.images) if (p.visible === false) d.updateImage(p.id, { visible: true });
    });
  }

  setMaterial(ids, material) {
    this.doc.apply('Material', (d) => ids.forEach((id) => d.updateBody(id, { material })));
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
        if (b && names.has(r.from)) d.updateBody(b.id, { name: t('{name} copy', { name: names.get(r.from) }) });
      }
    });
    toast(tn(ids.length + sketches.length, 'Duplicated 1 item — use Move to place the copy', 'Duplicated {n} items — use Move to place the copy'), { ms: 2200 });
  }

  deleteSelection() {
    const list = this.app.selection.list;
    if (!list.length) return;
    this.deleteItems(list);
  }

  // Delete bodies, sketches or sketch curves. Faces/edges delete their body.
  // opts.also(d): more changes in the same undo step; opts.label.
  deleteItems(items, opts = {}) {
    const bodies = new Set();
    const sketches = new Set();
    const planes = new Set();
    const axes = new Set();
    const images = new Set();
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
      else if (it.kind === 'axis') axes.add(it.axisId);
      else if (it.kind === 'image') images.add(it.imageId);
    }
    if (!bodies.size && !sketches.size && !curves.size && !planes.size && !axes.size && !images.size && !opts.also) return;
    const history = this.app.history;
    this.doc.apply(opts.label || 'Delete', (d) => {
      opts.also?.(d);
      // Steps that use deleted sketch curves keep their current shape.
      history.keepSketchShapes(d, [...sketches, ...curves.keys()]);
      for (const id of planes) d.removePlane(id);
      for (const id of axes) d.removeAxis(id);
      for (const id of images) d.removeImage(id);
      for (const id of bodies) d.removeBody(id);
      history.recordDelete(d, [...bodies]);
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
    if (bodies.size) history.afterRecord();
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
        const ok = await confirmDialog('Convert large mesh?', t('"{name}" has {n} triangles. Converting can take a while and the solid will have many faces. Continue?', { name: b.name, n: tris.toLocaleString() }), { ok: 'Convert' });
        if (!ok) continue;
      }
      try {
        app.busy(true, t('Converting {name}…', { name: b.name }));
        const res = await app.kernel.call('meshToSolid', { id: b.shapeId });
        this.applyResult('Convert to solid', res);
        toast(t('{name} is now a solid body', { name: b.name }), { type: 'ok' });
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

// Patch a body, sketch, plane or image by kind.
function updateItem(d, kind, id, patch) {
  if (kind === 'body') return d.updateBody(id, patch);
  if (kind === 'folder') return d.updateFolder(id, patch);
  if (kind === 'plane') return d.updatePlane(id, patch);
  if (kind === 'axis') return d.updateAxis(id, patch);
  if (kind === 'image') return d.updateImage(id, patch);
  return d.updateSketch(id, patch);
}
