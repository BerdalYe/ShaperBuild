// Floating number boxes next to the cursor while drawing. Start typing a
// number to enter an exact value; Tab moves to the next box, Enter applies.
import { h, clear } from './dom.js';
import { parseLength, parseAngle, parseNumber, formatLength, trimNumber } from '../core/units.js';

export class DimInput {
  constructor(container, app) {
    this.app = app;
    this.el = h('div.dim-input');
    this.el.hidden = true;
    container.append(this.el);
    this.fields = [];
    this.inputs = [];
    this.locked = {};
    this.onCommit = null;
    this.onChange = null;
  }

  get active() {
    return !this.el.hidden;
  }

  get editing() {
    return this.inputs.includes(document.activeElement);
  }

  // fields: [{ key, label, type: 'length' | 'angle' | 'count', value }]
  show(fields, x, y, { onCommit, onChange } = {}) {
    const same = this.fields.length === fields.length && this.fields.every((f, i) => f.key === fields[i].key);
    this.onCommit = onCommit;
    this.onChange = onChange;
    if (!same) {
      this.fields = fields.map((f) => ({ ...f }));
      this.locked = {};
      this.build();
    }
    this.setValues(Object.fromEntries(fields.map((f) => [f.key, f.value])));
    this.move(x, y);
    this.el.hidden = false;
  }

  build() {
    clear(this.el);
    this.inputs = this.fields.map((f, i) => {
      const inp = h('input.num-input', { type: 'text', spellcheck: false });
      inp.dataset.key = f.key;
      const label = h('label', h('span', { text: f.label }), inp);
      inp.addEventListener('focus', () => {
        label.classList.add('focus');
        inp.select();
      });
      inp.addEventListener('blur', () => label.classList.remove('focus'));
      inp.addEventListener('input', () => {
        const v = this.parse(f, inp.value);
        inp.classList.toggle('bad', !Number.isFinite(v) && inp.value.trim() !== '');
        if (Number.isFinite(v)) this.locked[f.key] = v;
        else delete this.locked[f.key];
        this.onChange?.({ ...this.locked });
      });
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          e.preventDefault();
          const next = this.inputs[(i + (e.shiftKey ? this.inputs.length - 1 : 1)) % this.inputs.length];
          next.focus();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const values = { ...this.locked };
          this.onCommit?.(values);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (Object.keys(this.locked).length) this.reset();
          else {
            inp.blur();
            this.app.tools.active?.onKeyDown?.({ key: 'Escape', native: e });
          }
        }
      });
      this.el.append(label);
      return inp;
    });
  }

  parse(f, text) {
    if (f.type === 'angle') return parseAngle(text);
    if (f.type === 'count') return parseNumber(text);
    return parseLength(text, this.app.units);
  }

  format(f, v) {
    if (!Number.isFinite(v)) return '';
    if (f.type === 'angle') return `${trimNumber(v, 1)}°`;
    if (f.type === 'count') return String(Math.round(v));
    return formatLength(v, this.app.units, { suffix: false });
  }

  setValues(values) {
    this.fields.forEach((f, i) => {
      if (!(f.key in values)) return;
      f.value = values[f.key];
      const inp = this.inputs[i];
      if (document.activeElement !== inp && !(f.key in this.locked)) inp.value = this.format(f, values[f.key]);
    });
  }

  move(x, y) {
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  // Called by tools on a key press while drawing: start typing a value.
  takeKey(e) {
    if (this.el.hidden || !this.inputs.length) return false;
    if (!/^[0-9.\-+*/()]$/.test(e.key)) return false;
    const inp = this.inputs[0];
    inp.focus();
    inp.value = e.key;
    inp.dispatchEvent(new Event('input'));
    e.native?.preventDefault?.();
    return true;
  }

  reset() {
    this.locked = {};
    this.inputs.forEach((inp, i) => (inp.value = this.format(this.fields[i], this.fields[i].value)));
    this.onChange?.({});
  }

  hide() {
    if (this.editing) document.activeElement.blur();
    this.el.hidden = true;
    this.fields = [];
    this.inputs = [];
    this.locked = {};
    clear(this.el);
    this.app.vp.canvas.focus({ preventScroll: true });
  }
}
