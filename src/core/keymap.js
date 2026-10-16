// Keyboard shortcuts. Every shortcut is an action with a key combination
// ("E", "Shift+V", "Ctrl+4"; Ctrl means Cmd on a Mac). There are two
// ready-made sets — ShaperBuild's own and an alternative one laid out like
// tablet CAD apps — and people can change any key on top of the set they
// chose.

// [action id, label, group]. Tools are added from the tool registry.
export const COMMANDS = [
  ['find-tool', 'Find a tool or command', 'General'],
  ['shortcuts', 'Keyboard shortcuts', 'General'],
  ['view-iso', 'Reset view (isometric)', 'View'],
  ['view-front', 'Front view', 'View'],
  ['view-back', 'Back view', 'View'],
  ['view-top', 'Top view', 'View'],
  ['view-bottom', 'Bottom view', 'View'],
  ['view-right', 'Right view', 'View'],
  ['view-left', 'Left view', 'View'],
  ['view-fit', 'Zoom to fit (selection)', 'View'],
  ['view-normal', 'Look at face or sketch', 'View'],
  ['toggle-ortho', 'Perspective / orthographic', 'View'],
  ['toggle-grid', 'Grid', 'View'],
  ['toggle-visualization', 'Visualization', 'View'],
  ['toggle-xray', 'X-ray', 'View'],
  ['toggle-section', 'Section view', 'View'],
  ['toggle-isolate', 'Isolate (show only the selection)', 'View'],
  ['toggle-items', 'Items panel', 'View'],
  ['show-history', 'Design history', 'View'],
  ['toggle-snap', 'Snapping on/off', 'Selection'],
  ['deselect', 'Clear selection', 'Selection'],
  ['select-through', 'Select through (pick what is under the pointer)', 'Selection'],
  ['filter-cycle', 'Next selection filter', 'Selection'],
  ['filter-all', 'Select everything', 'Selection'],
  ['filter-bodies', 'Select bodies only', 'Selection'],
  ['filter-faces', 'Select faces only', 'Selection'],
  ['filter-edges', 'Select edges only', 'Selection'],
  ['constrain-parallel', 'Parallel', 'Constraints'],
  ['constrain-perpendicular', 'Perpendicular', 'Constraints'],
  ['constrain-hv', 'Horizontal / vertical', 'Constraints'],
  ['constrain-equal', 'Equal', 'Constraints'],
  ['constrain-tangent', 'Tangent', 'Constraints'],
  ['constrain-concentric', 'Concentric', 'Constraints'],
  ['constrain-coincident', 'Coincident', 'Constraints'],
  ['constrain-midpoint', 'Midpoint', 'Constraints'],
  ['constrain-fix', 'Lock', 'Constraints'],
];

// Keys both sets share.
const COMMON = {
  'find-tool': 'Ctrl+K',
  shortcuts: '?',
  'view-iso': 'Ctrl+1',
  'view-front': 'Ctrl+2',
  'view-back': 'Ctrl+3',
  'view-top': 'Ctrl+4',
  'view-bottom': 'Ctrl+5',
  'view-right': 'Ctrl+6',
  'view-left': 'Ctrl+7',
  deselect: 'Ctrl+Shift+A',
  'toggle-xray': 'Shift+X',
  'toggle-isolate': 'Shift+I',
  'show-history': 'Shift+H',
  'constrain-parallel': 'Shift+A',
  'constrain-concentric': 'Shift+C',
  'constrain-equal': 'Shift+E',
  'constrain-hv': 'Shift+V',
  'constrain-coincident': 'Shift+N',
  'constrain-fix': 'Shift+L',
  'constrain-midpoint': 'Shift+M',
  'constrain-perpendicular': 'Shift+P',
  'constrain-tangent': 'Shift+T',
};

