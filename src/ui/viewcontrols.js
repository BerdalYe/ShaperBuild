// Buttons for moving around the view, and the "how to move around" card.
import { h, isMac } from './dom.js';
import { icon } from './icons.js';
import { attachTooltip, hideTooltip, showMenu, toast } from './overlays.js';
import { t } from '../core/i18n.js';

const DEG = Math.PI / 180;

export class ViewControls {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.btns = {};
    const vp = app.vp;
    const add = (key, ic, label, kbd, action, desc) => {
      const b = h('button.vc-btn', { html: icon(ic), 'aria-label': label });
      b.dataset.vc = key;
      attachTooltip(b, () => `<b>${t(label)}</b>${kbd ? `<span class="kbd">${kbd}</span>` : ''}${desc ? `<span class="desc">${t(desc)}</span>` : ''}`);
      b.addEventListener('click', (e) => {
        hideTooltip();
        action(e, b);
        b.blur();
      });
      this.btns[key] = b;
      return b;
    };
    const sep = () => h('div.vc-sep');
    el.append(
      add('fit', 'fit', 'Zoom to fit', 'Z', () => vp.fit(app.selectionBox()), 'Show everything, or just the selection.'),
      add('views', 'views', 'Standard views', '0 · 1 · 3 · 7', (e, b) => this.viewsMenu(b), 'Home, top, front, right and more.'),
      sep(),
      add('orbit', 'orbit', 'Orbit', 'right-drag', () => this.toggleMode('orbit'), 'Click, then drag with the left button to turn the view. Shortcut: hold Space and drag.'),
      add('pan', 'pan', 'Pan', 'middle-drag', () => this.toggleMode('pan'), 'Click, then drag with the left button to slide the view. Shortcut: hold Shift+Space and drag.'),
      add('zoomIn', 'zoomIn', 'Zoom in', '+', () => vp.stepZoom(1 / 1.4), 'Or scroll / pinch over the spot you want to see.'),
      add('zoomOut', 'zoomOut', 'Zoom out', '−', () => vp.stepZoom(1.4)),
      sep(),
      add('ortho', 'ortho', 'Perspective / orthographic', 'O', () => app.toggleOrtho(), 'Orthographic shows true sizes without depth.'),
      add('grid', 'grid', 'Grid', 'G', () => app.toggleGrid()),
      add('section', 'section', 'Section view', 'X', () => app.toggleSection(), 'Cut through the design to look inside.'),
      add('xray', 'xray', 'X-ray', 'Shift+X', () => app.toggleXray(), 'See through bodies to check inside shapes and hidden edges.'),
      sep(),
      add('help', 'mouse', 'How to move around', '', () => app.navHelp.toggle(), 'Mouse, trackpad and keyboard controls.'),
    );
    this.btns.grid.classList.toggle('on', app.settings.showGrid);
    vp.on('navmode', (m) => {
      this.btns.orbit.classList.toggle('on', m === 'orbit');
      this.btns.pan.classList.toggle('on', m === 'pan');
    });
  }

  toggleMode(mode) {
    const vp = this.app.vp;
    vp.setNavMode(vp.navMode === mode ? null : mode);
    if (vp.navMode) toast(t(mode === 'orbit' ? 'Orbit mode: drag with the left mouse button. Press Esc or click the button again to stop.' : 'Pan mode: drag with the left mouse button. Press Esc or click the button again to stop.'), { ms: 3200 });
  }

  setOrtho(on) {
    this.btns.ortho.innerHTML = icon(on ? 'persp' : 'ortho');
    this.btns.ortho.classList.toggle('on', on);
  }

  viewsMenu(b) {
    const app = this.app;
    const vp = app.vp;
    const r = b.getBoundingClientRect();
    const v = (label, name, kbd) => ({ label, icon: 'views', kbd, action: () => vp.setView(name) });
    const menu = showMenu(r.left, r.top, [
      { label: 'Home', icon: 'home', kbd: '0', action: () => vp.setView('iso', { fit: true }) },
      v('Top', 'top', '7'),
      v('Front', 'front', '1'),
      v('Right', 'right', '3'),
      v('Left', 'left', '4'),
      v('Back', 'back', '2'),
      v('Bottom', 'bottom', '8'),
      '-',
      { label: 'Look at selected face', icon: 'lookAt', kbd: 'N', action: () => app.lookAtSelection() },
      { label: 'Turn 90° left', icon: 'rotate', kbd: '←', action: () => vp.stepOrbit(90 * DEG, 0) },
    ]);
    const mr = menu.getBoundingClientRect();
    menu.style.left = `${r.left - mr.width - 8}px`;
  }
}

