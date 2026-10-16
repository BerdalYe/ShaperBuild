// Items manager: the list of bodies and sketches in the design.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { showMenu } from './overlays.js';
import { BODY_COLORS } from '../view/theme.js';
import { HistoryList } from './historylist.js';
import { VariablesList } from './variables.js';
import { t, tn } from '../core/i18n.js';

export class ItemsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.collapsed = { bodies: false, meshes: false, sketches: false, planes: false, axes: false, images: false };
    this.renaming = null;
    this.query = '';
    // 'items' (what is in the design) or 'history' (the steps that made it).
    this.tab = 'items';
    this.historyList = new HistoryList(this, app);
    this.variablesList = new VariablesList(this, app);
    app.doc.on('change', () => this.render());
    app.selection.on('change', () => this.render());
    this.render();
  }

  // Redrawing removes inputs, which can fire their change handlers and
  // ask for another redraw; that one waits until this one is done.
  render() {
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }
    this.rendering = true;
    try {
      this.renderNow();
    } finally {
      this.rendering = false;
    }
    if (this.renderAgain) {
      this.renderAgain = false;
      this.render();
    }
  }

  renderNow() {
    const app = this.app;
    const doc = app.doc;
    const searching = this.el.contains(document.activeElement) && document.activeElement?.classList.contains('items-filter');
    // Keep the list where it was scrolled to (per tab).
    const old = this.el.querySelector('.items-scroll');
    if (old) (this.scrolls ||= {})[this.shownTab] = old.scrollTop;
    this.shownTab = this.tab;
    // A value being typed in a History step survives the redraw.
    const act = document.activeElement;
    const typing = this.el.contains(act) && act.matches('.step-edit .num-input') && act.dataset.dirty ? { step: act.closest('.step-edit')?.dataset.step, key: act.dataset.key, value: act.value, start: act.selectionStart, end: act.selectionEnd } : null;
    // Removing it must not apply the half-typed value.
    if (typing) act.dataset.redraw = '1';
    clear(this.el);
    const anyHidden = [...doc.bodies, ...doc.sketches, ...doc.planes, ...doc.axes, ...doc.images].some((x) => x.visible === false);
    const showAll = h('button.ih-btn', { title: 'Show all items', html: icon('eye') });
    showAll.hidden = !anyHidden;
    showAll.addEventListener('click', () => app.cmd.showAll());
    const invert = h('button.ih-btn', { title: 'Invert visibility (show what is hidden, hide what is shown)', html: icon('eyeOff') });
    invert.dataset.action = 'invert-visibility';
    invert.hidden = !anyHidden && !doc.bodies.length;
    invert.addEventListener('click', () => app.cmd.invertVisibility());
    const hide = h('button.ih-btn', { title: 'Hide this panel (Tab)', html: icon('sidebar') });
    hide.addEventListener('click', () => app.toggleItems());
    const tabs = h('span.items-tabs');
    for (const [key, label, tip] of [
      ['items', 'Items', 'Bodies, sketches and planes in the design'],
      ['history', 'History', 'The steps that made the design. Click one to change it.'],
    ]) {
      const tabBtn = h(`button.items-tab${this.tab === key ? '.on' : ''}`, { text: label, title: tip });
      tabBtn.dataset.tab = key;
      tabBtn.addEventListener('click', () => this.setTab(key));
      tabs.append(tabBtn);
    }
    const newFolder = h('button.ih-btn', { title: 'New folder (puts the selected items in it)', html: icon('folder2') });
    newFolder.dataset.action = 'new-folder';
    newFolder.addEventListener('click', () => {
      const picked = app.selection.list.filter((it) => ['body', 'sketch', 'plane', 'axis', 'image'].includes(it.kind));
      // Items that are all in one folder get their new folder inside it.
      const homes = new Set(app.cmd.folderTargets(picked).map(({ kind, id }) => this.itemOf(kind, id)?.folder || null));
      const parent = homes.size === 1 ? [...homes][0] : null;
      const id = app.cmd.newFolder(picked, parent && doc.folder(parent) ? parent : null);
      this.renaming = id;
      this.render();
    });
    if (this.tab === 'history') showAll.hidden = newFolder.hidden = invert.hidden = true;
    const head = h('div.items-head', tabs, h('span.ih-actions', newFolder, invert, showAll, hide));
    const scroll = h('div.items-scroll');
    if (this.tab === 'history') {
      this.variablesList.render(scroll);
      this.historyList.render(scroll);
      const foot = h('div.items-foot', { text: this.historyList.footText() });
      this.el.append(head, scroll, foot);
      scroll.scrollTop = this.scrolls?.history || 0;
      scroll.querySelector('.step.selected')?.scrollIntoView({ block: 'nearest' });
      if (typing) {
        const inp = scroll.querySelector(`.step-edit[data-step="${typing.step}"] .num-input[data-key="${typing.key}"]`);
        if (inp) {
          inp.value = typing.value;
          inp.dataset.dirty = '1';
          inp.focus({ preventScroll: true });
          inp.setSelectionRange(typing.start, typing.end);
        }
      }
      return;
    }
    const q = this.query.trim().toLowerCase();
    const match = (x) => !q || x.name.toLowerCase().includes(q);
    // Items in a folder are listed in it, not in the groups below.
    const loose = (x) => !x.folder || !doc.folder(x.folder);
    const solids = doc.bodies.filter((b) => b.kind !== 'mesh' && loose(b));
    const meshes = doc.bodies.filter((b) => b.kind === 'mesh' && loose(b));
    const sketches = doc.sketches.filter(loose);
    const planes = doc.planes.filter(loose);
    const axes = doc.axes.filter(loose);
    const images = doc.images.filter(loose);
    const total = doc.bodies.length + doc.sketches.length + doc.planes.length + doc.axes.length + doc.images.length;

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
    for (const f of doc.folders.filter((x) => !x.parent || !doc.folder(x.parent))) {
      const g = this.folderGroup(f, q, match);
      if (g) scroll.append(g);
    }
    scroll.append(this.group('bodies', 'Bodies', solids, 'body', () => solids.filter(match).map((b) => this.bodyRow(b))));
    if (meshes.length) scroll.append(this.group('meshes', 'Meshes', meshes, 'body', () => meshes.filter(match).map((b) => this.bodyRow(b))));
    scroll.append(this.group('sketches', 'Sketches', sketches, 'sketch', () => sketches.filter(match).map((s) => this.sketchRow(s))));
    if (planes.length) scroll.append(this.group('planes', 'Planes', planes, 'plane', () => planes.filter(match).map((p) => this.refRow('plane', p))));
    if (axes.length) scroll.append(this.group('axes', 'Axes', axes, 'axis', () => axes.filter(match).map((a) => this.refRow('axis', a))));
    if (images.length) scroll.append(this.group('images', 'Images', images, 'image', () => images.filter(match).map((p) => this.refRow('image', p))));
    if (!total) {
      scroll.append(
        h('div.items-empty', {
          html: '<b>Your design is empty.</b><br>Everything you make shows up here: bodies, meshes and sketches.<br><br>Pick <b>Rectangle</b> in the tools on the right and click on the grid to start, or <b>Import</b> an STL file.',
        }),
      );
    }
    const n = (count, one, many) => tn(count, `1 ${one}`, `{n} ${many}`);
    const nSolids = doc.bodies.filter((b) => b.kind !== 'mesh').length;
    const nMeshes = doc.bodies.length - nSolids;
    const foot = h('div.items-foot', {
      str: total ? `${n(nSolids, 'body', 'bodies')} · ${nMeshes ? `${n(nMeshes, 'mesh', 'meshes')} · ` : ''}${n(doc.sketches.length, 'sketch', 'sketches')}${doc.planes.length ? ` · ${n(doc.planes.length, 'plane', 'planes')}` : ''}${doc.axes.length ? ` · ${n(doc.axes.length, 'axis', 'axes')}` : ''}${doc.images.length ? ` · ${n(doc.images.length, 'image', 'images')}` : ''} — ${t('double-click a name to rename, drag items into folders')}` : t('Tip: right-click an item for more options'),
    });
    this.el.append(head, scroll, foot);
    scroll.scrollTop = this.scrolls?.items || 0;
    scroll.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  setTab(tab) {
    if (this.tab === tab) return;
    this.tab = tab;
    this.app.selection.setHover(null);
    this.render();
  }

  group(key, title, list, kind, rows) {
    const g = h('div.items-group');
    const chevron = h('span.ig-chev', { html: icon(this.collapsed[key] ? 'chevron' : 'chevronDown') });
    const allHidden = list.length > 0 && list.every((x) => x.visible === false);
    const eye = h(`button.item-btn${allHidden ? '.on' : ''}`, { title: t(allHidden ? 'Show all {what}' : 'Hide all {what}', { what: t(title).toLowerCase() }), html: icon(allHidden ? 'eyeOff' : 'eye') });
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
    // Dropping items here takes them out of their folder.
    this.dropTarget(g, null);
    g.append(head);
    if (!this.collapsed[key]) {
      const r = rows();
      const doc = this.app.doc;
      const all = { bodies: doc.bodies.filter((b) => b.kind !== 'mesh'), sketches: doc.sketches }[key];
      if (r.length) g.append(...r);
      else if (all && !all.length && doc.bodies.length + doc.sketches.length) g.append(h('div.items-none', { text: { bodies: 'No bodies yet — extrude a sketch or add a shape.', sketches: 'No sketches yet — draw with the sketch tools.' }[key] }));
    }
    return g;
  }

  // ---- folders ---------------------------------------------------------------

  itemOf(kind, id) {
    const doc = this.app.doc;
    return kind === 'body' ? doc.body(id) : kind === 'sketch' ? doc.sketch(id) : kind === 'plane' ? doc.plane(id) : kind === 'axis' ? doc.axis(id) : kind === 'image' ? doc.image(id) : doc.folder(id);
  }

  // A folder with its items and the folders inside it. Returns null when a
  // search finds nothing in it.
  folderGroup(f, q, match, seen = new Set()) {
    const app = this.app;
    const doc = app.doc;
    if (seen.has(f.id)) return null;
    seen.add(f.id);
    const inside = (x) => x.folder === f.id;
    const content = [
      ...doc.bodies.filter(inside).map((x) => ({ x, row: () => this.bodyRow(x) })),
      ...doc.sketches.filter(inside).map((x) => ({ x, row: () => this.sketchRow(x) })),
      ...doc.planes.filter(inside).map((x) => ({ x, row: () => this.refRow('plane', x) })),
      ...doc.axes.filter(inside).map((x) => ({ x, row: () => this.refRow('axis', x) })),
      ...doc.images.filter(inside).map((x) => ({ x, row: () => this.refRow('image', x) })),
    ];
    const nameHit = !q || f.name.toLowerCase().includes(q);
    // Folders inside: when the name matches, show all of them.
    const subs = doc.folders.filter((x) => x.parent === f.id).map((x) => this.folderGroup(x, nameHit ? '' : q, nameHit ? () => true : match, seen)).filter(Boolean);
    const shown = nameHit ? content : content.filter((c) => match(c.x));
    if (q && !shown.length && !subs.length && !nameHit) return null;
    const deep = app.cmd.folderItems(f.id);
    const key = `folder:${f.id}`;
    const g = h('div.items-group.folder');
    g.dataset.folder = f.id;
    const head = h('div.item.folder-head');
    const chevron = h('span.ig-chev', { html: icon(this.collapsed[key] ? 'chevron' : 'chevronDown') });
    const ic = h('span.folder-icon', { html: icon('folder') });
    const allHidden = deep.length > 0 && app.cmd.folderTargets(deep).every(({ kind, id }) => this.itemOf(kind, id)?.visible === false);
    const eye = h(`button.item-btn${allHidden ? '.on' : ''}`, { title: allHidden ? 'Show everything in this folder' : 'Hide everything in this folder', html: icon(allHidden ? 'eyeOff' : 'eye') });
    eye.hidden = !deep.length;
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.cmd.setFolderVisible(f.id, allHidden);
    });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      this.folderMenu(e, f);
    });
    head.append(chevron, ic, this.nameEl(f, 'folder'), h('span.tag', { text: String(deep.length), title: 'Items in this folder (and the folders inside it)' }), eye, more);
    head.addEventListener('click', () => {
      if (this.renaming === f.id) return;
      this.collapsed[key] = !this.collapsed[key];
      this.render();
    });
    head.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.renaming = f.id;
      this.render();
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.folderMenu(e, f);
    });
    // Folders can be dragged into other folders too.
    if (this.renaming !== f.id) this.draggable(head, { kind: 'folder', folderId: f.id });
    this.dropTarget(g, f.id);
    g.append(head);
    if (!this.collapsed[key] || q) {
      const box = h('div.folder-items');
      box.append(...subs, ...shown.map((c) => c.row()));
      if (!subs.length && !shown.length) box.append(h('div.items-none', { text: 'Empty — drag items or folders here, or right-click an item → Move to folder.' }));
      g.append(box);
    }
    return g;
  }

  folderMenu(e, f) {
    const app = this.app;
    const cmd = app.cmd;
    const items = cmd.folderItems(f.id);
    const hidden = items.length && cmd.folderTargets(items).every(({ kind, id }) => this.itemOf(kind, id)?.visible === false);
    showMenu(e.clientX, e.clientY, [
      { label: 'Rename', icon: 'sketch', action: () => ((this.renaming = f.id), this.render()) },
      {
        label: 'New folder inside',
        icon: 'folder2',
        action: () => {
          this.collapsed[`folder:${f.id}`] = false;
          this.renaming = cmd.newFolder([], f.id);
          this.render();
        },
      },
      { label: 'Move to folder…', icon: 'folder', action: () => this.moveMenu(e, { kind: 'folder', folderId: f.id }, f.parent) },
      items.length && { label: 'Select everything in it', icon: 'select', action: () => app.selection.set(items) },
      items.length && { label: hidden ? 'Show everything in it' : 'Hide everything in it', icon: hidden ? 'eye' : 'eyeOff', action: () => cmd.setFolderVisible(f.id, !!hidden) },
      '-',
      { label: 'Delete folder (keep what is in it)', icon: 'folder', action: () => cmd.deleteFolder(f.id) },
      (items.length || app.doc.folders.some((x) => x.parent === f.id)) && { label: 'Delete folder and everything in it', icon: 'trash', danger: true, action: () => cmd.deleteFolder(f.id, { contents: true }) },
    ].filter(Boolean));
  }

  // Menu to move items or a folder (the selection, if the item is part of
  // it) to a folder. `current`: the folder it is in now.
  moveMenu(e, item, current) {
    const app = this.app;
    const doc = app.doc;
    const sel = app.selection;
    const items = item.kind !== 'folder' && sel.has(item) && sel.size > 1 ? sel.list : [item];
    // A folder cannot go inside itself or a folder inside it.
    const blocked = item.kind === 'folder' ? app.cmd.folderTree(item.folderId) : new Set();
    const path = (f) => {
      const names = [f.name];
      for (let p = doc.folder(f.parent), n = 0; p && n < 20; p = doc.folder(p.parent), n++) names.unshift(p.name);
      return names.join(' › ');
    };
    const entries = doc.folders.filter((f) => f.id !== current && !blocked.has(f.id)).map((f) => ({ label: path(f), raw: true, icon: 'folder', action: () => app.cmd.moveToFolder(items, f.id) }));
    if (entries.length) entries.push('-');
    entries.push({
      label: 'New folder',
      icon: 'folder2',
      action: () => {
        this.renaming = app.cmd.newFolder(items, current && doc.folder(current) ? current : null);
        this.render();
      },
    });
    if (current && doc.folder(current)) {
      const up = doc.folder(current).parent;
      const upName = up && doc.folder(up) ? doc.folder(up).name : null;
      entries.push({ label: upName ? t('Move up to {name}', { name: upName }) : 'Take out of folder', raw: !!upName, icon: 'close', action: () => app.cmd.moveToFolder(items, upName ? up : null) });
    }
    showMenu(e.clientX, e.clientY, entries);
  }

  // Rows can be dragged onto folders (the whole selection if the row is in it).
  draggable(row, item) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      const sel = this.app.selection;
      this.dragging = sel.has(item) && sel.size > 1 ? sel.list : [item];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'shaperbuild-items');
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
      this.el.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    });
  }

  dropTarget(el, folderId) {
    el.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      this.el.querySelectorAll('.drop-on').forEach((x) => x !== el && x.classList.remove('drop-on'));
      el.classList.add('drop-on');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drop-on');
    });
    el.addEventListener('drop', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-on');
      const items = this.dragging;
      this.dragging = null;
      this.app.cmd.moveToFolder(items, folderId);
    });
  }

  nameEl(item, kind) {
    const span = h('span.item-name', { str: item.name });
    span.title = item.name;
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
    if (this.renaming !== b.id) this.draggable(row, { kind: 'body', bodyId: b.id });
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
    row.append(ic, this.nameEl(s, 'sketch'), h('span.tag', { str: tn(s.entities.length, '1 curve', '{n} curves'), title: 'Curves in this sketch' }), eye, more);
    if (this.renaming !== s.id) this.draggable(row, { kind: 'sketch', sketchId: s.id });
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

  // Row for a reference plane or image.
  refRow(kind, p) {
    const app = this.app;
    const item = kind === 'plane' ? { kind, planeId: p.id } : kind === 'axis' ? { kind, axisId: p.id } : { kind, imageId: p.id };
    const sel = app.selection.has(item);
    const row = h(`div.item${sel ? '.selected' : ''}${p.visible === false ? '.hidden-item' : ''}`);
    const ic = h('span', { html: icon(kind === 'plane' ? 'planeRef' : kind === 'axis' ? 'axis' : 'image') });
    ic.querySelector('svg').style.cssText = 'width:16px;height:16px;opacity:.75';
    const eye = h(`button.item-btn${p.visible === false ? '.on' : ''}`, { title: p.visible === false ? 'Show' : 'Hide', html: icon(p.visible === false ? 'eyeOff' : 'eye') });
    eye.addEventListener('click', (e) => {
      e.stopPropagation();
      app.cmd.setVisible(kind, p.id, p.visible === false);
    });
    const more = h('button.item-btn', { title: 'More', html: icon('more') });
    const menu = (e) =>
      showMenu(e.clientX, e.clientY, [
        { label: 'Rename', icon: 'sketch', action: () => ((this.renaming = p.id), this.render()) },
        kind !== 'axis' && { label: 'Look at', icon: 'lookAt', action: () => app.vp.lookAtPlane(p.plane) },
        kind !== 'axis' && { label: 'Move…', icon: 'move', action: () => (app.selection.set([item]), app.tools.activate('move', { force: true })) },
        { label: p.visible === false ? 'Show' : 'Hide', icon: p.visible === false ? 'eye' : 'eyeOff', action: () => app.cmd.setVisible(kind, p.id, p.visible === false) },
        { label: 'Move to folder…', icon: 'folder', action: () => this.moveMenu(e, item, p.folder) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: () => app.cmd.deleteItems([item]) },
      ].filter(Boolean));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      menu(e);
    });
    row.append(ic, this.nameEl(p, kind), eye, more);
    if (this.renaming !== p.id) this.draggable(row, item);
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
      { label: 'Move to folder…', icon: 'folder', action: () => this.moveMenu(e, { kind: 'body', bodyId: b.id }, b.folder) },
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
      {
        label: 'Export as DXF…',
        icon: 'export',
        action: () => {
          this.app.selection.set([{ kind: 'sketch', sketchId: s.id }]);
          this.app.files.exportDXF();
        },
      },
      { label: s.visible === false ? 'Show' : 'Hide', icon: s.visible === false ? 'eye' : 'eyeOff', action: () => cmd.setVisible('sketch', s.id, s.visible === false) },
      { label: 'Move to folder…', icon: 'folder', action: () => this.moveMenu(e, { kind: 'sketch', sketchId: s.id }, s.folder) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: () => cmd.deleteItems([{ kind: 'sketch', sketchId: s.id }]) },
    ]);
  }
}
