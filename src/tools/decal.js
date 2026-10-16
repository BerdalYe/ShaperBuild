// Place a decal: after a picture is chosen, click where it goes on a body.
import { Tool } from './base.js';
import { toast } from '../ui/overlays.js';

export class DecalTool extends Tool {
  get pickKinds() {
    return ['face', 'body'];
  }

  // opts: { src, aspect, name }
  activate(opts = {}) {
    this.image = opts.src ? opts : null;
    if (!this.image) return this.done();
    this.setHint('Click a body where the picture should go. Esc cancels.');
    this.app.vp.canvas.style.cursor = 'crosshair';
  }

  deactivate() {
    this.app.vp.canvas.style.cursor = '';
    this.app.selection.setHover(null);
  }

  onPointerMove(e) {
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit ? { kind: 'body', bodyId: hit.bodyId } : null);
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit?.bodyId) return toast('Click on a body', { ms: 1400 });
    const r = this.app.vp.raycastBody(hit.bodyId, e.x, e.y);
    if (!r?.normal) return;
    // Face the viewer (faces can be seen from either side).
    const d = e.ray.dir;
    const n = d[0] * r.normal[0] + d[1] * r.normal[1] + d[2] * r.normal[2] > 0 ? r.normal.map((v) => -v) : r.normal;
    const box = this.app.bodyBox(hit.bodyId);
    const span = box ? Math.max(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) : 50;
    const { src, aspect, name } = this.image;
    const id = this.app.cmd.addDecal({ name: name || 'Decal', bodyId: hit.bodyId, src, aspect, at: r.point, normal: n, size: +Math.max(2, span * 0.35).toFixed(1), rotation: 0, opacity: 1, wrap: false });
    this.done();
    const panel = this.app.materials;
    panel.openDecal = id;
    if (panel.visible) panel.render();
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.done();
      return true;
    }
    return false;
  }
}
