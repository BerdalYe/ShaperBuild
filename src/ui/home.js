// Start screen: new design, open, import and recent designs.
import { h, clear, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { loadThumbs, moveThumb } from '../fileops.js';
import { showMenu, modal, toast } from './overlays.js';
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
        const more = h('span.rc-more', { html: icon('more'), title: 'More', role: 'button' });
        const card = h('button.recent-card', thumb, h('div.meta', h('b', { str: name }), h('span', { str: p })), more);
        card.dataset.path = p;
        card.addEventListener('click', (e) => {
          if (more.contains(e.target)) return this.cardMenu(e, p, name);
          this.app.files.openPath(p);
        });
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.cardMenu(e, p, name);
        });
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

  // Open, rename, duplicate, versions, show in folder, remove, bin.
  cardMenu(e, p, name) {
    const files = this.app.files;
    const native = window.native;
    const run = (fn) => async () => {
      try {
        await fn();
      } catch (err) {
        toast(t(err.message), { type: 'error' });
      }
      if (!this.el.hidden) this.show();
    };
    showMenu(e.clientX, e.clientY, [
      { label: 'Open', icon: 'folder', action: () => files.openPath(p) },
      {
        label: 'Rename…',
        icon: 'edit',
        action: run(async () => {
          const input = h('input', { type: 'text', value: name });
          const ok = await modal({ title: 'Rename design', body: h('div.form-row', h('label', { text: 'Name' }), input), buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }] });
          if (!ok || !input.value.trim() || input.value.trim() === name) return;
          const to = await native.renameFile(p, input.value.trim());
          moveThumb(p, to);
          if (files.path === p) {
            files.path = to;
            files.name = files.stem(to);
            this.app.updateTitle();
          }
        }),
      },
      { label: 'Duplicate', icon: 'duplicate', action: run(() => native.duplicateFile(p)) },
      { label: 'Versions…', icon: 'history', action: () => files.showVersions(p) },
      { label: 'Show in folder', icon: 'folder', action: () => native.showInFolder(p) },
      '-',
      { label: 'Remove from this list', icon: 'close', action: run(() => native.removeRecent(p)) },
      {
        label: 'Move to the bin…',
        icon: 'trash',
        danger: true,
        action: run(async () => {
          if (files.path === p) throw new Error('Close this design before moving it to the bin');
          const ok = await modal({ title: 'Move to the bin?', body: h('div', { text: t('"{name}" goes to the bin (recycle bin). You can get it back from there.', { name }) }), buttons: [{ label: 'Cancel', value: false }, { label: 'Move to the bin', value: true, danger: true }] });
          if (ok) await native.trashFile(p);
        }),
      },
    ]);
  }

  hide() {
    this.el.hidden = true;
    this.app.vp.resize();
    this.app.starter?.update();
  }
}
