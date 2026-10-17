// Application controller: owns the document, kernel, viewport, selection and
// tools, and keeps them in sync.
import * as THREE from 'three';
import { KernelClient } from './kernel/client.js';
import { Document } from './core/doc.js';
import { Selection } from './core/selection.js';
import { Viewport } from './view/viewport.js';
import { ToolPanel } from './ui/toolpanel.js';
import { DimInput } from './ui/diminput.js';
import { ToolManager } from './tools/manager.js';
import { ItemsPanel } from './ui/items.js';
import { ToolsMenu } from './ui/toolsmenu.js';
import { ContextBar } from './ui/contextbar.js';
import { Commands } from './commands.js';
import { HistoryEngine } from './history.js';
import { FileOps } from './fileops.js';
import { Dialogs } from './ui/dialogs.js';
import { Home } from './ui/home.js';
import { ConstraintLayer } from './ui/constraints.js';
import { ViewControls, NavHelp } from './ui/viewcontrols.js';
import { StarterCard, ToolHint } from './ui/starter.js';
import { Tutorial } from './ui/tutorial.js';
import { PrintDialog } from './ui/printdialog.js';
import { Updates } from './ui/updates.js';
import { DrawingDialog } from './ui/drawingdialog.js';
import { MaterialsPanel } from './ui/materials.js';
import { toast, showMenu, hideTooltip, modal } from './ui/overlays.js';
import { icon } from './ui/icons.js';
import { h, isTyping, modKey, translateStatic } from './ui/dom.js';
import { BootScreen } from './ui/boot.js';
import { t, language, setLanguage } from './core/i18n.js';
import { Welcome } from './ui/welcome.js';
import { buildKeymap, comboOf } from './core/keymap.js';
import { UNITS, formatLength, formatArea, formatVolume, formatAngle, niceStep, setVariables } from './core/units.js';
import { variableValues } from './core/variables.js';
import { planeFrame, to3D, to2D, samePlane } from './core/plane.js';
import { keyPoints, closestOnEntity, dist, intersect, sampleEntity } from './core/geom2d.js';

const SETTINGS_KEY = 'shaperbuild.settings.v1';
// What a click selects (status bar; Tab cycles in the alternative keys).
const SELECT_FILTERS = [
  ['all', 'Select all items'],
  ['bodies', 'Bodies only'],
  ['faces', 'Faces only'],
  ['edges', 'Edges only'],
];
const DEFAULT_SETTINGS = {
  theme: 'dark',
  units: 'mm',
  snap: true,
  // What snapping uses (the menu next to the Snap button).
  snapTo: { end: true, mid: true, center: true, intersection: true, vertex: true, grid: true, guides: true, curve: true, hints: true },
  gridLock: null,
  additiveSelect: true,
  selectFilter: 'all',
  scrollMode: 'auto',
  showGrid: true,
  showEdges: true,
  drawConstruction: false,
  stlQuality: 'fine',
  stlBinary: true,
  autoLookAt: false,
  autoUpdate: true,
  toolLabels: true,
  // Keyboard shortcuts: a ready-made set plus the keys people changed.
  keymap: { preset: 'shaperbuild', keys: {} },
};

