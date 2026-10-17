// Drag handles on the inner edges of the Items panel and the tools menu.
// Widths are kept in the settings; a double-click puts a panel back to its
// normal width.
import { h } from './dom.js';

const PANELS = {
  items: { el: 'items', side: 'left', key: 'itemsWidth', min: 180, max: 520, normal: 248 },
  tools: { el: 'tools', side: 'right', key: 'toolsWidth', min: 150, max: 460, normal: 236 },
  toolsCompact: { el: 'tools', side: 'right', key: 'toolsWidthCompact', min: 104, max: 300, normal: 146 },
};

export class PanelResizer {
  constructor(app) {
    this.app = app;
    const vp = document.getElementById('viewport');
    this.handles = {};
    for (const side of ['left', 'right']) {
      const el = h(`div.panel-resizer.${side}`, { title: 'Drag to resize · double-click for the normal width' });
      el.addEventListener('pointerdown', (e) => this.start(e, side));
      el.addEventListener('dblclick', () => this.reset(side));
      vp.append(el);
      this.handles[side] = el;
    }
    this.apply();
  }

  panel(side) {
    if (side === 'left') return PANELS.items;
    return document.getElementById('tools').classList.contains('compact') ? PANELS.toolsCompact : PANELS.tools;
  }

  // Put the saved widths on the panels.
  apply() {
    const s = this.app.settings;
    const ws = document.querySelector('.workspace').style;
    for (const p of Object.values(PANELS)) {
      const w = clampWidth(p, s[p.key]);
      ws.setProperty(`--${p.key}`, `${w}px`);
    }
  }

  start(e, side) {
    if (e.button !== 0) return;
    const p = this.panel(side);
    const el = document.getElementById(p.el);
    if (el.classList.contains('collapsed') || el.style.display === 'none') return;
    e.preventDefault();
    const handle = this.handles[side];
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-panel');
    const x0 = e.clientX;
    const w0 = el.getBoundingClientRect().width;
    let frame = 0;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const w = clampWidth(p, side === 'left' ? w0 + dx : w0 - dx);
      this.app.settings[p.key] = w;
      document.querySelector('.workspace').style.setProperty(`--${p.key}`, `${w}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.app.vp.resize());
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-panel');
      this.app.saveSettings();
      this.app.vp.resize();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  reset(side) {
    const p = this.panel(side);
    delete this.app.settings[p.key];
    this.app.saveSettings();
    this.apply();
    setTimeout(() => this.app.vp.resize(), 30);
  }
}

function clampWidth(p, w) {
  return Math.round(Math.max(p.min, Math.min(p.max, Number.isFinite(w) ? w : p.normal)));
}
