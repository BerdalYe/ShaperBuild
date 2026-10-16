// Tiny event emitter.
export class Emitter {
  constructor() {
    this._handlers = new Map();
  }

  on(name, fn) {
    if (!this._handlers.has(name)) this._handlers.set(name, new Set());
    this._handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  off(name, fn) {
    this._handlers.get(name)?.delete(fn);
  }

  emit(name, ...args) {
    const set = this._handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