export class App {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY) };
    this.ready = false;
    this.meshCache = new Map();
    this.regionCache = new Map();
    this.pendingMeshes = new Set();
    this.section = { enabled: false };
    this.previewHidden = [];

    document.body.className = `theme-${this.settings.theme}`;
    setLanguage(language());
    translateStatic(document.getElementById('app'));
    this.kernel = new KernelClient();
    this.boot = new BootScreen(this.kernel);
    this.doc = new Document();
    this.selection = new Selection();
    this.vp = new Viewport(document.getElementById('viewport'), { theme: this.settings.theme });
    this.applyViewSettings();
    this.panel = new ToolPanel(document.getElementById('tool-panel'), this);
    this.dim = new DimInput(document.getElementById('viewport'), this);
    this.status = new Status(this);
    this.cmd = new Commands(this);
    this.history = new HistoryEngine(this);
    this.files = new FileOps(this);
    this.dialogs = new Dialogs(this);
    this.tools = new ToolManager(this);
    this.items = new ItemsPanel(document.getElementById('items'), this);
    this.toolsMenu = new ToolsMenu(document.getElementById('tools'), this);
    this.context = new ContextBar(document.getElementById('context-bar'), this);
    this.home = new Home(document.getElementById('home'), this);
    this.constraints = new ConstraintLayer(this);
    this.tools.on('change', () => this.constraints.update());
    this.navHelp = new NavHelp(this);
    this.tutorial = new Tutorial(this);
    this.print = new PrintDialog(this);
    this.updates = new Updates(this);
    this.drawing = new DrawingDialog(this);
    this.materials = new MaterialsPanel(document.getElementById('materials'), this);
    this.starter = new StarterCard(document.getElementById('starter'), this);
    this.welcome = new Welcome(this);

    this.doc.on('change', (ev) => this.onDocChange(ev));
    this.doc.on('saved', () => this.updateTitle());
    this.selection.on('change', () => this.onSelectionChange());
    this.selection.on('hover', () => this.refreshHighlights());
    this.kernel.on('busy', (b) => this.onKernelBusy(b));
    this.setupChrome();
    this.setupKeys();
    this.setupDrop();
    this.tools.activate('select');
    this.updateTitle();
  }

  async start() {
    try {
      await this.kernel.ready;
    } catch (err) {
      this.boot.fail(err.message);
      return;
    }
    this.boot.set(92, 'Opening your workspace…');
    if (window.native) {
      window.native.onMenu((cmd, arg) => this.onMenu(cmd, arg));
      window.native.onOpenPath((p) => this.files.openPath(p));
    }
    // First start: choose the language (reloads if it changes).
    const info = await window.native?.info().catch(() => null);
    if (!this.settings.language && !info?.noTutorial) await this.welcome.chooseLanguage();
    else window.native?.setLanguage?.(language());
    // Decide on recovery and the home screen before reporting ready, so the
    // home screen never pops up over work that has already started.
    const recovered = await this.files.offerRecovery().catch(() => false);
    if (!recovered && this.doc.isEmpty && !this.files.path) this.home.show();
    this.boot.hide();
    this.ready = true;
    window.native?.ready();
    this.files.startAutosave();
    this.starter.update();
    this.updates.start();
    // First launch: offer the interactive tutorial.
    if (!recovered && !this.tutorial.seen && !info?.noTutorial) this.tutorial.offer();
  }

  get units() {
    return this.doc.state.units || 'mm';
  }

  // The language applies when the window starts (see restartWindow).
  setLanguageSetting(id) {
    this.settings.language = id;
    this.saveSettings();
    window.native?.setLanguage?.(id);
  }

  // Reload the window, keeping the open design as it is.
  async restartWindow() {
    await this.files.autosave({ keep: true });
    location.reload();
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  applyViewSettings() {
    const s = this.settings;
    this.vp.showGrid = s.showGrid;
    this.vp.setShowEdges(s.showEdges);
    const mac = (window.native?.platform || navigator.platform || '').toLowerCase().includes('mac');
    this.vp.scrollMode = s.scrollMode === 'auto' ? (mac ? 'orbit' : 'zoom') : s.scrollMode;
    this.vp.setLighting(s.lighting || {});
    this.vp.setFov(s.fov || 35);
    this.vp.requestRender();
  }

  // ---- document sync -----------------------------------------------------

  onDocChange(ev) {
    if (ev.kind === 'load') {
      // A different design: pins and isolate belong to the old one.
      if (this.pins?.length) this.clearPins();
      if (this.isolated) {
        this.isolated = null;
        this.viewControls?.btns.isolate?.classList.remove('on');
        document.getElementById('isolate-bar')?.setAttribute('hidden', '');
      }
    }
    this.updateVariables();
    this.syncView();
    if (ev.kind === 'undo' || ev.kind === 'redo') toast(t(ev.kind === 'undo' ? 'Undo {label}' : 'Redo {label}', { label: t(ev.label || '') }).trim(), { ms: 1200 });
    this.updateTitle();
    this.scheduleGC();
  }

  // Number fields understand the design's variables.
  updateVariables() {
    const st = this.doc.state;
    if (this.varsFor?.list === st.variables && this.varsFor.units === st.units) return;
    this.varsFor = { list: st.variables, units: st.units };
    this.variables = variableValues(st);
    setVariables(this.variables);
  }

  syncView() {
    const doc = this.doc;
    for (const b of doc.bodies) if (!this.meshCache.has(b.shapeId)) this.fetchMesh(b.shapeId);
    this.vp.syncBodies(doc.bodies, (id) => this.meshCache.get(id));
    for (const sk of doc.sketches) this.requestRegions(sk);
    this.vp.syncSketches(doc.sketches, (sk) => this.regionDataFor(sk));
    this.vp.syncPlanes(doc.planes);
    this.vp.syncAxes(doc.axes);
    this.vp.syncImages(doc.images);
    this.vp.syncDecals(doc.decals);
    this.applyIsolation();
    this.selection.prune((it) => this.isValidItem(it));
    this.refreshHighlights();
    this.tools.active?.onSelectionChange?.();
    this.context.render();
    if (this.section.enabled) this.vp.updateSectionCaps?.();
  }

  async fetchMesh(shapeId) {
    if (this.pendingMeshes.has(shapeId)) return;
    this.pendingMeshes.add(shapeId);
    try {
      const mesh = await this.kernel.call('tessellate', { id: shapeId });
      this.meshCache.set(shapeId, mesh);
      this.syncView();
    } catch (err) {
      console.error(err);
    } finally {
      this.pendingMeshes.delete(shapeId);
    }
  }

  // Region data for a sketch: { key, regions, curves } (computed by the kernel).
  sketchKey(sk) {
    return JSON.stringify([sk.plane, sk.entities.filter((e) => !e.construction)]);
  }

  regionDataFor(sk) {
    const c = this.regionCache.get(sk.id);
    if (!c) return null;
    return c.data;
  }

  requestRegions(sk) {
    const key = this.sketchKey(sk);
    const c = this.regionCache.get(sk.id);
    if (c && (c.key === key || c.pendingKey === key)) return c.promise;
    const entry = c || { key: null, data: null };
    entry.pendingKey = key;
    entry.promise = this.kernel
      .call('sketchRegions', { id: sk.id, plane: sk.plane, entities: sk.entities })
      .then((res) => {
        if (entry.pendingKey !== key) return;
        entry.key = key;
        entry.pendingKey = null;
        entry.data = { regions: res.regions, curves: res.curves || {} };
        this.vp.syncSketches(this.doc.sketches, (s) => this.regionDataFor(s));
        this.selection.prune((it) => this.isValidItem(it));
        this.refreshHighlights();
        this.tools.active?.onSelectionChange?.();
      })
      .catch((err) => {
        entry.pendingKey = null;
        console.warn('regions', err);
      });
    this.regionCache.set(sk.id, entry);
    return entry.promise;
  }

  // Make sure the kernel has current regions for the sketches of `items`.
  async ensureRegions(items) {
    const ids = new Set(items.filter((it) => it.kind === 'region').map((it) => it.sketchId));
    for (const id of ids) {
      const sk = this.doc.sketch(id);
      if (!sk) throw new Error('The sketch no longer exists');
      const c = this.regionCache.get(id);
      if (!c || c.key !== this.sketchKey(sk)) await this.requestRegions(sk);
    }
  }

  isValidItem(it) {
    const doc = this.doc;
    switch (it.kind) {
      case 'body':
        return !!doc.body(it.bodyId);
      case 'face':
      case 'edge':
      case 'vertex': {
        const b = doc.body(it.bodyId);
        return !!b && (!it.shapeId || it.shapeId === b.shapeId);
      }
      case 'region': {
        const sk = doc.sketch(it.sketchId);
        if (!sk) return false;
        const c = this.regionCache.get(it.sketchId);
        return !!c && c.key === this.sketchKey(sk) && (!it.regionKey || it.regionKey === c.key) && it.index < c.data.regions.length;
      }
      case 'curve': {
        const sk = doc.sketch(it.sketchId);
        return !!sk && sk.entities.some((e) => e.id === it.entityId);
      }
      case 'spoint':
      case 'sketch':
        return !!doc.sketch(it.sketchId);
      case 'constraint':
        return !!doc.sketch(it.sketchId)?.constraints?.some((c) => c.id === it.cid);
      case 'plane':
        return !!doc.plane(it.planeId);
      case 'axis':
        return !!doc.axis(it.axisId);
      case 'image':
        return !!doc.image(it.imageId);
      default:
        return true;
    }
  }

  // Selection item from a pick hit (stamped so it can be invalidated).
  selectionItem(hit) {
    const it = { ...hit };
    if (hit.kind !== 'spoint') delete it.point;
    delete it.world;
    delete it.normal;
    if (hit.kind === 'face' || hit.kind === 'edge' || hit.kind === 'vertex') it.shapeId = this.doc.body(hit.bodyId)?.shapeId;
    if (hit.kind === 'region') it.regionKey = this.regionCache.get(hit.sketchId)?.key;
    if (hit.kind === 'body' && hit.mesh) delete it.mesh;
    return it;
  }

  onSelectionChange() {
    this.refreshHighlights();
    this.tools.active?.onSelectionChange?.();
    this.context.render();
    this.updateMeasureInfo();
  }

  // ---- highlighting --------------------------------------------------------

  refreshHighlights() {
    const t = this.vp.theme;
    const bodyH = new Map();
    const sketchH = new Map();
    const planeH = new Map();
    const axisH = new Map();
    const imageH = new Map();
    const B = (id) => {
      if (!bodyH.has(id)) bodyH.set(id, { faces: new Map(), edges: new Map(), body: null });
      return bodyH.get(id);
    };
    const S = (id) => {
      if (!sketchH.has(id)) sketchH.set(id, { entities: new Map(), regions: new Map(), points: [] });
      return sketchH.get(id);
    };
    const mark = (it, color) => {
      if (!it) return;
      switch (it.kind) {
        case 'body':
          B(it.bodyId).body = color;
          break;
        case 'face':
          B(it.bodyId).faces.set(it.index, color);
          break;
        case 'edge':
          B(it.bodyId).edges.set(it.index, color);
          break;
        case 'region':
          S(it.sketchId).regions.set(it.index, color);
          break;
        case 'curve':
          S(it.sketchId).entities.set(it.entityId, color);
          break;
        case 'spoint':
          S(it.sketchId).points.push({ p: it.point, color });
          break;
        case 'sketch': {
          const sk = this.doc.sketch(it.sketchId);
          if (sk) for (const e of sk.entities) S(it.sketchId).entities.set(e.id, color);
          break;
        }
        case 'plane':
          planeH.set(it.planeId, color);
          break;
        case 'axis':
          axisH.set(it.axisId, color);
          break;
        case 'image':
          imageH.set(it.imageId, color);
          break;
        default:
      }
    };
    mark(this.selection.hover, t.hover);
    const toolHl = this.tools?.active ? this.tools.active.highlights() : [];
    const usesSelection = !toolHl.length || this.tools.isSelect;
    if (usesSelection) for (const it of this.selection.list) mark(it, t.select);
    for (const { item, color } of toolHl) mark(item, color);
    for (const [id, view] of this.vp.bodyViews) view.setHighlight(bodyH.get(id) || null);
    for (const [id, view] of this.vp.sketchViews) {
      const h = sketchH.get(id) || {};
      view.setHighlight(h);
    }
    for (const [id, view] of this.vp.planeViews) view.setHighlight(planeH.get(id) || null);
    for (const [id, view] of this.vp.axisViews) view.setHighlight(axisH.get(id) || null);
    for (const [id, view] of this.vp.imageViews) view.setHighlight(imageH.get(id) || null);
    this.constraints?.update();
    this.vp.requestRender();
  }

  // ---- geometry queries ----------------------------------------------------

  bodyMesh(bodyId) {
    const b = this.doc.body(bodyId);
    return b ? this.meshCache.get(b.shapeId) : null;
  }

  faceInfo(bodyId, index) {
    const m = this.bodyMesh(bodyId);
    return m && m.kind === 'solid' ? m.faceInfo[index] : null;
  }

  edgeInfo(bodyId, index) {
    const m = this.bodyMesh(bodyId);
    return m && m.kind === 'solid' ? m.edgeInfo[index] : null;
  }

  bodyBox(bodyId) {
    const m = this.bodyMesh(bodyId);
    if (!m?.bbox) return null;
    return new THREE.Box3(new THREE.Vector3(...m.bbox.min), new THREE.Vector3(...m.bbox.max));
  }

  itemBox(it) {
    if (it.kind === 'body') return this.bodyBox(it.bodyId);
    if (it.kind === 'sketch') {
      const v = this.vp.sketchViews.get(it.sketchId);
      return v ? new THREE.Box3().setFromObject(v.group) : null;
    }
    if (it.kind === 'plane' || it.kind === 'image') {
      const v = it.kind === 'plane' ? this.vp.planeViews.get(it.planeId) : this.vp.imageViews.get(it.imageId);
      return v ? new THREE.Box3().setFromObject(v.group) : null;
    }
    if (it.kind === 'axis') {
      const v = this.vp.axisViews.get(it.axisId);
      return v ? new THREE.Box3().setFromPoints(v.ends().map((p) => new THREE.Vector3(...p))) : null;
    }
    return null;
  }

  findSketchOnPlane(plane) {
    const sk = this.doc.sketches.find((s) => s.visible !== false && samePlane(s.plane, plane));
    return sk ? sk.id : null;
  }

  // Kernel reference for a profile item.
  profileRef(it) {
    if (it.kind === 'region') {
      const sk = this.doc.sketch(it.sketchId);
      return { type: 'region', sketchId: it.sketchId, index: it.index, normal: planeFrame(sk.plane).n };
    }
    const b = this.doc.body(it.bodyId);
    return { type: 'face', id: b.shapeId, face: it.index };
  }

  // Centre and direction for the extrude arrow, or null if `items` are not
  // all profiles facing the same way.
  profileAnchor(items) {
    if (!items.length) return null;
    let normal = null;
    const centers = [];
    for (const it of items) {
      let n;
      let c;
      if (it.kind === 'region') {
        const sk = this.doc.sketch(it.sketchId);
        const data = this.regionCache.get(it.sketchId)?.data;
        const r = data?.regions[it.index];
        if (!sk || !r) return null;
        n = planeFrame(sk.plane).n;
        c = r.centroid;
      } else if (it.kind === 'face') {
        const info = this.faceInfo(it.bodyId, it.index);
        if (!info || info.type !== 'plane') return null;
        n = info.normal;
        c = info.center;
      } else return null;
      if (normal && normal[0] * n[0] + normal[1] * n[1] + normal[2] * n[2] < 0.9999) return null;
      normal = n;
      centers.push(c);
    }
    const origin = [0, 1, 2].map((i) => centers.reduce((s, c) => s + c[i], 0) / centers.length);
    return { origin, normal };
  }

  // Body a profile sits on (sketch drawn on a face, or the face itself).
  profileSourceBody(items) {
    for (const it of items) {
      if (it.kind === 'face') return it.bodyId;
      if (it.kind === 'region') {
        const sk = this.doc.sketch(it.sketchId);
        if (sk?.sourceBody && this.doc.body(sk.sourceBody)) {
          // Make sure the sketch still lies on one of the body's faces.
          const m = this.bodyMesh(sk.sourceBody);
          if (m?.faceInfo?.some((f) => f.type === 'plane' && samePlane(sk.plane, { origin: f.center, normal: f.normal }))) return sk.sourceBody;
        }
      }
    }
    return null;
  }

  // Visible bodies whose bounding box overlaps the extruded profiles.
  overlappingBodies(items, d) {
    const anchor = this.profileAnchor(items);
    if (!anchor) return [];
    const box = new THREE.Box3();
    for (const it of items) {
      if (it.kind === 'region') {
        const r = this.regionCache.get(it.sketchId)?.data?.regions[it.index];
        if (r) for (let i = 0; i < r.positions.length; i += 3) box.expandByPoint(new THREE.Vector3(r.positions[i], r.positions[i + 1], r.positions[i + 2]));
      }
    }
    const moved = box.clone().translate(new THREE.Vector3(...anchor.normal).multiplyScalar(d));
    box.union(moved);
    return this.doc.bodies.filter((b) => b.visible !== false && this.bodyBox(b.id)?.intersectsBox(box)).map((b) => b.id);
  }

  // A straight axis from a sketch line or body edge. With circles: true,
  // circular edges give their centre axis.
  axisOf(it, { circles = false } = {}) {
    if (it.kind === 'axis') {
      const ax = this.doc.axis(it.axisId);
      return ax ? { origin: ax.origin, dir: ax.dir } : null;
    }
    if (it.kind === 'curve') {
      const sk = this.doc.sketch(it.sketchId);
      const en = sk?.entities.find((e) => e.id === it.entityId);
      if (!en) return null;
      const f = planeFrame(sk.plane);
      if (en.type === 'line') {
        const a = to3D(f, en.a);
        const b = to3D(f, en.b);
        const d = b.map((v, i) => v - a[i]);
        const l = Math.hypot(...d) || 1;
        return { origin: a, dir: d.map((v) => v / l) };
      }
      if (circles && (en.type === 'circle' || en.type === 'arc')) return { origin: to3D(f, en.c), dir: f.n };
      return null;
    }
    if (it.kind === 'edge') {
      const e = this.edgeInfo(it.bodyId, it.index);
      if (!e) return null;
      if (e.type === 'line') {
        const d = e.b.map((v, i) => v - e.a[i]);
        const l = Math.hypot(...d) || 1;
        return { origin: e.a, dir: d.map((v) => v / l) };
      }
      if (circles && e.type === 'circle') return { origin: e.center, dir: e.axisDir };
    }
    return null;
  }

  // 3D point of a pick: a body corner, a sketch point, or where a face was hit.
  pointOf(hit) {
    if (!hit) return null;
    if (hit.kind === 'vertex') {
      const v = this.bodyMesh(hit.bodyId)?.vertices;
      return v ? [v[hit.index * 3], v[hit.index * 3 + 1], v[hit.index * 3 + 2]] : null;
    }
    if (hit.kind === 'spoint') {
      const sk = this.doc.sketch(hit.sketchId);
      return sk ? to3D(planeFrame(sk.plane), hit.point) : null;
    }
    return hit.point ? [...hit.point] : null;
  }

  // Polyline (3D points) along a body edge or a sketch curve.
  curvePoints(it) {
    if (it.kind === 'curve') {
      const sk = this.doc.sketch(it.sketchId);
      const en = sk?.entities.find((e) => e.id === it.entityId);
      if (!en) return null;
      const f = planeFrame(sk.plane);
      return sampleEntity(en, 128).map((p) => to3D(f, p));
    }
    if (it.kind === 'edge') {
      const view = this.vp.bodyViews.get(it.bodyId);
      const seg = view?.data?.edgeSegments;
      if (!seg) return null;
      const out = [];
      for (const [start, count] of view.edgeSegRanges?.[it.index] || []) {
        for (let s = start; s < start + count; s++) {
          const a = [seg[s * 6], seg[s * 6 + 1], seg[s * 6 + 2]];
          if (!out.length) out.push(a);
          out.push([seg[s * 6 + 3], seg[s * 6 + 4], seg[s * 6 + 5]]);
        }
      }
      return out.length > 1 ? out : null;
    }
    if (it.kind === 'axis') {
      const v = this.vp.axisViews.get(it.axisId);
      return v ? v.ends() : null;
    }
    return null;
  }

  pathRef(it) {
    if (it.kind === 'edge') return { type: 'edge', id: this.doc.body(it.bodyId).shapeId, edge: it.index };
    if (it.kind === 'curve') {
      const sk = this.doc.sketch(it.sketchId);
      const en = sk?.entities.find((e) => e.id === it.entityId);
      return en ? { type: 'curve', plane: sk.plane, entity: en, sketchId: sk.id } : null;
    }
    return null;
  }

  // ---- snapping --------------------------------------------------------------

  // Snap a point (plane coords) to geometry, alignments and the grid.
  snapPoint(plane, p, e, { from = null, extra = [], sketchId = null, exclude = null } = {}) {
    const vp = this.vp;
    const f = planeFrame(plane);
    const scr = (q) => vp.worldToScreen(to3D(f, q));
    const near = (q, px) => {
      const s = scr(q);
      return s ? Math.hypot(s[0] - e.x, s[1] - e.y) <= px : false;
    };
    const screenDist = (q) => {
      const s = scr(q);
      return s ? Math.hypot(s[0] - e.x, s[1] - e.y) : Infinity;
    };
    if (!this.settings.snap || e.alt) return { p, snap: null };
    const use = { ...DEFAULT_SETTINGS.snapTo, ...this.settings.snapTo };
    // Candidate points.
    const cands = [];
    const sketches = this.doc.sketches.filter((s) => s.visible !== false && (s.id === sketchId || samePlane(s.plane, plane)));
    const ents = [];
    for (const sk of sketches) {
      const sf = planeFrame(sk.plane);
      for (const en of sk.entities) {
        ents.push({ en, sf });
        for (const kp of keyPoints(en)) {
          const q = sk.id === sketchId || sf === f ? kp.p : to2D(f, to3D(sf, kp.p));
          cands.push({ p: q, kind: kp.kind });
        }
      }
    }
    for (const q of extra) cands.push({ p: q, kind: 'end' });
    // Where two lines meet or cross.
    if (use.intersection) {
      const lines = ents.filter(({ en }) => en.type === 'line').slice(0, 300);
      const pt = ({ en, sf }, q) => (sf === f ? q : to2D(f, to3D(sf, q)));
      for (let i = 0; i < lines.length; i++) {
        const a0 = pt(lines[i], lines[i].en.a);
        const a1 = pt(lines[i], lines[i].en.b);
        for (let j = i + 1; j < lines.length; j++) {
          for (const x of intersect({ type: 'line', a: a0, b: a1 }, { type: 'line', a: pt(lines[j], lines[j].en.a), b: pt(lines[j], lines[j].en.b) })) cands.push({ p: x, kind: 'intersection' });
        }
      }
    }
    // Body vertices that lie on the plane.
    for (const view of vp.bodyViews.values()) {
      if (!use.vertex) break;
      if (!view.group.visible || view.data.kind !== 'solid') continue;
      const v = view.data.vertices;
      for (let i = 0; i < v.length; i += 3) {
        const P = [v[i], v[i + 1], v[i + 2]];
        const off = (P[0] - f.o[0]) * f.n[0] + (P[1] - f.o[1]) * f.n[1] + (P[2] - f.o[2]) * f.n[2];
        if (Math.abs(off) < 1e-4) cands.push({ p: to2D(f, P), kind: 'vertex' });
      }
    }
    const originOnPlane = Math.abs(f.o[0] * f.n[0] + f.o[1] * f.n[1] + f.o[2] * f.n[2]) < 1e-6;
    if (originOnPlane) cands.push({ p: to2D(f, [0, 0, 0]), kind: 'origin' });
    const GROUP = { end: 'end', point: 'end', origin: 'end', mid: 'mid', center: 'center', quadrant: 'center', intersection: 'intersection', vertex: 'vertex' };
    const valid = cands.filter((c) => (!exclude || dist(c.p, exclude) > 1e-9) && use[GROUP[c.kind] || 'end'] !== false);
    const LABELS = { end: 'Endpoint', mid: 'Midpoint', center: 'Center', quadrant: 'Quadrant', vertex: 'Vertex', origin: 'Origin', point: 'Point', intersection: 'Intersection' };
    const hint = (label) => (use.hints ? label : null);
    let best = null;
    for (const c of valid) {
      const d = screenDist(c.p);
      const r = c.kind === 'mid' || c.kind === 'quadrant' ? 8 : 11;
      if (d <= r && (!best || d < best.d)) best = { ...c, d };
    }
    if (best) return { p: best.p, snap: { kind: best.kind, label: hint(LABELS[best.kind]) } };

    const px = vp.rig.pixelSize(new THREE.Vector3(...to3D(f, p)), vp.height);
    const gs = this.gridStep(px * 14);
    // A grid point right under the cursor wins over alignments.
    const gridPoint = [Math.round(p[0] / gs) * gs, Math.round(p[1] / gs) * gs];
    if (use.grid && near(gridPoint, 4)) return { p: gridPoint, snap: { kind: 'grid' } };

    // Alignment with the previous point and other points (horizontal/vertical).
    let q = [...p];
    const guides = [];
    let label = null;
    const tol = px * 6;
    const refs = !use.guides ? [] : from ? [{ p: from }, ...valid.slice(0, 400)] : valid.slice(0, 400);
    let snappedX = false;
    let snappedY = false;
    for (const r of refs) {
      if (!snappedX && Math.abs(q[0] - r.p[0]) < tol) {
        q[0] = r.p[0];
        snappedX = true;
        guides.push([[r.p[0], r.p[1]], [q[0], q[1]]]);
        if (r === refs[0] && from) label = 'Vertical';
      }
      if (!snappedY && Math.abs(q[1] - r.p[1]) < tol) {
        q[1] = r.p[1];
        snappedY = true;
        guides.push([[r.p[0], r.p[1]], [q[0], q[1]]]);
        if (r === refs[0] && from) label = 'Horizontal';
      }
    }
    // Fix guide end points after both coordinates are known.
    for (const g of guides) g[1] = [...q];
    // On-curve snap.
    if (!snappedX && !snappedY && use.curve) {
      let bc = null;
      for (const { en, sf } of ents) {
        if (en.type === 'point') continue;
        const local = sf === f ? p : to2D(sf, to3D(f, p));
        const c = closestOnEntity(local, en);
        const cp = sf === f ? c.point : to2D(f, to3D(sf, c.point));
        const d = screenDist(cp);
        if (d < 7 && (!bc || d < bc.d)) bc = { p: cp, d };
      }
      if (bc) return { p: bc.p, snap: { kind: 'on', label: hint('On curve') } };
    }
    // Grid, for any coordinate that did not align with something.
    const g = [snappedX ? q[0] : Math.round(p[0] / gs) * gs, snappedY ? q[1] : Math.round(p[1] / gs) * gs];
    const onGrid = use.grid && near(g, 8);
    if (snappedX || snappedY) {
      if (onGrid) {
        q = g;
        for (const gd of guides) gd[1] = [...q];
      }
      return { p: q, snap: { kind: 'align', label: hint(label), guides } };
    }
    if (onGrid) return { p: g, snap: { kind: 'grid' } };
    return { p, snap: null };
  }

  // Snapped position for dragging a point of an existing sketch.
  snapSketchPoint(sketch, p, e, opts = {}) {
    return this.snapPoint(sketch.plane, p, e, { sketchId: sketch.id, ...opts }).p;
  }

  // Grid step in mm that matches the display unit.
  gridStep(mmStep) {
    if (this.settings.gridLock > 0) return this.settings.gridLock;
    const u = UNITS[this.units];
    return niceStep(mmStep / u.factor) * u.factor;
  }

  // ---- previews --------------------------------------------------------------

  showResultPreview(result, { mode } = {}) {
    this.clearResultPreview();
    const t = this.vp.theme;
    const ov = this.vp.overlay;
    const shapeToBody = new Map(this.doc.bodies.map((b) => [b.shapeId, b.id]));
    const hide = new Set();
    result.bodies.forEach((b, i) => {
      ov.body(`tool-prev-${i}`, b.mesh, { color: mode === 'subtract' ? t.previewCut : t.preview, opacity: 0.6 });
      if (b.replaces && shapeToBody.has(b.replaces)) hide.add(shapeToBody.get(b.replaces));
    });
    for (const sid of result.removed) if (shapeToBody.has(sid)) hide.add(shapeToBody.get(sid));
    for (const id of hide) {
      const v = this.vp.bodyViews.get(id);
      if (v && v.group.visible) {
        v.group.visible = false;
        this.previewHidden.push(v);
      }
    }
    this.vp.requestRender();
  }

  clearResultPreview() {
    this.vp.overlay.clear('tool-prev-');
    for (const v of this.previewHidden) v.group.visible = v.body.visible !== false;
    this.previewHidden = [];
    this.vp.requestRender();
  }

  // Show sketch entities without committing (while dragging).
  previewSketch(sketchId, entities) {
    const view = this.vp.sketchViews.get(sketchId);
    const sk = this.doc.sketch(sketchId);
    if (!view || !sk) return;
    view.update({ ...sk, entities }, null);
    this.vp.requestRender();
  }

  showPlaneOverlay(key, plane) {
    const ov = this.vp.overlay;
    ov.remove(key);
    if (!plane) return;
    const box = this.vp.contentBox();
    const size = box.isEmpty() ? 60 : box.getSize(new THREE.Vector3()).length() * 0.75;
    const n = new THREE.Vector3(...plane.normal).normalize();
    const helper = Math.abs(n.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const x = helper.clone().cross(n).normalize().multiplyScalar(size);
    const y = n.clone().cross(x).normalize().multiplyScalar(size);
    let c = new THREE.Vector3(...plane.origin);
    if (!box.isEmpty()) {
      const bc = box.getCenter(new THREE.Vector3());
      c = bc.clone().sub(n.clone().multiplyScalar(bc.clone().sub(c).dot(n)));
    }
    const corners = [c.clone().sub(x).sub(y), c.clone().add(x).sub(y), c.clone().add(x).add(y), c.clone().sub(x).add(y)].map((v) => v.toArray());
    ov.fill(key, corners.flat(), [0, 1, 2, 0, 2, 3], { color: this.vp.theme.preview, opacity: 0.15 });
    ov.lines(`${key}-outline`, [[...corners, corners[0]]], { color: this.vp.theme.preview, width: 1.2, dashed: true });
  }

  // ---- section view ---------------------------------------------------------

  setSection(state) {
    this.section = { ...this.section, ...state };
    if (!this.section.enabled) this.vp.setSection(null);
    else this.vp.setSection(this.section.origin, this.section.normal);
    document.querySelector('[data-vc="section"]')?.classList.toggle('on', !!this.section.enabled);
  }

  // ---- misc UI ---------------------------------------------------------------

  busy(on, text = 'Working…') {
    this.busyManual = on;
    document.getElementById('busy-text').textContent = t(text);
    this.onKernelBusy(on);
  }

  onKernelBusy(b) {
    clearTimeout(this.busyTimer);
    const el = document.getElementById('busy');
    if (b || this.busyManual) this.busyTimer = setTimeout(() => (el.hidden = false), 350);
    else {
      el.hidden = true;
      document.getElementById('busy-text').textContent = t('Working…');
    }
  }

  updateTitle() {
    const name = this.files.name;
    document.getElementById('doc-name').textContent = name;
    document.getElementById('doc-dirty').hidden = !this.doc.dirty;
    document.getElementById('btn-undo').disabled = !this.doc.canUndo;
    document.getElementById('btn-redo').disabled = !this.doc.canRedo;
    window.native?.setTitle(`${name}${this.doc.dirty ? ' •' : ''} — ShaperBuild`);
    window.native?.setDirty(this.doc.dirty);
    const sel = document.getElementById('unit-select');
    if (sel && sel.value !== this.units) sel.value = this.units;
    this.vp.unitFactor = UNITS[this.units]?.factor || 1;
    this.vp.requestRender();
  }

  scheduleGC() {
    clearTimeout(this.gcTimer);
    this.gcTimer = setTimeout(() => {
      if (!this.tools.isSelect) return this.scheduleGC();
      const keep = new Set(this.doc.referencedShapes());
      for (const id of this.tools.active?.heldShapes() || []) keep.add(id);
      for (const id of this.history.heldShapes()) keep.add(id);
      if (this.history.busy) return this.scheduleGC();
      for (const id of this.meshCache.keys()) if (!keep.has(id)) this.meshCache.delete(id);
      this.kernel.call('retainOnly', [...keep]).catch(() => {});
    }, 4000);
  }

  async updateMeasureInfo() {
    const info = document.getElementById('status-info');
    const items = this.selection.list;
    const token = (this.measureToken = (this.measureToken || 0) + 1);
    if (!items.length || items.length > 2) {
      info.textContent = items.length ? t('{n} selected', { n: items.length }) : '';
      return;
    }
    const kitems = [];
    for (const it of items) {
      const b = it.bodyId ? this.doc.body(it.bodyId) : null;
      if ((it.kind === 'face' || it.kind === 'edge' || it.kind === 'body') && b) kitems.push({ kind: it.kind, id: b.shapeId, index: it.index });
    }
    if (kitems.length !== items.length) {
      const it = items[0];
      if (items.length === 1 && it.kind === 'curve') {
        const sk = this.doc.sketch(it.sketchId);
        const en = sk?.entities.find((e) => e.id === it.entityId);
        if (en?.type === 'line') info.textContent = `${t('Line')} · ${formatLength(dist(en.a, en.b), this.units)}`;
        else if (en?.type === 'circle') info.textContent = `${t('Circle')} · ⌀ ${formatLength(en.r * 2, this.units)}`;
        else if (en?.type === 'arc') info.textContent = `${t('Arc')} · R ${formatLength(en.r, this.units)}`;
        else info.textContent = en ? t(en.type[0].toUpperCase() + en.type.slice(1)) : '';
      } else if (items.length === 1 && it.kind === 'region') {
        const r = this.regionCache.get(it.sketchId)?.data?.regions[it.index];
        info.textContent = r ? `${t('Region')} · ${formatArea(r.area, this.units)}` : '';
      } else info.textContent = t('{n} selected', { n: items.length });
      return;
    }
    try {
      const res = await this.kernel.call('measure', { items: kitems });
      if (token !== this.measureToken) return;
      const u = this.units;
      const parts = res.items.map((r) => {
        if (r.kind === 'body') return `${t('Volume')} ${formatVolume(r.volume, u)}`;
        if (r.kind === 'face') return `${t('Area')} ${formatArea(r.area, u)}${r.radius ? ` · R ${formatLength(r.radius, u)}` : ''}`;
        if (r.kind === 'edge') return `${t('Length')} ${formatLength(r.length, u)}${r.radius ? ` · R ${formatLength(r.radius, u)}` : ''}`;
        return '';
      });
      if (res.pair?.distance !== undefined) parts.push(`${t('Distance')} ${formatLength(res.pair.distance, u)}`);
      if (res.pair?.angle !== undefined) parts.push(`${t('Angle')} ${formatAngle(res.pair.angle)}`);
      info.textContent = items.length === 2 && res.pair ? parts.slice(-2).join(' · ') : parts.join(' · ');
    } catch {
      info.textContent = '';
    }
  }

  contextMenu(e) {
    const hit = e.pick(['face', 'edge', 'body', 'region', 'curve']);
    const sel = this.selection;
    if (hit) {
      const it = this.selectionItem(hit);
      if (!sel.has(it)) sel.set([it]);
    }
    const items = [];
    const list = sel.list;
    const bodies = [...new Set(list.map((it) => it.bodyId).filter(Boolean))];
    const ne = e.native;
    // Faces hidden behind the one under the pointer can be picked too.
    if (this.vp.hitsUnder(e.x, e.y).length > 1) items.push({ label: 'Select through…', icon: 'select', kbd: this.keyFor('select-through'), action: () => this.selectThrough({ x: e.x, y: e.y }) });
    if (list.length) {
      const suggestions = this.context.suggestions();
      for (const s of suggestions.slice(0, 6)) items.push({ label: s.label, icon: s.icon, action: s.action });
      if (items.length) items.push('-');
      if (bodies.length) {
        items.push({ label: 'Hide', icon: 'eyeOff', action: () => bodies.forEach((id) => this.cmd.setVisible('body', id, false)) });
        items.push({ label: 'Duplicate', icon: 'duplicate', kbd: 'Ctrl+D', action: () => this.cmd.duplicate(bodies) });
      }
      const faces = list.filter((it) => it.kind === 'face');
      if (faces.length === 1) {
        const info = this.faceInfo(faces[0].bodyId, faces[0].index);
        if (info?.type === 'plane') items.push({ label: 'Look at face', icon: 'lookAt', action: () => this.vp.lookAtPlane({ origin: info.center, normal: info.normal }) });
      }
      if (bodies.length || list.some((it) => it.sketchId)) items.push({ label: 'Show in Items', icon: 'items', action: () => this.revealInItems() });
      items.push({ label: this.isolated ? 'Show all (end isolate)' : 'Isolate', icon: 'isolate', kbd: this.keyFor('toggle-isolate'), action: () => this.toggleIsolate() });
      items.push({ label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: () => this.cmd.deleteSelection() });
    } else {
      items.push({ label: 'Zoom to fit', icon: 'fit', kbd: 'Z', action: () => this.vp.fit() });
      items.push({ label: 'Show all', icon: 'eye', action: () => (this.isolated ? this.toggleIsolate() : this.cmd.showAll()) });
    }
    showMenu(ne.clientX, ne.clientY, items);
  }

  // ---- top bar, status bar, view controls ----------------------------------

  setupChrome() {
    const $ = (id) => document.getElementById(id);
    $('btn-home').innerHTML = icon('logo');
    $('btn-items').innerHTML = icon('items');
    $('btn-help').innerHTML = icon('help');
    $('btn-items').addEventListener('click', () => this.toggleItems());
    $('btn-help').addEventListener('click', (e) => this.helpMenu(e));
    $('btn-undo').innerHTML = icon('undo');
    $('btn-redo').innerHTML = icon('redo');
    $('btn-settings').innerHTML = icon('settings');
    $('btn-import').querySelector('.ic').innerHTML = icon('import');
    $('btn-export').querySelector('.ic').innerHTML = icon('export');
    $('btn-print').querySelector('.ic').innerHTML = icon('printer');
    $('btn-print').addEventListener('click', () => this.print.open());
    $('btn-home').addEventListener('click', () => this.home.show());
    $('btn-undo').addEventListener('click', () => this.cmd.undo());
    $('btn-redo').addEventListener('click', () => this.cmd.redo());
    $('btn-settings').addEventListener('click', () => this.dialogs.settings());
    $('btn-import').addEventListener('click', () => this.files.importDialog());
    $('btn-export').addEventListener('click', (e) => this.dialogs.exportMenu(e));
    $('doc-title').addEventListener('click', () => this.renameDesign());
    for (const b of document.querySelectorAll('#mode-seg button')) {
      b.addEventListener('click', () => this.setVisualization(b.dataset.mode === 'visual'));
    }
    const unitSel = $('unit-select');
    for (const [k, u] of Object.entries(UNITS)) unitSel.append(new Option(u.label, k));
    unitSel.value = this.units;
    unitSel.addEventListener('change', () => this.cmd.setUnits(unitSel.value));
    const snapBtn = $('btn-snap');
    snapBtn.classList.toggle('on', this.settings.snap);
    snapBtn.addEventListener('click', () => this.toggleSnap());
    snapBtn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.snapMenu(snapBtn);
    });
    $('btn-snap-more').addEventListener('click', (e) => this.snapMenu(e.currentTarget));
    // Grid size (changes with zoom); click to lock it at this size.
    const gridBtn = $('btn-grid-size');
    this.vp.grid.locked = this.settings.gridLock || null;
    const showGrid = (step) => {
      gridBtn.textContent = `${t('Grid')} ${formatLength(step, this.units)}${this.settings.gridLock ? ' 🔒' : ''}`;
      gridBtn.classList.toggle('on', !!this.settings.gridLock);
    };
    this.vp.on('gridstep', showGrid);
    this.vp.on('doubletap', () => this.onDoubleTap());
    showGrid(this.vp.grid.step);
    gridBtn.addEventListener('click', () => {
      this.settings.gridLock = this.settings.gridLock ? null : this.vp.grid.step;
      this.vp.grid.locked = this.settings.gridLock;
      this.saveSettings();
      showGrid(this.vp.grid.step);
      toast(this.settings.gridLock ? 'Grid size locked' : 'Grid size follows the zoom', { ms: 1200 });
    });
    const filterSel = $('filter-select');
    for (const [k, label] of SELECT_FILTERS) filterSel.append(new Option(t(label), k));
    filterSel.value = this.settings.selectFilter;
    filterSel.addEventListener('change', () => this.setSelectFilter(filterSel.value));

    this.viewControls = new ViewControls($('view-controls'), this);
    $('isolate-show-all').addEventListener('click', () => this.isolated && this.toggleIsolate());
    this.toolHint = new ToolHint($('tool-hint'), this);
  }

  helpMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const m = modKey();
    showMenu(r.left, r.bottom + 6, [
      { label: 'Tutorials…', icon: 'learn', action: () => this.tutorial.library() },
      { label: 'How to move around', icon: 'mouse', action: () => this.navHelp.toggle(true) },
      { label: 'Find a tool', icon: 'search', kbd: `${m}K`, action: () => this.toolsMenu.focusSearch() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: `${m}/`, action: () => this.dialogs.shortcuts() },
      { label: 'Getting started', icon: 'help', action: () => this.dialogs.gettingStarted() },
      '-',
      { label: 'Open-source licences', icon: 'file', action: () => this.dialogs.licences() },
      { label: 'Privacy', icon: 'eye', action: () => this.dialogs.privacy() },
      { label: 'About ShaperBuild', icon: 'logo', action: () => this.dialogs.about() },
    ]);
  }

  renameDesign() {
    const title = document.getElementById('doc-title');
    if (title.querySelector('input')) return;
    const span = document.getElementById('doc-name');
    const inp = document.createElement('input');
    inp.value = this.files.name;
    span.hidden = true;
    title.prepend(inp);
    inp.focus();
    inp.select();
    const done = (save) => {
      if (!inp.isConnected) return;
      if (save && inp.value.trim()) this.files.rename(inp.value.trim());
      inp.remove();
      span.hidden = false;
      this.updateTitle();
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    inp.addEventListener('blur', () => done(true));
  }

  setVisualization(on) {
    this.visual = on;
    for (const b of document.querySelectorAll('#mode-seg button')) b.classList.toggle('on', (b.dataset.mode === 'visual') === on);
    if (on) this.tools.activate('select');
    document.getElementById('tools').style.display = on ? 'none' : '';
    this.materials.show(on);
    this.vp.setVisualization(on);
    this.applyIsolation();
    setTimeout(() => this.vp.resize(), 30);
    this.refreshHighlights();
    this.starter?.update();
  }

  toggleOrtho() {
    this.vp.setOrtho(!this.vp.rig.useOrtho);
    this.viewControls.setOrtho(this.vp.rig.useOrtho);
    toast(this.vp.rig.useOrtho ? 'Orthographic view' : 'Perspective view', { ms: 1000 });
  }

  toggleGrid() {
    this.settings.showGrid = !this.settings.showGrid;
    this.saveSettings();
    this.applyViewSettings();
    document.querySelector('[data-vc="grid"]').classList.toggle('on', this.settings.showGrid);
  }

  toggleXray() {
    const on = !this.vp.xray;
    this.vp.setXray(on);
    this.viewControls.btns.xray.classList.toggle('on', on);
    toast(on ? 'X-ray on: bodies are see-through' : 'X-ray off', { ms: 1200 });
  }

  // ---- display modes, isolate, saved views, pins -------------------------

  setDisplay(mode, { hiddenEdges = this.vp.hiddenEdges } = {}) {
    this.vp.setDisplay(mode, hiddenEdges);
    this.viewControls?.btns.display?.classList.toggle('on', mode !== 'shaded' || !!hiddenEdges);
  }

  displayMenu(anchor) {
    const vp = this.vp;
    const r = anchor.getBoundingClientRect();
    const mode = vp.display || 'shaded';
    const pick = (value, label, desc) => ({ label: `${mode === value ? '● ' : '○ '}${t(label)}`, raw: true, action: () => this.setDisplay(value), desc });
    const check = (on, label, change) => {
      const cb = h('input', { type: 'checkbox', checked: !!on });
      cb.addEventListener('change', () => change(cb.checked));
      return { custom: h('label.menu-check', cb, h('span', { text: label })) };
    };
    const menu = showMenu(r.left, r.top, [
      { custom: h('div.menu-title', { text: 'Display' }) },
      pick('shaded', 'Shaded'),
      pick('wireframe', 'Wireframe (edges only)'),
      pick('zebra', 'Zebra stripes (check smoothness)'),
      '-',
      check(vp.hiddenEdges, 'Show hidden edges', (on) => this.setDisplay(vp.display || 'shaded', { hiddenEdges: on })),
      check(this.settings.showEdges, 'Show edges', () => this.onMenu('toggle-edges')),
      check(vp.xray, 'X-ray', () => this.toggleXray()),
    ]);
    const mr = menu.getBoundingClientRect();
    menu.style.left = `${r.left - mr.width - 8}px`;
  }

  // Isolate: show only the selected items (and their steps in History).
  toggleIsolate() {
    if (this.isolated) {
      this.isolated = null;
    } else {
      const keep = new Map();
      for (const it of this.selection.list) {
        const k = it.bodyId ? `body:${it.bodyId}` : it.sketchId ? `sketch:${it.sketchId}` : it.planeId ? `plane:${it.planeId}` : it.axisId ? `axis:${it.axisId}` : it.imageId ? `image:${it.imageId}` : null;
        if (k) keep.set(k, it.bodyId ? { kind: 'body', bodyId: it.bodyId } : it.sketchId ? { kind: 'sketch', sketchId: it.sketchId } : it);
      }
      if (!keep.size) return toast('Select what to isolate first', { ms: 1600 });
      this.isolated = keep;
      this.vp.fit(this.selectionBox());
    }
    this.viewControls?.btns.isolate?.classList.toggle('on', !!this.isolated);
    document.getElementById('isolate-bar')?.toggleAttribute('hidden', !this.isolated);
    this.syncView();
    this.items?.render();
  }

  // Hide what isolate leaves out (after the views are in step). After
  // isolate ends, everything gets its own visibility back once.
  applyIsolation() {
    const keep = this.isolated;
    if (!keep && !this.wasIsolated) return;
    this.wasIsolated = !!keep;
    const show = (key, view, visible, inVisual = false) => {
      const on = visible !== false && (!keep || keep.has(key)) && (inVisual || !this.visual);
      view.group.visible = on;
      if (view.pickGroup) view.pickGroup.visible = on;
    };
    for (const [id, v] of this.vp.bodyViews) show(`body:${id}`, v, this.doc.body(id)?.visible, true);
    for (const [id, v] of this.vp.sketchViews) show(`sketch:${id}`, v, this.doc.sketch(id)?.visible);
    for (const [id, v] of this.vp.planeViews) show(`plane:${id}`, v, this.doc.plane(id)?.visible);
    for (const [id, v] of this.vp.axisViews) show(`axis:${id}`, v, this.doc.axis(id)?.visible);
    for (const [id, v] of this.vp.imageViews) show(`image:${id}`, v, this.doc.image(id)?.visible);
    this.vp.requestRender();
  }

  // Saved views: the camera and the section, by name.
  async saveView() {
    const input = h('input', { type: 'text', value: t('View {n}', { n: (this.doc.state.views || []).length + 1 }) });
    const ok = await modal({ title: 'Save this view', body: h('div.form-row', h('label', { text: 'Name' }), input), buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
    if (!ok || !input.value.trim()) return;
    const view = { name: input.value.trim(), camera: this.vp.rig.toJSON(), section: { ...this.section } };
    this.doc.apply('Save view', (d) => {
      d.views = [...(d.views || []), { id: d.nextId('view'), ...view }];
    });
    toast(t('Saved view "{name}"', { name: view.name }), { ms: 1600 });
  }

  showSavedView(id) {
    const v = (this.doc.state.views || []).find((x) => x.id === id);
    if (!v) return;
    const c = v.camera;
    const ortho = !!c.ortho;
    this.vp.rig.animateTo({ az: c.az, el: c.el, dist: c.dist, target: new THREE.Vector3(...c.target) });
    if (ortho !== this.vp.rig.useOrtho) {
      this.vp.setOrtho(ortho);
      this.viewControls.setOrtho(ortho);
    }
    this.vp.requestRender();
    if (v.section) this.setSection({ ...v.section });
  }

  deleteSavedView(id) {
    this.doc.apply('Delete view', (d) => {
      d.views = (d.views || []).filter((x) => x.id !== id);
    });
  }

  // Pinned measurements stay on screen until cleared.
  pinMeasurement(pin) {
    this.pins = [...(this.pins || []), pin];
    this.drawPins();
  }

  clearPins() {
    this.pins = [];
    this.drawPins();
  }

  drawPins() {
    const ov = this.vp.overlay;
    ov.clear('pin');
    (this.pins || []).forEach((p, i) => {
      ov.lines(`pin-line-${i}`, [[p.p1, p.p2]], { color: this.vp.theme.inference, width: 2, depthTest: false });
      ov.dots(`pin-ends-${i}`, [p.p1, p.p2], { color: this.vp.theme.inference, size: 7 });
      ov.label(`pin-label-${i}`, p.p1.map((v, k) => (v + p.p2[k]) / 2), p.text, { className: 'accent' });
    });
    this.vp.requestRender();
  }

  toggleSnap() {
    this.settings.snap = !this.settings.snap;
    this.saveSettings();
    document.getElementById('btn-snap').classList.toggle('on', this.settings.snap);
    // Tools that set up snapping when they start (the Move gizmo) follow at once.
    this.tools.active?.onSnapChange?.();
    toast(this.settings.snap ? 'Snapping on' : 'Snapping off (hold Alt to skip snapping)', { ms: 1200 });
  }

  // What snapping uses: ticks that keep the menu open.
  snapMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const use = (this.settings.snapTo = { ...DEFAULT_SETTINGS.snapTo, ...this.settings.snapTo });
    const row = (key, label) => {
      const cb = h('input', { type: 'checkbox', checked: use[key] !== false });
      cb.addEventListener('change', () => {
        use[key] = cb.checked;
        this.saveSettings();
      });
      return { custom: h('label.menu-check', cb, h('span', { text: label })) };
    };
    const menu = showMenu(r.left, r.top, [
      { custom: h('div.menu-title', { text: 'Snap to' }) },
      row('end', 'Endpoints'),
      row('mid', 'Midpoints'),
      row('center', 'Centers'),
      row('intersection', 'Intersections'),
      row('vertex', 'Body corners'),
      row('curve', 'Points on curves'),
      row('guides', 'Alignment guides'),
      row('grid', 'Grid'),
      '-',
      row('hints', 'Show what it snaps to'),
    ]);
    menu.style.top = `${r.top - menu.getBoundingClientRect().height - 6}px`;
  }

  toggleSection() {
    if (this.section.enabled && !(this.tools.activeId === 'section')) this.setSection({ enabled: false });
    else this.tools.activate('section');
  }

  // Show the History tab (or go back to Items if it is already showing).
  showHistory() {
    const el = document.getElementById('items');
    if (el.classList.contains('collapsed')) this.toggleItems();
    else if (this.items.tab === 'history') return this.items.setTab('items');
    this.items.setTab('history');
  }

  toggleItems() {
    const collapsed = document.getElementById('items').classList.toggle('collapsed');
    document.getElementById('btn-items').classList.toggle('on', !collapsed);
    setTimeout(() => this.vp.resize(), 200);
  }

  toggleToolLabels() {
    this.settings.toolLabels = this.settings.toolLabels === false;
    this.saveSettings();
    this.toolsMenu.setLabels(this.settings.toolLabels);
    setTimeout(() => this.vp.resize(), 50);
  }

  toggleTheme() {
    this.settings.theme = this.settings.theme === 'dark' ? 'light' : 'dark';
    this.saveSettings();
    document.body.className = `theme-${this.settings.theme}`;
    this.vp.setTheme(this.settings.theme);
    this.refreshHighlights();
    this.items.render();
  }

  // ---- keyboard --------------------------------------------------------------

  // The keys in use (Settings > Keyboard shortcuts can change them).
  reloadKeymap() {
    const k = this.settings.keymap || {};
    this.keymap = buildKeymap(k.preset, k.keys);
    this.toolsMenu?.render();
  }

  // The key for an action, like tool:extrude or view-top (for menus and tips).
  keyFor(action) {
    return this.keymap?.keys[action] || '';
  }

  setupKeys() {
    this.reloadKeymap();
    window.addEventListener('keydown', (e) => {
      if (!this.ready) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (!this.home.el.hidden) return;
      const typing = isTyping();
      const mod = e.ctrlKey || e.metaKey;
      const combo = comboOf(e);
      const action = combo && this.keymap.byCombo.get(combo);
      // Shortcuts with Ctrl that the chosen set gives to an action.
      if (action && mod && !typing) {
        e.preventDefault();
        this.runAction(action);
        return;
      }
      // Menu shortcuts (the native menu only displays them).
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        const map = {
          z: e.shiftKey ? 'redo' : 'undo',
          y: 'redo',
          s: e.shiftKey ? 'save-as' : 'save',
          o: 'open',
          n: 'new',
          i: 'import',
          e: 'export-stl',
          d: 'duplicate',
          w: 'close-design',
          ',': 'settings',
          '/': 'shortcuts',
          k: 'find-tool',
          p: 'print',
        };
        const textEdit = typing && (k === 'z' || k === 'y');
        if (map[k] && !textEdit) {
          e.preventDefault();
          this.onMenu(map[k]);
          return;
        }
      }
      if (typing) return;
      // Hold Space and drag to orbit (Shift+Space to pan); a quick tap over
      // a face looks straight at it.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          document.activeElement?.blur?.();
          this.vp.setSpaceHeld(true);
          this.spaceTap = { at: performance.now(), view: this.vp.rig.toJSON() };
        }
        return;
      }
      // Esc first closes the navigation card and leaves orbit/pan mode.
      if (e.key === 'Escape' && (this.navHelp.open || this.vp.navMode)) {
        if (this.navHelp.open) this.navHelp.close();
        else this.vp.setNavMode(null);
        return;
      }
      const ev = { key: e.key, shift: e.shiftKey, ctrl: mod, alt: e.altKey, native: e };
      if (this.tools.active?.onKeyDown(ev)) {
        e.preventDefault();
        return;
      }
      if (action) {
        e.preventDefault();
        this.runAction(action);
        return;
      }
      if (mod) {
        if (e.key.toLowerCase() === 'a' && !e.shiftKey) {
          e.preventDefault();
          this.cmd.selectAll();
        }
        return;
      }
      const k = e.key;
      if (k === 'Escape') {
        hideTooltip();
        if (!this.tools.isSelect) this.tools.cancel();
        else this.selection.clear();
        return;
      }
      // Arrow keys orbit, Shift+arrows pan, + and - zoom.
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (arrows[k]) {
        e.preventDefault();
        const [ax, ay] = arrows[k];
        if (e.shiftKey) this.vp.stepPan(-ax * 0.12, ay * 0.12);
        else this.vp.stepOrbit((-ax * Math.PI) / 12, (ay * Math.PI) / 12);
        return;
      }
      if (k === '+' || k === '=') return this.vp.stepZoom(1 / 1.25);
      if (k === '-' || k === '_') return this.vp.stepZoom(1.25);
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        this.cmd.deleteSelection();
        return;
      }
      if (k === 'Tab') e.preventDefault();
      if (k.toLowerCase() === 'home') return this.vp.fit(this.selectionBox());
    });
    const release = () => {
      this.vp.setSpaceHeld(false);
      // A tap (no drag, short) over a face: look straight at it.
      const tap = this.spaceTap;
      this.spaceTap = null;
      if (tap && performance.now() - tap.at < 250 && JSON.stringify(this.vp.rig.toJSON()) === JSON.stringify(tap.view)) this.lookAtPointer();
    };
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.code === 'Space') release();
    });
    window.addEventListener('blur', () => {
      this.spaceTap = null;
      this.vp.setSpaceHeld(false);
    });
  }

  runAction(action) {
    hideTooltip();
    if (action.startsWith('tool:')) {
      if (!this.visual) this.tools.activate(action.slice(5));
      return;
    }
    if (action.startsWith('view-') && action !== 'view-fit' && action !== 'view-normal') return this.vp.setView(action.slice(5));
    if (action.startsWith('filter-')) {
      if (action === 'filter-cycle') {
        const ids = SELECT_FILTERS.map((f) => f[0]);
        return this.setSelectFilter(ids[(ids.indexOf(this.settings.selectFilter) + 1) % ids.length]);
      }
      return this.setSelectFilter(action.slice(7));
    }
    if (action.startsWith('constrain-')) return this.constraints.shortcut(action.slice(10));
    switch (action) {
      case 'view-fit':
        return this.vp.fit(this.selectionBox());
      case 'toggle-snap':
        return this.toggleSnap();
      case 'select-through':
        return this.selectThrough();
      default:
        return this.onMenu(action);
    }
  }

  setSelectFilter(f) {
    if (!SELECT_FILTERS.some(([k]) => k === f)) return;
    this.settings.selectFilter = f;
    this.saveSettings();
    const sel = document.getElementById('filter-select');
    if (sel) sel.value = f;
    toast(SELECT_FILTERS.find(([k]) => k === f)[1], { ms: 1000 });
  }

  // Everything under the pointer, also behind other faces: pick one.
  selectThrough(at = this.vp.pointer) {
    if (!at) return;
    const hits = this.vp.hitsUnder(at.x, at.y);
    if (!hits.length) return toast('Nothing under the pointer', { ms: 1200 });
    const r = this.vp.canvas.getBoundingClientRect();
    const name = (id) => this.doc.body(id)?.name || '';
    showMenu(
      r.left + at.x,
      r.top + at.y,
      hits.slice(0, 16).map((hit, i) => {
        const info = hit.kind === 'face' ? this.faceInfo(hit.bodyId, hit.index) : null;
        const what = hit.kind === 'face' ? `${t('Face')}${info ? ` (${t(info.type)})` : ''}` : t('Mesh');
        return {
          label: `${i + 1}. ${name(hit.bodyId)} · ${what}`,
          raw: true,
          icon: hit.kind === 'face' ? 'solid' : 'mesh',
          action: () => this.selection.set([hit.kind === 'face' ? { kind: 'face', bodyId: hit.bodyId, index: hit.index } : { kind: 'body', bodyId: hit.bodyId }]),
        };
      }),
    );
  }

  // Open Items and scroll to the selected item.
  revealInItems() {
    if (document.getElementById('items').classList.contains('collapsed')) this.toggleItems();
    this.items.query = '';
    this.items.setTab('items');
    this.items.render();
    this.items.el.querySelector('.item.selected')?.scrollIntoView({ block: 'center' });
  }

  // Look straight at the face under the pointer.
  // Double tap (touch): look straight at the flat face under the finger.
  onDoubleTap() {
    const at = this.vp.pointer;
    const hit = at && this.vp.hitsUnder(at.x, at.y)[0];
    if (hit?.kind === 'face') this.lookAtPointer();
    else this.vp.fit(this.selectionBox());
  }

  lookAtPointer() {
    const at = this.vp.pointer;
    const hit = at && this.vp.hitsUnder(at.x, at.y)[0];
    if (!hit || hit.kind !== 'face') return;
    const info = this.faceInfo(hit.bodyId, hit.index);
    if (info?.type === 'plane') this.vp.lookAtPlane({ origin: info.center, normal: info.normal });
  }

  selectionBox() {
    const box = new THREE.Box3();
    for (const it of this.selection.list) {
      const b = it.bodyId ? this.bodyBox(it.bodyId) : this.itemBox(it);
      if (b) box.union(b);
    }
    return box.isEmpty() ? null : box;
  }

  lookAtSelection() {
    const it = this.selection.list[0];
    if (it?.kind === 'face') {
      const info = this.faceInfo(it.bodyId, it.index);
      if (info?.type === 'plane') return this.vp.lookAtPlane({ origin: info.center, normal: info.normal });
    }
    const sk = it?.sketchId ? this.doc.sketch(it.sketchId) : null;
    if (sk) return this.vp.lookAtPlane(sk.plane);
    const pl = it?.kind === 'plane' ? this.doc.plane(it.planeId) : it?.kind === 'image' ? this.doc.image(it.imageId) : null;
    if (pl) return this.vp.lookAtPlane(pl.plane);
    const tp = this.tools.active?.plane;
    if (tp) return this.vp.lookAtPlane(tp);
    toast('Select a flat face or sketch to look at', { ms: 1600 });
  }

  // ---- drag & drop -----------------------------------------------------------

  setupDrop() {
    let hint = null;
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'drop-hint';
        hint.textContent = t('Drop STL, OBJ, 3MF, STEP, DXF or ShaperBuild files to open them');
        document.body.append(hint);
      }
    });
    const end = () => {
      hint?.remove();
      hint = null;
    };
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) end();
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      end();
      const files = [...(e.dataTransfer?.files || [])];
      for (const f of files) {
        const data = new Uint8Array(await f.arrayBuffer());
        await this.files.openData(f.name, data, f.path || null);
      }
    });
  }

  // ---- native menu -------------------------------------------------------------

  onMenu(cmd, arg) {
    if (!this.ready) return;
    const typing = isTyping();
    switch (cmd) {
      case 'new':
        return this.files.newDesign();
      case 'open':
        return this.files.openDialog();
      case 'open-path':
        return this.files.openPath(arg);
      case 'clear-recent':
        return window.native?.clearRecent();
      case 'save':
        return this.files.save();
      case 'save-as':
        return this.files.save({ as: true });
      case 'save-and-close':
        return this.files.save().then((ok) => ok && window.native?.closeConfirmed());
      case 'import':
        return this.files.importDialog();
      case 'print':
        return this.print.open();
      case 'export-stl':
        return this.files.exportDialog('stl');
      case 'export-3mf':
        return this.files.exportDialog('3mf');
      case 'export-obj':
        return this.files.exportDialog('obj');
      case 'export-step':
        return this.files.exportDialog('step');
      case 'versions':
        return this.files.showVersions();
      case 'export-glb':
        return this.files.exportDialog('glb');
      case 'export-usdz':
        return this.files.exportDialog('usdz');
      case 'export-dxf':
        return this.files.exportDXF();
      case 'drawing':
        return this.drawing.open();
      case 'export-png':
        return this.dialogs.screenshot();
      case 'close-design':
        return this.files.closeDesign();
      case 'undo':
        if (typing) return document.execCommand('undo');
        return this.cmd.undo();
      case 'redo':
        if (typing) return document.execCommand('redo');
        return this.cmd.redo();
      case 'duplicate':
        return this.cmd.duplicate();
      case 'delete':
        return typing ? null : this.cmd.deleteSelection();
      case 'select-all':
        return typing ? document.execCommand('selectAll') : this.cmd.selectAll();
      case 'deselect':
        return this.selection.clear();
      case 'view-fit':
        return this.vp.fit();
      case 'view-normal':
        return this.lookAtSelection();
      case 'toggle-ortho':
        return this.toggleOrtho();
      case 'toggle-visualization':
        return this.setVisualization(!this.visual);
      case 'toggle-section':
        return this.toggleSection();
      case 'toggle-grid':
        return this.toggleGrid();
      case 'toggle-xray':
        return this.toggleXray();
      case 'toggle-isolate':
        return this.toggleIsolate();
      case 'toggle-edges':
        this.settings.showEdges = !this.settings.showEdges;
        this.saveSettings();
        return this.applyViewSettings();
      case 'toggle-theme':
        return this.toggleTheme();
      case 'show-history':
        return this.showHistory();
      case 'toggle-items':
        return this.toggleItems();
      case 'settings':
        return this.dialogs.settings();
      case 'shortcuts':
        return this.dialogs.shortcuts();
      case 'getting-started':
        return this.dialogs.gettingStarted();
      case 'check-updates':
        return this.updates.check(true);
      case 'tutorial':
        return this.tutorial.library();
      case 'navigation-help':
        return this.navHelp.toggle(true);
      case 'find-tool':
        return this.toolsMenu.focusSearch();
      case 'toggle-tool-labels':
        return this.toggleToolLabels();
      case 'about':
        return this.dialogs.about();
      case 'licences':
        return this.dialogs.licences();
      case 'privacy':
        return this.dialogs.privacy();
      default:
        if (cmd.startsWith('view-')) return this.vp.setView(cmd.slice(5));
    }
  }
}

// Hints for the current tool: in the view while a tool is active, in the
// status bar otherwise.
class Status {
  constructor(app) {
    this.app = app;
  }

  hint(html) {
    html = t(html);
    const inView = this.app.toolHint?.set(html);
    document.getElementById('status-hint').innerHTML = inView ? '' : html || '';
  }
}

function loadJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

