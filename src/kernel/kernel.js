// Geometry kernel. Runs inside a Web Worker in the app and directly in Node
// for tests. Solid bodies are OpenCascade B-rep shapes; imported meshes (STL,
// OBJ, 3MF) stay triangle meshes and use Manifold for booleans.
//
// Every operation is functional: it reads shapes by id and stores results
// under new ids, so undo on the main thread is just swapping ids.
import { closestOnEntity } from '../core/geom2d.js';

const EPS = 1e-7;

export class Kernel {
  constructor(oc, manifoldWasm) {
    this.oc = oc;
    this.mf = manifoldWasm;
    this.store = new Map();
    this.nextId = 1;
    this.regionCache = new Map(); // sketchId -> [TopoDS_Face]
    const T = oc.TopAbs_ShapeEnum;
    this.T = T;
  }

  // ---- helpers -----------------------------------------------------------

  scope() {
    const list = [];
    const r = (obj) => {
      list.push(obj);
      return obj;
    };
    r.free = () => {
      for (const o of list) {
        try {
          o.delete();
        } catch {}
      }
      list.length = 0;
    };
    return r;
  }

  pnt(r, p) {
    return r(new this.oc.gp_Pnt(p[0], p[1], p[2]));
  }
  dir(r, d) {
    return r(new this.oc.gp_Dir(d[0], d[1], d[2]));
  }
  vec(r, v) {
    return r(new this.oc.gp_Vec(v[0], v[1], v[2]));
  }

  explore(shape, type) {
    const oc = this.oc;
    const out = [];
    const ex = new oc.TopExp_Explorer(shape, type, this.T.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) out.push(ex.Current());
    ex.delete();
    return out;
  }

  hash(s) {
    return this.oc.ReplicadShapeHasher.HashCode(s, 2147483647);
  }

  // Unique sub-shapes in a stable order (explorer order, deduplicated).
  indexed(shape, type) {
    const all = this.explore(shape, type);
    const seen = new Map();
    const out = [];
    for (const s of all) {
      const h = this.hash(s);
      const bucket = seen.get(h);
      if (bucket && bucket.some((o) => o.IsSame(s))) {
        s.delete();
        continue;
      }
      if (bucket) bucket.push(s);
      else seen.set(h, [s]);
      out.push(s);
    }
    return out;
  }

  errorMessage(err) {
    if (err instanceof Error) return err.message;
    try {
      if (this.oc.getExceptionMessage) {
        const m = this.oc.getExceptionMessage(err);
        if (Array.isArray(m)) return m.filter(Boolean).join(': ') || 'Geometry operation failed';
        if (m) return String(m);
      }
    } catch {}
    return 'Geometry operation failed';
  }

  // Run an OCC operation, converting C++ exceptions into readable errors.
  guard(what, fn) {
    try {
      return fn();
    } catch (err) {
      const msg = this.errorMessage(err);
      throw new Error(msg && msg !== 'Geometry operation failed' ? `${what} failed (${msg})` : `${what} failed`);
    }
  }

  add(entry) {
    const id = `k${this.nextId++}`;
    this.store.set(id, entry);
    return id;
  }

  addSolid(shape) {
    return this.add({ kind: 'solid', shape });
  }

  addMesh(positions, indices) {
    return this.add({ kind: 'mesh', positions, indices });
  }

  get(id) {
    const e = this.store.get(id);
    if (!e) throw new Error(`Unknown shape ${id}`);
    return e;
  }

  solid(id) {
    const e = this.get(id);
    if (e.kind !== 'solid') throw new Error('This works on solid bodies only. Convert the mesh to a solid first.');
    return e.shape;
  }

  // Accepts an array of ids or { ids }.
  release(arg) {
    const ids = Array.isArray(arg) ? arg : arg?.ids || [];
    for (const id of ids) {
      const e = this.store.get(id);
      if (!e) continue;
      this.freeEntry(e);
      this.store.delete(id);
    }
  }

  // Free every shape not in `keep` (array or { keep }).
  retainOnly(arg) {
    const set = new Set(Array.isArray(arg) ? arg : arg?.keep || []);
    const drop = [...this.store.keys()].filter((id) => !set.has(id));
    this.release(drop);
    return drop.length;
  }

  freeEntry(e) {
    try {
      e.topo = null;
      if (e.shape) e.shape.delete();
      if (e.faces) e.faces.forEach((f) => f.delete());
      if (e.edges) e.edges.forEach((f) => f.delete());
      if (e.manifold) e.manifold.delete();
    } catch {}
  }

  faces(id) {
    const e = this.get(id);
    if (e.kind !== 'solid') return [];
    if (!e.faces) e.faces = this.indexed(e.shape, this.T.TopAbs_FACE).map((f) => this.oc.TopoDS.Face(f));
    return e.faces;
  }

  edges(id) {
    const e = this.get(id);
    if (e.kind !== 'solid') return [];
    if (!e.edges) e.edges = this.indexed(e.shape, this.T.TopAbs_EDGE).map((x) => this.oc.TopoDS.Edge(x));
    return e.edges;
  }

  face(id, index) {
    const f = this.faces(id)[index];
    if (!f) throw new Error('Face not found');
    return f;
  }

  edge(id, index) {
    const ed = this.edges(id)[index];
    if (!ed) throw new Error('Edge not found');
    return ed;
  }

  bbox(shape) {
    const r = this.scope();
    const b = r(new this.oc.Bnd_Box());
    this.oc.BRepBndLib.Add(shape, b, true);
    if (b.IsVoid()) {
      r.free();
      return null;
    }
    const mn = r(b.CornerMin());
    const mx = r(b.CornerMax());
    const out = { min: [mn.X(), mn.Y(), mn.Z()], max: [mx.X(), mx.Y(), mx.Z()] };
    r.free();
    return out;
  }

  // Break a result into separate solids. Returns [] for empty results.
  solidsOf(shape) {
    const T = this.T;
    if (shape.ShapeType() === T.TopAbs_SOLID) return [shape];
    const solids = this.explore(shape, T.TopAbs_SOLID).map((s) => this.oc.TopoDS.Solid(s));
    if (solids.length) return solids;
    // Shells or faces (e.g. imported surfaces) are kept as they are.
    const faces = this.explore(shape, T.TopAbs_FACE);
    const keep = faces.length ? [shape] : [];
    faces.forEach((f) => f.delete());
    return keep;
  }

  compound(shapes) {
    const oc = this.oc;
    const c = new oc.TopoDS_Compound();
    const b = new oc.TopoDS_Builder();
    b.MakeCompound(c);
    for (const s of shapes) b.Add(c, s);
    b.delete();
    return c;
  }

  // ---- tessellation ------------------------------------------------------

  heapCopy(ctor, ptr, size) {
    const buf = this.oc.wasmMemory.buffer;
    return new ctor(buf, ptr, size).slice();
  }

  deflectionFor(bb) {
    if (!bb) return 0.05;
    const d = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
    return Math.min(0.5, Math.max(0.002, d * 0.0006));
  }

  tessellate(id, { fine = false } = {}) {
    const e = this.get(id);
    if (e.kind === 'mesh') return this.tessellateMesh(id, e);
    return this.guard('Tessellation', () => this.tessellateSolid(id, e, fine));
  }

  tessellateSolid(id, e, fine) {
    const oc = this.oc;
    const shape = e.shape;
    const bb = this.bbox(shape);
    const defl = fine ? Math.min(0.01, this.deflectionFor(bb)) : this.deflectionFor(bb);
    const ang = fine ? 0.1 : 0.25;
    const raw = oc.ReplicadMeshExtractor.extract(shape, defl, ang, false);
    const positions = this.heapCopy(Float32Array, raw.getVerticesPtr(), raw.getVerticesSize());
    const normals = this.heapCopy(Float32Array, raw.getNormalsPtr(), raw.getNormalsSize());
    const indices = this.heapCopy(Uint32Array, raw.getTrianglesPtr(), raw.getTrianglesSize());
    const groups = this.heapCopy(Int32Array, raw.getFaceGroupsPtr(), raw.getFaceGroupsSize());
    raw.delete();

    const faces = this.faces(id);
    const faceIndexByHash = new Map();
    faces.forEach((f, i) => {
      const h = this.hash(f);
      if (!faceIndexByHash.has(h)) faceIndexByHash.set(h, i);
    });
    // faceRanges: per triangle-group -> [startIndex, count, faceIndex]
    const faceRanges = new Int32Array(groups.length);
    for (let i = 0; i < groups.length; i += 3) {
      faceRanges[i] = groups[i];
      faceRanges[i + 1] = groups[i + 1];
      faceRanges[i + 2] = faceIndexByHash.get(groups[i + 2]) ?? i / 3;
    }

    const eraw = oc.ReplicadEdgeMeshExtractor.extract(shape, defl, ang);
    const edgeLines = this.heapCopy(Float32Array, eraw.getLinesPtr(), eraw.getLinesSize());
    const egroups = this.heapCopy(Int32Array, eraw.getEdgeGroupsPtr(), eraw.getEdgeGroupsSize());
    eraw.delete();
    const edges = this.edges(id);
    const edgeIndexByHash = new Map();
    edges.forEach((ed, i) => {
      const h = this.hash(ed);
      if (!edgeIndexByHash.has(h)) edgeIndexByHash.set(h, i);
    });
    // edgeLines is a polyline per edge group; convert into segment pairs.
    const segs = [];
    const edgeRanges = [];
    for (let g = 0; g < egroups.length; g += 3) {
      const start = egroups[g];
      const count = egroups[g + 1];
      const edgeIndex = edgeIndexByHash.get(egroups[g + 2]) ?? g / 3;
      const segStart = segs.length / 6;
      for (let k = 0; k < count - 1; k++) {
        const a = (start + k) * 3;
        const b = (start + k + 1) * 3;
        segs.push(edgeLines[a], edgeLines[a + 1], edgeLines[a + 2], edgeLines[b], edgeLines[b + 1], edgeLines[b + 2]);
      }
      edgeRanges.push(segStart, segs.length / 6 - segStart, edgeIndex);
    }

    return {
      kind: 'solid',
      id,
      positions,
      normals,
      indices,
      faceRanges,
      edgeSegments: new Float32Array(segs),
      edgeRanges: new Int32Array(edgeRanges),
      faceInfo: faces.map((f) => this.faceInfo(f)),
      edgeInfo: edges.map((ed) => this.edgeInfo(ed)),
      vertices: this.vertexPoints(shape),
      bbox: bb,
    };
  }

