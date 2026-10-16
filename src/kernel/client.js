// Promise-based client for the geometry worker.
import { Emitter } from '../core/events.js';
import { RECORDED } from '../core/replay.js';

export class KernelClient extends Emitter {
  constructor(url = new URL('./worker.js', import.meta.url)) {
    super();
    this.worker = new Worker(url, { type: 'module' });
    this.pending = new Map();
    this.seq = 1;
    this.busy = 0;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      this._rejectReady(new Error(e.message || 'The geometry engine failed to start'));
    };
  }

  onMessage(msg) {
    if (msg.type === 'ready') return this._resolveReady();
    if (msg.type === 'fatal') return this._rejectReady(new Error(msg.message));
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    this.busy--;
    this.emit('busy', this.busy > 0);
    if (msg.error) return p.reject(new KernelError(msg.error));
    const res = msg.result;
    // Remember how a body-changing result was made (for the design history).
    if (RECORDED.has(p.method) && res && Array.isArray(res.bodies)) res.calls = [{ method: p.method, args: p.args, n: res.bodies.length }];
    p.resolve(res);
  }

  call(method, args = {}) {
    const id = this.seq++;
    this.busy++;
    this.emit('busy', true);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method, args });
      this.worker.postMessage({ id, method, args });
    });
  }
}

export class KernelError extends Error {}

// Runs the latest request only: while one call is in flight, newer requests
// replace each other and only the most recent is sent next. Used for live
// previews while dragging.
export class LatestRunner {
  constructor(fn) {
    this.fn = fn;
    this.running = false;
    this.next = null;
    this.token = 0;
  }

  request(args) {
    const token = ++this.token;
    return new Promise((resolve) => {
      this.next = { args, resolve, token };
      this.pump();
    });
  }

  cancel() {
    this.token++;
    if (this.next) this.next.resolve({ stale: true });
    this.next = null;
  }

  async pump() {
    if (this.running || !this.next) return;
    const job = this.next;
    this.next = null;
    this.running = true;
    let out;
    try {
      out = { value: await this.fn(job.args) };
    } catch (err) {
      out = { error: err };
    }
    this.running = false;
    out.stale = job.token !== this.token;
    job.resolve(out);
    this.pump();
  }
}
