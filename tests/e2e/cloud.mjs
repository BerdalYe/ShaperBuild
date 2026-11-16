// End-to-end: accounts and cloud designs, against a stand-in Supabase
// project on this computer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, shot, OUT } from './harness.mjs';
import { fakeSupabase } from './fakesupabase.mjs';

const step = (msg) => console.log(`• ${msg}`);
// Passwords for the stand-in server only, made up as the test runs.
const PASS = `pw-${Date.now().toString(36)}`;
const NEW_PASS = `${PASS}-new`;
const WRONG = `${PASS}-wrong`;
const supa = await fakeSupabase();
process.env.SHAPER_SUPABASE_URL = supa.url;
process.env.SHAPER_SUPABASE_KEY = supa.key;
process.env.SHAPER_SUPABASE_GOOGLE = '1';
const dataDir = fs.mkdtempSync(path.join(OUT, 'profile-'));
let { win, errors, close } = await launch({ userData: dataDir });
const A = (fn, arg) => win.evaluate(fn, arg);
const cards = () => win.locator('.cloud-card').count();
const idle = () => win.waitForFunction(() => window.__shaper.kernel.busy === 0 && document.getElementById('busy')?.hidden !== false, null, { timeout: 30000 }).catch(() => {});

try {
  step('the home screen offers to sign in; the dialog creates an account');
  await A(() => window.__shaper.home.show());
  const btn = win.locator('.acct-btn');
  await btn.waitFor();
  assert.match(await btn.innerText(), /Sign in/);
  await btn.click();
  await win.waitForSelector('.acct-form');
  assert.ok(await win.locator('.acct-google').isVisible(), 'Google sign-in is offered when the project has it');
  await win.locator('.acct-links .link-btn', { hasText: 'Create an account' }).click();
  await win.locator('.acct-form input[type=email]').fill('maker@example.com');
  await win.locator('.acct-form input[type=password]').fill('123');
  await win.locator('.acct-submit').click();
  await win.waitForSelector('.acct-msg.error');
  assert.match(await win.locator('.acct-msg').innerText(), /6 characters/);
  await win.locator('.acct-form input[type=password]').fill(PASS);
  await win.locator('.acct-submit').click();
  await win.waitForSelector('.acct-form', { state: 'detached' });
  await win.waitForFunction(() => /maker@example\.com/.test(document.querySelector('.acct-btn')?.textContent || ''));
  assert.equal(supa.users.size, 1);
  await win.waitForSelector('.home-cloud .home-empty');

  step('a design saves to the cloud with a picture, and Save keeps it there');
  await A(async () => {
    const a = window.__shaper;
    a.home.hide();
    await a.ai.run('add_shape', { shape: 'box', width: 30, depth: 20, height: 10, name: 'Block' });
    a.files.name = 'Cloud block';
  });
  assert.equal(await A(() => window.__shaper.files.saveToCloud()), true);
  assert.equal(supa.rows.size, 1);
  const row = [...supa.rows.values()][0];
  assert.equal(row.name, 'Cloud block');
  assert.match(row.thumb || '', /^data:image\/jpeg;base64,/);
  const uid = [...supa.users.keys()][0];
  const file = `${uid}/${row.id}.shaperbuild`;
  assert.ok(supa.files.get(file)?.length > 100, 'the design file is in the bucket, in the user\'s folder');
  const firstSize = supa.files.get(file).length;
  await A(async () => {
    await window.__shaper.ai.run('add_shape', { shape: 'cylinder', radius: 5, height: 30, position: [40, 0, 0] });
    await window.__shaper.files.save();
  });
  assert.equal(supa.rows.size, 1, 'Save replaced the cloud design');
  assert.notEqual(supa.files.get(file).length, firstSize);
  assert.equal(await A(() => window.__shaper.doc.dirty), false);

  step('a design changed on another computer is not overwritten without asking');
  row.updated_at = new Date(Date.now() + 1000).toISOString();
  await A(() => window.__shaper.ai.run('add_shape', { shape: 'sphere', radius: 4, position: [0, 40, 4] }));
  const saving = A(() => window.__shaper.files.save());
  await win.waitForSelector('.modal-head:text("Changed somewhere else")');
  await win.locator('.modal-foot button', { hasText: 'Save as a copy' }).click();
  assert.equal(await saving, true);
  assert.equal(supa.rows.size, 2);
  assert.ok([...supa.rows.values()].some((r) => r.name === 'Cloud block copy'));

  step('cloud designs list on the home screen and open again');
  await A(() => window.__shaper.files.newDesign());
  await A(() => window.__shaper.home.show());
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 2);
  await shot(win, 'cloud-home');
  await win.locator(`.cloud-card[data-cloud="${row.id}"]`).click();
  await win.waitForFunction(() => window.__shaper.doc.bodies.length === 2 && window.__shaper.home.el.hidden);
  const opened = await A(() => ({ name: window.__shaper.files.name, cloud: window.__shaper.files.cloud?.id, dirty: window.__shaper.doc.dirty }));
  assert.deepEqual(opened, { name: 'Cloud block', cloud: row.id, dirty: false });

  step('rename and delete from the card menu');
  await A(() => window.__shaper.home.show());
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 2);
  const copy = [...supa.rows.values()].find((r) => r.name === 'Cloud block copy');
  await win.locator(`.cloud-card[data-cloud="${copy.id}"]`).click({ button: 'right' });
  await win.locator('.menu button', { hasText: 'Delete from the cloud' }).click();
  await win.locator('.modal-foot button', { hasText: 'Delete' }).click();
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 1);
  assert.equal(supa.rows.size, 1);
  assert.ok(![...supa.files.keys()].some((k) => k.includes(copy.id)), 'its file is gone too');
  await win.locator(`.cloud-card[data-cloud="${row.id}"]`).click({ button: 'right' });
  await win.locator('.menu button', { hasText: 'Rename' }).click();
  await win.locator('.modal input').fill('Renamed block');
  await win.locator('.modal-foot button', { hasText: 'Rename' }).click();
  await win.waitForFunction(() => /Renamed block/.test(document.querySelector('.cloud-card')?.textContent || ''));
  assert.equal(row.name, 'Renamed block');

  step('the sign-in is remembered after a restart, and the server only sees its own user\'s data');
  await close();
  ({ win, errors, close } = await launch({ userData: dataDir }));
  await A(() => window.__shaper.home.show());
  await win.waitForFunction(() => /maker@example\.com/.test(document.querySelector('.acct-btn')?.textContent || ''));
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 1);
  const stored = fs.readFileSync(path.join(dataDir, 'cloud.json'), 'utf8');
  assert.ok(!stored.includes(PASS), 'the password is never stored');

  step('sign out, a wrong password says so, sign in again');
  await win.locator('.acct-btn').click();
  await win.locator('.menu button', { hasText: 'Sign out' }).click();
  await win.waitForFunction(() => /Sign in/.test(document.querySelector('.acct-btn')?.textContent || ''));
  assert.equal(await cards(), 0);
  await win.locator('.acct-btn').click();
  await win.locator('.acct-form input[type=email]').fill('maker@example.com');
  await win.locator('.acct-form input[type=password]').fill(WRONG);
  await win.locator('.acct-submit').click();
  await win.waitForFunction(() => /Wrong email or password/.test(document.querySelector('.acct-msg')?.textContent || ''));
  await win.locator('.acct-form input[type=password]').fill(PASS);
  await win.locator('.acct-submit').click();
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 1);

  step('forgot the password: the emailed code and a new password sign in');
  await win.locator('.acct-btn').click();
  await win.locator('.menu button', { hasText: 'Sign out' }).click();
  await win.waitForFunction(() => /Sign in/.test(document.querySelector('.acct-btn')?.textContent || ''));
  await win.locator('.acct-btn').click();
  await win.locator('.acct-form input[type=email]').fill('maker@example.com');
  assert.equal(await win.locator('.acct-code').isVisible(), false, 'no code box until a code was sent');
  await win.locator('.acct-links .link-btn', { hasText: 'Forgot your password' }).click();
  await win.waitForSelector('.acct-code:visible');
  assert.match(await win.locator('.acct-title').innerText(), /new password/);
  await win.locator('.acct-code').fill('00000000');
  await win.locator('.acct-form input[type=password]').fill(NEW_PASS);
  await win.locator('.acct-submit').click();
  await win.waitForFunction(() => /wrong or has run out/.test(document.querySelector('.acct-msg')?.textContent || ''));
  await win.locator('.acct-code').fill(supa.codes.get('maker@example.com'));
  await win.locator('.acct-submit').click();
  await win.waitForSelector('.acct-form', { state: 'detached' });
  await win.waitForFunction(() => document.querySelectorAll('.cloud-card').length === 1);
  assert.equal([...supa.users.values()][0].password, NEW_PASS);

  step('delete the account: its designs and files go with it');
  await win.locator('.acct-btn').click();
  await win.locator('.menu button', { hasText: 'Delete account' }).click();
  await win.locator('.modal-foot button', { hasText: 'Delete account' }).click();
  await win.waitForFunction(() => /Sign in/.test(document.querySelector('.acct-btn')?.textContent || ''));
  assert.equal(supa.users.size, 0);
  assert.equal(supa.rows.size, 0);
  assert.equal(supa.files.size, 0);
  await idle();

  assert.deepEqual(errors, []);
  console.log('\ncloud: all passed');
} catch (err) {
  console.error('\ncloud FAILED:', err);
  process.exitCode = 1;
} finally {
  await close();
  supa.close();
}