  vertexPoints(shape) {
    const oc = this.oc;
    const verts = this.indexed(shape, this.T.TopAbs_VERTEX);
    const out = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => {
      const p = oc.BRep_Tool.Pnt(oc.TopoDS.Vertex(v));
      out[i * 3] = p.X();
      out[i * 3 + 1] = p.Y();
      out[i * 3 + 2] = p.Z();
      p.delete();
      v.delete();
    });
    return out;
  }

  faceInfo(face) {
    const oc = this.oc;
    const r = this.scope();
    try {
      const ad = r(new oc.BRepAdaptor_Surface(face, true));
      const t = ad.GetType();
      const ST = oc.GeomAbs_SurfaceType;
      const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const props = r(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(face, props, false, false);
      const c = r(props.CentreOfMass());
      const info = { type: 'other', area: props.Mass(), center: [c.X(), c.Y(), c.Z()] };
      if (t === ST.GeomAbs_Plane) {
        const pl = r(ad.Plane());
        const ax = r(pl.Position());
        const n = r(ax.Direction());
        const x = r(ax.XDirection());
        const s = reversed ? -1 : 1;
        info.type = 'plane';
        info.normal = [n.X() * s, n.Y() * s, n.Z() * s];
        info.xDir = [x.X(), x.Y(), x.Z()];
      } else if (t === ST.GeomAbs_Cylinder) {
        const cy = r(ad.Cylinder());
        const ax = r(cy.Axis());
        const loc = r(ax.Location());
        const d = r(ax.Direction());
        info.type = 'cylinder';
        info.radius = cy.Radius();
        info.axis = { origin: [loc.X(), loc.Y(), loc.Z()], dir: [d.X(), d.Y(), d.Z()] };
      } else if (t === ST.GeomAbs_Sphere) info.type = 'sphere';
      else if (t === ST.GeomAbs_Cone) info.type = 'cone';
      else if (t === ST.GeomAbs_Torus) info.type = 'torus';
      else if (t === ST.GeomAbs_BSplineSurface || t === ST.GeomAbs_BezierSurface) info.type = 'freeform';
      return info;
    } catch {
      return { type: 'other' };
    } finally {
      r.free();
    }
  }

  edgeInfo(edge) {
    const oc = this.oc;
    const r = this.scope();
    try {
      const ad = r(new oc.BRepAdaptor_Curve(edge));
      const t = ad.GetType();
      const CT = oc.GeomAbs_CurveType;
      const u0 = ad.FirstParameter();
      const u1 = ad.LastParameter();
      const a = r(ad.Value(u0));
      const b = r(ad.Value(u1));
      const props = r(new oc.GProp_GProps());
      oc.BRepGProp.LinearProperties(edge, props, false, false);
      const info = { type: 'other', length: props.Mass(), a: [a.X(), a.Y(), a.Z()], b: [b.X(), b.Y(), b.Z()] };
      if (t === CT.GeomAbs_Line) info.type = 'line';
      else if (t === CT.GeomAbs_Circle) {
        const ci = r(ad.Circle());
        const ax = r(ci.Axis());
        const loc = r(ax.Location());
        const d = r(ax.Direction());
        info.type = 'circle';
        info.radius = ci.Radius();
        info.center = [loc.X(), loc.Y(), loc.Z()];
        info.axisDir = [d.X(), d.Y(), d.Z()];
        info.closed = Math.abs(u1 - u0 - Math.PI * 2) < 1e-6;
      } else if (t === CT.GeomAbs_Ellipse) info.type = 'ellipse';
      else if (t === CT.GeomAbs_BSplineCurve || t === CT.GeomAbs_BezierCurve) info.type = 'spline';
      return info;
    } catch {
      return { type: 'other', length: 0 };
    } finally {
      r.free();
    }
  }

  tessellateMesh(id, e) {
    if (!e.topo) e.topo = meshTopology(e.positions, e.indices, 35);
    const t = e.topo;
    return {
      kind: 'mesh',
      id,
      flat: true,
      positions: t.positions.slice(),
      normals: t.normals.slice(),
      edgeSegments: t.edges.slice(),
      bbox: meshBBox(e.positions),
      triangles: e.indices.length / 3,
      watertight: t.watertight,
    };
  }

  // ---- sketches ----------------------------------------------------------

  // Plane frame: origin, xDir, normal (yDir = normal x xDir).
  frame(plane) {
    const n = norm(plane.normal);
    const x = norm(plane.xDir);
    const y = cross(n, x);
    return { o: plane.origin, x, y, n };
  }

  to3(f, p) {
    return [f.o[0] + f.x[0] * p[0] + f.y[0] * p[1], f.o[1] + f.x[1] * p[0] + f.y[1] * p[1], f.o[2] + f.x[2] * p[0] + f.y[2] * p[1]];
  }

  // Build OCC edges for a sketch's (non-construction) curves.
  sketchEdges(sketch, r, { includeConstruction = false } = {}) {
    const oc = this.oc;
    const f = this.frame(sketch.plane);
    const edges = [];
    for (const ent of sketch.entities) {
      if (ent.construction && !includeConstruction) continue;
      try {
        const e = this.entityEdge(ent, f, r);
        if (e) edges.push(e);
      } catch {
        // Degenerate geometry (zero-length line etc.) is skipped.
      }
    }
    return edges;
  }

  entityEdge(ent, f, r) {
    const oc = this.oc;
    const P = (p) => this.pnt(r, this.to3(f, p));
    switch (ent.type) {
      case 'line': {
        if (dist2(ent.a, ent.b) < 1e-9) return null;
        return r(new oc.BRepBuilderAPI_MakeEdge(P(ent.a), P(ent.b))).Edge();
      }
      case 'circle': {
        if (ent.r < 1e-6) return null;
        const ax = r(new oc.gp_Ax2(P(ent.c), this.dir(r, f.n), this.dir(r, f.x)));
        return r(new oc.BRepBuilderAPI_MakeEdge(r(new oc.gp_Circ(ax, ent.r)))).Edge();
      }
      case 'arc': {
        if (ent.r < 1e-6) return null;
        const a0 = ent.a0;
        let a1 = ent.a1;
        while (a1 <= a0) a1 += Math.PI * 2;
        const am = (a0 + a1) / 2;
        const pt = (a) => [ent.c[0] + ent.r * Math.cos(a), ent.c[1] + ent.r * Math.sin(a)];
        const arc = r(new oc.GC_MakeArcOfCircle(P(pt(a0)), P(pt(am)), P(pt(a1))));
        return r(new oc.BRepBuilderAPI_MakeEdge(r(arc.Value()))).Edge();
      }
      case 'ellipse': {
        const ma = Math.max(ent.rx, ent.ry);
        const mi = Math.min(ent.rx, ent.ry);
        if (mi < 1e-6) return null;
        const rot = ent.rot || 0;
        const ang = ent.rx >= ent.ry ? rot : rot + Math.PI / 2;
        const xd = [Math.cos(ang), Math.sin(ang)];
        const x3 = [f.x[0] * xd[0] + f.y[0] * xd[1], f.x[1] * xd[0] + f.y[1] * xd[1], f.x[2] * xd[0] + f.y[2] * xd[1]];
        const ax = r(new oc.gp_Ax2(P(ent.c), this.dir(r, f.n), this.dir(r, x3)));
        return r(new oc.BRepBuilderAPI_MakeEdge(r(new oc.gp_Elips(ax, ma, mi)))).Edge();
      }
      case 'spline': {
        const pts = ent.pts;
        if (pts.length < 2) return null;
        if (pts.length === 2) return r(new oc.BRepBuilderAPI_MakeEdge(P(pts[0]), P(pts[1]))).Edge();
        const closed = !!ent.closed;
        const n = closed ? pts.length - (dist2(pts[0], pts[pts.length - 1]) < 1e-12 ? 1 : 0) : pts.length;
        const plain = r(new oc.NCollection_Array1_gp_Pnt(1, n));
        for (let i = 0; i < n; i++) plain.SetValue(i + 1, P(pts[i]));
        const arr = r(new oc.NCollection_HArray1_gp_Pnt(plain));
        const interp = r(new oc.GeomAPI_Interpolate(arr, closed, 1e-6));
        interp.Perform();
        if (!interp.IsDone()) return null;
        return r(new oc.BRepBuilderAPI_MakeEdge(r(interp.Curve()))).Edge();
      }
      default:
        return null;
    }
  }

  // Closed regions formed by a sketch's curves. Each region is a planar face
  // kept in the worker so it can be extruded or revolved later.
  sketchRegions(sketch) {
    return this.guard('Finding sketch regions', () => this._sketchRegions(sketch));
  }

  _sketchRegions(sketch) {
    const oc = this.oc;
    const old = this.regionCache.get(sketch.id);
    if (old) old.forEach((f) => f.delete());
    this.regionCache.delete(sketch.id);
    const r = this.scope();
    try {
      const edges = this.sketchEdges(sketch, r);
      if (!edges.length) return { regions: [], curves: this.splineCurves(sketch) };
      const f = this.frame(sketch.plane);
      // Extent of the sketch in plane coordinates.
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      for (const ent of sketch.entities) {
        for (const p of entityExtentPoints(ent)) {
          lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
          hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
        }
      }
      const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1);
      const pad = size * 2 + 10;
      const pln = r(new oc.gp_Pln(r(new oc.gp_Ax3(this.pnt(r, f.o), this.dir(r, f.n), this.dir(r, f.x)))));
      const big = r(new oc.BRepBuilderAPI_MakeFace(pln, lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad)).Face();
      const args = r(new oc.NCollection_List_TopoDS_Shape());
      args.Append(big);
      const tools = r(new oc.NCollection_List_TopoDS_Shape());
      edges.forEach((e) => tools.Append(e));
      const sp = r(new oc.BRepAlgoAPI_Splitter());
      sp.SetArguments(args);
      sp.SetTools(tools);
      sp.SetFuzzyValue(Math.max(1e-7, size * 1e-9));
      sp.Build(r(new oc.Message_ProgressRange()));
      if (sp.HasErrors()) return { regions: [] };
      const result = r(sp.Shape());
      const faces = this.explore(result, this.T.TopAbs_FACE).map((x) => oc.TopoDS.Face(x));
      const keep = [];
      const out = [];
      const margin = pad * 0.5;
      for (const face of faces) {
        const bb = this.bbox(face);
        // Discard the outer face that still touches the padding boundary.
        const pts = bb ? boxCorners(bb) : [];
        const local = pts.map((p) => [dot(sub(p, f.o), f.x), dot(sub(p, f.o), f.y)]);
        const outer = local.some((q) => q[0] < lo[0] - margin || q[1] < lo[1] - margin || q[0] > hi[0] + margin || q[1] > hi[1] + margin);
        if (outer) {
          face.delete();
          continue;
        }
        const props = r(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(face, props, false, false);
        const area = props.Mass();
        if (area < 1e-9) {
          face.delete();
          continue;
        }
        const c = r(props.CentreOfMass());
        const mesh = this.faceMesh(face, size);
        keep.push(face);
        out.push({
          index: keep.length - 1,
          area,
          centroid: [c.X(), c.Y(), c.Z()],
          positions: mesh.positions,
          indices: mesh.indices,
          entities: this.boundaryEntities(face, sketch, f, r),
        });
      }
      this.regionCache.set(sketch.id, keep);
      return { regions: out, curves: this.splineCurves(sketch) };
    } finally {
      r.free();
    }
  }

  // Ids of the sketch curves that form a region's outline (and holes):
  // each boundary edge belongs to the curve nearest its midpoint.
  boundaryEntities(face, sketch, f, r) {
    const oc = this.oc;
    const ids = new Set();
    const ents = sketch.entities.filter((e) => !e.construction && e.type !== 'point');
    for (const e of this.explore(face, this.T.TopAbs_EDGE)) {
      try {
        const ad = r(new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e)));
        const P = r(ad.Value((ad.FirstParameter() + ad.LastParameter()) / 2));
        const v = [P.X() - f.o[0], P.Y() - f.o[1], P.Z() - f.o[2]];
        const q = [dot(v, f.x), dot(v, f.y)];
        let best = null;
        for (const en of ents) {
          const d = closestOnEntity(q, en).d;
          if (!best || d < best.d) best = { id: en.id, d };
        }
        if (best?.id) ids.add(best.id);
      } catch {
        // Unusual edges are skipped.
      } finally {
        e.delete();
      }
    }
    return [...ids].sort();
  }

  // Exact polylines (plane coordinates) for spline entities, for display.
  splineCurves(sketch) {
    const oc = this.oc;
    const out = {};
    const f = this.frame(sketch.plane);
    for (const ent of sketch.entities) {
      if (ent.type !== 'spline') continue;
      const r = this.scope();
      try {
        const edge = this.entityEdge(ent, f, r);
        if (!edge) continue;
        const ad = r(new oc.BRepAdaptor_Curve(edge));
        const u0 = ad.FirstParameter();
        const u1 = ad.LastParameter();
        const n = Math.max(32, ent.pts.length * 16);
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const P = r(ad.Value(u0 + ((u1 - u0) * i) / n));
          const v = [P.X() - f.o[0], P.Y() - f.o[1], P.Z() - f.o[2]];
          pts.push([dot(v, f.x), dot(v, f.y)]);
        }
        out[ent.id] = pts;
      } catch {
        // Fall back to the approximate display curve.
      } finally {
        r.free();
      }
    }
    return out;
  }

  faceMesh(face, size) {
    const oc = this.oc;
    const defl = Math.min(0.5, Math.max(0.002, size * 0.0008));
    const raw = oc.ReplicadMeshExtractor.extract(face, defl, 0.2, true);
    const positions = this.heapCopy(Float32Array, raw.getVerticesPtr(), raw.getVerticesSize());
    const indices = this.heapCopy(Uint32Array, raw.getTrianglesPtr(), raw.getTrianglesSize());
    raw.delete();
    return { positions, indices };
  }

  dropSketches({ ids }) {
    for (const id of ids || []) this.dropSketch(id);
  }

  dropSketch(sketchId) {
    const old = this.regionCache.get(sketchId);
    if (old) old.forEach((f) => f.delete());
    this.regionCache.delete(sketchId);
  }

  // A profile is a sketch region or a planar body face.
  profile(ref) {
    if (ref.type === 'region') {
      const faces = this.regionCache.get(ref.sketchId);
      const f = faces && faces[ref.index];
      if (!f) throw new Error('The sketch region no longer exists');
      return { face: f, normal: ref.normal };
    }
    if (ref.type === 'face') {
      const face = this.face(ref.id, ref.face);
      const info = this.faceInfo(face);
      if (info.type !== 'plane') throw new Error('Only flat faces can be extruded');
      return { face, normal: info.normal, bodyId: ref.id };
    }
    throw new Error('Unknown profile');
  }

  // ---- results -------------------------------------------------------------

  // Results tell the main thread how the body list changes.
  //   { bodies: [{ id, replaces?, from? }], removed: [ids] }
  result(list, removed = []) {
    return {
      bodies: list.map((b) => ({ ...b, mesh: this.tessellate(b.id) })),
      removed,
    };
  }

  storeSolids(shape) {
    return this.solidsOf(shape).map((s) => this.addSolid(s));
  }

  boolOp(kind, a, b, what) {
    const oc = this.oc;
    return this.guard(what || kind, () => {
      const r = this.scope();
      try {
        const Ctor = { fuse: oc.BRepAlgoAPI_Fuse, cut: oc.BRepAlgoAPI_Cut, common: oc.BRepAlgoAPI_Common }[kind];
        const op = r(new Ctor(a, b, r(new oc.Message_ProgressRange())));
        if (op.HasErrors && op.HasErrors()) throw new Error('boolean error');
        op.SimplifyResult(true, true, 1e-4);
        return op.Shape();
      } finally {
        r.free();
      }
    });
  }

  // Fuse many shapes in one go (much faster than one by one, e.g. letters).
  fuseAll(shapes, what) {
    const oc = this.oc;
    if (shapes.length <= 1) return shapes[0] || null;
    return this.guard(what || 'fuse', () => {
      const r = this.scope();
      try {
        const args = r(new oc.NCollection_List_TopoDS_Shape());
        args.Append(shapes[0]);
        const tools = r(new oc.NCollection_List_TopoDS_Shape());
        for (const s of shapes.slice(1)) tools.Append(s);
        const op = r(new oc.BRepAlgoAPI_Fuse());
        op.SetArguments(args);
        op.SetTools(tools);
        op.Build(r(new oc.Message_ProgressRange()));
        if (op.HasErrors()) throw new Error('boolean error');
        op.SimplifyResult(true, true, 1e-4);
        return op.Shape();
      } finally {
        r.free();
      }
    });
  }

  // Cut many tools out of a shape in one go.
  cutAll(shape, tools, what) {
    const oc = this.oc;
    return this.guard(what || 'cut', () => {
      const r = this.scope();
      try {
        const args = r(new oc.NCollection_List_TopoDS_Shape());
        args.Append(shape);
        const list = r(new oc.NCollection_List_TopoDS_Shape());
        for (const s of tools) list.Append(s);
        const op = r(new oc.BRepAlgoAPI_Cut());
        op.SetArguments(args);
        op.SetTools(list);
        op.Build(r(new oc.Message_ProgressRange()));
        if (op.HasErrors()) throw new Error('boolean error');
        op.SimplifyResult(true, true, 1e-4);
        return op.Shape();
      } finally {
        r.free();
      }
    });
  }

  // Apply a tool solid (or a list of tool solids, e.g. one per letter) to
  // the document according to mode. A list is combined with the bodies in
  // one boolean: joining the tools first and then the body can lose parts.
  applyTool(tool, mode, targets, what) {
    const created = [];
    const removed = [];
    const many = Array.isArray(tool);
    const whole = () => (many ? this.fuseAll(tool, what) : tool);
    if (mode === 'new' || !targets.length) {
      for (const id of this.storeSolids(whole())) created.push({ id });
      return this.result(created, removed);
    }
    const meshInvolved = targets.some((t) => this.get(t).kind === 'mesh');
    if (meshInvolved) return this.applyToolMesh(whole(), mode, targets);
    if (mode === 'union') {
      let acc = this.solid(targets[0]);
      for (const t of targets.slice(1)) acc = this.boolOp('fuse', acc, this.solid(t), what);
      acc = many ? this.fuseAll([acc, ...tool], what) : this.boolOp('fuse', acc, tool, what);
      const ids = this.storeSolids(acc);
      ids.forEach((id, i) => created.push(i === 0 ? { id, replaces: targets[0] } : { id, from: targets[0] }));
      removed.push(...targets.slice(1));
      if (!ids.length) removed.push(targets[0]);
      return this.result(created, removed);
    }
    const common = mode !== 'subtract' && many ? whole() : null;
    for (const t of targets) {
      const res = mode === 'subtract' && many ? this.cutAll(this.solid(t), tool, what) : this.boolOp(mode === 'subtract' ? 'cut' : 'common', this.solid(t), common || tool, what);
      const ids = this.storeSolids(res);
      if (!ids.length) removed.push(t);
      ids.forEach((id, i) => created.push(i === 0 ? { id, replaces: t } : { id, from: t }));
    }
    return this.result(created, removed);
  }

  // ---- modelling operations ---------------------------------------------

  extrude({ profiles, distance, symmetric = false, mode = 'new', targets = [] }) {
    const oc = this.oc;
    if (!profiles.length) throw new Error('Select a sketch region or a flat face');
    if (Math.abs(distance) < 1e-6) throw new Error('Distance must not be zero');
    const tool = this.guard('Extrude', () => {
      const r = this.scope();
      try {
        const parts = [];
        for (const ref of profiles) {
          const { face, normal } = this.profile(ref);
          const n = norm(normal);
          let base = face;
          let len = distance;
          if (symmetric) {
            const tr = r(new oc.gp_Trsf());
            tr.SetTranslation(this.vec(r, scale3(n, -Math.abs(distance))));
            base = r(new oc.BRepBuilderAPI_Transform(face, tr, true)).Shape();
            len = Math.abs(distance) * 2;
          }
          const prism = r(new oc.BRepPrimAPI_MakePrism(base, this.vec(r, scale3(n, len)), false, true)).Shape();
          parts.push(prism);
        }
        return parts;
      } finally {
        r.free();
      }
    });
    return this.applyTool(tool, mode, targets, 'Extrude');
  }

  revolve({ profiles, axis, angle = 360, mode = 'new', targets = [] }) {
    const oc = this.oc;
    if (!profiles.length) throw new Error('Select a sketch region or a flat face');
    const tool = this.guard('Revolve', () => {
      const r = this.scope();
      try {
        const ax = r(new oc.gp_Ax1(this.pnt(r, axis.origin), this.dir(r, axis.dir)));
        const parts = [];
        const full = Math.abs(Math.abs(angle) - 360) < 1e-6;
        for (const ref of profiles) {
          const { face } = this.profile(ref);
          const rad = (angle * Math.PI) / 180;
          const rev = r(new oc.BRepPrimAPI_MakeRevol(face, ax, full ? Math.PI * 2 : rad, false)).Shape();
          parts.push(rev);
        }
        return parts;
      } finally {
        r.free();
      }
    });
    return this.applyTool(tool, mode, targets, 'Revolve');
  }

  // Wire from a list of path references (sketch curves or body edges).
  pathWire(path, r) {
    const oc = this.oc;
    const wb = r(new oc.BRepBuilderAPI_MakeWire());
    for (const ref of path) {
      let edge;
      if (ref.type === 'edge') edge = this.edge(ref.id, ref.edge);
      else if (ref.type === 'curve') edge = this.entityEdge(ref.entity, this.frame(ref.plane), r);
      if (edge) wb.Add(edge);
    }
    if (!wb.IsDone()) throw new Error('The path curves must be connected end to end');
    return wb.Wire();
  }

  // twist: degrees the profile turns from start to end; endScale: its size
  // at the end (1 = same size).
  sweep({ profiles, path, mode = 'new', targets = [], twist = 0, endScale = 1 }) {
    const oc = this.oc;
    if (!profiles.length) throw new Error('Select a profile to sweep');
    if (!path.length) throw new Error('Select a path');
    if (!(endScale > 0)) throw new Error('The size at the end must be greater than zero');
    const shaped = Math.abs(twist) > 1e-6 || Math.abs(endScale - 1) > 1e-6;
    const tool = this.guard('Sweep', () => {
      const r = this.scope();
      try {
        const wire = this.pathWire(path, r);
        const parts = [];
        for (const ref of profiles) {
          const { face } = this.profile(ref);
          const s = shaped ? this.shapedSweep(face, wire, twist, endScale, r) : r(new oc.BRepOffsetAPI_MakePipe(wire, face)).Shape();
          parts.push(s);
        }
        return parts;
      } finally {
        r.free();
      }
    });
    return this.applyTool(tool, mode, targets, 'Sweep');
  }

  // A sweep that twists and/or changes size: copies of the profile placed
  // along the path (turning with it, without extra roll), joined by a loft.
  shapedSweep(face, wire, twist, endScale, r) {
    const oc = this.oc;
    const curve = r(new oc.BRepAdaptor_CompCurve(wire, true));
    if (curve.IsClosed()) throw new Error('Twist and end size need a path with two ends');
    const u0 = curve.FirstParameter();
    const u1 = curve.LastParameter();
    const M = 240;
    const pts = [];
    for (let i = 0; i <= M; i++) {
      const p = r(curve.EvalD0(u0 + ((u1 - u0) * i) / M));
      pts.push([p.X(), p.Y(), p.Z()]);
    }
    // Start at the end of the path nearest the profile.
    const c = this.faceInfo(face).center;
    if (dist2(pts[M], c) < dist2(pts[0], c)) pts.reverse();
    const mats = sweepSections(pts, { twist, endScale });
    const loftOf = (w) => {
      const ts = r(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6));
      for (const m of mats) {
        const moved = r(new oc.BRepBuilderAPI_Transform(w, this.trsf(r, m), true)).Shape();
        ts.AddWire(oc.TopoDS.Wire(moved));
      }
      ts.CheckCompatibility(false);
      ts.Build(r(new oc.Message_ProgressRange()));
      if (!ts.IsDone()) throw new Error('could not make the shape');
      return ts.Shape();
    };
    const outer = r(oc.BRepTools.OuterWire(face));
    let solid = loftOf(outer);
    for (const w of this.explore(face, this.T.TopAbs_WIRE)) {
      if (w.IsSame(outer)) continue;
      solid = this.boolOp('cut', solid, loftOf(oc.TopoDS.Wire(w)), 'Sweep');
    }
    return solid;
  }

  // Wrap sketch regions onto a body face and raise them (height > 0) or
  // engrave them (height < 0). Flat faces: the regions are placed on the
  // face. Curved faces: the regions are wrapped around it (see embossCurved),
  // like a label on a can or a logo on a ball.
  emboss({ profiles, target, height, mode = 'auto' }) {
    if (!profiles.length) throw new Error('Select the sketch shapes (e.g. text) to wrap');
    if (!target) throw new Error('Select the face to wrap them onto');
    if (Math.abs(height) < 1e-6) throw new Error('Height must not be zero');
    const targetFace = this.face(target.id, target.face);
    const info = this.faceInfo(targetFace);
    const faces = profiles.map((p) => this.profile(p).face);
    const tool = this.guard('Wrap & Emboss', () => {
      const r = this.scope();
      try {
        if (info.type === 'plane') return this.embossFlat(faces, info, height, r);
        return this.embossCurved(faces, targetFace, info, height, r);
      } finally {
        r.free();
      }
    });
    const op = mode === 'new' ? 'new' : height > 0 ? 'union' : 'subtract';
    if (op === 'new' && height < 0) throw new Error('Engraving needs the body: choose Automatic');
    return this.applyTool(tool, op, op === 'new' ? [] : [target.id], 'Wrap & Emboss');
  }

  embossFlat(faces, info, height, r) {
    const oc = this.oc;
    const n = norm(info.normal);
    const parts = [];
    for (const face of faces) {
      const fi = this.faceInfo(face);
      if (Math.abs(Math.abs(dot(norm(fi.normal), n)) - 1) > 1e-6) throw new Error('For a flat face, draw on the face or a plane parallel to it');
      // Move the shape onto the face, then raise or sink it.
      const off = dot(sub(info.center, fi.center), n);
      const tr = r(new oc.gp_Trsf());
      tr.SetTranslation(this.vec(r, scale3(n, off)));
      const placed = r(new oc.BRepBuilderAPI_Transform(face, tr, true)).Shape();
      const prism = r(new oc.BRepPrimAPI_MakePrism(placed, this.vec(r, scale3(n, height)), false, true)).Shape();
      parts.push(prism);
    }
    return parts;
  }

  // Wrap onto a curved face. Round faces (cylinders, balls) get their own
  // surface turned so the shapes sit around the point facing them, and are
  // rolled on keeping their sizes; other faces (cones, rings, free-form) are
  // mapped through their own surface, true to size around that point.
  embossCurved(faces, target, info, height, r) {
    const oc = this.oc;
    const eps = Math.min(0.05, Math.abs(height) * 0.1);
    const raise = height > 0;
    let mid = [0, 0, 0];
    for (const f of faces) mid = mid.map((v, i) => v + this.faceInfo(f).center[i] / faces.length);
    // The point of the face the shapes look at: on the line through their
    // middle, square to their plane (the nearest one if both ways hit).
    const tsurf = oc.BRep_Tool.Surface(target);
    const ns = norm(this.faceInfo(faces[0]).normal);
    let best = null;
    for (const t of [0, 1, -1, 3, -3, 10, -10, 30, -30, 100, -100]) {
      const q = mid.map((v, i) => v + ns[i] * t);
      const proj = r(new oc.GeomAPI_ProjectPointOnSurf(this.pnt(r, q), tsurf));
      if (!proj.NbPoints()) continue;
      const P = r(proj.NearestPoint());
      const w = sub([P.X(), P.Y(), P.Z()], mid);
      const off = Math.hypot(...cross(w, ns));
      const score = off + Math.hypot(...w) * 1e-3 + (dot(w, ns) < 0 ? 1e-6 : 0);
      if (!best || score < best.score - 1e-9) best = { score, ...proj.LowerDistanceParameters() };
    }
    if (!best) throw new Error('The shapes are too far from the face');
    const { U: u0, V: v0 } = best;
    const d1 = (srf, u, v) => {
      const P = r(new oc.gp_Pnt(0, 0, 0));
      const Su = r(new oc.gp_Vec(0, 0, 0));
      const Sv = r(new oc.gp_Vec(0, 0, 0));
      srf.D1(u, v, P, Su, Sv);
      return { P: [P.X(), P.Y(), P.Z()], Su: [Su.X(), Su.Y(), Su.Z()], Sv: [Sv.X(), Sv.Y(), Sv.Z()] };
    };
    const at = d1(tsurf, u0, v0);
    const P0 = at.P;
    let nOut = norm(cross(at.Su, at.Sv));
    if (target.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) nOut = scale3(nOut, -1);
    for (const f of faces) {
      if (Math.abs(dot(norm(this.faceInfo(f).normal), nOut)) < 0.3) throw new Error('Draw the shapes on a plane that faces the curved face');
    }
    // Base surface for the shapes, moved slightly into the body (raise) or
    // out of it (engrave) so the result overlaps the body.
    const into = raise ? -eps : eps; // along nOut
    let surf;
    let map;
    let offset = 0;
    // The face's outward direction at a point of `surf`.
    let outAt;
    if (info.type === 'cylinder' || info.type === 'sphere') {
      const ad = r(new oc.BRepAdaptor_Surface(target, true));
      const round = info.type === 'cylinder' ? r(ad.Cylinder()) : r(ad.Sphere());
      const R = round.Radius();
      let C;
      let axis;
      if (info.type === 'cylinder') {
        const pos = r(round.Position());
        const loc = r(pos.Location());
        const dir = r(pos.Direction());
        C = [loc.X(), loc.Y(), loc.Z()];
        axis = [dir.X(), dir.Y(), dir.Z()];
      } else {
        const loc = r(round.Location());
        C = [loc.X(), loc.Y(), loc.Z()];
      }
      const toP = sub(P0, C);
      let X = axis ? sub(toP, scale3(axis, dot(toP, axis))) : toP;
      X = norm(X);
      if (!axis) {
        // Keep "up" up: the pole of the ball's own surface is sideways.
        let up = [0, 0, 1];
        if (Math.abs(dot(up, X)) > 0.9) up = [0, 1, 0];
        axis = norm(sub(up, scale3(X, dot(up, X))));
      }
      const Y = cross(axis, X);
      // Convex (outside of a can) or concave (inside of a cup).
      const outward = dot(nOut, X) > 0 ? 1 : -1;
      const R0 = R + into * outward;
      const ax3 = r(new oc.gp_Ax3(this.pnt(r, C), this.dir(r, axis), this.dir(r, X)));
      surf = info.type === 'cylinder' ? new oc.Geom_CylindricalSurface(ax3, R0) : new oc.Geom_SphericalSurface(ax3, R0);
      map = (P) => {
        const v = sub(P, C);
        return info.type === 'cylinder' ? [dot(v, Y) / R, dot(v, axis)] : [dot(v, Y) / R, dot(v, axis) / R];
      };
      const kind = info.type;
      outAt = (P) => {
        const v = sub(P, C);
        return scale3(norm(kind === 'cylinder' ? sub(v, scale3(axis, dot(v, axis))) : v), outward);
      };
    } else {
      // Linear around the nearest point: sizes are kept there.
      surf = tsurf;
      const { Su, Sv } = at;
      const a = dot(Su, Su);
      const b = dot(Su, Sv);
      const c = dot(Sv, Sv);
      const det = a * c - b * b;
      if (Math.abs(det) < 1e-12) throw new Error('The face is too pinched there to wrap onto');
      map = (P) => {
        const w = sub(P, P0);
        const p = dot(Su, w);
        const q = dot(Sv, w);
        return [u0 + (c * p - b * q) / det, v0 + (a * q - b * p) / det];
      };
      offset = into;
      const flip = target.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
      outAt = (P, d) => scale3(norm(cross(d.Su, d.Sv)), flip);
    }
    const bounds = surf.Bounds(0, 0, 0, 0);
    const inside = ([u, v]) => (surf.IsUPeriodic() || (u >= bounds.U1 - 1e-7 && u <= bounds.U2 + 1e-7)) && (surf.IsVPeriodic() || (v >= bounds.V1 - 1e-7 && v <= bounds.V2 + 1e-7));
    const parts = [];
    for (const face of faces) {
      let base = this.wrapFace(face, surf, map, r, inside);
      // Normal of the wrapped face, to offset and thicken the right way.
      const [mu, mv] = map(this.faceInfo(face).center);
      const wd = d1(surf, mu, mv);
      let nW = norm(cross(wd.Su, wd.Sv));
      if (base.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) nW = scale3(nW, -1);
      // Compared where this shape sits: text can reach far round a can.
      const sign = dot(nW, outAt(wd.P, wd)) >= 0 ? 1 : -1;
      if (offset) {
        const off = r(new oc.BRepOffsetAPI_MakeOffsetShape());
        off.PerformBySimple(base, offset * sign);
        const moved = this.explore(off.Shape(), this.T.TopAbs_FACE)[0];
        if (!moved) throw new Error('could not wrap the shape');
        base = oc.TopoDS.Face(moved);
      }
      const thick = r(new oc.BRepOffsetAPI_MakeThickSolid());
      thick.MakeThickSolidBySimple(base, sign * (raise ? height + eps : height - eps));
      let solid = thick.Shape();
      // Turned inside out when the face points inwards.
      const vp = r(new oc.GProp_GProps());
      oc.BRepGProp.VolumeProperties(solid, vp, false, false, false);
      if (vp.Mass() < 0) solid = solid.Reversed();
      parts.push(solid);
    }
    return parts;
  }

  // A planar face rebuilt on `surf`, each curve mapped through `map` (plane
  // point -> surface (u, v)). Curves are converted to B-splines, whose
  // control points map exactly under this kind of (affine) map.
  wrapFace(face, surf, map, r, inside = () => true) {
    const oc = this.oc;
    const wrapWire = (wire) => {
      const list = r(new oc.NCollection_List_TopoDS_Shape());
      for (const ex of this.explore(wire, this.T.TopAbs_EDGE)) {
        const edge = oc.TopoDS.Edge(ex);
        const cv = oc.BRep_Tool.Curve(edge, 0, 0);
        const trimmed = r(new oc.Geom_TrimmedCurve(cv.returnValue, cv.First, cv.Last, true, true));
        const bs = oc.GeomConvert.CurveToBSplineCurve(trimmed, oc.Convert_ParameterisationType.Convert_TgtThetaOver2);
        const np = bs.NbPoles();
        const nk = bs.NbKnots();
        const poles = r(new oc.NCollection_Array1_gp_Pnt2d(1, np));
        const weights = r(new oc.NCollection_Array1_double(1, np));
        for (let i = 1; i <= np; i++) {
          const P = r(bs.Pole(i));
          const [u, v] = map([P.X(), P.Y(), P.Z()]);
          if (!inside([u, v])) throw new Error('The shapes are bigger than the face they are wrapped onto');
          poles.SetValue(i, r(new oc.gp_Pnt2d(u, v)));
          weights.SetValue(i, bs.Weight(i));
        }
        const knots = r(new oc.NCollection_Array1_double(1, nk));
        const mults = r(new oc.NCollection_Array1_int(1, nk));
        for (let i = 1; i <= nk; i++) {
          knots.SetValue(i, bs.Knot(i));
          mults.SetValue(i, bs.Multiplicity(i));
        }
        const c2 = bs.IsRational() ? new oc.Geom2d_BSplineCurve(poles, weights, knots, mults, bs.Degree(), bs.IsPeriodic()) : new oc.Geom2d_BSplineCurve(poles, knots, mults, bs.Degree(), bs.IsPeriodic());
        let ne = r(new oc.BRepBuilderAPI_MakeEdge(c2, surf)).Edge();
        oc.BRepLib.BuildCurves3d(ne);
        if (edge.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) ne = oc.TopoDS.Edge(ne.Reversed());
        list.Append(ne);
      }
      const mw = r(new oc.BRepBuilderAPI_MakeWire());
      mw.Add(list);
      if (!mw.IsDone()) throw new Error('could not wrap the shape');
      return mw.Wire();
    };
    const outer = r(oc.BRepTools.OuterWire(face));
    const mf = r(new oc.BRepBuilderAPI_MakeFace(surf, wrapWire(outer), true));
    for (const w of this.explore(face, this.T.TopAbs_WIRE)) {
      if (!w.IsSame(outer)) mf.Add(wrapWire(oc.TopoDS.Wire(w)));
    }
    if (!mf.IsDone()) throw new Error('could not wrap the shape');
    const fix = r(new oc.ShapeFix_Face(mf.Face()));
    fix.Perform();
    return fix.Face();
  }

  loft({ profiles, mode = 'new', targets = [] }) {
    const oc = this.oc;
    if (profiles.length < 2) throw new Error('Select at least two profiles to loft between');
    const tool = this.guard('Loft', () => {
      const r = this.scope();
      try {
        const ts = r(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6));
        let refDir = null;
        for (const ref of profiles) {
          const { face } = this.profile(ref);
          const aligned = this.alignedWire(face, refDir, r);
          refDir = aligned.startDir;
          ts.AddWire(aligned.wire);
        }
        ts.CheckCompatibility(true);
        ts.Build(r(new oc.Message_ProgressRange()));
        return ts.Shape();
      } finally {
        r.free();
      }
    });
    return this.applyTool(tool, mode, targets, 'Loft');
  }

  // Outer wire of a planar face, rebuilt counter-clockwise (about the face
  // normal) and starting at the point whose direction from the centre best
  // matches refDir, so lofts between profiles do not twist.
  alignedWire(face, refDir, r) {
    const oc = this.oc;
    const info = this.faceInfo(face);
    const n = info.normal || [0, 0, 1];
    const c = info.center;
    const wire = r(oc.BRepTools.OuterWire(face));
    const edges = this.explore(wire, this.T.TopAbs_EDGE).map((e) => oc.TopoDS.Edge(e));
    const ends = (e) => {
      const ad = r(new oc.BRepAdaptor_Curve(e));
      const p0 = r(ad.Value(ad.FirstParameter()));
      const p1 = r(ad.Value(ad.LastParameter()));
      const a = [p0.X(), p0.Y(), p0.Z()];
      const b = [p1.X(), p1.Y(), p1.Z()];
      return e.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED ? [b, a] : [a, b];
    };
    const unit = (v) => norm(v);
    const toDir = (P) => {
      const v = sub(P, c);
      const d = dot(v, n);
      return unit([v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]);
    };
    // A single closed curve: rebuild circles so they start where we want.
    if (edges.length === 1) {
      const ad = r(new oc.BRepAdaptor_Curve(edges[0]));
      if (ad.GetType() === oc.GeomAbs_CurveType.GeomAbs_Circle) {
        const circ = r(ad.Circle());
        const pos = r(circ.Position());
        const ax = r(pos.Direction());
        const X = r(pos.XDirection());
        const Y = r(pos.YDirection());
        const axis = [ax.X(), ax.Y(), ax.Z()];
        const want = refDir || toDir(ends(edges[0])[0]);
        const u0 = Math.atan2(dot(want, [Y.X(), Y.Y(), Y.Z()]), dot(want, [X.X(), X.Y(), X.Z()]));
        let edge = r(new oc.BRepBuilderAPI_MakeEdge(circ, u0, u0 + Math.PI * 2)).Edge();
        if (dot(axis, n) < 0) edge = oc.TopoDS.Edge(edge.Reversed());
        const w = r(new oc.BRepBuilderAPI_MakeWire(edge)).Wire();
        return { wire: w, startDir: want };
      }
      return { wire, startDir: refDir || toDir(ends(edges[0])[0]) };
    }
    // Chain the edges end to start.
    const items = edges.map((e) => ({ e, ends: ends(e) }));
    const chain = [items.shift()];
    while (items.length) {
      const last = chain[chain.length - 1].ends[1];
      let best = 0;
      let bestD = Infinity;
      let flip = false;
      items.forEach((it, i) => {
        const d0 = dist2(it.ends[0], last);
        const d1 = dist2(it.ends[1], last);
        if (d0 < bestD) [best, bestD, flip] = [i, d0, false];
        if (d1 < bestD) [best, bestD, flip] = [i, d1, true];
      });
      const it = items.splice(best, 1)[0];
      chain.push(flip ? { e: oc.TopoDS.Edge(it.e.Reversed()), ends: [it.ends[1], it.ends[0]] } : it);
    }
    // Counter-clockwise about the normal.
    let area = 0;
    for (const it of chain) area += dot(cross(sub(it.ends[0], c), sub(it.ends[1], c)), n);
    let ordered = chain;
    if (area < 0) ordered = chain.slice().reverse().map((it) => ({ e: oc.TopoDS.Edge(it.e.Reversed()), ends: [it.ends[1], it.ends[0]] }));
    // Start at the vertex that best matches the previous profile.
    let k = 0;
    if (refDir) {
      let bestDot = -Infinity;
      ordered.forEach((it, i) => {
        const d = dot(toDir(it.ends[0]), refDir);
        if (d > bestDot) [bestDot, k] = [d, i];
      });
    }
    const rotated = [...ordered.slice(k), ...ordered.slice(0, k)];
    const wb = r(new oc.BRepBuilderAPI_MakeWire());
    for (const it of rotated) wb.Add(it.e);
    return { wire: wb.Wire(), startDir: toDir(rotated[0].ends[0]) };
  }

  fillet({ id, edges, radius }) {
    const oc = this.oc;
    if (!(radius > 0)) throw new Error('Radius must be greater than zero');
    const shape = this.solid(id);
    const res = this.guard('Fillet', () => {
      const r = this.scope();
      try {
        const b = r(new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational));
        for (const i of edges) b.Add(radius, this.edge(id, i));
        b.Build(r(new oc.Message_ProgressRange()));
        if (!b.IsDone()) throw new Error('radius too large for the selected edges');
        return b.Shape();
      } finally {
        r.free();
      }
    });
    const ids = this.storeSolids(res);
    return this.result(ids.map((nid, i) => (i === 0 ? { id: nid, replaces: id } : { id: nid, from: id })));
  }

  chamfer({ id, edges, distance }) {
    const oc = this.oc;
    if (!(distance > 0)) throw new Error('Distance must be greater than zero');
    const shape = this.solid(id);
    const res = this.guard('Chamfer', () => {
      const r = this.scope();
      try {
        const b = r(new oc.BRepFilletAPI_MakeChamfer(shape));
        for (const i of edges) b.Add(distance, this.edge(id, i));
        b.Build(r(new oc.Message_ProgressRange()));
        if (!b.IsDone()) throw new Error('distance too large for the selected edges');
        return b.Shape();
      } finally {
        r.free();
      }
    });
    const ids = this.storeSolids(res);
    return this.result(ids.map((nid, i) => (i === 0 ? { id: nid, replaces: id } : { id: nid, from: id })));
  }

  shell({ id, faces, thickness, outward = false }) {
    const oc = this.oc;
    if (!(thickness > 0)) throw new Error('Thickness must be greater than zero');
    const shape = this.solid(id);
    const res = this.guard('Shell', () => {
      const r = this.scope();
      try {
        const list = r(new oc.NCollection_List_TopoDS_Shape());
        for (const i of faces) list.Append(this.face(id, i));
        const b = r(new oc.BRepOffsetAPI_MakeThickSolid());
        b.MakeThickSolidByJoin(shape, list, outward ? thickness : -thickness, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false, r(new oc.Message_ProgressRange()));
        return b.Shape();
      } finally {
        r.free();
      }
    });
    const ids = this.storeSolids(res);
    return this.result(ids.map((nid, i) => (i === 0 ? { id: nid, replaces: id } : { id: nid, from: id })));
  }

  // Tilt faces by `angle` degrees about their line on a neutral plane
  // (draft for moulded or 3D-printed parts).
  draft({ id, faces, angle, plane }) {
    const oc = this.oc;
    if (!faces.length) throw new Error('Select the faces to tilt');
    const shape = this.solid(id);
    const res = this.guard('Draft', () => {
      const r = this.scope();
      try {
        const b = r(new oc.BRepOffsetAPI_DraftAngle(shape));
        const dir = this.dir(r, plane.normal);
        const pln = r(new oc.gp_Pln(this.pnt(r, plane.origin), dir));
        for (const i of faces) {
          b.Add(this.face(id, i), dir, (angle * Math.PI) / 180, pln, true);
          if (!b.AddDone()) throw new Error('a selected face cannot be tilted from this plane');
        }
        b.Build(r(new oc.Message_ProgressRange()));
        if (!b.IsDone()) throw new Error('could not compute the draft');
        return b.Shape();
      } finally {
        r.free();
      }
    });
    const ids = this.storeSolids(res);
    return this.result(ids.map((nid, i) => (i === 0 ? { id: nid, replaces: id } : { id: nid, from: id })));
  }

  // Boolean between bodies. `targets` keep their identity; `tools` are
  // consumed unless keepTools is set.
  boolean({ op, targets, tools = [], keepTools = false }) {
    if (op === 'union') {
      const all = [...targets, ...tools];
      if (all.length < 2) throw new Error('Select at least two bodies to combine');
      if (all.some((id) => this.get(id).kind === 'mesh')) return this.meshBoolean('union', all.slice(0, 1), all.slice(1), keepTools);
      let acc = this.solid(all[0]);
      for (const id of all.slice(1)) acc = this.boolOp('fuse', acc, this.solid(id), 'Union');
      const ids = this.storeSolids(acc);
      return this.result(
        ids.map((id, i) => (i === 0 ? { id, replaces: all[0] } : { id, from: all[0] })),
        all.slice(1),
      );
    }
    if (!targets.length || !tools.length) throw new Error('Select the bodies to keep and the bodies to use as tools');
    if ([...targets, ...tools].some((id) => this.get(id).kind === 'mesh')) return this.meshBoolean(op, targets, tools, keepTools);
    let tool = this.solid(tools[0]);
    for (const id of tools.slice(1)) tool = this.boolOp('fuse', tool, this.solid(id), 'Combine tools');
    const created = [];
    const removed = keepTools ? [] : [...tools];
    for (const t of targets) {
      const res = this.boolOp(op === 'subtract' ? 'cut' : 'common', this.solid(t), tool, op === 'subtract' ? 'Subtract' : 'Intersect');
      const ids = this.storeSolids(res);
      if (!ids.length) removed.push(t);
      ids.forEach((id, i) => created.push(i === 0 ? { id, replaces: t } : { id, from: t }));
    }
    return this.result(created, removed);
  }

  // Split a body with a plane into separate bodies.
  split({ id, plane }) {
    const oc = this.oc;
    const shape = this.solid(id);
    const res = this.guard('Split', () => {
      const r = this.scope();
      try {
        const pln = r(new oc.gp_Pln(this.pnt(r, plane.origin), this.dir(r, plane.normal)));
        const face = r(new oc.BRepBuilderAPI_MakeFace(pln)).Face();
        const args = r(new oc.NCollection_List_TopoDS_Shape());
        args.Append(shape);
        const tools = r(new oc.NCollection_List_TopoDS_Shape());
        tools.Append(face);
        const sp = r(new oc.BRepAlgoAPI_Splitter());
        sp.SetArguments(args);
        sp.SetTools(tools);
        sp.Build(r(new oc.Message_ProgressRange()));
        if (sp.HasErrors()) throw new Error('could not split');
        return sp.Shape();
      } finally {
        r.free();
      }
    });
    const ids = this.storeSolids(res);
    if (ids.length < 2) {
      this.release(ids);
      throw new Error('The plane does not cut through this body');
    }
    return this.result(ids.map((nid, i) => (i === 0 ? { id: nid, replaces: id } : { id: nid, from: id })));
  }

  // matrix: 16 numbers, column-major (three.js Matrix4.elements).
  trsf(r, m) {
    const t = r(new this.oc.gp_Trsf());
    t.SetValues(m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]);
    return t;
  }

  transformShape(id, m) {
    const e = this.get(id);
    if (e.kind === 'mesh') {
      const { positions } = transformMesh(e.positions, m);
      const indices = det3(m) < 0 ? flipWinding(e.indices) : e.indices.slice();
      return this.addMesh(positions, indices);
    }
    return this.guard('Transform', () => {
      const r = this.scope();
      try {
        const t = this.trsf(r, m);
        const s = r(new this.oc.BRepBuilderAPI_Transform(e.shape, t, true)).Shape();
        return this.addSolid(s);
      } finally {
        r.free();
      }
    });
  }

  transform({ ids, matrix, copy = false }) {
    const out = [];
    for (const id of ids) {
      const nid = this.transformShape(id, matrix);
      out.push(copy ? { id: nid, from: id } : { id: nid, replaces: id });
    }
    return this.result(out);
  }

  // Fuse `others` into `base`; returns body changes (no tessellation).
  unionInto(base, others) {
    if (this.get(base).kind === 'mesh' || others.some((id) => this.get(id).kind === 'mesh')) {
      const acc = this.manifoldUnion([base, ...others]);
      const id = this.storeManifold(acc);
      acc.delete();
      return [{ id, replaces: base }];
    }
    let acc = this.solid(base);
    for (const id of others) acc = this.boolOp('fuse', acc, this.solid(id), 'Union');
    return this.storeSolids(acc).map((id, i) => (i === 0 ? { id, replaces: base } : { id, from: base }));
  }

  mirror({ ids, plane, copy = true, union = false }) {
    const m = mirrorMatrix(plane.origin, plane.normal);
    const out = [];
    for (const id of ids) {
      const nid = this.transformShape(id, m);
      if (union && copy) {
        out.push(...this.unionInto(id, [nid]));
        this.release([nid]);
      } else out.push(copy ? { id: nid, from: id } : { id: nid, replaces: id });
    }
    return this.result(out);
  }

  pattern({ ids, kind = 'linear', count = 3, spacing = 10, direction = [1, 0, 0], axis, angle = 360, union = false }) {
    const out = [];
    const n = Math.max(2, Math.floor(count));
    for (const id of ids) {
      const copies = [];
      for (let i = 1; i < n; i++) {
        let m;
        if (kind === 'circular') {
          const full = Math.abs(Math.abs(angle) - 360) < 1e-9;
          const step = (angle * Math.PI) / 180 / (full ? n : n - 1);
          m = rotationMatrix(axis.origin, axis.dir, step * i);
        } else {
          m = translationMatrix(scale3(norm(direction), spacing * i));
        }
        copies.push(this.transformShape(id, m));
      }
      if (union) {
        out.push(...this.unionInto(id, copies));
        this.release(copies);
      } else copies.forEach((c) => out.push({ id: c, from: id }));
    }
    return this.result(out);
  }

  primitive({ type, params, matrix, mode = 'new', targets = [] }) {
    const oc = this.oc;
    const shape = this.guard('Create shape', () => {
      const r = this.scope();
      try {
        let s;
        const p = params;
        if (type === 'box') {
          s = r(new oc.BRepPrimAPI_MakeBox(this.pnt(r, [-p.width / 2, -p.depth / 2, 0]), p.width, p.depth, p.height)).Shape();
        } else if (type === 'cylinder') {
          const ax = r(new oc.gp_Ax2(this.pnt(r, [0, 0, 0]), this.dir(r, [0, 0, 1])));
          s = r(new oc.BRepPrimAPI_MakeCylinder(ax, p.radius, p.height)).Shape();
        } else if (type === 'sphere') {
          const ax = r(new oc.gp_Ax2(this.pnt(r, [0, 0, p.radius]), this.dir(r, [0, 0, 1])));
          s = r(new oc.BRepPrimAPI_MakeSphere(ax, p.radius)).Shape();
        } else if (type === 'cone') {
          s = this.makeCone(r, p.radius, p.topRadius || 0, p.height);
        } else if (type === 'torus') {
          const ax = r(new oc.gp_Ax2(this.pnt(r, [0, 0, p.minor]), this.dir(r, [0, 0, 1])));
          s = r(new oc.BRepPrimAPI_MakeTorus(ax, p.major, p.minor)).Shape();
        } else throw new Error('Unknown shape');
        if (matrix) s = r(new oc.BRepBuilderAPI_Transform(s, this.trsf(r, matrix), true)).Shape();
        return s;
      } finally {
        r.free();
      }
    });
    return this.applyTool(shape, mode, targets, 'Create shape');
  }

  makeCone(r, r1, r2, h) {
    const oc = this.oc;
    // Revolve a right trapezoid around Z.
    const pts = [
      [0, 0, 0],
      [r1, 0, 0],
      [r2, 0, h],
      [0, 0, h],
    ].filter((p, i, arr) => i === 0 || dist2(p, arr[i - 1]) > 1e-12);
    const wb = r(new oc.BRepBuilderAPI_MakeWire());
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (dist2(a, b) < 1e-12) continue;
      wb.Add(r(new oc.BRepBuilderAPI_MakeEdge(this.pnt(r, a), this.pnt(r, b))).Edge());
    }
    const face = r(new oc.BRepBuilderAPI_MakeFace(wb.Wire(), true)).Face();
    const ax = r(new oc.gp_Ax1(this.pnt(r, [0, 0, 0]), this.dir(r, [0, 0, 1])));
    return r(new oc.BRepPrimAPI_MakeRevol(face, ax, Math.PI * 2, false)).Shape();
  }

  // ---- meshes (STL etc.) ------------------------------------------------

  importMesh({ positions, indices }) {
    const merged = mergeVertices(positions, indices);
    if (!merged.indices.length) throw new Error('The file contains no triangles');
    const id = this.addMesh(merged.positions, merged.indices);
    return this.result([{ id }]);
  }

  manifoldFromTriangles(positions, indices, welded = false) {
    const { Manifold, Mesh } = this.mf;
    const m = welded ? { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) } : mergeVertices(positions, indices);
    const mesh = new Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices });
    mesh.merge();
    const man = new Manifold(mesh);
    if (man.status() !== 'NoError' || man.isEmpty()) {
      man.delete();
      return null;
    }
    return man;
  }

  // Cached Manifold for a body (solids are tessellated finely).
  manifoldOf(id, quiet = false) {
    const e = this.get(id);
    if (e.manifold) return e.manifold;
    let man = null;
    try {
      const t = e.kind === 'mesh' ? e : this.tessellateForExport(id, 0.01);
      man = this.manifoldFromTriangles(t.positions, t.indices, e.kind === 'mesh');
    } catch {
      man = null;
    }
    if (!man) {
      if (quiet) return null;
      throw new Error('This mesh has holes or is not watertight, so it cannot be combined with other bodies. Repair it in a mesh tool first.');
    }
    e.manifold = man;
    return man;
  }

  meshFromManifold(man) {
    const m = man.getMesh();
    const np = m.numProp;
    const n = m.vertProperties.length / np;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = m.vertProperties[i * np];
      positions[i * 3 + 1] = m.vertProperties[i * np + 1];
      positions[i * 3 + 2] = m.vertProperties[i * np + 2];
    }
    return { positions, indices: Uint32Array.from(m.triVerts) };
  }

  manifoldFromShape(shape) {
    const oc = this.oc;
    const raw = oc.ReplicadMeshExtractor.extract(shape, 0.01, 0.1, true);
    const positions = this.heapCopy(Float32Array, raw.getVerticesPtr(), raw.getVerticesSize());
    const indices = this.heapCopy(Uint32Array, raw.getTrianglesPtr(), raw.getTrianglesSize());
    raw.delete();
    const man = this.manifoldFromTriangles(positions, indices);
    if (!man) throw new Error('The new shape could not be converted to a mesh');
    return man;
  }

  // Union of several bodies' manifolds. Caller owns the result.
  manifoldUnion(ids) {
    const list = ids.map((id) => this.manifoldOf(id));
    return this.mf.Manifold.union(list);
  }

  storeManifold(man) {
    const { positions, indices } = this.meshFromManifold(man);
    return this.addMesh(positions, indices);
  }

  applyToolMesh(tool, mode, targets) {
    const toolMan = this.manifoldFromShape(tool);
    try {
      if (mode === 'union') {
        const acc = this.mf.Manifold.union([...targets.map((t) => this.manifoldOf(t)), toolMan]);
        const id = this.storeManifold(acc);
        acc.delete();
        return this.result([{ id, replaces: targets[0] }], targets.slice(1));
      }
      const { created, removed } = this.cutOrIntersectMesh(mode, targets, toolMan);
      return this.result(created, removed);
    } finally {
      toolMan.delete();
    }
  }

  cutOrIntersectMesh(mode, targets, toolMan) {
    const created = [];
    const removed = [];
    for (const t of targets) {
      const res = mode === 'subtract' ? this.manifoldOf(t).subtract(toolMan) : this.manifoldOf(t).intersect(toolMan);
      if (res.isEmpty()) removed.push(t);
      else created.push({ id: this.storeManifold(res), replaces: t });
      res.delete();
    }
    return { created, removed };
  }

  meshBoolean(op, targets, tools, keepTools) {
    if (op === 'union') {
      const all = [...targets, ...tools];
      const acc = this.manifoldUnion(all);
      const id = this.storeManifold(acc);
      acc.delete();
      return this.result([{ id, replaces: all[0] }], all.slice(1));
    }
    const tool = this.manifoldUnion(tools);
    try {
      const { created, removed } = this.cutOrIntersectMesh(op, targets, tool);
      if (!keepTools) removed.push(...tools);
      return this.result(created, removed);
    } finally {
      tool.delete();
    }
  }

  // Turn a triangle mesh into an editable solid. Coplanar triangles are
  // merged into single faces so flat areas can be pushed, pulled and filleted.
  meshToSolid({ id, maxTriangles = 60000 }) {
    const oc = this.oc;
    const e = this.get(id);
    if (e.kind !== 'mesh') throw new Error('Select a mesh body');
    const tris = e.indices.length / 3;
    if (tris > maxTriangles) {
      throw new Error(`This mesh has ${tris.toLocaleString('en-US')} triangles. Converting more than ${maxTriangles.toLocaleString('en-US')} would be very slow; reduce it in a mesh tool first.`);
    }
    const shape = this.guard('Convert to solid', () => {
      const r = this.scope();
      try {
        const stl = writeBinarySTL(e.positions, e.indices);
        const file = `/mesh_${Date.now()}.stl`;
        oc.FS.writeFile(file, stl);
        const reader = r(new oc.StlAPI_Reader());
        const comp = r(new oc.TopoDS_Shell());
        const ok = reader.Read(comp, file);
        oc.FS.unlink(file);
        if (!ok) throw new Error('could not read triangles');
        const bb = meshBBox(e.positions);
        const size = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
        const sew = r(new oc.BRepBuilderAPI_Sewing(Math.max(1e-6, size * 1e-6), true, true, true, false));
        sew.Add(comp);
        sew.Perform(r(new oc.Message_ProgressRange()));
        const sewn = r(sew.SewedShape());
        const unify = r(new oc.ShapeUpgrade_UnifySameDomain(sewn, true, true, false));
        unify.Build();
        const up = r(unify.Shape());
        const shells = this.explore(up, this.T.TopAbs_SHELL);
        if (!shells.length) throw new Error('no closed shell found');
        const ms = r(new oc.BRepBuilderAPI_MakeSolid());
        for (const s of shells) ms.Add(oc.TopoDS.Shell(s));
        let solid = ms.Solid();
        // Make sure the solid is not inside-out.
        const props = r(new oc.GProp_GProps());
        oc.BRepGProp.VolumeProperties(solid, props, false, false, false);
        if (props.Mass() < 0) solid = solid.Reversed();
        return solid;
      } finally {
        r.free();
      }
    });
    const nid = this.addSolid(shape);
    return this.result([{ id: nid, replaces: id }]);
  }

  // ---- measuring ---------------------------------------------------------

  // items: [{ kind: 'body'|'face'|'edge'|'vertex'|'point', id, index, point }]
  measure({ items }) {
    const oc = this.oc;
    const out = { items: [], pair: null };
    const r = this.scope();
    try {
      const shapes = [];
      for (const it of items) {
        if (it.kind === 'body') {
          const e = this.get(it.id);
          if (e.kind === 'mesh') {
            out.items.push({ kind: 'body', mesh: true, volume: meshVolume(e.positions, e.indices), area: meshArea(e.positions, e.indices), bbox: meshBBox(e.positions), triangles: e.indices.length / 3 });
            shapes.push(null);
            continue;
          }
          const vp = r(new oc.GProp_GProps());
          oc.BRepGProp.VolumeProperties(e.shape, vp, false, false, false);
          const sp = r(new oc.GProp_GProps());
          oc.BRepGProp.SurfaceProperties(e.shape, sp, false, false);
          const c = r(vp.CentreOfMass());
          out.items.push({ kind: 'body', volume: Math.abs(vp.Mass()), area: sp.Mass(), center: [c.X(), c.Y(), c.Z()], bbox: this.bbox(e.shape) });
          shapes.push(e.shape);
        } else if (it.kind === 'face') {
          const f = this.face(it.id, it.index);
          out.items.push({ kind: 'face', ...this.faceInfo(f) });
          shapes.push(f);
        } else if (it.kind === 'edge') {
          const ed = this.edge(it.id, it.index);
          out.items.push({ kind: 'edge', ...this.edgeInfo(ed) });
          shapes.push(ed);
        } else if (it.kind === 'point') {
          const v = r(new oc.BRepBuilderAPI_MakeVertex(this.pnt(r, it.point))).Vertex();
          out.items.push({ kind: 'point', point: it.point });
          shapes.push(v);
        } else {
          shapes.push(null);
          out.items.push({ kind: it.kind });
        }
      }
      if (shapes.length === 2 && shapes[0] && shapes[1]) {
        const d = r(new oc.BRepExtrema_DistShapeShape(shapes[0], shapes[1]));
        if (d.IsDone() && d.NbSolution() > 0) {
          const p1 = r(d.PointOnShape1(1));
          const p2 = r(d.PointOnShape2(1));
          out.pair = { distance: d.Value(), p1: [p1.X(), p1.Y(), p1.Z()], p2: [p2.X(), p2.Y(), p2.Z()] };
        }
        const a = out.items[0];
        const b = out.items[1];
        const dirA = a.type === 'plane' ? a.normal : a.type === 'line' ? sub(a.b, a.a) : null;
        const dirB = b.type === 'plane' ? b.normal : b.type === 'line' ? sub(b.b, b.a) : null;
        if (dirA && dirB) {
          const cos = Math.abs(dot(norm(dirA), norm(dirB)));
          let ang = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
          // Plane vs line: angle between line and plane.
          if ((a.type === 'plane') !== (b.type === 'plane')) ang = 90 - ang;
          if (out.pair) out.pair.angle = ang;
          else out.pair = { angle: ang };
        }
      }
      return out;
    } finally {
      r.free();
    }
  }

  // ---- import / export -----------------------------------------------

  tessellateForExport(id, tolerance = 0.01) {
    const e = this.get(id);
    if (e.kind === 'mesh') return { positions: e.positions, indices: e.indices };
    const oc = this.oc;
    const raw = oc.ReplicadMeshExtractor.extract(e.shape, tolerance, 0.1, true);
    const positions = this.heapCopy(Float32Array, raw.getVerticesPtr(), raw.getVerticesSize());
    const indices = this.heapCopy(Uint32Array, raw.getTrianglesPtr(), raw.getTrianglesSize());
    raw.delete();
    return { positions, indices };
  }

  exportMeshes({ ids, tolerance = 0.01 }) {
    return { parts: ids.map((id) => ({ id, ...this.tessellateForExport(id, tolerance) })) };
  }

  // Meshes ready for 3D printing: welded into closed surfaces, facing
  // outwards, with size, volume and a watertightness check for each body.
  printMeshes({ ids, tolerance = 0.01 }) {
    const parts = ids.map((id) => {
      const e = this.get(id);
      const t = this.tessellateForExport(id, tolerance);
      let { positions, indices } = mergeVertices(t.positions, t.indices, 1e-5);
      let stats = meshStats(positions, indices);
      // A mesh turned inside out prints as nothing; flip it.
      if (stats.signedVolume < 0) {
        indices = flipWinding(indices);
        stats = { ...stats, signedVolume: -stats.signedVolume };
      }
      return { id, kind: e.kind, positions, indices, stats };
    });
    return { parts };
  }

  // Flat views for 2D drawings: hidden-line removal per view. Each view is
  // { name, normal (towards the viewer), xDir }; results are polylines in
  // the view's 2D coordinates (x right, y up), split into visible and
  // hidden lines. Mesh bodies are skipped (they have no exact edges).
  drawingViews({ ids, views }) {
    const oc = this.oc;
    const solids = ids.filter((id) => this.get(id).kind === 'solid').map((id) => this.get(id).shape);
    if (!solids.length) throw new Error('2D drawings need solid bodies. Convert meshes with Mesh → Solid first.');
    const shape = solids.length === 1 ? solids[0] : this.compound(solids);
    const out = [];
    try {
      for (const v of views) {
        out.push(
          this.guard('2D drawing', () => {
            const r = this.scope();
            try {
              const ax = r(new oc.gp_Ax2(this.pnt(r, [0, 0, 0]), this.dir(r, v.normal), this.dir(r, v.xDir)));
              const algo = r(new oc.HLRBRep_Algo());
              algo.Add(shape, 0);
              algo.Projector(r(new oc.HLRAlgo_Projector(ax)));
              algo.Update();
              algo.Hide();
              const hlr = r(new oc.HLRBRep_HLRToShape(algo));
              const lines = (shapes) => {
                const polys = [];
                for (const sh of shapes) {
                  if (!sh || sh.IsNull()) continue;
                  for (const e of this.explore(sh, this.T.TopAbs_EDGE)) {
                    const pl = this.edgePolyline(oc.TopoDS.Edge(e), r);
                    if (pl.length >= 2) polys.push(pl);
                    e.delete();
                  }
                }
                return polys;
              };
              const visible = lines([r(hlr.VCompound()), r(hlr.OutLineVCompound())]);
              const hidden = lines([r(hlr.HCompound()), r(hlr.OutLineHCompound())]);
              return { name: v.name, visible, hidden };
            } finally {
              r.free();
            }
          }),
        );
      }
    } finally {
      if (solids.length > 1) shape.delete();
    }
    return { views: out };
  }

  // Points along an edge (x, y of a projected edge; z is ignored).
  edgePolyline(edge, r) {
    const oc = this.oc;
    const ad = r(new oc.BRepAdaptor_Curve(edge));
    const u0 = ad.FirstParameter();
    const u1 = ad.LastParameter();
    const straight = ad.GetType() === oc.GeomAbs_CurveType.GeomAbs_Line;
    const n = straight ? 1 : 48;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const P = r(ad.Value(u0 + ((u1 - u0) * i) / n));
      pts.push([P.X(), P.Y()]);
    }
    return pts;
  }

  exportSTEP({ ids }) {
    const oc = this.oc;
    const solids = ids.filter((id) => this.get(id).kind === 'solid');
    if (!solids.length) throw new Error('STEP export needs solid bodies. Meshes can be exported as STL, OBJ or 3MF.');
    return this.guard('STEP export', () => {
      const r = this.scope();
      try {
        const shape = solids.length === 1 ? this.solid(solids[0]) : r(this.compound(solids.map((id) => this.solid(id))));
        const w = r(new oc.STEPControl_Writer());
        oc.Interface_Static.SetIVal('write.step.schema', 5);
        oc.Interface_Static.SetCVal('write.step.unit', 'MM');
        w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, r(new oc.Message_ProgressRange()));
        const file = `/export_${Date.now()}.step`;
        if (w.Write(file) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('write error');
        const data = oc.FS.readFile(file);
        oc.FS.unlink(file);
        return { data, skipped: ids.length - solids.length };
      } finally {
        r.free();
      }
    });
  }

  importSTEP({ data }) {
    const oc = this.oc;
    const shape = this.guard('STEP import', () => {
      const r = this.scope();
      const file = `/import_${Date.now()}.step`;
      oc.FS.writeFile(file, data);
      try {
        const reader = r(new oc.STEPControl_Reader());
        if (reader.ReadFile(file) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('unreadable file');
        reader.TransferRoots(r(new oc.Message_ProgressRange()));
        return reader.OneShape();
      } finally {
        try {
          oc.FS.unlink(file);
        } catch {}
        r.free();
      }
    });
    const ids = this.storeSolids(shape);
    if (!ids.length) throw new Error('The STEP file contains no solid geometry');
    return this.result(ids.map((id) => ({ id })));
  }

  serialize({ ids }) {
    const out = {};
    for (const id of ids) {
      const e = this.get(id);
      if (e.kind === 'mesh') out[id] = { kind: 'mesh', positions: e.positions, indices: e.indices };
      else out[id] = { kind: 'solid', brep: this.oc.BRepToolsWrapper.Write(e.shape) };
    }
    return out;
  }

  deserialize({ items }) {
    const map = {};
    for (const [key, item] of Object.entries(items)) {
      if (item.kind === 'mesh') map[key] = this.addMesh(Float32Array.from(item.positions), Uint32Array.from(item.indices));
      else map[key] = this.addSolid(this.guard('Reading design', () => this.oc.BRepToolsWrapper.Read(item.brep)));
    }
    return { map, meshes: Object.fromEntries(Object.values(map).map((id) => [id, this.tessellate(id)])) };
  }

  bodyInfo({ id }) {
    const e = this.get(id);
    if (e.kind === 'mesh') return { kind: 'mesh', triangles: e.indices.length / 3, bbox: meshBBox(e.positions) };
    return { kind: 'solid', faces: this.faces(id).length, edges: this.edges(id).length, bbox: this.bbox(e.shape) };
  }
}

