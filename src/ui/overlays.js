// Toasts, tooltips, context menus and modal dialogs.
import { h, clear } from './dom.js';
import { icon } from './icons.js';

// ---- toasts ----------------------------------------------------------------
export function toast(message, { type = 'info', ms = 2600 } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h(`div.toast${type !== 'info' ? '.' + type : ''}`, { text: message });
  root.append(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

// ---- tooltips --------------------------------------------------------------
let tipEl = null;
let tipTimer = 0;
export function attachTooltip(el, content) {
  el.addEventListener('mouseenter', () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      hideTooltip();
      const c = typeof content === 'function' ? content() : content;
      tipEl = h('div.tooltip', { html: c });
      document.body.append(tipEl);
      const r = el.getBoundingClientRect();
      const t = tipEl.getBoundingClientRect();
      let left = r.left - t.width - 10;
      if (left < 8) left = r.right + 10;
      let top = r.top + r.height / 2 - t.height / 2;
      if (r.right + t.width + 10 < window.innerWidth && left === r.right + 10) left = r.right + 10;
      if (el.dataset.tipBelow) {
        left = r.left + r.width / 2 - t.width / 2;
        top = r.bottom + 8;
      }
      tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - t.width - 8, left))}px`;
      tipEl.style.top = `${Math.max(8, Math.min(window.innerHeight - t.height - 8, top))}px`;
    }, 450);
  });
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown', hideTooltip);
}

export function hideTooltip() {
  clearTimeout(tipTimer);
  if (tipEl) tipEl.remove();
  tipEl = null;
}

// ---- context menus ---------------------------------------------------------
let openMenu = null;
export function closeMenu() {
  if (openMenu) openMenu.remove();
  openMenu = null;
}

// items: [{ label, icon?, kbd?, action, danger? } | '-' | { custom: Element }]
export function showMenu(x, y, items) {
  closeMenu();
  const menu = h('div.menu');
  for (const it of items) {
    if (it === '-') {
      menu.append(h('hr'));
      continue;
    }
    if (it.custom) {
      menu.append(it.custom);
      continue;
    }
    const b = h('button', { html: `${it.icon ? icon(it.icon) : ''}<span>${it.label}</span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}` });
    if (it.danger) b.style.color = 'var(--danger)';
    b.addEventListener('click', () => {
      closeMenu();
      it.action();
    });
    menu.append(b);
  }
  document.getElementById('menu-root').append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
  openMenu = menu;
  setTimeout(() => {
    const away = (e) => {
      if (openMenu && !openMenu.contains(e.target)) {
        closeMenu();
        document.removeEventListener('pointerdown', away, true);
      }
    };
    document.addEventListener('pointerdown', away, true);
  });
  return menu;
}

// ---- modals ------------------------------------------------------------------
// bind(close) receives a function that closes the dialog with a value.
export function modal({ title, body, buttons = [{ label: 'Close', primary: true }], width, onClose, bind, className }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const foot = h('div.modal-foot');
    const close = (value) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      onClose?.(value);
      resolve(value);
    };
    for (const b of buttons) {
      const btn = h(`button.btn${b.primary ? '.primary' : ''}${b.danger ? '.danger' : ''}`, { text: b.label });
      btn.addEventListener('click', () => close(b.value ?? b.label));
      foot.append(btn);
    }
    const m = h('div.modal', h('div.modal-head', { text: title }), h('div.modal-body', body), foot);
    if (className) m.classList.add(className);
    if (!buttons.length) foot.hidden = true;
    if (width) m.style.width = `min(${width}px, calc(100vw - 40px))`;
    bind?.(close);
    const backdrop = h('div.modal-backdrop', m);
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) close(null);
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
        const primary = buttons.find((b) => b.primary);
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          close(primary.value ?? primary.label);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    root.append(backdrop);
    setTimeout(() => m.querySelector('input, select')?.focus(), 30);
  });
}

export async function confirmDialog(title, message, { ok = 'OK', danger = false } = {}) {
  const v = await modal({
    title,
    body: h('div', { text: message }),
    buttons: [
      { label: 'Cancel', value: false },
      { label: ok, value: true, primary: true, danger },
    ],
  });
  return v === true;
}

export { clear };
