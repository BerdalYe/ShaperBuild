// Native application menu. Every item sends a command string to the
// renderer, which owns the behaviour (see src/ui/commands.js).
const path = require('node:path');

function buildMenu({ send, recent = [], isDev = false }) {
  const { Menu, app } = require('electron');
  const mac = process.platform === 'darwin';
  // Shortcuts are shown in the menu but handled by the renderer (see
  // setupKeys in src/app.js), so text fields keep their own Ctrl+Z etc.
  const cmd = (label, command, accelerator, extra = {}) => ({
    label,
    accelerator,
    registerAccelerator: false,
    click: () => send(command),
    ...extra,
  });
  const hint = cmd;

  const recentItems = recent.length
    ? [
        ...recent.map((p) => ({ label: path.basename(p), click: () => send('open-path', p) })),
        { type: 'separator' },
        { label: 'Clear Recent', click: () => send('clear-recent') },
      ]
    : [{ label: 'No recent designs', enabled: false }];

  const template = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              cmd('About ShaperBuild', 'about'),
              { type: 'separator' },
              cmd('Settings…', 'settings', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New Design', 'new', 'CmdOrCtrl+N'),
        cmd('Open…', 'open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        cmd('Save', 'save', 'CmdOrCtrl+S'),
        cmd('Save As…', 'save-as', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('Import…', 'import', 'CmdOrCtrl+I'),
        cmd('3D Print…', 'print', 'CmdOrCtrl+P'),
        {
          label: 'Export',
          submenu: [
            cmd('STL (3D printing)…', 'export-stl', 'CmdOrCtrl+E'),
            cmd('3MF (3D printing)…', 'export-3mf'),
            cmd('OBJ…', 'export-obj'),
            cmd('STEP (CAD)…', 'export-step'),
            { type: 'separator' },
            cmd('Image (PNG)…', 'export-png'),
          ],
        },
        { type: 'separator' },
        cmd('Close Design', 'close-design', 'CmdOrCtrl+W'),
        ...(mac ? [] : [{ type: 'separator' }, cmd('Settings…', 'settings', 'Ctrl+,'), { type: 'separator' }, { role: 'quit', label: 'Exit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        cmd('Undo', 'undo', 'CmdOrCtrl+Z'),
        cmd('Redo', 'redo', mac ? 'Cmd+Shift+Z' : 'Ctrl+Y'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        cmd('Duplicate', 'duplicate', 'CmdOrCtrl+D'),
        hint('Delete', 'delete', 'Delete'),
        cmd('Select All Bodies', 'select-all', 'CmdOrCtrl+A', { registerAccelerator: false }),
        hint('Deselect', 'deselect', 'Escape'),
      ],
    },
    {
      label: 'View',
      submenu: [
        hint('Zoom to Fit', 'view-fit', 'Z'),
        { type: 'separator' },
        hint('Isometric', 'view-iso', '0'),
        hint('Top', 'view-top', '7'),
        hint('Front', 'view-front', '1'),
        hint('Right', 'view-right', '3'),
        hint('Back', 'view-back', '2'),
        hint('Left', 'view-left', '4'),
        hint('Bottom', 'view-bottom', '8'),
        hint('Look at Sketch / Face', 'view-normal', 'N'),
        { type: 'separator' },
        hint('Perspective / Orthographic', 'toggle-ortho', 'O'),
        hint('Visualization Mode', 'toggle-visualization', 'V'),
        hint('Section View', 'toggle-section', 'X'),
        hint('X-ray', 'toggle-xray', 'Shift+X'),
        hint('Show Grid', 'toggle-grid', 'G'),
        cmd('Show Edges', 'toggle-edges'),
        cmd('Light / Dark Theme', 'toggle-theme'),
        { type: 'separator' },
        hint('Items Panel', 'toggle-items', 'Tab'),
        cmd('Tool Names in Tools Menu', 'toggle-tool-labels'),
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        cmd('Interactive Tutorial', 'tutorial'),
        cmd('How to Move Around', 'navigation-help'),
        cmd('Find a Tool…', 'find-tool', 'CmdOrCtrl+K'),
        { type: 'separator' },
        cmd('Keyboard Shortcuts', 'shortcuts', 'CmdOrCtrl+/'),
        cmd('Getting Started', 'getting-started'),
        ...(mac ? [] : [{ type: 'separator' }, cmd('About ShaperBuild', 'about')]),
        ...(isDev ? [] : [{ type: 'separator' }, { role: 'toggleDevTools', label: 'Developer Tools' }]),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
