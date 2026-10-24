// src/volbyPanel.test.mjs — panel VOĽBY 2026 (2026-10-24): kostra na falošnom dokumente, prehľad a fáza,
// výber kraja a obce s preletom, hľadanie s odkladom, odkazy na zdieľanie, tripwires na markup, štýly,
// i18n, ľavý pruh, mobil a zdieľanie stavu panela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KRAJ_VIEW_HEIGHT_M, VOLBY_PANEL_ID, VOLBY_REFRESH_MS, VOLBY_SEARCH_DEBOUNCE_MS, candidateLabel, installVolbyPanel,
  obecViewHeightM, parseVolbyParam, volbyLink,
} from './volbyPanel.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';
import { MOBILE_SECTIONS } from './mobileShell.js';

const t = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r)); };

const OVERVIEW = {
  phase: 'before', pollsCloseAt: '2026-10-24T18:00:00.000Z', generatedAt: '2026-10-24T10:30:00.000Z',
  sources: { minv: { stale: false }, susr: { stale: false } },
  counts: { obce: 2924, obceNezaradene: 0, starosta: 6560, poslanci: 40184, predseda: 56, zupni: 2472 },
  kraje: [
    { code: '1', name: 'Bratislavský kraj', zupa: 'Bratislavský samosprávny kraj', short: 'BA', center: { lat: 48.2, lon: 17.2 }, counts: { predseda: 7, poslanci: 300, seats: 53, obvody: 24, obce: 73 } },
    { code: '2', name: 'Trnavský kraj', zupa: 'Trnavský samosprávny kraj', short: 'TT', center: null, counts: { predseda: 5, poslanci: 200, seats: 40, obvody: 8, obce: 251 } },
  ],
  mesta: [{ code: '582000', name: 'Bratislava', okres: 'Bratislava', seats: 45, starosta: 6, poslanci: 180, lat: 48.1486, lon: 17.1077, city: true }],
  results: null,
};
const KRAJ1 = {
  code: '1', name: 'Bratislavský kraj', zupa: 'Bratislavský samosprávny kraj', short: 'BA', center: { lat: 48.2, lon: 17.2 },
  counts: { predseda: 2, poslanci: 2, seats: 9, obvody: 2, obce: 1 },
  predseda: [
    { n: 1, meno: 'Juraj', priezvisko: 'Droba', titulPred: 'Mgr.', titulZa: 'MBA, MA', vek: 55, zamestnanie: 'predseda', bydlisko: 'Bratislava - Staré Mesto', strany: 'Sloboda a solidarita, Progresívne Slovensko', nezavisly: false },
    { n: 2, meno: 'Ján', priezvisko: 'Chalabala', titulPred: '', titulZa: '', vek: 62, zamestnanie: 'výsluhový dôchodca', bydlisko: 'Modra', strany: 'Nezávislý kandidát', nezavisly: true },
  ],
  obvody: [
    { code: '101', n: 1, name: 'Volebný obvod č. 1', seats: 4, okrsky: 34, obce: [], kandidati: [{ n: 1, meno: 'Miroslava', priezvisko: 'Bátovská', titulPred: 'Bc.', titulZa: '', vek: 51, zamestnanie: 'manažérka', bydlisko: 'Bratislava', strany: 'PS', nezavisly: false }] },
    { code: '102', n: 2, name: 'Volebný obvod č. 2', seats: 5, okrsky: 74, obce: [], kandidati: [{ n: 1, meno: 'X', priezvisko: 'Xx', titulPred: '', titulZa: '', vek: null, zamestnanie: '', bydlisko: '', strany: 'Nezávislý kandidát', nezavisly: true }] },
  ],
};
const OBEC = {
  code: '501891', name: 'Topoľníky', okres: 'Dunajská Streda', okresCode: '201', kraj: 'Trnavský kraj', krajCode: '2', seats: 9, okrsky: 3, city: false, unmatched: false,
  lat: 47.9, lon: 17.78, precision: 'obec', starosta: 2, poslanci: 14, uo: 'Dunajská Streda', typ: 'Starosta a zastupiteľstvo', obvodyCount: 1,
  krajObvod: { code: '201', name: 'Volebný obvod č. 1', seats: 6, kandidati: 40 },
  kandidati: {
    starosta: [{ n: 1, meno: 'Anna', priezvisko: 'Nagyová', titulPred: 'Mgr.', titulZa: '', vek: 50, zamestnanie: 'starostka', bydlisko: '', strany: 'Szövetség - Aliancia', nezavisly: false }],
    poslanci: [{ obvod: '1', kandidati: Array.from({ length: 14 }, (_, i) => ({ n: i + 1, meno: `M${i}`, priezvisko: `P${i}`, titulPred: '', titulZa: '', vek: 30 + i, zamestnanie: 'z', bydlisko: '', strany: 'S', nezavisly: false })) }],
  },
};
const BA = { ...OBEC, code: '582000', name: 'Bratislava', okres: 'Bratislava', city: true, seats: 45, lat: 48.1486, lon: 17.1077, precision: 'okres', krajObvod: null, obvodyCount: 2,
  kandidati: { starosta: [], poslanci: [{ obvod: '1', kandidati: [OBEC.kandidati.poslanci[0].kandidati[0]] }, { obvod: '2', kandidati: [OBEC.kandidati.poslanci[0].kandidati[1]] }] } };

