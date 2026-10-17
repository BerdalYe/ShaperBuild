// Electron main process: window, native menu, the app:// protocol that serves
// the renderer, file dialogs and recent files. All CAD logic lives in the
// renderer (src/) and its geometry worker.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, nativeTheme, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { buildMenu } = require('./menu.cjs');
const i18n = require('./i18n.cjs');
const { listSlicers, openInSlicer } = require('./slicers.cjs');
const updater = require('./updater.cjs');

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
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
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

// ---- window size and position -------------------------------------------

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    // Only reuse the position if it is still on a connected screen.
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return st.x < a.x + a.width - 50 && st.x + st.width > a.x + 50 && st.y < a.y + a.height - 50 && st.y + st.height > a.y;
    });
    if (!visible) return { width: st.width, height: st.height, maximized: st.maximized };
    return st;
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  try {
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(windowStateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {}
}

// ---- autosave / recovery ---------------------------------------------------

function recoveryFile() {
  return path.join(app.getPath('userData'), 'recovery.shaperbuild');
}

ipcMain.handle('recovery:write', async (_e, data, meta) => {
  await fs.promises.mkdir(path.dirname(recoveryFile()), { recursive: true });
  await fs.promises.writeFile(recoveryFile(), Buffer.from(data));
  await fs.promises.writeFile(`${recoveryFile()}.json`, JSON.stringify({ ...meta, saved: Date.now() }));
  return true;
});

ipcMain.handle('recovery:read', async () => {
  try {
    const data = await fs.promises.readFile(recoveryFile());
    const meta = JSON.parse(await fs.promises.readFile(`${recoveryFile()}.json`, 'utf8'));
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), meta };
  } catch {
    return null;
  }
});

