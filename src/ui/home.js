// Start screen: new design, open, import and recent designs.
import { h, clear, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { loadThumbs } from '../fileops.js';
import { t } from '../core/i18n.js';

export class Home {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  async show() {
    const app = this.app;
    if (!app.tools.isSelect) app.tools.cancel();
    clear(this.el);
    const recent = (await window.native?.getRecent()) || [];
    const thumbs = loadThumbs();
    const action = (cls, ic, title, sub, fn) => {
      const b = h(`button.home-action${cls}`, h('div.ha-icon', { html: icon(ic) }), h('div', h('b', { text: title }), h('span', { text: sub })));
      b.addEventListener('click', fn);
      return b;
    };
    const inner = h(
      'div.home-inner',
      h('div.home-brand', h('div.logo', { html: icon('logo', 'logo') }), h('div', h('h1', { text: 'ShaperBuild' }), h('p', { text: 'Sketch, model and print — precise 3D design on your desktop' }))),
      h(
        'div.home-actions',
        action('.primary', 'plus', 'New design', 'Start from an empty workspace', () => this.app.files.newDesign()),
        action('', 'folder', 'Open…', 'A saved .shaperbuild design', () => this.app.files.openDialog()),
        action('', 'import', 'Import STL / OBJ / 3MF / STEP', 'Open a 3D file as a new design', () => this.app.files.importDialog()),
      ),
    );
    const learn = h(
      'button.home-learn',
      h('div.hl-icon', { html: icon('learn') }),
      h('div', h('b', { text: 'New here? Take the interactive tutorial' }), h('span', { text: 'Learn to move around, sketch, extrude and fillet in about 3 minutes.' })),
      h('span.hl-go', { html: `<span>${t('Start')}</span>${icon('chevron')}` }),
    );
    learn.addEventListener('click', () => this.app.tutorial.start());
    inner.append(learn);
    if (!app.doc.isEmpty || app.files.path) {
      const back = h('button.btn', { html: `${icon('chevron')}<span>${escapeHtml(t('Back to {name}', { name: app.files.name }))}</span>` });
      back.querySelector('svg').style.cssText = 'width:16px;height:16px;transform:rotate(180deg)';
      back.addEventListener('click', () => this.hide());
      inner.insertBefore(h('div', { style: { marginBottom: '22px' } }, back), inner.children[1]);
    }
    inner.append(h('h2', { text: 'Recent designs' }));
    if (recent.length) {
      const grid = h('div.recent-grid');
      for (const p of recent) {
        const name = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        const thumb = h('div.thumb');
        if (thumbs[p]) thumb.style.backgroundImage = `url(${thumbs[p]})`;
        const card = h('button.recent-card', thumb, h('div.meta', h('b', { str: name }), h('span', { str: p })));
        card.addEventListener('click', () => this.app.files.openPath(p));
        grid.append(card);
      }
      inner.append(grid);
    } else {
      inner.append(h('div.home-empty', { text: 'Designs you save will show up here.' }));
    }
    this.el.append(inner);
    this.el.hidden = false;
    app.starter?.update();
  }

  hide() {
    this.el.hidden = true;
    this.app.vp.resize();
    this.app.starter?.update();
  }
}