function fakeDoc() {
  const make = (tag) => {
    const node = {
      tag, children: [], dataset: {}, attributes: {}, listeners: {}, hidden: false, _text: '', className: '', value: '',
      get textContent() { return node._text; },
      set textContent(v) { node._text = String(v); if (node._text === '') node.children.length = 0; },
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { for (const c of cs) node.children.push(typeof c === 'string' ? { tag: '#text', _text: c, children: [], dataset: {}, attributes: {} } : c); },
      setAttribute(k, v) { node.attributes[k] = String(v); },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      querySelector(sel) { return sel === '[data-volby-body]' ? node.body : null; },
    };
    return node;
  };
  const root = make('div');
  root.body = make('div');
  return { createElement: make, getElementById: (id) => (id === VOLBY_PANEL_ID ? root : null), root };
}
const find = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out; };
const byClass = (node, cls) => find(node, (n) => String(n.className || '').split(' ').includes(cls));
const click = (node) => { for (const fn of node.listeners.click || []) fn(); };

function install(doc, extra = {}) {
  const calls = [];
  const flown = [];
  const timeouts = [];
  const panel = installVolbyPanel({
    doc, t, lang: 'sk', nowMs: () => Date.UTC(2026, 9, 24, 10, 31), origin: 'https://okolive.sk',
    api: {
      overview: async () => { calls.push('overview'); return OVERVIEW; },
      kraj: async (code) => { calls.push(`kraj:${code}`); if (code === '1') return KRAJ1; throw new Error('HTTP 404'); },
      search: async (q) => { calls.push(`search:${q}`); return { q, results: q === 'xyz' ? [] : [{ code: '501891', name: 'Topoľníky', okres: 'Dunajská Streda', starosta: 2, poslanci: 14 }, { code: '582000', name: 'Bratislava', okres: 'Bratislava', starosta: 6, poslanci: 180 }] }; },
      obec: async (code) => { calls.push(`obec:${code}`); return code === '582000' ? BA : OBEC; },
    },
    onFlyTo: (target) => flown.push(target),
    setIntervalImpl: (fn, ms) => { timeouts.push(['interval', ms]); return 7; },
    clearIntervalImpl: (id) => timeouts.push(['clear', id]),
    setTimeoutImpl: (fn, ms) => { timeouts.push(['timeout', ms]); fn(); return 1; },
    clearTimeoutImpl: () => {},
    copyText: async (text) => { calls.push(`copy:${text}`); },
    ...extra,
  });
  return { panel, calls, flown, timeouts };
}

