// Launches the real Electron app for end-to-end tests (Linux: run under xvfb-run).
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'test-output');

export async function launch({ userData } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const dataDir = userData || fs.mkdtempSync(path.join(OUT, 'profile-'));
  const exe = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist', exe),
    // Software rendering keeps screenshots identical on machines without a GPU.
    args: [ROOT, '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${dataDir}`],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (process.env.E2E_VERBOSE) console.log(`[console.${m.type()}]`, m.text());
  });
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack || ''}`));
  await win.setViewportSize?.({ width: 1440, height: 900 }).catch(() => {});
  await win.waitForFunction(() => window.__shaper && window.__shaper.ready, null, { timeout: 90000 });
  // Quit without the "save changes?" prompt.
  const close = async () => {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => {});
    await app.close().catch(() => {});
  };
  return { app, win, errors, close };
}

export async function shot(win, name) {
  const file = path.join(OUT, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}
