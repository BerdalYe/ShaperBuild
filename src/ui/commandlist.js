// Everything that is not a tool but can be found with the tool search.
import { modKey } from './dom.js';

export function appCommands(app) {
  const vp = app.vp;
  const m = modKey();
  const menu = (cmd) => () => app.onMenu(cmd);
  const view = (name, label, key) => ({ id: `view-${name}`, label, icon: 'views', kbd: key, keywords: 'view camera standard', run: () => vp.setView(name) });
  return [
    { id: 'new', label: 'New design', icon: 'plus', kbd: `${m}N`, keywords: 'file start blank empty', run: menu('new') },
    { id: 'open', label: 'Open design…', icon: 'folder', kbd: `${m}O`, keywords: 'file load', run: menu('open') },
    { id: 'save', label: 'Save', icon: 'save', kbd: `${m}S`, keywords: 'file store keep', run: menu('save') },
    { id: 'save-as', label: 'Save as…', icon: 'save', kbd: `${m}Shift+S`, keywords: 'file copy', run: menu('save-as') },
    { id: 'import', label: 'Import STL, OBJ, 3MF or STEP…', icon: 'import', kbd: `${m}I`, keywords: 'file open mesh load add', run: menu('import') },
    { id: 'print', label: '3D print — check and save STL / 3MF…', icon: 'printer', kbd: `${m}P`, keywords: '3d print printer printing slicer stl 3mf prusa bambu cura orca export', run: () => app.print.open() },
    { id: 'export-stl', label: 'Export STL…', icon: 'export', kbd: `${m}E`, keywords: '3d print printing slicer mesh file', run: menu('export-stl') },
    { id: 'export-3mf', label: 'Export 3MF…', icon: 'export', keywords: '3d print printing slicer file', run: menu('export-3mf') },
    { id: 'export-obj', label: 'Export OBJ…', icon: 'export', keywords: 'mesh file', run: menu('export-obj') },
    { id: 'export-step', label: 'Export STEP…', icon: 'export', keywords: 'cad file stp', run: menu('export-step') },
    { id: 'export-dxf', label: 'Export DXF (sketches)…', icon: 'export', keywords: 'laser cutting cnc 2d drawing file sketch', run: menu('export-dxf') },
    { id: 'export-png', label: 'Export image (PNG)…', icon: 'sparkle', keywords: 'screenshot picture render photo', run: menu('export-png') },
    { id: 'undo', label: 'Undo', icon: 'undo', kbd: `${m}Z`, keywords: 'back revert', run: () => app.cmd.undo() },
    { id: 'redo', label: 'Redo', icon: 'redo', kbd: `${m}Y`, keywords: 'again', run: () => app.cmd.redo() },
    { id: 'duplicate', label: 'Duplicate selection', icon: 'duplicate', kbd: `${m}D`, keywords: 'copy clone', run: () => app.cmd.duplicate() },
    { id: 'delete', label: 'Delete selection', icon: 'trash', kbd: 'Del', keywords: 'remove erase', run: () => app.cmd.deleteSelection() },
    { id: 'select-all', label: 'Select all bodies', icon: 'select', kbd: `${m}A`, keywords: 'everything', run: () => app.cmd.selectAll() },
    { id: 'show-all', label: 'Show all items', icon: 'eye', keywords: 'unhide visible hidden', run: () => app.cmd.showAll() },
    { id: 'fit', label: 'Zoom to fit', icon: 'fit', kbd: 'Z', keywords: 'view frame all center find lost', run: () => vp.fit(app.selectionBox()) },
    { id: 'home-view', label: 'Home view', icon: 'home', kbd: '0', keywords: 'isometric iso reset view camera', run: () => vp.setView('iso', { fit: true }) },
    view('top', 'Top view', '7'),
    view('front', 'Front view', '1'),
    view('right', 'Right view', '3'),
    view('left', 'Left view', '4'),
    view('back', 'Back view', '2'),
    view('bottom', 'Bottom view', '8'),
    { id: 'look-at', label: 'Look at selected face or sketch', icon: 'lookAt', kbd: 'N', keywords: 'normal view straight flat', run: () => app.lookAtSelection() },
    { id: 'ortho', label: 'Perspective / orthographic', icon: 'ortho', kbd: 'O', keywords: 'projection camera view', run: () => app.toggleOrtho() },
    { id: 'xray', label: 'X-ray (see-through bodies)', icon: 'xray', kbd: 'Shift+X', keywords: 'transparent see through inside hidden ghost', run: () => app.toggleXray() },
    { id: 'grid', label: 'Show or hide the grid', icon: 'grid', kbd: 'G', keywords: 'view floor', run: () => app.toggleGrid() },
    { id: 'snap', label: 'Snapping on / off', icon: 'check', kbd: 'S', keywords: 'grid align magnet', run: () => app.toggleSnap() },
    { id: 'visual', label: 'Visualization mode', icon: 'sparkle', kbd: 'V', keywords: 'render materials shadows realistic look', run: () => app.setVisualization(!app.visual) },
    { id: 'items', label: 'Show or hide the items list', icon: 'items', kbd: 'Tab', keywords: 'panel bodies sketches manager sidebar', run: () => app.toggleItems() },
    { id: 'theme', label: 'Dark / light theme', icon: 'color', keywords: 'colors appearance', run: () => app.toggleTheme() },
    { id: 'settings', label: 'Settings', icon: 'settings', kbd: `${m},`, keywords: 'preferences options units mouse trackpad', run: () => app.dialogs.settings() },
    { id: 'tutorial', label: 'Interactive tutorial', icon: 'learn', keywords: 'help learn guide tour start basics beginner', run: () => app.tutorial.start() },
    { id: 'nav-help', label: 'How to move around (navigation)', icon: 'mouse', keywords: 'help orbit pan zoom rotate view mouse trackpad camera', run: () => app.navHelp.toggle(true) },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', kbd: `${m}/`, keywords: 'help keys hotkeys', run: () => app.dialogs.shortcuts() },
    { id: 'check-updates', label: 'Check for updates', icon: 'sparkle', keywords: 'update upgrade new version download', run: () => app.updates.check(true) },
    { id: 'home', label: 'Home screen (recent designs)', icon: 'home', keywords: 'recent projects files start', run: () => app.home.show() },
  ];
}

// Score how well `query` matches an entry; 0 = no match.
export function matchScore(query, { label, keywords = '', desc = '' }) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  const l = label.toLowerCase();
  const words = l.split(/[^a-z0-9]+/);
  const kw = keywords.toLowerCase().split(/\s+/);
  const d = desc.toLowerCase();
  let total = 0;
  for (const t of terms) {
    let s = 0;
    if (l.startsWith(t)) s = 100;
    else if (words.some((w) => w.startsWith(t))) s = 80;
    else if (kw.includes(t)) s = 70;
    else if (kw.some((w) => w.startsWith(t))) s = 50;
    else if (l.includes(t)) s = 30;
    else if (t.length > 2 && d.includes(t)) s = 10;
    if (!s) return 0;
    total += s;
  }
  return total;
}