export const PRESETS = {
  shaperbuild: {
    name: 'ShaperBuild',
    keys: {
      ...COMMON,
      'tool:line': 'L',
      'tool:rect': 'R',
      'tool:circle': 'C',
      'tool:arc': 'A',
      'tool:polygon': 'P',
      'tool:spline': 'B',
      'tool:trim': 'T',
      'tool:dimension': 'D',
      'tool:extrude': 'E',
      'tool:revolve': 'Q',
      'tool:fillet': 'F',
      'tool:shell': 'H',
      'tool:union': 'U',
      'tool:move': 'M',
      'tool:measure': 'K',
      'view-iso': '0',
      'view-front': '1',
      'view-back': '2',
      'view-right': '3',
      'view-left': '4',
      'view-top': '7',
      'view-bottom': '8',
      'view-fit': 'Z',
      'view-normal': 'N',
      'toggle-ortho': 'O',
      'toggle-grid': 'G',
      'toggle-visualization': 'V',
      'toggle-section': 'X',
      'toggle-snap': 'S',
      'toggle-items': 'Tab',
      'select-through': 'Ctrl+Alt+S',
      'filter-cycle': 'Shift+Tab',
    },
    // Ctrl+1…7 also work in this set.
    extra: { 'view-iso': ['Ctrl+1'], 'view-front': ['Ctrl+2'], 'view-back': ['Ctrl+3'], 'view-top': ['Ctrl+4'], 'view-bottom': ['Ctrl+5'], 'view-right': ['Ctrl+6'], 'view-left': ['Ctrl+7'], 'find-tool': ['Ctrl+F'] },
  },
  tablet: {
    name: 'Alternative (tablet CAD style)',
    keys: {
      ...COMMON,
      'find-tool': 'X',
      'tool:arc': 'A',
      'tool:circle': 'C',
      'tool:polygon': 'G',
      'tool:spline': 'I',
      'tool:line': 'L',
      'tool:offset': 'O',
      'tool:rect': 'R',
      'tool:trim': 'T',
      'tool:extrude': 'E',
      'tool:fillet': 'F',
      'tool:shell': 'H',
      'tool:move': 'M',
      'tool:translate': 'N',
      'tool:project': 'P',
      'tool:scale': 'S',
      'tool:revolve': 'V',
      'tool:sweep': 'W',
      'tool:union': 'Ctrl+U',
      'tool:subtract': 'Ctrl+B',
      'tool:intersect': 'Ctrl+I',
      'select-through': 'Ctrl+Shift+S',
      'filter-cycle': 'Tab',
      'filter-bodies': 'B',
      'filter-faces': 'Shift+F',
      'filter-edges': 'Shift+G',
      'view-fit': 'Z',
    },
    extra: { 'find-tool': ['Ctrl+F'] },
  },
};

const MODS = ['Ctrl', 'Alt', 'Shift'];
const NAMED = { ' ': 'Space', Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Delete: 'Del' };

// "Ctrl+Shift+S" for a keydown event (or null for a lone modifier key).
// Letters are matched by key, so they follow the keyboard layout.
export function comboOf(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null;
  let key = NAMED[e.key] || e.key;
  if (key.length === 1) key = key.toUpperCase();
  // Shift+1 gives "!" on most layouts: use the digit for Ctrl/Alt shortcuts.
  if (/^Digit\d$/.test(e.code || '') && (e.ctrlKey || e.metaKey || e.altKey)) key = e.code.slice(5);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  // Shift is part of the key itself for symbols like "?" and "+".
  if (e.shiftKey && (key.length > 1 || /[A-Z0-9]/.test(key))) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

// Tidy a typed combination: "shift + ctrl + s" -> "Ctrl+Shift+S".
export function normalizeCombo(text) {
  const parts = String(text || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  const key = parts.pop();
  const mods = MODS.filter((m) => parts.some((p) => p.toLowerCase() === m.toLowerCase() || (m === 'Ctrl' && /^(cmd|command|meta|control)$/i.test(p))));
  const k = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
  return [...mods, k].join('+');
}

// The keys in use: { preset, keys: { action: combo|'' } } -> lookups.
export function buildKeymap(presetId = 'shaperbuild', overrides = {}) {
  const preset = PRESETS[presetId] || PRESETS.shaperbuild;
  const keys = { ...preset.keys };
  for (const [action, combo] of Object.entries(overrides || {})) {
    const c = combo ? normalizeCombo(combo) : '';
    // A key given to one action is taken from any other.
    if (c) for (const [a, k] of Object.entries(keys)) if (k === c && a !== action) keys[a] = '';
    keys[action] = c;
  }
  const byCombo = new Map();
  for (const [action, list] of Object.entries(preset.extra || {})) for (const c of list) if (!Object.values(keys).includes(c)) byCombo.set(c, action);
  for (const [action, c] of Object.entries(keys)) if (c) byCombo.set(c, action);
  return { preset: presetId in PRESETS ? presetId : 'shaperbuild', keys, byCombo };
}

// How a combination is shown: Ctrl becomes ⌘ on a Mac.
export function showCombo(combo, mac = false) {
  if (!combo) return '';
  return mac ? combo.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : combo;
}
