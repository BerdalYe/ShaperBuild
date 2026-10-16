// Launches the real Electron app for end-to-end tests (Linux: run under xvfb-run).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'test-output');

export async function launch({ userData, waitReady = true, tutorial = false } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = userData || fs.mkdtempSync(path.join(OUT, 'profile-'));
  // require('electron') returns the binary path and downloads it if needed.
  const electronPath = createRequire(import.meta.url)('electron');
  // SHAPER_EXE runs a packaged build (e.g. dist/linux-unpacked/shaperbuild)
  // instead of the sources.
  const packaged = process.env.SHAPER_EXE;
  const flags = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${dataDir}`];
  const app = await electron.launch({
    executablePath: packaged || electronPath,
    // Software rendering keeps screenshots identical on machines without a GPU.
    args: packaged ? flags : [ROOT, ...flags],
    cwd: ROOT,
    // The first-run tutorial would cover the window, so suites opt in to it.
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', SHAPER_NO_TUTORIAL: tutorial ? '0' : '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (process.env.E2E_VERBOSE) console.log(`[console.${m.type()}]`, m.text());
  });
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  await win.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
  if (waitReady) await waitForReady(win);
  // Quit without the "save changes?" prompt.
  const close = async () => {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  };
  return { app, win, errors, close };
}

export function waitForReady(win) {
  return win.waitForFunction(() => window.__shaper && window.__shaper.ready, null, { timeout: 90000 });
}

export async function shot(win, name) {
  const file = path.join(OUT, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}
