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
// A stand-in for Claude Desktop's settings folder, with a server of its own.
const claudeDir = fs.mkdtempSync(path.join(OUT, 'claude-desktop-'));
fs.writeFileSync(path.join(claudeDir, 'claude_desktop_config.json'), JSON.stringify({ mcpServers: { other: { command: 'other-app' } }, theme: 'dark' }));
process.env.SHAPER_CLAUDE_CONFIG_DIR = claudeDir;
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

  step('richer shapes: rounded rect, slot, ellipse, spline; sketches stay apart and hide when used');
  const sA = await json('sketch', { plane: 'XY', shapes: [{ type: 'rect', x: 300, y: 0, width: 40, height: 30, corner_radius: 5 }] });
  const sB = await json('sketch', { plane: 'XY', shapes: [{ type: 'slot', x: 300, y: 60, length: 40, width: 10, angle: 30 }, { type: 'ellipse', x: 300, y: 100, radius_x: 10, radius_y: 5 }] });
  assert.notEqual(sA.id, sB.id, 'a second sketch on the same plane is a new sketch');
  assert.equal(sA.extrude_direction, '+Z');
  near(sA.regions[0].area, 40 * 30 - (4 - Math.PI) * 25, 0.05);
  const areas = sB.regions.map((r) => r.area).sort((a, b) => a - b);
  near(areas[0], Math.PI * 50, 0.05);
  near(areas[1], 30 * 10 + Math.PI * 25, 0.05);
  const tray = await json('extrude', { sketch_id: sA.id, distance: 8 });
  assert.deepEqual(tray.created[0].size, [40, 30, 8]);
  assert.equal(await A((sid) => window.__shaper.doc.sketch(sid).visible, sA.id), false, 'the used sketch is hidden');
  await json('undo', {});
  assert.notEqual(await A((sid) => window.__shaper.doc.sketch(sid).visible, sA.id), false, 'undo shows it again');
  const knob = await json('sketch', { plane: 'XZ', shapes: [{ type: 'line', from: [0, 0], to: [8, 0] }, { type: 'spline', points: [[8, 0], [10, 6], [6, 12], [0, 14]] }, { type: 'line', from: [0, 14], to: [0, 0] }] });
  assert.equal(knob.regions.length, 1, 'lines and a spline close a region');
  assert.equal(knob.extrude_direction, '-Y');

  step('loft, sweep, a turned shape, four views, and parts that touch nothing');
  const l0 = await json('sketch', { plane: 'XY', shapes: [{ type: 'rect', x: 400, y: 0, width: 30, height: 30 }] });
  const l1 = await json('sketch', { plane: 'XY', offset: 40, shapes: [{ type: 'circle', x: 400, y: 0, radius: 8 }] });
  const loft = await json('loft', { profiles: [{ sketch_id: l0.id }, { sketch_id: l1.id }] });
  assert.equal(loft.created.length, 1);
  near(loft.created[0].size[2], 40, 0.01);
  const route = await json('sketch', { plane: 'XZ', shapes: [{ type: 'line', from: [500, 0], to: [500, 30] }, { type: 'arc', x: 520, y: 30, radius: 20, start_angle: 90, end_angle: 180 }] });
  const ring = await json('sketch', { plane: 'XY', shapes: [{ type: 'circle', x: 500, y: 0, radius: 3 }] });
  const pipe = await json('sweep', { sketch_id: ring.id, path_sketch_id: route.id });
  assert.equal(pipe.created.length, 1);
  near(pipe.created[0].max[0], 520, 2);
  near(pipe.created[0].max[2], 53, 2);
  const axle = await json('add_shape', { shape: 'cylinder', radius: 5, height: 50, position: [600, 0, 20], rotation: [0, 90, 0] });
  assert.deepEqual(axle.created[0].size, [50, 10, 10], 'turned to lie along X');
  const design = await json('get_design', {});
  assert.ok(design.not_touching_other_bodies.includes(axle.created[0].id));
  assert.ok(design.sketches.find((s) => s.id === l0.id).hidden);
  const four = await run('screenshot', {});
  assert.match(four.text, /Four views/);
  const dims = await A(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, four.image);
  assert.deepEqual(dims, [960, 720]);
  await shot(win, 'ai-four-views');

  step('stars, walls, holes, copies; only filled regions are extruded');
  const orn = await json('sketch', {
    plane: 'XY',
    shapes: [
      { type: 'circle', x: 800, y: 0, radius: 30, wall: 3 },
      { type: 'rect', x: 800, y: -20, width: 50, height: 14 },
      { type: 'rect', x: 800, y: -20, width: 4, height: 4, hole: true },
      { type: 'star', x: 800, y: 10, tips: 5, radius: 8, inner_radius: 4 },
      { type: 'rect', x: 800, y: 22, width: 1.5, height: 12 },
    ],
  });
  const filledAreas = orn.regions.filter((r) => r.filled);
  assert.ok(filledAreas.length >= 3 && filledAreas.length < orn.regions.length, 'the inside of the ring and the window are not filled');
  const ornBody = await json('extrude', { sketch_id: orn.id, distance: 3 });
  assert.equal(ornBody.created.length, 1, `one piece: ${JSON.stringify(ornBody)}`);
  assert.equal(ornBody.note, undefined);
  const want = Math.PI * (900 - 27 * 27) + (50 * 14 - 16 - 0) + 5 * 8 * 4 * Math.sin(Math.PI / 5);
  // Ring + snow block (minus the window, minus what is outside the circle) + star + stem: just check it is a ring, not a disc.
  assert.ok((await vol(ornBody.created[0].id)) < Math.PI * 900 * 3 * 0.6, 'the middle of the ring stays open');
  assert.ok((await vol(ornBody.created[0].id)) > Math.PI * (900 - 27 * 27) * 3, `at least the ring (${want})`);
  const apart = await json('sketch', { plane: 'XY', shapes: [{ type: 'circle', x: 900, y: 0, radius: 3, repeat: { count: 3, dx: 10 } }, { type: 'slot', x: 900, y: 20, length: 12, width: 4, angle: 30, mirror: 'x' }] });
  assert.equal(apart.regions.length, 5, 'three repeated circles and a slot mirrored around x = 0');
  assert.ok(apart.regions.some((r) => Math.abs(r.center[0] + 900) < 0.01), 'the mirrored copy is at x = -900');
  const spread = await json('extrude', { sketch_id: apart.id, distance: 2 });
  assert.equal(spread.created.length, 5);
  assert.match(spread.note, /5 separate bodies/);

  step('twisted and nested stars');
  const tw = await json('sketch', { plane: 'XY', shapes: [{ type: 'star', x: 1000, y: 0, tips: 6, radius: 20, inner_radius: 12, wall: 1.5 }] });
  assert.deepEqual(tw.regions.map((r) => r.filled).sort(), [false, true]);
  const twisted = await json('extrude', { sketch_id: tw.id, distance: 40, twist: 90, end_scale: 0.7 });
  near(twisted.created[0].size[2], 40, 0.01);
  near((twisted.created[0].min[0] + twisted.created[0].max[0]) / 2, 1000, 0.5);
  const shells = await json('sketch', { plane: 'XY', shapes: [0, 1].map((i) => ({ type: 'star', x: 1100, y: 0, tips: 5, radius: 30, inner_radius: 15, offset: -i * 1.6, wall: 1.2 })) });
  assert.equal(shells.regions.filter((r) => r.filled).length, 2, 'two thin shells');
  const nested = await json('extrude', { sketch_id: shells.id, distance: 8, taper: 8, mode: 'new' });
  assert.equal(nested.created.length, 2, 'the shells stay apart');
  const [big, small] = nested.created.sort((a, b) => b.size[0] - a.size[0]);
  assert.ok(big.max[1] <= 30 + 1e-3, 'the shells lean in, not out');
  assert.ok(small.max[1] < big.max[1] - 1.5);
  const thick = await run('sketch', { plane: 'XY', shapes: [{ type: 'circle', x: 0, y: 0, radius: 2, wall: 3 }] });
  assert.match(thick.text, /wall is too thick/);

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
  const snippets = await win.locator('.ai-snippet pre').allTextContents();
  assert.match(snippets[0], /"mcpServers"[\s\S]*mcp-bridge\.cjs[\s\S]*"ELECTRON_RUN_AS_NODE": "1"/);
  assert.match(snippets[1], /claude mcp add --transport http shaperbuild http:\/\/127\.0\.0\.1:45839\/mcp --header "Authorization: Bearer [\w-]{20,}"/);
  await win.locator('.ai-settings .btn', { hasText: 'Add to Claude Desktop' }).click();
  await win.waitForSelector('.ai-hint.ok:not([hidden])');
  const desktopConfig = JSON.parse(fs.readFileSync(path.join(claudeDir, 'claude_desktop_config.json'), 'utf8'));
  assert.deepEqual(desktopConfig.mcpServers.other, { command: 'other-app' }, 'other servers are kept');
  assert.equal(desktopConfig.theme, 'dark');
  assert.match(desktopConfig.mcpServers.shaperbuild.args[0], /mcp-bridge\.cjs$/);
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
  assert.match(init.result.instructions, /Millimetres/);
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

  // Claude Desktop starts the bridge from its settings file, with pipes for
  // input and output. Both ways must work: what "Add to Claude Desktop"
  // writes (plain Node.js), and `ShaperBuild --mcp` from older settings.
  const electronPath = createRequire(import.meta.url)('electron');
  const desktop = desktopConfig.mcpServers.shaperbuild;
  assert.equal(desktop.env.ELECTRON_RUN_AS_NODE, '1');
  assert.ok(fs.existsSync(desktop.args[0]), `the bridge file exists: ${desktop.args[0]}`);
  const ways = [
    ['from the settings Claude Desktop got', desktop.command, desktop.args, desktop.env],
    ['`ShaperBuild --mcp` (older settings)', electronPath, [ROOT, '--mcp', '--no-sandbox', `--user-data-dir=${dataDir}`], {}],
  ];
  for (const [n, [label, command, args, env]] of ways.entries()) {
    step(`Claude Desktop style, ${label}: the bridge passes messages to the open app`);
    const bridge = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const lines = [];
    let buf = '';
    let stderr = '';
    bridge.stderr.on('data', (c) => (stderr += c));
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
        if (Date.now() - t0 > 30000) throw new Error(`no answer to ${msg.method}; stderr: ${stderr}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      return lines.find((l) => l.id === msg.id);
    };
    const binit = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'desktop', version: '1' } } });
    assert.equal(binit.result.protocolVersion, '2024-11-05');
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    assert.equal((await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.length, list.result.tools.length);
    const name = `Bridge box ${n}`;
    const bmade = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_shape', arguments: { shape: 'box', width: 5, depth: 5, height: 5, position: [n * 10, 0, 60], name } } });
    assert.equal(bmade.result.isError, false, bmade.result.content?.[0]?.text);
    assert.ok(await A((nm) => window.__shaper.doc.bodies.some((b) => b.name === nm), name));
    bridge.stdin.end();
    await new Promise((r) => bridge.on('exit', r));
  }

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
