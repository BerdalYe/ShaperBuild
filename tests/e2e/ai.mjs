// End-to-end: the AI assistant. Its tools build in the real app; the chat
// panel runs a whole request against stand-in AI services (Claude's API
// and an OpenAI-style one) on this computer; AI apps connect over MCP, both
// over HTTP and through `ShaperBuild --mcp`.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { launch, shot, ROOT, OUT } from './harness.mjs';

const dataDir = fs.mkdtempSync(path.join(OUT, 'profile-'));
const { win, errors, close } = await launch({ userData: dataDir });
const step = (msg) => console.log(`• ${msg}`);
const A = (fn, arg) => win.evaluate(fn, arg);
const run = (name, input) => A(([n, i]) => window.__shaper.ai.run(n, i), [name, input]);
const json = async (name, input) => {
  const r = await run(name, input);
  assert.ok(!r.error, `${name}: ${r.text}`);
  return JSON.parse(r.text);
};
const vol = (id) =>
  A(async (id) => {
    const a = window.__shaper;
    const r = await a.kernel.call('measure', { items: [{ kind: 'body', id: a.doc.body(id).shapeId }] });
    return r.items[0].volume;
  }, id);
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// A stand-in AI service: answers each request with the next scripted reply
// and keeps what it was sent.
function fakeService(replies, models = []) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }));
      }
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const claudeReply = (content, stop = 'tool_use') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });

