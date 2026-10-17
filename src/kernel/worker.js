// Web Worker hosting the geometry kernel so heavy CAD operations never block
// the interface.
import OC from '/node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from '../vendor/manifold/manifold.js';
import { Kernel } from './kernel.js';

let kernel = null;
const ready = (async () => {
  // Report each engine as it finishes loading (the startup screen shows it).
  const step = (name) => (mod) => {
    self.postMessage({ type: 'stage', stage: name });
    return mod;
  };
  const [oc, mf] = await Promise.all([OC().then(step('cad')), ManifoldModule().then(step('mesh'))]);
  mf.setup();
  kernel = new Kernel(oc, mf);
})();

ready.then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'fatal', message: String(err && err.message ? err.message : err) }),
);

self.onmessage = async (event) => {
  const { id, method, args } = event.data;
  try {
    await ready;
    if (method.startsWith('_') || typeof kernel[method] !== 'function') throw new Error(`Unknown kernel call ${method}`);
    const t0 = performance.now();
    const result = kernel[method](args || {});
    self.postMessage({ id, result, ms: performance.now() - t0 });
  } catch (err) {
    const message = kernel ? kernel.errorMessage(err) : String(err);
    self.postMessage({ id, error: message || 'Operation failed' });
  }
};
