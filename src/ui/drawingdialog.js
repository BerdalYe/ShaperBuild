// "2D drawing": front, top and side views with hidden lines, overall sizes
// and a title block, saved as PDF, SVG or DXF.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { VIEWS, SHEETS, layoutDrawing, drawingSketches, scaleText } from '../core/drawing.js';
import { writeDXF } from '../core/dxf.js';

export class DrawingDialog {
  constructor(app) {
    this.app = app;
  }

  async open() {
    const app = this.app;
    const doc = app.doc;
    const selected = app.cmd.selectedBodyIds().map((id) => doc.body(id));
    const bodies = (selected.length ? selected : doc.bodies.filter((b) => b.visible !== false)).filter((b) => b && b.kind === 'solid');
    if (!bodies.length) {
      toast(doc.bodies.length ? '2D drawings need solid bodies. Convert meshes with Mesh → Solid first.' : 'Make a body first — drawings show bodies from the front, top and side.', { type: 'error', ms: 4000 });
      return;
    }
    if (!app.tools.isSelect) app.tools.cancel();
    const s = app.settings;
    this.bodies = bodies;
    this.opts = {
      sheet: SHEETS[s.drawingSheet] ? s.drawingSheet : 'A4',
      projection: s.drawingProjection || (/^en-US/i.test(navigator.language) ? 'third' : 'first'),
      hidden: s.drawingHidden !== false,
      dims: s.drawingDims !== false,
      iso: s.drawingIso !== false,
      title: bodies.length === 1 ? bodies[0].name : app.files.name,
    };
    this.views = null;
    this.error = null;
    this.body = h('div.drawing-dialog');
    this.render();
    this.load();
    await modal({ title: '2D drawing', body: this.body, buttons: [], width: 900, className: 'drawing-modal', bind: (close) => (this.close = close) });
    this.body = null;
  }

  async load() {
    try {
      const res = await this.app.kernel.call('drawingViews', { ids: this.bodies.map((b) => b.shapeId), views: Object.values(VIEWS) });
      this.views = Object.fromEntries(res.views.map((v) => [v.name, v]));
    } catch (err) {
      this.error = err.message;
    }
    this.render();
  }

  layout() {
    if (!this.views) return null;
    const o = this.opts;
    const views = { front: this.views.front, top: this.views.top, right: this.views.right };
    if (o.iso) views.iso = this.views.iso;
    return layoutDrawing(views, { sheet: o.sheet, projection: o.projection, hidden: o.hidden, dims: o.dims, title: o.title || 'Part', units: 'mm' });
  }

  saveSettings() {
    const s = this.app.settings;
    s.drawingSheet = this.opts.sheet;
    s.drawingProjection = this.opts.projection;
    s.drawingHidden = this.opts.hidden;
    s.drawingDims = this.opts.dims;
    s.drawingIso = this.opts.iso;
    this.app.saveSettings();
  }

  render() {
    if (!this.body || this.rendering) return;
    this.rendering = true;
    try {
      this.renderBody();
    } finally {
      this.rendering = false;
    }
  }

  renderBody() {
    const o = this.opts;
    clear(this.body);
    const lay = this.layout();
    const preview = h('div.dd-preview');
    if (this.error) preview.append(h('div.dd-msg', { text: `Could not make the drawing: ${this.error}` }));
    else if (!lay) preview.append(h('div.dd-msg', { html: '<span class="spinner"></span> Making the views…' }));
    else preview.innerHTML = lay.svg;

    const seg = (key, options) => {
      const el = h('div.seg');
      for (const [v, label] of options) {
        const b = h(`button${o[key] === v ? '.on' : ''}`, { text: label, type: 'button' });
        b.addEventListener('click', () => {
          o[key] = v;
          this.render();
        });
        el.append(b);
      }
      return el;
    };
    const check = (key, label) => {
      const inp = h('input', { type: 'checkbox', checked: !!o[key] });
      inp.addEventListener('change', () => {
        o[key] = inp.checked;
        this.render();
      });
      return h('label.dd-check', inp, h('span', { text: label }));
    };
    const title = h('input.dd-title', { type: 'text', value: o.title, spellcheck: false });
    title.addEventListener('change', () => {
      o.title = title.value;
      this.render();
    });
    title.addEventListener('keydown', (e) => e.stopPropagation());
    const side = h(
      'div.dd-side',
      h('label.dd-label', { text: 'Title' }),
      title,
      h('label.dd-label', { text: 'Paper' }),
      seg('sheet', Object.keys(SHEETS).map((k) => [k, k])),
      h('label.dd-label', { text: 'View layout' }),
      seg('projection', [
        ['first', '1st angle (Europe)'],
        ['third', '3rd angle (USA)'],
      ]),
      check('hidden', 'Show hidden lines (dashed)'),
      check('dims', 'Show overall sizes'),
      check('iso', 'Add a 3D view'),
      lay ? h('div.dd-info', { text: `Scale ${scaleText(lay.scale)} · sizes in millimetres` }) : null,
      this.bodies.length > 1 ? h('div.dd-info', { text: `${this.bodies.length} bodies` }) : null,
    );
    const btn = (label, ic, fmt, primary) => {
      const b = h(`button.btn${primary ? '.primary' : ''}`, { html: `${icon(ic)}<span>${label}</span>`, type: 'button' });
      b.disabled = !lay;
      b.addEventListener('click', () => this.save(fmt));
      return b;
    };
    const cancel = h('button.btn', { text: 'Close', type: 'button' });
    cancel.addEventListener('click', () => this.close?.(null));
    const foot = h('div.pd-foot', btn('Save DXF…', 'export', 'dxf'), btn('Save SVG…', 'export', 'svg'), h('span.pd-spacer'), cancel, btn('Save PDF…', 'file', 'pdf', true));
    this.body.append(h('div.dd-main', preview, side), foot);
  }

  async save(fmt) {
    const app = this.app;
    const lay = this.layout();
    if (!lay) return;
    this.saveSettings();
    const name = this.opts.title || app.files.name;
    let bytes;
    try {
      if (fmt === 'svg') bytes = new TextEncoder().encode(lay.svg);
      else if (fmt === 'dxf') bytes = new TextEncoder().encode(writeDXF(drawingSketches(lay)));
      else {
        if (!window.native?.drawingPDF) return toast('Saving PDF needs the desktop app. Save SVG instead.', { type: 'error' });
        bytes = await window.native.drawingPDF({ svg: lay.svg, width: lay.width, height: lay.height });
      }
      const native = window.native;
      if (!native) {
        const url = URL.createObjectURL(new Blob([bytes]));
        h('a', { href: url, download: `${name}.${fmt}` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      const target = await native.saveDialog({ kind: fmt, defaultName: name });
      if (!target) return;
      await native.writeFile(target, bytes);
      this.lastSaved = target;
      toast(`Saved ${app.files.basename(target)}`, { type: 'ok' });
    } catch (err) {
      toast(`Could not save the drawing: ${err.message}`, { type: 'error', ms: 5000 });
    }
  }
}
