// Three.js objects for one body: shaded faces, edge lines and pick buffers.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { makePickMeshMaterial, makePickLineMaterial, makePickPointMaterial, fillIdColors, idColor } from './pick.js';

const tmpColor = new THREE.Color();

// Surface finishes for visualization mode (body.material).
export const MATERIALS = {
  plastic: { label: 'Plastic', roughness: 0.32, metalness: 0.06 },
  matte: { label: 'Matte', roughness: 0.85, metalness: 0 },
  glossy: { label: 'Glossy', roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 },
  rubber: { label: 'Rubber', roughness: 1, metalness: 0 },
  metal: { label: 'Metal', roughness: 0.36, metalness: 1 },
  brushed: { label: 'Brushed metal', roughness: 0.55, metalness: 1 },
  chrome: { label: 'Chrome', roughness: 0.03, metalness: 1 },
  glass: { label: 'Glass', roughness: 0.04, metalness: 0, transmission: 1, thickness: 4, ior: 1.5 },
};
const MODELING_LOOK = { roughness: 0.55, metalness: 0.05, clearcoat: 0, clearcoatRoughness: 0, transmission: 0 };

export class BodyView {
  constructor(body, data, ctx) {
    this.body = body;
    this.data = data;
    this.ctx = ctx; // { registry, theme, materials }
    this.group = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.group.userData.bodyId = body.id;
    this.faceCount = data.kind === 'solid' ? data.faceInfo.length : 1;
    this.edgeCount = data.kind === 'solid' ? data.edgeInfo.length : 0;
    this.vertexCount = data.kind === 'solid' ? data.vertices.length / 3 : 0;
    this.pickBase = ctx.registry.alloc(this.faceCount + this.edgeCount + this.vertexCount, (i) => this.describe(i));
    this.build();
  }

  // Face index of triangle `t` of the shaded mesh (null for meshes).
  faceOfTriangle(t) {
    if (!this.faceVerts.length) return null;
    const idx = this.geometry.index;
    const v = idx ? idx.getX(t * 3) : t * 3;
    for (let f = 0; f < this.faceVerts.length; f++) for (const [lo, n] of this.faceVerts[f] || []) if (v >= lo && v < lo + n) return f;
    return null;
  }

