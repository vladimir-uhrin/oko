// src/gasPanelPower.test.mjs
// Časť ELEKTRINA panelu energie (2026-11-07): karty CENA (deň vopred SR +
// susedia) a SÚSTAVA SR (výroba podľa zdroja, výmena so susedmi) v
// [data-power-body], jedno sťahovanie /api/power/market, prekreslenie „teraz"
// každých 5 min bez dopytu; bez kontajnera sa nič nesťahuje. Tripwires na
// markup, CSS, i18n, proxy a názov panelu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAS_PANEL_ID, GAS_PANEL_REFRESH_MS, POWER_RERENDER_MS, installGasPanel } from './gasPanel.js';
import { buildPowerMarketPayload } from './data/powerMarket.js';
import { LNG_FLEET_REFRESH_MS } from './data/lngFleet.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const t = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const flush = async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r)); };
// 2026-11-07 05:05 SEČ.
const NOW = Date.UTC(2026, 10, 7, 4, 5);

function fakeDoc({ withPowerBody = true } = {}) {
  const make = (tag) => {
    const node = {
      tag, children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, hidden: false, _text: '', className: '', value: '',
      get textContent() { return node._text; },
      set textContent(v) { node._text = String(v); if (node._text === '') node.children.length = 0; },
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { node.children.push(...cs); },
      setAttribute(k, v) { node.attributes[k] = v; },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      querySelector(sel) { return sel === '[data-gas-body]' ? node.body : (sel === '[data-power-body]' ? node.powerBody ?? null : null); },
      classList: { toggle() {}, add() {}, remove() {} },
      getContext: () => null,
      get clientWidth() { return 300; },
    };
    return node;
  };
  const root = make('div');
  root.body = make('div');
  if (withPowerBody) root.powerBody = make('div');
  return { createElement: make, getElementById: (id) => (id === GAS_PANEL_ID ? root : null), activeElement: null, root };
}
const find = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out; };
const text = (node) => [node._text, ...(node.children || []).map(text)].filter(Boolean).join(' ');

function priceJson(day, values, license) {
  const start = Date.parse(`${day}T00:00:00+01:00`);
  return { unit: 'EUR / MWh', license, series: [{ id: 'day_ahead_price' }], data: values.map((v, i) => ({ timestamp: new Date(start + i * 900_000).toISOString(), values: { day_ahead_price: v } })) };
}
const MARKET = buildPowerMarketPayload({
  prices: [
    { bzn: 'SK', json: priceJson('2026-11-07', Array.from({ length: 96 }, (_, i) => (i <= 20 ? 200 : 260)), 'private and internal use only') },
    { bzn: 'CZ', json: priceJson('2026-11-07', Array(96).fill(231.84), 'CC BY 4.0 from Bundesnetzagentur | SMARD.de') },
    { bzn: 'HU', json: null, error: 'HTTP 429' },
    { bzn: 'AT', json: priceJson('2026-11-07', Array(96).fill(231.84), 'CC BY 4.0') },
    { bzn: 'PL', json: priceJson('2026-11-07', Array(96).fill(180), 'private and internal use only') },
    { bzn: 'DE-LU', json: priceJson('2026-11-07', Array(96).fill(231.84), 'CC BY 4.0') },
  ],
  mix: { json: { unit: 'MW', license: 'CC BY 4.0', series: [{ id: 'nuclear' }, { id: 'fossil_gas' }, { id: 'hydro_run_of_river' }, { id: 'load' }, { id: 'renewable_share_of_load' }, { id: 'cross_border_electricity_trading' }], data: [{ timestamp: '2026-11-07T02:00:00+01:00', values: { nuclear: 1957.5, fossil_gas: 483.8, hydro_run_of_river: 91.8, load: 2711, renewable_share_of_load: 9.2, cross_border_electricity_trading: -170.6 } }] } },
  flows: { pairs: { 'HU-SK': { a: 'HU', b: 'SK', latestGw: -1.612, latestAt: '2026-11-07T01:00:00.000Z' }, 'CZ-SK': { a: 'CZ', b: 'SK', latestGw: 1.2, latestAt: '2026-11-07T01:00:00.000Z' } } },
}, { fetchedAt: NOW - 600_000 });

