// Small DOM helpers.
import { icon } from './icons.js';
import { t } from '../core/i18n.js';

// Shown text is translated (see core/i18n.js); `str` sets text as it is
// (names the user typed, file names).
const TRANSLATED = new Set(['title', 'placeholder', 'aria-label']);

// h('div.cls#id', { attrs / on* handlers }, children...)
export function h(sel, props = {}, ...children) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = t(v);
    else if (k === 'text') el.textContent = t(v);
    else if (k === 'str') el.textContent = v;
    else if (k === 'icon') el.insertAdjacentHTML('afterbegin', icon(v));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : TRANSLATED.has(k) ? t(v) : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function isTyping() {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

export const isMac = () => /mac/i.test(window.native?.platform || navigator.platform || '');

// Modifier key label for shortcuts: "⌘" on macOS, "Ctrl+" elsewhere.
export const modKey = () => (isMac() ? '⌘' : 'Ctrl+');

// Translate the text and tooltips of static markup (index.html).
export function translateStatic(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const s = n.nodeValue;
    const text = s.trim();
    if (text) n.nodeValue = s.replace(text, t(text));
  }
  for (const el of root.querySelectorAll('[title]')) el.title = t(el.title);
}
