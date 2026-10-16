// Design history in the app: records every step that makes or changes
// bodies, and rebuilds the bodies when an earlier step or a sketch it uses
// is changed. The document always holds the rebuilt result, so everything
// else (viewport, export, undo) works on plain bodies.
import { RECORDED, symbolize, runFeature, featureKey, chainKeys, placedPlane, effectiveEntities, mapSketchRefs, editableParams } from './core/replay.js';
import { faceSig } from './core/refs.js';
import { toast } from './ui/overlays.js';
import { t, tn } from './core/i18n.js';
import { Emitter } from './core/events.js';

const CACHE_LIMIT = 120;
// Tool panel fields for step values with other names.
const FIELD_OF = { 'move.t.0': 'x', 'move.t.1': 'y', 'move.t.2': 'z', 'move.r.0': 'rx', 'move.r.1': 'ry', 'move.r.2': 'rz', 'scale.factor': 'factor', 'planeRef.offset': 'offset' };

export class HistoryEngine extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    // key -> Map(bodyId -> shapeId): the bodies after a step.
    this.cache = new Map();
    // Errors of steps by chain key, kept with the cache.
    this.failed = new Map();
    this.verified = 'root';
    this.running = null;
    this.again = false;
    // Last known name, colour etc. of each body, for bodies a rebuild brings back.
    this.looks = new Map();
    app.doc.on('change', (ev) => this.onDocChange(ev));
  }

  get features() {
    return this.app.doc.state.history || [];
  }

  get busy() {
    return !!this.running;
  }

  sketchMap() {
    return new Map(this.app.doc.sketches.map((s) => [s.id, s]));
  }

  docState() {
    return new Map(this.app.doc.bodies.map((b) => [b.id, b.shapeId]));
  }

  remember(key, state) {
    this.cache.delete(key);
    this.cache.set(key, state);
    while (this.cache.size > CACHE_LIMIT) {
      const old = this.cache.keys().next().value;
      this.cache.delete(old);
      this.failed.delete(old);
    }
  }

  // The current bodies are the result of the current history.
  trustDocument() {
    const keys = chainKeys(this.features, this.sketchMap());
    this.verified = keys.length ? keys[keys.length - 1] : 'root';
    this.remember(this.verified, this.docState());
  }

  // Shapes the rebuild cache needs (kept by garbage collection).
  heldShapes() {
    const ids = new Set();
    for (const st of this.cache.values()) for (const s of st.values()) ids.add(s);
    return ids;
  }

  // ---- recording ---------------------------------------------------------

  // How to redo a kernel result later, or null for a fixed (base) step.
  recipe(result) {
    const calls = result.calls;
    if (!calls?.length || !calls.every((c) => RECORDED.has(c.method))) return null;
    const app = this.app;
    const doc = app.doc;
    const byShape = new Map(doc.bodies.map((b) => [b.shapeId, b.id]));
    try {
      return calls.map((c) => ({
        method: c.method,
        n: c.n,
        args: symbolize(c.method, c.args, {
          bodyOfShape: (sid) => byShape.get(sid),
          mesh: (b) => app.bodyMesh(b),
          sketch: (id) => doc.sketch(id),
          region: (id, i) => app.regionCache.get(id)?.data?.regions[i],
        }),
      }));
    } catch (err) {
      console.warn('history: step kept as a fixed shape', err);
      return null;
    }
  }

  // Called inside doc.apply with the ids of the result's bodies.
  record(d, label, result, outIds, recipe) {
    if (!result.bodies.length && !result.removed?.length) return;
    const id = d.nextId('feature');
    if (recipe) {
      let k = 0;
      const calls = recipe.map((c) => {
        const out = outIds.slice(k, k + c.n);
        k += c.n;
        return { method: c.method, args: c.args, out };
      });
      const step = { id, label, op: 'op', calls };
      const exprs = this.typedLinks(step);
      this.insert(d, exprs ? { ...step, exprs } : step);
    } else {
      const shapeToBody = new Map(this.app.doc.bodies.map((b) => [b.shapeId, b.id]));
      const removed = (result.removed || []).map((s) => shapeToBody.get(s)).filter(Boolean);
      this.insert(d, { id, label, op: 'base', bodies: result.bodies.map((r, i) => ({ b: outIds[i], s: r.id })), removed });
    }
  }

  // New steps go at the rollback bar (before the steps that are rolled back).
  insert(d, step) {
    const at = d.history.findIndex((f) => f.rolledBack);
    if (at >= 0) d.history.splice(at, 0, step);
    else d.history.push(step);
  }

  // Values typed with a variable in the tool panel stay linked to it.
  typedLinks(step) {
    const typed = this.app.panel?.visible && this.app.panel.exprs;
    if (!typed || !Object.keys(typed).length) return null;
    const out = {};
    for (const p of editableParams(step)) {
      const text = typed[p.key] ?? typed[FIELD_OF[p.key]] ?? typed[p.key.split('.').pop()];
      if (text) out[p.key] = text;
    }
    return Object.keys(out).length ? out : null;
  }

  recordDelete(d, bodyIds) {
    if (bodyIds.length) this.insert(d, { id: d.nextId('feature'), label: 'Delete', op: 'delete', bodies: bodyIds });
  }

  // Before sketches or curves are deleted: steps that use them keep the
  // shape they have now (instead of the one they were made with).
  keepSketchShapes(d, sketchIds) {
    const ids = new Set(sketchIds);
    if (!ids.size || !d.history.length) return;
    const sketches = new Map(d.sketches.map((s) => [s.id, s]));
    d.history = d.history.map((f) =>
      mapSketchRefs(f, (ref) => {
        if (!ids.has(ref.sk)) return ref;
        const snap = effectiveEntities(ref, sketches);
        return { ...ref, snap: ref.ents ? snap : snap[0] || ref.snap };
      }),
    );
  }

  // After a recorded step: the document is the result of the history,
  // if the bodies it was made from were up to date.
  afterRecord() {
    const keys = chainKeys(this.features, this.sketchMap());
    const before = keys.length > 1 ? keys[keys.length - 2] : 'root';
    if (!this.running && before === this.verified) this.trustDocument();
    else {
      // Made while the design was still updating: replay it on the new bodies.
      this.check();
    }
    this.emit('change');
  }

  // Remember the face a new sketch was drawn on, so it can move with it.
  attachFor(plane, bodyId, faceIndex) {
    const m = this.app.bodyMesh(bodyId);
    const info = m?.faceInfo?.[faceIndex];
    return info ? { b: bodyId, s: faceSig(info, m.bbox) } : null;
  }

  // ---- keeping bodies in step with the history ------------------------------

  onDocChange(ev) {
    for (const b of this.app.doc.bodies) this.looks.set(b.id, b);
    if (ev.kind === 'load') {
      this.cache.clear();
      this.failed.clear();
      // Designs from before the history: start from their current bodies.
      if (!this.features.length && this.app.doc.bodies.length) {
        this.app.doc.replaceSilently((d) => {
          d.history = [{ id: d.nextId('feature'), label: 'Design', op: 'base', bodies: d.bodies.map((b) => ({ b: b.id, s: b.shapeId })), removed: [] }];
        });
      }
      this.trustDocument();
      this.emit('change');
      return;
    }
    if (ev.kind === 'undo' || ev.kind === 'redo') {
      const keys = chainKeys(this.features, this.sketchMap());
      const last = keys.length ? keys[keys.length - 1] : 'root';
      const known = this.cache.get(last);
      const now = this.docState();
      // Normally the bodies already match; if not, put back the known ones.
      if (!known || (known.size === now.size && [...known].every(([b, s]) => now.get(b) === s))) this.trustDocument();
      else this.check();
      this.emit('change');
      return;
    }
    if (ev.kind === 'apply') {
      clearTimeout(this.checkTimer);
      this.checkTimer = setTimeout(() => this.check(), 0);
    }
  }

  // Rebuild if a step or a sketch it uses changed since the last rebuild.
  async check() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const feats = this.features;
    const keys = chainKeys(feats, this.sketchMap());
    const last = keys.length ? keys[keys.length - 1] : 'root';
    if (last === this.verified) return;
    let j = keys.length;
    while (j > 0 && !this.cache.has(keys[j - 1])) j--;
    this.emit('change');
    this.running = this.rebuild(j, keys).finally(() => {
      this.running = null;
      this.emit('change');
      if (this.again) {
        this.again = false;
        this.check();
      }
    });
    return this.running;
  }

  // Wait until the bodies match the history.
  async settle() {
    clearTimeout(this.checkTimer);
    await this.check();
    while (this.running) await this.running;
  }

  async rebuild(start, keys) {
    const app = this.app;
    const doc = app.doc;
    const feats = doc.state.history;
    const sketches = this.sketchMap();
    const rc = {
      state: new Map(start ? this.cache.get(keys[start - 1]) : []),
      sketches,
      call: (m, a) => app.kernel.call(m, a),
      meshOf: (sid) => app.meshCache.get(sid),
      ensureMesh: async (sid) => {
        if (!app.meshCache.has(sid)) app.meshCache.set(sid, await app.kernel.call('tessellate', { id: sid }));
      },
      setMesh: (sid, mesh) => app.meshCache.set(sid, mesh),
      regions: new Map(),
      temps: [],
    };
    const errors = new Map();
    // Steps before `start` are not run again: their errors come from the
    // run that cached them (a step that failed fails the same way again).
    for (let i = 0; i < start; i++) if (this.failed.has(keys[i])) errors.set(feats[i].id, this.failed.get(keys[i]));
    let prev = start ? keys[start - 1] : 'root';
    app.busy(true, 'Updating the design…');
    try {
      for (let i = start; i < feats.length; i++) {
        const f = feats[i];
        if (!f.suppressed && !f.rolledBack) {
          try {
            await runFeature(f, rc);
          } catch (err) {
            errors.set(f.id, String(err.message || err).replace(/^\w/, (c) => c.toUpperCase()));
          }
        }
        prev = featureKey(prev, f, sketches);
        if (errors.has(f.id)) this.failed.set(prev, errors.get(f.id));
        else this.failed.delete(prev);
        this.remember(prev, new Map(rc.state));
      }
    } finally {
      if (rc.temps.length) app.kernel.call('dropSketches', { ids: rc.temps }).catch(() => {});
      app.busy(false);
    }
    // The document changed while rebuilding: check again.
    if (doc.state.history !== feats || this.again) {
      this.again = false;
      return this.rebuildLater();
    }
    // Make sure every body has a mesh before the view needs it.
    for (const sid of rc.state.values()) if (!app.meshCache.has(sid)) app.fetchMesh(sid);
    doc.replaceSilently((d) => {
      for (const b of d.bodies.slice()) {
        if (!rc.state.has(b.id)) d.removeBody(b.id);
        else if (b.shapeId !== rc.state.get(b.id)) d.updateBody(b.id, { shapeId: rc.state.get(b.id), kind: app.meshCache.get(rc.state.get(b.id))?.kind || b.kind });
      }
      for (const [id, sid] of rc.state) {
        if (d.body(id)) continue;
        const was = this.looks.get(id);
        d.putBody({ ...(was || { name: t('Body {n}', { n: d.bodies.length + 1 }) }), id, shapeId: sid, kind: app.meshCache.get(sid)?.kind || was?.kind || 'solid' });
      }
      // Sketches drawn on faces follow those faces.
      for (const sk of d.sketches) {
        if (!sk.attach || !rc.state.has(sk.attach.b)) continue;
        const plane = placedPlane({ plane: sk.plane, attach: sk.attach }, rc);
        if (plane !== sk.plane) d.updateSketch(sk.id, { plane });
      }
      d.history = d.history.map((f) => {
        const e = errors.get(f.id) || null;
        if ((f.error || null) === e) return f;
        const { error, ...rest } = f;
        void error;
        return e ? { ...rest, error: e } : rest;
      });
    });
    this.verified = prev;
    this.remember(prev, this.docState());
    if (errors.size) toast(tn(errors.size, '1 step in the history could not be rebuilt. See History.', '{n} steps in the history could not be rebuilt. See History.'), { type: 'error', ms: 4500 });
    this.emit('change');
  }

  rebuildLater() {
    setTimeout(() => this.check(), 0);
  }

  // ---- editing the history -------------------------------------------------

  // Replace a step (e.g. new values). `quiet` merges into the last undo step.
  replaceStep(id, next, { label, quiet = false } = {}) {
    const doc = this.app.doc;
    const fn = (d) => {
      d.history = d.history.map((f) => (f.id === id ? next : f));
    };
    if (quiet) {
      doc.replaceSilently(fn);
      this.check();
    } else doc.apply(label || `Edit ${next.label}`, fn);
  }

  removeStep(id) {
    const f = this.features.find((x) => x.id === id);
    if (!f) return;
    this.app.doc.apply(`Delete ${f.label}`, (d) => {
      d.history = d.history.filter((x) => x.id !== id);
    });
  }

  // Roll back: steps after `id` are skipped until rolled forward again
  // (id = null rolls forward to the end).
  rollTo(id) {
    const feats = this.features;
    const i = id ? feats.findIndex((f) => f.id === id) : feats.length - 1;
    if (i < 0) return;
    this.app.doc.apply(i === feats.length - 1 ? 'Roll forward' : 'Roll back', (d) => {
      d.history = d.history.map((f, k) => {
        const back = k > i;
        if (!!f.rolledBack === back) return f;
        const { rolledBack, ...rest } = f;
        return back ? { ...rest, rolledBack: true } : rest;
      });
    });
  }

  get rolledBack() {
    return this.features.some((f) => f.rolledBack);
  }

  renameStep(id, name) {
    const f = this.features.find((x) => x.id === id);
    if (!f) return;
    this.app.doc.apply('Rename', (d) => {
      d.history = d.history.map((x) => {
        if (x.id !== id) return x;
        const { name: _old, ...rest } = x;
        return name ? { ...rest, name } : rest;
      });
    });
  }

  // Merge the history into one fixed step (the bodies as they are now).
  // Sketches and variables can stay or go; nothing links to them any more.
  merge({ keepSketches = true, keepVariables = true } = {}) {
    this.app.doc.apply('Merge history', (d) => {
      d.history = [{ id: d.nextId('feature'), label: 'Design', op: 'base', bodies: d.bodies.map((b) => ({ b: b.id, s: b.shapeId })), removed: [] }];
      if (!keepSketches) d.sketches = [];
      if (!keepVariables) {
        d.variables = [];
        for (const sk of d.sketches) {
          if ((sk.constraints || []).some((c) => c.expr)) d.updateSketch(sk.id, { constraints: sk.constraints.map(({ expr, ...c }) => c) });
        }
      }
    });
    this.trustDocument();
    this.emit('change');
  }

  toggleSuppress(id) {
    const f = this.features.find((x) => x.id === id);
    if (!f) return;
    this.app.doc.apply(f.suppressed ? `Turn on ${f.label}` : `Turn off ${f.label}`, (d) => {
      d.history = d.history.map((x) => (x.id === id ? { ...x, suppressed: !x.suppressed } : x));
    });
  }
}
