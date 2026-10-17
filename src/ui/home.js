// Start screen: new design, open, import, recent designs and tutorials.
import { h, clear, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { loadThumbs, moveThumb } from '../fileops.js';
import { showMenu, modal, toast } from './overlays.js';
import { t, language } from '../core/i18n.js';
import { LESSONS, LEVELS } from './lessons.js';

// "2 days ago", in the app's language.
function ago(ms) {
  const fmt = new Intl.RelativeTimeFormat(language() === 'nb' ? 'nb' : 'en', { numeric: 'auto' });
  const s = (ms - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return fmt.format(Math.round(s / size), unit);
  }
  return fmt.format(0, 'minute');
}

export class Home {
  constructor(el, app) {
    this.el = el;
    this.app = app;
  }

  async show() {
    const app = this.app;
    if (!app.tools.isSelect) app.tools.cancel();
    const native = window.native;
    const recent = (await native?.getRecent()) || [];
    const times = (await native?.fileTimes?.(recent).catch(() => null)) || {};
    const info = await native?.info().catch(() => null);
    const thumbs = loadThumbs();
    clear(this.el);

    // ---- left: what you can do ----
    const side = (ic, label, fn, cls = '') => {
      const b = h(`button.hs-btn${cls}`, { html: `${icon(ic)}<span>${escapeHtml(label)}</span>` });
      b.addEventListener('click', fn);
      return b;
    };
    const help = side('help', t('Help'), (e) => app.helpMenu(e));
    const sidebar = h(
      'aside.home-side',
      h('div.hs-brand', h('div.logo', { html: icon('logo', 'logo') }), h('b', { str: 'ShaperBuild' })),
      side('plus', t('New design'), () => app.files.newDesign(), '.primary'),
      side('folder', t('Open…'), () => app.files.openDialog()),
      side('import', t('Import…'), () => app.files.importDialog()),
      h('div.hs-sep'),
      side('learn', t('Tutorials'), () => app.tutorial.library()),
      native?.showDesignsFolder ? side('folder2', t('Designs folder'), () => native.showDesignsFolder()) : null,
      h('div.hs-grow'),
      side('settings', t('Settings'), () => app.dialogs.settings()),
      help,
      info?.version ? h('div.hs-version', { str: t('Version {v}', { v: info.version }) }) : null,
    );

    // ---- right: your work and what to learn ----
    const main = h('div.home-main');
    if (!app.doc.isEmpty || app.files.path) {
      const back = h('button.home-back', { html: `${icon('chevron')}<span>${escapeHtml(t('Back to {name}', { name: app.files.name }))}</span>` });
      back.addEventListener('click', () => this.hide());
      main.append(back);
    }
    main.append(h('div.home-head', h('h1', { text: 'Welcome to ShaperBuild' }), h('p', { text: 'Sketch, model and print — precise 3D design on your desktop' })));

    // Continue learning: the next tutorial not finished yet.
    const next = app.tutorial.nextLesson;
    const doneCount = app.tutorial.done.size;
    if (next) {
      const level = LEVELS.find((l) => l.id === next.level);
      const start = h('button.btn.primary.hn-start', { html: `${icon('play')}<span>${escapeHtml(doneCount ? t('Start') : t('Start the tutorial'))}</span>` });
      start.addEventListener('click', () => app.tutorial.start(next.id));
      const all = h('button.btn.hn-all', { text: 'All tutorials' });
      all.addEventListener('click', () => app.tutorial.library());
      main.append(
        h(
          'section.home-next',
          h('div.hn-icon', { html: icon(next.icon) }),
          h(
            'div.hn-text',
            h('span.hn-kicker', { str: `${doneCount ? t('Next tutorial') : t('New here?')} · ${t(level.label)} · ${t('{n} min', { n: next.minutes })}` }),
            h('b', { text: next.title }),
            h('span', { text: next.desc }),
            h('div.hn-progress', h('div', { style: { width: `${(doneCount / LESSONS.length) * 100}%` } })),
            h('small', { str: t('{done} of {n} tutorials done', { done: doneCount, n: LESSONS.length }) }),
          ),
          h('div.hn-buttons', start, all),
        ),
      );
    }

    // Recent designs.
    main.append(h('div.home-sec', h('h2', { text: 'Recent designs' }), recent.length ? h('span.count', { str: String(recent.length) }) : null));
    if (recent.length) {
      const grid = h('div.recent-grid');
      for (const p of recent) {
        const name = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        const thumb = h('div.thumb');
        if (thumbs[p]) thumb.style.backgroundImage = `url(${thumbs[p]})`;
        else thumb.append(h('span.thumb-empty', { html: icon('box') }));
        const more = h('span.rc-more', { html: icon('more'), title: 'More', role: 'button' });
        const when = times[p];
        const missing = p in times && when === null;
        const card = h(
          `button.recent-card${missing ? '.missing' : ''}`,
          thumb,
          h('div.meta', h('b', { str: name }), h('span.rc-when', { str: missing ? t('File not found') : when ? t('Changed {when}', { when: ago(when) }) : '' }), h('span.rc-path', { str: p, title: p })),
          more,
        );
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
      main.append(grid);
    } else {
      const create = h('button.btn.primary', { html: `${icon('plus')}<span>${escapeHtml(t('New design'))}</span>` });
      create.addEventListener('click', () => app.files.newDesign());
      main.append(h('div.home-empty', h('div.he-icon', { html: icon('box') }), h('div', { text: 'Designs you save will show up here.' }), create));
    }

    // Every tutorial, easy to hard.
    main.append(h('div.home-sec', h('h2', { text: 'Tutorials' }), h('span.count', { str: t('{done} of {n} done', { done: doneCount, n: LESSONS.length }) })));
    const done = app.tutorial.done;
    const lessons = h('div.home-lessons');
    for (const l of LESSONS) {
      const level = LEVELS.find((x) => x.id === l.level);
      const card = h(
        `button.home-lesson${done.has(l.id) ? '.done' : ''}`,
        h('span.hl-top', h('span.hl-ic', { html: icon(l.icon) }), h(`span.hl-level.lv${l.level}`, { text: level.label }), done.has(l.id) ? h('span.hl-check', { html: icon('check'), title: 'Done' }) : null),
        h('b', { text: l.title }),
        h('span.hl-desc', { text: l.desc }),
        h('span.hl-min', { str: t('{n} min', { n: l.minutes }) }),
      );
      card.dataset.lesson = l.id;
      card.addEventListener('click', () => app.tutorial.start(l.id));
      lessons.append(card);
    }
    main.append(lessons);

    this.el.append(sidebar, h('div.home-scroll', main));
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