test('karty ELEKTRINA: cena SR teraz so susedmi, výroba SR podľa zdroja, výmena so susedmi; prekreslenie každých 5 min, zrušenie pri destroy', async () => {
  const doc = fakeDoc();
  const intervals = [];
  const cleared = [];
  let calls = 0;
  let now = NOW;
  const panel = installGasPanel({
    doc, t, lang: 'sk', nowMs: () => now,
    api: { prices: async () => { throw new Error('x'); }, flows: async () => { throw new Error('x'); }, storage: async () => { throw new Error('x'); }, lng: async () => { throw new Error('x'); }, imports: async () => { throw new Error('x'); }, fleet: async () => { throw new Error('x'); }, power: async () => { calls += 1; return MARKET; } },
    setIntervalImpl: (fn, ms) => { intervals.push([fn, ms]); return intervals.length; },
    clearIntervalImpl: (id) => cleared.push(id),
  });
  await flush();
  assert.equal(calls, 1);
  const st = panel._getStateForTest().power;
  assert.deepEqual({ ...st, lastError: st.lastError }, {
    mounted: true, loaded: true, ok: true, status: 'ok', gridStatus: 'ok', lastError: null,
    headline: '200,00 €/MWh', zones: 5, mixRows: 3, exchangeRows: 2, series: ['sk-today'],
  });
  const cards = find(doc.root.powerBody, (n) => n.dataset?.card).map((n) => n.dataset.card);
  assert.deepEqual(cards, ['power-prices', 'power-grid'], 'elektrina v [data-power-body], nie medzi kartami plynu');
  assert.ok(!find(doc.root.body, (n) => String(n.dataset?.card || '').startsWith('power')).length);
  const all = text(doc.root.powerBody);
  assert.match(all, /power\.market-now-label \{"interval":"05:00–05:15"\}/);
  assert.match(all, /power\.market-below-avg/);
  assert.match(all, /power\.market-tomorrow-pending/);
  assert.match(all, /power\.market-laic \{"ct":"20"\}/);
  assert.match(all, /power\.market-license \{"zones":"SK, PL"\}/, 'licencia zón len na súkromné použitie je priznaná');
  assert.match(all, /231,84 €\/MWh/);
  assert.match(all, /power\.mix-nuclear/);
  assert.match(all, /CZ → SK/);
  assert.match(all, /SK → HU/);
  assert.match(all, /power\.exchange-net-export/);
  const hu = find(doc.root.powerBody, (n) => n.dataset?.key === 'HU')[0];
  assert.equal(hu.dataset.level, 'nodata', 'zóna s chybou sa ukáže bez čísla');
  assert.deepEqual(intervals.map(([, ms]) => ms), [GAS_PANEL_REFRESH_MS, LNG_FLEET_REFRESH_MS, POWER_RERENDER_MS]);
  // O 20 min neskôr (05:25): prekreslenie bez dopytu ukáže drahší interval.
  now = NOW + 20 * 60_000;
  intervals[2][0]();
  assert.equal(calls, 1, 'prekreslenie nesťahuje');
  assert.equal(panel._getStateForTest().power.headline, '260,00 €/MWh');
  panel.destroy();
  assert.deepEqual(cleared, [1, 2, 3]);
});

test('bez kontajnera [data-power-body] sa elektrina nesťahuje ani nekreslí; chyba proxy = poctivý stav', async () => {
  let calls = 0;
  const doc = fakeDoc({ withPowerBody: false });
  const panel = installGasPanel({ doc, t, lang: 'sk', nowMs: () => NOW, refreshMs: 0, api: { prices: async () => ({}), flows: async () => ({}), storage: async () => ({}), lng: async () => ({}), imports: async () => ({}), fleet: async () => ({}), power: async () => { calls += 1; return MARKET; } } });
  await flush();
  assert.equal(calls, 0);
  assert.equal(panel._getStateForTest().power.mounted, false);
  const doc2 = fakeDoc();
  const panel2 = installGasPanel({ doc: doc2, t, lang: 'sk', nowMs: () => NOW, refreshMs: 0, api: { prices: async () => ({}), flows: async () => ({}), storage: async () => ({}), lng: async () => ({}), imports: async () => ({}), fleet: async () => ({}), power: async () => { throw new Error('HTTP 502'); } } });
  await flush();
  const st = panel2._getStateForTest().power;
  assert.equal(st.status, 'error');
  assert.equal(st.gridStatus, 'error');
  assert.equal(st.lastError, 'HTTP 502');
});

test('tripwires: markup medzi ropou a plynom, skrývanie so zbaleným panelom, názov panelu, i18n SK+EN, proxy /api/power/market cez spoločný rad', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-oil-body[\s\S]*?class="energy-subhead" data-i18n="panel\.power"[\s\S]*?<div class="power-body" data-power-body><\/div>[\s\S]*?data-i18n="panel\.gas"/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#gas-panel\.collapsed \.power-body \{ display: none; \}/);
  assert.equal(SK_STRINGS['panel.energy'], 'Ropa, plyn a elektrina — ceny a toky');
  assert.equal(EN_STRINGS['panel.energy'], 'Oil, gas & power — prices & flows');
  for (const key of ['panel.power', 'power.market-title', 'power.market-loading', 'power.market-unavailable', 'power.market-updated', 'power.market-stale', 'power.market-now-label', 'power.market-avg', 'power.market-range', 'power.market-tomorrow', 'power.market-tomorrow-pending', 'power.market-above-avg', 'power.market-below-avg', 'power.market-laic', 'power.market-note', 'power.market-license', 'power.grid-title', 'power.grid-label', 'power.grid-updated', 'power.grid-stale', 'power.grid-unavailable', 'power.grid-note', 'power.mix-total', 'power.mix-load', 'power.mix-renewable', 'power.mix-export', 'power.mix-import', 'power.mix-nuclear', 'power.mix-hydro', 'power.mix-gas', 'power.mix-coal', 'power.mix-oil', 'power.mix-bio', 'power.mix-solar', 'power.mix-wind', 'power.mix-other', 'power.exchange-title', 'power.exchange-net-export', 'power.exchange-net-import', 'power.exchange-balanced', 'power.exchange-unavailable']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.ok(vite.includes("middlewares.use('/api/power/market', marketRoute.handler)"));
  assert.match(vite, /function ecFetchJson\(url\)/, 'jeden rad dopytov pre toky aj trh');
  assert.match(vite, /energyChartsCbpfUrl\(code, Date\.now\(\)\)\);/);
  assert.match(vite, /ecFetchJson\(energyChartsPriceUrl\(bzn, Date\.now\(\)\)\)/);
});
