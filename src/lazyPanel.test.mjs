// src/lazyPanel.test.mjs — panely ľavého stĺpca, ktorých kód príde až pri prvom rozbalení (2026-10-31).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createLazyPanel, lazyMethod, panelExpanded } from './lazyPanel.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function fakeDom({ expanded = false } = {}) {
  const observers = [];
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe(el) { observers.push({ el, cb: this.cb, on: true }); } disconnect() { for (const o of observers) if (o.cb === this.cb) o.on = false; } };
  const set = new Set(expanded ? [] : ['collapsed']);
  const panel = { classList: { contains: (c) => set.has(c), remove: (c) => { set.delete(c); for (const o of observers) if (o.on && o.el === panel) o.cb(); } } };
  const body = { children: [], get childElementCount() { return body.children.length; }, appendChild(c) { body.children.push(c); c.parent = body; } };
  const doc = {
    getElementById: (id) => (id === 'x-panel' ? panel : null),
    querySelector: (sel) => (sel === '#x-panel [data-x-body]' ? body : null),
    createElement: () => ({ className: '', dataset: {}, textContent: '', remove() { this.parent.children = this.parent.children.filter((c) => c !== this); } }),
  };
  return { doc, panel, body, observers };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('zbalený panel nič nesťahuje; rozbalenie dotiahne a nainštaluje raz; telo ukáže Načítavam…', async () => {
  const { doc, panel, body, observers } = fakeDom();
  let installs = 0;
  const api = { open: (x) => `open:${x}` };
  const lazy = createLazyPanel({ panelId: 'x-panel', bodySelector: '[data-x-body]', doc, translate: (k) => `[${k}]`, install: async () => { installs += 1; return api; } });
  lazy.install();
  assert.equal(installs, 0);
  assert.equal(lazy.loaded, false);
  assert.equal(observers.length, 1, 'sleduje triedu collapsed');
  panel.classList.remove('collapsed');
  assert.equal(body.children[0]?.textContent, '[lazy.loading]');
  assert.equal(body.children[0]?.dataset.state, 'loading');
  await lazy.load();
  assert.equal(installs, 1);
  assert.equal(lazy.loaded, true);
  assert.equal(lazy.value, api);
  assert.equal(body.children.length, 0, 'zástupný riadok zmizne — telo si panel stavia sám');
  assert.equal(observers[0].on, false, 'pozorovateľ po inštalácii odchádza');
  assert.equal(await lazy.load(), api, 'druhé volanie neinštaluje znova');
  assert.equal(installs, 1);
});

test('fasáda metódy dotiahne modul a odovzdá volanie; rozbalený panel pri inštalácii = hneď', async () => {
  const { doc } = fakeDom({ expanded: true });
  const calls = [];
  const lazy = createLazyPanel({ panelId: 'x-panel', bodySelector: '[data-x-body]', doc, install: async () => ({ history: { showLeg: (l) => { calls.push(l); return 'ok'; } } }) });
  const showLeg = lazyMethod(lazy, 'showLeg', (p) => p?.history);
  assert.equal(await showLeg('leg-1'), 'ok');
  assert.deepEqual(calls, ['leg-1']);
  lazy.install();
  await tick();
  assert.equal(lazy.loaded, true, 'rozbalený panel (obnova stavu) sa dotiahne hneď');
  assert.equal(panelExpanded({ classList: { contains: () => true } }), false);
  assert.equal(panelExpanded(null), false);
});

test('chyba siete: stav chyby v tele panela, ďalší podnet skúsi znova', async () => {
  const { doc, panel, body } = fakeDom();
  let fail = true;
  const lazy = createLazyPanel({ panelId: 'x-panel', bodySelector: '[data-x-body]', doc, translate: (k) => `[${k}]`, install: async () => { if (fail) throw new Error('offline'); return { ok: true }; } });
  lazy.install();
  panel.classList.remove('collapsed');
  await lazy.load().catch(() => {});
  await tick();
  assert.equal(body.children[0]?.dataset.state, 'error');
  assert.equal(body.children[0]?.textContent, '[lazy.error]');
  assert.equal(lazy.loaded, false);
  fail = false;
  assert.deepEqual(await lazy.load(), { ok: true });
});

test('zapojenie v ui.js: História, VOĽBY a PLYN cez lazyPanel; zdieľanie a úvodná karta dynamicky; udalosť z odkazu bez panela', () => {
  const ui = read('./ui.js');
  assert.match(ui, /import \{ createLazyPanel, lazyMethod \} from '\.\/lazyPanel\.js';/);
  assert.match(ui, /import \{ eventIdFromHash \} from '\.\/eventShareHash\.js';/, 'id udalosti z odkazu sa číta pri štarte bez panela udalostí');
  for (const f of ['historyPanel', 'shipHistoryPanel', 'eventsPanel', 'eventMarkers', 'gasPanel', 'volbyPanel', 'sharePanel', 'shareSnapshot', 'shareVideo', 'shareTargets', 'flightShare', 'cardShare']) {
    assert.doesNotMatch(ui, new RegExp(`^import .* from '\\./${f}\\.js';`, 'm'), `ui.js: ${f}.js už nie je v hlavnom balíku`);
    assert.match(ui, new RegExp(`import\\('\\./${f}\\.js'\\)`), `ui.js: ${f}.js príde dynamickým importom`);
  }
  for (const id of ['history-panel', 'volby-panel', 'gas-panel']) assert.match(ui, new RegExp(`panelId: '${id}',`));
  assert.match(ui, /this\._historyPanels\.install\(\);/);
  assert.match(ui, /this\._volbyPanelLazy\.install\(\);/);
  assert.match(ui, /this\._gasPanelLazy\.install\(\);/);
  assert.match(ui, /this\._shipHistoryPanel = \{ open: lazyMethod\(this\._historyPanels, 'open', \(p\) => p\?\.ship\) \};/, 'história lode z karty lode (main.js) ide cez fasádu');
  assert.match(ui, /this\._eventsPanel = \{ open: lazyMethod\(this\._historyPanels, 'open', \(p\) => p\?\.events\) \};/);
  assert.match(ui, /if \(sharedEventId\) void whenStartupReady\(\)\.then\(\(\) => this\._eventsPanel\?\.open\(sharedEventId\)\);/, 'odkaz event= otvorí kartu po štarte (fasáda panel dotiahne)');
  const main = read('./main.js');
  assert.match(main, /void import\('\.\/firstRunExperience\.js'\)\.then\(\(m\) => m\.initFirstRunExperience\(\{ styleManager, dataManager \}\)\)/);
  assert.doesNotMatch(main, /^import .* from '\.\/firstRunExperience\.js';/m);
  assert.match(main, /from '\.\/volbyShared\.js';/, 'main.js berie len čisté pomocníky volieb');
  // eventsPanel.js a volbyPanel.js znova exportujú, čo sa vyčlenilo — doterajšie importy platia.
  assert.match(read('./eventsPanel.js'), /export \{ EVENT_ID_RE, eventIdFromHash \};/);
  assert.match(read('./volbyPanel.js'), /export \{ VOLBY_ARCHIVE_MS, isVolbyArchived, parseVolbyParam \} from '\.\/volbyShared\.js';/);
});
