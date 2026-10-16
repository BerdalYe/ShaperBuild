// Items manager: the list of bodies and sketches in the design.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { BODY_COLORS } from '../view/theme.js';

export class ItemsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.collapsed = { bodies: false, sketches: false };
    this.renaming = null;
    app.doc.on('change', () => this.render());
    app.selection.on('change', () => this.render());
    this.render();
  }

  render() {
    const app = this.app;
    const doc = app.doc;
    clear(this.el);
    const head = h('div.items-head', h('span', { text: 'Items' }));
    const scroll = h('div.items-scroll');
    const bodies = doc.bodies;
    const sketches = doc.sketches;

    scroll.append(this.group('bodies', 'Bodies', bodies.length, () => bodies.map((b) => this.bodyRow(b))));
    scroll.append(this.group('sketches', 'Sketches', sketches.length, () => sketches.map((s) => this.sketchRow(s))));
    if (!bodies.length && !sketches.length) {
      scroll.append(
        h('div.items-empty', {
          html: 'Nothing here yet.<br><br>Pick a sketch tool on the right (try <b>Rectangle</b>) and click on the grid to start drawing, or <b>Import</b> an STL file.',
        }),
      );
    }
    const meshCount = bodies.filter((b) => b.kind === 'mesh').length;
    const foot = h('div.items-foot', {
      text: `${bodies.length} bod${bodies.length === 1 ? 'y' : 'ies'}${meshCount ? ` (${meshCount} mesh)` : ''} · ${sketches.length} sketch${sketches.length === 1 ? '' : 'es'}`,
    });
    this.el.append(head, scroll, foot);
  }

  group(key, title, count, rows) {
    const g = h('div.items-group');
    const chevron = h('span', { html: icon(this.collapsed[key] ? 'chevron' : 'chevronDown') });
    chevron.querySelector('svg').style.cssText = 'width:14px;height:14px';
    const head = h('div.items-group-head', chevron, h('span', { text: title }), h('span.count', { text: String(count) }));
    head.style.cursor = 'pointer';
    head.addEventListener('click', () => {
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });
    g.append(head);
    if (!this.collapsed[key]) g.append(...rows());
    return g;
  }

  nameEl(item, kind) {
    const span = h('span.item-name', { text: item.name, title: item.name });
    if (this.renaming === item.id) {
      const inp = h('input', { type: 'text', value: item.name });
      const done = (save) => {
        if (this.renaming !== item.id) return;
        this.renaming = null;
        if (save && inp.value.trim() && inp.value.trim() !== item.name) this.app.cmd.rename(kind, item.id, inp.value.trim());
        else this.render();
      };
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      inp.addEventListener('blur', () => done(true));
      span.textContent = '';
      span.append(inp);
      setTimeout(() => {
        inp.focus();
        inp.select();
      });
    }
    return span;
  }

  bodyRow(b) {
    const app = this.app;
    const sel = app.selection.has({ kind: 'body', bodyId: b.id });
    const row = h(`div.item${sel ? '.selected' : ''}${b.visible === false ? '.hidden-item' : ''}`);
    const swatch = h('span.swatch', { title: 'Colour' });
    swatch.style.background = b.color || app.vp.theme.body;
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      this.colorMenu(e, [b.id]);
    });
    const kindIcon = h('span', { html: icon(b.kind === 'mesh' ? 'mesh' : 'solid'), title: b.kind === 'mesh' ? 'Mesh body (from STL/OBJ/3MF)' : 'Solid body' });
    kindIcon.querySelector('svg').style.cssText = 'width:16px;height:16px;opacity:.75';
    const eye = h(`button.item-btn${b.visible === false ? '.on' : ''}`, { title: b.visible === false ? 'Show' : 'Hide', html: icon(b.visible === false ? 'eyeOff' : 'eye') });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.cmd.setVisible('body', b.id, b.visible === false);
    });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.bodyMenu(e, b);
    });
    row.append(swatch, kindIcon, this.nameEl(b, 'body'));
    if (b.kind === 'mesh') row.append(h('span.tag', { text: 'mesh' }));
    row.append(eye, more);
    row.addEventListener('click', (e) => this.select({ kind: 'body', bodyId: b.id }, e));
    row.addEventListener('dblclick', () => {
      this.renaming = b.id;
      this.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.bodyMenu(e, b);
    });
    row.addEventListener('mouseenter', () => app.selection.setHover({ kind: 'body', bodyId: b.id }));
    row.addEventListener('mouseleave', () => app.selection.setHover(null));
    return row;
  }

  sketchRow(s) {
    const app = this.app;
    const sel = app.selection.has({ kind: 'sketch', sketchId: s.id });
    const row = h(`div.item${sel ? '.selected' : ''}${s.visible === false ? '.hidden-item' : ''}`);
    const ic = h('span', { html: icon('sketch') });
    ic.querySelector('svg').style.cssText = 'width:16px;height:16px;opacity:.75';
    const eye = h(`button.item-btn${s.visible === false ? '.on' : ''}`, { title: s.visible === false ? 'Show' : 'Hide', html: icon(s.visible === false ? 'eyeOff' : 'eye') });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.cmd.setVisible('sketch', s.id, s.visible === false);
    });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.sketchMenu(e, s);
    });
    row.append(ic, this.nameEl(s, 'sketch'), h('span.tag', { text: String(s.entities.length) }), eye, more);
    row.addEventListener('click', (e) => this.select({ kind: 'sketch', sketchId: s.id }, e));
    row.addEventListener('dblclick', () => {
      this.renaming = s.id;
      this.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.sketchMenu(e, s);
    });
    return row;
  }

  select(item, e) {
    const sel = this.app.selection;
    if (e.ctrlKey || e.metaKey || e.shiftKey) sel.toggle(item);
    else if (sel.size === 1 && sel.has(item)) sel.clear();
    else sel.set([item]);
  }

  colorMenu(e, ids) {
    const sw = h('div.swatches');
    for (const c of BODY_COLORS) {
      const b = h('button', { title: c });
      b.style.background = c;
      b.addEventListener('click', () => {
        document.getElementById('menu-root').innerHTML = '';
        this.app.cmd.setColor(ids, c);
      });
      sw.append(b);
    }
    showMenu(e.clientX, e.clientY, [{ custom: sw }, '-', { label: 'Default colour', action: () => this.app.cmd.setColor(ids, null) }]);
  }

  bodyMenu(e, b) {
    const cmd = this.app.cmd;
    const items = [
      { label: 'Rename', icon: 'sketch', action: () => ((this.renaming = b.id), this.render()) },
      { label: 'Duplicate', icon: 'duplicate', kbd: 'Ctrl+D', action: () => cmd.duplicate([b.id]) },
      { label: b.visible === false ? 'Show' : 'Hide', icon: b.visible === false ? 'eye' : 'eyeOff', action: () => cmd.setVisible('body', b.id, b.visible === false) },
      { label: 'Show only this', icon: 'eye', action: () => cmd.isolate(b.id) },
      { label: 'Colour…', icon: 'color', action: () => this.colorMenu(e, [b.id]) },
      '-',
    ];
    if (b.kind === 'mesh') items.push({ label: 'Convert to solid', icon: 'convert', action: () => cmd.convertToSolid([b.id]) });
    items.push(
      { label: 'Export as STL…', icon: 'export', action: () => cmd.exportBodies([b.id], 'stl') },
      ...(b.kind === 'solid' ? [{ label: 'Export as STEP…', icon: 'export', action: () => cmd.exportBodies([b.id], 'step') }] : []),
      '-',
      { label: 'Delete', icon: 'trash', kbd: 'Del', danger: true, action: () => cmd.deleteItems([{ kind: 'body', bodyId: b.id }]) },
    );
    showMenu(e.clientX, e.clientY, items);
  }

  sketchMenu(e, s) {
    const cmd = this.app.cmd;
    showMenu(e.clientX, e.clientY, [
      { label: 'Rename', icon: 'sketch', action: () => ((this.renaming = s.id), this.render()) },
      { label: 'Look at', icon: 'lookAt', action: () => this.app.vp.lookAtPlane(s.plane) },
      { label: s.visible === false ? 'Show' : 'Hide', icon: s.visible === false ? 'eye' : 'eyeOff', action: () => cmd.setVisible('sketch', s.id, s.visible === false) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: () => cmd.deleteItems([{ kind: 'sketch', sketchId: s.id }]) },
    ]);
  }
}
