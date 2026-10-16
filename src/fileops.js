// Opening, saving, importing and exporting.
import { parseSTL, writeSTL, parseOBJ, writeOBJ, parse3MF, write3MF } from './core/formats.js';
import { toast, modal } from './ui/overlays.js';
import { h } from './ui/dom.js';
import { emptyState } from './core/doc.js';

export const PROJECT_EXT = 'shaperbuild';
const THUMBS_KEY = 'shaperbuild.thumbs.v1';
const QUALITY = { coarse: 0.1, normal: 0.03, fine: 0.01, ultra: 0.003 };

export class FileOps {
  constructor(app) {
    this.app = app;
    this.path = null;
    this.name = 'Untitled';
  }

  get native() {
    return window.native || null;
  }

  basename(p) {
    return String(p).split(/[\\/]/).pop();
  }

  stem(p) {
    return this.basename(p).replace(/\.[^.]+$/, '');
  }

  rename(name) {
    this.name = name;
    this.app.updateTitle();
  }

  // ---- unsaved changes ---------------------------------------------------

  // Returns false if the user cancelled.
  async confirmDiscard() {
    if (!this.app.doc.dirty) return true;
    const v = await modal({
      title: 'Save changes?',
      body: h('div', { text: `Do you want to save the changes to "${this.name}"?` }),
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: "Don't Save", value: 'discard' },
        { label: 'Save', value: 'save', primary: true },
      ],
    });
    if (v === 'save') return this.save();
    return v === 'discard';
  }

  async reset(name = 'Untitled') {
    const app = this.app;
    app.tools.activate('select');
    app.selection.clear();
    app.setSection({ enabled: false });
    app.doc.load(emptyState());
    app.meshCache.clear();
    app.regionCache.clear();
    await app.kernel.call('retainOnly', []).catch(() => {});
    this.path = null;
    this.name = name;
    this.clearRecovery();
    app.vp.rig.fromJSON({ az: 35 * (Math.PI / 180), el: 28 * (Math.PI / 180), dist: 220, target: [0, 0, 0], ortho: app.vp.rig.useOrtho });
    app.vp.requestRender();
    app.updateTitle();
    this.native?.setRepresentedFile('');
  }

  async newDesign() {
    if (!(await this.confirmDiscard())) return false;
    await this.reset();
    this.app.home.hide();
    return true;
  }

  async closeDesign() {
    if (!(await this.confirmDiscard())) return;
    await this.reset();
    this.app.home.show();
  }

  // ---- open ----------------------------------------------------------------

  async openDialog() {
    if (!this.native) return this.browserPick('.shaperbuild,.stl,.obj,.3mf,.step,.stp');
    const paths = await this.native.openDialog({ kind: 'open' });
    for (const p of paths) await this.openPath(p);
  }

  async importDialog() {
    if (!this.native) return this.browserPick('.stl,.obj,.3mf,.step,.stp', true);
    const paths = await this.native.openDialog({ kind: 'import', multi: true });
    for (const p of paths) await this.openPath(p, { import: true });
  }

  browserPick(accept, multiple = false) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = async () => {
      for (const f of inp.files) await this.openData(f.name, new Uint8Array(await f.arrayBuffer()), null);
    };
    inp.click();
  }

  async openPath(path, opts = {}) {
    try {
      const data = await this.native.readFile(path);
      await this.openData(this.basename(path), data, path, opts);
    } catch (err) {
      toast(`Could not open ${this.basename(path)}: ${err.message}`, { type: 'error', ms: 6000 });
    }
  }

  // Route a file by extension: projects open, everything else imports.
  async openData(name, data, path, opts = {}) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const app = this.app;
    if (ext === PROJECT_EXT) {
      if (!(await this.confirmDiscard())) return;
      return this.loadProject(data, path, name);
    }
    if (!['stl', 'obj', '3mf', 'step', 'stp'].includes(ext)) {
      toast(`Unsupported file type: .${ext}`, { type: 'error' });
      return;
    }
    // Importing from the home screen starts a new design named after the file.
    if (!app.home.el.hidden) {
      if (!(await this.confirmDiscard())) return;
      await this.reset(this.stem(name));
      app.home.hide();
    }
    void opts;
    return this.importData(name, data);
  }

  async importData(name, data) {
    const app = this.app;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const stem = this.stem(name);
    app.busy(true, `Importing ${name}…`);
    try {
      let result;
      if (ext === 'step' || ext === 'stp') {
        result = await app.kernel.call('importSTEP', { data });
      } else {
        let meshes;
        if (ext === 'stl') meshes = [{ name: stem, ...parseSTL(data) }];
        else if (ext === 'obj') meshes = [{ name: stem, ...parseOBJ(data) }];
        else meshes = (await parse3MF(data)).map((m, i) => ({ ...m, name: m.name || `${stem} ${i + 1}` }));
        const results = [];
        for (const m of meshes) {
          if (!m.indices.length) continue;
          results.push(await app.kernel.call('importMesh', { positions: m.positions, indices: m.indices }));
        }
        if (!results.length) throw new Error('The file contains no triangles');
        result = { bodies: results.flatMap((r) => r.bodies), removed: [] };
        meshes.forEach((m, i) => result.bodies[i] && (result.bodies[i].importName = m.name));
      }
      const created = app.cmd.applyResult(`Import ${name}`, result);
      app.doc.replaceSilently((d) => {
        created.forEach((id, i) => {
          const r = result.bodies[i];
          d.updateBody(id, { name: r.importName || (created.length > 1 ? `${stem} ${i + 1}` : stem) });
        });
      });
      const meshInfo = result.bodies.find((b) => b.mesh.kind === 'mesh');
      const tris = result.bodies.reduce((s, b) => s + (b.mesh.triangles || 0), 0);
      if (meshInfo) {
        const leaky = result.bodies.some((b) => b.mesh.kind === 'mesh' && !b.mesh.watertight);
        toast(`Imported ${name} · ${tris.toLocaleString()} triangles${leaky ? ' · mesh is not watertight (booleans unavailable)' : ''}`, { type: leaky ? 'info' : 'ok', ms: 4200 });
      } else toast(`Imported ${name} · ${result.bodies.length} solid bod${result.bodies.length === 1 ? 'y' : 'ies'}`, { type: 'ok' });
      this.warnUnits(result);
      setTimeout(() => app.vp.fit(), 50);
      return created;
    } catch (err) {
      toast(`Import failed: ${err.message}`, { type: 'error', ms: 6000 });
      return [];
    } finally {
      app.busy(false);
    }
  }

  warnUnits(result) {
    // Very small parts were probably modelled in metres or inches.
    let max = 0;
    for (const b of result.bodies) {
      const bb = b.mesh.bbox;
      if (bb) max = Math.max(max, ...bb.max.map((v, i) => v - bb.min[i]));
    }
    if (max > 0 && max < 2) toast('This model is very small. If it was made in inches or meters, use Scale (25.4 or 1000).', { ms: 6000 });
  }

  // ---- project files -------------------------------------------------------

  async serialize({ thumbnail: withThumb = true } = {}) {
    const app = this.app;
    const state = app.doc.state;
    const ids = [...new Set(state.bodies.map((b) => b.shapeId))];
    const raw = ids.length ? await app.kernel.call('serialize', { ids }) : {};
    const shapes = {};
    for (const [id, s] of Object.entries(raw)) {
      shapes[id] = s.kind === 'mesh' ? { kind: 'mesh', positions: toB64(new Uint8Array(s.positions.buffer, s.positions.byteOffset, s.positions.byteLength)), indices: toB64(new Uint8Array(s.indices.buffer, s.indices.byteOffset, s.indices.byteLength)) } : s;
    }
    let thumbnail = null;
    try {
      if (withThumb) thumbnail = app.vp.capture({ width: 360, height: 240 });
    } catch {}
    return {
      format: 'shaperbuild',
      version: 1,
      app: (await this.native?.info())?.version || 'dev',
      saved: new Date().toISOString(),
      camera: app.vp.rig.toJSON(),
      state: { bodies: state.bodies, sketches: state.sketches, planes: state.planes || [], seq: state.seq, units: state.units },
      shapes,
      thumbnail,
    };
  }

  async save({ as = false, path = null } = {}) {
    const app = this.app;
    let target = path || (!as && this.path);
    if (!target) {
      if (!this.native) {
        toast('Saving needs the desktop app', { type: 'error' });
        return false;
      }
      target = await this.native.saveDialog({ kind: 'project', defaultName: this.name });
      if (!target) return false;
    }
    try {
      app.busy(true, 'Saving…');
      const json = await this.serialize();
      const bytes = await gzip(new TextEncoder().encode(JSON.stringify(json)));
      await this.native.writeFile(target, bytes);
      this.path = target;
      this.name = this.stem(target);
      app.doc.markSaved();
      app.updateTitle();
      this.clearRecovery();
      await this.native.addRecent(target);
      this.native.setRepresentedFile(target);
      storeThumb(target, json.thumbnail);
      toast(`Saved ${this.basename(target)}`, { type: 'ok', ms: 1600 });
      return true;
    } catch (err) {
      toast(`Save failed: ${err.message}`, { type: 'error', ms: 6000 });
      return false;
    } finally {
      app.busy(false);
    }
  }

  async loadProject(data, path, name) {
    const app = this.app;
    app.busy(true, 'Opening…');
    try {
      const bytes = data[0] === 0x1f && data[1] === 0x8b ? await gunzip(data) : data;
      const json = JSON.parse(new TextDecoder().decode(bytes));
      if (json.format !== 'shaperbuild') throw new Error('Not a ShaperBuild design');
      await this.reset(this.stem(name));
      const items = {};
      for (const [id, s] of Object.entries(json.shapes || {})) {
        items[id] = s.kind === 'mesh' ? { kind: 'mesh', positions: new Float32Array(fromB64(s.positions).buffer), indices: new Uint32Array(fromB64(s.indices).buffer) } : s;
      }
      const res = await app.kernel.call('deserialize', { items });
      for (const [id, mesh] of Object.entries(res.meshes)) app.meshCache.set(id, mesh);
      const state = json.state;
      state.bodies = state.bodies.filter((b) => res.map[b.shapeId]).map((b) => ({ ...b, shapeId: res.map[b.shapeId] }));
      app.doc.load(state);
      if (json.camera) app.vp.rig.fromJSON(json.camera);
      app.vp.requestRender();
      this.path = path;
      this.name = this.stem(name);
      if (path) {
        await this.native?.addRecent(path);
        this.native?.setRepresentedFile(path);
        storeThumb(path, json.thumbnail);
      }
      app.home.hide();
      app.updateTitle();
    } catch (err) {
      toast(`Could not open ${name}: ${err.message}`, { type: 'error', ms: 6000 });
    } finally {
      app.busy(false);
    }
  }

  // ---- autosave / recovery ---------------------------------------------------

  // Every minute, keep a copy of unsaved work so a crash loses little.
  startAutosave(ms = 60000) {
    if (!this.native?.writeRecovery) return;
    clearInterval(this.autosaveTimer);
    this.autosaveTimer = setInterval(() => this.autosave(), ms);
  }

  async autosave() {
    const app = this.app;
    if (!app.doc.dirty || app.doc.isEmpty || this.autosaving) return;
    this.autosaving = true;
    try {
      const json = await this.serialize({ thumbnail: false });
      const bytes = await gzip(new TextEncoder().encode(JSON.stringify(json)));
      await this.native.writeRecovery(bytes, { name: this.name, path: this.path });
    } catch (err) {
      console.warn('autosave failed', err);
    } finally {
      this.autosaving = false;
    }
  }

  clearRecovery() {
    return this.native?.clearRecovery?.();
  }

  // Offer to restore work from a session that ended without saving.
  async offerRecovery() {
    const rec = await this.native?.readRecovery?.();
    if (!rec) return false;
    const when = new Date(rec.meta.saved).toLocaleString();
    const v = await modal({
      title: 'Recover unsaved work?',
      body: h('div', { text: `ShaperBuild closed before "${rec.meta.name || 'Untitled'}" was saved. A copy from ${when} is available.` }),
      buttons: [
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Recover', value: 'recover', primary: true },
      ],
    });
    if (v !== 'recover') {
      await this.clearRecovery();
      return false;
    }
    await this.loadProject(rec.data, null, `${rec.meta.name || 'Recovered'}.${PROJECT_EXT}`);
    this.path = rec.meta.path || null;
    // Keep it marked unsaved so the user saves it properly.
    this.app.doc.saved = null;
    this.app.updateTitle();
    await this.clearRecovery();
    return true;
  }

  // ---- export ----------------------------------------------------------------

  exportIds(ids) {
    const doc = this.app.doc;
    if (ids?.length) return ids;
    const sel = this.app.cmd.selectedBodyIds();
    if (sel.length) return sel;
    return doc.bodies.filter((b) => b.visible !== false).map((b) => b.id);
  }

  async exportDialog(format, ids, { path = null } = {}) {
    const app = this.app;
    const bodyIds = this.exportIds(ids);
    if (!bodyIds.length) {
      toast('There is nothing to export yet', { type: 'error' });
      return null;
    }
    const bodies = bodyIds.map((id) => app.doc.body(id));
    const defaultName = bodies.length === 1 ? bodies[0].name : this.name;
    try {
      app.busy(true, `Exporting ${format.toUpperCase()}…`);
      let bytes;
      if (format === 'step') {
        const res = await app.kernel.call('exportSTEP', { ids: bodies.map((b) => b.shapeId) });
        bytes = res.data;
        if (res.skipped) toast(`${res.skipped} mesh bod${res.skipped === 1 ? 'y was' : 'ies were'} skipped (STEP needs solids)`, { ms: 4000 });
      } else {
        const tol = QUALITY[app.settings.stlQuality] ?? QUALITY.fine;
        const { parts } = await app.kernel.call('exportMeshes', { ids: bodies.map((b) => b.shapeId), tolerance: tol });
        parts.forEach((p, i) => (p.name = bodies[i].name));
        if (format === 'stl') bytes = writeSTL(parts, { binary: app.settings.stlBinary !== false, name: this.name });
        else if (format === 'obj') bytes = writeOBJ(parts);
        else if (format === '3mf') bytes = write3MF(parts);
      }
      app.busy(false);
      let target = path;
      if (!target) {
        if (!this.native) return downloadBytes(`${defaultName}.${format}`, bytes);
        target = await this.native.saveDialog({ kind: format, defaultName });
        if (!target) return null;
      }
      await this.native.writeFile(target, bytes);
      toast(`Exported ${this.basename(target)}`, { type: 'ok' });
      return target;
    } catch (err) {
      toast(`Export failed: ${err.message}`, { type: 'error', ms: 6000 });
      return null;
    } finally {
      app.busy(false);
    }
  }

  async exportPNG({ path = null } = {}) {
    const url = this.app.vp.capture({ width: 1920, height: 1080 });
    const bytes = fromB64(url.split(',')[1]);
    let target = path;
    if (!target) {
      if (!this.native) return downloadBytes(`${this.name}.png`, bytes);
      target = await this.native.saveDialog({ kind: 'png', defaultName: this.name });
      if (!target) return null;
    }
    await this.native.writeFile(target, bytes);
    toast(`Saved image ${this.basename(target)}`, { type: 'ok' });
    return target;
  }
}

// ---- helpers ---------------------------------------------------------------

export function toB64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function gzip(bytes) {
  const cs = new CompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer());
}

export async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

function downloadBytes(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export function loadThumbs() {
  try {
    return JSON.parse(localStorage.getItem(THUMBS_KEY) || '{}');
  } catch {
    return {};
  }
}

function storeThumb(path, url) {
  if (!url) return;
  const t = loadThumbs();
  t[path] = url;
  const keys = Object.keys(t);
  while (keys.length > 16) delete t[keys.shift()];
  try {
    localStorage.setItem(THUMBS_KEY, JSON.stringify(t));
  } catch {}
}
