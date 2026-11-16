// A stand-in for a Supabase project, for tests: email accounts, the
// `projects` table and storage bucket, and delete_account(), all in memory,
// with the same rule as the real one (supabase/schema.sql): each user only
// reaches their own rows and files.
import http from 'node:http';
import crypto from 'node:crypto';

export async function fakeSupabase({ key = 'anon-key', confirmEmails = false } = {}) {
  const users = new Map(); // id → { id, email, password }
  const tokens = new Map(); // access token → user id
  const refresh = new Map(); // refresh token → user id
  const rows = new Map(); // id → row
  const files = new Map(); // path → Buffer
  const log = [];
  const codes = new Map(); // email → recovery code (what the email would carry)
  const id = () => crypto.randomUUID();
  const session = (u) => {
    const access = `at-${id()}`;
    const ref = `rt-${id()}`;
    tokens.set(access, u.id);
    refresh.set(ref, u.id);
    return { access_token: access, refresh_token: ref, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } };
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const send = (status, body, type = 'application/json') => {
        res.writeHead(status, { 'Content-Type': type });
        res.end(body === undefined ? '' : type === 'application/json' ? JSON.stringify(body) : body);
      };
      log.push(`${req.method} ${url.pathname}`);
      if (req.headers.apikey !== key) return send(401, { message: 'Invalid API key' });
      const json = () => {
        try {
          return JSON.parse(raw.toString() || '{}');
        } catch {
          return {};
        }
      };
      const uid = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const p = url.pathname;
      // ---- auth
      if (p === '/auth/v1/signup' && req.method === 'POST') {
        const { email, password } = json();
        if ([...users.values()].some((u) => u.email === email)) return send(422, { code: 422, msg: 'User already registered' });
        if (String(password).length < 6) return send(422, { msg: 'Password should be at least 6 characters' });
        const u = { id: id(), email, password, confirmed: !confirmEmails };
        users.set(u.id, u);
        return send(200, confirmEmails ? { id: u.id, email } : session(u));
      }
      if (p === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        const b = json();
        if (grant === 'password') {
          const u = [...users.values()].find((x) => x.email === b.email && x.password === b.password);
          if (!u) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          if (!u.confirmed) return send(400, { error_description: 'Email not confirmed' });
          return send(200, session(u));
        }
        if (grant === 'refresh_token') {
          const u = users.get(refresh.get(b.refresh_token));
          if (!u) return send(400, { error_description: 'Invalid Refresh Token' });
          refresh.delete(b.refresh_token);
          return send(200, session(u));
        }
        return send(400, { error_description: 'unsupported grant' });
      }
      if (p === '/auth/v1/recover') {
        const { email } = json();
        if ([...users.values()].some((u) => u.email === email)) codes.set(email, String(10000000 + Math.floor(Math.random() * 89999999)));
        return send(200, {});
      }
      if (p === '/auth/v1/verify' && req.method === 'POST') {
        const { type, email, token } = json();
        const u = [...users.values()].find((x) => x.email === email);
        if (type !== 'recovery' || !u || codes.get(email) !== token) return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        codes.delete(email);
        return send(200, session(u));
      }
      if (p === '/auth/v1/user' && req.method === 'PUT') {
        const u = users.get(tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, '')));
        if (!u) return send(401, { msg: 'JWT expired' });
        const { password } = json();
        if (password) u.password = password;
        return send(200, { id: u.id, email: u.email });
      }
      if (p === '/auth/v1/logout') {
        tokens.delete(String(req.headers.authorization).replace(/^Bearer /, ''));
        return send(204);
      }
      if (!uid || !users.has(uid)) return send(401, { message: 'JWT expired' });
      // ---- the projects table
      if (p === '/rest/v1/projects') {
        const idEq = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const mine = [...rows.values()].filter((r) => r.owner === uid && (!idEq || r.id === idEq));
        if (req.method === 'GET') return send(200, mine.sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
        if (req.method === 'POST') {
          const now = new Date().toISOString();
          const r = { id: id(), owner: uid, size: 0, thumb: null, created_at: now, updated_at: now, ...json() };
          rows.set(r.id, r);
          return send(201, [r]);
        }
        if (req.method === 'PATCH') {
          const patch = json();
          for (const r of mine) Object.assign(r, patch, { owner: uid });
          return send(200, mine);
        }
        if (req.method === 'DELETE') {
          for (const r of mine) rows.delete(r.id);
          return send(204);
        }
      }
      if (p === '/rest/v1/rpc/delete_account' && req.method === 'POST') {
        users.delete(uid);
        for (const r of [...rows.values()]) if (r.owner === uid) rows.delete(r.id);
        return send(204);
      }
      // ---- the projects bucket: <user id>/<file>
      const own = (path) => path.split('/')[0] === uid;
      if (p.startsWith('/storage/v1/object/authenticated/projects/') && req.method === 'GET') {
        const path = decodeURIComponent(p.slice('/storage/v1/object/authenticated/projects/'.length));
        if (!own(path) || !files.has(path)) return send(400, { message: 'Object not found' });
        return send(200, files.get(path), 'application/octet-stream');
      }
      if (p.startsWith('/storage/v1/object/projects/') && req.method === 'POST') {
        const path = decodeURIComponent(p.slice('/storage/v1/object/projects/'.length));
        if (!own(path)) return send(403, { message: 'new row violates row-level security policy' });
        if (files.has(path) && req.headers['x-upsert'] !== 'true') return send(409, { message: 'The resource already exists' });
        files.set(path, raw);
        return send(200, { Key: `projects/${path}` });
      }
      if (p === '/storage/v1/object/projects' && req.method === 'DELETE') {
        for (const path of json().prefixes || []) if (own(path)) files.delete(path);
        return send(200, []);
      }
      return send(404, { message: `no route ${req.method} ${p}` });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, key, users, rows, files, codes, log, close: () => server.close() };
}
