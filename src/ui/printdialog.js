// "3D Print": check that the design is printable and save it as STL or 3MF,
// or open it straight in a slicer.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { writeSTL, write3MF } from '../core/formats.js';

export const PRINTERS = {
  generic: { name: 'Typical printer', bed: [220, 220, 250] },
  'bambu-a1': { name: 'Bambu Lab A1 / P1 / X1', bed: [256, 256, 256] },
  'bambu-a1-mini': { name: 'Bambu Lab A1 mini', bed: [180, 180, 180] },
  'prusa-mk4': { name: 'Prusa MK4 / MK3', bed: [250, 210, 220] },
  'prusa-core-one': { name: 'Prusa CORE One', bed: [250, 220, 270] },
  'prusa-mini': { name: 'Prusa MINI', bed: [180, 180, 180] },
  ender3: { name: 'Creality Ender-3', bed: [220, 220, 250] },
  'creality-k1': { name: 'Creality K1', bed: [220, 220, 250] },
  large: { name: 'Large printer', bed: [300, 300, 400] },
  custom: { name: 'Custom size…', bed: null },
};

const QUALITY = { coarse: 0.1, normal: 0.03, fine: 0.01, ultra: 0.003 };
const PLA_DENSITY = 1.24; // g/cm³

// Short number: 220, 12.5, 0.75 (no trailing zeros after the point).
export const fmt = (v) => {
  const t = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return t.includes('.') ? t.replace(/\.?0+$/, '') : t;
};
const dims = (bb) => [0, 1, 2].map((k) => bb.max[k] - bb.min[k]);
const sizeText = (d) => `${d.map(fmt).join(' × ')} mm`;

function unionBox(boxes) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k]);
      max[k] = Math.max(max[k], b.max[k]);
    }
  return { min, max };
}

function boxesOverlap(a, b) {
  for (let k = 0; k < 3; k++) if (a.max[k] < b.min[k] - 1e-6 || b.max[k] < a.min[k] - 1e-6) return false;
  return true;
}

// Fit test for a part on a bed, allowing a 90° turn on the bed.
export function bedFit(size, bed) {
  const [x, y, z] = size;
  const [bx, by, bz] = bed;
  if (z > bz + 1e-6) return 'too-tall';
  if (x <= bx + 1e-6 && y <= by + 1e-6) return 'fits';
  if (y <= bx + 1e-6 && x <= by + 1e-6) return 'rotate';
  return 'too-big';
}

// The file contents for the chosen parts. `place` moves everything so it
// sits on the bed (lowest point at Z = 0) centred on the bed.
export function buildPrintFile(parts, { format = '3mf', place = true, bed = [220, 220, 250], binary = true, name = 'ShaperBuild' } = {}) {
  let out = parts;
  if (place && parts.length) {
    const bb = unionBox(parts.map((p) => p.stats.bbox));
    const off = [bed[0] / 2 - (bb.min[0] + bb.max[0]) / 2, bed[1] / 2 - (bb.min[1] + bb.max[1]) / 2, -bb.min[2]];
    out = parts.map((p) => {
      const pos = new Float32Array(p.positions.length);
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] = p.positions[i] + off[0];
        pos[i + 1] = p.positions[i + 1] + off[1];
        pos[i + 2] = p.positions[i + 2] + off[2];
      }
      return { ...p, positions: pos };
    });
  }
  return format === 'stl' ? writeSTL(out, { binary, name }) : write3MF(out);
}

