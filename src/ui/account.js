// Accounts: sign in, create an account, and the designs kept in the cloud.
// The work happens in the main process (electron/cloud.cjs); this is the
// window side: the sign-in dialog and the account menu.
import { h } from './dom.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog, showMenu } from './overlays.js';
import { t } from '../core/i18n.js';

export class Account {
  constructor(app) {
    this.app = app;
    this.api = window.native?.cloud || null;
    this.state = { configured: false, google: false, user: null };
    this.listeners = new Set();
  }

  get available() {
    return !!this.api;
  }

  get signedIn() {
    return !!this.state.user;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(state) {
    if (state && !state.error) this.state = { ...this.state, ...state };
    for (const fn of this.listeners) fn(this.state);
  }

  async refresh() {
    if (!this.api) return this.state;
    this.set(await this.api.state());
    return this.state;
  }

  // The sign-in / create-account dialog. Resolves true once signed in.
  async signInDialog({ mode = 'in', reason = '' } = {}) {
    if (!this.api) {
      toast('Accounts need the desktop app', { type: 'error' });
      return false;
    }
    await this.refresh();
    if (!this.state.configured) {
      await modal({
        title: 'Accounts',
        body: h('div', h('p', { text: 'Accounts are not set up in this copy of ShaperBuild yet.' }), h('p.muted', { text: 'Whoever builds the app connects it to a Supabase project (see docs/ACCOUNTS.md). Your designs still save on this computer as usual.' })),
      });
      return false;
    }
    let close;
    let signedIn = false;
    const email = h('input.text-input', { type: 'email', autocomplete: 'email', placeholder: t('Email'), 'aria-label': t('Email') });
    const password = h('input.text-input', { type: 'password', autocomplete: 'current-password', placeholder: t('Password'), 'aria-label': t('Password') });
    const code = h('input.text-input.acct-code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: t('Code from the email'), 'aria-label': t('Code from the email'), maxlength: 10 });
    const message = h('div.acct-msg', { role: 'status' });
    const submit = h('button.btn.primary.acct-submit', { type: 'submit' });
    const swap = h('button.link-btn', { type: 'button' });
    const forgot = h('button.link-btn', { type: 'button', text: 'Forgot your password?' });
    const title = h('div.acct-title');
    const show = (text, kind = 'error') => {
      message.textContent = t(text);
      message.className = `acct-msg ${kind}`;
    };
    // mode: 'in' (sign in), 'up' (create an account), 'reset' (code from
    // the email and a new password).
    const render = () => {
      title.textContent = t({ in: 'Sign in to ShaperBuild', up: 'Create your ShaperBuild account', reset: 'Choose a new password' }[mode]);
      submit.textContent = t({ in: 'Sign in', up: 'Create account', reset: 'Set new password' }[mode]);
      swap.textContent = t(mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in');
      password.autocomplete = mode === 'in' ? 'current-password' : 'new-password';
      password.placeholder = t(mode === 'in' ? 'Password' : 'New password');
      code.hidden = mode !== 'reset';
      forgot.hidden = mode !== 'in';
      message.textContent = '';
    };
    swap.addEventListener('click', () => {
      mode = mode === 'in' ? 'up' : 'in';
      render();
    });
    const busy = async (fn) => {
      for (const b of form.querySelectorAll('button')) b.disabled = true;
      try {
        return await fn();
      } finally {
        for (const b of form.querySelectorAll('button')) b.disabled = false;
      }
    };
    forgot.addEventListener('click', () =>
      busy(async () => {
        const res = await this.api.resetPassword(email.value);
        if (res.error) return show(res.error);
        mode = 'reset';
        render();
        password.value = '';
        show('If there is an account for this email, a code is on its way. Type it here with your new password.', 'ok');
        code.focus();
      }),
    );
    const form = h(
      'form.acct-form',
      title,
      reason ? h('p.acct-reason', { text: reason }) : null,
      email,
      code,
      password,
      message,
      submit,
      this.state.google ? h('div.acct-or', h('span', { text: 'or' })) : null,
      this.state.google ? this.googleButton(() => busy(() => this.google(show, () => ((signedIn = true), close(true))))) : null,
      h('div.acct-links', swap, forgot),
      h('p.acct-note', { text: 'Designs you save to the cloud are stored with your account so you can open them on any computer. Only you can see them.' }),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      busy(async () => {
        const res =
          mode === 'in' ? await this.api.signIn(email.value, password.value) : mode === 'up' ? await this.api.signUp(email.value, password.value) : await this.api.confirmReset(email.value, code.value, password.value);
        if (res.error) return show(res.error);
        this.set(res);
        if (res.confirm) return show('Almost done: open the link in the email we sent you, then sign in here.', 'ok');
        signedIn = true;
        toast(t('Signed in as {email}', { email: res.user.email }), { type: 'ok', ms: 2500 });
        close(true);
      });
    });
    render();
    await modal({ title: 'Account', body: form, buttons: [], width: 400, className: 'acct-modal', bind: (c) => (close = c) });
    return signedIn;
  }

  googleButton(onClick) {
    const b = h('button.btn.acct-google', { type: 'button', html: `${GOOGLE_G}<span>${t('Continue with Google')}</span>` });
    b.addEventListener('click', onClick);
    return b;
  }

  async google(show, done) {
    show('Finish signing in in your browser…', 'ok');
    const res = await this.api.google();
    if (res.error) return show(res.error);
    this.set(res);
    toast(t('Signed in as {email}', { email: res.user.email }), { type: 'ok', ms: 2500 });
    done();
  }

  async signOut() {
    this.set(await this.api.signOut());
    this.app.files.cloud = null;
    toast('Signed out', { ms: 1800 });
  }

  async deleteAccount() {
    const ok = await confirmDialog('Delete your account?', t('This deletes your account ({email}) and every design in your cloud. Designs saved on this computer stay. This cannot be undone.', { email: this.state.user?.email || '' }), { ok: 'Delete account', danger: true });
    if (!ok) return;
    const res = await this.api.deleteAccount();
    if (res.error) return toast(t('Could not delete the account: {error}', { error: res.error }), { type: 'error', ms: 6000 });
    this.set(res);
    this.app.files.cloud = null;
    toast('Your account and cloud designs were deleted', { type: 'ok', ms: 4000 });
  }

  // The menu under the account button.
  menu(e) {
    const u = this.state.user;
    if (!u) return this.signInDialog();
    const r = e.currentTarget?.getBoundingClientRect?.();
    showMenu(r ? r.left : e.clientX, r ? r.top - 8 - 4 * 36 : e.clientY, [
      { custom: h('div.menu-head', { str: u.email }) },
      { label: 'Save to cloud', icon: 'cloud', action: () => this.app.files.saveToCloud() },
      { label: 'Sign out', icon: 'close', action: () => this.signOut() },
      '-',
      { label: 'Delete account…', icon: 'trash', danger: true, action: () => this.deleteAccount() },
    ]);
  }

  // The account button for the home screen's sidebar.
  button() {
    if (this.btn) return this.btn;
    const b = h('button.hs-btn.acct-btn');
    this.btn = b;
    const draw = () => {
      const u = this.state.user;
      b.innerHTML = `${icon(u ? 'user' : 'cloud')}<span></span>`;
      b.querySelector('span').textContent = u ? u.email : t('Sign in');
      b.title = t(u ? 'Your account' : 'Sign in to keep designs in the cloud');
      b.hidden = !this.available;
    };
    b.addEventListener('click', (e) => this.menu(e));
    draw();
    this.on(draw);
    return b;
  }
}

const GOOGLE_G =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4A7.2 7.2 0 0 1 5 12c0-.8.1-1.6.4-2.4V6.5h-4A12 12 0 0 0 0 12c0 1.9.5 3.8 1.4 5.5l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
