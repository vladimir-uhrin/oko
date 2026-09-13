// src/gasPanel.test.mjs
// Panel PLYN (2026-09-13): graf na stube, DOM lifecycle karty CENY na
// falošnom dokumente, tripwires na markup/štýly/UI/i18n/proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAS_PANEL_ID, GAS_PANEL_REFRESH_MS, installGasPanel } from './gasPanel.js';
import { GAS_CHART_HEIGHT_PX, chartExtent, drawGasChart, seriesStyle } from './gasChart.js';
import { CHART_COLORS, CHART_PAD } from './flightHistoryChart.js';
import { EN_STRINGS, SK_STRINGS } from './i18nStrings.js';

const t = (key, vars) => (vars && Object.keys(vars).length ? `${key} ${JSON.stringify(vars)}` : key);
const flush = async () => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r)); };

const PAYLOAD = {
  acer: {
    rows: [
      { date: '2026-09-08', nwe: 71, south: 71.4, eu: 71.1, benchmark: -4.7, ttf: 75.8 },
      { date: '2026-09-10', nwe: 73.5, south: 73.9, eu: 73.2, benchmark: -8.9, ttf: 82.1 },
      { date: '2026-09-11', nwe: 75.5, south: 78, eu: 77.15, benchmark: -2.37, ttf: 79.52 },
    ],
  },
  monthly: { rows: [{ month: '1992-01', usdMmbtu: 2.5, eurMwh: 8 }, { month: '2026-08', usdMmbtu: 12, eurMwh: 37.2 }] },
  fetchedAt: Date.UTC(2026, 8, 13),
};
const NOW = Date.UTC(2026, 8, 13, 10);

test('gasChart: rozsah s rezervou, štýly podľa poradia, kreslenie = mriežka + plocha + čiary + popisky; bez radov len mriežka', () => {
  const series = [
    { key: 'ttf', points: [{ t: 0, v: 10 }, { t: 100, v: 20 }, { t: 200, v: 15 }] },
    { key: 'eu', points: [{ t: 0, v: 12 }, { t: 200, v: 18 }] },
  ];
  const ext = chartExtent(series);
  assert.deepEqual([ext.t0, ext.t1, ext.rawMin, ext.rawMax, ext.count], [0, 200, 10, 20, 5]);
  assert.ok(ext.vMin < 10 && ext.vMax > 20, '8 % rezerva okolo hodnôt');
  assert.equal(chartExtent([{ points: [{ t: 5, v: 7 }] }]).t1, 6, 'jediný bod nedelí nulou');
  assert.equal(chartExtent([]), null);
  assert.equal(seriesStyle(0).fill, CHART_COLORS.altFill);
  assert.equal(seriesStyle(1).line, CHART_COLORS.gsLine);
  assert.equal(seriesStyle(9).line, CHART_COLORS.cursor, 'ďalšie rady = posledný štýl');
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  const ctx = {
    clearRect: rec('clearRect'), beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'),
    fill: rec('fill'), closePath: rec('closePath'), fillText: rec('fillText'), strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  };
  const out = drawGasChart(ctx, series, { width: 320, height: GAS_CHART_HEIGHT_PX, maxLabel: 'max 20', lastLabel: 'last 15', startLabel: '1. 9.', endLabel: '11. 9.' });
  assert.equal(out.count, 5);
  assert.equal(calls[0][0], 'clearRect');
  assert.equal(calls.filter(([n]) => n === 'stroke').length, 3, 'mriežka + dva rady');
  assert.equal(calls.filter(([n]) => n === 'fill').length, 1, 'plocha len pod prvým radom');
  assert.deepEqual(calls.filter(([n]) => n === 'fillText').map(([, s]) => s), ['max 20', 'last 15', '1. 9.', '11. 9.']);
  const lastPoint = calls.filter(([n]) => n === 'lineTo').find(([, x, y]) => Math.abs(x - (CHART_PAD.left + 320 - CHART_PAD.left - CHART_PAD.right)) < 1e-9 && y > CHART_PAD.top);
  assert.ok(lastPoint, 'posledný bod prvého radu leží na pravom okraji plátna');
  const calls2 = [];
  const ctx2 = { ...ctx, clearRect: () => calls2.push('clear'), stroke: () => calls2.push('stroke'), fill: () => calls2.push('fill'), fillText: () => calls2.push('text') };
  assert.equal(drawGasChart(ctx2, [], { width: 100, height: 60 }), null);
  assert.deepEqual(calls2, ['clear', 'stroke']);
});

