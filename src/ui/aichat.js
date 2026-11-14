// The AI assistant: a chat where you say what to build and the AI builds it
// with the same tools you use (see ai/tools.js). It talks to Claude, or to
// any service with an OpenAI-style API (OpenAI, OpenRouter, Ollama, LM
// Studio…). The settings also let other AI apps use ShaperBuild over MCP.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { modal, toast } from './overlays.js';
import { t, tn } from '../core/i18n.js';

const MAX_TURNS = 40;

// What each tool is called in the chat.
const STEP_NAMES = {
  get_design: 'Looked at the design',
  get_body: 'Looked at a body',
  add_shape: 'Add shape',
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  boolean: 'Combine bodies',
  move: 'Move',
  pattern: 'Pattern',
  mirror: 'Mirror',
  set_color: 'Colour',
  rename: 'Rename',
  delete: 'Delete',
  undo: 'Undo',
  screenshot: 'Took a picture',
};

const EXAMPLES = [
  'A 60 × 40 × 6 mm plate with a 4 mm hole in each corner and rounded corners',
  'A cup 80 mm tall and 70 mm wide with 3 mm walls',
  'A simple phone stand',
];

// Tool inputs as plainer JSON schema for OpenAI-style services: some (such
// as Gemini) refuse `anyOf` and `additionalProperties`. A field that takes
// "a number or a name" becomes text; the tools read numbers from text too.
function plainSchema(s) {
  if (Array.isArray(s)) return s.map(plainSchema);
  if (!s || typeof s !== 'object') return s;
  if (s.anyOf) return { type: 'string', ...(s.description ? { description: s.description } : {}) };
  const out = {};
  for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties') out[k] = plainSchema(v);
  return out;
}

