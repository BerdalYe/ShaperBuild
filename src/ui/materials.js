// Visualization panel: materials and colours for the selected bodies (or
// every body when nothing is selected), their finish, decals, the light,
// the camera and screenshots.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { MATERIALS } from '../view/bodyview.js';
import { LIGHTING } from '../view/viewport.js';
import { BODY_COLORS } from '../view/theme.js';
import { toast } from './overlays.js';
import { t, tn, localNumber } from '../core/i18n.js';

// CSS preview of a finish in its colour.
function swatch(m, color) {
  const c = color || m.color || (m.metalness ? '#c9ced4' : '#aab4c0');
  if (m.transmission) return `radial-gradient(circle at 35% 30%, rgba(255,255,255,.95) 0, ${c}88 30%, ${c}cc 100%)`;
  if (m.metalness >= 0.8) return `linear-gradient(135deg, #fff 0%, ${c} 35%, #f3f3f3 ${m.roughness < 0.1 ? 50 : 58}%, ${c} 72%, #3a3d42 100%)`;
  const shine = Math.round((1 - m.roughness) * 22 + (m.clearcoat ? 8 : 0));
  return `radial-gradient(circle at 34% 28%, #fff 0, ${c} ${Math.max(6, shine)}%, ${c} 55%, #24272c 130%)`;
}

const fmt = (v, digits = 2) => localNumber(String(+v.toFixed(digits)));

