// Opening, saving, importing and exporting.
import { parseSTL, writeSTL, parseOBJ, writeOBJ, parse3MF, write3MF } from './core/formats.js';
import { toast, modal } from './ui/overlays.js';
import { h } from './ui/dom.js';
import { t, tn, language } from './core/i18n.js';
import { emptyState } from './core/doc.js';
import { parseDXF, writeDXF } from './core/dxf.js';
import { GROUND } from './core/plane.js';

export const PROJECT_EXT = 'shaperbuild';
const THUMBS_KEY = 'shaperbuild.thumbs.v1';
const QUALITY = { coarse: 0.1, normal: 0.03, fine: 0.01, ultra: 0.003 };

export class FileOps {
  constructor(app) {
    this.app = app;
    this.path = null;
    this.name = t('Untitled');
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
      body: h('div', { text: t('Do you want to save the changes to "{name}"?', { name: this.name }) }),
      buttons: [
        { label: 'Cancel', value: 'cancel' },
        { label: "Don't Save", value: 'discard' },
        { label: 'Save', value: 'save', primary: true },
      ],
    });
    if (v === 'save') return this.save();
    return v === 'discard';
  }

  async reset(name = t('Untitled')) {
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
    if (!this.native) return this.browserPick('.shaperbuild,.stl,.obj,.3mf,.step,.stp,.dxf,.png,.jpg,.jpeg,.webp');
    const paths = await this.native.openDialog({ kind: 'open' });
    for (const p of paths) await this.openPath(p);
  }

  async importDialog() {
    if (!this.native) return this.browserPick('.stl,.obj,.3mf,.step,.stp,.dxf,.png,.jpg,.jpeg,.webp', true);
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
      toast(t('Could not open {name}: {error}', { name: this.basename(path), error: t(err.message) }), { type: 'error', ms: 6000 });
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
    if (!['stl', 'obj', '3mf', 'step', 'stp', 'dxf', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      toast(t('Unsupported file type: .{ext}', { ext }), { type: 'error' });
      return;
    }
    // Importing from the home screen starts a new design named after the file.
    if (!app.home.el.hidden) {
      if (!(await this.confirmDiscard())) return;
      await this.reset(this.stem(name));
      app.home.hide();
    }
    void opts;
    if (ext === 'dxf') return this.importDXF(name, data);
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return this.importImage(name, data);
    return this.importData(name, data);
  }

  // A DXF drawing becomes a new sketch on the grid.
  importDXF(name, data) {
    const app = this.app;
    try {
      const { entities, skipped } = parseDXF(new TextDecoder().decode(data));
      if (!entities.length) throw new Error('no lines, arcs or circles found');
      const id = app.cmd.addSketch(GROUND, entities, { name: this.stem(name), label: `Import ${name}` });
      app.selection.set([{ kind: 'sketch', sketchId: id }]);
      const extra = Object.entries(skipped).map(([type, c]) => `${c} ${type.toLowerCase()}`);
      toast(t('Imported {name} · {n} curves{skipped}. Click its closed shapes to extrude them.', { name, n: entities.length, skipped: extra.length ? ` (${t('skipped')}: ${extra.join(', ')})` : '' }), { type: 'ok', ms: 5000 });
      setTimeout(() => app.vp.fit(app.selectionBox()), 80);
      return id;
    } catch (err) {
      toast(t('Import failed: {error}', { error: t(err.message) }), { type: 'error', ms: 6000 });
      return null;
    }
  }

  // A picture to trace: placed on the selected flat face / plane, or the grid.
  async importImage(name, data) {
    const app = this.app;
    try {
      const ext = (name.split('.').pop() || '').toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      let src = `data:${mime};base64,${toB64(data)}`;
      const img = new Image();
      img.src = src;
      await img.decode();
      let { naturalWidth: w, naturalHeight: hgt } = img;
      // Keep designs small: big photos are scaled down to 2048 pixels.
      const max = 2048;
      if (Math.max(w, hgt) > max) {
        const k = max / Math.max(w, hgt);
        const c = document.createElement('canvas');
        c.width = Math.round(w * k);
        c.height = Math.round(hgt * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        src = c.toDataURL(mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
        w = c.width;
        hgt = c.height;
      }
      let plane = GROUND;
      const it = app.selection.list[0];
      if (it?.kind === 'plane') plane = app.doc.plane(it.planeId).plane;
      else if (it?.kind === 'face') {
        const info = app.faceInfo(it.bodyId, it.index);
        if (info?.type === 'plane') plane = { origin: info.center, normal: info.normal, xDir: info.xDir };
      }
      const width = 100;
      app.cmd.addImage({ src, plane, width, height: (width * hgt) / w, name: this.stem(name) });
      toast('Image added. Type its real width in the bar at the bottom, then trace it with the sketch tools.', { type: 'ok', ms: 5000 });
      setTimeout(() => app.vp.fit(app.selectionBox()), 80);
    } catch (err) {
      toast(t('Could not add the image: {error}', { error: t(err.message) }), { type: 'error', ms: 5000 });
    }
  }

  // Sketches as DXF: the selected ones, or every visible sketch.
  async exportDXF({ path = null } = {}) {
    const app = this.app;
    const ids = [...new Set(app.selection.list.map((it) => it.sketchId).filter(Boolean))];
    const sketches = (ids.length ? ids.map((id) => app.doc.sketch(id)) : app.doc.sketches.filter((s) => s.visible !== false)).filter(Boolean);
    if (!sketches.length) {
      toast('Draw or select a sketch first — DXF holds 2D sketches.', { type: 'error', ms: 3500 });
      return null;
    }
    const bytes = new TextEncoder().encode(writeDXF(sketches));
    const defaultName = sketches.length === 1 ? sketches[0].name : this.name;
    let target = path;
    if (!target) {
      if (!this.native) return downloadBytes(`${defaultName}.dxf`, bytes);
      target = await this.native.saveDialog({ kind: 'dxf', defaultName });
      if (!target) return null;
    }
    await this.native.writeFile(target, bytes);
    const planes = new Set(sketches.map((s) => JSON.stringify([s.plane.normal, s.plane.origin])));
    toast(t('Exported {name}', { name: this.basename(target) }) + (planes.size > 1 ? ` — ${t('sketches on different planes are drawn on top of each other')}` : ''), { type: 'ok', ms: 3500 });
    return target;
  }

  async importData(name, data) {
    const app = this.app;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const stem = this.stem(name);
    app.busy(true, t('Importing {name}…', { name }));
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
        toast(t('Imported {name} · {n} triangles', { name, n: tris.toLocaleString() }) + (leaky ? ` · ${t('mesh is not watertight (booleans unavailable)')}` : ''), { type: leaky ? 'info' : 'ok', ms: 4200 });
      } else toast(tn(result.bodies.length, 'Imported {name} · 1 solid body', 'Imported {name} · {n} solid bodies', { name }), { type: 'ok' });
      this.warnUnits(result);
      setTimeout(() => app.vp.fit(), 50);
      return created;
    } catch (err) {
      toast(t('Import failed: {error}', { error: t(err.message) }), { type: 'error', ms: 6000 });
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
    // Current bodies plus the shapes the history starts from (imports).
    const base = (state.history || []).filter((f) => f.op === 'base').flatMap((f) => f.bodies.map((x) => x.s));
    const ids = [...new Set([...state.bodies.map((b) => b.shapeId), ...base])];
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
      state: { bodies: state.bodies, sketches: state.sketches, planes: state.planes || [], axes: state.axes || [], images: state.images || [], folders: state.folders || [], history: state.history || [], variables: state.variables || [], seq: state.seq, units: state.units },
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
      toast(t('Saved {name}', { name: this.basename(target) }), { type: 'ok', ms: 1600 });
      return true;
    } catch (err) {
      toast(t('Save failed: {error}', { error: t(err.message) }), { type: 'error', ms: 6000 });
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
      state.history = (state.history || []).map((f) => (f.op === 'base' ? { ...f, bodies: f.bodies.filter((x) => res.map[x.s]).map((x) => ({ ...x, s: res.map[x.s] })) } : f));
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
      toast(t('Could not open {name}: {error}', { name, error: t(err.message) }), { type: 'error', ms: 6000 });
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

  // `keep`: a copy for a restart (language change), restored without asking.
  async autosave({ keep = false } = {}) {
    const app = this.app;
    if ((!keep && !app.doc.dirty) || app.doc.isEmpty || this.autosaving || !this.native?.writeRecovery) return false;
    this.autosaving = true;
    try {
      const json = await this.serialize({ thumbnail: false });
      const bytes = await gzip(new TextEncoder().encode(JSON.stringify(json)));
      await this.native.writeRecovery(bytes, { name: this.name, path: this.path, ...(keep ? { restore: true, dirty: app.doc.dirty, untitled: this.name === t('Untitled') } : {}) });
      return true;
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
    if (rec.meta.restore) {
      // Kept for a restart: open it again as it was.
      await this.loadProject(rec.data, null, `${rec.meta.name || t('Recovered')}.${PROJECT_EXT}`);
      this.path = rec.meta.path || null;
      // "Untitled" follows the new language.
      this.name = rec.meta.untitled ? t('Untitled') : rec.meta.name || this.name;
      if (rec.meta.dirty) this.app.doc.saved = null;
      else this.app.doc.markSaved();
      this.app.updateTitle();
      await this.clearRecovery();
      return true;
    }
    const when = new Date(rec.meta.saved).toLocaleString(language() === 'nb' ? 'nb-NO' : undefined);
    const v = await modal({
      title: 'Recover unsaved work?',
      body: h('div', { text: t('ShaperBuild closed before "{name}" was saved. A copy from {when} is available.', { name: rec.meta.name || t('Untitled'), when }) }),
      buttons: [
        { label: 'Discard', value: 'discard', danger: true },
        { label: 'Recover', value: 'recover', primary: true },
      ],
    });
    if (v !== 'recover') {
      await this.clearRecovery();
      return false;
    }
    await this.loadProject(rec.data, null, `${rec.meta.name || t('Recovered')}.${PROJECT_EXT}`);
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
      app.busy(true, t('Exporting {format}…', { format: format.toUpperCase() }));
      let bytes;
      if (format === 'step') {
        const res = await app.kernel.call('exportSTEP', { ids: bodies.map((b) => b.shapeId) });
        bytes = res.data;
        if (res.skipped) toast(tn(res.skipped, '1 mesh body was skipped (STEP needs solids)', '{n} mesh bodies were skipped (STEP needs solids)'), { ms: 4000 });
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
      toast(t('Exported {name}', { name: this.basename(target) }), { type: 'ok' });
      return target;
    } catch (err) {
      toast(t('Export failed: {error}', { error: t(err.message) }), { type: 'error', ms: 6000 });
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
    toast(t('Saved image {name}', { name: this.basename(target) }), { type: 'ok' });
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