export class AiChat {
  constructor(app) {
    this.app = app;
    this.native = window.native;
    this.history = [];
    this.busy = false;
    this.el = h('aside.ai-panel', { hidden: true });
    document.getElementById('viewport').append(this.el);
    // Tool calls from AI apps connected over MCP.
    this.native?.onAiCall?.(async (id, name, input) => {
      if (STEP_NAMES[name] && !name.startsWith('get_')) toast(t('AI app: {step}', { step: t(STEP_NAMES[name]) }), { ms: 1400 });
      this.native.aiResult(id, await app.ai.run(name, input));
    });
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(force) {
    const show = force ?? this.el.hidden;
    this.el.hidden = !show;
    document.getElementById('btn-ai')?.classList.toggle('on', show);
    if (show) this.refresh();
  }

  async refresh() {
    this.config = (await this.native?.aiSettings?.()) || { provider: 'anthropic', hasKey: false };
    this.render();
  }

  get service() {
    const c = this.config || {};
    return c.services?.find((x) => x.id === c.provider) || { id: c.provider };
  }

  get ready() {
    const c = this.config || {};
    if (c.provider === 'anthropic') return !!c.hasKey;
    if (c.provider === 'custom') return !!(c.baseUrl && c.model);
    return !!(c.model && (c.hasKey || this.service.local));
  }

  get modelName() {
    const c = this.config || {};
    if (c.provider === 'anthropic') return c.model || c.claudeModels?.[0] || 'Claude';
    return c.model || '';
  }

  render() {
    clear(this.el);
    const head = h(
      'div.ai-head',
      h('span.ai-title', { html: `${icon('sparkle')}<span>${t('AI assistant')}</span>` }),
      h('span.ai-model', { str: this.ready ? this.modelName : '' }),
      h('button.tb-btn.ai-new', { title: 'New chat', html: icon('plus'), onClick: () => this.reset() }),
      h('button.tb-btn.ai-gear', { title: 'AI settings', html: icon('settings'), onClick: () => this.settings() }),
      h('button.tb-btn', { title: 'Close', html: icon('close'), onClick: () => this.toggle(false) }),
    );
    this.list = h('div.ai-list');
    if (!this.ready) {
      this.list.append(
        h(
          'div.ai-empty',
          h('p', { html: 'Tell the AI what to make — <i>“a box 40 mm wide with a round hole”</i> — and it builds it here, step by step. Every step shows up in History and can be undone.' }),
          h('p', { text: 'Use Claude with your own API key, or another AI service.' }),
          h('button.btn.primary', { text: 'Set up the AI', onClick: () => this.settings() }),
        ),
      );
    } else if (!this.history.length) {
      const ex = h('div.ai-examples');
      for (const e of EXAMPLES) ex.append(h('button.ai-example', { text: e, onClick: () => this.send(t(e)) }));
      this.list.append(h('div.ai-empty', h('p', { text: 'What should we make? Describe it with sizes in millimetres, or try one of these:' }), ex));
    }
    for (const node of this.nodes || []) this.list.append(node);
    this.input = h('textarea.ai-input', { rows: 2, placeholder: this.ready ? 'Describe what to build…' : 'Set up the AI first', disabled: !this.ready });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send(this.input.value);
      }
    });
    this.sendBtn = h('button.btn.primary.ai-send', {
      title: this.busy ? 'Stop' : 'Send (Enter)',
      html: icon(this.busy ? 'stop' : 'send'),
      disabled: !this.ready,
      onClick: () => (this.busy ? this.stop() : this.send(this.input.value)),
    });
    this.el.append(head, this.list, h('div.ai-foot', this.input, this.sendBtn));
    this.scroll();
  }

  scroll() {
    if (this.list) this.list.scrollTop = this.list.scrollHeight;
  }

  add(node) {
    (this.nodes ||= []).push(node);
    if (this.list) {
      this.list.querySelector('.ai-empty')?.remove();
      this.list.append(node);
      this.scroll();
    }
    return node;
  }

  reset() {
    if (this.busy) this.stop();
    this.history = [];
    this.nodes = [];
    this.render();
  }

  stop() {
    this.stopped = true;
  }

  setBusy(busy) {
    this.busy = busy;
    if (!this.sendBtn) return;
    this.sendBtn.innerHTML = icon(busy ? 'stop' : 'send');
    this.sendBtn.title = t(busy ? 'Stop' : 'Send (Enter)');
    this.el.classList.toggle('busy', busy);
  }

  // One request: let the AI think, run the tools it asks for, and repeat
  // until it is done.
  async send(text) {
    text = String(text || '').trim();
    if (!text || this.busy || !this.ready) return;
    if (this.input) this.input.value = '';
    const app = this.app;
    const claude = this.config.provider === 'anthropic';
    const tools = claude ? app.ai.tools : app.ai.tools.filter((tl) => tl.name !== 'screenshot').map((tl) => ({ ...tl, input_schema: plainSchema(tl.input_schema) }));
    this.add(h('div.ai-msg.user', { str: text }));
    this.history.push({ role: 'user', content: text });
    this.setBusy(true);
    this.stopped = false;
    const startSteps = app.doc.past.length;
    const thinking = this.add(h('div.ai-thinking', h('span.pulse'), h('span', { text: 'Thinking…' })));
    let reply = null;
    try {
      for (let turn = 0; turn < MAX_TURNS && !this.stopped; turn++) {
        const res = await this.native.aiChat({ system: this.systemPrompt(), messages: this.history, tools });
        if (this.stopped) break;
        if (res.error) {
          this.add(h('div.ai-msg.error', { str: t(res.error) }));
          break;
        }
        this.history.push(res.message);
        if (res.text?.trim()) reply = this.add(h('div.ai-msg.assistant', { str: res.text.trim() }));
        if (!res.calls.length) break;
        const results = [];
        for (const call of res.calls) {
          const step = this.add(h('div.ai-step', { html: `<span class="dot"></span><span>${t(STEP_NAMES[call.name] || call.name)}</span>` }));
          thinking.remove();
          const out = this.stopped ? { text: 'Stopped by the user', error: true } : await app.ai.run(call.name, call.input);
          step.classList.add(out.error ? 'bad' : 'ok');
          if (out.error) step.append(h('div.ai-step-error', { text: out.text }));
          results.push({ call, out });
        }
        this.list?.append(thinking);
        this.history.push(...this.toolResults(results, claude));
      }
    } catch (err) {
      this.add(h('div.ai-msg.error', { str: err.message }));
    } finally {
      thinking.remove();
      this.setBusy(false);
      if (this.stopped) this.add(h('div.ai-note', { text: 'Stopped.' }));
      this.offerUndo(startSteps, reply);
      this.input?.focus();
    }
  }

  // Tool results in the service's own format.
  toolResults(results, claude) {
    if (!claude) return results.map(({ call, out }) => ({ role: 'tool', tool_call_id: call.id, content: out.text || (out.image ? 'Picture taken (this AI service is not sent pictures).' : '') }));
    return [
      {
        role: 'user',
        content: results.map(({ call, out }) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          ...(out.error ? { is_error: true } : {}),
          content: out.image ? [{ type: 'image', source: { type: 'base64', media_type: out.mime, data: out.image } }, { type: 'text', text: out.text || 'Picture of the design' }] : out.text,
        })),
      },
    ];
  }

  // After the AI changed the design: one button takes back all its steps.
  offerUndo(startSteps, after) {
    const app = this.app;
    const endSteps = app.doc.past.length;
    const n = endSteps - startSteps;
    if (n <= 0) return;
    const btn = h('button.btn.ai-undo', { html: `${icon('undo')}<span>${tn(n, 'Undo this (1 step)', 'Undo this ({n} steps)')}</span>` });
    btn.addEventListener('click', () => {
      if (app.doc.past.length !== endSteps) return toast('The design changed since; use Undo or History instead', { ms: 3000 });
      app.cmd.undo(n);
      btn.disabled = true;
    });
    const row = h('div.ai-actions', btn);
    if (after?.nextSibling) after.after(row);
    else this.add(row);
  }

  systemPrompt() {
    return `${this.app.ai.instructions}\n- The user sees sizes in ${this.app.units}; tools always take millimetres.\n- Reply in the user's language, briefly. When done, say in a sentence or two what you made.`;
  }

  // ---- settings ------------------------------------------------------------

  async settings() {
    const native = this.native;
    if (!native?.aiSettings) return toast('The AI assistant needs the desktop app');
    let c = await native.aiSettings();
    let m = await native.mcpState();
    const body = h('div.ai-settings');
    const row = (label, control, hint) => h('div.form-row', h('label', { text: label }), h('div.ai-field', control, hint ? h('div.ai-hint', { html: hint }) : null));
    const save = async (patch) => {
      c = await native.aiSave(patch);
      this.config = c;
    };
    // The model list of the chosen service, shown as a menu once found.
    let modelStatus = null;
    const findModels = async () => {
      if (!modelStatus) return;
      modelStatus.textContent = t('Looking for models…');
      const res = await native.aiModels();
      if (res.error) {
        modelStatus.textContent = t(res.error);
        return;
      }
      if (!res.models.length) {
        modelStatus.textContent = t('No models found.');
        return;
      }
      if (!c.model || !res.models.includes(c.model)) await save({ model: res.models[0] });
      render(res.models);
    };
    const render = (models = null) => {
      clear(body);
      body.append(h('h4', { text: 'Chat in ShaperBuild' }));
      const svc = c.services.find((x) => x.id === c.provider) || c.services[0];
      const provider = h('select');
      for (const x of c.services) provider.append(h('option', { value: x.id, text: x.name, selected: x.id === svc.id }));
      provider.addEventListener('change', async () => {
        await save({ provider: provider.value });
        render();
        const now = c.services.find((x) => x.id === c.provider);
        if (c.provider !== 'anthropic' && !c.model && (c.hasKey || now?.local)) findModels();
      });
      body.append(row('AI service', provider, svc.local ? 'Free. Install it, download a model in it, and keep it running while you chat.' : null));
      if (svc.id === 'custom') {
        const url = h('input', { type: 'text', value: c.baseUrl, placeholder: 'https://…/v1', spellcheck: false });
        url.addEventListener('change', () => save({ baseUrl: url.value }));
        body.append(row('Address', url, 'The web address of a service with an OpenAI-style API, usually ending in /v1. The services in the list above fill it in by themselves.'));
      }
      modelStatus = null;
      if (svc.id === 'anthropic') {
        const model = h('select');
        for (const id of c.claudeModels) model.append(h('option', { value: id, str: id, selected: id === (c.model || c.claudeModels[0]) }));
        model.addEventListener('change', () => save({ model: model.value }));
        body.append(row('Model', model, 'Opus is the most capable; Sonnet and Haiku are faster and cheaper.'));
      } else {
        const list = models || this.models?.[svc.id];
        if (models) this.models = { ...this.models, [svc.id]: models };
        let model;
        if (list?.length) {
          model = h('select');
          for (const id of list) model.append(h('option', { value: id, str: id, selected: id === c.model }));
        } else model = h('input', { type: 'text', value: c.model, placeholder: 'Model name', spellcheck: false });
        model.addEventListener('change', () => save({ model: model.value }));
        modelStatus = h('span.ai-hint');
        const find = h('button.btn', { text: 'Find models', title: 'List the models this service offers', onClick: findModels });
        body.append(row('Model', h('div', model, h('div.ai-presets', find, modelStatus)), 'Pick a model that can use tools (function calling).'));
      }
      if (!svc.local) {
        const key = h('input', { type: 'password', placeholder: c.hasKey ? '•••••••• (saved)' : svc.id === 'anthropic' ? 'sk-ant-…' : 'Paste the key here', spellcheck: false, autocomplete: 'off' });
        const keyBtns = h(
          'div.ai-presets',
          h('button.btn', {
            text: 'Save key',
            onClick: async () => {
              if (!key.value.trim()) return;
              await save({ key: key.value });
              key.value = '';
              toast('API key saved', { type: 'ok' });
              render();
              if (svc.id !== 'anthropic' && !c.model) findModels();
            },
          }),
          c.hasKey
            ? h('button.btn', {
                text: 'Remove key',
                onClick: async () => {
                  await save({ key: '' });
                  render();
                },
              })
            : null,
        );
        const where = svc.keyUrl ? `${t('Get a key at')} <a href="#" data-url="${svc.keyUrl}">${new URL(svc.keyUrl).host}</a>. ` : '';
        const cost = svc.id === 'anthropic' ? t('You pay Anthropic for what you use; a request usually costs a few cents.') : svc.id === 'gemini' ? t('Google has a free tier with daily limits.') : '';
        body.append(row('API key', h('div', key, keyBtns), `${where}${cost} ${t('Each service keeps its own key, stored encrypted on this computer.')}`));
      }

      body.append(h('h4', { text: 'Other AI apps (MCP)' }));
      const on = h('input', { type: 'checkbox', checked: m.enabled });
      on.addEventListener('change', async () => {
        m = await native.mcpSet(on.checked);
        render();
      });
      body.append(h('label.toggle', on, h('span', { text: 'Let AI apps use ShaperBuild (Claude Desktop, Claude Code, Cursor and other apps that support MCP)' })));
      if (m.enabled) {
        if (m.error) body.append(h('div.ai-hint.bad', { str: t(m.error) }));
        const desktop = JSON.stringify({ mcpServers: { shaperbuild: { command: m.command, args: m.args, env: m.env } } }, null, 2);
        const code = `claude mcp add --transport http shaperbuild ${m.url} --header "Authorization: Bearer ${m.token}"`;
        const snippet = (title, hint, text) =>
          h(
            'div.ai-snippet',
            h('div.ai-snippet-head', h('b', { text: title }), h('button.btn', { text: 'Copy', onClick: () => navigator.clipboard.writeText(text).then(() => toast('Copied', { ms: 1200 })) })),
            h('div.ai-hint', { html: hint }),
            h('pre', { str: text }),
          );
        const add = h('button.btn.primary', {
          text: 'Add to Claude Desktop',
          onClick: async () => {
            const res = await native.mcpAddClaudeDesktop();
            if (res.error) return toast(res.error, { type: 'error', ms: 6000 });
            added.hidden = false;
          },
        });
        const added = h('div.ai-hint.ok', {
          hidden: true,
          text: 'Added. Now quit Claude Desktop completely (on Windows: right-click its icon by the clock and choose Quit) and open it again. Then ask Claude to build something in ShaperBuild, and keep ShaperBuild open.',
        });
        body.append(
          h(
            'div.ai-snippet',
            h('div.ai-snippet-head', h('b', { text: 'Claude Desktop' }), add),
            h('div.ai-hint', { text: 'One click puts ShaperBuild into Claude Desktop’s settings.' }),
            added,
          ),
          h(
            'details.ai-manual',
            h('summary', { text: 'Or add it by hand' }),
            snippet('claude_desktop_config.json', 'In Claude Desktop: Settings → Developer → Edit Config (on Windows the settings are under the menu at the top left, File → Settings). Add this to the file and restart Claude.', desktop),
          ),
          snippet('Claude Code', 'Run this in a terminal:', code),
          snippet('Other apps', 'Server address (HTTP) and the header to send:', `${m.url}\nAuthorization: Bearer ${m.token}`),
          h('div.ai-presets', h('button.btn', { text: 'Make a new token', title: 'Apps using the old token stop working until you update them', onClick: async () => ((m = await native.mcpNewToken()), render()) })),
        );
      }
      for (const a of body.querySelectorAll('a[data-url]'))
        a.addEventListener('click', (e) => {
          e.preventDefault();
          native.openUrl(a.dataset.url);
        });
    };
    render();
    await modal({ title: 'AI assistant', body, width: 640, buttons: [{ label: 'Done', primary: true }] });
    await this.refresh();
  }
}