export class MaterialsPanel {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.query = '';
    this.openDecal = null;
    app.selection.on('change', () => this.visible && this.render());
    app.doc.on('change', () => this.visible && this.render());
  }

  get visible() {
    return !this.el.hidden;
  }

  show(on) {
    this.el.hidden = !on;
    if (on) this.render();
  }

  targets() {
    const app = this.app;
    const sel = app.cmd.selectedBodyIds();
    return sel.length ? sel : app.doc.bodies.filter((b) => b.visible !== false).map((b) => b.id);
  }

  render() {
    const app = this.app;
    const searching = this.el.contains(document.activeElement) && document.activeElement.classList.contains('mp-search');
    const scroll = this.el.scrollTop;
    clear(this.el);
    const sel = app.cmd.selectedBodyIds();
    const ids = this.targets();
    const first = ids.length ? app.doc.body(ids[0]) : null;
    const current = first?.material || 'plastic';
    this.el.append(
      h(
        'div.mp-head',
        h('b', { text: 'Materials' }),
        h('small', { text: sel.length ? tn(sel.length, 'For the selected body', 'For the {n} selected bodies') : 'For all bodies — click a body to change just that one' }),
      ),
    );

    // Materials by category, with search.
    const search = h('input.mp-search', { type: 'search', placeholder: 'Search materials', value: this.query, spellcheck: false });
    search.addEventListener('input', () => {
      this.query = search.value;
      this.render();
    });
    this.el.append(search);
    const q = this.query.trim().toLowerCase();
    const cats = new Map();
    for (const [key, m] of Object.entries(MATERIALS)) {
      if (q && !`${t(m.label)} ${t(m.cat)} ${m.label} ${m.cat}`.toLowerCase().includes(q)) continue;
      if (!cats.has(m.cat)) cats.set(m.cat, []);
      cats.get(m.cat).push([key, m]);
    }
    if (!cats.size) this.el.append(h('div.mp-tip', { text: 'No material has that name.' }));
    for (const [cat, list] of cats) {
      const grid = h('div.mp-grid');
      for (const [key, m] of list) {
        const b = h(`button.mp-mat${key === current ? '.on' : ''}`, h('span.mp-ball', { style: { background: swatch(m, m.color ? null : first?.color) } }), h('span', { text: m.label }));
        b.dataset.material = key;
        b.addEventListener('click', () => {
          const tg = this.targets();
          if (!tg.length) return toast('There are no bodies to give a material to', { type: 'error' });
          app.doc.apply('Material', (d) =>
            tg.forEach((id) => {
              const patch = { material: key };
              // Metals and the like bring their colour.
              if (m.color) patch.color = m.color;
              d.updateBody(id, patch);
            }),
          );
        });
        grid.append(b);
      }
      this.el.append(h('div.mp-sub', { text: cat }), grid);
    }

    // Colour.
    const colors = h('div.mp-colors');
    for (const c of BODY_COLORS) {
      const b = h('button.mp-color', { title: c, style: { background: c } });
      b.addEventListener('click', () => {
        const tg = this.targets();
        if (tg.length) app.cmd.setColor(tg, c);
      });
      colors.append(b);
    }
    const custom = h('input.mp-custom', { type: 'color', value: first?.color || '#c4ccd6', title: 'Any colour' });
    custom.addEventListener('change', () => {
      const tg = this.targets();
      if (tg.length) app.cmd.setColor(tg, custom.value);
    });
    const hex = h('input.mp-hex', { type: 'text', value: first?.color || '#c4ccd6', spellcheck: false, title: 'Colour as hex (#rrggbb)' });
    hex.addEventListener('change', () => {
      const v = hex.value.trim();
      const tg = this.targets();
      if (!/^#?[0-9a-f]{6}$/i.test(v)) return toast('Type a colour like #3a7bd5', { type: 'error' });
      if (tg.length) app.cmd.setColor(tg, v.startsWith('#') ? v : `#${v}`);
    });
    colors.append(custom);
    this.el.append(h('div.mp-sub', { text: 'Colour' }), colors, h('div.mp-hexrow', hex));

    // Finish: the material's values, changed for these bodies.
    if (first) {
      const look = { ...(MATERIALS[current] || MATERIALS.plastic), ...(first.look || {}) };
      const finish = h('div.mp-props');
      const prop = (key, label, min, max, step, value) =>
        this.slider(label, value, min, max, step, (v) => this.previewLook(ids, key, v), (v) => app.cmd.setLook(this.targets(), { [key]: v }), (v) => fmt(v));
      finish.append(
        prop('roughness', 'Roughness', 0, 1, 0.01, look.roughness),
        prop('opacity', 'Opacity', 0.05, 1, 0.01, look.opacity ?? 1),
        prop('transmission', 'See-through (glass)', 0, 1, 0.01, look.transmission || 0),
      );
      if (look.transmission) finish.append(prop('ior', 'Refraction (IOR)', 1, 2.4, 0.01, look.ior || 1.5));
      if (ids.some((id) => app.doc.body(id)?.look)) {
        const reset = h('button.btn.small', { text: 'Reset finish' });
        reset.addEventListener('click', () => app.cmd.setLook(this.targets(), null));
        finish.append(reset);
      }
      this.el.append(h('div.mp-sub', { text: 'Finish' }), finish);
    }

    this.el.append(this.decalsSection(), this.lightSection(), this.cameraSection());
    const shot = h('button.btn.primary.mp-shot', { html: `${icon('camera')}<span>${t('Screenshot…')}</span>` });
    shot.dataset.action = 'screenshot';
    shot.addEventListener('click', () => app.dialogs.screenshot());
    this.el.append(h('div.mp-tip', { text: 'Orbit to find a nice angle, then take a screenshot. Switch back to Modeling at the top to keep editing.' }), shot);
    this.el.scrollTop = scroll;
    if (searching) {
      search.focus();
      search.setSelectionRange(search.value.length, search.value.length);
    }
  }

  // A labelled range slider: onInput while dragging, onChange when let go.
  slider(label, value, min, max, step, onInput, onChange, show = (v) => fmt(v)) {
    const out = h('span.mp-val', { str: show(value) });
    const r = h('input.mp-range', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => {
      out.textContent = show(+r.value);
      onInput?.(+r.value);
    });
    r.addEventListener('change', () => onChange?.(+r.value));
    return h('label.mp-slider', h('span.mp-slabel', h('span', { text: label }), out), r);
  }

  // Show a finish change at once; it is stored when the slider is let go.
  previewLook(ids, key, v) {
    for (const id of ids) {
      const m = this.app.vp.bodyViews.get(id)?.material;
      if (!m) continue;
      if (key === 'opacity') {
        m.opacity = v;
        m.transparent = v < 1;
        m.depthWrite = v >= 1;
      } else {
        m[key] = v;
        if (key === 'transmission' && !m.thickness) m.thickness = 4;
      }
      m.needsUpdate = true;
    }
    this.app.vp.requestRender();
  }

  decalsSection() {
    const app = this.app;
    const box = h('div.mp-decals');
    const add = h('button.btn.small', { html: `${icon('image')}<span>${t('Add a picture…')}</span>` });
    add.dataset.action = 'add-decal';
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', hidden: true });
    add.addEventListener('click', () => {
      if (!app.doc.bodies.length) return toast('Add a body first', { type: 'error' });
      file.click();
    });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const img = await loadPicture(f);
        app.tools.activate('decal', { force: true, ...img, name: f.name.replace(/\.[^.]+$/, '') });
      } catch {
        toast('That picture could not be read', { type: 'error' });
      }
    });
    box.append(add, file);
    for (const dc of app.doc.decals) {
      const open = this.openDecal === dc.id;
      const del = h('button.item-btn', { html: icon('trash'), title: 'Delete decal' });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        app.cmd.deleteDecal(dc.id);
      });
      const row = h(`div.mp-decal${open ? '.on' : ''}`, h('img', { src: dc.src, alt: '' }), h('span.mp-dname', { str: dc.name || t('Decal') }), del);
      row.dataset.decal = dc.id;
      row.addEventListener('click', () => {
        this.openDecal = open ? null : dc.id;
        this.render();
      });
      box.append(row);
      if (!open) continue;
      const set = (patch, label) => app.cmd.updateDecal(dc.id, patch, label);
      const live = (patch) => {
        const view = app.vp.decalViews.get(dc.id);
        if (patch.opacity !== undefined && view) {
          view.material.opacity = patch.opacity;
          return app.vp.requestRender();
        }
        if (view) view.update({ ...dc, ...patch }, app.vp.bodyViews.get(dc.bodyId)?.mesh || null);
        app.vp.requestRender();
      };
      const span = Math.max(10, (dc.size || 20) * 4);
      const wrap = h('input', { type: 'checkbox', checked: !!dc.wrap });
      wrap.addEventListener('change', () => set({ wrap: wrap.checked }));
      box.append(
        h(
          'div.mp-props',
          this.slider('Size', dc.size, 1, Math.max(span, 200), 0.5, (v) => live({ size: v }), (v) => set({ size: v }, 'Decal size'), (v) => `${fmt(v, 1)} ${app.units}`),
          this.slider('Rotation', dc.rotation || 0, -180, 180, 1, (v) => live({ rotation: v }), (v) => set({ rotation: v }, 'Decal rotation'), (v) => `${fmt(v, 0)}°`),
          this.slider('Opacity', dc.opacity ?? 1, 0.05, 1, 0.01, (v) => live({ opacity: v }), (v) => set({ opacity: v }, 'Decal opacity')),
          h('label.mp-check', wrap, h('span', { text: 'Wrap round edges' })),
        ),
      );
    }
    return h('div', h('div.mp-sub', { text: 'Decals' }), box);
  }

  lightSection() {
    const app = this.app;
    const l = { ...LIGHTING, ...(app.settings.lighting || {}) };
    const apply = (patch) => app.vp.setLighting({ ...l, ...(app.settings.lighting || {}), ...patch });
    const keep = (patch) => {
      app.settings.lighting = { ...l, ...(app.settings.lighting || {}), ...patch };
      app.saveSettings();
      apply({});
    };
    const ground = h('input', { type: 'checkbox', checked: l.ground !== false });
    ground.addEventListener('change', () => keep({ ground: ground.checked }));
    const reset = h('button.btn.small', { text: 'Reset light' });
    reset.addEventListener('click', () => {
      app.settings.lighting = null;
      app.saveSettings();
      app.vp.setLighting({});
      this.render();
    });
    return h(
      'div',
      h('div.mp-sub', { text: 'Light' }),
      h(
        'div.mp-props',
        this.slider('Light direction', l.rotation, 0, 360, 1, (v) => apply({ rotation: v }), (v) => keep({ rotation: v }), (v) => `${fmt(v, 0)}°`),
        this.slider('Sun height', l.elevation, 5, 90, 1, (v) => apply({ elevation: v }), (v) => keep({ elevation: v }), (v) => `${fmt(v, 0)}°`),
        this.slider('Brightness', l.intensity, 0.2, 2.5, 0.05, (v) => apply({ intensity: v }), (v) => keep({ intensity: v })),
        h('label.mp-check', ground, h('span', { text: 'Shadow on the ground' })),
        reset,
      ),
    );
  }

  cameraSection() {
    const app = this.app;
    const fov = app.settings.fov || 35;
    return h(
      'div',
      h('div.mp-sub', { text: 'Camera' }),
      h(
        'div.mp-props',
        this.slider('Field of view', fov, 15, 90, 1, (v) => app.vp.setFov(v), (v) => {
          app.settings.fov = v;
          app.saveSettings();
        }, (v) => `${fmt(v, 0)}°`),
      ),
    );
  }
}

// Read a picture file and make it at most 1024 pixels wide or high (kept
// in the design file).
export function loadPicture(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve({ src: c.toDataURL('image/png'), aspect: img.height / img.width });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}
