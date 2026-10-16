// Languages. Text in the code is English; t() looks it up in the chosen
// language's dictionary when it is shown. Data (history step names, undo
// labels…) stays in English so a design looks right in any language.
//
//   t('Extrude')                       -> 'Ekstruder'
//   t('{n} bodies', { n: 3 })          -> '3 legemer'
//   t('Fillet failed (radius too large)') -> patterns below
import { NB, NB_PATTERNS } from '../i18n/nb.js';

export const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'nb', name: 'Norsk (bokmål)' },
];

const DICTS = { nb: NB };
const PATTERNS = { nb: NB_PATTERNS };
const SETTINGS_KEY = 'shaperbuild.settings.v1';

// The language is read when the app starts (changing it restarts the window).
function initialLanguage() {
  try {
    const s = JSON.parse(globalThis.localStorage?.getItem(SETTINGS_KEY) || '{}');
    if (s.language && DICTS[s.language]) return s.language;
  } catch {}
  return 'en';
}

let lang = initialLanguage();

export function language() {
  return lang;
}

// For tests and the first start; the app restarts on a real change.
export function setLanguage(id) {
  lang = DICTS[id] || id === 'en' ? id : 'en';
  if (globalThis.document) document.documentElement.lang = lang === 'nb' ? 'nb' : 'en';
}

// The system language suggests a choice on the welcome screen.
export function suggestedLanguage() {
  const list = [...(globalThis.navigator?.languages || []), globalThis.navigator?.language || ''];
  return list.some((l) => /^(nb|no|nn)\b/i.test(l || '')) ? 'nb' : 'en';
}

function fill(s, vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Translate `text` (English) into the current language.
export function t(text, vars) {
  if (typeof text !== 'string' || !text) return text;
  if (lang === 'en') return fill(text, vars);
  const dict = DICTS[lang];
  let out = dict[text];
  if (out === undefined) {
    // Keep leading/trailing space and a trailing "…" or ":".
    const m = text.match(/^(\s*)(.*?)([…:.]?)(\s*)$/s);
    if (m && m[2] !== text && dict[m[2]] !== undefined) out = m[1] + dict[m[2]] + m[3] + m[4];
  }
  if (out === undefined && /^[A-Z]/.test(text)) {
    // History shows kernel errors with a capital first letter.
    const low = dict[text.charAt(0).toLowerCase() + text.slice(1)];
    if (low !== undefined) out = low.charAt(0).toUpperCase() + low.slice(1);
  }
  if (out === undefined) out = pattern(text);
  if (out === undefined && globalThis.__i18nMissing && /[a-z]{2}/.test(text) && !text.includes('<svg')) globalThis.__i18nMissing.add(text); // tests collect these
  return fill(out ?? text, vars);
}

// Messages put together at run time (kernel errors, "Undo Extrude"…).
function pattern(text) {
  for (const [re, fn] of PATTERNS[lang] || []) {
    const m = text.match(re);
    if (m) return fn(m, t);
  }
  return undefined;
}

// "1 body" / "3 bodies": n chooses the form; {n} is filled in.
export function tn(n, one, many, vars) {
  return t(n === 1 ? one : many, { n, ...vars });
}

// Numbers: decimal comma in Norwegian.
export function localNumber(s) {
  return lang === 'nb' ? String(s).replace(/(\d)\.(\d)/g, '$1,$2') : String(s);
}

// Typed numbers: accept a decimal comma ("12,5") where it cannot be a
// separator between function arguments.
export function readNumberText(s) {
  const text = String(s ?? '');
  return text.includes('(') ? text : text.replace(/(\d),(\d)/g, '$1.$2');
}