try {
  await A(() => window.__shaper.home.hide());

  step('AI tools build a plate with holes, rounded corners and a chamfer');
  const plate = await json('add_shape', { shape: 'box', width: 60, depth: 40, height: 10, name: 'Plate' });
  const id = plate.created[0].id;
  assert.deepEqual(plate.created[0].size, [60, 40, 10]);
  const sk = await json('sketch', { body_id: id, face: 'top', shapes: [-20, 20].map((x) => ({ type: 'circle', x, y: 0, radius: 4 })) });
  assert.equal(sk.regions.length, 2);
  near(sk.plane.origin[2], 10, 1e-6);
  await json('extrude', { sketch_id: sk.id, regions: 'all', distance: -10, mode: 'subtract' });
  near(await vol(id), 60 * 40 * 10 - 2 * Math.PI * 16 * 10, 0.5);
  await json('fillet', { body_id: id, edges: 'vertical', radius: 5 });
  await json('chamfer', { body_id: id, edges: 'top', distance: 1 });
  const body = await json('get_body', { body_id: id });
  assert.ok(body.faces.length > 10 && body.edges.length > 20);
  assert.deepEqual(
    await A(() => window.__shaper.history.features.map((f) => f.label)),
    ['Box', 'Extrude', 'Fillet', 'Chamfer'],
    'every AI step is a History step',
  );

  step('mistakes come back as messages the AI can read');
  const bad = await run('fillet', { body_id: 'b99', edges: 'all', radius: 1 });
  assert.equal(bad.error, true);
  assert.match(bad.text, /No body "b99"\. Bodies: b1/);
  const noRegion = await run('extrude', { sketch_id: sk.id, regions: [5], distance: 3 });
  assert.match(noRegion.text, /has no region 5/);

  step('a cup: revolve, shell, colour, a picture');
  const prof = await json('sketch', { plane: 'XZ', shapes: [{ type: 'rect', x: 100 + 20, y: 30, width: 40, height: 60 }] });
  const cup = await json('revolve', { sketch_id: prof.id, axis: 'Z', mode: 'new' });
  assert.equal(cup.created.length, 1);
  const cupId = (await json('add_shape', { shape: 'cylinder', radius: 30, height: 60, position: [0, 120, 0] })).created[0].id;
  await json('shell', { body_id: cupId, open_faces: ['top'], thickness: 3 });
  near(await vol(cupId), Math.PI * 900 * 60 - Math.PI * 27 * 27 * 57, 1);
  await json('set_color', { body_ids: [cupId], color: '#e53935' });
  const pic = await run('screenshot', { view: 'iso' });
  assert.equal(pic.mime, 'image/jpeg');
  assert.ok(pic.image.length > 5000 && pic.image.length < 400000, `picture size ${pic.image.length}`);
  await json('undo', { steps: 1 });
  assert.equal(await A((cid) => window.__shaper.doc.body(cid).color ?? null, cupId), null, 'the colour was undone');

  step('the chat panel without a service set up asks to set one up');
  await win.locator('#btn-ai').click();
  await win.waitForSelector('.ai-panel:not([hidden]) .ai-empty');
  assert.match(await win.locator('.ai-panel .ai-empty').innerText(), /Set up the AI/);

  step('chat with Claude: the AI calls tools, sees the results, and answers');
  const claude = await fakeService([
    claudeReply([
      { type: 'text', text: 'Making a 30 mm cube.' },
      { type: 'tool_use', id: 'tu_1', name: 'add_shape', input: { shape: 'box', width: 30, depth: 30, height: 30, position: [0, -120, 0], name: 'Cube' } },
    ]),
    claudeReply([{ type: 'tool_use', id: 'tu_2', name: 'fillet', input: { body_id: 'Cube', edges: 'all', radius: 3 } }]),
    claudeReply([{ type: 'text', text: 'Done: a 30 mm cube with rounded edges.' }], 'end_turn'),
  ]);
  const saved = await A(async (url) => {
    await window.native.aiSave({ provider: 'anthropic', model: 'claude-opus-5-5', baseUrl: url, key: 'sk-ant-test-key' });
    return window.native.aiSettings();
  }, claude.url);
  assert.equal(saved.hasKey, true);
  assert.equal(saved.key, undefined, 'the key never reaches the window');
  assert.ok(!fs.readFileSync(path.join(dataDir, 'ai.json'), 'utf8').includes('sk-ant-test-key'), 'the key is not stored as typed');
  await A(() => window.__shaper.aiChat.refresh());
  await win.locator('.ai-input').fill('A 30 mm cube with rounded edges');
  await win.locator('.ai-input').press('Enter');
  await win.waitForSelector('.ai-msg.assistant >> text=Done: a 30 mm cube', { timeout: 60000 });
  const cube = await A(() => window.__shaper.doc.bodies.find((b) => b.name === 'Cube'));
  assert.ok(cube, 'the cube was made');
  assert.ok((await vol(cube.id)) < 27000 - 50, 'its edges were rounded');
  assert.equal(claude.seen.length, 3);
  const first = claude.seen[0];
  assert.equal(first.url, '/v1/messages');
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.match(String(first.headers.authorization || first.headers['x-api-key']), /sk-ant-test-key/);
  assert.ok(first.body.tools.some((tl) => tl.name === 'extrude' && tl.input_schema.properties.distance));
  assert.match(first.body.system, /millimetres/);
  assert.deepEqual(first.body.messages, [{ role: 'user', content: 'A 30 mm cube with rounded edges' }]);
  // The tool result goes back with the id of the call, after Claude's own message.
  const second = claude.seen[1].body.messages;
  assert.equal(second[1].role, 'assistant');
  assert.equal(second[1].content[1].id, 'tu_1');
  assert.equal(second[2].content[0].tool_use_id, 'tu_1');
  assert.match(second[2].content[0].content, /"name":"Cube"/);
  assert.equal(await win.locator('.ai-step.ok').count(), 2);
  await shot(win, '90-ai-chat');

  step('one button undoes everything the AI just did');
  const bodiesBefore = await A(() => window.__shaper.doc.bodies.length);
  await win.locator('.ai-undo').click();
  assert.equal(await A(() => window.__shaper.doc.bodies.length), bodiesBefore - 1);
  assert.equal(await A(() => window.__shaper.doc.bodies.some((b) => b.name === 'Cube')), false);
  claude.server.close();

  step('chat with an OpenAI-style service (Ollama, LM Studio, OpenAI…)');
  const other = await fakeService([
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_shape', arguments: JSON.stringify({ shape: 'sphere', radius: 8, position: [0, -60, 0], name: 'Ball' }) } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Here is your ball.' } }] },
  ]);
  await A(async (url) => {
    await window.native.aiSave({ provider: 'custom', baseUrl: url, model: 'llama3.1', key: '' });
    await window.__shaper.aiChat.refresh();
    window.__shaper.aiChat.reset();
  }, other.url);
  await win.locator('.ai-input').fill('a ball');
  await win.locator('.ai-input').press('Enter');
  await win.waitForSelector('.ai-msg.assistant >> text=Here is your ball', { timeout: 60000 });
  assert.ok(await A(() => window.__shaper.doc.bodies.some((b) => b.name === 'Ball')));
  assert.equal(other.seen[0].url, '/chat/completions');
  assert.equal(other.seen[0].body.messages[0].role, 'system');
  assert.ok(!other.seen[0].body.tools.some((tl) => tl.function.name === 'screenshot'), 'no pictures for services that may not read them');
  assert.deepEqual(other.seen[1].body.messages.at(-1).role, 'tool');
  assert.equal(other.seen[1].body.messages.at(-1).tool_call_id, 'call_1');
  other.server.close();

  step('Google Gemini: its own key, a model from its list, plain tool inputs it accepts');
  const gemini = await fakeService(
    [
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'g1', type: 'function', function: { name: 'add_shape', arguments: JSON.stringify({ shape: 'box', width: 10, depth: 10, height: 10, position: [0, 60, 0], name: 'Gem' }) } }] } }] },
      { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'g2', type: 'function', function: { name: 'fillet', arguments: JSON.stringify({ body_id: 'Gem', edges: '0,1', radius: 1 }) } }] } }] },
      { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'A small rounded box.' } }] },
    ],
    ['models/gemini-test-flash', 'models/gemini-test-pro', 'models/text-embedding-004', 'models/imagen-test'],
  );
  await A(async (url) => {
    await window.native.aiSave({ provider: 'gemini', baseUrl: url, key: 'AIza-test-key' });
    window.__shaper.aiChat.reset();
  }, gemini.url);
  await win.locator('.ai-gear').click();
  await win.waitForSelector('.ai-settings');
  assert.equal(await win.locator('.ai-settings select').first().inputValue(), 'gemini');
  assert.match(await win.locator('.ai-settings').innerText(), /aistudio\.google\.com/);
  assert.equal(await win.locator('.ai-settings input[placeholder="https://…/v1"]').count(), 0, 'no address to fill in for Gemini');
  await win.locator('.ai-settings .btn', { hasText: 'Find models' }).click();
  await win.waitForSelector('.ai-settings select >> nth=1');
  const offered = await win.locator('.ai-settings select').nth(1).locator('option').allInnerTexts();
  assert.deepEqual(offered, ['gemini-test-flash', 'gemini-test-pro'], 'chat models only');
  await shot(win, '92-ai-gemini');
  await win.locator('.modal .btn.primary', { hasText: 'Done' }).click();
  const keys = await A(async () => {
    const g = await window.native.aiSettings();
    await window.native.aiSave({ provider: 'anthropic' });
    const c = await window.native.aiSettings();
    await window.native.aiSave({ provider: 'gemini' });
    await window.__shaper.aiChat.refresh();
    return { gemini: g.hasKey, model: g.model, claude: c.hasKey };
  });
  assert.deepEqual(keys, { gemini: true, model: 'gemini-test-flash', claude: true }, 'each service keeps its own key');
  await win.locator('.ai-input').fill('a small box with rounded edges');
  await win.locator('.ai-input').press('Enter');
  await win.waitForSelector('.ai-msg.assistant >> text=A small rounded box', { timeout: 60000 });
  const sent = gemini.seen.filter((x) => x.url.endsWith('/chat/completions'));
  assert.equal(sent[0].headers.authorization, 'Bearer AIza-test-key', 'the Gemini key, not the Claude one');
  assert.equal(sent[0].body.model, 'gemini-test-flash');
  const schemas = JSON.stringify(sent[0].body.tools);
  assert.ok(!schemas.includes('anyOf') && !schemas.includes('additionalProperties'), 'tool inputs Gemini accepts');
  assert.match(sent[1].body.messages.at(-1).content, /"name":"Gem"/);
  assert.match(sent[2].body.messages.at(-1).content, /"changed"/, 'edges given as text "0,1" were rounded');
  gemini.server.close();

  step('the settings show how to connect AI apps over MCP');
  await win.locator('.ai-gear').click();
  await win.waitForSelector('.ai-settings');
  await win.locator('.ai-settings label.toggle input').check();
  await win.waitForSelector('.ai-snippet');
  const snippets = await win.locator('.ai-snippet pre').allInnerTexts();
  assert.match(snippets[0], /"mcpServers"[\s\S]*"--mcp"/);
  assert.match(snippets[1], /claude mcp add --transport http shaperbuild http:\/\/127\.0\.0\.1:45839\/mcp --header "Authorization: Bearer [\w-]{20,}"/);
  await shot(win, '91-ai-settings');
  await win.keyboard.press('Escape');
  const mcp = await A(() => window.native.mcpState());
  assert.equal(mcp.running, true);

  step('an AI app builds over MCP (HTTP)');
  const rpc = (body, headers = {}) =>
    fetch(mcp.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mcp.token}`, ...headers }, body: JSON.stringify(body) });
  const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })).json();
  assert.equal(init.result.serverInfo.name, 'shaperbuild');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.match(init.result.instructions, /millimetres/);
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.ok(list.result.tools.some((tl) => tl.name === 'sketch' && tl.inputSchema.type === 'object'));
  const made = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_shape', arguments: { shape: 'cylinder', radius: 5, height: 50, position: [80, 0, 0], name: 'Peg' } } })).json();
  assert.equal(made.result.isError, false);
  assert.match(made.result.content[0].text, /"name":"Peg"/);
  assert.ok(await A(() => window.__shaper.doc.bodies.some((b) => b.name === 'Peg')));
  const picture = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'screenshot', arguments: { view: 'top' } } })).json();
  assert.equal(picture.result.content[0].type, 'image');
  assert.equal(picture.result.content[0].mimeType, 'image/jpeg');
  const oops = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'boolean', arguments: { operation: 'union', body_ids: ['Peg'] } } })).json();
  assert.equal(oops.result.isError, true);

  step('without the token, or from a web page, the server says no');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { Origin: 'https://example.com' })).status, 403);

  step('Claude Desktop style: `ShaperBuild --mcp` passes messages to the open app');
  const electronPath = createRequire(import.meta.url)('electron');
  const bridge = spawn(electronPath, [ROOT, '--mcp', '--no-sandbox', `--user-data-dir=${dataDir}`], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  let buf = '';
  bridge.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const ask = async (msg) => {
    bridge.stdin.write(`${JSON.stringify(msg)}\n`);
    const t0 = Date.now();
    while (!lines.some((l) => l.id === msg.id)) {
      if (Date.now() - t0 > 30000) throw new Error(`no answer to ${msg.method}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return lines.find((l) => l.id === msg.id);
  };
  const binit = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'desktop', version: '1' } } });
  assert.equal(binit.result.protocolVersion, '2024-11-05');
  bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  assert.equal((await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, list.result.tools.length);
  const bmade = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_shape', arguments: { shape: 'box', width: 5, depth: 5, height: 5, position: [0, 0, 60], name: 'Bridge box' } } });
  assert.equal(bmade.result.isError, false, bmade.result.content?.[0]?.text);
  assert.ok(await A(() => window.__shaper.doc.bodies.some((b) => b.name === 'Bridge box')));
  bridge.stdin.end();
  await new Promise((r) => bridge.on('exit', r));

  step('turning it off stops the server');
  await A(() => window.native.mcpSet(false));
  await assert.rejects(rpc({ jsonrpc: '2.0', id: 8, method: 'tools/list' }));

  assert.deepEqual(errors, [], `renderer errors:\n${errors.join('\n')}`);
  console.log('\nai: all passed');
} catch (err) {
  await shot(win, 'zz-ai-failure').catch(() => {});
  console.error('\nai FAILED:', err.stack || err.message);
  if (errors.length) console.error('renderer errors:\n' + errors.join('\n'));
  process.exitCode = 1;
} finally {
  await close();
}
