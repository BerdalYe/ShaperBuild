// The design document: bodies and sketches, with undo/redo.
//
// State is immutable. Every change goes through `apply`, which hands the
// callback a shallow draft; callbacks replace objects instead of mutating
// them, so unchanged bodies and sketches keep their identity.
import { Emitter } from './events.js';
import { t } from './i18n.js';

export function emptyState() {
  return {
    bodies: [],
    sketches: [],
    planes: [],
    // Reference axes ({ id, name, origin, dir, length, visible, folder }).
    axes: [],
    images: [],
    // Folders in the Items list ({ id, name, parent }); items point at
    // theirs with `folder`, folders inside folders with `parent`.
    folders: [],
    // Design history: every step that made or changed bodies (see history.js).
    history: [],
    // Variables ({ id, name, kind: 'length' | 'angle' | 'number', expr }).
    variables: [],
    seq: { body: 0, sketch: 0, entity: 0, constraint: 0, plane: 0, axis: 0, image: 0, feature: 0, folder: 0, variable: 0 },
    units: 'mm',
  };
}

function freeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj) && !ArrayBuffer.isView(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) freeze(v);
  }
  return obj;
}

export class Draft {
  constructor(state) {
    this.bodies = state.bodies.slice();
    this.sketches = state.sketches.slice();
    this.planes = (state.planes || []).slice();
    this.axes = (state.axes || []).slice();
    this.images = (state.images || []).slice();
    this.folders = (state.folders || []).slice();
    this.history = (state.history || []).slice();
    this.variables = (state.variables || []).slice();
    this.seq = { ...state.seq };
    this.units = state.units;
  }

  nextId(kind) {
    this.seq[kind] = (this.seq[kind] || 0) + 1;
    const prefix = { body: 'b', sketch: 's', entity: 'e', constraint: 'k', plane: 'p', axis: 'x', image: 'i', feature: 'f', folder: 'g', variable: 'v' }[kind] || kind;
    return `${prefix}${this.seq[kind]}`;
  }

  body(id) {
    return this.bodies.find((b) => b.id === id);
  }

  sketch(id) {
    return this.sketches.find((s) => s.id === id);
  }

  addBody(props) {
    const id = this.nextId('body');
    const body = { name: t('Body {n}', { n: this.seq.body }), kind: 'solid', visible: true, color: null, ...props, id };
    this.bodies.push(body);
    return body;
  }

  // Add a body that already has an id (bodies rebuilt from the history).
  putBody(props) {
    const body = { name: 'Body', kind: 'solid', visible: true, color: null, ...props };
    this.bodies.push(body);
    return body;
  }

  updateBody(id, patch) {
    const i = this.bodies.findIndex((b) => b.id === id);
    if (i < 0) return null;
    this.bodies[i] = { ...this.bodies[i], ...(typeof patch === 'function' ? patch(this.bodies[i]) : patch) };
    return this.bodies[i];
  }

  removeBody(id) {
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }

  addSketch(props) {
    const id = this.nextId('sketch');
    const sk = { name: t('Sketch {n}', { n: this.seq.sketch }), visible: true, entities: [], constraints: [], ...props, id };
    this.sketches.push(sk);
    return sk;
  }

  updateSketch(id, patch) {
    const i = this.sketches.findIndex((s) => s.id === id);
    if (i < 0) return null;
    this.sketches[i] = { ...this.sketches[i], ...(typeof patch === 'function' ? patch(this.sketches[i]) : patch) };
    return this.sketches[i];
  }

  removeSketch(id) {
    this.sketches = this.sketches.filter((s) => s.id !== id);
  }

  plane(id) {
    return this.planes.find((p) => p.id === id);
  }

  // Reference plane: { plane: { origin, normal, xDir }, size }.
  addPlane(props) {
    const id = this.nextId('plane');
    const pl = { name: t('Plane {n}', { n: this.seq.plane }), visible: true, size: 80, ...props, id };
    this.planes.push(pl);
    return pl;
  }

  updatePlane(id, patch) {
    const i = this.planes.findIndex((p) => p.id === id);
    if (i < 0) return null;
    this.planes[i] = { ...this.planes[i], ...patch };
    return this.planes[i];
  }

  removePlane(id) {
    this.planes = this.planes.filter((p) => p.id !== id);
  }

  axis(id) {
    return this.axes.find((a) => a.id === id);
  }

  // Reference axis: { origin, dir, length }.
  addAxis(props) {
    const id = this.nextId('axis');
    const ax = { name: t('Axis {n}', { n: this.seq.axis }), visible: true, length: 80, ...props, id };
    this.axes.push(ax);
    return ax;
  }

  updateAxis(id, patch) {
    const i = this.axes.findIndex((a) => a.id === id);
    if (i < 0) return null;
    this.axes[i] = { ...this.axes[i], ...patch };
    return this.axes[i];
  }

  removeAxis(id) {
    this.axes = this.axes.filter((a) => a.id !== id);
  }

  image(id) {
    return this.images.find((p) => p.id === id);
  }

  // Reference image: { src (data URL), plane, width, height (mm), opacity }.
  addImage(props) {
    const id = this.nextId('image');
    const im = { name: t('Image {n}', { n: this.seq.image }), visible: true, opacity: 0.6, ...props, id };
    this.images.push(im);
    return im;
  }