function fakeDoc() {
  const make = (tag) => {
    const node = {
      tag, children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, hidden: false, textContent: '', className: '', value: '',
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { node.children.push(...cs); },
      setAttribute(k, v) { node.attributes[k] = v; },
      getAttribute(k) { return node.attributes[k] ?? null; },
      addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      querySelector(sel) { return sel === '[data-gas-body]' ? node.body : null; },
      classList: { toggle(name, on) { node.active = name === 'active' ? Boolean(on) : node.active; }, add() {}, remove() {} },
      getContext: () => null,
      get clientWidth() { return 300; },
    };
    return node;
  };
  const root = make('div');
  root.body = make('div');
  return { createElement: make, getElementById: (id) => (id === GAS_PANEL_ID ? root : null), activeElement: null, root };
}

const find = (node, pred, out = []) => { if (pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out; };

test('panel: načíta ceny, ukáže odvodený TTF so zmenou a dátumom, riadky LNG, prepne rozsah, obnovuje periodicky, zruší timer', async () => {
  const doc = fakeDoc();
  const calls = [];
  const intervals = [];
  let cleared = null;
  const panel = installGasPanel({
    doc, t, lang: 'sk', nowMs: () => NOW,
    api: { prices: async () => { calls.push('prices'); return PAYLOAD; } },
    setIntervalImpl: (fn, ms) => { intervals.push(ms); return 42; },
    clearIntervalImpl: (id) => { cleared = id; },
  });
  assert.ok(panel);
  assert.deepEqual(intervals, [GAS_PANEL_REFRESH_MS], 'periodická obnova');
  await flush();
  const st = panel._getStateForTest();
  assert.equal(st.loaded, true);
  assert.equal(st.ok, true);
  assert.equal(st.status, 'ok');
  assert.equal(st.headline, '79,5 €/MWh');
  assert.deepEqual(st.series, ['ttf', 'eu']);
  const body = doc.root.body;
  const value = find(body, (n) => n.className === 'gas-headline-value')[0];
  assert.equal(value.textContent, '79,5 €/MWh');
  const delta = find(body, (n) => n.className === 'gas-delta')[0];
  assert.equal(delta.textContent, '−3,1 %');
  assert.equal(delta.dataset.dir, 'down');
  const label = find(body, (n) => n.className === 'gas-headline-label')[0];
  assert.equal(label.textContent, 'gas.ttf-derived · 11. 9. 2026');
  const sub = find(body, (n) => n.className === 'gas-subrow-value').map((n) => n.textContent);
  assert.deepEqual(sub, ['77,2 €/MWh', '75,5 €/MWh', '78,0 €/MWh']);
  const status = find(body, (n) => n.className === 'gas-status')[0];
  assert.equal(status.textContent, 'gas.updated {"date":"11. 9. 2026"}');
  const buttons = find(body, (n) => n.className === 'gas-range');
  assert.deepEqual(buttons.map((b) => b.textContent), ['gas.range-1m', 'gas.range-1y', 'gas.range-max']);
  assert.equal(buttons[0].attributes['aria-pressed'], 'true');
  buttons[2].listeners.click[0]();
  assert.deepEqual(panel._getStateForTest().series, ['monthly', 'ttf'], 'MAX = mesačný IMF rad + denný TTF');
  assert.equal(buttons[2].attributes['aria-pressed'], 'true');
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  panel.setRange('1y');
  assert.equal(panel._getStateForTest().range, '1y');
  panel.setRange('nezmysel');
  assert.equal(panel._getStateForTest().range, '1y');
  assert.equal(find(body, (n) => n.className === 'gas-laic')[0].textContent, 'gas.per-kwh {"ct":"7,95 ct/kWh"}');
  assert.equal(find(body, (n) => n.className === 'gas-note')[0].textContent, 'gas.ttf-derived-note');
  panel.destroy();
  assert.equal(cleared, 42);
  assert.deepEqual(calls, ['prices']);
});

test('panel: chyba proxy = stav error s hláškou; bez koreňa v DOM vracia null; open() otvorí panel', async () => {
  const doc = fakeDoc();
  let collapsed = null;
  const panel = installGasPanel({ doc, t, lang: 'sk', refreshMs: 0, api: { prices: async () => { throw new Error('HTTP 502'); } }, setCollapsed: (v) => { collapsed = v; } });
  await flush();
  const st = panel._getStateForTest();
  assert.equal(st.loaded, false);
  assert.equal(st.status, 'error');
  assert.equal(st.lastError, 'HTTP 502');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[0].textContent, 'gas.unavailable');
  panel.open();
  assert.equal(collapsed, false);
  assert.equal(installGasPanel({ doc: { getElementById: () => null }, t }), null);
});

