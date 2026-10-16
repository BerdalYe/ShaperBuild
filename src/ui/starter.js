// Helpers in the view: the "start your design" card for an empty design,
// and the hint shown at the top while a tool is active.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

export class StarterCard {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    const action = (ic, title, sub, kbd, fn) => {
      const b = h('button.st-action', h('span.st-ic', { html: icon(ic) }), h('span.st-text', h('b', { text: title }), h('small', { text: sub })), kbd ? h('kbd', { text: kbd }) : null);
      b.addEventListener('click', fn);
      return b;
    };
    el.append(
      h('div.st-title', { text: 'Start your design' }),
      h(
        'div.st-actions',
        action('rect', 'Draw a rectangle', 'Then pull it into 3D', 'R', () => app.tools.activate('rect')),
        action('box', 'Add a box', 'A ready-made shape', '', () => app.tools.activate('box')),
        action('import', 'Import a file', 'STL, OBJ, 3MF, STEP or DXF', '', () => app.files.importDialog()),
        action('learn', 'Take the tutorial', 'Learn the basics in 3 minutes', '', () => app.tutorial.start()),
      ),
      h('div.st-nav', {
        html: `${icon('mouse')}<span>${t('<b>Right-drag</b> to orbit · <b>Middle-drag</b> to pan · <b>Scroll</b> to zoom · <b>Z</b> to fit')}</span>`,
      }),
    );
    app.doc.on('change', () => this.update());
    app.tools.on('change', () => this.update());
    this.update();
  }

  update() {
    const app = this.app;
    const show = app.ready && app.doc.isEmpty && app.tools.isSelect && !app.visual && app.home.el.hidden && !app.tutorial?.active;
    this.el.hidden = !show;
  }
}

export class ToolHint {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  set(html) {
    const app = this.app;
    const tool = app.tools?.active;
    clear(this.el);
    if (!html || !tool || app.tools.isSelect) {
      this.el.hidden = true;
      return false;
    }
    const def = tool.def;
    this.el.append(
      h('span.th-tool', { html: `${icon(def.icon)}<span>${t(def.label)}</span>` }),
      h('span.th-text', { html }),
      h('span.th-esc', { html: '<kbd>Esc</kbd> to exit' }),
    );
    this.el.hidden = false;
    return true;
  }
}