test('pure: odkazy a parameter, výška kamery, meno s titulmi', () => {
  assert.deepEqual(parseVolbyParam('?volby'), { obec: null, kraj: null });
  assert.deepEqual(parseVolbyParam('?x=1&volby=528595'), { obec: '528595', kraj: null });
  assert.deepEqual(parseVolbyParam('?volby=k7'), { obec: null, kraj: '7' });
  assert.deepEqual(parseVolbyParam('?volby=x201-topolniky'), { obec: 'x201-topolniky', kraj: null });
  assert.deepEqual(parseVolbyParam('?volby=<script>'), { obec: null, kraj: null }, 'cudzí znak = len otvoriť panel');
  assert.equal(parseVolbyParam('?front=lyman'), null);
  assert.equal(volbyLink('https://okolive.sk/', {}), 'https://okolive.sk/?volby');
  assert.equal(volbyLink('https://okolive.sk', { obec: '582000' }), 'https://okolive.sk/?volby=582000');
  assert.equal(volbyLink('https://okolive.sk', { kraj: '7' }), 'https://okolive.sk/?volby=k7');
  assert.equal(obecViewHeightM({ city: true, seats: 45 }), 20_000);
  assert.equal(obecViewHeightM({ seats: 25 }), 20_000);
  assert.equal(obecViewHeightM({ seats: 13 }), 10_000);
  assert.equal(obecViewHeightM({ seats: 7 }), 5_000);
  assert.equal(candidateLabel({ titulPred: 'Mgr.', meno: 'Juraj', priezvisko: 'Droba', titulZa: 'MBA, MA' }), 'Mgr. Juraj Droba, MBA, MA');
  assert.equal(candidateLabel({ meno: 'Ján', priezvisko: 'Nový' }), 'Ján Nový');
});

test('panel: prehľad → stav, fáza, počty, 8 krajov a mestá; periodická obnova; bez koreňa null', async () => {
  const doc = fakeDoc();
  const { panel, calls, timeouts } = install(doc);
  assert.ok(panel);
  assert.equal(installVolbyPanel({ doc: { getElementById: () => null }, t }), null);
  assert.deepEqual(timeouts, [['interval', VOLBY_REFRESH_MS]]);
  await flush();
  const st = panel._getStateForTest();
  assert.equal(st.loaded, true);
  assert.equal(st.phase, 'before');
  assert.equal(st.status, 'ok');
  assert.equal(st.kraje, 2);
  assert.equal(st.mesta, 1);
  assert.deepEqual(calls, ['overview']);
  const status = byClass(doc.root.body, 'volby-status')[0];
  assert.match(status.textContent, /volby\.status-before · volby\.as-of \{"time":"12:30"\}/, 'čas v Europe/Bratislava (SELČ = UTC+2)');
  assert.equal(byClass(doc.root.body, 'volby-phase')[0].textContent, 'volby.phase-before');
  assert.match(byClass(doc.root.body, 'volby-counts')[0].textContent, /"starosta":"6 560"/, 'slovenské tisíce');
  assert.equal(byClass(doc.root.body, 'volby-results')[0].hidden, true, 'pred 20:00 bez riadku výsledkov');
  const chips = byClass(doc.root.body, 'volby-chip-kraj');
  assert.deepEqual(chips.map((c) => c.textContent), ['BA', 'TT']);
  assert.match(chips[0].title, /Bratislavský kraj/);
  assert.equal(byClass(doc.root.body, 'volby-chip-mesto')[0].textContent, 'Bratislava');
  const links = find(doc.root.body, (n) => n.tag === 'a').map((a) => a.href);
  assert.ok(links.includes('https://www.minv.sk/?samosprava26-info10') && links.includes('https://volbysr.sk/') && links.includes('https://www.geonames.org/'), 'zdroje s odkazmi');
  panel.destroy();
  assert.deepEqual(timeouts.at(-1), ['clear', 7]);
});

test('panel: po 20:00 ukáže sčítavanie a tabuľky ŠÚ SR; chyba prehľadu je viditeľná', async () => {
  const doc = fakeDoc();
  const { panel } = install(doc, { api: { overview: async () => ({ ...OVERVIEW, phase: 'counting', results: { tables: [{ name: 'OSO2026_SK_tab03' }, { name: 'OSO2026_SK_tab04' }] } }) } });
  await flush();
  assert.equal(panel._getStateForTest().phase, 'counting');
  assert.equal(byClass(doc.root.body, 'volby-phase')[0].textContent, 'volby.phase-counting');
  const results = byClass(doc.root.body, 'volby-results')[0];
  assert.equal(results.hidden, false);
  assert.equal(results.textContent, 'volby.results-tables {"n":"2"}');
  const doc2 = fakeDoc();
  const { panel: failing } = install(doc2, { api: { overview: async () => { throw new Error('HTTP 503'); } } });
  await flush();
  assert.equal(failing._getStateForTest().status, 'error');
  assert.equal(byClass(doc2.root.body, 'volby-status')[0].textContent, 'volby.error {"error":"HTTP 503"}');
});