// Card that explains every way to orbit, pan and zoom.
export class NavHelp {
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  get open() {
    return !!this.el;
  }

  toggle(force) {
    const want = force ?? !this.el;
    if (want) this.show();
    else this.close();
  }

  close() {
    this.el?.remove();
    this.el = null;
    this.app.viewControls?.btns.help.classList.remove('on');
  }

  show() {
    this.close();
    const app = this.app;
    const s = app.settings;
    const mac = isMac();
    const trackpad = app.vp.scrollMode === 'orbit';
    const row = (ic, title, ways) =>
      h(
        'div.nh-row',
        h('span.nh-ic', { html: icon(ic) }),
        h('div', h('b', { text: title }), h('div.nh-ways', ...ways.map(([how, note]) => h('span.nh-way', h('kbd', { text: how }), note ? h('small', { text: note }) : null)))),
      );
    const sel = h('select');
    for (const [v, l] of [
      ['auto', `Automatic (${mac ? 'trackpad style' : 'mouse style'})`],
      ['zoom', 'Zooms — for a mouse wheel'],
      ['orbit', 'Orbits — for a trackpad'],
    ])
      sel.append(h('option', { value: v, text: l, selected: v === s.scrollMode }));
    sel.addEventListener('change', () => {
      s.scrollMode = sel.value;
      app.saveSettings();
      app.applyViewSettings();
      this.show();
    });
    const closeBtn = h('button.nh-close', { html: icon('close'), title: 'Close' });
    closeBtn.addEventListener('click', () => this.close());
    const tut = h('button.btn', { html: `${icon('learn')}<span>${t('Practice in the tutorial')}</span>` });
    tut.addEventListener('click', () => {
      this.close();
      app.tutorial.start();
    });
    this.el = h(
      'div.nav-help',
      h('div.nh-head', h('b', { text: 'Moving around' }), closeBtn),
      row('orbit', 'Orbit — turn the view', [
        ['Right-drag', 'mouse'],
        trackpad ? ['Two-finger swipe', 'trackpad'] : ['Two-finger click + drag', 'trackpad'],
        ['Space + drag', 'laptop'],
        ['← → ↑ ↓', 'keyboard'],
      ]),
      row('pan', 'Pan — slide the view', [
        ['Middle-drag', 'mouse'],
        ['Shift + right-drag', 'mouse'],
        trackpad ? ['Shift + two-finger swipe', 'trackpad'] : null,
        ['Shift + Space + drag', 'laptop'],
        ['Shift + arrows', 'keyboard'],
      ].filter(Boolean)),
      row('zoomIn', 'Zoom — closer or further', [
        trackpad ? ['Pinch', 'trackpad'] : ['Scroll wheel', 'mouse'],
        trackpad ? null : ['Pinch', 'trackpad'],
        ['+ / −', 'keyboard'],
      ].filter(Boolean)),
      row('fit', 'Lost? Show everything', [['Z', 'keyboard'], ['Fit button', '']]),
      row('views', 'Standard views', [['Click the cube', ''], ['0 Home · 7 Top · 1 Front · 3 Right', 'keyboard'], ['N', 'look at a face']]),
      h('div.nh-setting', h('label', { text: mac ? 'Two-finger swipe / scroll wheel:' : 'Scroll wheel / two-finger swipe:' }), sel),
      h('div.nh-foot', h('span', { text: 'Tip: the Orbit and Pan buttons let you drag with the left button only.' }), tut),
    );
    document.getElementById('viewport').append(this.el);
    app.viewControls?.btns.help.classList.add('on');
  }
}
