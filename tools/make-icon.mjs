// Renders build/icon.svg to build/icon.png (used for installers). Run: npm run icon
import { chromium } from 'playwright';
import fs from 'node:fs';
const svg = fs.readFileSync('build/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
await page.screenshot({ path: 'build/icon.png', omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
