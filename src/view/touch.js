// Touch screens: one finger drags to orbit, two fingers pan and pinch to
// zoom, a tap is a click, a double tap looks straight at a flat face, and a
// long press then drag reaches the tool (box selection). Tool handles such
// as the extrude arrow can be dragged straight away. Pens work like a mouse.
const MOVE = 8; // pixels before a touch counts as a drag
const LONG = 450; // ms for a long press
const DOUBLE = 320; // ms between the taps of a double tap

export class TouchInput {
  constructor(vp) {
    this.vp = vp;
    this.pts = new Map();
    this.mode = null; // 'wait' | 'orbit' | 'two' | 'forward' | 'done'
    this.lastTap = null;
  }

  down(e) {
    const vp = this.vp;
    vp.canvas.setPointerCapture?.(e.pointerId);
    const p = vp.local(e);
    this.pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.mode === 'forward' || this.mode === 'done') return;
    clearTimeout(this.pressTimer);
    if (this.pts.size === 1) {
      this.mode = 'wait';
      this.start = { id: e.pointerId, e };
      if (vp.pick(p.x, p.y, ['handle'])) return this.forwardStart(e);
      this.pressTimer = setTimeout(() => {
        if (this.mode === 'wait') this.forwardStart(this.start.e);
      }, LONG);
    } else if (this.pts.size === 2) {
      this.mode = 'two';
      this.two = this.pair();
      this.zoomAt = vp.raycastAny(this.two.mx, this.two.my) || vp.pointOnTargetPlane(this.two.mx, this.two.my);
    }
  }

  move(e) {
    const vp = this.vp;
    const pt = this.pts.get(e.pointerId);
    if (!pt) return;
    const p = vp.local(e);
    const dx = p.x - pt.x;
    const dy = p.y - pt.y;
    pt.x = p.x;
    pt.y = p.y;
    if (this.mode === 'forward') {
      if (e.pointerId === this.start.id) {
        vp.pointer = p;
        vp.emit('pointermove', vp.event(e));
      }
      return;
    }
    if (this.mode === 'wait') {
      if (Math.hypot(p.x - pt.sx, p.y - pt.sy) <= MOVE) return;
      clearTimeout(this.pressTimer);
      this.mode = 'orbit';
      this.pivot = vp.raycastAny(pt.sx, pt.sy);
    }
    if (this.mode === 'orbit') {
      vp.rig.orbit(dx, dy, this.pivot);
      vp.requestRender();
      vp.emit('nav', 'orbit');
    } else if (this.mode === 'two' && this.pts.size >= 2) {
      const now = this.pair();
      const was = this.two;
      vp.rig.pan(now.mx - was.mx, now.my - was.my, vp.height);
      if (now.d > 1 && was.d > 1) vp.rig.zoom(was.d / now.d, this.zoomAt);
      this.two = now;
      vp.requestRender();
      vp.emit('nav', 'pan');
    }
  }

  up(e, cancelled = false) {
    const vp = this.vp;
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    vp.canvas.releasePointerCapture?.(e.pointerId);
    clearTimeout(this.pressTimer);
    if (this.mode === 'forward') {
      if (e.pointerId === this.start.id) {
        vp.emit('pointerup', vp.event(e));
        this.mode = this.pts.size ? 'done' : null;
      }
      return;
    }
    if (this.mode === 'wait' && !this.pts.size && !cancelled) this.tap(e);
    if (!this.pts.size) this.mode = null;
    else if (this.mode === 'two') this.mode = 'done';
  }

  // A short touch: a click for the tool, or the second tap of a double tap.
  tap(e) {
    const vp = this.vp;
    const p = vp.local(e);
    vp.pointer = p;
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.t < DOUBLE && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
      this.lastTap = null;
      vp.emit('doubletap', vp.event(e));
      return;
    }
    this.lastTap = { t: now, x: p.x, y: p.y };
    vp.emit('pointermove', vp.event(this.start.e));
    vp.emit('pointerdown', vp.event(this.start.e));
    vp.emit('pointerup', vp.event(e));
  }

  // From now on the touch acts like the left mouse button.
  forwardStart(e) {
    const vp = this.vp;
    clearTimeout(this.pressTimer);
    this.mode = 'forward';
    navigator.vibrate?.(8);
    vp.pointer = vp.local(e);
    vp.emit('pointermove', vp.event(e));
    vp.emit('pointerdown', vp.event(e));
  }

  pair() {
    const [a, b] = [...this.pts.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
}
