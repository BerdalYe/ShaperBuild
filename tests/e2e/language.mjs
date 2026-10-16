// End-to-end: the first start asks for the language; Norwegian changes the
// app and the native menus; switching back from Settings restarts the window
// and keeps the open design.
import assert from 'node:assert/strict';
import { launch, shot, waitForReload } from './harness.mjs';

const { app, win, errors, close } = await launch({ tutorial: true, waitReady: false });
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
// Text that can only be English (Norwegian never uses these words).
const ENGLISH = /\b(the|and|of|is|with|your|this|you|from|into|Click|Select|Choose)\b/;

try {
  step('welcome screen offers both languages');
  await win.waitForSelector('.wl-choice', { timeout: 90000 });
  const choices = await win.locator('.wl-choice b').allInnerTexts();
  assert.deepEqual([...choices].sort(), ['English', 'Norsk (bokmål)']);
  await shot(win, 'lang-01-welcome');

  step('choosing Norwegian reloads the app in Norwegian');
  await win.click('.wl-choice[data-lang="nb"]');
  await waitForReload(win);
  assert.equal(await A(() => document.documentElement.lang), 'nb');
  assert.equal(await A(() => JSON.parse(localStorage.getItem('shaperbuild.settings.v1')).language), 'nb');
  await A(() => (window.__i18nMissing = new Set()));
  // The tutorial offer comes in Norwegian too; skip it.
  await A(() => window.__shaper.home.hide());
  await win.waitForTimeout(300);
  await win.keyboard.press('Escape');

  step('menus, tools and panels are in Norwegian');
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label));
  assert.ok(menu.includes('Fil') && menu.includes('Rediger') && menu.includes('Hjelp'), menu.join(', '));
  assert.equal(await win.locator('.tool-btn[data-tool="extrude"] .tb-label').innerText(), 'Ekstruder');
  assert.equal(await A(() => document.querySelector('.ts-input').placeholder), 'Søk etter verktøy');

  step('a body, its tools and the panels show Norwegian text');
  await A(async () => {
    const a = window.__shaper;
    const r = await a.kernel.call('primitive', { type: 'box', params: { width: 20, depth: 20, height: 10 } });
    a.cmd.applyResult('Box', r);
    a.selection.set([{ kind: 'body', bodyId: a.doc.bodies[0].id }]);
    a.vp.fit();
  });
  await win.waitForTimeout(400);
  assert.equal(await A(() => window.__shaper.doc.bodies[0].name), 'Objekt 1');
  for (const id of ['line', 'rect', 'extrude', 'fillet', 'move', 'measure', 'subtract', 'box', 'text']) {
    await A((id) => window.__shaper.tools.activate(id, { force: true }), id);
    await win.waitForTimeout(150);
  }
  await A(() => window.__shaper.tools.activate('select'));
  // Search finds tools by Norwegian and English names.
  await win.locator('.ts-input').fill('avrund');
  assert.equal(await win.locator('.ts-row b').first().innerText(), 'Avrunding');
  await win.locator('.ts-input').fill('fillet');
  assert.equal(await win.locator('.ts-row b').first().innerText(), 'Avrunding');
  await win.keyboard.press('Escape');
  await shot(win, 'lang-02-norwegian');

  step('no English text was left untranslated');
  const missing = (await A(() => [...window.__i18nMissing])).filter((s) => ENGLISH.test(s));
  assert.deepEqual(missing, []);

  step('switching back to English in Settings restarts and keeps the design');
  await A(() => {
    window.__shaper.dialogs.settings();
  });
  const select = win.locator('select[data-setting="language"]');
  await select.selectOption('en');
  await win.waitForSelector('.modal-head:text("Bytt språk")');
  await win.locator('.modal-foot button.primary').last().click();
  await waitForReload(win);
  assert.equal(await A(() => document.documentElement.lang), 'en');
  assert.equal(await win.locator('.tool-btn[data-tool="extrude"] .tb-label').innerText(), 'Extrude');
  assert.equal(await A(() => window.__shaper.doc.bodies.length), 1);
  assert.equal(await A(() => window.__shaper.files.name), 'Untitled');
  const menuEn = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label));
  assert.ok(menuEn.includes('File'), menuEn.join(', '));
  await shot(win, 'lang-03-english-again');

  assert.deepEqual(errors, []);
  console.log('language: passed');
} catch (err) {
  console.error('language FAILED:', err.message, errors);
  await shot(win, 'lang-zz-failed').catch(() => {});
  process.exitCode = 1;
} finally {
  await close();
}
