// Interactive first-run tutorial. Each step points at a part of the window
// and waits until you have actually done the thing it asks for.
import { h, clear, modKey, isMac } from './dom.js';
import { icon } from './icons.js';
import { modal } from './overlays.js';
import { t } from '../core/i18n.js';

const SEEN_KEY = 'shaperbuild.tutorialSeen.v1';

export class Tutorial {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.index = 0;
    this.card = null;
    this.ring = null;
    this.timer = 0;
    this.navCount = { orbit: 0, pan: 0, zoom: 0 };
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

  // Welcome dialog on the very first launch.
  async offer() {
    this.markSeen();
    const body = h(
      'div.welcome',
      h('div.wl-art', { html: icon('logo') }),
      h('p', { html: 'ShaperBuild lets you sketch in 2D, pull your sketches into 3D, and export them for 3D printing.' }),
      h('p', { html: 'The <b>interactive tutorial</b> shows you the basics in about 3 minutes: moving around, drawing a sketch, making it 3D and rounding its edges.' }),
      h('p.wl-small', { text: 'You can start it again any time from Help → Interactive tutorial.' }),
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

  steps() {
    const app = this.app;
    const mac = isMac();
    const trackpad = app.vp.scrollMode === 'orbit';
    const doc = app.doc;
    const ctxButton = (label) => () => [...document.querySelectorAll('#context-bar .cb-btn')].find((b) => b.textContent.trim() === label) || document.getElementById('context-bar');
    return [
      {
        title: 'Welcome! Let’s build your first part',
        text: 'In a few short steps you will learn to move around, draw a sketch, turn it into a 3D body and round its edges.<br><br>Each step waits for you to try it. Use <b>Skip</b> if you already know it.',
        place: 'center',
      },
      {
        title: 'Orbit: turn the view',
        text: trackpad
          ? 'Swipe with <b>two fingers</b> on the trackpad, or hold the <b>right mouse button</b> and drag.<br><small>No mouse? Hold <kbd>Space</kbd> and drag, or press the arrow keys.</small>'
          : 'Hold the <b>right mouse button</b> and drag in the view.<br><small>On a laptop: hold <kbd>Space</kbd> and drag, or press the arrow keys.</small>',
        place: 'top',
        enter: () => (this.navCount.orbit = 0),
        done: () => this.navCount.orbit >= 6,
      },
      {
        title: 'Pan: slide the view',
        text: trackpad
          ? 'Hold <kbd>Shift</kbd> and swipe with two fingers, or drag with the <b>middle mouse button</b>.<br><small>Or hold <kbd>Shift</kbd>+<kbd>Space</kbd> and drag.</small>'
          : 'Drag with the <b>middle mouse button</b> (press the wheel), or hold <kbd>Shift</kbd> and right-drag.<br><small>Or hold <kbd>Shift</kbd>+<kbd>Space</kbd> and drag.</small>',
        place: 'top',
        enter: () => (this.navCount.pan = 0),
        done: () => this.navCount.pan >= 5,
      },
      {
        title: 'Zoom: get closer',
        text: trackpad ? '<b>Pinch</b> on the trackpad, or press <kbd>+</kbd> and <kbd>−</kbd>. It zooms towards your pointer.' : 'Turn the <b>scroll wheel</b> over the spot you want to see, or press <kbd>+</kbd> and <kbd>−</kbd>.',
        place: 'top',
        enter: () => (this.navCount.zoom = 0),
        done: () => this.navCount.zoom >= 3,
      },
      {
        title: 'Your view controls',
        text: 'These buttons help too: <b>Fit</b> shows everything (<kbd>Z</kbd>), <b>Views</b> jumps to top/front/right, and <b>Orbit</b> / <b>Pan</b> let you drag with the left button. Click the <b>cube</b> to face a side.<br><br>The <b>mouse</b> button lists every control.',
        target: () => document.getElementById('view-controls'),
        place: 'left',
      },
      {
        title: 'All tools are on the right',
        text: t('Tools are grouped into <b>Sketch</b>, <b>Model</b>, <b>Transform</b>, <b>Shapes</b> and <b>Inspect</b>. Hover a tool to see what it does.<br><br>Can’t find something? Type in <b>Search tools</b> (<kbd>{mod}K</kbd>) — try “hole” or “round”.', { mod: modKey() }),
        target: () => document.getElementById('tools'),
        place: 'left',
      },
      {
        title: 'Pick the Rectangle tool',
        text: 'Click <b>Rectangle</b> in the Sketch tools, or press <kbd>R</kbd>.',
        target: () => document.querySelector('#tools .tool-btn[data-tool="rect"]'),
        place: 'left',
        enter: () => {
          const s = document.querySelector('#tools .tools-section[data-section="Sketch"]');
          s?.classList.remove('collapsed');
        },
        done: () => app.tools.activeId === 'rect',
      },
      {
        title: 'Draw a rectangle',
        text: 'Click on the grid for the first corner, move the pointer, and click again for the opposite corner.<br><small>For an exact size, type <kbd>40</kbd> <kbd>Tab</kbd> <kbd>30</kbd> <kbd>Enter</kbd> after the first click.</small>',
        place: 'top',
        done: () => doc.sketches.some((s) => s.entities.filter((e) => e.type === 'line').length >= 4),
      },
      {
        title: 'Finish the sketch',
        text: 'Press <kbd>Esc</kbd> (or the ✕ in the Rectangle panel) to put the tool away.',
        target: () => document.querySelector('#tool-panel:not([hidden])'),
        place: 'right',
        done: () => app.tools.isSelect,
      },
      {
        title: 'Select the shape',
        text: 'Click <b>inside</b> your rectangle. The shaded area is a <b>region</b> — a closed shape you can turn into 3D.',
        place: 'top',
        done: () => app.selection.list.some((it) => it.kind === 'region'),
      },
      {
        title: 'Extrude it',
        text: 'The bar at the bottom suggests tools for what you selected. Click <b>Extrude</b> (or press <kbd>E</kbd>).',
        target: ctxButton('Extrude'),
        place: 'top',
        done: () => app.tools.activeId === 'extrude',
      },
      {
        title: 'Pull it up',
        text: 'Drag the <b>blue arrow</b> up, or type a height like <kbd>20</kbd>. Then press <kbd>Enter</kbd> or click <b>Done</b>.',
        place: 'top',
        enter: () => (this.bodyCount = doc.bodies.length),
        done: () => doc.bodies.length > this.bodyCount && app.tools.isSelect,
      },
      {
        title: 'Select an edge',
        text: 'Nice, that’s a 3D body! Now click one of the <b>edges</b> on its top (the lines around the faces).<br><small>Click more edges to add them. Click empty space to clear the selection.</small>',
        place: 'top',
        done: () => app.selection.list.some((it) => it.kind === 'edge'),
      },
      {
        title: 'Round it with Fillet',
        text: 'Click <b>Fillet</b> in the bar at the bottom (or press <kbd>F</kbd>).',
        target: ctxButton('Fillet'),
        place: 'top',
        done: () => app.tools.activeId === 'fillet',
      },
      {
        title: 'Set the radius',
        text: 'Drag the arrow or type a radius like <kbd>3</kbd>, then press <kbd>Enter</kbd>.',
        place: 'top',
        enter: () => (this.shapes = doc.bodies.map((b) => b.shapeId).join()),
        done: () => app.tools.isSelect && doc.bodies.map((b) => b.shapeId).join() !== this.shapes,
      },
      {
        title: 'Everything you made',
        text: 'The <b>Items</b> list shows your bodies, meshes and sketches. Click the <b>eye</b> to hide one, double-click a name to rename it, right-click for more.<br><small>Show or hide this list with <kbd>Tab</kbd>.</small>',
        target: () => document.getElementById('items'),
        place: 'right',
        enter: () => {
          if (document.getElementById('items').classList.contains('collapsed')) app.toggleItems();
        },
      },
      {
        title: 'Ready to print',
        text: t('Click <b>3D Print</b> to check your part (closed shape, fits your printer) and save an STL or 3MF file — or open it straight in your slicer.<br><br>Made a mistake? <b>Undo</b> with <kbd>{mod}Z</kbd>. Save your design with <kbd>{mod}S</kbd>.', { mod: modKey() }),
        target: () => document.getElementById('btn-print'),
        place: 'bottom',
      },
      {
        title: 'You’re ready!',
        text: t('That’s the basics. A few more tips:<br>• Draw on any flat face of a body to add or cut shapes.<br>• Select a face and drag its arrow to push or pull it.<br>• {key}+K finds any tool. The <b>?</b> button has help and shortcuts.', { key: mac ? '⌘' : 'Ctrl' }),
        place: 'center',
        final: true,
      },
    ];
  }

  async start() {
    const app = this.app;
    if (this.active) return;
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
    this.list = this.steps();
    this.active = true;
    document.body.classList.add('tutorial-on');
    app.starter?.update();
    this.ring = h('div.tut-ring', { hidden: true });
    this.card = h('div.tut-card');
    document.body.append(this.ring, this.card);
    this.timer = setInterval(() => this.place(), 250);
    this.go(0);
  }

  end() {
    if (!this.active) return;
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
    if (i >= this.list.length) return this.end();
    this.index = Math.max(0, i);
    this.completed = false;
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
    const progress = h('div.tut-progress', h('div', { style: { width: `${((this.index + (this.completed ? 1 : 0)) / (n - 1)) * 100}%` } }));
    this.card.append(
      h('div.tut-top', h('span.tut-count', { text: this.index === 0 ? 'Tutorial' : t('Step {i} of {n}', { i: this.index, n: n - 1 }) }), endBtn),
      progress,
      h('div.tut-title', { text: step.title }),
      h('div.tut-text', { html: step.text }),
    );
    if (step.done && !this.completed) this.card.append(h('div.tut-wait', { html: `<span class="pulse"></span>${t('Waiting for you to try it…')}` }));
    this.card.append(h('div.tut-buttons', back, next));
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
