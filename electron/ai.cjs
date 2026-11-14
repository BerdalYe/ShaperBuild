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

// The AI services in the settings. All but Claude are reached through their
// OpenAI-style API at `url`; "custom" takes any address. `keyUrl` is where
// to get a key; `local` ones run on this computer and need none.
const SERVICES = [
  { id: 'anthropic', name: 'Claude (Anthropic)', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Google Gemini (AI Studio)', url: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'openai', name: 'OpenAI (ChatGPT)', url: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'openrouter', name: 'OpenRouter (many AI models)', url: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', name: 'Ollama (free, runs on this computer)', url: 'http://localhost:11434/v1', local: true },
  { id: 'lmstudio', name: 'LM Studio (free, runs on this computer)', url: 'http://localhost:1234/v1', local: true },
  { id: 'custom', name: 'Other (enter its address)' },
];

function setup({ userData, version, getWindow }) {
  const file = path.join(userData, 'ai.json');
  // { provider, models: {id: model}, keys: {id: key}, urls: {id: address} }
  const read = () => {
    let s = {};
    try {
      s = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    // Settings from 1.5.0 had one key, model and address for all services.
    if (!s.keys && (s.key || s.model || s.baseUrl)) {
      const openai = SERVICES.find((x) => x.id === 'openai').url;
      if (s.provider === 'openai' && s.baseUrl && s.baseUrl !== openai) s.provider = 'custom';
      const p = s.provider || 'anthropic';
      s = { provider: p, keys: s.key ? { [p]: { v: s.key, plain: !!s.keyPlain } } : {}, models: s.model ? { [p]: s.model } : {}, urls: s.baseUrl ? { [p]: s.baseUrl } : {} };
    }
    return { provider: 'anthropic', keys: {}, models: {}, urls: {}, ...s };
  };
  const write = (s) => {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  const keyOf = (s, p = s.provider) => {
    const k = s.keys[p];
    if (!k) return '';
    try {
      return k.plain ? Buffer.from(k.v, 'base64').toString('utf8') : safeStorage.decryptString(Buffer.from(k.v, 'base64'));
    } catch {
      return '';
    }
  };
  const service = (s) => SERVICES.find((x) => x.id === s.provider) || SERVICES[0];
  // Where the chosen service answers (a test or "Other" can set its own).
  const urlOf = (s) => s.urls[s.provider] || service(s).url || '';
  const settings = () => {
    const s = read();
    return { provider: s.provider, model: s.models[s.provider] || '', baseUrl: s.provider === 'custom' ? urlOf(s) : '', hasKey: !!keyOf(s), claudeModels: CLAUDE_MODELS, services: SERVICES };
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
    // How an AI app starts the bridge: this program as plain Node.js.
    const launch = mcp.bridgeCommand({ userData, version });
    return { enabled: !!c.enabled, running: !!server, error: serverError, port: mcp.PORT, url: `http://127.0.0.1:${mcp.PORT}/mcp`, token: c.token || '', ...launch };
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
  // Put ShaperBuild into Claude Desktop's settings file, so nobody has to
  // find its Developer settings. Other servers in the file are kept.
  ipcMain.handle('mcp:add-claude-desktop', () => {
    const st = mcpState();
    const files = claudeDesktopConfigs();
    const done = [];
    for (const f of files) {
      let config = {};
      try {
        const text = fs.readFileSync(f, 'utf8');
        if (text.trim()) config = JSON.parse(text);
      } catch (err) {
        if (err.code !== 'ENOENT') return { error: `Could not read ${f}: ${err.message}` };
      }
      config.mcpServers = { ...(config.mcpServers || {}), shaperbuild: { command: st.command, args: st.args, env: st.env } };
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, `${JSON.stringify(config, null, 2)}\n`);
        done.push(f);
      } catch (err) {
        return { error: `Could not write ${f}: ${err.message}` };
      }
    }
    return { files: done };
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
    if ('provider' in patch && SERVICES.some((x) => x.id === patch.provider)) s.provider = patch.provider;
    const p = s.provider;
    if ('model' in patch) s.models[p] = String(patch.model || '').trim();
    if ('baseUrl' in patch) s.urls[p] = String(patch.baseUrl || '').trim();
    if ('key' in patch) {
      const key = String(patch.key || '').trim();
      if (!key) delete s.keys[p];
      else if (safeStorage.isEncryptionAvailable()) s.keys[p] = { v: safeStorage.encryptString(key).toString('base64') };
      // No system keychain (some Linux desktops): kept in this file only.
      else s.keys[p] = { v: Buffer.from(key).toString('base64'), plain: true };
    }
    write(s);
    return settings();
  });

  // The models the chosen service offers (for the list in the settings).
  ipcMain.handle('ai:models', async () => {
    const s = read();
    if (s.provider === 'anthropic') return { models: CLAUDE_MODELS };
    const base = urlOf(s);
    if (!base) return { error: 'Add the address of the AI service in the AI settings first.' };
    try {
      const key = keyOf(s);
      const res = await fetch(`${base.replace(/\/+$/, '')}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { error: `${res.status}: ${body?.error?.message || res.statusText}` };
      // Only chat models: leave out embeddings, speech, pictures and video.
      const skip = /embed|tts|whisper|audio|speech|image|imagen|dall-e|veo|moderation|transcribe|aqa/i;
      const ids = (body?.data || []).map((m) => String(m.id).replace(/^models\//, '')).filter((id) => !skip.test(id));
      return { models: [...new Set(ids)].sort() };
    } catch (err) {
      return { error: describeError(err) };
    }
  });

  // ---- one turn of the chat --------------------------------------------------
  // { system, messages, tools } in the provider's own message format.
  // Returns { message, text, calls: [{ id, name, input }], stop } or { error }.
  ipcMain.handle('ai:chat', async (_e, { system, messages, tools }) => {
    const s = read();
    const key = keyOf(s);
    const model = s.models[s.provider];
    try {
      if (s.provider === 'anthropic') return await claudeTurn({ key, model: model || CLAUDE_MODELS[0], baseUrl: s.urls.anthropic, system, messages, tools });
      return await openaiTurn({ key, model, baseUrl: urlOf(s), system, messages, tools, needsKey: !service(s).local && s.provider !== 'custom' });
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
async function openaiTurn({ key, model, baseUrl, system, messages, tools, needsKey }) {
  if (!baseUrl) return { error: 'Add the address of the AI service in the AI settings first.' };
  if (needsKey && !key) return { error: 'Add your API key in the AI settings first.' };
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

// Where Claude Desktop keeps its settings. The Microsoft Store version on
// Windows keeps them in its own package folder.
function claudeDesktopConfigs() {
  const name = 'claude_desktop_config.json';
  if (process.env.SHAPER_CLAUDE_CONFIG_DIR) return [path.join(process.env.SHAPER_CLAUDE_CONFIG_DIR, name)];
  const home = require('node:os').homedir();
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude', name)];
  if (process.platform !== 'win32') return [path.join(home, '.config', 'Claude', name)];
  const out = [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', name)];
  const packages = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages');
  try {
    for (const d of fs.readdirSync(packages)) if (/^(Anthropic\.)?Claude_/i.test(d)) out.push(path.join(packages, d, 'LocalCache', 'Roaming', 'Claude', name));
  } catch {}
  return out;
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
