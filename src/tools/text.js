// Text tool: type text, click where it should go. The letters become sketch
// curves and are selected, ready to extrude (raised) or cut (engraved).
import { SketchTool } from './sketch.js';
import { loadFont, textEntities, insideText, textPreview } from '../core/text.js';
import { planeFrame, to2D, to3D, rayPlane, GROUND } from '../core/plane.js';
import { toast } from '../ui/overlays.js';

export class TextTool extends SketchTool {
  get pickKinds() {
    return ['region', 'face', 'body', 'plane'];
  }

  get options() {
    return [
      { type: 'text', key: 'text', label: 'Text', value: this.text, placeholder: 'Type your text', onEnter: () => this.placeHere() },
      {
        type: 'choice',
        key: 'font',
        label: 'Font',
        value: this.fontKey,
        options: [
          { value: 'bold', label: 'Bold' },
          { value: 'regular', label: 'Regular' },
          { value: 'file', label: this.customName ? `${this.customName}` : 'From file…', title: 'Use a .ttf or .otf font from your computer' },
        ],
      },
      { type: 'length', key: 'size', label: 'Letter height', value: this.size, min: 0.1 },
    ];
  }

  activate(opts) {
    const s = this.app.settings;
    this.text = s.textValue ?? 'Text';
    this.fontKey = s.textFont === 'regular' ? 'regular' : 'bold';
    this.size = s.textSize > 0 ? s.textSize : 10;
    this.font = null;
    super.activate(opts);
    this.loadFont();
    setTimeout(() => {
      const inp = this.app.panel.inputs.get('text');
      if (inp && this.app.tools.active === this) {
        inp.focus();
        inp.select();
      }
    }, 30);
  }

  startHint() {
    return 'Type your text in the panel, then click where it should go — on the grid or a flat face. <kbd>Enter</kbd> puts it at the centre.';
  }

  async loadFont() {
    try {
      this.font = await loadFont(this.fontKey === 'file' ? 'custom' : this.fontKey);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
    this.redraw();
  }

  onOption(key, value) {
    super.onOption(key, value);
    const s = this.app.settings;
    if (key === 'text') this.text = s.textValue = value;
    if (key === 'size' && value > 0) this.size = s.textSize = value;
    if (key === 'font') {
      if (value === 'file') this.pickFontFile();
      else {
        this.fontKey = s.textFont = value;
        this.loadFont();
      }
    }
    this.app.saveSettings();
    this.redraw();
  }

  async pickFontFile() {
    const native = window.native;
    const restore = () => this.app.panel.update({ fields: [...this.options, this.constructionField()] });
    if (!native) return restore();
    const [file] = (await native.openDialog({ kind: 'font' })) || [];
    if (!file) return restore();
    try {
      const bytes = await native.readFile(file);
      this.font = await loadFont('custom', bytes);
      this.fontKey = 'file';
      this.customName = file.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    } catch (err) {
      toast(`That font could not be read: ${err.message}`, { type: 'error', ms: 4000 });
    }
    restore();
    this.redraw();
  }

  constructionField() {
    return { type: 'toggle', key: 'construction', label: 'Construction geometry (not used for profiles)', value: this.construction };
  }

  layout(at) {
    if (!this.font || !String(this.text).trim()) return null;
    return textEntities(this.font, this.text, { size: this.size, at });
  }

  // Plane and point under the cursor (text can go on any flat surface).
  target(e) {
    const info = this.planeUnder(e);
    if (!info) return null;
    const f = planeFrame(info.plane);
    const P = rayPlane(e.ray.origin, e.ray.dir, info.plane) || rayPlane(e.ray.origin, e.ray.dir.map((v) => -v), info.plane);
    if (!P) return null;
    const at = this.app.snapPoint(info.plane, to2D(f, P), e, { sketchId: info.sketchId }).p;
    return { ...info, frame: f, at };
  }

  redraw() {
    const ov = this.app.vp.overlay;
    const t = this.last && this.layout(this.last.at);
    if (!t) {
      ov.remove('tool-rb');
      this.app.vp.requestRender();
      return;
    }
    const f = this.last.frame;
    ov.lines('tool-rb', textPreview(t.entities).map((pl) => pl.map((p) => to3D(f, p))), { color: this.app.vp.theme.select, width: 1.6, dashed: this.construction });
    this.app.vp.requestRender();
  }

  onPointerMove(e) {
    const tg = this.target(e);
    this.app.selection.setHover(tg?.hit && tg.hit.kind === 'face' ? tg.hit : null);
    if (!tg) return;
    this.last = tg;
    this.redraw();
  }

  onPointerDown(e) {
    const tg = this.target(e);
    if (tg) this.place(tg);
  }

  finish() {
    this.placeHere();
  }

  // Enter: at the last pointer position, or the centre of the grid.
  placeHere() {
    this.place(this.last || { plane: GROUND, sketchId: this.app.findSketchOnPlane(GROUND), frame: planeFrame(GROUND), at: [0, 0] });
  }

  async place(tg) {
    const app = this.app;
    if (!this.font) return toast('The font is still loading…', { ms: 1500 });
    const t = this.layout(tg.at);
    if (!t || !t.entities.length) return toast('Type some text first', { ms: 1800 });
    this.plane = tg.plane;
    this.frame = tg.frame;
    this.sketchId = tg.sketchId || null;
    this.commit(t.entities, 'Text');
    const sketchId = this.sketchId;
    const construction = this.construction;
    app.tools.activate('select');
    if (construction) return;
    // Select the filled parts of the letters, ready to extrude.
    try {
      await app.ensureRegions([{ kind: 'region', sketchId, index: 0 }]);
      const data = app.regionCache.get(sketchId)?.data;
      const key = app.regionCache.get(sketchId)?.key;
      const f = planeFrame(app.doc.sketch(sketchId).plane);
      const items = [];
      for (const r of data?.regions || []) {
        const p = sampleInside(r, f);
        if (p && insideText(t.polygons, p)) items.push({ kind: 'region', sketchId, index: r.index, regionKey: key });
      }
      if (items.length) {
        app.selection.set(items);
        toast('Text added and selected. Press E to extrude it — a negative height engraves it into a face.', { ms: 4500 });
      }
    } catch (err) {
      console.warn('text regions', err);
    }
  }
}

// A point well inside a region: the centre of its largest triangle.
function sampleInside(region, f) {
  const P = region.positions;
  const I = region.indices;
  let best = null;
  for (let i = 0; i < I.length; i += 3) {
    const q = [0, 1, 2].map((j) => to2D(f, [P[I[i + j] * 3], P[I[i + j] * 3 + 1], P[I[i + j] * 3 + 2]]));
    const area = Math.abs((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]));
    if (!best || area > best.area) best = { area, p: [(q[0][0] + q[1][0] + q[2][0]) / 3, (q[0][1] + q[1][1] + q[2][1]) / 3] };
  }
  return best?.p || null;
}
