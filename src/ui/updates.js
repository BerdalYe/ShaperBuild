// Update notices: background checks, download progress and "restart to
// update". The work happens in the main process (electron/updater.cjs).
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { toast, modal } from './overlays.js';
import { t } from '../core/i18n.js';

const EVERY = 4 * 3600 * 1000;

export class Updates {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('update-pill');
    this.state = null;
    this.el.addEventListener('click', () => this.onClick());
    window.native?.onUpdateState?.((s) => {
      this.state = s;
      this.render();
    });
  }

  get available() {
    return !!window.native?.updateCheck;
  }

  // Background checks shortly after start and every few hours.
  start() {
    if (!this.available || this.app.settings.autoUpdate === false) return;
    clearTimeout(this.first);
    clearInterval(this.timer);
    this.first = setTimeout(() => this.check(false), 8000);
    this.timer = setInterval(() => this.check(false), EVERY);
  }

  stop() {
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  async check(manual = true) {
    if (!this.available) {
      if (manual) toast('Updates are only available in the installed app.', { ms: 3000 });
      return null;
    }
    if (manual) toast('Checking for updates…', { ms: 1500 });
    const s = await window.native.updateCheck().catch((err) => ({ status: 'error', message: err.message }));
    this.state = s;
    this.render();
    if (!manual) return s;
    if (s.status === 'disabled') toast('Updates are checked in the installed app, not when running from source.', { ms: 3500 });
    else if (s.status === 'latest') toast(t('You have the newest version ({version}).', { version: s.current }), { type: 'ok' });
    else if (s.status === 'error') toast(t('Could not check for updates: {error}', { error: t(s.message) }), { type: 'error', ms: 5000 });
    else if (s.status === 'available') toast(t('Version {version} is available. Click “Download” at the top to get it.', { version: s.version }), { ms: 4000 });
    else if (s.status === 'downloading') toast(t('Downloading version {version}…', { version: s.version }), { ms: 2500 });
    else if (s.status === 'ready') toast(t('Version {version} is ready. Click “Restart to update” at the top.', { version: s.version }), { ms: 4000 });
    return s;
  }

  render() {
    const s = this.state;
    const el = this.el;
    clear(el);
    el.className = 'update-pill';
    if (!s || !['downloading', 'ready', 'available'].includes(s.status)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (s.status === 'downloading') {
      el.classList.add('busy');
      el.title = t('Downloading ShaperBuild {version}', { version: s.version });
      el.append(h('span.spinner'), h('span', { str: t('Updating to {version}', { version: s.version }) + (s.percent ? ` · ${s.percent}%` : '…') }));
    } else if (s.status === 'ready') {
      el.classList.add('ready');
      el.title = t('ShaperBuild {version} is downloaded. Restart to start using it.', { version: s.version });
      el.append(h('span', { html: icon('sparkle') }), h('span', { text: 'Restart to update' }));
    } else {
      el.classList.add('ready');
      el.title = t('ShaperBuild {version} is available', { version: s.version });
      el.append(h('span', { html: icon('import') }), h('span', { str: t('Download {version}', { version: s.version }) }));
    }
  }

  async onClick() {
    const s = this.state;
    if (!s) return;
    if (s.status === 'available') return window.native.updateOpenPage();
    if (s.status !== 'ready') return;
    const dirty = this.app.doc.dirty;
    const v = await modal({
      title: t('Update to ShaperBuild {version}', { version: s.version }),
      body: h('div', {
        html: `${t('ShaperBuild will close, install the update and open again.')}${dirty ? `<br><br>${t('You will be asked to save your design first.')}` : ''}<br><br><small style="color:var(--muted)">${t('If you choose Later, the update installs the next time you quit.')}</small>`,
      }),
      buttons: [
        { label: 'Later', value: false },
        { label: 'Restart now', value: true, primary: true },
      ],
    });
    if (v) await window.native.updateInstall();
  }
}
