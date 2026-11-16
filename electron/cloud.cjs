// ShaperBuild accounts: sign in and keep designs in the cloud (Supabase).
//
// Runs in the main process so the login (tokens) stays out of the window and
// is stored encrypted on this computer. Talks to Supabase over its HTTP API:
// Auth (email + password, or Google), the `projects` table (names, dates,
// thumbnails) and the `projects` storage bucket (the design files). Every
// user can only reach their own rows and files: the database enforces it
// (row level security, see supabase/schema.sql).
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const BUCKET = 'projects';
const CALLBACK_PORT = 45840;

let userData = null;
let session = null; // { access_token, refresh_token, expires_at, user: { id, email } }
let safe = null;

// The project to talk to: electron/cloud-config.json, or the environment
// (SHAPER_SUPABASE_URL, SHAPER_SUPABASE_KEY, SHAPER_SUPABASE_GOOGLE).
function config() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'cloud-config.json'), 'utf8'));
  } catch {}
  const url = String(process.env.SHAPER_SUPABASE_URL || file.url || '').replace(/\/+$/, '');
  const key = String(process.env.SHAPER_SUPABASE_KEY || file.anonKey || '');
  const google = process.env.SHAPER_SUPABASE_GOOGLE ? process.env.SHAPER_SUPABASE_GOOGLE === '1' : !!file.google;
  return { url, key, google, configured: !!(url && key) };
}

// ---- the stored login ---------------------------------------------------------

const sessionFile = () => path.join(userData, 'cloud.json');

function loadSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf8'));
    const text = raw.enc && safe?.isEncryptionAvailable() ? safe.decryptString(Buffer.from(raw.enc, 'base64')) : raw.plain;
    session = text ? JSON.parse(text) : null;
  } catch {
    session = null;
  }
}

function saveSession(s) {
  session = s;
  if (!userData) return;
  if (!s) {
    fs.rmSync(sessionFile(), { force: true });
    return;
  }
  const text = JSON.stringify(s);
  const data = safe?.isEncryptionAvailable() ? { enc: safe.encryptString(text).toString('base64') } : { plain: text };
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(sessionFile(), JSON.stringify(data), { mode: 0o600 });
}

function fromAuth(body) {
  if (!body?.access_token) return null;
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: body.expires_at ? body.expires_at * 1000 : Date.now() + (body.expires_in || 3600) * 1000,
    user: { id: body.user?.id, email: body.user?.email || '' },
  };
}

// ---- HTTP ------------------------------------------------------------------------

// Electron's network stack (follows the computer's proxy settings), or
// plain fetch outside Electron.
function doFetch(url, opts) {
  try {
    const { net } = require('electron');
    if (net?.fetch) return net.fetch(url, opts);
  } catch {}
  return fetch(url, opts);
}

class CloudError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Supabase's messages, in words people use.
function friendly(status, body) {
  const raw = String(body?.error_description || body?.msg || body?.message || body?.error || '').trim();
  if (/invalid login credentials/i.test(raw)) return 'Wrong email or password';
  if (/email not confirmed/i.test(raw)) return 'Confirm your email first: open the link we sent you, then sign in';
  if (/already registered|already exists/i.test(raw)) return 'There is already an account with this email. Sign in instead';
  if (/password should be at least/i.test(raw)) return 'Use a password with at least 6 characters';
  if (/rate limit|too many/i.test(raw) || status === 429) return 'Too many tries. Wait a minute and try again';
  if (status === 401 || /jwt/i.test(raw)) return 'Your sign-in has run out. Sign in again';
  return raw || `The server said ${status}`;
}

async function call(method, route, { body, headers = {}, auth = true, raw = false } = {}) {
  const c = config();
  if (!c.configured) throw new CloudError('Accounts are not set up in this copy of ShaperBuild', 0, 'not_configured');
  const h = { apikey: c.key, ...headers };
  if (auth) {
    const token = await accessToken();
    h.Authorization = `Bearer ${token}`;
  }
  let payload = body;
  if (body !== undefined && !(body instanceof Uint8Array) && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    h['Content-Type'] ??= 'application/json';
  }
  let res;
  try {
    res = await doFetch(`${c.url}${route}`, { method, headers: h, body: payload });
  } catch {
    throw new CloudError('Could not reach the ShaperBuild cloud. Check your internet connection', 0, 'offline');
  }
  if (raw && res.ok) return new Uint8Array(await res.arrayBuffer());
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw new CloudError(friendly(res.status, data), res.status, data?.error_code || data?.code);
  return data;
}

