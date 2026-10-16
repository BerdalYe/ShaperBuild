// Dimension tool: click a line (length), circle (diameter) or arc (radius),
// or two points (distance). The value is editable straight away and drives
// the sketch from then on.
import { Tool } from './base.js';
import { refsAt } from '../core/solver.js';
import { toast } from '../ui/overlays.js';

export class DimensionTool extends Tool {
  get pickKinds() {
    return ['spoint', 'curve'];
  }

  activate() {
    this.first = null;
    this.setHint('Click a line, circle or arc to dimension it · or click two points for the distance between them');
    this.app.panel.show({
      title: 'Dimension',
      icon: 'dimension',
      hint: 'Dimensions drive the sketch: change the number and the geometry follows. Select two lines and use <b>Constrain → Angle</b> for angles.',
      fields: [],
      onCancel: () => this.done(),
    });
  }

  deactivate() {
    this.app.vp.overlay.clear('tool');
  }

  highlights() {
    return this.first ? [{ item: this.first, color: this.app.vp.theme.select }] : [];
  }

  onPointerMove(e) {
    this.app.selection.setHover(e.pick(this.pickKinds));
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) {
      this.first = null;
      this.app.refreshHighlights();
      return;
    }
    const app = this.app;
    const sk = app.doc.sketch(hit.sketchId);
    if (!sk) return;
    if (hit.kind === 'curve') {
      const en = sk.entities.find((x) => x.id === hit.entityId);
      const type = { line: 'length', circle: 'diameter', arc: 'radius' }[en?.type];
      if (!type) return toast('Pick a line, circle or arc', { type: 'error' });
      if ((sk.constraints || []).some((c) => c.type === type && c.e === en.id)) return toast('That already has a dimension. Click its label to change it.');
      this.first = null;
      app.cmd.addConstraint(sk.id, { type, e: en.id });
      return;
    }
    const ref = refsAt(sk.entities, hit.point)[0];
    if (!ref) return;
    if (!this.first) {
      this.first = { kind: 'spoint', sketchId: sk.id, point: hit.point, ref };
      this.setHint('Click a second point');
      app.refreshHighlights();
      return;
    }
    if (this.first.sketchId !== sk.id) return toast('Both points must be in the same sketch', { type: 'error' });
    const p = this.first.ref;
    this.first = null;
    app.refreshHighlights();
    if (p.e === ref.e && p.p === ref.p) return;
    app.cmd.addConstraint(sk.id, { type: 'distance', p, p2: ref });
    this.setHint('Click a line, circle or arc to dimension it · or click two points for the distance between them');
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.first) {
        this.first = null;
        this.app.refreshHighlights();
      } else this.done();
      return true;
    }
    return false;
  }
}
