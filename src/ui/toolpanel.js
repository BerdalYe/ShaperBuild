// Floating panel that shows a tool's inputs and options.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { parseLength, parseAngle, parseNumber, formatLength, trimNumber, UNITS } from '../core/units.js';

export class ToolPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.spec = null;
    this.inputs = new Map();
  }

  get units() {
    return this.app.units;
  }

  show(spec) {
    this.spec = spec;
    this.values = {};
    for (const f of spec.fields || []) if ('key' in f && 'value' in f) this.values[f.key] = f.value;
    this.render();
    this.el.hidden = false;
  }

  hide() {
    this.spec = null;
    this.el.hidden = true;
    clear(this.el);
  }

  get visible() {
    return !!this.spec;
  }

  // Patch fields (by key) and re-render.
  update(patch = {}) {
    if (!this.spec) return;
    if (patch.fields) this.spec.fields = patch.fields;
    for (const k of ['hint', 'error', 'okEnabled', 'title']) if (k in patch) this.spec[k] = patch[k];
    if (patch.values) {
      Object.assign(this.values, patch.values);
      for (const f of this.spec.fields) if (f.key in patch.values) f.value = patch.values[f.key];
    }
    const focused = document.activeElement;
    const focusKey = focused && focused.dataset ? focused.dataset.key : null;
    const sel = focusKey ? [focused.selectionStart, focused.selectionEnd] : null;
    this.render();
    if (focusKey && this.inputs.get(focusKey)) {
      const inp = this.inputs.get(focusKey);
      inp.focus();
      try {
        inp.setSelectionRange(sel[0], sel[1]);
      } catch {}
    }
  }

  okEnabled() {
    const e = this.spec?.okEnabled;
    return typeof e === 'function' ? !!e() : e !== false;
  }

  // Update the Done button without re-rendering the panel.
  refreshOk() {
    const b = this.el.querySelector('[data-ok]');
    if (b) b.disabled = !this.okEnabled();
  }

  setValue(key, value) {
    this.values[key] = value;
    const f = this.spec?.fields.find((x) => x.key === key);
    if (f) f.value = value;
    const inp = this.inputs.get(key);
    if (inp && document.activeElement !== inp) inp.value = this.format(f, value);
  }

  format(f, v) {
    if (v === undefined || v === null || Number.isNaN(v)) return '';
    if (f.type === 'length') return formatLength(v, this.units, { suffix: false });
    if (f.type === 'angle') return trimNumber(v, 2);
    return String(v);
  }

  parse(f, text) {
    if (f.type === 'length') return parseLength(text, this.units);
    if (f.type === 'angle') return parseAngle(text);
    return parseNumber(text);
  }

  render() {
    const s = this.spec;
    clear(this.el);
    this.inputs.clear();
    const head = h('div.tp-head', { html: `${s.icon ? icon(s.icon) : ''}<span class="title">${s.title}</span>` });
    const closeBtn = h('button.tb-btn', { title: 'Cancel (Esc)', html: icon('close') });
    closeBtn.style.height = closeBtn.style.minWidth = '26px';
    closeBtn.addEventListener('click', () => s.onCancel?.());
    head.append(closeBtn);
    const body = h('div.tp-body');
    if (s.hint) body.append(h('div.tp-hint', { html: s.hint }));
    for (const f of s.fields || []) {
      if (f.hidden) continue;
      body.append(this.field(f));
    }
    if (s.error) body.append(h('div.tp-error', { text: s.error }));
    this.el.append(head, body);
    if (s.onOk || s.buttons) {
      const foot = h('div.tp-foot');
      for (const b of s.buttons || []) foot.append(h(`button.btn.grow${b.primary ? '.primary' : ''}`, { text: b.label, onClick: b.action }));
      if (s.onOk) {
        const cancel = h('button.btn.grow', { text: 'Cancel', onClick: () => s.onCancel?.() });
        const ok = h('button.btn.primary.grow', { html: `${icon('check')}<span>${s.okLabel || 'Done'}</span>`, onClick: () => s.onOk?.() });
        ok.querySelector('svg').style.width = '16px';
        ok.dataset.ok = '1';
        if (!this.okEnabled()) ok.disabled = true;
        foot.append(cancel, ok);
      }
      this.el.append(foot);
    }
  }

  field(f) {
    const s = this.spec;
    const change = (v) => {
      this.values[f.key] = v;
      f.value = v;
      s.onChange?.(f.key, v, this.values);
    };
    switch (f.type) {
      case 'slot': {
        const el = h(`div.slot${f.active ? '.active' : ''}${f.count ? '.filled' : ''}`, h('span.dot'), h('span', { text: f.count ? f.summary || `${f.count} selected` : f.placeholder || f.label }));
        if (f.count && f.onClear) {
          const x = h('button.clear', { title: 'Clear', html: '&times;' });
          x.addEventListener('click', (e) => {
            e.stopPropagation();
            f.onClear();
          });
          el.append(x);
        }
        el.addEventListener('click', () => f.onActivate?.());
        return h('div.tp-field', h('label', { text: f.label }), h('div.ctrl', el));
      }
      case 'length':
      case 'angle':
      case 'count':
      case 'number': {
        const inp = h('input.num-input', { type: 'text', spellcheck: false, value: this.format(f, f.value) });
        inp.dataset.key = f.key;
        this.inputs.set(f.key, inp);
        let timer = 0;
        const commit = (final) => {
          const v = this.parse(f, inp.value);
          const ok = Number.isFinite(v) && (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max) && (f.type !== 'count' || Number.isInteger(v));
          inp.classList.toggle('bad', !ok && inp.value.trim() !== '');
          if (ok && v !== f.value) change(v);
          if (final && ok) inp.value = this.format(f, v);
        };
        inp.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => commit(false), 160);
        });
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            clearTimeout(timer);
            commit(true);
            if (s.onOk && this.okEnabled()) setTimeout(() => s.onOk(), 0);
            e.preventDefault();
          } else if (e.key === 'Escape') {
            inp.blur();
            s.onCancel?.();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = this.parse(f, inp.value);
            if (!Number.isFinite(cur)) return;
            const step = (f.type === 'length' ? UNITS[this.units].factor : 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (f.step || 1);
            let v = cur + (e.key === 'ArrowUp' ? step : -step);
            if (f.min !== undefined) v = Math.max(f.min, v);
            if (f.max !== undefined) v = Math.min(f.max, v);
            inp.value = this.format(f, v);
            change(v);
          }
        });
        inp.addEventListener('blur', () => commit(true));
        inp.addEventListener('focus', () => inp.select());
        const unit = f.type === 'length' ? this.units : f.type === 'angle' ? '°' : '';
        const wrap = h('div.ctrl', { style: { position: 'relative' } }, inp);
        if (unit) wrap.append(h('span', { text: unit, style: { position: 'absolute', right: '8px', top: '5px', color: 'var(--muted)', fontSize: '12px', pointerEvents: 'none' } }));
        return h('div.tp-field', h('label', { text: f.label, title: f.hint }), wrap);
      }
      case 'choice': {
        const chips = h('div.chips');
        for (const o of f.options) {
          const b = h(`button.chip${o.value === f.value ? '.on' : ''}`, { html: `${o.icon ? icon(o.icon) : ''}${o.label}`, title: o.title || '' });
          const svg = b.querySelector('svg');
          if (svg) {
            svg.style.width = '14px';
            svg.style.height = '14px';
            svg.style.verticalAlign = '-2px';
            svg.style.marginRight = '4px';
          }
          b.addEventListener('click', () => {
            change(o.value);
            this.render();
          });
          chips.append(b);
        }
        return f.label ? h('div.tp-field', h('label', { text: f.label }), h('div.ctrl', chips)) : chips;
      }
      case 'toggle': {
        const inp = h('input', { type: 'checkbox', checked: !!f.value });
        inp.addEventListener('change', () => change(inp.checked));
        return h('label.toggle', inp, h('span', { text: f.label }));
      }
      case 'select': {
        const sel = h('select');
        for (const o of f.options) sel.append(h('option', { value: o.value, text: o.label, selected: o.value === f.value }));
        sel.addEventListener('change', () => change(sel.value));
        return h('div.tp-field', h('label', { text: f.label }), h('div.ctrl', sel));
      }
      case 'text': {
        const inp = h('textarea.tp-text', { rows: 2, spellcheck: false, placeholder: f.placeholder || '' });
        inp.value = f.value || '';
        inp.dataset.key = f.key;
        this.inputs.set(f.key, inp);
        inp.addEventListener('input', () => change(inp.value));
        inp.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Escape') inp.blur();
          // Enter places/applies; Shift+Enter starts a new line.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            f.onEnter?.();
          }
        });
        return h('div.tp-field.tp-field-text', h('label', { text: f.label }), h('div.ctrl', inp));
      }
      case 'info':
        return h('div.tp-hint', { html: f.text });
      case 'button':
        return h('button.btn', { text: f.label, onClick: f.action });
      default:
        return h('div');
    }
  }

  // Focus the first numeric input (for typing a value right away).
  focusFirst(key) {
    const inp = key ? this.inputs.get(key) : [...this.inputs.values()][0];
    if (inp) {
      inp.focus();
      inp.select();
    }
  }
}
