// MCP (Model Context Protocol) for ShaperBuild: AI apps such as Claude
// Desktop, Claude Code or Cursor can build in the open ShaperBuild with the
// same tools as the chat panel.
//
// The app runs a small MCP server on this computer only (127.0.0.1), with a
// secret token. Apps that speak MCP over HTTP connect to it directly. Apps
// that start a program instead (Claude Desktop) run `ShaperBuild --mcp`,
// which passes messages between them and the open app (runBridge below).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 45839;
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFS = require('../src/ai/tools.json');

function configPath(userData) {
  return path.join(userData, 'mcp.json');
}

// { enabled, token }
function readConfig(userData) {
  try {
    return JSON.parse(fs.readFileSync(configPath(userData), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(userData, config) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configPath(userData), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function toolList() {
  return DEFS.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));
}

// Answer one JSON-RPC message. `call(name, args)` runs a tool in the app and
// resolves to { text, image?, mime?, error? }. Returns null for notifications.
async function handle(msg, call, version) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'shaperbuild', title: 'ShaperBuild', version },
        instructions: DEFS.instructions,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: toolList() });
    case 'tools/call': {
      const name = msg.params?.name;
      if (!DEFS.tools.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      let res;
      try {
        res = await call(name, msg.params?.arguments || {});
      } catch (err) {
        res = { text: err.message, error: true };
      }
      const content = [];
      if (res.image) content.push({ type: 'image', data: res.image, mimeType: res.mime || 'image/png' });
      if (res.text || !content.length) content.push({ type: 'text', text: res.text || '' });
      return reply({ content, isError: !!res.error });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

// The server inside the app. `call` runs a tool in the window.
function createServer({ token, call, version }) {
  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    // Only local apps with the token; web pages are refused (no Origin, and
    // the Host must be this computer, against DNS rebinding).
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(host) || req.headers.origin) return send(403, { error: 'Forbidden' });
    const auth = String(req.headers.authorization || '');
    const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return send(401, { error: 'Missing or wrong token' });
    if (new URL(req.url, 'http://x').pathname !== '/mcp') return send(404, { error: 'Not found' });
    if (req.method !== 'POST') return send(405, { error: 'Use POST' }, { Allow: 'POST' });
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4e6) req.destroy();
    });
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map((m) => handle(m, call, version)))).filter(Boolean);
        return out.length ? send(200, out) : send(202);
      }
      const out = await handle(msg, call, version);
      return out ? send(200, out) : send(202);
    });
  });
  return server;
}

// `ShaperBuild --mcp`: read JSON-RPC lines on stdin, answer on stdout. The
// tool list is answered here (so it works before the app is open); tool
// calls go to the open app.
function runBridge({ userData, version }) {
  const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const post = (body) =>
    new Promise((resolve, reject) => {
      const { token } = readConfig(userData);
      if (!token) return reject(new Error('off'));
      const data = JSON.stringify(body);
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(data) } },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (raw += c));
          res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(raw)) : reject(new Error(res.statusCode === 401 ? 'token' : `HTTP ${res.statusCode}`))));
        },
      );
      req.on('error', () => reject(new Error('off')));
      req.end(data);
    });
  const call = async (name, args) => {
    try {
      const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      if (res.error) return { text: res.error.message, error: true };
      const r = res.result;
      const img = r.content.find((c) => c.type === 'image');
      return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), image: img?.data, mime: img?.mimeType, error: r.isError };
    } catch {
      return { text: 'ShaperBuild is not open, or AI apps are not allowed to use it. Ask the user to open ShaperBuild and turn on "Let AI apps use ShaperBuild" under Settings → AI assistant.', error: true };
    }
  };
  let buffer = '';
  let pending = 0;
  let ended = false;
  const finish = () => ended && !pending && process.exit(0);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      pending++;
      handle(msg, call, version)
        .then((reply) => reply && out(reply))
        .finally(() => {
          pending--;
          finish();
        });
    }
  });
  process.stdin.on('end', () => {
    ended = true;
    finish();
  });
}

module.exports = { PORT, readConfig, writeConfig, createServer, runBridge, handle };
