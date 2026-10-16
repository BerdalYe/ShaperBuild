// Lists the English text the app shows (for translators and the
// completeness test): string literals in places that reach the screen.
//   node tools/i18n-extract.mjs            -> keys missing from nb
//   node tools/i18n-extract.mjs --all      -> every key
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Source files whose strings reach the screen.
export function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['vendor', 'i18n', 'fonts', 'styles'].includes(e.name)) walk(rel);
      } else if (/\.js$/.test(e.name)) out.push(rel);
    }
  };
  walk('src');
  return out;
}

const PROP = /\b(text|title|label|html|placeholder|desc|hint|short|reject|subtitle|okLabel|tip|failMessage|sub)\s*:\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g;
const CALL = /\b(t|toast|confirmDialog|setError|busy\(true,|hint|Error|apply|applyResult|guard|label|row|check|action)\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g;
const TN = /\btn\([^,]+,\s*(['"`])((?:\\.|(?!\1)[^\\])*?)\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*?)\3/g;
const CONFIRM2 = /\bconfirmDialog\(\s*(['"`])(?:(?:\\.|(?!\1)[^\\])*?)\1\s*,\s*(['"`])((?:\\.|(?!\2)[^\\])*?)\2/g;
const RETURN_IN_HINT = /hint\(\)\s*\{\s*return\s+(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;
// [value, 'Label'] pairs in option lists.
const PAIR = /\[\s*'[\w-]+'\s*,\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1\s*\]/g;
const KEYWORDS = /\bkeywords\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g;
// Capitalised values in object maps ({ end: 'Endpoint' }).
const MAPVAL = /\b\w+\s*:\s*'([A-Z][^'\n]*)'/g;
// Calls that take labels by position: every string on the line.
const POSITIONAL = /\b(?:def|add|action|view|check|warn|ok|bad)\(([^\n]*)/g;
const ANYSTR = /(['"])((?:\\.|(?!\1)[^\\\n])*?)\1/g;

// Any other quoted text that reads like a sentence or a capitalised label.
const QUOTED = /(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
const SKIP_LINE = /def\('[a-z0-9 ]+', -?\d|console\.(log|warn|error|debug)|^\s*import |require\(|querySelector|classList|addEventListener|getElementById|dataset|localStorage|postMessage|kernel\.call\(/;
const CODE_LIKE = /var\(--|px\b|gradient\(|rgba?\(|^\w+\(|=>|^[a-z]+:|^[\w-]+ [\w-]+:|\.(png|svg|stl|step|3mf|ttf)\b|^[A-Z][a-z]+[A-Z]\w*$|;$|^M[\d.-]|^(Ctrl|Shift|Alt)\+[\w+]+$/;
// Text that stays as it is in every language.
const KEEP = new Set(['English', 'Norsk (bokmål)', 'Menyer, verktøy og hjelp på norsk', 'Menus, tools and help in English', 'num-input dim-edit', 'Ctrl+', 'opacity .25s', 'Alt', 'Shift', 'Control', 'Meta', 'AltGraph', 'Up', 'Down', 'Not plain']);

const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');

// Text worth translating: has letters, is not code-like.
export function translatable(s) {
  if (!s || s.includes('${')) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (/^[a-z][\w-]*$/.test(s) && !/^(mesh|body|face|edge|curve|sketch|region|plane|image|point|vertex)$/.test(s)) return false; // ids
  if (/^[\w.-]+\.(js|css|html|json|wasm|png|svg)$/.test(s)) return false;
  if (/^(div|span|button|input|label|select|option|kbd|b|small|h\d|p|a|textarea)([.#][\w-]+)*$/.test(s)) return false;
  if (/^[A-Z0-9 +./×–-]+$/.test(s) && !/[A-Z]{2,}[a-z]/.test(s) && s.length <= 6) return false; // STL, 3MF, Ctrl+K…
  return true;
}

export function extract() {
  const keys = new Map(); // key -> first place
  const add = (s, where) => {
    s = unescape(s);
    if (translatable(s) && !keys.has(s)) keys.set(s, where);
  };
  for (const f of sourceFiles()) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const re of [PROP, CALL, RETURN_IN_HINT, PAIR, KEYWORDS]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const s = re === PROP || re === CALL ? m[3] : m[2];
        if (re === CALL && m[1] === 'apply' && /^[a-z]/.test(s)) continue;
        add(s, f);
      }
    }
    for (const re of [TN]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        add(m[2], f);
        add(m[4], f);
      }
    }
    CONFIRM2.lastIndex = 0;
    let m;
    while ((m = CONFIRM2.exec(src))) add(m[3], f);
    if (/^src\/(ui|tools|view)\/|^src\/(app|commands|fileops|history)\.js$/.test(f)) {
      MAPVAL.lastIndex = 0;
      while ((m = MAPVAL.exec(src))) add(m[1], f);
    }
    POSITIONAL.lastIndex = 0;
    while ((m = POSITIONAL.exec(src))) {
      if (/^'[a-z0-9 ]+', -?\d/.test(m[1])) continue; // function names in expr.js
      for (const sm of m[1].matchAll(ANYSTR)) if (/^[A-Z]/.test(sm[2]) || / /.test(sm[2])) add(sm[2], f);
    }
  }
  // Everything else that looks like text for people.
  for (const f of sourceFiles()) {
    fs.readFileSync(path.join(ROOT, f), 'utf8')
      .split('\n')
      .forEach((line) => {
        const code = line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, '');
        if (SKIP_LINE.test(code)) return;
        for (const m of code.matchAll(QUOTED)) {
          const s = m[2];
          if (KEEP.has(s) || CODE_LIKE.test(s)) continue;
          if (/^[A-Z][a-z]/.test(s) || /^(<b>)?[A-Za-z0-9][\w’'.]*(<\/b>)? .*[a-z]/.test(s)) add(s, f);
        }
      });
  }
  // Static markup.
  const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  for (const mm of html.matchAll(/title="([^"]+)"/g)) add(mm[1], 'src/index.html');
  for (const mm of html.matchAll(/>([^<>]+)</g)) {
    const s = mm[1].trim();
    if (s) add(s, 'src/index.html');
  }
  return keys;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { NB } = await import('../src/i18n/nb.js');
  const keys = extract();
  const all = process.argv.includes('--all');
  const list = [...keys].filter(([k]) => all || NB[k] === undefined);
  if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(list), null, 1));
  else for (const [k, f] of list) console.log(`${f}\t${JSON.stringify(k)}`);
  console.error(`${list.length} of ${keys.size}`);
}
