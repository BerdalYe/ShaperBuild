// "2D drawing": front, top and side views with hidden lines, overall sizes,
// a title block and notes, plus optional 3D, section and detail views,
// saved as PDF, SVG or DXF.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { t } from '../core/i18n.js';
import { VIEWS, SHEETS, SCALES, layoutDrawing, drawingSketches, scaleText, viewBox } from '../core/drawing.js';
import { writeDXF } from '../core/dxf.js';

// Title block fields kept with the design (see doc.state.drawing).
const FIELDS = [
  ['drawnBy', 'Drawn by'],
  ['number', 'Drawing number'],
  ['material', 'Material'],
  ['revision', 'Revision'],
];

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
    const kept = doc.state.drawing || {};
    this.bodies = bodies;
    this.opts = {
      sheet: SHEETS[s.drawingSheet] ? s.drawingSheet : 'A4',
      portrait: !!s.drawingPortrait,
      projection: s.drawingProjection || (/^en-US/i.test(navigator.language) ? 'third' : 'first'),
      hidden: s.drawingHidden !== false,
      dims: s.drawingDims !== false,
      iso: s.drawingIso !== false,
      section: !!s.drawingSection,
      scale: 'auto',
      title: kept.title || (bodies.length === 1 ? bodies[0].name : app.files.name),
      drawnBy: kept.drawnBy ?? s.drawingAuthor ?? '',
      number: kept.number || '',
      material: kept.material || '',
      revision: kept.revision || '',
      notes: kept.notes || '',
      detail: null,
    };
    this.views = null;
    this.section = null;
    this.error = null;
    this.body = h('div.drawing-dialog');
    this.render();
    this.load();
    await modal({ title: '2D drawing', body: this.body, buttons: [], width: 980, className: 'drawing-modal', bind: (close) => (this.close = close) });
    this.body = null;
    this.keepFields();
  }

  // Remember the title block and notes with the design.
  keepFields() {
    const o = this.opts;
    const doc = this.app.doc;
    const now = { title: o.title, drawnBy: o.drawnBy, number: o.number, material: o.material, revision: o.revision, notes: o.notes };
    const was = doc.state.drawing || {};
    if (Object.keys(now).every((k) => (now[k] || '') === (was[k] || ''))) return;
    doc.apply('Drawing details', (d) => {
      d.drawing = now;
    });
    this.app.settings.drawingAuthor = o.drawnBy;
    this.app.saveSettings();
  }

  async load() {
    try {
      const res = await this.app.kernel.call('drawingViews', { ids: this.bodies.map((b) => b.shapeId), views: Object.values(VIEWS) });
      this.views = Object.fromEntries(res.views.map((v) => [v.name, v]));
    } catch (err) {
      this.error = err.message;
    }
    this.render();
    if (this.opts.section) this.loadSection();
  }

  // Cut through the middle, seen from the front.
  async loadSection() {
    if (this.section || this.sectionBusy) return;
    this.sectionBusy = true;
    try {
      const box = this.bodies.map((b) => this.app.bodyBox(b.id)).reduce((a, bb) => (bb ? (a ? a.union(bb) : bb.clone()) : a), null);
      const c = box ? box.getCenter(box.min.clone()).toArray() : [0, 0, 0];
      const res = await this.app.kernel.call('drawingSection', { ids: this.bodies.map((b) => b.shapeId), view: VIEWS.front, at: c });
      this.section = { view: res, at: c[1] };
    } catch (err) {
      toast(t('Could not make the section: {error}', { error: t(err.message) }), { type: 'error', ms: 4000 });
      this.opts.section = false;
    } finally {
      this.sectionBusy = false;
    }
    this.render();
  }

  layout() {
    if (!this.views) return null;
    const o = this.opts;
    const views = { front: this.views.front, top: this.views.top, right: this.views.right };
    if (o.iso) views.iso = this.views.iso;
    if (o.section && this.section) views.section = this.section.view;
    return layoutDrawing(views, {
      sheet: o.sheet,
      portrait: o.portrait,
      projection: o.projection,
      hidden: o.hidden,
      dims: o.dims,
      title: o.title || 'Part',
      units: 'mm',
      scale: o.scale === 'auto' ? null : +o.scale,
      drawnBy: o.drawnBy,
      number: o.number,
      material: o.material,
      revision: o.revision,
      notes: o.notes,
      detail: o.detail,
      sectionAt: this.section?.at ?? null,
    });
  }

  saveSettings() {
    const s = this.app.settings;
    s.drawingSheet = this.opts.sheet;
    s.drawingPortrait = this.opts.portrait;
    s.drawingProjection = this.opts.projection;
    s.drawingHidden = this.opts.hidden;
    s.drawingDims = this.opts.dims;
    s.drawingIso = this.opts.iso;
    s.drawingSection = this.opts.section;
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

  // A detail view starts on the front view, around its middle.
  defaultDetail() {
    const bb = viewBox(this.views.front);
    return { view: 'front', at: [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2], radius: Math.max(1, +(Math.max(bb.w, bb.h) * 0.2).toFixed(1)), factor: 2 };
  }

  renderBody() {
    const o = this.opts;
    const scroll = this.body.querySelector('.dd-side')?.scrollTop || 0;
    clear(this.body);
    const lay = this.layout();
    const preview = h('div.dd-preview');
    if (this.error) preview.append(h('div.dd-msg', { str: t('Could not make the drawing: {error}', { error: t(this.error) }) }));
    else if (!lay) preview.append(h('div.dd-msg', { html: '<span class="spinner"></span> Making the views…' }));
    else {
      preview.innerHTML = lay.svg;
      // With a detail view, a click on a view moves the detail there.
      if (o.detail) {
        const svgEl = preview.querySelector('svg');
        svgEl.style.cursor = 'crosshair';
        svgEl.addEventListener('click', (e) => {
          const pt = svgEl.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const p = pt.matrixTransform(svgEl.getScreenCTM().inverse());
          for (const key of ['front', 'top', 'right']) {
            const v = lay.placed[key];
            if (!v || p.x < v.box.x0 - 4 || p.x > v.box.x1 + 4 || p.y < v.box.y0 - 4 || p.y > v.box.y1 + 4) continue;
            o.detail = { ...o.detail, view: key, at: [v.mx + (p.x - v.cx) / v.s, v.my - (p.y - v.cy) / v.s] };
            this.render();
            return;
          }
        });
      }
    }

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
    const check = (key, label, after) => {
      const inp = h('input', { type: 'checkbox', checked: !!o[key] });
      inp.dataset.option = key;
      inp.addEventListener('change', () => {
        o[key] = inp.checked;
        after?.(inp.checked);
        this.render();
      });
      return h('label.dd-check', inp, h('span', { text: label }));
    };
    const text = (key, multi = false) => {
      const el = h(multi ? 'textarea.dd-title.dd-notes' : 'input.dd-title', { type: multi ? undefined : 'text', spellcheck: false, maxlength: multi ? 1200 : 80 });
      el.value = o[key] || '';
      el.dataset.field = key;
      el.addEventListener('change', () => {
        o[key] = el.value;
        this.render();
      });
      el.addEventListener('keydown', (e) => e.stopPropagation());
      return el;
    };
    const scaleSel = h('select.dd-select');
    scaleSel.append(new Option(t('Fit to the sheet'), 'auto'));
    for (const sc of SCALES) scaleSel.append(new Option(scaleText(sc), String(sc)));
    scaleSel.value = String(o.scale);
    scaleSel.addEventListener('change', () => {
      o.scale = scaleSel.value;
      this.render();
    });
    const detailControls = [];
    if (o.detail) {
      const num = (key, label, min, step) => {
        const el = h('input.dd-title.dd-num', { type: 'number', min, step, value: o.detail[key] });
        el.addEventListener('change', () => {
          const v = +el.value;
          if (v >= min) o.detail = { ...o.detail, [key]: v };
          this.render();
        });
        el.addEventListener('keydown', (e) => e.stopPropagation());
        return h('label.dd-row', h('span', { text: label }), el);
      };
      detailControls.push(h('div.dd-info', { text: 'Click a view on the sheet to move the detail circle.' }), num('radius', 'Circle radius (mm)', 0.5, 0.5), num('factor', 'Magnify', 1, 0.5));
    }
    const side = h(
      'div.dd-side',
      h('label.dd-label', { text: 'Title' }),
      text('title'),
      ...FIELDS.flatMap(([key, label]) => [h('label.dd-sublabel', { text: label }), text(key)]),
      h('label.dd-label', { text: 'Paper' }),
      seg('sheet', Object.keys(SHEETS).map((k) => [k, k])),
      seg('portrait', [
        [false, 'Landscape'],
        [true, 'Portrait'],
      ]),
      h('label.dd-label', { text: 'Scale' }),
      scaleSel,
      h('label.dd-label', { text: 'View layout' }),
      seg('projection', [
        ['first', '1st angle (Europe)'],
        ['third', '3rd angle (USA)'],
      ]),
      check('hidden', 'Show hidden lines (dashed)'),
      check('dims', 'Show overall sizes'),
      check('iso', 'Add a 3D view'),
      check('section', 'Add a section through the middle', (on) => on && this.loadSection()),
      (() => {
        const inp = h('input', { type: 'checkbox', checked: !!o.detail });
        inp.dataset.option = 'detail';
        inp.addEventListener('change', () => {
          o.detail = inp.checked && this.views ? this.defaultDetail() : null;
          this.render();
        });
        return h('label.dd-check', inp, h('span', { text: 'Add a detail view (enlarged)' }));
      })(),
      ...detailControls,
      h('label.dd-label', { text: 'Notes' }),
      text('notes', true),
      lay ? h('div.dd-info', { str: t('Scale {scale} · sizes in millimetres', { scale: scaleText(lay.scale) }) }) : null,
      this.bodies.length > 1 ? h('div.dd-info', { str: t('{n} bodies', { n: this.bodies.length }) }) : null,
    );
    const btn = (label, ic, fmt, primary) => {
      const b = h(`button.btn${primary ? '.primary' : ''}`, { html: `${icon(ic)}<span>${t(label)}</span>`, type: 'button' });
      b.disabled = !lay;
      b.addEventListener('click', () => this.save(fmt));
      return b;
    };
    const cancel = h('button.btn', { text: 'Close', type: 'button' });
    cancel.addEventListener('click', () => this.close?.(null));
    const foot = h('div.pd-foot', btn('Save DXF…', 'export', 'dxf'), btn('Save SVG…', 'export', 'svg'), h('span.pd-spacer'), cancel, btn('Save PDF…', 'file', 'pdf', true));
    this.body.append(h('div.dd-main', preview, side), foot);
    side.scrollTop = scroll;
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
      toast(t('Saved {name}', { name: app.files.basename(target) }), { type: 'ok' });
    } catch (err) {
      toast(t('Could not save the drawing: {error}', { error: t(err.message) }), { type: 'error', ms: 5000 });
    }
  }
}
