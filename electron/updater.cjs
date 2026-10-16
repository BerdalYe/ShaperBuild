// Automatic updates from the GitHub releases of this app.
// Windows and Linux (AppImage / deb) download the update in the background
// and install it on restart. macOS builds are not code-signed, which macOS
// requires for self-updating, so there the app points to the download page.
const { app, net, shell } = require('electron');
const { isNewer } = require('./version.cjs');

const OWNER = 'BerdalYe';
const REPO = 'ShaperBuild';
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases/latest`;

let state = { status: 'idle', current: app.getVersion() };
let notify = () => {};
let updater = null;
let checking = null;

function setState(patch) {
  state = { current: app.getVersion(), ...patch };
  notify(state);
}

function enabled() {
  return app.isPackaged && process.env.SHAPER_NO_UPDATE !== '1';
}

// Can this install update itself? (Not on macOS without code signing, and
// not for unpacked builds.)
function canSelfUpdate() {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !!process.env.APPIMAGE || require('node:fs').existsSync(require('node:path').join(process.resourcesPath, 'package-type'));
  return false;
}

function getUpdater() {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
  autoUpdater.on('update-not-available', () => setState({ status: 'latest' }));
  autoUpdater.on('update-available', (info) => setState({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', version: state.version, percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => setState({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => setState({ status: 'error', message: String(err?.message || err).split('\n')[0] }));
  updater = autoUpdater;
  return updater;
}

// Ask GitHub for the newest release (used where the app cannot self-update).
async function checkGitHub() {
  setState({ status: 'checking' });
  const res = await net.fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ShaperBuild' },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  if (latest && isNewer(latest, app.getVersion())) setState({ status: 'available', version: latest, url: rel.html_url || RELEASES });
  else setState({ status: 'latest' });
}

async function check() {
  if (!enabled()) {
    setState({ status: 'disabled' });
    return state;
  }
  if (state.status === 'downloading' || state.status === 'ready') return state;
  if (checking) return checking;
  checking = (async () => {
    try {
      if (canSelfUpdate()) await getUpdater().checkForUpdates();
      else await checkGitHub();
    } catch (err) {
      setState({ status: 'error', message: String(err?.message || err).split('\n')[0] });
    } finally {
      checking = null;
    }
    return state;
  })();
  return checking;
}

function install() {
  if (state.status === 'ready' && updater) {
    // Closes the window (asking about unsaved work) and runs the installer.
    setImmediate(() => updater.quitAndInstall(false, true));
    return true;
  }
  return false;
}

function openDownloadPage() {
  shell.openExternal(state.url || RELEASES);
}

function init({ ipcMain, send }) {
  notify = send;
  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:install', () => install());
  ipcMain.on('update:open-page', () => openDownloadPage());
}

module.exports = { init, check };