async function accessToken() {
  if (!session) throw new CloudError('Sign in first', 401, 'signed_out');
  if (session.expires_at - Date.now() > 60_000) return session.access_token;
  try {
    const body = await call('POST', '/auth/v1/token?grant_type=refresh_token', { auth: false, body: { refresh_token: session.refresh_token } });
    saveSession(fromAuth(body));
    return session.access_token;
  } catch (err) {
    if (err.code !== 'offline') saveSession(null);
    throw err;
  }
}

// ---- accounts ------------------------------------------------------------------------

function state() {
  const c = config();
  return { configured: c.configured, google: c.configured && c.google, user: session ? { email: session.user.email } : null };
}

function checkEmail(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) throw new CloudError('Type a valid email address');
  if (password !== undefined && String(password).length < 6) throw new CloudError('Use a password with at least 6 characters');
}

async function signUp({ email, password }) {
  checkEmail(email, password);
  const body = await call('POST', '/auth/v1/signup', { auth: false, body: { email: email.trim(), password } });
  const s = fromAuth(body);
  if (s) {
    saveSession(s);
    return { ...state(), confirm: false };
  }
  // The project asks new users to confirm their email first.
  return { ...state(), confirm: true };
}

async function signIn({ email, password }) {
  checkEmail(email, password);
  const body = await call('POST', '/auth/v1/token?grant_type=password', { auth: false, body: { email: email.trim(), password } });
  saveSession(fromAuth(body));
  return state();
}

async function resetPassword({ email }) {
  checkEmail(email);
  await call('POST', '/auth/v1/recover', { auth: false, body: { email: email.trim() } });
  return { sent: true };
}

// The code from the "choose a new password" email, and the new password:
// the code signs in, then the password is changed.
async function confirmReset({ email, code, password }) {
  checkEmail(email, password);
  if (!/^\d{6,10}$/.test(String(code || '').trim())) throw new CloudError('Type the code from the email');
  let body;
  try {
    body = await call('POST', '/auth/v1/verify', { auth: false, body: { type: 'recovery', email: email.trim(), token: String(code).trim() } });
  } catch (err) {
    if (err.status === 403 || /expired|invalid/i.test(err.message)) throw new CloudError('That code is wrong or has run out. Ask for a new one');
    throw err;
  }
  saveSession(fromAuth(body));
  await call('PUT', '/auth/v1/user', { body: { password } });
  return state();
}

async function signOut() {
  if (session) await call('POST', '/auth/v1/logout', {}).catch(() => {});
  saveSession(null);
  return state();
}

// Google: the browser signs in and comes back to this computer with a code
// (PKCE), which is swapped for a session.
let googleWait = null;
async function signInGoogle({ openUrl, timeoutMs = 300_000 } = {}) {
  const c = config();
  if (!c.configured || !c.google) throw new CloudError('Google sign-in is not set up');
  googleWait?.cancel();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const redirect = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`;
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      const got = u.searchParams.get('code');
      const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>ShaperBuild</title><body style="font:16px system-ui;padding:48px;text-align:center"><h2>${got ? 'You are signed in to ShaperBuild' : 'Sign-in did not work'}</h2><p>You can close this tab and go back to ShaperBuild.</p></body>`);
      done(got ? null : new CloudError(err || 'Google sign-in was cancelled'), got);
    });
    const timer = setTimeout(() => done(new CloudError('Google sign-in took too long. Try again')), timeoutMs);
    let finished = false;
    function done(err, value) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      googleWait = null;
      if (err) reject(err);
      else resolve(value);
    }
    googleWait = { cancel: () => done(new CloudError('Google sign-in was cancelled')) };
    server.on('error', () => done(new CloudError('Could not start Google sign-in (port in use)')));
    server.listen(CALLBACK_PORT, '127.0.0.1', () => {
      openUrl(`${c.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`);
    });
  });
  const body = await call('POST', '/auth/v1/token?grant_type=pkce', { auth: false, body: { auth_code: code, code_verifier: verifier } });
  saveSession(fromAuth(body));
  return state();
}

