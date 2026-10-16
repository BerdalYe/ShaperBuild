// Keeps track of the active tool and routes viewport input to it.
import { Emitter } from '../core/events.js';
import { TOOLS } from './registry.js';

export class ToolManager extends Emitter {
  constructor(app) {
    super();
    this.app = app;
    this.active = null;
    this.activeId = null;
    const vp = app.vp;
    const route = (name) => (e) => {
      if (!this.app.ready) return;
      this.active?.[name]?.(e);
    };
    vp.on('pointerdown', route('onPointerDown'));
    vp.on('pointermove', route('onPointerMove'));
    vp.on('pointerup', route('onPointerUp'));
    vp.on('dblclick', route('onDblClick'));
    vp.on('pointerleave', () => this.app.selection.setHover(null));
    vp.on('contextmenu', (e) => {
      if (!this.active?.onContextMenu(e)) this.app.contextMenu(e);
    });
  }

  activate(id, opts = {}) {
    const def = TOOLS[id];
    if (!def) return;
    if (def.action) {
      def.action(this.app, opts);
      return;
    }
    // Clicking the active tool again turns it off.
    if (this.activeId === id && id !== 'select' && !opts.force) id = 'select';
    const prev = this.active;
    this.active = null;
    if (prev) {
      try {
        prev.deactivate();
      } catch (err) {
        console.error(err);
      }
    }
    this.app.panel.hide();
    this.app.dim.hide();
    this.app.vp.overlay.clear('tool');
    this.app.vp.canvas.style.cursor = '';
    const d = TOOLS[id];
    this.active = new d.Tool(this.app, d);
    this.activeId = id;
    this.app.status.hint('');
    this.active.activate(opts);
    this.emit('change', id);
    this.app.refreshHighlights();
  }

  cancel() {
    this.activate('select');
  }

  get isSelect() {
    return this.activeId === 'select';
  }
}