test('kraj: klik na čip načíta detail raz, vykreslí predsedov, obvody zbalené, preletí a ponúkne odkaz; neznámy kraj = chyba bez pádu', async () => {
  const doc = fakeDoc();
  const { panel, calls, flown } = install(doc);
  await flush();
  click(byClass(doc.root.body, 'volby-chip-kraj')[0]);
  await flush();
  assert.deepEqual(calls, ['overview', 'kraj:1']);
  assert.equal(panel._getStateForTest().krajCode, '1');
  const box = byClass(doc.root.body, 'volby-kraj')[0];
  assert.equal(box.hidden, false);
  assert.equal(byClass(box, 'volby-detail-title')[0].textContent, 'Bratislavský samosprávny kraj');
  const names = byClass(box, 'volby-cand-name').map((n) => n.textContent);
  assert.ok(names.includes('Mgr. Juraj Droba, MBA, MA') && names.includes('Ján Chalabala'));
  assert.equal(byClass(box, 'is-independent')[0].textContent, 'volby.independent');
  const groups = byClass(box, 'volby-group');
  assert.equal(groups.length, 2, 'dva volebné obvody');
  assert.equal(byClass(groups[0], 'volby-cands')[0].hidden, true, 'obvod zbalený');
  click(byClass(groups[0], 'volby-group-toggle')[0]);
  assert.equal(byClass(groups[0], 'volby-cands')[0].hidden, false);
  assert.deepEqual(flown, [{ lat: 48.2, lon: 17.2, heightM: KRAJ_VIEW_HEIGHT_M, label: 'Bratislavský kraj' }]);
  assert.equal(byClass(doc.root.body, 'volby-chip-kraj')[0].getAttribute('aria-pressed'), 'true');
  const copy = byClass(box, 'volby-action').find((b) => b.textContent === 'volby.copy-link');
  assert.equal(copy.title, 'https://okolive.sk/?volby=k1');
  click(copy);
  await flush();
  assert.ok(calls.includes('copy:https://okolive.sk/?volby=k1'));
  assert.equal(copy.textContent, 'volby.copied');
  click(byClass(doc.root.body, 'volby-chip-kraj')[0]);
  await flush();
  assert.equal(calls.filter((c) => c === 'kraj:1').length, 1, 'detail kraja z pamäte');
  await panel.selectKraj('2');
  assert.equal(panel._getStateForTest().error, 'HTTP 404');
  assert.equal(byClass(doc.root.body, 'volby-kraj')[0].hidden, true);
});