  updateImage(id, patch) {
    const i = this.images.findIndex((p) => p.id === id);
    if (i < 0) return null;
    this.images[i] = { ...this.images[i], ...patch };
    return this.images[i];
  }

  removeImage(id) {
    this.images = this.images.filter((p) => p.id !== id);
  }

  folder(id) {
    return this.folders.find((f) => f.id === id);
  }

  addFolder(props = {}) {
    const id = this.nextId('folder');
    const f = { name: t('Folder {n}', { n: this.seq.folder }), ...props, id };
    this.folders.push(f);
    return f;
  }

  updateFolder(id, patch) {
    const i = this.folders.findIndex((f) => f.id === id);
    if (i < 0) return null;
    this.folders[i] = { ...this.folders[i], ...patch };
    return this.folders[i];
  }

  // Remove a folder; what was in it (items and folders) moves up a level.
  removeFolder(id) {
    const gone = this.folder(id);
    if (!gone) return;
    const up = gone.parent && this.folder(gone.parent) ? gone.parent : null;
    this.folders = this.folders.filter((f) => f.id !== id).map((f) => (f.parent === id ? { ...f, parent: up } : f));
    const out = (list, update) => list.filter((x) => x.folder === id).forEach((x) => update(x.id, { folder: up }));
    out(this.bodies, (i, p) => this.updateBody(i, p));
    out(this.sketches, (i, p) => this.updateSketch(i, p));
    out(this.planes, (i, p) => this.updatePlane(i, p));
    out(this.axes, (i, p) => this.updateAxis(i, p));
    out(this.images, (i, p) => this.updateImage(i, p));
  }

  // Give new entities ids.
  withIds(entities) {
    return entities.map((e) => (e.id ? e : { ...e, id: this.nextId('entity') }));
  }

  withConstraintIds(constraints = []) {
    return constraints.map((c) => (c.id ? c : { ...c, id: this.nextId('constraint') }));
  }

  toState() {
    return { bodies: this.bodies, sketches: this.sketches, planes: this.planes, axes: this.axes, images: this.images, folders: this.folders, history: this.history, variables: this.variables, seq: this.seq, units: this.units };
  }
}

export class Document extends Emitter {
  constructor() {
    super();
    this.state = freeze(emptyState());
    this.past = [];
    this.future = [];
    this.saved = this.state;
    this.limit = 200;
  }

  get bodies() {
    return this.state.bodies;
  }

  get sketches() {
    return this.state.sketches;
  }

  body(id) {
    return this.state.bodies.find((b) => b.id === id);
  }

  get planes() {
    return this.state.planes || [];
  }

  get folders() {
    return this.state.folders || [];
  }

  get variables() {
    return this.state.variables || [];
  }

  folder(id) {
    return this.folders.find((f) => f.id === id);
  }

  plane(id) {
    return this.planes.find((p) => p.id === id);
  }

  get axes() {
    return this.state.axes || [];
  }

  axis(id) {
    return this.axes.find((a) => a.id === id);
  }

  get images() {
    return this.state.images || [];
  }

  image(id) {
    return this.images.find((p) => p.id === id);
  }

  sketch(id) {
    return this.state.sketches.find((s) => s.id === id);
  }

  get dirty() {
    return this.state !== this.saved;
  }

  get isEmpty() {
    return !this.state.bodies.length && !this.state.sketches.length && !(this.state.planes || []).length && !(this.state.axes || []).length && !(this.state.images || []).length;
  }

  // Apply a change; returns whatever the callback returns.
  apply(label, fn) {
    const draft = new Draft(this.state);
    const out = fn(draft);
    const next = freeze(draft.toState());
    this.past.push({ state: this.state, label });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.state = next;
    this.emit('change', { label, kind: 'apply' });
    return out;
  }

  // Replace the state without recording history (e.g. caches).
  replaceSilently(fn) {
    const draft = new Draft(this.state);
    fn(draft);
    this.state = freeze(draft.toState());
    this.emit('change', { kind: 'silent' });
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push({ state: this.state, label: prev.label });
    this.state = prev.state;
    this.emit('change', { label: prev.label, kind: 'undo' });
    return prev.label;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push({ state: this.state, label: next.label });
    this.state = next.state;
    this.emit('change', { label: next.label, kind: 'redo' });
    return next.label;
  }

  markSaved() {
    this.saved = this.state;
    this.emit('saved');
  }

  load(state) {
    this.state = freeze({ ...emptyState(), ...state });
    this.past = [];
    this.future = [];
    this.saved = this.state;
    this.emit('change', { kind: 'load' });
  }

  // Every kernel shape id referenced by current state and history.
  referencedShapes() {
    const ids = new Set();
    const add = (s) => {
      s.bodies.forEach((b) => ids.add(b.shapeId));
      // Shapes the history starts from (imports) must stay alive too.
      for (const f of s.history || []) if (f.op === 'base') f.bodies.forEach((x) => ids.add(x.s));
    };
    add(this.state);
    this.past.forEach((h) => add(h.state));
    this.future.forEach((h) => add(h.state));
    return ids;
  }
}