// ---- pure helpers (exported for tests) ----------------------------------

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale3(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}
function dist2(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

function boxCorners(bb) {
  const out = [];
  for (const x of [bb.min[0], bb.max[0]]) for (const y of [bb.min[1], bb.max[1]]) for (const z of [bb.min[2], bb.max[2]]) out.push([x, y, z]);
  return out;
}

export function entityExtentPoints(ent) {
  switch (ent.type) {
    case 'line':
      return [ent.a, ent.b];
    case 'circle':
    case 'arc':
      return [
        [ent.c[0] - ent.r, ent.c[1] - ent.r],
        [ent.c[0] + ent.r, ent.c[1] + ent.r],
      ];
    case 'ellipse': {
      const m = Math.max(ent.rx, ent.ry);
      return [
        [ent.c[0] - m, ent.c[1] - m],
        [ent.c[0] + m, ent.c[1] + m],
      ];
    }
    case 'spline':
      return ent.pts;
    case 'point':
      return [ent.p];
    default:
      return [];
  }
}

// Placements of a sweep's profile along a path (points sampled from the
// end where the profile is): column-major 4x4 matrices from the profile's
// own position to each section. Frames follow the path without extra roll
// (rotation-minimizing, by double reflection); the profile also turns by
// `twist` degrees and grows to `endScale` along the way.
export function sweepSections(pts, { twist = 0, endScale = 1, count } = {}) {
  const n = pts.length;
  if (n < 2) throw new Error('The path is too short');
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.sqrt(dist2(pts[i], pts[i - 1])));
  const L = s[n - 1];
  if (L < 1e-9) throw new Error('The path is too short');
  const tan = pts.map((p, i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  // Rotation-minimizing frames.
  const any = Math.abs(tan[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const rr = [norm(cross(tan[0], any))];
  let turning = 0;
  for (let i = 0; i < n - 1; i++) {
    const v1 = sub(pts[i + 1], pts[i]);
    const c1 = dot(v1, v1);
    if (c1 < 1e-18) {
      rr.push(rr[i]);
      continue;
    }
    const rL = sub(rr[i], scale3(v1, (2 / c1) * dot(v1, rr[i])));
    const tL = sub(tan[i], scale3(v1, (2 / c1) * dot(v1, tan[i])));
    const v2 = sub(tan[i + 1], tL);
    const c2 = dot(v2, v2);
    rr.push(norm(c2 < 1e-18 ? rL : sub(rL, scale3(v2, (2 / c2) * dot(v2, rL)))));
    turning += Math.acos(Math.max(-1, Math.min(1, dot(tan[i], tan[i + 1]))));
  }
  const frame = (i) => [tan[i], rr[i], cross(tan[i], rr[i])];
  const F0 = frame(0);
  const k = count || Math.max(6, Math.min(48, Math.round(4 + Math.abs(twist) / 15 + (turning * 180) / Math.PI / 12)));
  const out = [];
  for (let j = 0; j < k; j++) {
    const target = (L * j) / (k - 1);
    let i = 0;
    while (i < n - 1 && s[i + 1] < target) i++;
    i = j === k - 1 ? n - 1 : i;
    const t = s[i] / L;
    const Fk = frame(i);
    // R = Fk · F0ᵀ, then twist about the start tangent and scale.
    const R = [0, 1, 2].map((row) => [0, 1, 2].map((col) => Fk[0][row] * F0[0][col] + Fk[1][row] * F0[1][col] + Fk[2][row] * F0[2][col]));
    const T = rotationMatrix([0, 0, 0], tan[0], (twist * Math.PI * t) / 180);
    const sc = 1 + (endScale - 1) * t;
    const Tw = [
      [T[0], T[4], T[8]],
      [T[1], T[5], T[9]],
      [T[2], T[6], T[10]],
    ];
    const A = [0, 1, 2].map((row) => [0, 1, 2].map((col) => sc * (R[row][0] * Tw[0][col] + R[row][1] * Tw[1][col] + R[row][2] * Tw[2][col])));
    const P0 = pts[0];
    const tr = [0, 1, 2].map((row) => pts[i][row] - (A[row][0] * P0[0] + A[row][1] * P0[1] + A[row][2] * P0[2]));
    out.push([A[0][0], A[1][0], A[2][0], 0, A[0][1], A[1][1], A[2][1], 0, A[0][2], A[1][2], A[2][2], 0, tr[0], tr[1], tr[2], 1]);
  }
  return out;
}

export function translationMatrix(t) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}

// Rotation about an axis through `origin`, column-major 4x4.
export function rotationMatrix(origin, dir, angle) {
  const [x, y, z] = norm(dir);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const R = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  // p' = R(p - o) + o
  const o = origin;
  const ro = [R[0] * o[0] + R[3] * o[1] + R[6] * o[2], R[1] * o[0] + R[4] * o[1] + R[7] * o[2], R[2] * o[0] + R[5] * o[1] + R[8] * o[2]];
  return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, o[0] - ro[0], o[1] - ro[1], o[2] - ro[2], 1];
}

export function mirrorMatrix(origin, normal) {
  const [a, b, c] = norm(normal);
  const d = -(a * origin[0] + b * origin[1] + c * origin[2]);
  return [1 - 2 * a * a, -2 * a * b, -2 * a * c, 0, -2 * a * b, 1 - 2 * b * b, -2 * b * c, 0, -2 * a * c, -2 * b * c, 1 - 2 * c * c, 0, -2 * a * d, -2 * b * d, -2 * c * d, 1];
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

export function transformMesh(positions, m) {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return { positions: out };
}

export function flipWinding(indices) {
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    out[i] = indices[i];
    out[i + 1] = indices[i + 2];
    out[i + 2] = indices[i + 1];
  }
  return out;
}

// Weld identical vertices so the mesh is connected (STL stores every
// triangle separately). Uses an open-addressing hash on quantised
// coordinates, so it stays fast for millions of triangles.
export function mergeVertices(positions, indices, tolerance = 1e-5) {
  const n = positions.length / 3;
  const idx = indices && indices.length ? indices : null;
  const inv = 1 / tolerance;
  let size = 1;
  while (size < n * 2) size <<= 1;
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const qz = new Int32Array(n);
  const remap = new Uint32Array(n);
  const out = new Float32Array(n * 3);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.round(positions[i * 3] * inv);
    const y = Math.round(positions[i * 3 + 1] * inv);
    const z = Math.round(positions[i * 3 + 2] * inv);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    for (;;) {
      const v = table[h];
      if (v === -1) {
        table[h] = count;
        qx[count] = x;
        qy[count] = y;
        qz[count] = z;
        out[count * 3] = positions[i * 3];
        out[count * 3 + 1] = positions[i * 3 + 1];
        out[count * 3 + 2] = positions[i * 3 + 2];
        remap[i] = count++;
        break;
      }
      if (qx[v] === x && qy[v] === y && qz[v] === z) {
        remap[i] = v;
        break;
      }
      h = (h + 1) & mask;
    }
  }
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(n / 3);
  const tri = new Uint32Array(triCount * 3);
  let t = 0;
  for (let i = 0; i < triCount; i++) {
    const a = remap[idx ? idx[i * 3] : i * 3];
    const b = remap[idx ? idx[i * 3 + 1] : i * 3 + 1];
    const c = remap[idx ? idx[i * 3 + 2] : i * 3 + 2];
    if (a === b || b === c || a === c) continue; // degenerate
    tri[t++] = a;
    tri[t++] = b;
    tri[t++] = c;
  }
  return { positions: out.slice(0, count * 3), indices: tri.slice(0, t) };
}

// One pass over a welded mesh: feature edges, whether it is closed
// (every edge shared by exactly two triangles) and per-corner normals that
// stay smooth across gentle bends but crisp at sharp edges.
export function meshTopology(p, idx, angle = 35) {
  const nt = idx.length / 3;
  const cosT = Math.cos((angle * Math.PI) / 180);
  const fn = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    // Area-weighted (unnormalised) normal.
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  // Unit normals, computed once.
  const un = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const x = fn[t * 3];
    const y = fn[t * 3 + 1];
    const z = fn[t * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    un[t * 3] = x / l;
    un[t * 3 + 1] = y / l;
    un[t * 3 + 2] = z / l;
  }
  // Edge table: key (min, max) -> first triangle, count.
  let size = 1;
  while (size < nt * 3) size <<= 1;
  const mask = size - 1;
  const ea = new Int32Array(size).fill(-1);
  const eb = new Int32Array(size);
  const et = new Int32Array(size);
  const ec = new Int32Array(size);
  const ef = new Uint8Array(size); // 1 = feature
  let watertight = true;
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      let a = idx[t * 3 + k];
      let b = idx[t * 3 + ((k + 1) % 3)];
      if (a > b) [a, b] = [b, a];
      let h = (Math.imul(a, -1640531535) ^ Math.imul(b, 40503)) & mask;
      for (;;) {
        if (ea[h] === -1) {
          ea[h] = a;
          eb[h] = b;
          et[h] = t;
          ec[h] = 1;
          break;
        }
        if (ea[h] === a && eb[h] === b) {
          ec[h]++;
          if (ec[h] === 2) {
            const o = et[h] * 3;
            if (un[o] * un[t * 3] + un[o + 1] * un[t * 3 + 1] + un[o + 2] * un[t * 3 + 2] < cosT) ef[h] = 1;
          }
          break;
        }
        h = (h + 1) & mask;
      }
    }
  }
  const segs = [];
  for (let h = 0; h < size; h++) {
    if (ea[h] === -1) continue;
    if (ec[h] !== 2) watertight = false;
    if (ec[h] === 2 && !ef[h]) continue;
    const a = ea[h] * 3;
    const b = eb[h] * 3;
    segs.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2]);
  }
  // Vertex -> triangles adjacency (CSR).
  const nv = p.length / 3;
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < idx.length; i++) start[idx[i] + 1]++;
  for (let v = 0; v < nv; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nv);
  const adj = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) adj[fill[idx[i]]++] = (i / 3) | 0;
  // Non-indexed output with creased normals.
  const positions = new Float32Array(nt * 9);
  const normals = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    const nx = un[t * 3];
    const ny = un[t * 3 + 1];
    const nz = un[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      positions[t * 9 + k * 3] = p[v * 3];
      positions[t * 9 + k * 3 + 1] = p[v * 3 + 1];
      positions[t * 9 + k * 3 + 2] = p[v * 3 + 2];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let j = start[v]; j < start[v + 1]; j++) {
        const o = adj[j] * 3;
        if (un[o] * nx + un[o + 1] * ny + un[o + 2] * nz >= cosT) {
          sx += fn[o];
          sy += fn[o + 1];
          sz += fn[o + 2];
        }
      }
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      normals[t * 9 + k * 3] = sx / l;
      normals[t * 9 + k * 3 + 1] = sy / l;
      normals[t * 9 + k * 3 + 2] = sz / l;
    }
  }
  return { positions, normals, edges: new Float32Array(segs), watertight };
}