  describe(i) {
    const id = this.body.id;
    if (this.data.kind === 'mesh') return { kind: 'body', bodyId: id, mesh: true };
    if (i < this.faceCount) return { kind: 'face', bodyId: id, index: i };
    i -= this.faceCount;
    if (i < this.edgeCount) return { kind: 'edge', bodyId: id, index: i };
    i -= this.edgeCount;
    const v = this.data.vertices;
    return { kind: 'vertex', bodyId: id, index: i, point: [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]] };
  }

  build() {
    const d = this.data;
    const geom = new THREE.BufferGeometry();
    if (d.kind === 'mesh') {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
      if (d.flat) {
        // Normals were already computed (with creases) by the kernel.
        g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
      } else {
        g.setIndex(new THREE.BufferAttribute(d.indices, 1));
        g = toCreasedNormals(g, (30 * Math.PI) / 180);
      }
      this.geometry = g;
    } else {
      geom.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(d.indices, 1));
      this.geometry = geom;
    }
    const g = this.geometry;
    const nVerts = g.attributes.position.count;
    this.colors = new Float32Array(nVerts * 3);
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    // Pick colours: one id per face.
    const pickColors = new Float32Array(nVerts * 3);
    this.faceVerts = [];
    if (d.kind === 'solid') {
      const idx = d.indices;
      const ranges = d.faceRanges;
      for (let k = 0; k < ranges.length; k += 3) {
        const start = ranges[k];
        const count = ranges[k + 1];
        const face = ranges[k + 2];
        let lo = Infinity;
        let hi = -Infinity;
        // start/count are positions in the index array.
        for (let t = start; t < start + count; t++) {
          const v = idx[t];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (lo === Infinity) continue;
        (this.faceVerts[face] ||= []).push([lo, hi - lo + 1]);
        fillIdColors(pickColors, lo, hi - lo + 1, this.pickBase + face);
      }
    } else {
      fillIdColors(pickColors, 0, nVerts, this.pickBase);
    }
    g.setAttribute('pickColor', new THREE.BufferAttribute(pickColors, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      clippingPlanes: this.ctx.clippingPlanes,
      shadowSide: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.bodyId = this.body.id;
    this.group.add(this.mesh);

    this.pickMesh = new THREE.Mesh(g, makePickMeshMaterial({ offset: 1 }));
    this.pickMesh.material.clippingPlanes = this.ctx.clippingPlanes;
    this.pickMesh.userData.pickKind = d.kind === 'mesh' ? 'body' : 'face';
    this.pickGroup.add(this.pickMesh);

    // Edges
    if (d.edgeSegments && d.edgeSegments.length) {
      const eg = new LineSegmentsGeometry();
      eg.setPositions(d.edgeSegments);
      const segCount = d.edgeSegments.length / 6;
      this.edgeColors = new Float32Array(segCount * 6);
      eg.setColors(this.edgeColors);
      this.edgeGeometry = eg;
      this.edgeMaterial = new LineMaterial({
        vertexColors: true,
        linewidth: d.kind === 'mesh' ? 1 : 1.4,
        worldUnits: false,
        clippingPlanes: this.ctx.clippingPlanes,
      });
      this.ctx.lineMaterials.add(this.edgeMaterial);
      this.edges = new LineSegments2(eg, this.edgeMaterial);
      this.edges.renderOrder = 1;
      this.group.add(this.edges);
      this.edgeSegRanges = [];
      if (d.kind === 'solid') {
        const er = d.edgeRanges;
        const pickEdgeColors = new Float32Array(segCount * 6);
        for (let k = 0; k < er.length; k += 3) {
          const [start, count, edge] = [er[k], er[k + 1], er[k + 2]];
          (this.edgeSegRanges[edge] ||= []).push([start, count]);
          const c = idColor(this.pickBase + this.faceCount + edge);
          for (let s = start; s < start + count; s++) {
            for (let v = 0; v < 2; v++) pickEdgeColors.set(c, s * 6 + v * 3);
          }
        }
        const peg = new LineSegmentsGeometry();
        peg.setPositions(d.edgeSegments);
        peg.setColors(pickEdgeColors);
        this.pickEdgeGeometry = peg;
        const pm = makePickLineMaterial();
        pm.clippingPlanes = this.ctx.clippingPlanes;
        this.ctx.pickLineMaterials.add(pm);
        this.pickEdgeMaterial = pm;
        this.pickEdges = new LineSegments2(peg, pm);
        this.pickEdges.userData.pickKind = 'edge';
        this.pickGroup.add(this.pickEdges);
      }
    }

    // Vertices (only picked when a tool asks for them).
    if (d.kind === 'solid' && this.vertexCount) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(d.vertices, 3));
      const pc = new Float32Array(this.vertexCount * 3);
      for (let i = 0; i < this.vertexCount; i++) pc.set(idColor(this.pickBase + this.faceCount + this.edgeCount + i), i * 3);
      pg.setAttribute('pickColor', new THREE.BufferAttribute(pc, 3));
      this.pickVertexGeometry = pg;
      const pm = makePickPointMaterial(14);
      pm.clippingPlanes = this.ctx.clippingPlanes;
      this.pickVertices = new THREE.Points(pg, pm);
      this.pickVertices.userData.pickKind = 'vertex';
      this.pickGroup.add(this.pickVertices);
    }
    this.applyColors();
  }

  setBody(body) {
    const looked = this.body?.material;
    this.body = body;
    this.group.visible = body.visible !== false;
    this.pickGroup.visible = this.group.visible;
    this.applyColors();
    if (this.visual && body.material !== looked) this.applyLook();
  }

  // highlight: { body: color|null, faces: Map(index -> color), edges: Map(index -> color) }
  setHighlight(h) {
    this.highlight = h;
    this.applyColors();
  }

  applyColors() {
    const theme = this.ctx.theme;
    const h = this.highlight || {};
    const base = tmpColor.set(h.body || this.body.color || theme.body);
    const c = this.colors;
    for (let i = 0; i < c.length; i += 3) {
      c[i] = base.r;
      c[i + 1] = base.g;
      c[i + 2] = base.b;
    }
    if (h.faces) {
      for (const [face, color] of h.faces) {
        const col = new THREE.Color(color);
        for (const [lo, n] of this.faceVerts[face] || []) {
          for (let v = lo; v < lo + n; v++) {
            c[v * 3] = col.r;
            c[v * 3 + 1] = col.g;
            c[v * 3 + 2] = col.b;
          }
        }
      }
    }
    this.geometry.attributes.color.needsUpdate = true;
    if (this.edgeColors) {
      const e = this.edgeColors;
      const ec = new THREE.Color(theme.edge);
      for (let i = 0; i < e.length; i += 3) {
        e[i] = ec.r;
        e[i + 1] = ec.g;
        e[i + 2] = ec.b;
      }
      if (h.edges) {
        for (const [edge, color] of h.edges) {
          const col = new THREE.Color(color);
          for (const [start, count] of this.edgeSegRanges[edge] || []) {
            for (let s = start * 6; s < (start + count) * 6; s += 3) {
              e[s] = col.r;
              e[s + 1] = col.g;
              e[s + 2] = col.b;
            }
          }
        }
      }
      const attr = this.edgeGeometry.attributes.instanceColorStart;
      if (attr) attr.data.needsUpdate = true;
    }
  }

  // Visualization mode shows each body's material; modeling mode keeps
  // one plain finish so faces and edges stay easy to read.
  setVisualization(on) {
    this.visual = on;
    this.applyLook();
  }

  applyLook() {
    const look = this.visual ? MATERIALS[this.body.material] || MATERIALS.plastic : MODELING_LOOK;
    const m = this.material;
    m.roughness = look.roughness;
    m.metalness = look.metalness;
    m.clearcoat = look.clearcoat || 0;
    m.clearcoatRoughness = look.clearcoatRoughness || 0;
    m.transmission = look.transmission || 0;
    m.thickness = look.thickness || 0;
    m.ior = look.ior || 1.5;
    m.needsUpdate = true;
  }

  // See-through faces so hidden edges and inner parts show.
  setXray(on) {
    const m = this.material;
    m.transparent = on;
    m.opacity = on ? 0.22 : 1;
    m.depthWrite = !on;
    this.mesh.castShadow = !on;
    this.mesh.renderOrder = on ? 1 : 0;
    m.needsUpdate = true;
  }

  setEdgesVisible(v) {
    if (this.edges) this.edges.visible = v;
  }

  // Where is face `index` (for handles): centre and normal from kernel info.
  faceInfo(index) {
    return this.data.kind === 'solid' ? this.data.faceInfo[index] : null;
  }

  dispose() {
    this.ctx.registry.free(this.pickBase, this.faceCount + this.edgeCount + this.vertexCount);
    this.geometry.dispose();
    this.material.dispose();
    this.pickMesh.material.dispose();
    if (this.edgeGeometry) this.edgeGeometry.dispose();
    if (this.edgeMaterial) {
      this.edgeMaterial.dispose();
      this.ctx.lineMaterials.delete(this.edgeMaterial);
    }
    if (this.pickEdgeGeometry) this.pickEdgeGeometry.dispose();
    if (this.pickEdgeMaterial) {
      this.pickEdgeMaterial.dispose();
      this.ctx.pickLineMaterials.delete(this.pickEdgeMaterial);
    }
    if (this.pickVertexGeometry) this.pickVertexGeometry.dispose();
    this.group.removeFromParent();
    this.pickGroup.removeFromParent();
  }
}
