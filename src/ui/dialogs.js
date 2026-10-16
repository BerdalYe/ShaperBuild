// Settings, shortcuts, help, about and the export menu.
import { h, modKey } from './dom.js';
import { modal, showMenu } from './overlays.js';
import { UNITS } from '../core/units.js';

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
      { label: 'DXF — sketches for laser cutting', icon: 'export', action: () => f.exportDXF() },
      '-',
      { label: '2D drawing (PDF, SVG, DXF)…', icon: 'file', action: () => this.app.drawing.open() },
      { label: 'Image (PNG)', icon: 'sparkle', action: () => f.exportPNG() },
      '-',
      { label: 'Save design', icon: 'file', kbd: `${modKey()}S`, action: () => f.save() },
    ]);
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
    const body = h(
      'div',
      h('h4', { text: 'General' }),
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
      check(s.additiveSelect, 'Clicking adds to the selection (like Shapr3D). Off: click replaces, Shift/Ctrl adds.', (v) => {
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
        select(s.selectFilter, [['all', 'Everything'], ['bodies', 'Bodies & faces'], ['faces', 'Faces'], ['edges', 'Edges & curves']], (v) => {
          s.selectFilter = v;
          save();
        }),
      ),
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

  shortcuts() {
    const groups = [
      ['Sketch', [['Line', 'L'], ['Rectangle', 'R'], ['Circle', 'C'], ['Arc', 'A'], ['Polygon', 'P'], ['Spline', 'B'], ['Trim', 'T'], ['Dimension', 'D'], ['Type exact sizes while drawing', '0–9, Tab, Enter'], ['Skip snapping', 'hold Alt']]],
      ['Model', [['Extrude / push-pull', 'E'], ['Revolve', 'Q'], ['Fillet', 'F'], ['Shell', 'H'], ['Union', 'U'], ['Move / rotate', 'M'], ['Measure', 'K'], ['Section view', 'X']]],
      ['View', [['Orbit', 'Right-drag / Space+drag / arrows'], ['Pan', 'Middle-drag / Shift+right-drag / Shift+Space+drag'], ['Zoom', 'Scroll / pinch / + and −'], ['Zoom to fit (selection)', 'Z'], ['Look at face or sketch', 'N'], ['Iso / Front / Right / Top', '0 / 1 / 3 / 7'], ['Perspective / orthographic', 'O'], ['Grid', 'G'], ['Visualization', 'V'], ['X-ray', 'Shift+X'], ['Items panel', 'Tab']]],
      ['Edit', [['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Delete', 'Del'], ['Duplicate', 'Ctrl+D'], ['Select all bodies', 'Ctrl+A'], ['Clear selection / cancel', 'Esc'], ['Apply tool', 'Enter'], ['Select a whole body', 'Double-click']]],
      ['File', [['New / Open / Save', 'Ctrl+N / Ctrl+O / Ctrl+S'], ['Import', 'Ctrl+I'], ['Export STL', 'Ctrl+E']]],
      ['Help', [['Find a tool or command', 'Ctrl+K'], ['This list', '? or Ctrl+/']]],
    ];
    const body = h('div');
    for (const [title, rows] of groups) {
      body.append(h('h4', { text: title }));
      const g = h('div.shortcut-grid');
      for (const [a, k] of rows) g.append(h('span', { text: a }), h('kbd', { text: k.replaceAll('Ctrl+', modKey()) }));
      body.append(g);
    }
    return modal({ title: 'Keyboard shortcuts', body, width: 620 });
  }

  gettingStarted() {
    const body = h('div', {
      html: `
      <p><b>1. Sketch.</b> Pick <b>Rectangle</b> (R) or <b>Circle</b> (C) and click on the grid. Click again to finish. Type numbers while drawing for exact sizes.</p>
      <p><b>2. Extrude.</b> Click the shaded region inside your sketch and drag the blue arrow up — or press E and type a distance.</p>
      <p><b>3. Edit.</b> Click a face of the body and drag its arrow to push or pull it. Draw on any flat face to add or cut features.</p>
      <p><b>4. Finish.</b> Select edges and use <b>Fillet</b> (F) to round them. Use <b>Union</b>, <b>Subtract</b> and <b>Intersect</b> to combine bodies.</p>
      <p><b>STL files.</b> Use <b>Import</b> to bring in STL, OBJ or 3MF meshes. You can move, scale, mirror, combine and cut them, or turn them into editable solids with <b>Mesh → Solid</b>. Export to STL or 3MF for printing.</p>
      <p><b>Navigate.</b> Right-drag to orbit, middle-drag to pan, scroll to zoom. Use the cube in the top right for standard views.</p>`,
    });
    return modal({ title: 'Getting started', body, width: 600 });
  }

  async about() {
    const info = (await window.native?.info()) || { version: 'dev' };
    const body = h('div', {
      html: `<p><b>ShaperBuild ${info.version}</b></p>
      <p>A desktop 3D CAD app for sketching, solid modelling and STL work.</p>
      <p>Geometry by OpenCascade (via replicad-opencascadejs, LGPL-2.1) and Manifold (Apache-2.0). Rendering by three.js (MIT). Built with Electron.</p>`,
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
