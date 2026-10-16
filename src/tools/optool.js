// Base for modelling tools: selection inputs ("slots"), options, a live
// preview computed by the kernel, and Apply / Cancel.
import { Tool } from './base.js';
import { LatestRunner } from '../kernel/client.js';
import { itemKey } from '../core/selection.js';
import { toast } from '../ui/overlays.js';

export class OpTool extends Tool {
  // Subclasses define:
  //   inputs(): [{ key, label, kinds, multiple, accept?(item) -> item|null, placeholder }]
  //   params(): panel fields for options
  //   async compute(preview) -> kernel result or null
  //   label: undo label
  activate(opts = {}) {
    this.opts = opts;
    this.slots = this.inputs().map((s) => ({ ...s, items: [] }));
    this.values = {};
    for (const f of this.params()) if (f.key) this.values[f.key] = f.value;
    this.active = 0;
    this.result = null;
    this.error = null;
    this.runner = new LatestRunner((args) => this.compute(args));
    this.fillFromSelection();
    this.active = Math.max(0, this.slots.findIndex((s) => !s.items.length && !s.optional));
    if (this.slots.every((s) => s.items.length || s.optional)) this.active = this.slots.length ? Math.min(this.active, this.slots.length - 1) : 0;
    this.init?.(opts);
    this.render();
    this.schedule();
  }

  deactivate() {
    this.runner.cancel();
    this.clearPreview();
    this.app.vp.overlay.clear('tool');
    this.app.selection.setHover(null);
  }

  fillFromSelection() {
    const sel = this.app.selection.list;
    for (const it of sel) {
      for (const slot of this.slots) {
        if (slot.fromSelection === false) continue;
        const acc = this.accept(slot, it);
        if (!acc) continue;
        if (!slot.multiple && slot.items.length) continue;
        if (slot.items.some((x) => itemKey(x) === itemKey(acc))) break;
        slot.items.push(acc);
        break;
      }
    }
  }

  accept(slot, item) {
    if (!slot.kinds.includes(item.kind)) {
      // Bodies can be picked through any of their faces.
      if (slot.kinds.includes('body') && (item.kind === 'face' || item.kind === 'edge')) return slot.accept ? slot.accept({ kind: 'body', bodyId: item.bodyId }) : { kind: 'body', bodyId: item.bodyId };
      return null;
    }
    return slot.accept ? slot.accept(item) : item;
  }

  get pickKinds() {
    const slot = this.slots[this.active];
    const kinds = new Set(['handle']);
    if (slot) for (const k of slot.kinds) kinds.add(k);
    if (slot && slot.kinds.includes('body')) {
      kinds.add('face');
      kinds.add('body');
    }
    return [...kinds];
  }

  slotFields() {
    return this.slots.map((s, i) => ({
      type: 'slot',
      key: s.key,
      label: s.label,
      count: s.items.length,
      summary: s.summary ? s.summary(s.items) : null,
      placeholder: s.placeholder || 'Click to select',
      active: i === this.active,
      onActivate: () => {
        this.active = i;
        this.render();
      },
      onClear: () => {
        s.items = [];
        this.active = i;
        this.render();
        this.schedule();
      },
    }));
  }

  render() {
    this.app.panel.show({
      title: this.def.label,
      icon: this.def.icon,
      hint: this.hint ? this.hint() : this.def.panelHint || '',
      fields: [...this.slotFields(), ...this.params()],
      error: this.error,
      onChange: (k, v) => {
        this.values[k] = v;
        this.onParam?.(k, v);
        this.schedule();
      },
      onOk: () => this.apply(),
      onCancel: () => this.done(),
      okEnabled: () => this.ready() && !this.error,
      okLabel: this.okLabel || 'Done',
    });
    this.app.refreshHighlights();
  }

  ready() {
    return this.slots.every((s) => s.optional || s.items.length >= (s.min || 1));
  }

  highlights() {
    const t = this.app.vp.theme;
    const out = [];
    this.slots.forEach((s, i) => {
      for (const item of s.items) out.push({ item, color: i === this.active ? t.select : t.preview });
    });
    return out;
  }

  heldShapes() {
    return this.result ? this.result.bodies.map((b) => b.id) : [];
  }

  // ---- input -----------------------------------------------------------

