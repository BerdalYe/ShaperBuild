// Runs every end-to-end scenario against the real app.
// Linux needs a display: xvfb-run -a npm run test:e2e
import { spawnSync } from 'node:child_process';

const suites = ['smoke.mjs', 'workflow.mjs', 'tools.mjs', 'constraints.mjs'];
let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s}`);
  const r = spawnSync(process.execPath, [new URL(s, import.meta.url).pathname], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (failed) {
  console.error(`\n${failed} e2e suite(s) failed`);
  process.exit(1);
}
console.log('\nAll e2e suites passed');