export function meshBBox(p) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function meshVolume(p, idx) {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return Math.abs(v);
}

// Facts about a welded triangle mesh for 3D printing: bounding box, volume
// and whether it is a closed surface (every edge shared by exactly two
// triangles, consistently oriented).
export function meshStats(p, idx) {
  const nv = p.length / 3;
  const nt = idx.length / 3;
  const bbox = meshBBox(p);
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  // Edge keys as numbers (safe while nv² < 2^53).
  const und = new Float64Array(nt * 3);
  const dir = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k];
      const b = idx[t * 3 + ((k + 1) % 3)];
      und[t * 3 + k] = a < b ? a * nv + b : b * nv + a;
      dir[t * 3 + k] = a * nv + b;
    }
  }
  und.sort();
  dir.sort();
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (let i = 0; i < und.length; ) {
    let j = i + 1;
    while (j < und.length && und[j] === und[i]) j++;
    const n = j - i;
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
    i = j;
  }
  let flippedEdges = 0;
  for (let i = 1; i < dir.length; i++) if (dir[i] === dir[i - 1]) flippedEdges++;
  return {
    bbox,
    volume: Math.abs(vol),
    signedVolume: vol,
    triangles: nt,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    watertight: nt > 0 && openEdges === 0 && nonManifoldEdges === 0 && flippedEdges === 0,
  };
}