// ---- designs ---------------------------------------------------------------------------

const fileOf = (id) => `${session.user.id}/${id}.shaperbuild`;
const enc = encodeURIComponent;

async function list() {
  return call('GET', '/rest/v1/projects?select=id,name,updated_at,size,thumb&order=updated_at.desc');
}

// Save a design. A new one gets an id; an existing one is replaced, unless
// someone changed it since `expected` (its updated_at when it was opened):
// then { conflict: true } comes back and nothing is changed.
async function save({ id = null, name, bytes, thumb = null, expected = null, force = false }) {
  const data = Buffer.from(bytes);
  if (!String(name || '').trim()) throw new CloudError('Give the design a name');
  if (id && !force) {
    const [row] = await call('GET', `/rest/v1/projects?id=eq.${enc(id)}&select=updated_at`);
    if (!row) id = null; // deleted meanwhile: save as new
    else if (expected && row.updated_at !== expected) return { conflict: true, updated_at: row.updated_at };
  }
  if (!id) {
    const [row] = await call('POST', '/rest/v1/projects', { headers: { Prefer: 'return=representation' }, body: { name: name.trim(), size: data.length, thumb } });
    id = row.id;
  }
  await call('POST', `/storage/v1/object/${BUCKET}/${fileOf(id)}`, { headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }, body: data });
  const [row] = await call('PATCH', `/rest/v1/projects?id=eq.${enc(id)}`, {
    headers: { Prefer: 'return=representation' },
    body: { name: name.trim(), size: data.length, thumb, updated_at: new Date().toISOString() },
  });
  return { id, name: row.name, updated_at: row.updated_at };
}

async function open({ id }) {
  const [row] = await call('GET', `/rest/v1/projects?id=eq.${enc(id)}&select=id,name,updated_at`);
  if (!row) throw new CloudError('That design is no longer in your cloud');
  const bytes = await call('GET', `/storage/v1/object/authenticated/${BUCKET}/${fileOf(id)}`, { raw: true });
  return { ...row, bytes };
}

async function rename({ id, name }) {
  if (!String(name || '').trim()) throw new CloudError('Give the design a name');
  const [row] = await call('PATCH', `/rest/v1/projects?id=eq.${enc(id)}`, { headers: { Prefer: 'return=representation' }, body: { name: name.trim() } });
  return row;
}

async function remove({ id }) {
  await call('DELETE', `/storage/v1/object/${BUCKET}`, { body: { prefixes: [fileOf(id)] } });
  await call('DELETE', `/rest/v1/projects?id=eq.${enc(id)}`);
  return { deleted: id };
}

// Delete every design, then the account itself (supabase/schema.sql has
// the delete_account function), then sign out.
async function deleteAccount() {
  const rows = await list();
  if (rows.length) await call('DELETE', `/storage/v1/object/${BUCKET}`, { body: { prefixes: rows.map((r) => fileOf(r.id)) } });
  await call('POST', '/rest/v1/rpc/delete_account', { body: {} });
  saveSession(null);
  return state();
}

// ---- IPC -------------------------------------------------------------------------

function setup({ userData: dir, ipcMain, safeStorage, shell }) {
  userData = dir;
  safe = safeStorage;
  loadSession();
  const handle = (name, fn) =>
    ipcMain.handle(name, async (_e, arg = {}) => {
      try {
        return await fn(arg);
      } catch (err) {
        return { error: err.message, code: err.code || null };
      }
    });
  handle('cloud:state', async () => state());
  handle('cloud:sign-up', signUp);
  handle('cloud:sign-in', signIn);
  handle('cloud:google', () => signInGoogle({ openUrl: (u) => shell.openExternal(u) }));
  handle('cloud:reset', resetPassword);
  handle('cloud:confirm-reset', confirmReset);
  handle('cloud:sign-out', signOut);
  handle('cloud:list', list);
  handle('cloud:save', save);
  handle('cloud:open', open);
  handle('cloud:rename', rename);
  handle('cloud:delete', remove);
  handle('cloud:delete-account', deleteAccount);
}

module.exports = { setup, config, state, signUp, signIn, signOut, resetPassword, confirmReset, list, save, open, rename, remove, deleteAccount, CALLBACK_PORT };
