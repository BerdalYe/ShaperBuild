// The tools menu on the right side.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { attachTooltip } from './overlays.js';
import { TOOL_SECTIONS } from '../tools/registry.js';

export class ToolsMenu {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.buttons = new Map();
    this.render();
    app.tools.on('change', () => this.updateActive());
  }

  render() {
    clear(this.el);
    for (const section of TOOL_SECTIONS) {
      const grid = h('div.tools-grid');
      for (const t of section.tools) {
        const b = h('button.tool-btn', { html: icon(t.icon), 'aria-label': t.label });
        b.dataset.tool = t.id;
        attachTooltip(b, () => `<b>${t.label}</b>${t.key ? `<span class="kbd">${t.key}</span>` : ''}<span class="desc">${t.desc || ''}</span>`);
        b.addEventListener('click', () => this.app.tools.activate(t.id));
        grid.append(b);
        this.buttons.set(t.id, b);
      }
      this.el.append(h('div.tools-section', h('div.tools-title', { text: section.title }), grid));
    }
    this.updateActive();
  }

  updateActive() {
    const id = this.app.tools.activeId;
    for (const [tid, b] of this.buttons) b.classList.toggle('active', tid === id);
  }
}
