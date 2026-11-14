// The AI assistant's side in the main process: its settings (the API key is
// kept encrypted by the operating system and never reaches the window), the
// calls to the AI service, and the MCP server for other AI apps.
const { ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mcp = require('./mcp.cjs');

// Claude models offered in the chat (the first is the default).
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
// Models that can hand a declined request to another model by themselves.
const FALLBACKS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-fable-5-2']);

function setup({ userData, version, getWindow }) {
  const file = path.join(userData, 'ai.json');
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  };
  const write = (s) => {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  const keyOf = (s) => {
    if (!s.key) return '';
    try {
      return s.keyPlain ? Buffer.from(s.key, 'base64').toString('utf8') : safeStorage.decryptString(Buffer.from(s.key, 'base64'));
    } catch {
      return '';
    }
  };
  const settings = () => {
    const s = read();
    return { provider: s.provider || 'anthropic', model: s.model || '', baseUrl: s.baseUrl || '', hasKey: !!keyOf(s), claudeModels: CLAUDE_MODELS };
  };

  // ---- tool calls from AI apps, run in the window -------------------------
  const waiting = new Map();
  ipcMain.on('ai:result', (_e, id, result) => {
    waiting.get(id)?.(result);
    waiting.delete(id);
  });
  const callInWindow = (name, input) =>
    new Promise((resolve) => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return resolve({ text: 'ShaperBuild has no open window', error: true });
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve({ text: 'The step took too long', error: true });
      }, 180000);
      waiting.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      win.webContents.send('ai:call', id, name, input);
    });

  // ---- MCP server ----------------------------------------------------------
  let server = null;
  let serverError = null;
  const mcpState = () => {
    const c = mcp.readConfig(userData);
    return { enabled: !!c.enabled, running: !!server, error: serverError, port: mcp.PORT, url: `http://127.0.0.1:${mcp.PORT}/mcp`, token: c.token || '', command: process.execPath, args: process.defaultApp ? [path.join(__dirname, '..'), '--mcp'] : ['--mcp'] };
  };
  const startServer = () =>
    new Promise((resolve) => {
      if (server) return resolve();
      const c = mcp.readConfig(userData);
      const s = mcp.createServer({ token: c.token, call: callInWindow, version });
      s.once('error', (err) => {
        serverError = err.code === 'EADDRINUSE' ? `Port ${mcp.PORT} is in use by another program` : err.message;
        server = null;
        resolve();
      });
      s.listen(mcp.PORT, '127.0.0.1', () => {
        server = s;
        serverError = null;
        resolve();
      });
    });
  const stopServer = () =>
    new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
      server = null;
    });
  if (mcp.readConfig(userData).enabled) startServer();

  ipcMain.handle('mcp:state', () => mcpState());
  ipcMain.handle('mcp:set', async (_e, enabled) => {
    const c = mcp.readConfig(userData);
    c.enabled = !!enabled;
    if (!c.token) c.token = crypto.randomBytes(24).toString('base64url');
    mcp.writeConfig(userData, c);
    if (c.enabled) await startServer();
    else await stopServer();
    return mcpState();
  });
  ipcMain.handle('mcp:new-token', async () => {
    const c = mcp.readConfig(userData);
    c.token = crypto.randomBytes(24).toString('base64url');
    mcp.writeConfig(userData, c);
    if (server) {
      await stopServer();
      await startServer();
    }
    return mcpState();
  });

  // ---- chat settings -------------------------------------------------------
  ipcMain.handle('ai:settings', () => settings());
  ipcMain.handle('ai:save', (_e, patch = {}) => {
    const s = read();
    for (const k of ['provider', 'model', 'baseUrl']) if (k in patch) s[k] = String(patch[k] || '').trim();
    if ('key' in patch) {
      const key = String(patch.key || '').trim();
      if (!key) {
        delete s.key;
        delete s.keyPlain;
      } else if (safeStorage.isEncryptionAvailable()) {
        s.key = safeStorage.encryptString(key).toString('base64');
        delete s.keyPlain;
      } else {
        // No system keychain (some Linux desktops): kept in this file only.
        s.key = Buffer.from(key).toString('base64');
        s.keyPlain = true;
      }
    }
    write(s);
    return settings();
  });

  // ---- one turn of the chat --------------------------------------------------
  // { system, messages, tools } in the provider's own message format.
  // Returns { message, text, calls: [{ id, name, input }], stop } or { error }.
  ipcMain.handle('ai:chat', async (_e, { system, messages, tools }) => {
    const s = read();
    const key = keyOf(s);
    try {
      if ((s.provider || 'anthropic') === 'anthropic') return await claudeTurn({ key, model: s.model || CLAUDE_MODELS[0], baseUrl: s.baseUrl, system, messages, tools });
      return await openaiTurn({ key, model: s.model, baseUrl: s.baseUrl, system, messages, tools });
    } catch (err) {
      return { error: describeError(err) };
    }
  });

  return { stop: stopServer };
}

async function claudeTurn({ key, model, baseUrl, system, messages, tools }) {
  if (!key) return { error: 'Add your Claude API key in the AI settings first.' };
  const Anthropic = require('@anthropic-ai/sdk').default;
  const client = new Anthropic({ apiKey: key, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  const params = {
    model,
    max_tokens: 16000,
    system,
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    messages,
    output_config: { effort: 'medium' },
    // The instructions and tools are the same on every turn: cache them.
    cache_control: { type: 'ephemeral' },
  };
  // A declined request is retried on another model by the API itself.
  const response = FALLBACKS.has(model) ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : await client.messages.create(params);
  if (response.stop_reason === 'refusal') return { error: 'The AI declined this request. Try asking in another way.', message: null };
  const calls = response.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return { message: { role: 'assistant', content: response.content }, text, calls, stop: response.stop_reason };
}

// Any service with an OpenAI-style chat API: OpenAI, OpenRouter, Groq,
// Mistral, or one on this computer (Ollama, LM Studio).
async function openaiTurn({ key, model, baseUrl, system, messages, tools }) {
  if (!baseUrl) return { error: 'Add the address of the AI service in the AI settings first.' };
  if (!model) return { error: 'Add the model name in the AI settings first.' };
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) return { error: `${res.status}: ${body?.error?.message || res.statusText}` };
  const msg = body?.choices?.[0]?.message;
  if (!msg) return { error: 'The AI service gave no answer' };
  const calls = (msg.tool_calls || []).map((c) => {
    let input = {};
    try {
      input = JSON.parse(c.function.arguments || '{}');
    } catch {}
    return { id: c.id, name: c.function.name, input };
  });
  const message = { role: 'assistant', content: msg.content || '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) };
  return { message, text: msg.content || '', calls, stop: body.choices[0].finish_reason };
}

function describeError(err) {
  const Anthropic = require('@anthropic-ai/sdk').default;
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was not accepted. Check it in the AI settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key may not use that model.';
  if (err instanceof Anthropic.NotFoundError) return 'That model was not found. Pick another one in the AI settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Too many requests (or no credit left). Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `${err.status ?? ''} ${err.message}`.trim();
  if (err?.cause?.code === 'ECONNREFUSED') return 'Could not reach the AI service at that address.';
  return err?.message || String(err);
}

module.exports = { setup };
