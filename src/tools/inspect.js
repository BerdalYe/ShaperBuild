// Measure and section view.
import { Tool } from './base.js';
import { formatLength, formatArea, formatVolume, formatAngle } from '../core/units.js';
import { itemKey } from '../core/selection.js';
import { toast } from '../ui/overlays.js';
import { t, language } from '../core/i18n.js';
import { escapeHtml } from '../ui/dom.js';

export class MeasureTool extends Tool {
  get pickKinds() {
    return ['vertex', 'spoint', 'edge', 'curve', 'face', 'body'];
  }

  activate() {
    this.items = this.app.selection.list.filter((it) => ['vertex', 'edge', 'face', 'body'].includes(it.kind)).slice(0, 2);
    this.result = null;
    this.setHint('Click one item for its size, or two items for the distance and angle between them');
    this.measure();
  }

  deactivate() {
    this.app.vp.overlay.clear('tool');
  }

  highlights() {
    return this.items.map((item) => ({ item, color: this.app.vp.theme.select }));
  }

  onPointerMove(e) {
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit);
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) {
      this.items = [];
    } else {
      const item = this.app.selectionItem(hit);
      if (hit.kind === 'vertex' || hit.kind === 'spoint') item.point = hit.kind === 'spoint' ? hit.world : hit.point;
      const k = itemKey(item);
      const i = this.items.findIndex((x) => itemKey(x) === k);
      if (i >= 0) this.items.splice(i, 1);
      else {
        if (this.items.length >= 2) this.items = [];
        this.items.push(item);
      }
    }
    this.app.refreshHighlights();
    this.measure();
  }

  kernelItem(it) {
    const app = this.app;
    if (it.kind === 'vertex' || it.kind === 'spoint') return { kind: 'point', point: it.point };
    if (it.kind === 'curve') return { kind: 'unknown' };
    const body = app.doc.body(it.bodyId);
    if (!body) return { kind: 'unknown' };
    return { kind: it.kind, id: body.shapeId, index: it.index };
  }

  async measure() {
    const app = this.app;
    const ov = app.vp.overlay;
    ov.clear('tool');
    const u = app.units;
    const rows = [];
    if (this.items.length) {
      try {
        const res = await app.kernel.call('measure', { items: this.items.map((it) => this.kernelItem(it)) });
        for (const r of res.items) rows.push(...describe(r, u));
        if (res.pair) {
          if (res.pair.distance !== undefined) {
            rows.push({ label: 'Distance', value: formatLength(res.pair.distance, u), strong: true });
            const { p1, p2 } = res.pair;
            if (res.pair.distance > 1e-9) {
              ov.lines('tool-dist', [[p1, p2]], { color: app.vp.theme.inference, width: 2, depthTest: false });
              ov.dots('tool-ends', [p1, p2], { color: app.vp.theme.inference, size: 8 });
              const d = p1.map((v, i) => p2[i] - v);
              rows.push({ label: 'ΔX / ΔY / ΔZ', value: d.map((v) => formatLength(Math.abs(v), u, { suffix: false })).join(' / ') });
            }
            ov.label('tool-dlabel', p1.map((v, i) => (v + p2[i]) / 2), formatLength(res.pair.distance, u), { className: 'accent' });
          }
          if (res.pair.angle !== undefined) rows.push({ label: 'Angle', value: formatAngle(res.pair.angle), strong: true });
        }
      } catch (err) {
        rows.push({ label: 'Error', value: err.message });
      }
    }
    this.app.panel.show({
      title: 'Measure',
      icon: 'measure',
      hint: rows.length ? '' : 'Click a face, edge, point or body. Click a second one to measure between them.',
      fields: rows.map((r) => ({ type: 'info', text: `<div style="display:flex;justify-content:space-between;gap:12px"><span>${t(r.label)}</span><b style="color:var(--text);font-weight:${r.strong ? 700 : 500}">${escapeHtml(t(String(r.value)))}</b></div>` })),
      onCancel: () => this.done(),
      buttons: this.items.length ? [{ label: 'Clear', action: () => ((this.items = []), this.app.refreshHighlights(), this.measure()) }] : [],
    });
  }

  onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.done();
      return true;
    }
    return false;
  }
}

