// Electron main process: window, native menu, the app:// protocol that serves
// the renderer, file dialogs and recent files. All CAD logic lives in the
// renderer (src/) and its geometry worker.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { buildMenu } = require('./menu.cjs');

const ROOT = path.join(__dirname, '..');
const SCHEME = 'app';
const HOST = 'shaperbuild';
const PROJECT_EXT = 'shaperbuild';

// Only these folders are reachable from the renderer.
const SERVED = ['/src/', '/node_modules/three/build/', '/node_modules/replicad-opencascadejs/dist/'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.hdr': 'application/octet-stream',
};

// Let machines without a usable GPU (VMs, remote desktops) fall back to
// software WebGL. Only local app content is ever loaded.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// Single instance: a second launch (e.g. double-clicking a file) focuses the
// running window and opens the file there.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let rendererReady = false;
let pendingOpen = [];
let dirty = false;
let closeConfirmed = false;

function recentFile() {
  return path.join(app.getPath('userData'), 'recent.json');
}
function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    return list.filter((p) => typeof p === 'string' && fs.existsSync(p)).slice(0, 12);
  } catch {
    return [];
  }
}
function addRecent(p) {
  const list = [p, ...readRecent().filter((x) => x !== p)].slice(0, 12);
  try {
    fs.mkdirSync(path.dirname(recentFile()), { recursive: true });
    fs.writeFileSync(recentFile(), JSON.stringify(list));
  } catch {}
  if (process.platform !== 'linux') app.addRecentDocument(p);
  refreshMenu();
  return list;
}

function sendMenu(command, arg) {
  if (win && !win.isDestroyed()) win.webContents.send('menu', command, arg);
}

function refreshMenu() {
  Menu.setApplicationMenu(buildMenu({ send: sendMenu, recent: readRecent(), isDev: !app.isPackaged }));
}

function openPaths(paths) {
  const files = paths.filter((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
  if (!files.length) return;
  if (rendererReady && win) {
    for (const f of files) win.webContents.send('open-path', f);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingOpen.push(...files);
  }
}

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && /\.(shaperbuild|stl|obj|step|stp|3mf)$/i.test(a));
}

function createWindow() {
  closeConfirmed = false;
  dirty = false;
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1c1d21',
    title: 'ShaperBuild',
    show: false,
    icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${SCHEME}://${HOST}/src/index.html`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) e.preventDefault();
  });

  win.on('close', (e) => {
    if (!dirty || closeConfirmed) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Do you want to save the changes to your design?',
      detail: "Your changes will be lost if you don't save them.",
    });
    if (choice === 0) sendMenu('save-and-close');
    else if (choice === 1) {
      closeConfirmed = true;
      win.close();
    }
  });
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });
}

async function serve(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/src/index.html';
  if (!SERVED.some((prefix) => pathname.startsWith(prefix)) || pathname.includes('..')) {
    return new Response('Not found', { status: 404 });
  }
  const file = path.join(ROOT, pathname);
  try {
    const data = await fs.promises.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ---- IPC -----------------------------------------------------------------

const FILTERS = {
  project: [{ name: 'ShaperBuild design', extensions: [PROJECT_EXT] }],
  open: [
    { name: 'All supported', extensions: [PROJECT_EXT, 'stl', 'obj', 'step', 'stp', '3mf'] },
    { name: 'ShaperBuild design', extensions: [PROJECT_EXT] },
    { name: 'Mesh (STL, OBJ, 3MF)', extensions: ['stl', 'obj', '3mf'] },
    { name: 'STEP', extensions: ['step', 'stp'] },
  ],
  import: [
    { name: 'All supported', extensions: ['stl', 'obj', 'step', 'stp', '3mf'] },
    { name: 'STL', extensions: ['stl'] },
    { name: 'OBJ', extensions: ['obj'] },
    { name: 'STEP', extensions: ['step', 'stp'] },
    { name: '3MF', extensions: ['3mf'] },
  ],
  stl: [{ name: 'STL', extensions: ['stl'] }],
  obj: [{ name: 'OBJ', extensions: ['obj'] }],
  step: [{ name: 'STEP', extensions: ['step', 'stp'] }],
  '3mf': [{ name: '3MF', extensions: ['3mf'] }],
  png: [{ name: 'PNG image', extensions: ['png'] }],
};

ipcMain.handle('dialog:open', async (_e, { kind = 'open', multi = false } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: FILTERS[kind] || FILTERS.open,
  });
  if (res.canceled) return [];
  return res.filePaths;
});

ipcMain.handle('dialog:save', async (_e, { kind = 'project', defaultName = 'Untitled' } = {}) => {
  const filters = FILTERS[kind] || FILTERS.project;
  const ext = filters[0].extensions[0];
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `${defaultName}.${ext}`),
    filters,
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('fs:read', async (_e, file) => {
  const data = await fs.promises.readFile(file);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
});

ipcMain.handle('fs:write', async (_e, file, data) => {
  await fs.promises.writeFile(file, Buffer.from(data));
  return true;
});

ipcMain.handle('recent:get', () => readRecent());
ipcMain.handle('recent:add', (_e, p) => addRecent(p));
ipcMain.handle('recent:clear', () => {
  try {
    fs.writeFileSync(recentFile(), '[]');
  } catch {}
  refreshMenu();
  return [];
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dark: nativeTheme.shouldUseDarkColors,
}));

ipcMain.on('app:ready', () => {
  rendererReady = true;
  const files = pendingOpen;
  pendingOpen = [];
  for (const f of files) win.webContents.send('open-path', f);
});
ipcMain.on('app:dirty', (_e, value) => {
  dirty = !!value;
  if (win && process.platform === 'darwin') win.setDocumentEdited(dirty);
});
ipcMain.on('app:title', (_e, title) => {
  if (win) win.setTitle(title);
});
ipcMain.on('app:represented', (_e, file) => {
  if (win && process.platform === 'darwin') win.setRepresentedFilename(file || '');
});
ipcMain.on('app:close-confirmed', () => {
  closeConfirmed = true;
  if (win) win.close();
});
ipcMain.on('shell:show', (_e, file) => shell.showItemInFolder(file));
ipcMain.on('shell:open-url', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---- lifecycle -----------------------------------------------------------

app.on('open-file', (e, file) => {
  e.preventDefault();
  openPaths([file]);
});

app.on('second-instance', (_e, argv) => {
  openPaths(filesFromArgv(argv));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, serve);
  refreshMenu();
  createWindow();
  openPaths(filesFromArgv(process.argv));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
