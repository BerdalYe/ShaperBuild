// Three.js objects for a sketch: curves, points and closed regions.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makePickLineMaterial, makePickPointMaterial, makePickMeshMaterial, idColor, fillIdColors, biasLine } from './pick.js';
import { sampleEntity, keyPoints, samePoint } from '../core/geom2d.js';
import { planeFrame, to3D } from '../core/plane.js';

const pointVertex = /* glsl */ `
  attribute vec3 color;
  uniform float size;
  varying vec3 vColor;
  #include <clipping_planes_pars_vertex>
  void main() {
    vColor = color;
    #include <begin_vertex>
    #include <project_vertex>
    #include <clipping_planes_vertex>
    gl_PointSize = size;
    gl_Position.z -= 0.000006 * gl_Position.w;
  }
`;
const pointFragment = /* glsl */ `
  varying vec3 vColor;
  uniform vec3 ring;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    vec3 col = r > 0.3 ? ring : vColor;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function makeDotMaterial(size = 7) {
  return new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    uniforms: { size: { value: size }, ring: { value: new THREE.Color(0x111111) } },
    clipping: true,
  });
}

export class SketchView {
  constructor(sketch, ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.regions = [];
    this.curves = {};
    this.data = null;
    this.highlight = {};
    this.pickBase = 0;
    this.pickCount = 0;
    this.update(sketch);
  }

  // Key points of the sketch (deduplicated) for display, snapping, dragging.
  static points(sketch) {
    const pts = [];
    for (const ent of sketch.entities) {
      for (const kp of keyPoints(ent)) {
        if (kp.kind === 'mid' || kp.kind === 'quadrant') continue;
        if (!pts.some((q) => samePoint(q.p, kp.p))) pts.push({ p: kp.p, kind: kp.kind });
      }
    }
    return pts;
  }

  // data: { regions, curves } from the kernel (null while computing).
  update(sketch, data) {
    this.sketch = sketch;
    this.data = data;
    this.regions = data?.regions || [];
    this.curves = data?.curves || {};
    this.disposeObjects();
    const frame = planeFrame(sketch.plane);
    this.frame = frame;
    const ents = sketch.entities;
    this.points = SketchView.points(sketch);
    const nRegions = this.regions.length;
    this.pickCount = ents.length + this.points.length + nRegions;
    this.pickBase = this.ctx.registry.alloc(this.pickCount, (i) => this.describe(i));

    // Curves (normal and construction), each entity remembers its segments.
    const solid = [];
    const dashed = [];
    const pickSegs = [];
    const pickCols = [];
    this.entRanges = new Map();
    ents.forEach((ent, i) => {
      if (ent.type === 'point') return;
      const exact = ent.type === 'spline' ? this.curves[ent.id] : null;
      const pts = (exact || sampleEntity(ent, 96)).map((p) => to3D(frame, p));
      const target = ent.construction ? dashed : solid;
      const start = target.length / 6;
      for (let k = 0; k + 1 < pts.length; k++) {
        target.push(...pts[k], ...pts[k + 1]);
        pickSegs.push(...pts[k], ...pts[k + 1]);
        const c = idColor(this.pickBase + i);
        pickCols.push(...c, ...c);
      }
      this.entRanges.set(ent.id, { construction: !!ent.construction, start, count: target.length / 6 - start });
    });
    this.solidLines = this.makeLines(solid, false);
    this.dashedLines = this.makeLines(dashed, true);

    if (pickSegs.length) {
      const g = new LineSegmentsGeometry();
      g.setPositions(pickSegs);
      g.setColors(pickCols);
      this.pickLineMat = biasLine(makePickLineMaterial(), 0.000003);
      this.pickLineMat.clippingPlanes = this.ctx.clippingPlanes;
      this.ctx.pickLineMaterials.add(this.pickLineMat);
      this.pickLines = new LineSegments2(g, this.pickLineMat);
      this.pickLines.userData.pickKind = 'curve';
      this.pickGroup.add(this.pickLines);
    }

    // Points
    if (this.points.length) {
      const pos = new Float32Array(this.points.length * 3);
      const pick = new Float32Array(this.points.length * 3);
      this.points.forEach((pt, i) => {
        pos.set(to3D(frame, pt.p), i * 3);
        pick.set(idColor(this.pickBase + ents.length + i), i * 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.pointColors = new Float32Array(this.points.length * 3);
      g.setAttribute('color', new THREE.BufferAttribute(this.pointColors, 3));
      g.setAttribute('pickColor', new THREE.BufferAttribute(pick, 3));
      this.dotMat = makeDotMaterial(7);
      this.dotMat.clippingPlanes = this.ctx.clippingPlanes;
      this.dots = new THREE.Points(g, this.dotMat);
      this.dots.renderOrder = 3;
      this.group.add(this.dots);
      const pm = makePickPointMaterial(15);
      pm.clippingPlanes = this.ctx.clippingPlanes;
      this.pickDots = new THREE.Points(g, pm);
      this.pickDots.userData.pickKind = 'spoint';
      this.pickGroup.add(this.pickDots);
      this.pointGeom = g;
    }

    // Regions
    if (nRegions) {
      let nv = 0;
      let ni = 0;
      for (const r of this.regions) {
        nv += r.positions.length / 3;
        ni += r.indices.length;
      }
      const pos = new Float32Array(nv * 3);
      const idx = new Uint32Array(ni);
      const pick = new Float32Array(nv * 3);
      this.regionVerts = [];
      let vo = 0;
      let io = 0;
      this.regions.forEach((r, i) => {
        pos.set(r.positions, vo * 3);
        for (let k = 0; k < r.indices.length; k++) idx[io + k] = r.indices[k] + vo;
        const n = r.positions.length / 3;
        fillIdColors(pick, vo, n, this.pickBase + ents.length + this.points.length + i);
        this.regionVerts.push([vo, n]);
        vo += n;
        io += r.indices.length;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      this.regionColors = new Float32Array(nv * 4);
      g.setAttribute('color', new THREE.BufferAttribute(this.regionColors, 4));
      g.setAttribute('pickColor', new THREE.BufferAttribute(pick, 3));
      this.regionGeom = g;
      this.regionMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        clippingPlanes: this.ctx.clippingPlanes,
      });
      this.regionMesh = new THREE.Mesh(g, this.regionMat);
      this.regionMesh.renderOrder = 2;
      this.group.add(this.regionMesh);
      this.pickRegionMat = makePickMeshMaterial({ offset: -2 });
      this.pickRegionMat.clippingPlanes = this.ctx.clippingPlanes;
      this.pickRegions = new THREE.Mesh(g, this.pickRegionMat);
      this.pickRegions.userData.pickKind = 'region';
      this.pickGroup.add(this.pickRegions);
    }
    this.group.visible = sketch.visible !== false;
    this.pickGroup.visible = this.group.visible;
    this.applyColors();
  }

  makeLines(segs, dashed) {
    if (!segs.length) return null;
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    const colors = new Float32Array(segs.length);
    g.setColors(colors);
    const mat = new LineMaterial({
      vertexColors: true,
      linewidth: 2,
      worldUnits: false,
      dashed,
      dashSize: 4,
      gapSize: 3,
      dashScale: 1,
      clippingPlanes: this.ctx.clippingPlanes,
    });
    biasLine(mat, 0.000003);
    this.ctx.lineMaterials.add(mat);
    const line = new LineSegments2(g, mat);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 2;
    line.userData.colors = colors;
    this.group.add(line);
    return line;
  }

  describe(i) {
    const ents = this.sketch.entities;
    const id = this.sketch.id;
    if (i < ents.length) return { kind: 'curve', sketchId: id, entityId: ents[i].id };
    i -= ents.length;
    if (i < this.points.length) return { kind: 'spoint', sketchId: id, point: this.points[i].p, world: to3D(this.frame, this.points[i].p) };
    i -= this.points.length;
    return { kind: 'region', sketchId: id, index: i };
  }

  // h: { entities: Map(id->color), regions: Map(index->color), points: [{p,color}], active: bool }
  setHighlight(h) {
    this.highlight = h || {};
    this.applyColors();
  }

  applyColors() {
    const t = this.ctx.theme;
    const h = this.highlight;
    const col = new THREE.Color();
    for (const line of [this.solidLines, this.dashedLines]) {
      if (!line) continue;
      const dashed = line === this.dashedLines;
      const colors = line.userData.colors;
      col.set(dashed ? t.sketchConstruction : h.active ? t.sketchActive : t.sketch);
      for (let i = 0; i < colors.length; i += 3) colors.set([col.r, col.g, col.b], i);
      line.geometry.attributes.instanceColorStart.data.needsUpdate = true;
    }
    if (h.entities) {
      for (const [id, color] of h.entities) {
        const r = this.entRanges.get(id);
        if (!r) continue;
        const line = r.construction ? this.dashedLines : this.solidLines;
        if (!line) continue;
        col.set(color);
        const colors = line.userData.colors;
        for (let s = r.start * 6; s < (r.start + r.count) * 6; s += 3) colors.set([col.r, col.g, col.b], s);
      }
    }
    if (this.pointColors) {
      col.set(t.point);
      for (let i = 0; i < this.points.length; i++) this.pointColors.set([col.r, col.g, col.b], i * 3);
      if (h.points) {
        for (const { p, color } of h.points) {
          const i = this.points.findIndex((q) => samePoint(q.p, p));
          if (i >= 0) this.pointColors.set(new THREE.Color(color).toArray(), i * 3);
        }
      }
      this.pointGeom.attributes.color.needsUpdate = true;
      this.dotMat.uniforms.ring.value.set(t.edge);
    }
    if (this.regionColors) {
      col.set(t.region);
      const c = this.regionColors;
      for (let i = 0; i < c.length; i += 4) c.set([col.r, col.g, col.b, 0.16], i);
      if (h.regions) {
        for (const [index, color] of h.regions) {
          const rv = this.regionVerts[index];
          if (!rv) continue;
          const hc = new THREE.Color(color);
          for (let v = rv[0]; v < rv[0] + rv[1]; v++) c.set([hc.r, hc.g, hc.b, 0.45], v * 4);
        }
      }
      this.regionGeom.attributes.color.needsUpdate = true;
    }
  }

  disposeObjects() {
    if (this.pickCount) this.ctx.registry.free(this.pickBase, this.pickCount);
    this.pickCount = 0;
    for (const obj of [...this.group.children, ...this.pickGroup.children]) {
      obj.geometry?.dispose();
      if (obj.material) {
        this.ctx.lineMaterials.delete(obj.material);
        this.ctx.pickLineMaterials.delete(obj.material);
        obj.material.dispose();
      }
    }
    this.group.clear();
    this.pickGroup.clear();
    this.solidLines = this.dashedLines = this.dots = this.regionMesh = null;
    this.pointColors = this.regionColors = null;
  }

  dispose() {
    this.disposeObjects();
    this.group.removeFromParent();
    this.pickGroup.removeFromParent();
  }
}