export class PrintDialog {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // `${shapeId}|${quality}` -> part
  }

  async open() {
    const app = this.app;
    const doc = app.doc;
    if (!doc.bodies.length) {
      toast('There is nothing to print yet. Make a body or import an STL first.', { type: 'error', ms: 3500 });
      return;
    }
    if (!app.tools.isSelect) app.tools.cancel();
    const s = app.settings;
    const selected = app.cmd.selectedBodyIds();
    this.chosen = new Set(selected.length ? selected : doc.bodies.filter((b) => b.visible !== false).map((b) => b.id));
    if (!this.chosen.size) this.chosen = new Set(doc.bodies.map((b) => b.id));
    this.opts = {
      printer: PRINTERS[s.printer] ? s.printer : 'generic',
      custom: s.printerCustom || [200, 200, 200],
      format: s.printFormat === 'stl' ? 'stl' : '3mf',
      quality: QUALITY[s.stlQuality] ? s.stlQuality : 'fine',
      place: s.printPlace !== false,
      separate: false,
    };
    this.slicers = (await window.native?.listSlicers?.().catch(() => [])) || [];
    this.slicer = this.slicers.some((x) => x.id === s.slicer) ? s.slicer : this.slicers[0]?.id || 'default';
    this.parts = new Map();
    this.error = null;
    this.body = h('div.print-dialog');
    this.render();
    this.load();
    await modal({ title: '3D print', body: this.body, buttons: [], width: 660, className: 'print-modal', bind: (close) => (this.close = close) });
    this.body = null;
  }

  get bed() {
    return this.opts.printer === 'custom' ? this.opts.custom : PRINTERS[this.opts.printer].bed;
  }

  saveSettings() {
    const s = this.app.settings;
    s.printer = this.opts.printer;
    s.printerCustom = this.opts.custom;
    s.printFormat = this.opts.format;
    s.printPlace = this.opts.place;
    s.stlQuality = this.opts.quality;
    s.slicer = this.slicer;
    this.app.saveSettings();
  }

  // Tessellate and check the chosen bodies (cached per quality).
  async load() {
    const app = this.app;
    const q = this.opts.quality;
    const need = [...this.chosen].map((id) => app.doc.body(id)).filter((b) => b && !this.cache.has(`${b.shapeId}|${q}`));
    if (need.length) {
      this.loading = true;
      this.render();
      try {
        const { parts } = await app.kernel.call('printMeshes', { ids: need.map((b) => b.shapeId), tolerance: QUALITY[q] });
        parts.forEach((p, i) => this.cache.set(`${need[i].shapeId}|${q}`, p));
        this.error = null;
      } catch (err) {
        this.error = err.message;
      }
      this.loading = false;
    }
    if (this.body) this.render();
  }

  chosenParts() {
    const q = this.opts.quality;
    const out = [];
    for (const b of this.app.doc.bodies) {
      if (!this.chosen.has(b.id)) continue;
      const p = this.cache.get(`${b.shapeId}|${q}`);
      if (p) out.push({ ...p, name: b.name, bodyId: b.id });
    }
    return out;
  }

  checks(parts) {
    const out = [];
    const ok = (text) => out.push({ level: 'ok', text });
    const warn = (text) => out.push({ level: 'warn', text });
    const bad = (text) => out.push({ level: 'bad', text });
    if (!parts.length) return [{ level: 'bad', text: 'Pick at least one body to print.' }];
    const open = parts.filter((p) => !p.stats.watertight);
    if (!open.length) ok(parts.length === 1 ? 'Closed, solid shape — ready to slice.' : 'All bodies are closed, solid shapes — ready to slice.');
    for (const p of open) {
      const holes = p.stats.openEdges + p.stats.nonManifoldEdges;
      const fix = p.kind === 'mesh' ? ' Most slicers repair small gaps; for big ones fix the mesh first.' : '';
      warn(`“${p.name}” is not a closed shape (${holes || p.stats.flippedEdges} problem edge${holes === 1 ? '' : 's'}).${fix}`);
    }
    const bb = unionBox(parts.map((p) => p.stats.bbox));
    const size = dims(bb);
    const bed = this.bed;
    const printer = `${this.opts.printer === 'custom' ? 'custom printer' : PRINTERS[this.opts.printer].name}, ${sizeText(bed)}`;
    const fit = bedFit(size, bed);
    if (fit === 'fits') ok(`Fits the print bed (${printer}).`);
    else if (fit === 'rotate') warn(`Fits the print bed (${printer}) if you turn it 90° in your slicer.`);
    else if (fit === 'too-tall') bad(`Too tall for the printer: ${fmt(size[2])} mm high, it goes up to ${fmt(bed[2])} mm. Lay it on its side, scale it down, or split it.`);
    else bad(`Too big for the print bed (${printer}). Scale it down with Scale, or split it into pieces.`);
    const biggest = Math.max(...size);
    if (biggest < 2) warn(`It is tiny: only ${fmt(biggest)} mm across. Files are in millimetres — did you mean it to be bigger?`);
    if (biggest > 2000) warn(`It is huge: ${fmt(biggest / 1000)} m across. Files are in millimetres — check the size.`);
    if (!this.opts.place && Math.abs(bb.min[2]) > 0.01) warn(`The lowest point is at Z = ${fmt(bb.min[2])} mm. Turn on “Put it on the print bed” or move it in your slicer.`);
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++)
        if (boxesOverlap(parts[i].stats.bbox, parts[j].stats.bbox)) {
          warn(`“${parts[i].name}” and “${parts[j].name}” touch or overlap. If they should be one piece, join them with Union first.`);
          i = parts.length;
          break;
        }
    return out;
  }

  render() {
    // Clearing the body blurs a focused field, whose change handler renders
    // again; ignore that nested call.
    if (!this.body || this.rendering) return;
    this.rendering = true;
    try {
      this.renderBody();
    } finally {
      this.rendering = false;
    }
  }

  renderBody() {
    const app = this.app;
    const o = this.opts;
    clear(this.body);
    const parts = this.chosenParts();
    const q = o.quality;

    // Bodies
    const list = h('div.pd-list');
    for (const b of app.doc.bodies) {
      const p = this.cache.get(`${b.shapeId}|${q}`);
      const cb = h('input', { type: 'checkbox', checked: this.chosen.has(b.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) this.chosen.add(b.id);
        else this.chosen.delete(b.id);
        this.load();
        this.render();
      });
      const sw = h('span.pd-swatch');
      sw.style.background = b.color || app.vp.theme.body;
      list.append(
        h(
          `label.pd-body${b.visible === false ? '.hidden-body' : ''}`,
          cb,
          sw,
          h('span.pd-name', { text: b.name }),
          b.kind === 'mesh' ? h('span.pd-tag', { text: 'mesh' }) : null,
          h('span.pd-size', { text: p ? sizeText(dims(p.stats.bbox)) : this.chosen.has(b.id) ? '…' : '' }),
        ),
      );
    }

    // Summary and checks
    const summary = h('div.pd-summary');
    const checks = h('div.pd-checks');
    if (this.error) checks.append(h('div.pd-check.bad', { html: `${icon('close')}<span>Could not prepare the mesh: ${this.error}</span>` }));
    else if (this.loading || parts.length < this.chosen.size) checks.append(h('div.pd-check', { html: `<span class="spinner"></span><span>Checking your design…</span>` }));
    else {
      if (parts.length) {
        const bb = unionBox(parts.map((p) => p.stats.bbox));
        const vol = parts.reduce((s, p) => s + p.stats.volume, 0);
        const grams = (vol / 1000) * PLA_DENSITY;
        const tris = parts.reduce((s, p) => s + p.stats.triangles, 0);
        summary.append(
          h('div', h('small', { text: 'Size' }), h('b', { text: sizeText(dims(bb)) })),
          h('div', h('small', { text: 'Volume' }), h('b', { text: `${fmt(vol / 1000)} cm³` })),
          h('div', h('small', { text: 'Plastic if printed solid' }), h('b', { text: `≈ ${fmt(grams)} g PLA` })),
          h('div', h('small', { text: 'Triangles' }), h('b', { text: tris.toLocaleString('en-US') })),
        );
      }
      for (const c of this.checks(parts)) {
        const ic = c.level === 'ok' ? 'check' : c.level === 'warn' ? 'help' : 'close';
        checks.append(h(`div.pd-check.${c.level}`, { html: `${icon(ic)}<span></span>` }));
        checks.lastChild.querySelector('span').textContent = c.text;
      }
    }

    // Options
    const printerSel = h('select');
    for (const [k, v] of Object.entries(PRINTERS)) printerSel.append(h('option', { value: k, text: v.bed ? `${v.name} — ${v.bed.join(' × ')} mm` : v.name, selected: k === o.printer }));
    printerSel.addEventListener('change', () => {
      o.printer = printerSel.value;
      this.render();
    });
    const printerRow = h('div.pd-row', h('label', { text: 'Printer' }), printerSel);
    const customRow = h('div.pd-row.pd-custom');
    if (o.printer === 'custom') {
      ['Width', 'Depth', 'Height'].forEach((label, k) => {
        const inp = h('input', { type: 'number', min: 10, max: 2000, value: o.custom[k] });
        inp.addEventListener('change', () => {
          const v = Number(inp.value);
          if (v > 0) o.custom[k] = v;
          this.render();
        });
        customRow.append(h('span', { text: label }), inp);
      });
      customRow.append(h('span', { text: 'mm' }));
    }
    const fmtSeg = h('div.seg.pd-seg');
    for (const [k, label] of [
      ['3mf', '3MF (recommended)'],
      ['stl', 'STL'],
    ]) {
      const b = h(`button${o.format === k ? '.on' : ''}`, { text: label, type: 'button' });
      b.addEventListener('click', () => {
        o.format = k;
        this.render();
      });
      fmtSeg.append(b);
    }
    const qSel = h('select');
    for (const [k, label] of [
      ['coarse', 'Draft — small file'],
      ['normal', 'Normal'],
      ['fine', 'Fine (recommended)'],
      ['ultra', 'Ultra — large file'],
    ])
      qSel.append(h('option', { value: k, text: label, selected: k === q }));
    qSel.addEventListener('change', () => {
      o.quality = qSel.value;
      this.load();
    });
    const place = h('input', { type: 'checkbox', checked: o.place });
    place.addEventListener('change', () => {
      o.place = place.checked;
      this.render();
    });
    const separate = h('input', { type: 'checkbox', checked: o.separate });
    separate.addEventListener('change', () => (o.separate = separate.checked));
    const options = h(
      'div.pd-options',
      printerRow,
      customRow,
      h('div.pd-row', h('label', { text: 'File type' }), fmtSeg),
      h('div.pd-row', h('label', { text: 'Smoothness' }), qSel),
      h('label.pd-check-row', place, h('span', { text: 'Put it on the print bed (lowest point at the bottom, centred)' })),
      parts.length > 1 ? h('label.pd-check-row', separate, h('span', { text: 'Save each body as its own file' })) : null,
    );
    const formatHint = h('div.pd-hint', {
      text: o.format === '3mf' ? '3MF keeps millimetres, names and separate parts. Works with PrusaSlicer, Bambu Studio, OrcaSlicer and Cura.' : 'STL works with every slicer. It has no units; slicers read it as millimetres.',
    });

    // Buttons
    const ready = !this.loading && !this.error && parts.length > 0 && parts.length === this.chosen.size;
    const cancel = h('button.btn', { text: 'Cancel', type: 'button' });
    cancel.addEventListener('click', () => this.close?.(null));
    const save = h('button.btn.primary', { html: `${icon('export')}<span>Save ${o.format.toUpperCase()} file…</span>`, type: 'button' });
    save.disabled = !ready;
    save.addEventListener('click', () => this.save());
    const slicerBox = h('div.pd-slicer');
    if (this.slicers.length) {
      const sel = h('select');
      for (const sl of this.slicers) sel.append(h('option', { value: sl.id, text: sl.name, selected: sl.id === this.slicer }));
      sel.append(h('option', { value: 'default', text: `Default app for .${o.format}`, selected: this.slicer === 'default' }));
      sel.addEventListener('change', () => (this.slicer = sel.value));
      const go = h('button.btn', { html: `${icon('printer')}<span>Open in</span>`, type: 'button' });
      go.disabled = !ready;
      go.addEventListener('click', () => this.openInSlicer());
      slicerBox.append(go, sel);
    } else if (window.native) {
      const go = h('button.btn', { html: `${icon('printer')}<span>Open with default app</span>`, type: 'button', title: 'No slicer found. Install PrusaSlicer, Bambu Studio, OrcaSlicer or Cura to open files in it directly.' });
      go.disabled = !ready;
      go.addEventListener('click', () => {
        this.slicer = 'default';
        this.openInSlicer();
      });
      slicerBox.append(go);
    }
    const foot = h('div.pd-foot', slicerBox, h('span.pd-spacer'), cancel, save);

    this.body.append(
      h('div.pd-section', h('h4', { text: 'What to print' }), list),
      summary,
      checks,
      h('div.pd-section', h('h4', { text: 'Settings' }), options, formatHint),
      foot,
    );
  }

  fileBytes(parts) {
    const o = this.opts;
    return buildPrintFile(parts, { format: o.format, place: o.place, bed: this.bed, binary: this.app.settings.stlBinary !== false, name: this.app.files.name });
  }

  async save() {
    const app = this.app;
    const o = this.opts;
    const parts = this.chosenParts();
    if (!parts.length) return;
    this.saveSettings();
    const base = parts.length === 1 ? parts[0].name : app.files.name;
    const native = window.native;
    try {
      if (!native) {
        const bytes = this.fileBytes(parts);
        const url = URL.createObjectURL(new Blob([bytes]));
        const a = h('a', { href: url, download: `${base}.${o.format}` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.close?.('saved');
        return;
      }
      const target = await native.saveDialog({ kind: o.format, defaultName: base });
      if (!target) return;
      if (o.separate && parts.length > 1) {
        const sep = native.pathSep;
        const dir = target.slice(0, target.lastIndexOf(sep));
        const stem = target.slice(target.lastIndexOf(sep) + 1).replace(/\.[^.]+$/, '');
        // Each body becomes its own file, placed on the bed by itself.
        for (const p of parts) {
          const one = buildPrintFile([p], { format: o.format, place: o.place, bed: this.bed, binary: app.settings.stlBinary !== false, name: p.name });
          await native.writeFile(`${dir}${sep}${stem} - ${p.name.replace(/[\\/:*?"<>|]+/g, '_')}.${o.format}`, one);
        }
        toast(`Saved ${parts.length} ${o.format.toUpperCase()} files`, { type: 'ok' });
      } else {
        await native.writeFile(target, this.fileBytes(parts));
        toast(`Saved ${app.files.basename(target)} — open it in your slicer to print`, { type: 'ok', ms: 3500 });
      }
      this.lastSaved = target;
      this.close?.('saved');
    } catch (err) {
      toast(`Could not save: ${err.message}`, { type: 'error', ms: 6000 });
    }
  }

  async openInSlicer() {
    const app = this.app;
    const parts = this.chosenParts();
    if (!parts.length || !window.native?.openForPrint) return;
    this.saveSettings();
    const name = parts.length === 1 ? parts[0].name : app.files.name;
    try {
      const res = await window.native.openForPrint({ name, ext: this.opts.format, data: this.fileBytes(parts), slicer: this.slicer });
      if (!res.ok) throw new Error(res.error || 'no app is set up to open this file type');
      const sl = this.slicers.find((x) => x.id === this.slicer);
      toast(sl ? `Opening in ${sl.name}…` : 'Opening…', { type: 'ok' });
      this.close?.('opened');
    } catch (err) {
      toast(`Could not open it: ${err.message}. Save the file instead and open it in your slicer.`, { type: 'error', ms: 6000 });
    }
  }
}
