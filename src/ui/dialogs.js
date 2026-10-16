// Settings, shortcuts, help, about and the export menu.
import { h, modKey, isMac } from './dom.js';
import { modal, showMenu, toast } from './overlays.js';
import { COMMANDS, PRESETS, comboOf, showCombo } from '../core/keymap.js';
import { TOOL_SECTIONS } from '../tools/registry.js';
import { UNITS } from '../core/units.js';
import { t, LANGUAGES, language } from '../core/i18n.js';

export class Dialogs {
  constructor(app) {
    this.app = app;
  }

  exportMenu(e) {
    const f = this.app.files;
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, [
      { label: '3D print (check and save)…', icon: 'printer', kbd: `${modKey()}P`, action: () => this.app.print.open() },
      '-',
      { label: 'STL — 3D printing', icon: 'export', kbd: `${modKey()}E`, action: () => f.exportDialog('stl') },
      { label: '3MF — 3D printing', icon: 'export', action: () => f.exportDialog('3mf') },
      { label: 'OBJ — mesh', icon: 'export', action: () => f.exportDialog('obj') },
      { label: 'STEP — CAD exchange', icon: 'export', action: () => f.exportDialog('step') },
      { label: 'GLB — 3D viewers and the web (with colours)', icon: 'export', action: () => f.exportDialog('glb') },
      { label: 'USDZ — AR on iPhone and iPad', icon: 'export', action: () => f.exportDialog('usdz') },
      { label: 'DXF — sketches for laser cutting', icon: 'export', action: () => f.exportDXF() },
      '-',
      { label: '2D drawing (PDF, SVG, DXF)…', icon: 'file', action: () => this.app.drawing.open() },
      { label: 'Screenshot (PNG)…', icon: 'camera', action: () => this.screenshot() },
      '-',
      { label: 'Save design', icon: 'file', kbd: `${modKey()}S`, action: () => f.save() },
    ]);
  }

  // Screenshot: the view as a PNG at a chosen size, optionally without
  // the background.
  async screenshot() {
    const app = this.app;
    const vp = app.vp;
    const gl = vp.renderer.getContext();
    const max = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE), ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
    const pr = vp.renderer.getPixelRatio();
    const win = [Math.round(vp.width * pr), Math.round(vp.height * pr)];
    const sizes = [
      ['window', 'Window size', win],
      ['double', 'Double', [win[0] * 2, win[1] * 2]],
      ['hd', 'Full HD', [1920, 1080]],
      ['4k', '4K', [3840, 2160]],
      ['8k', '8K', [7680, 4320]],
    ];
    const choice = h('div.shot-sizes');
    let pick = app.settings.shotSize || 'hd';
    for (const [key, label, [w, hh]] of sizes) {
      const ok = w <= max && hh <= max;
      const r = h('input', { type: 'radio', name: 'shot-size', value: key, checked: key === pick && ok, disabled: !ok });
      r.addEventListener('change', () => (pick = key));
      choice.append(h('label.shot-size', r, h('span', { text: label }), h('small', { str: `${w} × ${hh}` }), ok ? null : h('small', { text: 'too big for this graphics card' })));
    }
    const clear = h('input', { type: 'checkbox', checked: !!app.settings.shotTransparent });
    const ok = await modal({
      title: 'Screenshot',
      body: h('div', choice, h('label.toggle', clear, h('span', { text: 'Transparent background' }))),
      buttons: [
        { label: 'Cancel', value: false },
        { label: 'Save PNG…', value: true, primary: true },
      ],
    });
    if (!ok) return null;
    const size = sizes.find((s) => s[0] === pick && s[2][0] <= max && s[2][1] <= max) || sizes[0];
    app.settings.shotSize = size[0];
    app.settings.shotTransparent = clear.checked;
    app.saveSettings();
    return app.files.exportPNG({ pixels: size[2], transparent: clear.checked });
  }

  async settings() {
    const app = this.app;
    const s = app.settings;
    const row = (label, control) => h('div.form-row', h('label', { text: label }), control);
    const select = (value, options, onChange) => {
      const el = h('select');
      for (const [v, l] of options) el.append(h('option', { value: v, text: l, selected: v === value }));
      el.addEventListener('change', () => onChange(el.value));
      return el;
    };
    const check = (value, label, onChange) => {
      const inp = h('input', { type: 'checkbox', checked: !!value });
      inp.addEventListener('change', () => onChange(inp.checked));
      return h('label.toggle', inp, h('span', { text: label }));
    };
    const save = () => {
      app.saveSettings();
      app.applyViewSettings();
    };
    // Each language is named in its own language.
    const lang = h('select');
    for (const l of LANGUAGES) lang.append(h('option', { value: l.id, str: l.name, selected: l.id === language() }));
    lang.addEventListener('change', () => {
      app.setLanguageSetting(lang.value);
      if (lang.value !== language()) app.welcome.restartPrompt();
    });
    lang.dataset.setting = 'language';
    const body = h(
      'div',
      h('h4', { text: 'General' }),
      row('Language', lang),
      row('Theme', select(s.theme, [['dark', 'Dark'], ['light', 'Light']], (v) => v !== s.theme && app.toggleTheme())),
      check(s.autoUpdate !== false, 'Check for updates automatically and install them on restart', (v) => {
        s.autoUpdate = v;
        app.saveSettings();
        if (v) app.updates.start();
        else app.updates.stop();
      }),
      h('div', { style: { height: '8px' } }),
      row('Units for this design', select(app.units, Object.entries(UNITS).map(([k, u]) => [k, u.name]), (v) => app.cmd.setUnits(v))),
      h('h4', { text: 'Navigation' }),
      row(
        'Scroll wheel / two-finger swipe',
        select(s.scrollMode, [['auto', 'Automatic'], ['zoom', 'Zoom (mouse)'], ['orbit', 'Orbit (trackpad)']], (v) => {
          s.scrollMode = v;
          save();
        }),
      ),
      h('div', { style: { fontSize: '12px', color: 'var(--muted)', margin: '-2px 0 6px 160px' }, text: 'Right-drag orbits, middle-drag or Shift+right-drag pans. Hold Space and drag to orbit with the left button. Pinch to zoom on a trackpad.' }),
      h('h4', { text: 'Selection & drawing' }),
      check(s.additiveSelect, 'Clicking adds to the selection. Off: click replaces, Shift/Ctrl adds.', (v) => {
        s.additiveSelect = v;
        save();
      }),
      h('div', { style: { height: '8px' } }),
      check(s.snap, 'Snap to geometry and grid (hold Alt to skip)', (v) => {
        s.snap = v;
        save();
        document.getElementById('btn-snap').classList.toggle('on', v);
      }),
      h('div', { style: { height: '8px' } }),
      row(
        'Select only',
        select(s.selectFilter, [['all', 'Select all items'], ['bodies', 'Bodies only'], ['faces', 'Faces only'], ['edges', 'Edges only']], (v) => app.setSelectFilter(v)),
      ),
      row('Keyboard shortcuts', h('div', h('button.btn', { text: t('{name} — change…', { name: t(PRESETS[app.keymap.preset].name) }), onClick: () => this.keymapEditor() }))),
      h('h4', { text: 'Display' }),
      check(s.showGrid, 'Show grid', (v) => {
        s.showGrid = v;
        save();
      }),
      h('div', { style: { height: '8px' } }),
      check(s.showEdges, 'Show body edges', (v) => {
        s.showEdges = v;
        save();
      }),
      h('div', { style: { height: '8px' } }),
      check(s.toolLabels !== false, 'Show tool names in the tools menu', (v) => {
        if (v !== (s.toolLabels !== false)) app.toggleToolLabels();
      }),
      h('h4', { text: 'Export' }),
      row(
        'STL / 3MF / OBJ quality',
        select(s.stlQuality, [['coarse', 'Coarse (small files)'], ['normal', 'Normal'], ['fine', 'Fine (recommended)'], ['ultra', 'Ultra (large files)']], (v) => {
          s.stlQuality = v;
          save();
        }),
      ),
      row(
        'STL format',
        select(s.stlBinary === false ? 'ascii' : 'binary', [['binary', 'Binary (smaller)'], ['ascii', 'ASCII (text)']], (v) => {
          s.stlBinary = v === 'binary';
          save();
        }),
      ),
    );
    await modal({ title: 'Settings', body, buttons: [{ label: 'Done', primary: true }] });
  }

  // Every action that can have a key: [id, label, group].
  actions() {
    const tools = TOOL_SECTIONS.flatMap((sec) => sec.tools.map((tool) => [`tool:${tool.id}`, tool.label, sec.title]));
    return [...tools, ...COMMANDS];
  }

  shortcuts() {
    const app = this.app;
    const mac = isMac();
    const fixed = [
      ['View', [['Orbit', 'Right-drag / Space+drag / arrows'], ['Pan', 'Middle-drag / Shift+right-drag / Shift+Space+drag'], ['Zoom', 'Scroll / pinch / + and −'], ['Look at the face under the pointer', 'tap Space']]],
      ['Edit', [['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Delete', 'Del'], ['Duplicate', 'Ctrl+D'], ['Select all bodies', 'Ctrl+A'], ['Clear selection / cancel', 'Esc'], ['Apply tool', 'Enter'], ['Select a whole body', 'Double-click']]],
      ['Sketch', [['Type exact sizes while drawing', '0–9, Tab, Enter'], ['Skip snapping', 'hold Alt']]],
      ['File', [['New / Open / Save', 'Ctrl+N / Ctrl+O / Ctrl+S'], ['Import', 'Ctrl+I'], ['Export STL', 'Ctrl+E']]],
    ];
    const body = h('div');
    const preset = PRESETS[app.keymap.preset];
    body.append(h('div.ks-preset', h('span', { text: t('Shortcut set: {name}', { name: t(preset.name) }) }), h('button.btn', { text: 'Change keys…', onClick: () => this.keymapEditor() })));
    const groups = new Map();
    for (const [id, label, group] of this.actions()) {
      const key = app.keyFor(id);
      if (!key) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([label, showCombo(key, mac)]);
    }
    for (const [title, rows] of fixed) if (!groups.has(title)) groups.set(title, []);
    for (const [title, rows] of fixed) groups.get(title).push(...rows.map(([a, k]) => [a, k.replaceAll('Ctrl+', modKey())]));
    for (const [title, rows] of groups) {
      if (!rows.length) continue;
      body.append(h('h4', { text: title }));
      const g = h('div.shortcut-grid');
      for (const [a, k] of rows) g.append(h('span', { text: a }), h('kbd', { text: k }));
      body.append(g);
    }
    return modal({ title: 'Keyboard shortcuts', body, width: 640 });
  }

  // Change keys: pick a ready-made set, then press new keys for any action.
  keymapEditor() {
    const app = this.app;
    const mac = isMac();
    const settings = () => (app.settings.keymap ||= { preset: 'shaperbuild', keys: {} });
    const save = () => {
      app.saveSettings();
      app.reloadKeymap();
      render();
    };
    const body = h('div.ks-editor');
    let filter = '';
    let recording = null;
    const render = () => {
      body.replaceChildren();
      const presetSel = h('select');
      for (const [id, p] of Object.entries(PRESETS)) presetSel.append(h('option', { value: id, text: p.name, selected: id === app.keymap.preset }));
      presetSel.addEventListener('change', () => {
        settings().preset = presetSel.value;
        settings().keys = {};
        save();
      });
      const search = h('input.ks-search', { type: 'text', placeholder: 'Find an action', value: filter });
      search.addEventListener('input', () => {
        filter = search.value;
        renderRows();
      });
      search.addEventListener('keydown', (e) => e.stopPropagation());
      const reset = h('button.btn', { text: 'Reset all keys', onClick: () => ((settings().keys = {}), save()) });
      const json = h('button.btn', { text: 'Edit as JSON', onClick: () => this.keymapJSON().then(render) });
      body.append(h('div.ks-top', h('label', { text: 'Shortcut set' }), presetSel, reset, json), h('p.ks-hint', { text: 'Click a key to change it, then press the new keys. Backspace removes the key, Esc keeps it.' }), search);
      const list = h('div.ks-list');
      body.append(list);
      const renderRows = () => {
        list.replaceChildren();
        const q = filter.trim().toLowerCase();
        let group = null;
        for (const [id, label, grp] of this.actions()) {
          if (q && !`${label} ${t(label)} ${grp} ${t(grp)}`.toLowerCase().includes(q)) continue;
          if (grp !== group) {
            group = grp;
            list.append(h('h4', { text: grp }));
          }
          const key = app.keyFor(id);
          const changed = id in (settings().keys || {});
          const btn = h(`button.ks-key${recording === id ? '.recording' : ''}${changed ? '.changed' : ''}`, { text: recording === id ? 'Press keys…' : key ? showCombo(key, mac) : '—' });
          btn.addEventListener('click', () => {
            recording = id;
            renderRows();
            const onKey = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'Escape') return done(null);
              if (e.key === 'Backspace' || e.key === 'Delete') return done('');
              const combo = comboOf(e);
              if (combo) done(combo);
            };
            const done = (combo) => {
              window.removeEventListener('keydown', onKey, true);
              recording = null;
              if (combo === null) return renderRows();
              const taken = combo && this.actions().find(([a]) => a !== id && app.keyFor(a) === combo);
              settings().keys = { ...settings().keys, [id]: combo };
              if (taken) toast(t('{key} was used by {action}; that action has no key now', { key: showCombo(combo, mac), action: t(taken[1]) }), { ms: 4000 });
              save();
            };
            window.addEventListener('keydown', onKey, true);
          });
          list.append(h('div.ks-row', h('span', { text: label }), btn));
        }
      };
      renderRows();
    };
    render();
    return modal({ title: 'Change keyboard shortcuts', body, width: 600, buttons: [{ label: 'Done', primary: true }] });
  }

  // The keys as JSON ({ preset, keys }), to copy, share or edit by hand.
  async keymapJSON() {
    const app = this.app;
    const area = h('textarea.ks-json', { rows: 16, spellcheck: false });
    area.value = JSON.stringify(app.settings.keymap || { preset: 'shaperbuild', keys: {} }, null, 2);
    area.addEventListener('keydown', (e) => e.stopPropagation());
    const v = await modal({
      title: 'Keyboard shortcuts as JSON',
      body: h('div', h('p.ks-hint', { text: '"preset" is shaperbuild or shapr; "keys" changes single actions, like "tool:extrude": "E". An empty text removes a key.' }), area),
      width: 560,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, primary: true }],
    });
    if (!v) return;
    try {
      const data = JSON.parse(area.value);
      if (typeof data !== 'object' || !data) throw new Error('Not an object');
      const known = new Set(this.actions().map(([id]) => id));
      const keys = {};
      for (const [k, c] of Object.entries(data.keys || {})) if (known.has(k) && typeof c === 'string') keys[k] = c;
      app.settings.keymap = { preset: PRESETS[data.preset] ? data.preset : 'shaperbuild', keys };
      app.saveSettings();
      app.reloadKeymap();
    } catch (err) {
      toast(t('That is not valid JSON: {error}', { error: err.message }), { type: 'error', ms: 5000 });
    }
  }

  gettingStarted() {
    const paras = [
      '<b>1. Sketch.</b> Pick <b>Rectangle</b> (R) or <b>Circle</b> (C) and click on the grid. Click again to finish. Type numbers while drawing for exact sizes.',
      '<b>2. Extrude.</b> Click the shaded region inside your sketch and drag the blue arrow up — or press E and type a distance.',
      '<b>3. Edit.</b> Click a face of the body and drag its arrow to push or pull it. Draw on any flat face to add or cut features.',
      '<b>4. Finish.</b> Select edges and use <b>Fillet</b> (F) to round them. Use <b>Union</b>, <b>Subtract</b> and <b>Intersect</b> to combine bodies.',
      '<b>STL files.</b> Use <b>Import</b> to bring in STL, OBJ or 3MF meshes. You can move, scale, mirror, combine and cut them, or turn them into editable solids with <b>Mesh → Solid</b>. Export to STL or 3MF for printing.',
      '<b>Navigate.</b> Right-drag to orbit, middle-drag to pan, scroll to zoom. Use the cube in the top right for standard views.',
    ];
    const body = h('div', { html: paras.map((p) => `<p>${t(p)}</p>`).join('') });
    return modal({ title: 'Getting started', body, width: 600 });
  }

  async about() {
    const info = (await window.native?.info()) || { version: 'dev' };
    const body = h('div', {
      html: `<p><b>ShaperBuild ${info.version}</b></p>
      <p>${t('A desktop 3D CAD app for sketching, solid modelling and STL work.')}</p>
      <p>${t('Geometry by OpenCascade (via replicad-opencascadejs, LGPL-2.1) and Manifold (Apache-2.0). Rendering by three.js (MIT). Built with Electron.')}</p>`,
    });
    const v = await modal({
      title: 'About',
      body,
      buttons: [
        { label: 'Check for updates', value: 'check' },
        { label: 'Close', primary: true },
      ],
    });
    if (v === 'check') this.app.updates.check(true);
  }
}