test('obec: hľadanie s odkladom, výber z výsledkov, detail so starostom, poslancami a krajským obvodom, prelet podľa veľkosti', async () => {
  const doc = fakeDoc();
  const { panel, calls, flown, timeouts } = install(doc);
  await flush();
  const input = find(doc.root.body, (n) => n.tag === 'input')[0];
  input.value = 't';
  for (const fn of input.listeners.input) fn();
  await flush();
  assert.ok(timeouts.some(([kind, ms]) => kind === 'timeout' && ms === VOLBY_SEARCH_DEBOUNCE_MS), 'odklad hľadania');
  assert.ok(!calls.some((c) => c.startsWith('search:')), 'jedno písmeno nehľadá');
  assert.equal(byClass(doc.root.body, 'volby-list')[0].hidden, true);
  input.value = 'topo';
  for (const fn of input.listeners.input) fn();
  await flush();
  assert.ok(calls.includes('search:topo'));
  const rows = byClass(doc.root.body, 'volby-row');
  assert.deepEqual(rows.map((r) => byClass(r, 'volby-row-name')[0].textContent), ['Topoľníky', 'Bratislava']);
  click(rows[0]);
  await flush();
  assert.equal(panel._getStateForTest().obecCode, '501891');
  const box = byClass(doc.root.body, 'volby-obec')[0];
  assert.equal(box.hidden, false);
  assert.equal(byClass(box, 'volby-detail-title')[0].textContent, 'Topoľníky');
  assert.equal(byClass(box, 'volby-detail-sub')[0].textContent, 'volby.okres {"okres":"Dunajská Streda"} · Trnavský kraj');
  const subheads = byClass(box, 'volby-subhead').map((n) => n.textContent);
  assert.equal(subheads[0], 'volby.mayor {"n":"1"}');
  assert.equal(subheads[1], 'volby.council {"n":"14","seats":"9","obvody":"1"}');
  assert.equal(byClass(box, 'volby-cand').length, 1 + 12, 'starostka + prvých 12 poslancov');
  const more = byClass(box, 'volby-more')[0];
  assert.equal(more.textContent, 'volby.show-more {"n":"14"}');
  click(more);
  assert.equal(byClass(box, 'volby-cand').length, 1 + 14);
  assert.match(byClass(box, 'volby-note').at(-1).textContent, /volby\.region-ward/);
  assert.deepEqual(flown.at(-1), { lat: 47.9, lon: 17.78, heightM: 5_000, label: 'Topoľníky' });
  assert.equal(byClass(doc.root.body, 'volby-list')[0].hidden, true, 'zoznam výsledkov sa po výbere skryje');

  // Mesto cez čip: celomestské voľby, dva obvody zbalené, približná poloha.
  click(byClass(doc.root.body, 'volby-chip-mesto')[0]);
  await flush();
  const ba = byClass(doc.root.body, 'volby-obec')[0];
  assert.equal(byClass(ba, 'volby-detail-title')[0].textContent, 'Bratislava');
  assert.equal(byClass(ba, 'volby-subhead')[0].textContent, 'volby.mayor-city {"n":"0"}');
  assert.ok(byClass(ba, 'volby-note').some((n) => n.textContent === 'volby.none-registered'));
  assert.ok(byClass(ba, 'volby-note').some((n) => n.textContent === 'volby.approx'));
  assert.equal(byClass(ba, 'volby-group').length, 2);
  assert.equal(flown.at(-1).heightM, 20_000);
  assert.equal(byClass(doc.root.body, 'volby-chip-mesto')[0].getAttribute('aria-pressed'), 'true');
  assert.equal(panel._getStateForTest().krajCode, null, 'výber obce zruší kraj');

  // Prázdny výsledok a otvorenie z odkazu.
  input.value = 'xyz';
  for (const fn of input.listeners.input) fn();
  await flush();
  assert.equal(byClass(byClass(doc.root.body, 'volby-list')[0], 'volby-note')[0].textContent, 'volby.no-match');
  let collapsed = null;
  const doc2 = fakeDoc();
  const { panel: p2, calls: c2 } = install(doc2, { setCollapsed: (v) => { collapsed = v; } });
  await p2.open({ obec: '501891' });
  assert.equal(collapsed, false);
  assert.ok(c2.includes('obec:501891'));
  assert.equal(p2._getStateForTest().obecCode, '501891');
  await p2.open({ kraj: '1' });
  assert.equal(p2._getStateForTest().krajCode, '1');
  assert.equal(p2._getStateForTest().obecCode, null);
});

