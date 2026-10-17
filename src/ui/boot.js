// The startup screen: shows how far loading has come and fades out when the
// app is ready to use.
import { t } from '../core/i18n.js';
import { translateStatic } from './dom.js';

export class BootScreen {
  constructor(kernel) {
    this.el = document.getElementById('boot');
    this.fill = document.getElementById('boot-fill');
    this.status = document.getElementById('boot-status');
    this.loaded = new Set();
    translateStatic(this.el);
    this.set(12);
    kernel.on('stage', (stage) => {
      this.loaded.add(stage);
      // The CAD engine is the big one; the mesh engine loads in a moment.
      this.set(this.loaded.has('cad') ? 82 : 30);
      if (!this.loaded.has('cad')) this.status.textContent = t('Starting the geometry engine…');
    });
    window.native
      ?.info()
      .then((info) => {
        if (info?.version) document.getElementById('boot-foot').textContent = t('Version {v} · free and open source', { v: info.version });
      })
      .catch(() => {});
  }

  set(percent, text) {
    this.fill.style.width = `${percent}%`;
    if (text) this.status.textContent = t(text);
  }

  fail(message) {
    this.el.classList.add('failed');
    this.set(100);
    this.status.textContent = `${t('The geometry engine failed to start.')}\n${t(message)}`;
  }

  hide() {
    this.set(100);
    this.el.classList.add('done');
    setTimeout(() => (this.el.hidden = true), 380);
  }
}
