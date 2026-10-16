// Materials panel (visualization mode): pick a finish and a colour for the
// selected bodies, or for every body when nothing is selected.
import { h, clear } from './dom.js';
import { MATERIALS } from '../view/bodyview.js';
import { BODY_COLORS } from '../view/theme.js';
import { toast } from './overlays.js';
import { t, tn } from '../core/i18n.js';

// CSS preview of each finish.
const SWATCH = {
  plastic: 'radial-gradient(circle at 35% 30%, #fff 0, #cfd6df 18%, #8e98a6 70%, #5d6672 100%)',
  matte: 'radial-gradient(circle at 35% 30%, #d9dde3 0, #aab2bd 55%, #7d8693 100%)',
  glossy: 'radial-gradient(circle at 32% 26%, #fff 0, #fff 8%, #c8d2de 16%, #7f8a99 68%, #4b5361 100%)',
  rubber: 'radial-gradient(circle at 35% 30%, #5b5f66 0, #34373c 60%, #1f2124 100%)',
  metal: 'linear-gradient(135deg, #f3f5f8 0%, #9aa3ad 35%, #e6e9ed 55%, #6d7680 100%)',
  brushed: 'repeating-linear-gradient(90deg, #b9c0c8 0 2px, #a3aab3 2px 4px), linear-gradient(#ccc, #888)',
  chrome: 'linear-gradient(160deg, #ffffff 0%, #8d96a0 30%, #f7f9fb 48%, #3d444c 70%, #c9ced4 100%)',
  glass: 'radial-gradient(circle at 35% 30%, rgba(255,255,255,.95) 0, rgba(200,225,255,.45) 25%, rgba(120,160,210,.35) 70%, rgba(80,110,160,.55) 100%)',
};

export class MaterialsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    app.selection.on('change', () => this.visible && this.render());
    app.doc.on('change', () => this.visible && this.render());
  }

  get visible() {
    return !this.el.hidden;
  }

  show(on) {
    this.el.hidden = !on;
    if (on) this.render();
  }

  targets() {
    const app = this.app;
    const sel = app.cmd.selectedBodyIds();
    return sel.length ? sel : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.id);
  }

  render() {
    const app = this.app;
    clear(this.el);
    const sel = app.cmd.selectedBodyIds();
    const ids = this.targets();
    const first = ids.length ? app.doc.body(ids[0]) : null;
    const current = first?.material || 'plastic';
    const head = h(
      'div.mp-head',
      h('b', { text: 'Materials' }),
      h('small', { text: sel.length ? tn(sel.length, 'For the selected body', 'For the {n} selected bodies') : 'For all bodies — click a body to change just that one' }),
    );
    const grid = h('div.mp-grid');
    for (const [key, m] of Object.entries(MATERIALS)) {
      const b = h(`button.mp-mat${key === current ? '.on' : ''}`, h('span.mp-ball', { style: { background: SWATCH[key] } }), h('span', { text: m.label }));
      b.dataset.material = key;
      b.addEventListener('click', () => {
        const t = this.targets();
        if (!t.length) return toast('There are no bodies to give a material to', { type: 'error' });
        app.cmd.setMaterial(t, key);
      });
      grid.append(b);
    }
    const colors = h('div.mp-colors');
    for (const c of BODY_COLORS) {
      const b = h('button.mp-color', { title: c, style: { background: c } });
      b.addEventListener('click', () => {
        const t = this.targets();
        if (t.length) app.cmd.setColor(t, c);
      });
      colors.append(b);
    }
    const custom = h('input.mp-custom', { type: 'color', value: first?.color || '#c4ccd6', title: 'Any colour' });
    custom.addEventListener('change', () => {
      const t = this.targets();
      if (t.length) app.cmd.setColor(t, custom.value);
    });
    colors.append(custom);
    const exportBtn = h('button.btn.mp-shot', { text: 'Save image (PNG)…' });
    exportBtn.addEventListener('click', () => app.files.exportPNG());
    this.el.append(
      head,
      grid,
      h('div.mp-sub', { text: 'Colour' }),
      colors,
      h('div.mp-tip', { text: 'Orbit to find a nice angle, then save an image. Switch back to Modeling at the top to keep editing.' }),
      exportBtn,
    );
  }
}
