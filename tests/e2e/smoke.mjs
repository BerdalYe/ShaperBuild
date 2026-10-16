import { launch, shot } from './harness.mjs';
const { win, errors, close } = await launch();
await win.waitForTimeout(800);
await shot(win, '01-home');
await win.evaluate(() => window.__shaper.home.hide());
await win.waitForTimeout(500);
await shot(win, '02-empty');
console.log('errors:', errors);
await close();
