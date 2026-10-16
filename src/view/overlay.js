// Temporary visuals drawn by tools: rubber-band curves, previews, snap
// markers, drag handles and floating labels.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makePickMeshMaterial, fillIdColors } from './pick.js';
import { makeDotMaterial } from './sketchview.js';
import { t } from '../core/i18n.js';

export class Overlay {
  constructor(viewport) {
    this.vp = viewport;
    this.group = new THREE.Group();
    this.group.renderOrder = 10;
    this.pickGroup = new THREE.Group();
    this.items = new Map();
    this.labels = new Map();
    this.labelLayer = viewport.labelLayer;
  }

  remove(key) {
    const it = this.items.get(key);
    if (!it) return;
    for (const obj of it.objects) {
      obj.removeFromParent();
      obj.geometry?.dispose();
      if (obj.material && !obj.userData.sharedMaterial) {
        this.vp.ctx.lineMaterials.delete(obj.material);
        obj.material.dispose();
      }
    }
    if (it.pick) this.vp.ctx.registry.free(it.pick.base, it.pick.count);
    this.items.delete(key);
    this.vp.requestRender();
  }

  clear(prefix = '') {
    for (const key of [...this.items.keys()]) if (key.startsWith(prefix)) this.remove(key);
    for (const key of [...this.labels.keys()]) if (key.startsWith(prefix)) this.removeLabel(key);
  }