test('tripwires: markup v index.html, poradie a skrývanie v style.css, inštalácia v ui.js, i18n EN/SK, proxy s kontaktom v UA', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="gas-panel" class="panel-collapsible collapsed" data-panel-id="gas-panel"/);
  assert.match(html, /data-i18n="panel\.gas"/);
  assert.match(html, /<div class="gas-body" data-gas-body><\/div>/);
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /#left-panel-stack > #gas-panel \{ order: 6; \}/, 'hneď za Históriou letov');
  assert.match(css, /body\.cockpit-mode #left-panel-stack > #gas-panel \{ display: none !important; \}/);
  assert.match(css, /body\.ui-clean-view #gas-panel,/);
  assert.match(css, /#left-panel-stack > #gas-panel:not\(\.collapsed\) \.gas-panel-inner/);
  assert.match(css, /\.gas-chart \{/);
  const ui = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
  assert.match(ui, /import \{ installGasPanel \} from '\.\/gasPanel\.js';/);
  assert.match(ui, /\{ id: 'gas-panel' \},/);
  assert.match(ui, /this\._gasPanel = installGasPanel\(\{/);
  for (const key of ['panel.gas', 'gas.prices', 'gas.ttf-derived', 'gas.ttf-derived-note', 'gas.eu-lng', 'gas.nwe', 'gas.south', 'gas.range-1m', 'gas.range-1y', 'gas.range-max', 'gas.per-kwh', 'gas.source-acer', 'gas.source-monthly', 'gas.monthly-label', 'gas.max-label', 'gas.last-label', 'gas.loading', 'gas.unavailable', 'gas.updated', 'gas.stale']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.ttf-derived-note'], /Nie je to burzová kotácia/, 'odvodený TTF sa nikdy nevydáva za kotáciu');
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function gasProxy\(\)/);
  assert.match(vite, /gasProxy\(\),/, 'plugin je zaregistrovaný');
  assert.match(vite, /middlewares\.use\('\/api\/gas\/prices'/);
  assert.match(vite, /OKO-gas\/0\.1 \(https:\/\/github\.com\/vladouh76; vladouh76@gmail\.com\)/, 'User-Agent s kontaktom');
  assert.match(vite, /parseAcerCsv\(await fetchText\(ACER_HISTORICAL_URL\)\)/);
  assert.ok(!/eex\.com|theice\.com/i.test(vite.slice(vite.indexOf('function gasProxy('), vite.indexOf('function gasProxy(') + 8000)), 'žiadne burzové zdroje bez licencie');
});