export function meshArea(p, idx) {
  let s = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const cr = cross(u, w);
    s += Math.hypot(cr[0], cr[1], cr[2]) / 2;
  }
  return s;
}

// Per-vertex normals with sharp edges: vertices are split per triangle so
// faceted CAD-style meshes shade correctly.
export function flatNormals(p, idx) {
  const n = new Float32Array(p.length);
  const acc = new Float32Array(p.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const w = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const cr = cross(u, w);
    for (const v of [a, b, c]) {
      acc[v] += cr[0];
      acc[v + 1] += cr[1];
      acc[v + 2] += cr[2];
    }
  }
  for (let i = 0; i < p.length; i += 3) {
    const l = Math.hypot(acc[i], acc[i + 1], acc[i + 2]) || 1;
    n[i] = acc[i] / l;
    n[i + 1] = acc[i + 1] / l;
    n[i + 2] = acc[i + 2] / l;
  }
  return n;
}

// Edges where adjacent triangles meet at more than `angle` degrees, plus
// open boundary edges.
export function featureEdges(p, idx, angle = 35) {
  const cosT = Math.cos((angle * Math.PI) / 180);
  const triN = new Float32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    const cr = norm(cross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]));
    triN[i] = cr[0];
    triN[i + 1] = cr[1];
    triN[i + 2] = cr[2];
  }
  const edges = new Map();
  for (let t = 0; t < idx.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k];
      const b = idx[t * 3 + ((k + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      const e = edges.get(key);
      if (e === undefined) edges.set(key, t);
      else if (e >= 0) {
        const d = triN[e * 3] * triN[t * 3] + triN[e * 3 + 1] * triN[t * 3 + 1] + triN[e * 3 + 2] * triN[t * 3 + 2];
        edges.set(key, d < cosT ? -1 : -2); // -1 feature, -2 smooth
      }
    }
  }
  const out = [];
  for (const [key, v] of edges) {
    if (v === -2) continue;
    const a = Math.floor(key / 4294967296);
    const b = key % 4294967296;
    out.push(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
  }
  return new Float32Array(out);
}

export function writeBinarySTL(positions, indices) {
  const ntri = indices.length / 3;
  const buf = new ArrayBuffer(84 + ntri * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, ntri, true);
  let o = 84;
  for (let i = 0; i < ntri; i++) {
    const a = indices[i * 3] * 3;
    const b = indices[i * 3 + 1] * 3;
    const c = indices[i * 3 + 2] * 3;
    const n = norm(cross([positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]], [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]));
    dv.setFloat32(o, n[0], true);
    dv.setFloat32(o + 4, n[1], true);
    dv.setFloat32(o + 8, n[2], true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, positions[v], true);
      dv.setFloat32(o + 4, positions[v + 1], true);
      dv.setFloat32(o + 8, positions[v + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Uint8Array(buf);
}

export { EPS };