ipcMain.handle('recovery:clear', async () => {
  for (const f of [recoveryFile(), `${recoveryFile()}.json`]) await fs.promises.rm(f, { force: true });
  return true;
});

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
  const state = loadWindowState();
  win = new BrowserWindow({
    width: state?.width || 1440,
    height: state?.height || 900,
    ...(state && state.x !== undefined ? { x: state.x, y: state.y } : {}),
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
  win.once('ready-to-show', () => {
    if (state?.maximized) win.maximize();
    win.show();
  });
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.loadURL(`${SCHEME}://${HOST}/src/index.html`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) e.preventDefault();
  });

  win.on('close', (e) => {
    saveWindowState();
    if (!dirty || closeConfirmed) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [i18n.t('Save'), i18n.t("Don't Save"), i18n.t('Cancel')],
      defaultId: 0,
      cancelId: 2,
      message: i18n.t('Do you want to save the changes to your design?'),
      detail: i18n.t("Your changes will be lost if you don't save them."),
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
    // A normal close (saved or deliberately discarded) needs no recovery copy;
    // only crashes leave one behind.
    for (const f of [recoveryFile(), `${recoveryFile()}.json`]) fs.rmSync(f, { force: true });
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

// Built when used, in the current language.
const filters = () => ({
  project: [{ name: i18n.t('ShaperBuild design'), extensions: [PROJECT_EXT] }],
  open: [
    { name: i18n.t('All supported'), extensions: [PROJECT_EXT, 'stl', 'obj', 'step', 'stp', '3mf', 'dxf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
    { name: i18n.t('ShaperBuild design'), extensions: [PROJECT_EXT] },
    { name: i18n.t('Mesh (STL, OBJ, 3MF)'), extensions: ['stl', 'obj', '3mf'] },
    { name: i18n.t('STEP'), extensions: ['step', 'stp'] },
    { name: i18n.t('DXF drawing'), extensions: ['dxf'] },
    { name: i18n.t('Image to trace'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  ],
  import: [
    { name: i18n.t('All supported'), extensions: ['stl', 'obj', 'step', 'stp', '3mf', 'dxf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
    { name: i18n.t('STL'), extensions: ['stl'] },
    { name: i18n.t('OBJ'), extensions: ['obj'] },
    { name: i18n.t('STEP'), extensions: ['step', 'stp'] },
    { name: i18n.t('3MF'), extensions: ['3mf'] },
    { name: i18n.t('DXF drawing (becomes a sketch)'), extensions: ['dxf'] },
    { name: i18n.t('Image to trace (PNG, JPG)'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
  ],
  dxf: [{ name: i18n.t('DXF drawing'), extensions: ['dxf'] }],
  pdf: [{ name: i18n.t('PDF document'), extensions: ['pdf'] }],
  svg: [{ name: i18n.t('SVG image'), extensions: ['svg'] }],
  stl: [{ name: i18n.t('STL'), extensions: ['stl'] }],
  font: [{ name: i18n.t('Fonts'), extensions: ['ttf', 'otf', 'woff'] }],
  obj: [{ name: i18n.t('OBJ'), extensions: ['obj'] }],
  step: [{ name: i18n.t('STEP'), extensions: ['step', 'stp'] }],
  '3mf': [{ name: i18n.t('3MF'), extensions: ['3mf'] }],
  glb: [{ name: i18n.t('glTF binary (GLB)'), extensions: ['glb'] }],
  usdz: [{ name: i18n.t('USDZ (AR on iPhone and iPad)'), extensions: ['usdz'] }],
  png: [{ name: i18n.t('PNG image'), extensions: ['png'] }],
});

// ---- the designs folder ------------------------------------------------------
// Designs and exports go to Documents/ShaperBuild unless the person picks
// another folder (Settings). Dialogs open in the folder used last.
function foldersFile() {
  return path.join(app.getPath('userData'), 'folders.json');
}
function readFolders() {
  try {
    return JSON.parse(fs.readFileSync(foldersFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function writeFolders(patch) {
  const next = { ...readFolders(), ...patch };
  try {
    fs.mkdirSync(path.dirname(foldersFile()), { recursive: true });
    fs.writeFileSync(foldersFile(), JSON.stringify(next));
  } catch {}
  return next;
}
function designsFolder() {
  const chosen = readFolders().designs;
  const dir = chosen && fs.existsSync(chosen) ? chosen : path.join(app.getPath('documents'), 'ShaperBuild');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}
function startFolder() {
  const last = readFolders().last;
  return last && fs.existsSync(last) ? last : designsFolder();
}

ipcMain.handle('dialog:open', async (_e, { kind = 'open', multi = false } = {}) => {
  const res = await dialog.showOpenDialog(win, {
    defaultPath: startFolder(),
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: filters()[kind] || filters().open,
  });
  if (res.canceled) return [];
  writeFolders({ last: path.dirname(res.filePaths[0]) });
  return res.filePaths;
});

ipcMain.handle('dialog:save', async (_e, { kind = 'project', defaultName = 'Untitled' } = {}) => {
  const list = filters()[kind] || filters().project;
  const ext = list[0].extensions[0];
  const res = await dialog.showSaveDialog(win, {
    defaultPath: path.join(startFolder(), `${defaultName}.${ext}`),
    filters: list,
  });
  if (res.canceled) return null;
  writeFolders({ last: path.dirname(res.filePath) });
  return res.filePath;
});

ipcMain.handle('folders:get', () => ({ designs: designsFolder() }));
ipcMain.handle('folders:choose', async () => {
  const res = await dialog.showOpenDialog(win, { defaultPath: designsFolder(), properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  writeFolders({ designs: res.filePaths[0], last: res.filePaths[0] });
  return res.filePaths[0];
});
ipcMain.on('folders:show', () => shell.openPath(designsFolder()));

ipcMain.handle('fs:read', async (_e, file) => {
  const data = await fs.promises.readFile(file);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
});

ipcMain.handle('fs:write', async (_e, file, data) => {
  await fs.promises.writeFile(file, Buffer.from(data));
  return true;
});

updater.init({ ipcMain, send: (s) => win?.webContents.send('update-state', s) });

// 3D printing: write the file to a temporary folder and open it in a slicer
// (or whatever app the system uses for that file type).
ipcMain.handle('slicers:list', () => listSlicers());
ipcMain.handle('print:open', async (_e, { name, ext, data, slicer } = {}) => {
  const dir = path.join(app.getPath('temp'), 'ShaperBuild');
  await fs.promises.mkdir(dir, { recursive: true });
  const safe = String(name || 'Print').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(0, 80) || 'Print';
  const file = path.join(dir, `${safe}.${ext === 'stl' ? 'stl' : '3mf'}`);
  await fs.promises.writeFile(file, Buffer.from(data));
  if (slicer && slicer !== 'default' && openInSlicer(slicer, file)) return { ok: true, file };
  const error = await shell.openPath(file);
  return { ok: !error, file, error: error || null };
});

// 2D drawings: print an SVG sheet to PDF in a hidden window (no scripts).
ipcMain.handle('drawing:pdf', async (_e, { svg, width, height } = {}) => {
  if (typeof svg !== 'string' || !svg.startsWith('<svg')) throw new Error('not a drawing');
  const w = Number(width) || 297;
  const h = Number(height) || 210;
  const page = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${w}mm;height:${h}mm}</style></head><body>${svg}</body></html>`;
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await page.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  } finally {
    page.destroy();
  }
});

// ---- versions and design files ---------------------------------------------
// Saving keeps the file it replaces, so older versions can be restored.
const MAX_VERSIONS = 30;
function versionsDir(file) {
  const id = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'versions', id);
}
async function keepVersion(file) {
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return false; // nothing saved there yet
  }
  const dir = versionsDir(file);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.copyFile(file, path.join(dir, `${Math.round(st.mtimeMs)}.${PROJECT_EXT}`));
  const list = (await fs.promises.readdir(dir)).filter((f) => f.endsWith(`.${PROJECT_EXT}`)).sort();
  for (const f of list.slice(0, Math.max(0, list.length - MAX_VERSIONS))) await fs.promises.unlink(path.join(dir, f)).catch(() => {});
  return true;
}
const versionName = (id) => (/^\d+\.shaperbuild$/.test(String(id)) ? id : null);
ipcMain.handle('versions:keep', (_e, file) => keepVersion(file));
ipcMain.handle('versions:list', async (_e, file) => {
  const dir = versionsDir(file);
  try {
    const names = (await fs.promises.readdir(dir)).filter(versionName);
    const out = [];
    for (const id of names) {
      const st = await fs.promises.stat(path.join(dir, id));
      out.push({ id, time: Number(id.split('.')[0]), size: st.size });
    }
    return out.sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
});
ipcMain.handle('versions:read', async (_e, file, id) => {
  if (!versionName(id)) throw new Error('No such version');
  const data = await fs.promises.readFile(path.join(versionsDir(file), id));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
});
// Rename, duplicate or bin a design file from the home screen.
const designFile = (p) => typeof p === 'string' && p.toLowerCase().endsWith(`.${PROJECT_EXT}`);
const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').trim().slice(0, 120);
function replaceRecent(from, to) {
  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
  } catch {}
  // The old path may be gone already (renamed), so start from the stored list.
  const list = (Array.isArray(raw) ? raw : [])
    .map((x) => (x === from ? to : x))
    .filter((x, i, all) => x && all.indexOf(x) === i);
  try {
    fs.writeFileSync(recentFile(), JSON.stringify(list.filter(Boolean)));
  } catch {}
  refreshMenu();
}
ipcMain.handle('file:rename', async (_e, file, name) => {
  if (!designFile(file) || !safeName(name)) throw new Error('That name cannot be used');
  const to = path.join(path.dirname(file), `${safeName(name)}.${PROJECT_EXT}`);
  if (to === file) return file;
  if (fs.existsSync(to)) throw new Error('A design with that name is already there');
  await fs.promises.rename(file, to);
  // Versions follow the file.
  await fs.promises.rename(versionsDir(file), versionsDir(to)).catch(() => {});
  replaceRecent(file, to);
  return to;
});
ipcMain.handle('file:duplicate', async (_e, file) => {
  if (!designFile(file)) throw new Error('Only designs can be duplicated');
  const stem = path.basename(file, `.${PROJECT_EXT}`);
  let to;
  for (let i = 1; i < 100; i++) {
    to = path.join(path.dirname(file), `${stem} ${i === 1 ? i18n.t('copy') : `${i18n.t('copy')} ${i}`}.${PROJECT_EXT}`);
    if (!fs.existsSync(to)) break;
  }
  await fs.promises.copyFile(file, to, fs.constants.COPYFILE_EXCL);
  addRecent(to);
  return to;
});
ipcMain.handle('file:trash', async (_e, file) => {
  if (!designFile(file)) throw new Error('Only designs can be moved to the bin');
  await shell.trashItem(file);
  replaceRecent(file, null);
  return true;
});
ipcMain.handle('recent:remove', (_e, file) => {
  replaceRecent(file, null);
  return readRecent();
});

ipcMain.handle('recent:get', () => readRecent());
// When each file was last changed (null: the file is gone).
ipcMain.handle('files:times', async (_e, files) => {
  const out = {};
  for (const f of Array.isArray(files) ? files : []) {
    try {
      out[f] = (await fs.promises.stat(f)).mtimeMs;
    } catch {
      out[f] = null;
    }
  }
  return out;
});
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
  // Automated tests start without the first-run tutorial.
  noTutorial: process.env.SHAPER_NO_TUTORIAL === '1',
  language: i18n.language(),
}));

ipcMain.on('app:ready', () => {
  rendererReady = true;
  const files = pendingOpen;
  pendingOpen = [];
  for (const f of files) win.webContents.send('open-path', f);
});
// The renderer's language (menus and dialogs follow it).
ipcMain.on('app:language', (_e, value) => {
  if (i18n.setLanguage(value)) refreshMenu();
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
  i18n.init(app.getPath('userData'));
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