// ── tripwires: markup, štýly, i18n, pruh, mobil, zdieľanie ──────────────────────────────────────────
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const sharelink = readFileSync(new URL('./sharelink.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

test('markup: zóna VOĽBY s panelom hneď pod POČASÍM, telo [data-volby-body], tlačidlo sekcie na mobile', () => {
  assert.match(html, /<div class="lane-zone" data-lane-zone="volby">\s*<span class="lane-zone-text" data-i18n="lane\.zone\.volby">/);
  assert.match(html, /<div id="volby-panel" class="panel-collapsible collapsed" data-panel-id="volby-panel">/);
  assert.match(html, /<span data-i18n="panel\.volby" class="panel-title">/);
  assert.match(html, /<div class="volby-body" data-volby-body><\/div>/);
  assert.ok(html.indexOf('id="weather-panel"') < html.indexOf('id="volby-panel"') && html.indexOf('id="volby-panel"') < html.indexOf('data-lane-zone="conflicts"'), 'medzi POČASÍM a KONFLIKTAMI');
  assert.match(html, /<button type="button" data-oko-section="volby" aria-pressed="false">\s*<span class="material-symbols-outlined" aria-hidden="true">how_to_vote<\/span>\s*<span class="oko-appbar-label" data-i18n="mobile\.volby">/);
});

test('štýly: poradie zóny a panela (14/15), zbalené telo skryté, rozbalený panel vyplní koridor, kokpit a čistý pohľad ho skryjú', () => {
  assert.match(css, /#left-panel-stack > \.lane-zone\[data-lane-zone="volby"\] \{ order: 14; \}/);
  assert.match(css, /#left-panel-stack > #volby-panel \{ order: 15; \}/);
  assert.match(css, /#volby-panel\.collapsed \.volby-body \{ display: none; \}/);
  assert.match(css, /#left-panel-stack > #volby-panel:not\(\.collapsed\) \.volby-panel-inner/);
  assert.match(css, /body\.cockpit-mode #left-panel-stack > #volby-panel \{ display: none !important; \}/);
  assert.match(css, /body\.cockpit-mode #left-panel-stack > \.lane-zone\[data-lane-zone="volby"\] \{ display: none !important; \}/);
  assert.match(css, /body\.oko-mobile #oko-appbar \{[^}]*grid-template-columns: repeat\(6, 1fr\);/, 'šesť sekcií v spodnej lište');
  assert.match(css, /\.volby-search-input \{/);
  assert.match(css, /\.volby-cand-name \{/);
});

test('i18n: kľúče panela v oboch slovníkoch, slovenské znenie bez emoji', () => {
  const keys = ['panel.volby', 'lane.zone.volby', 'mobile.volby', 'volby.loading', 'volby.error', 'volby.status-before', 'volby.status-counting', 'volby.as-of',
    'volby.phase-before', 'volby.phase-counting', 'volby.results-none', 'volby.results-tables', 'volby.counts', 'volby.regions', 'volby.region-heads',
    'volby.region-council', 'volby.obvod', 'volby.kraj-sub', 'volby.municipal', 'volby.cities', 'volby.search-placeholder', 'volby.search-hint', 'volby.no-match',
    'volby.mayor', 'volby.mayor-city', 'volby.council', 'volby.ward', 'volby.independent', 'volby.age', 'volby.okres', 'volby.region-ward', 'volby.approx',
    'volby.unmatched', 'volby.typ', 'volby.none-registered', 'volby.row-counts', 'volby.chip-kraj-title', 'volby.chip-obec-title', 'volby.show-more', 'volby.fly',
    'volby.copy-link', 'volby.copied', 'volby.source-prefix', 'volby.source-minv', 'volby.source-susr', 'volby.source-geonames', 'volby.source-note'];
  for (const key of keys) {
    assert.equal(typeof EN_STRINGS[key], 'string', `EN ${key}`);
    assert.equal(typeof SK_STRINGS[key], 'string', `SK ${key}`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SK_STRINGS[key]), `bez emoji: ${key}`);
  }
  assert.equal(SK_STRINGS['panel.volby'], 'VOĽBY 2026');
  assert.match(SK_STRINGS['volby.phase-before'], /20:00/);
  assert.match(SK_STRINGS['volby.source-note'], /vzda/i, 'poznámka o vzdaní kandidatúry');
});

test('zapojenie: ui.js panel v registri pruhu a kokpite + installVolbyPanel s preletom; sharelink token; mobil sekcia; main.js deep link ?volby', () => {
  assert.match(ui, /\{ id: 'volby-panel' \},/);
  assert.match(ui, /^  'volby-panel',$/m, 'kokpit panel zbalí pri vstupe');
  assert.match(ui, /import \{ installVolbyPanel \} from '\.\/volbyPanel\.js';/);
  assert.match(ui, /this\._volbyPanel = installVolbyPanel\(\{/);
  assert.match(ui, /setPanelCollapsed\('volby-panel', collapsed/);
  assert.match(sharelink, /\{ id: 'volby-panel', token: 'y', pinnable: false \},/);
  const section = MOBILE_SECTIONS.find((s) => s.id === 'volby');
  assert.deepEqual({ ...section, panelIds: [...section.panelIds] }, { id: 'volby', labelKey: 'mobile.volby', panelIds: ['volby-panel'], expand: 'volby-panel' });
  assert.equal(MOBILE_SECTIONS.findIndex((s) => s.id === 'volby'), 1, 'hneď za Vrstvami');
  assert.match(main, /import \{ parseVolbyParam \} from '\.\/volbyPanel\.js';/);
  assert.match(main, /parseVolbyParam\(window\.location\?\.search \|\| ''\)/);
});
