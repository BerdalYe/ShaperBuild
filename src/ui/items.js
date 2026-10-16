// Items manager: the list of bodies and sketches in the design.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { BODY_COLORS } from '../view/theme.js';

export class ItemsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.collapsed = { bodies: false, meshes: false, sketches: false, planes: false };
    this.renaming = null;
    this.query = '';
    app.doc.on('change', () => this.render());
    app.selection.on('change', () => this.render());
    this.render();
  }

  render() {
    const app = this.app;
    const doc = app.doc;
    const searching = this.el.contains(document.activeElement) && document.activeElement?.classList.contains('items-filter');
    clear(this.el);
    const anyHidden = [...doc.bodies, ...doc.sketches, ...doc.planes].some((x) => x.visible === false);
    const showAll = h('button.ih-btn', { title: 'Show all items', html: icon('eye') });
    showAll.hidden = !anyHidden;
    showAll.addEventListener('click', () => app.cmd.showAll());
    const hide = h('button.ih-btn', { title: 'Hide this panel (Tab)', html: icon('sidebar') });
    hide.addEventListener('click', () => app.toggleItems());
    const head = h('div.items-head', h('span', { text: 'Items' }), h('span.ih-actions', showAll, hide));
    const scroll = h('div.items-scroll');
    const q = this.query.trim().toLowerCase();
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    const solids = doc.bodies.filter((b) => b.kind !== 'mesh');
    const meshes = doc.bodies.filter((b) => b.kind === 'mesh');
    const sketches = doc.sketches;
    const planes = doc.planes;
    const total = doc.bodies.length + sketches.length + planes.length;

    if (total > 6 || q) {
      const inp = h('input.items-filter', { type: 'text', placeholder: 'Find items', value: this.query, spellcheck: false });
      inp.addEventListener('input', () => {
        this.query = inp.value;
        this.render();
      });
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          this.query = '';
          inp.blur();
          this.render();
        }
      });
      scroll.append(inp);
      if (searching)
        setTimeout(() => {
          inp.focus();
          inp.setSelectionRange(inp.value.length, inp.value.length);
        });
    }
    scroll.append(this.group('bodies', 'Bodies', solids, 'body', () => solids.filter(match).map((b) => this.bodyRow(b))));
    if (meshes.length) scroll.append(this.group('meshes', 'Meshes', meshes, 'body', () => meshes.filter(match).map((b) => this.bodyRow(b))));
    scroll.append(this.group('sketches', 'Sketches', sketches, 'sketch', () => sketches.filter(match).map((s) => this.sketchRow(s))));
    if (planes.length) scroll.append(this.group('planes', 'Planes', planes, 'plane', () => planes.filter(match).map((p) => this.planeRow(p))));
    if (!total) {
      scroll.append(
        h('div.items-empty', {
          html: '<b>Your design is empty.</b><br>Everything you make shows up here: bodies, meshes and sketches.<br><br>Pick <b>Rectangle</b> in the tools on the right and click on the grid to start, or <b>Import</b> an STL file.',
        }),
      );
    }
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const foot = h('div.items-foot', {
      text: total ? `${n(solids.length, 'body', 'bodies')} · ${meshes.length ? `${n(meshes.length, 'mesh', 'meshes')} · ` : ''}${n(sketches.length, 'sketch', 'sketches')}${planes.length ? ` · ${n(planes.length, 'plane', 'planes')}` : ''} — double-click a name to rename` : 'Tip: right-click an item for more options',
    });
    this.el.append(head, scroll, foot);
    scroll.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  group(key, title, list, kind, rows) {
    const g = h('div.items-group');
    const chevron = h('span.ig-chev', { html: icon(this.collapsed[key] ? 'chevron' : 'chevronDown') });
    const allHidden = list.length > 0 && list.every((x) => x.visible === false);
    const eye = h(`button.item-btn${allHidden ? '.on' : ''}`, { title: allHidden ? `Show all ${title.toLowerCase()}` : `Hide all ${title.toLowerCase()}`, html: icon(allHidden ? 'eyeOff' : 'eye') });
    eye.hidden = !list.length;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.cmd.setVisibleMany(list.filter((x) => (x.visible === false) === allHidden).map((x) => ({ kind, id: x.id })), allHidden);
    });
    const head = h('div.items-group-head', chevron, h('span', { text: title }), h('span.count', { text: String(list.length) }), eye);
    head.addEventListener('click', () => {
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });
    g.append(head);
    if (!this.collapsed[key]) {
      const r = rows();
      if (r.length) g.append(...r);
      else if (!list.length && this.app.doc.bodies.length + this.app.doc.sketches.length) g.append(h('div.items-none', { text: { bodies: 'No bodies yet — extrude a sketch or add a shape.', sketches: 'No sketches yet — draw with the sketch tools.', meshes: '' }[key] }));
    }
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
    row.append(ic, this.nameEl(s, 'sketch'), h('span.tag', { text: `${s.entities.length} curve${s.entities.length === 1 ? '' : 's'}`, title: 'Curves in this sketch' }), eye, more);
    row.addEventListener('click', (e) => this.select({ kind: 'sketch', sketchId: s.id }, e));
    row.addEventListener('dblclick', () => {
      this.renaming = s.id;
      this.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.sketchMenu(e, s);
    });
    row.addEventListener('mouseenter', () => app.selection.setHover({ kind: 'sketch', sketchId: s.id }));
    row.addEventListener('mouseleave', () => app.selection.setHover(null));
    return row;
  }

  planeRow(p) {
    const app = this.app;
    const item = { kind: 'plane', planeId: p.id };
    const sel = app.selection.has(item);
    const row = h(`div.item${sel ? '.selected' : ''}${p.visible === false ? '.hidden-item' : ''}`);
    const ic = h('span', { html: icon('planeRef') });
    ic.querySelector('svg').style.cssText = 'width:16px;height:16px;opacity:.75';
    const eye = h(`button.item-btn${p.visible === false ? '.on' : ''}`, { title: p.visible === false ? 'Show' : 'Hide', html: icon(p.visible === false ? 'eyeOff' : 'eye') });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.cmd.setVisible('plane', p.id, p.visible === false);
    });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    const menu = (e) =>
      showMenu(e.clientX, e.clientY, [
        { label: 'Rename', icon: 'sketch', action: () => ((this.renaming = p.id), this.render()) },
        { label: 'Look at', icon: 'lookAt', action: () => app.vp.lookAtPlane(p.plane) },
        { label: p.visible === false ? 'Show' : 'Hide', icon: p.visible === false ? 'eye' : 'eyeOff', action: () => app.cmd.setVisible('plane', p.id, p.visible === false) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => app.cmd.deleteItems([item]) },
      ]);
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      menu(e);
    });
    row.append(ic, this.nameEl(p, 'plane'), eye, more);
    row.addEventListener('click', (e) => this.select(item, e));
    row.addEventListener('dblclick', () => {
      this.renaming = p.id;
      this.render();
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      menu(e);
    });
    row.addEventListener('mouseenter', () => app.selection.setHover(item));
    row.addEventListener('mouseleave', () => app.selection.setHover(null));
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
