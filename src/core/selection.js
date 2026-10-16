// Selected and hovered items.
//
// Item shapes:
//   { kind: 'body', bodyId }
//   { kind: 'face' | 'edge' | 'vertex', bodyId, index }
//   { kind: 'region', sketchId, index }
//   { kind: 'curve', sketchId, entityId }
//   { kind: 'spoint', sketchId, point }
//   { kind: 'sketch', sketchId }
import { Emitter } from './events.js';

export function itemKey(it) {
  if (!it) return '';
  switch (it.kind) {
    case 'body':
      return `body:${it.bodyId}`;
    case 'face':
    case 'edge':
    case 'vertex':
      return `${it.kind}:${it.bodyId}:${it.index}`;
    case 'region':
      return `region:${it.sketchId}:${it.index}`;
    case 'curve':
      return `curve:${it.sketchId}:${it.entityId}`;
    case 'spoint':
      return `spoint:${it.sketchId}:${it.point[0].toFixed(6)},${it.point[1].toFixed(6)}`;
    case 'sketch':
      return `sketch:${it.sketchId}`;
    case 'handle':
      return `handle:${it.key}`;
    case 'constraint':
      return `constraint:${it.sketchId}:${it.cid}`;
    default:
      return JSON.stringify(it);
  }
}

export class Selection extends Emitter {
  constructor() {
    super();
    this.items = new Map();
    this.hover = null;
  }

  get list() {
    return [...this.items.values()];
  }

  get size() {
    return this.items.size;
  }

  has(it) {
    return this.items.has(itemKey(it));
  }

  ofKind(...kinds) {
    return this.list.filter((it) => kinds.includes(it.kind));
  }

  set(items) {
    this.items = new Map(items.map((it) => [itemKey(it), clean(it)]));
    this.emit('change');
  }

  add(it) {
    this.items.set(itemKey(it), clean(it));
    this.emit('change');
  }

  toggle(it) {
    const k = itemKey(it);
    if (this.items.has(k)) this.items.delete(k);
    else this.items.set(k, clean(it));
    this.emit('change');
  }

  remove(it) {
    if (this.items.delete(itemKey(it))) this.emit('change');
  }

  clear() {
    if (!this.items.size) return;
    this.items.clear();
    this.emit('change');
  }

  setHover(it) {
    const k = itemKey(it);
    if (k === itemKey(this.hover)) return;
    this.hover = it ? clean(it) : null;
    this.emit('hover');
  }

  // Drop items that no longer exist in the document.
  prune(isValid) {
    let changed = false;
    for (const [k, it] of this.items) {
      if (!isValid(it)) {
        this.items.delete(k);
        changed = true;
      }
    }
    if (this.hover && !isValid(this.hover)) {
      this.hover = null;
      this.emit('hover');
    }
    if (changed) this.emit('change');
  }
}

function clean(it) {
  const { point, world, normal, ...rest } = it;
  const out = { ...rest };
  if (it.kind === 'spoint') out.point = point;
  if (point && it.kind !== 'spoint') out.at = point;
  return out;
}
