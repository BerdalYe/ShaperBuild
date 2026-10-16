// The tools menu on the right side: labeled tools grouped by section, and a
// search box that finds tools and commands by name or purpose.
import { h, clear, modKey, isMac } from './dom.js';
import { showCombo } from '../core/keymap.js';
import { icon } from './icons.js';
import { attachTooltip, hideTooltip } from './overlays.js';
import { TOOL_SECTIONS } from '../tools/registry.js';
import { appCommands, matchScore } from './commandlist.js';
import { t } from '../core/i18n.js';

const COLLAPSED_KEY = 'shaperbuild.toolsCollapsed';

export class ToolsMenu {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.buttons = new Map();
    this.sectionEls = new Map();
    this.results = [];
    this.cursor = 0;
    try {
      this.collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
    } catch {
      this.collapsed = new Set();
    }
    this.render();
    app.tools.on('change', () => this.updateActive());
  }

  render() {
    clear(this.el);
    this.buttons.clear();
    this.sectionEls.clear();
    this.input = h('input.ts-input', { type: 'text', placeholder: 'Search tools', spellcheck: false, 'aria-label': 'Search tools and commands' });
    const search = h('label.tools-search', { html: icon('search') }, this.input, h('kbd', { text: `${modKey()}K` }));
    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (e) => this.onSearchKey(e));
    this.input.addEventListener('focus', () => this.input.select());
    this.resultsEl = h('div.ts-results', { hidden: true });
    const sections = h('div.tools-sections');
    for (const section of TOOL_SECTIONS) {
      const grid = h('div.tools-grid');
      for (const tool of section.tools) {
        const b = h('button.tool-btn', { 'aria-label': tool.label }, h('span.tb-ic', { html: icon(tool.icon) }), h('span.tb-label', { text: tool.short || tool.label }));
        b.dataset.tool = tool.id;
        attachTooltip(b, () => {
          const key = this.app.keyFor(`tool:${tool.id}`);
          return `<b>${t(tool.label)}</b>${key ? `<span class="kbd">${showCombo(key, isMac())}</span>` : ''}<span class="desc">${t(tool.desc || '')}</span>`;
        });
        b.addEventListener('click', () => this.app.tools.activate(tool.id));
        grid.append(b);
        this.buttons.set(tool.id, b);
      }
      const chevron = h('span.tt-chev', { html: icon('chevronDown') });
      const title = h('button.tools-title', chevron, h('span', { text: section.title }), h('span.tt-sub', { text: section.subtitle || '' }));
      const el = h(`div.tools-section${this.collapsed.has(section.title) ? '.collapsed' : ''}`, title, grid);
      el.dataset.section = section.title;
      title.addEventListener('click', () => {
        el.classList.toggle('collapsed');
        if (el.classList.contains('collapsed')) this.collapsed.add(section.title);
        else this.collapsed.delete(section.title);
        try {
          localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...this.collapsed]));
        } catch {}
      });
      this.sectionEls.set(section.title, el);
      sections.append(el);
    }
    this.sectionsEl = sections;
    this.el.append(search, this.resultsEl, sections);
    this.setLabels(this.app.settings.toolLabels !== false);
    this.updateActive();
  }

  setLabels(on) {
    this.el.classList.toggle('compact', !on);
  }

  updateActive() {
    const id = this.app.tools.activeId;
    for (const [tid, b] of this.buttons) b.classList.toggle('active', tid === id);
  }

  // Put the cursor in the search box (Ctrl+K).
  focusSearch() {
    if (this.app.visual) this.app.setVisualization(false);
    this.input.focus();
    this.input.select();
  }

  entries() {
    const tools = [];
    for (const s of TOOL_SECTIONS) {
      for (const tool of s.tools) {
        tools.push({ label: tool.label, icon: tool.icon, kbd: showCombo(this.app.keyFor(`tool:${tool.id}`), isMac()), keywords: tool.keywords, desc: tool.desc, group: s.title, run: () => this.app.tools.activate(tool.id, { force: true }) });
      }
    }
    const cmds = appCommands(this.app).map((c) => ({ ...c, group: 'Command' }));
    // Search in the chosen language, and in English too.
    return [...tools, ...cmds].map((e) => ({ ...e, label: t(e.label), desc: t(e.desc || ''), keywords: [e.keywords || '', t(e.keywords || ''), e.label].join(' ') }));
  }

  filter() {
    const q = this.input.value.trim();
    clear(this.resultsEl);
    if (!q) {
      this.results = [];
      this.resultsEl.hidden = true;
      this.sectionsEl.hidden = false;
      return;
    }
    this.results = this.entries()
      .map((e) => ({ e, s: matchScore(q, e) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map((r) => r.e);
    this.cursor = 0;
    this.sectionsEl.hidden = true;
    this.resultsEl.hidden = false;
    if (!this.results.length) {
      this.resultsEl.append(h('div.ts-empty', { text: t('Nothing found for “{q}”. Try words like hole, round, copy or print.', { q }) }));
      return;
    }
    this.results.forEach((r, i) => {
      const row = h('button.ts-row', h('span.ts-ic', { html: icon(r.icon) }), h('span.ts-label', h('b', { str: r.label }), h('small', { text: r.group === 'Command' ? 'Command' : t('{group} tool', { group: t(r.group) }) })), r.kbd ? h('kbd', { str: r.kbd }) : null);
      row.addEventListener('mouseenter', () => this.setCursor(i));
      row.addEventListener('click', () => this.run(r));
      this.resultsEl.append(row);
    });
    this.setCursor(0);
  }

  setCursor(i) {
    this.cursor = i;
    [...this.resultsEl.querySelectorAll('.ts-row')].forEach((r, j) => r.classList.toggle('on', j === i));
    this.resultsEl.querySelectorAll('.ts-row')[i]?.scrollIntoView({ block: 'nearest' });
  }

  onSearchKey(e) {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.results.length) return;
      const n = this.results.length;
      this.setCursor((this.cursor + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.results[this.cursor];
      if (r) this.run(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.clearSearch();
    }
  }

  run(r) {
    hideTooltip();
    this.clearSearch();
    r.run();
  }

  clearSearch() {
    this.input.value = '';
    this.filter();
    this.input.blur();
  }
}