function describe(r, u) {
  const out = [];
  switch (r.kind) {
    case 'body':
      out.push({ label: r.mesh ? 'Mesh volume' : 'Volume', value: formatVolume(r.volume, u), strong: true }, { label: 'Surface area', value: formatArea(r.area, u) });
      if (r.bbox) {
        const s = r.bbox.max.map((v, i) => v - r.bbox.min[i]);
        out.push({ label: 'Size (X × Y × Z)', value: s.map((v) => formatLength(v, u, { suffix: false })).join(' × ') + ' ' + u });
      }
      if (r.mesh) out.push({ label: 'Triangles', value: r.triangles.toLocaleString(language() === 'nb' ? 'nb-NO' : 'en-US') });
      break;
    case 'face':
      out.push({ label: `${t('Face')} (${t(r.type)})`, value: formatArea(r.area, u), strong: true });
      if (r.radius) out.push({ label: 'Radius', value: formatLength(r.radius, u) });
      break;
    case 'edge':
      out.push({ label: `${t('Edge')} (${t(r.type)})`, value: formatLength(r.length, u), strong: true });
      if (r.radius) out.push({ label: 'Radius / diameter', value: `${formatLength(r.radius, u)} / ${formatLength(r.radius * 2, u)}` });
      break;
    case 'point':
      out.push({ label: 'Point', value: r.point.map((v) => formatLength(v, u, { suffix: false })).join(', ') });
      break;
    default:
  }
  return out;
}

export class SectionTool extends Tool {
  get pickKinds() {
    return ['face'];
  }

  activate() {
    const s = this.app.section;
    this.state = { axis: s.axis || 'z', offset: s.offset ?? null, flip: !!s.flip, face: null };
    if (this.state.offset === null) {
      const box = this.app.vp.contentBox();
      this.state.offset = box.isEmpty() ? 0 : (box.min.z + box.max.z) / 2;
      if (this.state.axis !== 'z') this.state.offset = 0;
    }
    this.apply();
    this.render();
    this.setHint('Choose a plane and move it with the offset · click a flat face to cut along it');
  }

  render() {
    const st = this.state;
    this.app.panel.show({
      title: 'Section view',
      icon: 'section',
      hint: 'Cuts through the design so you can see inside. It stays on until you turn it off.',
      fields: [
        {
          type: 'choice',
          key: 'axis',
          label: 'Plane',
          value: st.face ? 'face' : st.axis,
          options: [
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
            { value: 'z', label: 'Z' },
            ...(st.face ? [{ value: 'face', label: 'Face' }] : []),
          ],
        },
        { type: 'length', key: 'offset', label: 'Offset', value: st.offset },
        { type: 'toggle', key: 'flip', label: 'Flip side', value: st.flip },
      ],
      onChange: (k, v) => {
        if (k === 'axis') {
          if (v !== 'face') st.face = null;
          st.axis = v;
          const box = this.app.vp.contentBox();
          if (!box.isEmpty() && v !== 'face') st.offset = (box.min[v] + box.max[v]) / 2;
          this.render();
        } else st[k] = v;
        this.apply();
      },
      onOk: () => this.done(),
      okLabel: 'Keep',
      onCancel: () => {
        this.app.setSection({ enabled: false });
        this.done();
      },
      buttons: [],
    });
  }

  apply() {
    const st = this.state;
    let normal;
    let origin;
    if (st.face) {
      normal = st.face.normal;
      origin = st.face.center.map((c, i) => c + normal[i] * st.offset);
    } else {
      normal = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[st.axis];
      origin = normal.map((n) => n * st.offset);
    }
    if (st.flip) normal = normal.map((n) => -n);
    this.app.setSection({ enabled: true, axis: st.axis, offset: st.offset, flip: st.flip, origin, normal });
  }

  onPointerMove(e) {
    this.app.selection.setHover(e.pick(this.pickKinds));
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (!hit) return;
    const info = this.app.faceInfo(hit.bodyId, hit.index);
    if (info?.type !== 'plane') return toast('Pick a flat face', { type: 'error' });
    this.state.face = { center: info.center, normal: info.normal.map((n) => -n) };
    this.state.offset = 0;
    this.render();
    this.apply();
  }

  onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Enter') {
      this.done();
      return true;
    }
    return false;
  }
}
