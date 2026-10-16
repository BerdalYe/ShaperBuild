// Three.js objects for one reference axis: a dash-dot line with small
// end marks, pickable like a sketch curve.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { makePickLineMaterial, idColor } from './pick.js';

export class AxisView {
  constructor(ax, ctx) {
    this.ctx = ctx;
    this.ax = ax;
    this.group = new THREE.Group();
    this.pickGroup = new THREE.Group();
    this.pickBase = ctx.registry.alloc(1, () => ({ kind: 'axis', axisId: this.ax.id }));
    this.mat = new LineMaterial({ linewidth: 1.6, worldUnits: false, dashed: true, dashSize: 10, gapSize: 4, dashScale: 1, clippingPlanes: ctx.clippingPlanes });
    ctx.lineMaterials.add(this.mat);
    this.pickMat = makePickLineMaterial();
    this.pickMat.clippingPlanes = ctx.clippingPlanes;
    ctx.pickLineMaterials.add(this.pickMat);
    this.update(ax);
    this.setHighlight(null);
  }

  // The two ends of the drawn axis.
  ends(ax = this.ax) {
    const h = (ax.length || 80) / 2;
    return [ax.origin.map((o, i) => o - ax.dir[i] * h), ax.origin.map((o, i) => o + ax.dir[i] * h)];
  }

  update(ax) {
    this.ax = ax;
    this.disposeGeometry();
    const [a, b] = this.ends(ax);
    const g = new LineSegmentsGeometry();
    g.setPositions([...a, ...b]);
    this.geometry = g;
    this.line = new LineSegments2(g, this.mat);
    this.line.computeLineDistances();
    this.line.renderOrder = 3;
    this.group.add(this.line);
    const pg = new LineSegmentsGeometry();
    pg.setPositions([...a, ...b]);
    const c = idColor(this.pickBase);
    pg.setColors([...c, ...c]);
    this.pickGeometry = pg;
    const pick = new LineSegments2(pg, this.pickMat);
    pick.userData.pickKind = 'axis';
    this.pickGroup.add(pick);
    this.group.visible = this.pickGroup.visible = ax.visible !== false;
  }

  setHighlight(color) {
    this.mat.color.set(color || this.ctx.theme.axisRef || this.ctx.theme.preview);
    this.mat.linewidth = color ? 2.4 : 1.6;
  }

  disposeGeometry() {
    this.group.clear();
    this.pickGroup.clear();
    this.geometry?.dispose();
    this.pickGeometry?.dispose();
  }

  dispose() {
    this.ctx.registry.free(this.pickBase, 1);
    this.disposeGeometry();
    this.ctx.lineMaterials.delete(this.mat);
    this.ctx.pickLineMaterials.delete(this.pickMat);
    this.mat.dispose();
    this.pickMat.dispose();
    this.group.removeFromParent();
    this.pickGroup.removeFromParent();
  }
}
