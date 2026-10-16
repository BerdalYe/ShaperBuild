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
import { FileOps } from './fileops.js';
import { Dialogs } from './ui/dialogs.js';
import { Home } from './ui/home.js';
import { ConstraintLayer } from './ui/constraints.js';
import { ViewControls, NavHelp } from './ui/viewcontrols.js';
import { StarterCard, ToolHint } from './ui/starter.js';
import { Tutorial } from './ui/tutorial.js';
import { PrintDialog } from './ui/printdialog.js';
import { Updates } from './ui/updates.js';
import { toast, showMenu, hideTooltip } from './ui/overlays.js';
import { icon } from './ui/icons.js';
import { isTyping, modKey } from './ui/dom.js';
import { TOOL_KEYS } from './tools/registry.js';
import { UNITS, formatLength, formatArea, formatVolume, niceStep } from './core/units.js';
import { planeFrame, to3D, to2D, samePlane } from './core/plane.js';
import { keyPoints, closestOnEntity, dist } from './core/geom2d.js';

const SETTINGS_KEY = 'shaperbuild.settings.v1';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  units: 'mm',
  snap: true,
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
    this.kernel = new KernelClient();
    this.doc = new Document();
    this.selection = new Selection();
    this.vp = new Viewport(document.getElementById('viewport'), { theme: this.settings.theme });
    this.applyViewSettings();
    this.panel = new ToolPanel(document.getElementById('tool-panel'), this);
    this.dim = new DimInput(document.getElementById('viewport'), this);
    this.status = new Status(this);
    this.cmd = new Commands(this);
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
    this.starter = new StarterCard(document.getElementById('starter'), this);

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
      document.querySelector('#boot .boot-card').innerHTML = `<div style="color:var(--danger)">The geometry engine failed to start.</div><div>${err.message}</div>`;
      return;
    }
    document.getElementById('boot').hidden = true;
    if (window.native) {
      window.native.onMenu((cmd, arg) => this.onMenu(cmd, arg));
      window.native.onOpenPath((p) => this.files.openPath(p));
    }
    // Decide on recovery and the home screen before reporting ready, so the
    // home screen never pops up over work that has already started.
    const recovered = await this.files.offerRecovery().catch(() => false);
    if (!recovered && this.doc.isEmpty && !this.files.path) this.home.show();
    this.ready = true;
    window.native?.ready();
    this.files.startAutosave();
    this.starter.update();
    this.updates.start();
    // First launch: offer the interactive tutorial.
    const info = await window.native?.info().catch(() => null);
    if (!recovered && !this.tutorial.seen && !info?.noTutorial) this.tutorial.offer();
  }

  get units() {
    return this.doc.state.units || 'mm';
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
    this.vp.requestRender();
  }

  // ---- document sync -----------------------------------------------------

  onDocChange(ev) {
    this.syncView();
    if (ev.kind === 'undo' || ev.kind === 'redo') toast(`${ev.kind === 'undo' ? 'Undo' : 'Redo'} ${ev.label || ''}`.trim(), { ms: 1200 });
    this.updateTitle();
    this.scheduleGC();
  }

  syncView() {
    const doc = this.doc;
    for (const b of doc.bodies) if (!this.meshCache.has(b.shapeId)) this.fetchMesh(b.shapeId);
    this.vp.syncBodies(doc.bodies, (id) => this.meshCache.get(id));
    for (const sk of doc.sketches) this.requestRegions(sk);
    this.vp.syncSketches(doc.sketches, (sk) => this.regionDataFor(sk));
    this.vp.syncPlanes(doc.planes);
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

  pathRef(it) {
    if (it.kind === 'edge') return { type: 'edge', id: this.doc.body(it.bodyId).shapeId, edge: it.index };
    if (it.kind === 'curve') {
      const sk = this.doc.sketch(it.sketchId);
      const en = sk?.entities.find((e) => e.id === it.entityId);
      return en ? { type: 'curve', plane: sk.plane, entity: en } : null;
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
    // Body vertices that lie on the plane.
    for (const view of vp.bodyViews.values()) {
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
    const valid = cands.filter((c) => !exclude || dist(c.p, exclude) > 1e-9);
    const LABELS = { end: 'Endpoint', mid: 'Midpoint', center: 'Center', quadrant: 'Quadrant', vertex: 'Vertex', origin: 'Origin', point: 'Point' };
    let best = null;
    for (const c of valid) {
      const d = screenDist(c.p);
      const r = c.kind === 'mid' || c.kind === 'quadrant' ? 8 : 11;
      if (d <= r && (!best || d < best.d)) best = { ...c, d };
    }
    if (best) return { p: best.p, snap: { kind: best.kind, label: LABELS[best.kind] } };

    const px = vp.rig.pixelSize(new THREE.Vector3(...to3D(f, p)), vp.height);
    const gs = this.gridStep(px * 14);
    // A grid point right under the cursor wins over alignments.
    const gridPoint = [Math.round(p[0] / gs) * gs, Math.round(p[1] / gs) * gs];
    if (near(gridPoint, 4)) return { p: gridPoint, snap: { kind: 'grid' } };

    // Alignment with the previous point and other points (horizontal/vertical).
    let q = [...p];
    const guides = [];
    let label = null;
    const tol = px * 6;
    const refs = from ? [{ p: from }, ...valid.slice(0, 400)] : valid.slice(0, 400);
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
    if (!snappedX && !snappedY) {
      let bc = null;
      for (const { en, sf } of ents) {
        if (en.type === 'point') continue;
        const local = sf === f ? p : to2D(sf, to3D(f, p));
        const c = closestOnEntity(local, en);
        const cp = sf === f ? c.point : to2D(f, to3D(sf, c.point));
        const d = screenDist(cp);
        if (d < 7 && (!bc || d < bc.d)) bc = { p: cp, d };
      }
      if (bc) return { p: bc.p, snap: { kind: 'on', label: 'On curve' } };
    }
    // Grid, for any coordinate that did not align with something.
    const g = [snappedX ? q[0] : Math.round(p[0] / gs) * gs, snappedY ? q[1] : Math.round(p[1] / gs) * gs];
    const onGrid = near(g, 8);
    if (snappedX || snappedY) {
      if (onGrid) {
        q = g;
        for (const gd of guides) gd[1] = [...q];
      }
      return { p: q, snap: { kind: 'align', label, guides } };
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
    document.getElementById('busy-text').textContent = text;
    this.onKernelBusy(on);
  }

  onKernelBusy(b) {
    clearTimeout(this.busyTimer);
    const el = document.getElementById('busy');
    if (b || this.busyManual) this.busyTimer = setTimeout(() => (el.hidden = false), 350);
    else {
      el.hidden = true;
      document.getElementById('busy-text').textContent = 'Working…';
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
      for (const id of this.meshCache.keys()) if (!keep.has(id)) this.meshCache.delete(id);
      this.kernel.call('retainOnly', [...keep]).catch(() => {});
    }, 4000);
  }

  async updateMeasureInfo() {
    const info = document.getElementById('status-info');
    const items = this.selection.list;
    const token = (this.measureToken = (this.measureToken || 0) + 1);
    if (!items.length || items.length > 2) {
      info.textContent = items.length ? `${items.length} selected` : '';
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
        if (en?.type === 'line') info.textContent = `Line · ${formatLength(dist(en.a, en.b), this.units)}`;
        else if (en?.type === 'circle') info.textContent = `Circle · ⌀ ${formatLength(en.r * 2, this.units)}`;
        else if (en?.type === 'arc') info.textContent = `Arc · R ${formatLength(en.r, this.units)}`;
        else info.textContent = en ? en.type : '';
      } else if (items.length === 1 && it.kind === 'region') {
        const r = this.regionCache.get(it.sketchId)?.data?.regions[it.index];
        info.textContent = r ? `Region · ${formatArea(r.area, this.units)}` : '';
      } else info.textContent = `${items.length} selected`;
      return;
    }
    try {
      const res = await this.kernel.call('measure', { items: kitems });
      if (token !== this.measureToken) return;
      const u = this.units;
      const parts = res.items.map((r) => {
        if (r.kind === 'body') return `Volume ${formatVolume(r.volume, u)}`;
        if (r.kind === 'face') return `Area ${formatArea(r.area, u)}${r.radius ? ` · R ${formatLength(r.radius, u)}` : ''}`;
        if (r.kind === 'edge') return `Length ${formatLength(r.length, u)}${r.radius ? ` · R ${formatLength(r.radius, u)}` : ''}`;
        return '';
      });
      if (res.pair?.distance !== undefined) parts.push(`Distance ${formatLength(res.pair.distance, u)}`);
      if (res.pair?.angle !== undefined) parts.push(`Angle ${res.pair.angle.toFixed(2)}°`);
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
      items.push({ label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: () => this.cmd.deleteSelection() });
    } else {
      items.push({ label: 'Zoom to fit', icon: 'fit', kbd: 'Z', action: () => this.vp.fit() });
      items.push({ label: 'Show all', icon: 'eye', action: () => this.cmd.showAll() });
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

    this.viewControls = new ViewControls($('view-controls'), this);
    this.toolHint = new ToolHint($('tool-hint'), this);
  }

  helpMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const m = modKey();
    showMenu(r.left, r.bottom + 6, [
      { label: 'Interactive tutorial', icon: 'learn', action: () => this.tutorial.start() },
      { label: 'How to move around', icon: 'mouse', action: () => this.navHelp.toggle(true) },
      { label: 'Find a tool', icon: 'search', kbd: `${m}K`, action: () => this.toolsMenu.focusSearch() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: `${m}/`, action: () => this.dialogs.shortcuts() },
      { label: 'Getting started', icon: 'help', action: () => this.dialogs.gettingStarted() },
      '-',
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
    this.vp.setVisualization(on);
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

  toggleSnap() {
    this.settings.snap = !this.settings.snap;
    this.saveSettings();
    document.getElementById('btn-snap').classList.toggle('on', this.settings.snap);
    toast(this.settings.snap ? 'Snapping on' : 'Snapping off (hold Alt to skip snapping)', { ms: 1200 });
  }

  toggleSection() {
    if (this.section.enabled && !(this.tools.activeId === 'section')) this.setSection({ enabled: false });
    else this.tools.activate('section');
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

  setupKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.ready) return;
      if (document.querySelector('.modal-backdrop')) return;
      if (!this.home.el.hidden) return;
      const typing = isTyping();
      const mod = e.ctrlKey || e.metaKey;
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
      // Hold Space and drag to orbit (Shift+Space to pan).
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          document.activeElement?.blur?.();
          this.vp.setSpaceHeld(true);
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
      if (mod) {
        if (e.key.toLowerCase() === 'a') {
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
      if (k === '?') return this.dialogs.shortcuts();
      if (e.shiftKey && k.toLowerCase() === 'x') return this.toggleXray();
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        this.cmd.deleteSelection();
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        this.toggleItems();
        return;
      }
      const lower = k.toLowerCase();
      const views = { 0: 'iso', 1: 'front', 2: 'back', 3: 'right', 4: 'left', 7: 'top', 8: 'bottom' };
      if (k in views) return this.vp.setView(views[k]);
      if (e.shiftKey) return;
      switch (lower) {
        case 'z':
        case 'home':
          return this.vp.fit(this.selectionBox());
        case 'o':
          return this.toggleOrtho();
        case 'g':
          return this.toggleGrid();
        case 'v':
          return this.setVisualization(!this.visual);
        case 's':
          return this.toggleSnap();
        case 'n':
          return this.lookAtSelection();
        case 'x':
          return this.toggleSection();
        default:
      }
      if (TOOL_KEYS[lower] && !this.visual) this.tools.activate(TOOL_KEYS[lower]);
    });
    const release = () => this.vp.setSpaceHeld(false);
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.code === 'Space') release();
    });
    window.addEventListener('blur', release);
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
    const pl = it?.kind === 'plane' ? this.doc.plane(it.planeId) : null;
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
        hint.textContent = 'Drop STL, OBJ, 3MF, STEP or ShaperBuild files to open them';
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
      case 'export-png':
        return this.files.exportPNG();
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
      case 'toggle-edges':
        this.settings.showEdges = !this.settings.showEdges;
        this.saveSettings();
        return this.applyViewSettings();
      case 'toggle-theme':
        return this.toggleTheme();
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
        return this.tutorial.start();
      case 'navigation-help':
        return this.navHelp.toggle(true);
      case 'find-tool':
        return this.toolsMenu.focusSearch();
      case 'toggle-tool-labels':
        return this.toggleToolLabels();
      case 'about':
        return this.dialogs.about();
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