  onPointerMove(e) {
    if (this.dragging) return this.onDrag?.(e);
    const hit = e.pick(this.pickKinds);
    this.app.selection.setHover(hit && hit.kind !== 'handle' ? hit : null);
    this.app.vp.canvas.style.cursor = hit?.kind === 'handle' ? 'grab' : '';
  }

  onPointerDown(e) {
    const hit = e.pick(this.pickKinds);
    if (hit?.kind === 'handle' && this.onDragStart) {
      this.dragging = true;
      this.app.vp.canvas.style.cursor = 'grabbing';
      this.onDragStart(e, hit);
      return;
    }
    const slot = this.slots[this.active];
    if (!slot || !hit) return;
    const item = this.accept(slot, this.app.selectionItem(hit));
    if (!item) {
      if (slot.reject) toast(slot.reject, { type: 'error' });
      return;
    }
    const k = itemKey(item);
    const i = slot.items.findIndex((x) => itemKey(x) === k);
    if (i >= 0) slot.items.splice(i, 1);
    else if (slot.multiple) slot.items.push(item);
    else slot.items = [item];
    // Single-item slots move on to the next empty slot.
    if (!slot.multiple && slot.items.length) {
      const next = this.slots.findIndex((s, j) => j > this.active && !s.items.length);
      if (next >= 0) this.active = next;
    }
    this.render();
    this.schedule();
  }

  onPointerUp(e) {
    if (this.dragging) {
      this.dragging = false;
      this.app.vp.canvas.style.cursor = '';
      this.onDragEnd?.(e);
    }
  }

  onKeyDown(e) {
    if (e.key === 'Escape') {
      this.done();
      return true;
    }
    if (e.key === 'Enter') {
      this.apply();
      return true;
    }
    return false;
  }

  // ---- preview / apply -------------------------------------------------

  schedule() {
    clearTimeout(this.timer);
    this.updateHandles?.();
    this.app.panel.refreshOk();
    if (!this.ready()) {
      this.clearPreview();
      this.setError(null);
      return;
    }
    this.timer = setTimeout(() => this.runPreview(), 30);
  }

  async runPreview() {
    const key = JSON.stringify({ s: this.slots.map((s) => s.items.map(itemKey)), v: this.values });
    const res = await this.runner.request(key);
    if (res.stale) {
      if (res.value) this.app.kernel.call('release', { ids: res.value.bodies.map((b) => b.id) }).catch(() => {});
      return;
    }
    if (res.error) {
      this.clearPreview();
      this.setError(res.error.message);
      return;
    }
    this.setError(null);
    this.showPreview(res.value, key);
  }

  setError(msg) {
    if (msg === this.error) return;
    this.error = msg;
    this.app.panel.update({ error: msg });
  }

  showPreview(result, key) {
    this.clearPreview();
    if (!result) return;
    this.result = result;
    this.resultKey = key;
    this.app.showResultPreview(result, this.previewStyle ? this.previewStyle() : {});
  }

  clearPreview() {
    if (this.result) {
      const ids = this.result.bodies.map((b) => b.id);
      if (!this.result.committed) this.app.kernel.call('release', { ids }).catch(() => {});
    }
    this.result = null;
    this.app.clearResultPreview();
  }

  async apply() {
    if (!this.ready()) {
      toast('Select what the tool needs first', { type: 'error' });
      return;
    }
    clearTimeout(this.timer);
    const key = JSON.stringify({ s: this.slots.map((s) => s.items.map(itemKey)), v: this.values });
    let result = this.result && this.resultKey === key ? this.result : null;
    if (!result) {
      try {
        this.app.busy(true, `${this.def.label}…`);
        result = await this.compute(key);
      } catch (err) {
        this.setError(err.message);
        toast(err.message, { type: 'error', ms: 5000 });
        return;
      } finally {
        this.app.busy(false);
      }
    }
    if (!result) return;
    result.committed = true;
    this.result = result;
    this.app.clearResultPreview();
    this.app.cmd.applyResult(this.label || this.def.label, result, this.applyOptions ? this.applyOptions() : {});
    this.result = null;
    this.afterApply ? this.afterApply() : this.done();
  }

  // Items of slot `key`.
  items(key) {
    return this.slots.find((s) => s.key === key)?.items || [];
  }
}
