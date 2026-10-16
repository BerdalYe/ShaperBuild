// First start: choose the language (shown in both languages), and the
// restart that applies a new language later from Settings.
import { h } from './dom.js';
import { modal } from './overlays.js';
import { LANGUAGES, language, suggestedLanguage, t } from '../core/i18n.js';

export class Welcome {
  constructor(app) {
    this.app = app;
  }

  // Resolves with the chosen language id. The window reloads when it is
  // not the language the app started in.
  async chooseLanguage() {
    const suggested = suggestedLanguage();
    const order = [...LANGUAGES].sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0));
    let choice = null;
    await modal({
      title: 'Velkommen til ShaperBuild · Welcome to ShaperBuild',
      className: 'welcome-modal',
      width: 520,
      buttons: [],
      body: h(
        'div.welcome-lang',
        h('p', { str: 'Velg språk · Choose your language' }),
        h(
          'div.wl-choices',
          ...order.map((l) => {
            const b = h(`button.wl-choice${l.id === suggested ? '.primary' : ''}`, h('b', { str: l.name }), h('span', { str: l.id === 'nb' ? 'Menyer, verktøy og hjelp på norsk' : 'Menus, tools and help in English' }));
            b.dataset.lang = l.id;
            b.addEventListener('click', () => {
              choice = l.id;
              this.close?.(l.id);
            });
            return b;
          }),
        ),
        h('p.wl-small', { str: 'Du kan bytte senere i Innstillinger · You can change it later in Settings' }),
      ),
      bind: (close) => (this.close = close),
    });
    const id = choice || suggested;
    this.app.setLanguageSetting(id);
    if (id !== language()) location.reload();
    return id;
  }

  // Settings: the new language applies after a restart; the open design
  // comes back as it was.
  async restartPrompt() {
    const v = await modal({
      title: t('Change the language'),
      body: h('div', { text: 'ShaperBuild restarts to change the language. Your design stays open.' }),
      buttons: [
        { label: 'Later', value: false },
        { label: 'Restart now', value: true, primary: true },
      ],
    });
    if (v) await this.app.restartWindow();
  }
}