  // segs: flat array [x,y,z, x,y,z, ...] (pairs) or array of polylines.
  lines(key, segs, { color = '#ffffff', width = 2, dashed = false, depthTest = true, opacity = 1 } = {}) {
    this.remove(key);
    const flat = Array.isArray(segs[0]) ? polylinesToSegments(segs) : segs;
    if (!flat.length) return;
    if (flat.some((v) => !Number.isFinite(v))) {
      console.warn('overlay.lines: non-finite coordinates for', key);
      return;
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(flat);
    const m = new LineMaterial({
      color: new THREE.Color(color),
      linewidth: width,
      worldUnits: false,
      dashed,
      dashSize: 5,
      gapSize: 4,
      depthTest,
      transparent: opacity < 1 || !depthTest,
      opacity,
    });
    this.vp.ctx.lineMaterials.add(m);
    m.resolution.copy(this.vp.resolution);
    const line = new LineSegments2(g, m);
    if (dashed) line.computeLineDistances();
    line.renderOrder = depthTest ? 4 : 20;
    this.group.add(line);
    this.items.set(key, { objects: [line] });
    this.vp.requestRender();
  }

  dots(key, pts, { color = '#ffd84a', size = 9, ring = '#111111' } = {}) {
    this.remove(key);
    if (!pts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    const c = new THREE.Color(color);
    const colors = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = makeDotMaterial(size);
    m.uniforms.ring.value.set(ring);
    m.depthTest = false;
    const p = new THREE.Points(g, m);
    p.renderOrder = 30;
    this.group.add(p);
    this.items.set(key, { objects: [p] });
    this.vp.requestRender();
  }

  // Preview of a body from tessellation data.
  body(key, data, { color = '#5aa2ff', opacity = 0.45, edges = true } = {}) {
    this.remove(key);
    const objects = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    if (data.indices) g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    if (data.normals && data.normals.length === data.positions.length) g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    else g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
      roughness: 0.5,
      depthWrite: opacity >= 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: this.vp.ctx.clippingPlanes,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 5;
    this.group.add(mesh);
    objects.push(mesh);
    if (edges && data.edgeSegments && data.edgeSegments.length) {
      const eg = new LineSegmentsGeometry();
      eg.setPositions(data.edgeSegments);
      const em = new LineMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), linewidth: 1.4, worldUnits: false, clippingPlanes: this.vp.ctx.clippingPlanes });
      em.resolution.copy(this.vp.resolution);
      this.vp.ctx.lineMaterials.add(em);
      const el = new LineSegments2(eg, em);
      el.renderOrder = 6;
      this.group.add(el);
      objects.push(el);
    }
    this.items.set(key, { objects });
    this.vp.requestRender();
  }

  // Flat filled polygon(s) given as triangles in world space.
  fill(key, positions, indices, { color = '#5aa2ff', opacity = 0.25 } = {}) {
    this.remove(key);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (indices) g.setIndex(indices);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 3;
    this.group.add(mesh);
    this.items.set(key, { objects: [mesh] });
    this.vp.requestRender();
  }

  // Arrow handle that keeps a constant on-screen size. Pickable as
  // { kind: 'handle', key }.
  arrow(key, origin, dir, { color = '#3d8bff', length = 70, pickable = true, offset = 0 } = {}) {
    this.remove(key);
    const d = new THREE.Vector3(...dir).normalize();
    const o = new THREE.Vector3(...origin);
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), depthTest: false, transparent: true });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 12), mat);
    shaft.position.y = 0.375 + offset;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 20), mat);
    head.position.y = 0.875 + offset;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), mat);
    knob.position.y = offset;
    group.add(shaft, head, knob);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    group.position.copy(o);
    group.renderOrder = 40;
    group.traverse((c) => (c.renderOrder = 40));
    group.userData.screenSize = length;
    group.onBeforeRender = () => {};
    this.group.add(group);
    const objects = [group];
    let pick = null;
    if (pickable) {
      const base = this.vp.ctx.registry.alloc(1, () => ({ kind: 'handle', key }));
      pick = { base, count: 1 };
      const pg = new THREE.Group();
      const pm = makePickMeshMaterial({ offset: 0 });
      pm.depthTest = false;
      const fat = new THREE.CylinderGeometry(0.12, 0.12, 1.15, 8);
      fat.translate(0, 0.55 + offset, 0);
      const colors = new Float32Array(fat.attributes.position.count * 3);
      fillIdColors(colors, 0, fat.attributes.position.count, base);
      fat.setAttribute('pickColor', new THREE.BufferAttribute(colors, 3));
      const pmesh = new THREE.Mesh(fat, pm);
      pg.add(pmesh);
      pg.quaternion.copy(group.quaternion);
      pg.position.copy(o);
      pg.renderOrder = 100;
      pmesh.renderOrder = 100;
      pg.userData.screenSize = length;
      pg.userData.pickKind = 'handle';
      pmesh.userData.pickKind = 'handle';
      this.pickGroup.add(pg);
      objects.push(pg);
    }
    this.items.set(key, { objects, pick });
    this.vp.requestRender();
  }

  // Circular arc handle for angles (e.g. revolve).
  ring(key, center, normal, radiusPx, { color = '#3d8bff' } = {}) {
    this.remove(key);
    const g = new THREE.TorusGeometry(1, 0.025, 8, 64);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), depthTest: false, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(g, m);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal).normalize());
    mesh.position.set(...center);
    mesh.userData.screenSize = radiusPx;
    mesh.renderOrder = 40;
    this.group.add(mesh);
    this.items.set(key, { objects: [mesh] });
    this.vp.requestRender();
  }

  // Keep handles a constant size on screen.
  updateScreenSizes() {
    const rig = this.vp.rig;
    const h = this.vp.height;
    for (const obj of [...this.group.children, ...this.pickGroup.children]) {
      const px = obj.userData.screenSize;
      if (!px) continue;
      const s = rig.pixelSize(obj.position, h) * px;
      obj.scale.setScalar(s);
    }
  }

  // ---- HTML labels -------------------------------------------------------

  label(key, world, text, { className = '', offset = [0, 0], interactive = false, onClick = null, title = '' } = {}) {
    const prev = this.labels.get(key);
    let el = prev?.el;
    if (!el) {
      el = document.createElement('div');
      this.labelLayer.appendChild(el);
      if (interactive) {
        el.style.pointerEvents = 'auto';
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.labels.get(key)?.onClick?.(e);
        });
      }
    }
    el.className = `vp-label ${className}`;
    if (title) el.title = t(title);
    text = t(text);
    if (!el.classList.contains('editing') && el.textContent !== text) el.textContent = text;
    this.labels.set(key, { el, world, offset, onClick });
    this.positionLabel(this.labels.get(key));
  }

  removeLabel(key) {
    const l = this.labels.get(key);
    if (l) l.el.remove();
    this.labels.delete(key);
  }

  positionLabel(l) {
    const p = this.vp.worldToScreen(l.world);
    if (!p) {
      l.el.style.display = 'none';
      return;
    }
    l.el.style.display = '';
    l.el.style.transform = `translate(${Math.round(p[0] + l.offset[0])}px, ${Math.round(p[1] + l.offset[1])}px) translate(-50%, -50%)`;
  }

  updateLabels() {
    for (const l of this.labels.values()) this.positionLabel(l);
  }
}

function polylinesToSegments(lines) {
  const out = [];
  for (const pl of lines) for (let i = 0; i + 1 < pl.length; i++) out.push(...pl[i], ...pl[i + 1]);
  return out;
}
