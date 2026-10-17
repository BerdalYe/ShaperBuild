// Interactive tutorials (the lessons are in lessons.js). Each step points at
// a part of the window and waits until you have actually done the thing it
// asks for.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { modal } from './overlays.js';
import { t } from '../core/i18n.js';
import { LESSONS, LEVELS } from './lessons.js';

const SEEN_KEY = 'shaperbuild.tutorialSeen.v1';
const DONE_KEY = 'shaperbuild.lessonsDone.v1';

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.index = 0;
    this.card = null;
    this.ring = null;
    this.timer = 0;
    this.navCount = { orbit: 0, pan: 0, zoom: 0 };
    // Names of the changes made during the current step (tut.did('Fillet')).
    this.labels = [];
    app.doc.on('change', (ev) => {
      if (this.active && ev?.label) this.labels.push(ev.label);
    });
    const check = () => this.evaluate();
    app.vp.on('nav', (type) => {
      if (!this.active) return;
      this.navCount[type] = (this.navCount[type] || 0) + 1;
      check();
    });
    app.tools.on('change', check);
    app.doc.on('change', check);
    app.selection.on('change', check);
    window.addEventListener('resize', () => this.place());
  }

  get seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return true;
    }
  }

  markSeen() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {}
  }

  // Lessons finished to the end.
  get done() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  markDone(id) {
    const done = this.done;
    done.add(id);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
    } catch {}
  }

  // The first lesson not finished yet.
  get nextLesson() {
    const done = this.done;
    return LESSONS.find((l) => !done.has(l.id)) || null;
  }

  // ---- helpers for the lessons ---------------------------------------------

  did(...labels) {
    return this.labels.some((l) => labels.includes(l));
  }

  didMatch(re) {
    return this.labels.some((l) => re.test(l));
  }

  tool(id) {
    return this.app.tools.activeId === id;
  }

  // A tool's button in the tools menu (a step target).
  toolBtn(id) {
    return () => document.querySelector(`#tools .tool-btn[data-tool="${id}"]`);
  }

  // Unfold the tools-menu section that holds a tool.
  openTool(id) {
    document.querySelector(`#tools .tool-btn[data-tool="${id}"]`)?.closest('.tools-section')?.classList.remove('collapsed');
  }

  // A button in the bar at the bottom of the view (a step target).
  ctx(label) {
    return () => [...document.querySelectorAll('#context-bar .cb-btn')].find((b) => b.textContent.trim() === t(label)) || document.getElementById('context-bar');
  }

  // ---- the lessons list ----------------------------------------------------

  async library() {
    const done = this.done;
    const body = h('div.lessons');
    let close;
    for (const level of LEVELS) {
      const list = LESSONS.filter((l) => l.level === level.id);
      body.append(h('div.lessons-level', h('b', { text: level.label }), h('span', { text: level.desc })));
      for (const l of list) {
        const finished = done.has(l.id);
        const row = h(
          `button.lesson${finished ? '.done' : ''}`,
          h('span.lesson-icon', { html: icon(l.icon) }),
          h('span.lesson-text', h('b', { text: l.title }), h('span', { text: l.desc })),
          h('span.lesson-meta', { html: finished ? `${icon('check')}<span>${t('Done')}</span>` : `<span>${t('{n} min', { n: l.minutes })}</span>` }),
        );
        row.dataset.lesson = l.id;
        row.addEventListener('click', () => {
          close?.();
          this.start(l.id);
        });
        body.append(row);
      }
    }
    await modal({ title: 'Tutorials', body, width: 600, className: 'lessons-modal', buttons: [{ label: 'Close' }], bind: (c) => (close = c) });
  }

  // Welcome dialog on the very first launch.
  async offer() {
    this.markSeen();
    const body = h(
      'div.welcome',
      h('div.wl-art', { html: icon('logo') }),
      h('p', { html: 'ShaperBuild lets you sketch in 2D, pull your sketches into 3D, and export them for 3D printing.' }),
      h('p', { html: 'The <b>interactive tutorial</b> shows you the basics in about 3 minutes: moving around, drawing a sketch, making it 3D and rounding its edges.' }),
      h('p.wl-small', { text: 'You can start it again, and find more tutorials, under Help → Tutorials.' }),
    );
    const v = await modal({
      title: 'Welcome to ShaperBuild',
      body,
      width: 480,
      buttons: [
        { label: 'Skip for now', value: 'skip' },
        { label: 'Start the tutorial', value: 'start', primary: true },
      ],
    });
    if (v === 'start') this.start();
  }

  async start(id = 'basics') {
    const app = this.app;
    const lesson = LESSONS.find((l) => l.id === id) || LESSONS[0];
    if (this.active) this.end();
    this.markSeen();
    app.navHelp?.close();
    if (!app.doc.isEmpty || app.files.path) {
      const ok = await app.files.newDesign();
      if (!ok) return;
    }
    app.home.hide();
    if (app.visual) app.setVisualization(false);
    app.tools.activate('select');
    app.selection.clear();
    app.vp.setView('iso', { fit: true });
    if (app.items.tab !== 'items') app.items.setTab('items');
    this.lesson = lesson;
    await lesson.setup?.(app);
    this.list = lesson.steps(this);
    this.active = true;
    document.body.classList.add('tutorial-on');
    app.starter?.update();
    this.ring = h('div.tut-ring', { hidden: true });
    this.card = h('div.tut-card');
    document.body.append(this.ring, this.card);
    // Some steps wait for things without an event (a tab, a dialog).
    this.timer = setInterval(() => {
      this.place();
      this.evaluate();
    }, 250);
    this.go(0);
  }

  end(finished = false) {
    if (!this.active) return;
    if (finished) this.markDone(this.lesson.id);
    this.active = false;
    clearInterval(this.timer);
    clearTimeout(this.advanceTimer);
    this.card?.remove();
    this.ring?.remove();
    this.card = this.ring = null;
    document.body.classList.remove('tutorial-on');
    this.app.starter?.update();
  }

  go(i) {
    clearTimeout(this.advanceTimer);
    if (i >= this.list.length) return this.end(true);
    this.index = Math.max(0, i);
    this.completed = false;
    this.labels = [];
    const step = this.list[this.index];
    step.enter?.();
    this.render();
    this.place();
    this.evaluate();
  }

  evaluate() {
    if (!this.active || this.completed) return;
    const step = this.list[this.index];
    if (!step.done || !step.done()) return;
    this.completed = true;
    this.render();
    this.advanceTimer = setTimeout(() => this.go(this.index + 1), 900);
  }

  render() {
    const step = this.list[this.index];
    const n = this.list.length;
    clear(this.card);
    const endBtn = h('button.tut-link', { text: 'End tutorial' });
    endBtn.addEventListener('click', () => this.end());
    const back = h('button.btn', { text: 'Previous' });
    back.disabled = this.index === 0;
    back.addEventListener('click', () => this.go(this.index - 1));
    let next;
    if (this.completed) next = h('button.btn.primary.tut-done', { html: `${icon('check')}<span>${t('Done!')}</span>` });
    else if (step.done) next = h('button.btn', { text: 'Skip step' });
    else next = h('button.btn.primary', { text: step.final ? 'Finish' : this.index === 0 ? 'Let’s go' : 'Next' });
    next.addEventListener('click', () => this.go(this.index + 1));
    // The last step offers the next lesson.
    const i = LESSONS.indexOf(this.lesson);
    const following = step.final ? LESSONS.slice(i + 1).find((l) => !this.done.has(l.id)) || LESSONS[i + 1] : null;
    let more = null;
    if (following) {
      more = h('button.btn.tut-next', { html: `<span>${t('Next: {title}', { title: t(following.title) })}</span>${icon('chevron')}` });
      more.addEventListener('click', () => {
        this.end(true);
        this.start(following.id);
      });
    }
    const progress = h('div.tut-progress', h('div', { style: { width: `${((this.index + (this.completed ? 1 : 0)) / (n - 1)) * 100}%` } }));
    this.card.append(
      h('div.tut-top', h('span.tut-count', { str: this.index === 0 ? `${t('Tutorial')} · ${t(LEVELS.find((l) => l.id === this.lesson.level)?.label || '')}` : t('Step {i} of {n}', { i: this.index, n: n - 1 }) }), endBtn),
      progress,
      h('div.tut-title', { text: step.title }),
      h('div.tut-text', { html: step.text }),
    );
    if (step.done && !this.completed) this.card.append(h('div.tut-wait', { html: `<span class="pulse"></span>${t('Waiting for you to try it…')}` }));
    this.card.append(h('div.tut-buttons', back, next));
    if (more) this.card.append(h('div.tut-more', more));
    this.card.classList.toggle('done', this.completed);
  }

  // Position the card and the highlight ring next to the step's target.
  place() {
    if (!this.active || !this.card) return;
    const step = this.list[this.index];
    const target = step.target?.();
    const vp = document.getElementById('viewport').getBoundingClientRect();
    const cr = this.card.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x;
    let y;
    const r = target && target.offsetParent !== null ? target.getBoundingClientRect() : null;
    if (r && r.width && r.height) {
      Object.assign(this.ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
      this.ring.hidden = false;
      const gap = 16;
      if (step.place === 'left') {
        x = r.left - cr.width - gap;
        y = r.top + r.height / 2 - cr.height / 2;
      } else if (step.place === 'right') {
        x = r.right + gap;
        y = r.top + Math.min(40, r.height / 2 - cr.height / 2);
      } else if (step.place === 'bottom') {
        x = r.right - cr.width;
        y = r.bottom + gap;
      } else {
        x = r.left + r.width / 2 - cr.width / 2;
        y = r.top - cr.height - gap;
      }
    } else {
      this.ring.hidden = true;
      if (step.place === 'center') {
        x = vp.left + vp.width / 2 - cr.width / 2;
        y = vp.top + vp.height / 2 - cr.height / 2;
      } else {
        // Top of the view, clear of the tool panel; tool hints sit at the bottom.
        x = vp.left + vp.width / 2 - cr.width / 2;
        const panel = document.querySelector('#tool-panel:not([hidden])')?.getBoundingClientRect();
        if (panel && x < panel.right + 12) x = panel.right + 12;
        y = vp.top + 14;
      }
    }
    this.card.style.left = `${Math.max(8, Math.min(W - cr.width - 8, x))}px`;
    this.card.style.top = `${Math.max(8, Math.min(H - cr.height - 8, y))}px`;
  }
}
