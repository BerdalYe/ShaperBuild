// The 3D view: renderer, scene, navigation (orbit / pan / zoom), picking,
// and syncing bodies and sketches from the document.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CameraRig, VIEWS } from './camera.js';
import { Grid } from './grid.js';
import { PickRegistry, Picker } from './pick.js';
import { BodyView } from './bodyview.js';
import { SketchView } from './sketchview.js';
import { Overlay } from './overlay.js';
import { ViewCube } from './viewcube.js';
import { THEMES } from './theme.js';
import { Emitter } from '../core/events.js';
import { to3D } from '../core/plane.js';

const PRIORITY = { handle: 0, spoint: 1, vertex: 1, curve: 2, edge: 2, region: 3, face: 4, body: 4 };
const RADIUS = { handle: 10, spoint: 9, vertex: 9, curve: 7, edge: 7, region: 1.5, face: 1.5, body: 1.5 };

export class Viewport extends Emitter {
  constructor(container, { theme = 'dark' } = {}) {
    super();
    this.container = container;
    this.themeName = theme;
    this.theme = THEMES[theme];
    this.width = 1;
    this.height = 1;
    this.resolution = new THREE.Vector2(1, 1);
    this.needsRender = true;
    this.showEdges = true;
    this.scrollMode = 'zoom';
    this.unitFactor = 1;
    this.sectionPlane = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', stencil: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.className = 'vp-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'vp-labels';
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.pickScene = new THREE.Scene();
    this.rig = new CameraRig();
    this.ctx = {
      registry: new PickRegistry(),
      theme: this.theme,
      lineMaterials: new Set(),
      pickLineMaterials: new Set(),
      clippingPlanes: [],
    };
    this.picker = new Picker(renderer, 12);

    // Lighting: soft environment plus a headlight that follows the camera.
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.35;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x6f7480, 0.55);
    this.scene.add(this.hemi);
    this.headlight = new THREE.DirectionalLight(0xffffff, 1.25);
    this.headlight.position.set(-0.6, 0.8, 1);
    this.rig.persp.add(this.headlight);
    this.rig.ortho.add(this.headlight.clone());
    this.scene.add(this.rig.persp, this.rig.ortho);
    // Sun for visualization mode shadows.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.visible = false;
    this.scene.add(this.sun, this.sun.target);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.28 }));
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.ground);

    this.grid = new Grid();
    this.grid.setPlane(null);
    this.grid.setTheme(this.theme);
    this.scene.add(this.grid.mesh);
    this.showGrid = true;

    this.bodyGroup = new THREE.Group();
    this.sketchGroup = new THREE.Group();
    this.scene.add(this.bodyGroup, this.sketchGroup);
    this.pickBodies = new THREE.Group();
    this.pickSketches = new THREE.Group();
    this.pickScene.add(this.pickBodies, this.pickSketches);

    this.overlay = new Overlay(this);
    this.scene.add(this.overlay.group);
    this.pickScene.add(this.overlay.pickGroup);

    this.bodyViews = new Map();
    this.sketchViews = new Map();

    this.viewcube = new ViewCube(container, (p) => this.onCubePick(p));

    this.setTheme(theme);
    this.installEvents();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  get camera() {
    return this.rig.camera;
  }

  setTheme(name) {
    this.themeName = name;
    this.theme = THEMES[name];
    this.ctx.theme = this.theme;
    this.container.style.background = `linear-gradient(180deg, ${this.theme.bgTop} 0%, ${this.theme.bgBottom} 100%)`;
    this.grid.setTheme(this.theme);
    for (const v of this.bodyViews.values()) v.applyColors();
    for (const v of this.sketchViews.values()) v.applyColors();
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.resolution.set(this.width, this.height);
    this.rig.setAspect(this.width / this.height);
    this.requestRender();
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const animating = this.rig.tick(now);
    if (animating) this.needsRender = true;
    if (!this.needsRender) return;
    this.needsRender = false;
    this.render();
    this.emit('rendered');
  }

  render() {
    this.updateSceneRadius();
    this.grid.mesh.visible = this.showGrid && !this.visualization;
    this.grid.update(this.rig, this.height, this.unitFactor);
    this.overlay.updateScreenSizes();
    for (const m of this.ctx.lineMaterials) m.resolution.copy(this.resolution);
    this.renderer.render(this.scene, this.camera);
    this.viewcube.update(this.rig.quaternion);
    this.overlay.updateLabels();
    this.emit('camera');
  }

  updateSceneRadius() {
    const box = this.contentBox();
    if (!box.isEmpty()) {
      const s = box.getBoundingSphere(new THREE.Sphere());
      this.rig.sceneRadius = s.radius + s.center.length();
    }
  }

  contentBox({ visibleOnly = true } = {}) {
    const box = new THREE.Box3();
    for (const v of this.bodyViews.values()) {
      if (visibleOnly && !v.group.visible) continue;
      v.geometry.boundingBox && box.union(v.geometry.boundingBox);
    }
    for (const v of this.sketchViews.values()) {
      if (visibleOnly && !v.group.visible) continue;
      const b = new THREE.Box3().setFromObject(v.group);
      if (!b.isEmpty()) box.union(b);
    }
    return box;
  }

  // ---- document sync -----------------------------------------------------

  // bodies: doc bodies; meshFor(shapeId) returns tessellation data.
  syncBodies(bodies, meshFor) {
    const seen = new Set();
    for (const body of bodies) {
      seen.add(body.id);
      let view = this.bodyViews.get(body.id);
      if (view && view.shapeId !== body.shapeId) {
        view.dispose();
        view = null;
      }
      if (!view) {
        const data = meshFor(body.shapeId);
        if (!data) continue;
        view = new BodyView(body, data, this.ctx);
        view.shapeId = body.shapeId;
        this.bodyViews.set(body.id, view);
        this.bodyGroup.add(view.group);
        this.pickBodies.add(view.pickGroup);
        view.setEdgesVisible(this.showEdges && !this.visualization);
        if (this.visualization) view.setVisualization?.(true);
      }
      view.setBody(body);
    }
    for (const [id, view] of this.bodyViews) {
      if (!seen.has(id)) {
        view.dispose();
        this.bodyViews.delete(id);
      }
    }
    this.requestRender();
  }

  syncSketches(sketches, regionsFor) {
    const seen = new Set();
    for (const sk of sketches) {
      seen.add(sk.id);
      let view = this.sketchViews.get(sk.id);
      const data = regionsFor(sk) || null;
      if (!view) {
        view = new SketchView(sk, this.ctx);
        view.update(sk, data);
        this.sketchViews.set(sk.id, view);
        this.sketchGroup.add(view.group);
        this.pickSketches.add(view.pickGroup);
      } else if (view.sketch !== sk || view.data !== data) {
        view.update(sk, data);
      }
      if (this.visualization) view.group.visible = false;
    }
    for (const [id, view] of this.sketchViews) {
      if (!seen.has(id)) {
        view.dispose();
        this.sketchViews.delete(id);
      }
    }
    this.requestRender();
  }

  setShowEdges(v) {
    this.showEdges = v;
    for (const view of this.bodyViews.values()) view.setEdgesVisible(v && !this.visualization);
    this.requestRender();
  }

  // ---- coordinates -------------------------------------------------------

  worldToScreen(p) {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height];
  }

  ray(x, y) {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return { origin: rc.ray.origin.toArray(), dir: rc.ray.direction.toArray(), raycaster: rc };
  }

  // Exact 3D point on a body under the cursor.
  raycastBody(bodyId, x, y) {
    const view = this.bodyViews.get(bodyId);
    if (!view) return null;
    const { raycaster } = this.ray(x, y);
    const hits = raycaster.intersectObject(view.mesh, false);
    const planes = this.ctx.clippingPlanes;
    const hit = hits.find((h) => planes.every((pl) => pl.distanceToPoint(h.point) >= -1e-6));
    if (!hit) return null;
    const n = hit.face ? hit.face.normal.clone() : null;
    return { point: hit.point.toArray(), normal: n ? n.toArray() : null };
  }

  raycastAny(x, y) {
    const { raycaster } = this.ray(x, y);
    const meshes = [...this.bodyViews.values()].filter((v) => v.group.visible).map((v) => v.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    const planes = this.ctx.clippingPlanes;
    const hit = hits.find((h) => planes.every((pl) => pl.distanceToPoint(h.point) >= -1e-6));
    return hit ? hit.point : null;
  }

  // ---- picking -----------------------------------------------------------

  // kinds: array of pick kinds to consider. Returns a descriptor or null.
  pick(x, y, kinds) {
    const want = new Set(kinds);
    const toggled = [];
    this.pickScene.traverse((obj) => {
      const k = obj.userData.pickKind;
      if (!k) return;
      const vis = want.has(k);
      if (obj.visible !== vis) {
        toggled.push([obj, obj.visible]);
        obj.visible = vis;
      }
    });
    for (const v of this.bodyViews.values()) v.pickGroup.visible = v.group.visible;
    for (const v of this.sketchViews.values()) v.pickGroup.visible = v.group.visible;
    this.overlay.updateScreenSizes();
    const found = this.picker.read(this.pickScene, this.camera, x, y, this.width, this.height, this.ctx.pickLineMaterials);
    for (const [obj, vis] of toggled) obj.visible = vis;
    let best = null;
    for (const [id, d] of found) {
      const desc = this.ctx.registry.lookup(id);
      if (!desc || !want.has(desc.kind)) continue;
      if (d > RADIUS[desc.kind]) continue;
      const pr = PRIORITY[desc.kind];
      if (!best || pr < best.pr || (pr === best.pr && d < best.d)) best = { desc, d, pr };
    }
    if (!best) return null;
    const hit = { ...best.desc };
    if (hit.kind === 'face' || hit.kind === 'body') {
      const r = this.raycastBody(hit.bodyId, x, y);
      if (r) {
        hit.point = r.point;
        if (hit.kind === 'body') hit.normal = r.normal;
      }
    } else if (hit.kind === 'region' || hit.kind === 'curve') {
      const view = this.sketchViews.get(hit.sketchId);
      if (view) {
        const { origin, dir } = this.ray(x, y);
        const f = view.frame;
        const den = dir[0] * f.n[0] + dir[1] * f.n[1] + dir[2] * f.n[2];
        if (Math.abs(den) > 1e-9) {
          const t = ((f.o[0] - origin[0]) * f.n[0] + (f.o[1] - origin[1]) * f.n[1] + (f.o[2] - origin[2]) * f.n[2]) / den;
          hit.point = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
        }
      }
    }
    return hit;
  }

  // ---- navigation & input ------------------------------------------------

  installEvents() {
    const c = this.canvas;
    let nav = null;
    let moved = false;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus({ preventScroll: true });
      const { x, y } = this.local(e);
      moved = false;
      const navButton = e.button === 2 || e.button === 1;
      if (navButton) {
        c.setPointerCapture(e.pointerId);
        const pan = e.button === 1 || e.shiftKey;
        const pivot = pan ? null : this.raycastAny(x, y);
        nav = { pan, x, y, sx: x, sy: y, pivot, button: e.button, panAt: pan ? this.raycastAny(x, y) : null };
        return;
      }
      if (e.button === 0) {
        c.setPointerCapture(e.pointerId);
        this.emit('pointerdown', this.event(e));
      }
    });
    c.addEventListener('pointermove', (e) => {
      const { x, y } = this.local(e);
      if (nav) {
        const dx = x - nav.x;
        const dy = y - nav.y;
        if (Math.abs(x - nav.sx) + Math.abs(y - nav.sy) > 3) moved = true;
        nav.x = x;
        nav.y = y;
        if (nav.pan) this.rig.pan(dx, dy, this.height, nav.panAt ? new THREE.Vector3(...nav.panAt.toArray()) : null);
        else this.rig.orbit(dx, dy, nav.pivot);
        this.requestRender();
        return;
      }
      this.emit('pointermove', this.event(e));
    });
    const end = (e) => {
      if (nav) {
        const wasMoved = moved;
        const button = nav.button;
        nav = null;
        c.releasePointerCapture?.(e.pointerId);
        if (!wasMoved && button === 2) this.emit('contextmenu', this.event(e));
        return;
      }
      if (e.button === 0) {
        c.releasePointerCapture?.(e.pointerId);
        this.emit('pointerup', this.event(e));
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.emit('pointerleave'));
    c.addEventListener('dblclick', (e) => this.emit('dblclick', this.event(e)));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { x, y } = this.local(e);
        const pinch = e.ctrlKey; // trackpad pinch arrives as ctrl+wheel
        if (this.scrollMode === 'orbit' && !pinch) {
          if (e.shiftKey) this.rig.pan(-e.deltaX, -e.deltaY, this.height);
          else this.rig.orbit(e.deltaX * 0.6, e.deltaY * 0.6, this.raycastAny(this.width / 2, this.height / 2));
          this.requestRender();
          return;
        }
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 33;
        if (e.deltaMode === 2) delta *= this.height;
        const factor = Math.exp(delta * (pinch ? 0.01 : 0.0015));
        const point = this.raycastAny(x, y) || this.pointOnTargetPlane(x, y);
        this.rig.zoom(factor, point);
        this.requestRender();
      },
      { passive: false },
    );
  }

  pointOnTargetPlane(x, y) {
    const { raycaster } = this.ray(x, y);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.rig.back, this.rig.target);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  event(e) {
    const { x, y } = this.local(e);
    const ray = this.ray(x, y);
    const cache = new Map();
    return {
      x,
      y,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
      button: e.button,
      native: e,
      ray: { origin: ray.origin, dir: ray.dir },
      pick: (kinds) => {
        const key = kinds.join(',');
        if (!cache.has(key)) cache.set(key, this.pick(x, y, kinds));
        return cache.get(key);
      },
    };
  }

  // ---- views ---------------------------------------------------------------

  onCubePick(p) {
    if (p.home) return this.setView('iso', { fit: true });
    const d = p.dir;
    const el = Math.asin(Math.max(-1, Math.min(1, d.z)));
    const az = Math.abs(d.z) > 0.999 ? 0 : Math.atan2(d.x, -d.y);
    this.rig.animateTo({ az, el });
    this.requestRender();
  }

  setView(name, { fit = false } = {}) {
    const v = VIEWS[name];
    if (!v) return;
    if (fit) this.rig.animateTo(this.rig.fitView(this.contentBox(), v));
    else this.rig.animateTo(v);
    this.requestRender();
  }

  fit(box) {
    const b = box && !box.isEmpty() ? box : this.contentBox();
    if (b.isEmpty()) {
      this.rig.animateTo({ target: new THREE.Vector3(0, 0, 0), dist: 220 });
    } else this.rig.animateTo(this.rig.fitView(b));
    this.requestRender();
  }

  lookAtPlane(plane) {
    const n = new THREE.Vector3(...plane.normal);
    const center = new THREE.Vector3(...plane.origin);
    this.rig.animateTo(this.rig.viewForPlane(n, center));
    this.requestRender();
  }

  setOrtho(on) {
    this.rig.useOrtho = on;
    this.rig.update();
    this.requestRender();
  }

  setGridPlane(plane) {
    this.grid.setPlane(plane);
    this.requestRender();
  }

  // ---- visualization mode ------------------------------------------------

  setVisualization(on) {
    this.visualization = on;
    const r = this.renderer;
    r.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    r.toneMappingExposure = on ? 1.05 : 1;
    this.scene.environmentIntensity = on ? 1.0 : 0.35;
    this.headlight.intensity = on ? 0.5 : 1.25;
    this.hemi.intensity = on ? 0.35 : 0.55;
    this.sun.visible = on;
    this.ground.visible = on;
    if (on) {
      const box = this.contentBox();
      const s = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 50) : box.getBoundingSphere(new THREE.Sphere());
      const r0 = Math.max(s.radius, 10);
      this.sun.position.copy(s.center).add(new THREE.Vector3(-0.8, -1.2, 2.2).multiplyScalar(r0 * 2));
      this.sun.target.position.copy(s.center);
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -r0 * 1.6;
      cam.right = cam.top = r0 * 1.6;
      cam.near = 0.1;
      cam.far = r0 * 10;
      cam.updateProjectionMatrix();
      const zMin = box.isEmpty() ? 0 : box.min.z;
      this.ground.position.set(s.center.x, s.center.y, zMin - 0.01);
      this.ground.scale.setScalar(r0 * 12);
    }
    for (const v of this.bodyViews.values()) {
      v.setEdgesVisible(this.showEdges && !on);
      v.setVisualization?.(on);
    }
    for (const v of this.sketchViews.values()) v.group.visible = !on && v.sketch.visible !== false;
    this.requestRender();
  }

  // ---- section view --------------------------------------------------------

  // Cut away everything on the side `normal` points to, through `origin`.
  setSection(origin, normal) {
    const planes = this.ctx.clippingPlanes;
    planes.length = 0;
    this.sectionPlane = null;
    if (origin && normal) {
      const n = new THREE.Vector3(...normal).normalize().negate();
      this.sectionPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...origin));
      planes.push(this.sectionPlane);
    }
    const touch = (obj) => {
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) m.needsUpdate = true;
    };
    this.scene.traverse(touch);
    this.pickScene.traverse(touch);
    this.updateSectionCaps();
    this.requestRender();
  }

  updateSectionCaps() {
    if (this.capGroup) {
      this.capGroup.traverse((o) => {
        if (o.material && o.userData.ownMaterial) o.material.dispose();
        if (o.geometry && o.userData.ownGeometry) o.geometry.dispose();
      });
      this.capGroup.removeFromParent();
      this.capGroup = null;
    }
    const plane = this.sectionPlane;
    if (!plane) return;
    const group = new THREE.Group();
    const stencilMat = (side, op) =>
      new THREE.MeshBasicMaterial({
        side,
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
        stencilWrite: true,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: op,
        stencilZFail: op,
        stencilZPass: op,
        clippingPlanes: [plane],
      });
    const back = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp);
    const front = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
    for (const v of this.bodyViews.values()) {
      if (!v.group.visible) continue;
      const b = new THREE.Mesh(v.geometry, back);
      const f = new THREE.Mesh(v.geometry, front);
      b.renderOrder = f.renderOrder = 7;
      group.add(b, f);
    }
    const box = this.contentBox();
    const size = box.isEmpty() ? 1000 : box.getSize(new THREE.Vector3()).length() * 4 + 10;
    const capMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.theme.select).lerp(new THREE.Color('#ffffff'), 0.35),
      roughness: 0.7,
      metalness: 0,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(size, size), capMat);
    cap.userData.ownMaterial = cap.userData.ownGeometry = true;
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    plane.projectPoint(center, cap.position);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    cap.renderOrder = 8;
    cap.onAfterRender = (r) => r.clearStencil();
    group.add(cap);
    back.userData = {};
    this.capMaterials = [back, front];
    this.capGroup = group;
    this.scene.add(group);
  }

  // ---- capture -------------------------------------------------------------

  // PNG data URL of the current view including the background.
  capture({ width = this.width, height = this.height, transparent = false } = {}) {
    const oldW = this.width;
    const oldH = this.height;
    const scale = this.renderer.getPixelRatio();
    if (width !== oldW || height !== oldH) {
      this.renderer.setSize(width, height, false);
      this.rig.setAspect(width / height);
    }
    this.overlay.group.visible = false;
    const labels = this.labelLayer.style.display;
    this.render();
    const src = this.canvas;
    const out = document.createElement('canvas');
    out.width = Math.round(width * scale);
    out.height = Math.round(height * scale);
    const g = out.getContext('2d');
    if (!transparent) {
      const grad = g.createLinearGradient(0, 0, 0, out.height);
      grad.addColorStop(0, this.theme.bgTop);
      grad.addColorStop(1, this.theme.bgBottom);
      g.fillStyle = grad;
      g.fillRect(0, 0, out.width, out.height);
    }
    g.drawImage(src, 0, 0, out.width, out.height);
    this.overlay.group.visible = true;
    this.labelLayer.style.display = labels;
    if (width !== oldW || height !== oldH) {
      this.renderer.setSize(oldW, oldH, false);
      this.rig.setAspect(oldW / oldH);
    }
    this.requestRender();
    return out.toDataURL('image/png');
  }

  sketchPointWorld(sketch, p) {
    return to3D(this.sketchViews.get(sketch.id)?.frame, p);
  }
}
