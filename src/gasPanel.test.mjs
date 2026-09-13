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
import { buildFlowsPayload, formatGwhDay } from './data/gasFlows.js';
import { buildGiePayload } from './data/gasStorage.js';
import { buildImportsPayload } from './data/gasImports.js';
import { EUROSTAT_IMPORTS_JSON_STAT } from './data/fixtures/eurostatImportsFixture.mjs';
import { LNG_FLEET_REFRESH_MS, buildLngFleetIndex, buildLngFleetPayload } from './data/lngFleet.js';

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
const flowRow = (operatorKey, pointKey, directionKey, day, kwh) => ({ periodFrom: `${day}T06:00:00+02:00`, operatorKey, pointKey, directionKey, unit: 'kWh/d', value: kwh, flowStatus: 'Provisional' });
const FLOWS = buildFlowsPayload([
  ...Array.from({ length: 14 }, (_, i) => flowRow('SK-TSO-0001', 'ITP-00051', 'entry', `2026-08-${String(i + 15).padStart(2, '0')}`, 20_000_000 + i * 300_000)),
  flowRow('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-11', 24_610_000),
  flowRow('UA-TSO-0001', 'ITP-00184', 'entry', '2026-09-11', 0),
  flowRow('BG-TSO-0001', 'ITP-00549', 'entry', '2026-09-11', 44_100_000),
], { fetchedAt: NOW });
const agsiRow = (code, day, full, gis, wgv, inj, wd, status = 'C') => ({ name: code, code, gasDayStart: day, gasInStorage: gis, workingGasVolume: wgv, injection: inj, withdrawal: wd, full, status, trend: '0.1', consumptionFull: '21.79', updatedAt: `${day} 08:00:00` });
const euDays = (n, make) => Array.from({ length: n }, (_, i) => make(new Date(Date.UTC(2026, 8, 11) - i * 86_400_000).toISOString().slice(0, 10), i));
const STORAGE = buildGiePayload('agsi', {
  eu: euDays(400, (day, i) => agsiRow('eu', day, String(60 + (i % 20)), '766.9528', '1131.5658', '2020.25', '652.4', i === 0 ? 'E' : 'C')),
  SK: [agsiRow('SK', '2026-09-11', '52.09', '19.1879', '36.839', '54.71', '34.8')],
  UA: [agsiRow('UA', '2026-09-11', '34.75', '111.5264', '320.9532', '374.94', '0')],
}, { fetchedAt: NOW, errors: { DE: 'upstream HTTP 500' } });
const LNG = buildGiePayload('alsi', {
  eu: euDays(400, (day, i) => ({ name: 'EU', code: 'eu', gasDayStart: day, inventory: { gwh: '30579.26' }, dtmi: { gwh: '62917.06' }, sendOut: String(3000 + (i % 5) * 20), status: 'E' })),
  PL: [{ name: 'Poland', code: 'PL', gasDayStart: '2026-09-11', inventory: { gwh: '3289' }, dtmi: { gwh: '3289' }, sendOut: '179', status: 'C' }],
}, { fetchedAt: NOW });
const IMPORTS = buildImportsPayload(EUROSTAT_IMPORTS_JSON_STAT, { fetchedAt: NOW });
const FLEET_INDEX = buildLngFleetIndex({ ships: 1, withMmsi: 1, snapshot: '2026-09-13T18:00:00Z', license: 'CC0 1.0 — Wikidata', rows: [{ imo: '9385673', name: 'GDF Suez Neptune', mmsi: ['257356000'], lengthM: 283.1, built: '2009', operator: 'Höegh LNG' }] });
const fleetRow = (o) => ({ type: '80', speed: 0, course: 0, nav_status: 0, last_position_epoch: Math.floor(NOW / 1000) - 120, ...o });
const FLEET = buildLngFleetPayload([
  fleetRow({ mmsi: '257356000', imo: '9385673', name: 'GDF SUEZ NEPTUNE', destination: 'SWINOUJSCIE', eta: '09-15 06:00', speed: 12.3, length_m: 283, lat: 54.2, lon: 14.3 }),
  fleetRow({ mmsi: '111111111', name: 'GASLOG GENEVA', destination: 'FUJAIRAH', speed: 14, length_m: 290, lat: 25, lon: 56 }),
  fleetRow({ mmsi: '222222222', name: 'MAERSK ESSEX', type: '70', length_m: 366, lat: 51, lon: 3 }),
], FLEET_INDEX, { now: NOW, feed: { status: 'live', active: true, retained: 3, lastMessageAt: '2026-09-13T09:59:00Z', error: null } });
const FLEET_OFF = buildLngFleetPayload([], FLEET_INDEX, { now: NOW, feed: { status: 'idle', active: false, retained: 0, lastMessageAt: null, error: null } });

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
      tag, children: [], dataset: {}, style: {}, attributes: {}, listeners: {}, hidden: false, _text: '', className: '', value: '',
      // Ako v DOM: `textContent = ''` vyprázdni aj deti (legenda sa prekresľuje viackrát).
      get textContent() { return node._text; },
      set textContent(v) { node._text = String(v); if (node._text === '') node.children.length = 0; },
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
  const flown = [];
  const flownVessels = [];
  let cleared = null;
  const panel = installGasPanel({
    doc, t, lang: 'sk', nowMs: () => NOW,
    api: {
      prices: async () => { calls.push('prices'); return PAYLOAD; },
      flows: async () => { calls.push('flows'); return FLOWS; },
      storage: async () => { calls.push('storage'); return STORAGE; },
      lng: async () => { calls.push('lng'); return LNG; },
      imports: async () => { calls.push('imports'); return IMPORTS; },
      fleet: async () => { calls.push('fleet'); return FLEET; },
    },
    setIntervalImpl: (fn, ms) => { intervals.push(ms); return 42; },
    clearIntervalImpl: (id) => { cleared = id; },
    onFlyTo: (target) => { flown.push(target); },
    onFlyToVessel: (target) => { flownVessels.push(target); },
  });
  assert.ok(panel);
  assert.deepEqual(intervals, [GAS_PANEL_REFRESH_MS, LNG_FLEET_REFRESH_MS], 'periodická obnova panela + rýchlejšia obnova LNG tankerov');
  await flush();
  const st = panel._getStateForTest();
  assert.equal(st.loaded, true);
  assert.equal(st.ok, true);
  assert.equal(st.status, 'ok');
  assert.equal(st.headline, '79,5 €/MWh');
  assert.deepEqual(st.series, ['ttf', 'eu']);
  assert.deepEqual(st.flows, { loaded: true, ok: true, status: 'ok', lastError: null, rows: 43 }, 'karta TOKY má všetkých 43 smerov katalógu');
  const flowsCardEl = find(doc.root.body, (n) => n.dataset.card === 'flows')[0];
  const flowRows = find(flowsCardEl, (n) => n.className === 'gas-flow-row');
  assert.equal(flowRows.length, 43);
  assert.equal(flowRows[0].dataset.id, 'lanzhot-in');
  assert.equal(flowRows[0].dataset.level, 'flow');
  assert.equal(find(flowRows[0], (n) => n.className === 'gas-flow-value')[0].textContent, '24,6 GWh/d');
  assert.match(find(flowRows[0], (n) => n.className === 'gas-flow-sub')[0].textContent, /^gas\.flow-mcm \{"v":"2,3"\} · .*11\. 9\. · gas\.flow-provisional$/);
  const sudzha = flowRows.find((r) => r.dataset.id === 'sudzha');
  assert.equal(sudzha.dataset.level, 'zero');
  assert.equal(find(sudzha, (n) => n.className === 'gas-flow-note')[0].textContent, 'gas.note-sudzha');
  assert.equal(flowRows.find((r) => r.dataset.id === 'mozyr').dataset.level, 'nodata');
  assert.equal(flowRows[0].attributes.role, 'button', 'riadok toku je klikateľný');
  assert.equal(flowRows[0].attributes.title, 'gas.flow-fly');
  flowRows[0].listeners.click[0]();
  assert.deepEqual(flown, [{ id: 'lanzhot-in', name: 'Lanžhot', lat: 48.72, lon: 16.97 }], 'klik na riadok = prelet k stanici');
  const prevented = { key: 'Enter', preventDefault() { this.stopped = true; }, stopped: false };
  flowRows[1].listeners.keydown[0](prevented);
  assert.equal(prevented.stopped, true);
  assert.equal(flown.length, 2);
  const flowsStatus = find(doc.root.body, (n) => n.className === 'gas-status')[1];
  assert.equal(flowsStatus.textContent, 'gas.flows-updated {"date":"11. 9. 2026"}');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-source')[1].textContent, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/');
  const { points: storagePoints, ...storageState } = st.storage;
  assert.deepEqual(storageState, { loaded: true, ok: true, status: 'ok', lastError: null, range: '1y', headline: '60,0 %', rows: 10 }, 'karta ZÁSOBNÍKY: EÚ titulok, 10 krajín');
  assert.ok(storagePoints >= 360 && storagePoints <= 367, `1R = rok bodov (${storagePoints})`);
  const storageCard = find(doc.root.body, (n) => n.dataset.card === 'storage')[0];
  assert.equal(find(storageCard, (n) => n.className === 'gas-headline-value')[0].textContent, '60,0 %');
  assert.equal(find(storageCard, (n) => n.className === 'gas-delta')[0].textContent, 'gas.storage-net-in {"v":"1 368 GWh/d"}');
  assert.equal(find(storageCard, (n) => n.className === 'gas-headline-label')[0].textContent, 'gas.storage-eu · 11. 9. 2026 · gas.status-estimated');
  assert.match(find(storageCard, (n) => n.className === 'gas-headline-sub')[0].textContent, /^gas\.storage-twh .* · gas\.storage-year-ago .* · gas\.storage-days \{"d":"80"\}$/);
  const storageRows = find(storageCard, (n) => n.className === 'gas-flow-row');
  assert.equal(storageRows.length, 10);
  assert.deepEqual([storageRows[0].dataset.id, storageRows[0].dataset.level, find(storageRows[0], (n) => n.className === 'gas-flow-value')[0].textContent], ['SK', 'ok', '52,1 %']);
  assert.equal(find(storageRows[0], (n) => n.className === 'gas-bar-fill')[0].style.width, '52.09%', 'pás naplnenia');
  assert.equal(find(storageRows[0], (n) => n.className === 'gas-bar')[0].hidden, false);
  const de = storageRows.find((r) => r.dataset.id === 'DE');
  assert.equal(de.dataset.level, 'nodata');
  assert.equal(find(de, (n) => n.className === 'gas-bar')[0].hidden, true, 'bez dát bez pásu');
  assert.equal(find(de, (n) => n.className === 'gas-flow-sub')[0].textContent, 'upstream HTTP 500');
  const storageBtns = find(storageCard, (n) => n.className === 'gas-range');
  assert.deepEqual(storageBtns.map((b) => b.textContent), ['gas.range-1y', 'gas.range-5y']);
  storageBtns[1].listeners.click[0]();
  assert.equal(panel._getStateForTest().storage.range, '5y');
  assert.equal(panel._getStateForTest().storage.points, 400, '5R = celá história fixtúry');
  assert.equal(find(storageCard, (n) => n.className === 'gas-status')[0].textContent, 'gas.storage-updated {"date":"11. 9. 2026"}');
  assert.equal(find(storageCard, (n) => n.className === 'gas-source')[0].textContent, 'gas.gie-source', 'GIE musí byť uvedené ako zdroj');
  assert.deepEqual(st.lng, { loaded: true, ok: true, status: 'ok', lastError: null, headline: '3 000 GWh/d', rows: 10 }, 'karta LNG');
  const lngCard = find(doc.root.body, (n) => n.dataset.card === 'lng')[0];
  assert.equal(find(lngCard, (n) => n.className === 'gas-headline-sub')[0].textContent, 'gas.lng-inventory {"v":"30 579 GWh","b":"62 917 GWh","p":"48,6 %"}');
  const lngRows = find(lngCard, (n) => n.className === 'gas-flow-row');
  assert.deepEqual([lngRows[0].dataset.id, lngRows[0].dataset.level, find(lngRows[0], (n) => n.className === 'gas-flow-value')[0].textContent], ['PL', 'ok', '179 GWh/d']);
  assert.equal(find(lngRows[0], (n) => n.className === 'gas-bar')[0].hidden, true, 'LNG riadky bez pásu');
  assert.deepEqual(st.imports, { loaded: true, ok: true, status: 'ok', lastError: null, range: '2y', headline: '24,7 mld m³', rows: 9, months: 24 }, 'karta DOVOZ: EÚ mimo EÚ, 9 skupín, 2R');
  const importsCard = find(doc.root.body, (n) => n.dataset.card === 'imports')[0];
  assert.equal(find(importsCard, (n) => n.className === 'gas-headline-value')[0].textContent, '24,7 mld m³');
  assert.equal(find(importsCard, (n) => n.className === 'gas-delta')[0].textContent, 'gas.imports-yoy {"v":"+0,0 %"}');
  assert.equal(find(importsCard, (n) => n.className === 'gas-headline-label')[0].textContent, 'gas.imports-eu · jún 2026');
  assert.equal(find(importsCard, (n) => n.className === 'gas-headline-sub')[0].textContent, 'gas.imports-twh {"v":"261 TWh"} · gas.imports-ru-share {"pct":"10 %","base":"22 %"} · gas.imports-transit-share {"pct":"0 %","base":"9,3 %"} · gas.imports-lng-share {"pct":"45 %"}');
  const legendRows = find(importsCard, (n) => n.className === 'gas-legend-row');
  assert.equal(legendRows.length, 9);
  assert.deepEqual([legendRows[0].dataset.key, legendRows[0].dataset.level], ['no', 'ok']);
  assert.equal(find(legendRows[0], (n) => n.className === 'gas-legend-name')[0].textContent, 'gas.imports-group-no');
  assert.equal(find(legendRows[0], (n) => n.className === 'gas-legend-value')[0].textContent, '8,0 mld m³');
  assert.equal(find(legendRows[0], (n) => n.className === 'gas-legend-pct')[0].textContent, '32 %');
  assert.match(find(legendRows[0], (n) => n.className === 'gas-swatch')[0].style.background, /^rgba\(/, 'vzorka farby vrstvy');
  assert.equal(legendRows[8].dataset.level, 'zero', 'nulové skupiny na konci, stlmené');
  assert.equal(find(importsCard, (n) => n.className === 'gas-status')[0].textContent, 'gas.imports-updated {"date":"6/2026"}');
  assert.equal(find(importsCard, (n) => n.className === 'gas-note')[0].textContent, 'gas.imports-note');
  assert.match(find(importsCard, (n) => n.className === 'gas-source')[0].textContent, /^gas\.imports-source /, 'Eurostat ako zdroj + zoskupenie OKO');
  const importsBtns = find(importsCard, (n) => n.className === 'gas-range');
  assert.deepEqual(importsBtns.map((b) => b.textContent), ['gas.range-2y', 'gas.range-max']);
  importsBtns[1].listeners.click[0]();
  assert.equal(panel._getStateForTest().imports.months, 66, 'MAX = od 2021');
  panel.setImportsRange('2y');
  assert.equal(panel._getStateForTest().imports.months, 24);
  assert.deepEqual(st.supply, { ok: true, status: 'ok', headline: formatGwhDay(3044.1, 'sk'), rows: 8, days: 31, lngMissing: false }, 'karta ZDROJE: TurkStream 44,1 + LNG 3 000 z fixtúr');
  const supplyCard = find(doc.root.body, (n) => n.dataset.card === 'supply')[0];
  assert.equal(find(doc.root.body, (n) => n.dataset.card).map((n) => n.dataset.card).join(','), 'prices,flows,supply,storage,lng,fleet,imports', 'poradie kariet');
  assert.deepEqual(st.fleet, { loaded: true, ok: true, state: 'live', status: 'ok', lastError: null, count: 2, headline: '2', enableVisible: false }, 'karta LNG TANKERY: 2 z 3 kontaktov sú LNG');
  const fleetCard = find(doc.root.body, (n) => n.dataset.card === 'fleet')[0];
  assert.equal(find(fleetCard, (n) => n.className === 'gas-headline-value')[0].textContent, '2');
  assert.equal(find(fleetCard, (n) => n.className === 'gas-headline-label')[0].textContent, 'gas.fleet-label {"scanned":"3"}');
  assert.equal(find(fleetCard, (n) => n.className === 'gas-headline-sub')[0].textContent, 'gas.fleet-confirmed-n {"n":1} · gas.fleet-likely-n {"n":1} · gas.fleet-eu-bound {"n":1} · gas.fleet-moving {"n":2,"fresh":2}');
  const fleetRows = find(fleetCard, (n) => n.className === 'gas-flow-row');
  assert.equal(fleetRows.length, 2);
  assert.deepEqual([fleetRows[0].dataset.id, fleetRows[0].dataset.confidence, fleetRows[0].dataset.eu, fleetRows[0].dataset.fleet, fleetRows[0].attributes.role], ['257356000', 'confirmed', 'true', 'true', 'button'], 'loď do EÚ prvá, klikateľná');
  assert.equal(find(fleetRows[0], (n) => n.className === 'gas-flow-route')[0].textContent, 'NO · GDF SUEZ NEPTUNE', 'vlajka z MMSI (257 = Nórsko)');
  assert.equal(find(fleetRows[0], (n) => n.className === 'gas-flow-value')[0].textContent, 'gas.fleet-confirmed');
  assert.equal(find(fleetRows[0], (n) => n.className === 'gas-flow-sub')[0].textContent, 'gas.fleet-eu · 283 m · gas.fleet-built {"y":"2009"} · gas.fleet-speed {"v":"12,3"} · SWINOUJSCIE · ETA 09-15 06:00 · gas.fleet-age-min {"n":2}');
  assert.equal(find(fleetRows[0], (n) => n.className === 'gas-flow-note')[0].textContent, 'gas.fleet-reason-wikidata-imo · Höegh LNG');
  fleetRows[0].listeners.click[0]();
  assert.deepEqual(flownVessels, [{ mmsi: '257356000', name: 'GDF SUEZ NEPTUNE', lat: 54.2, lon: 14.3 }], 'klik = prelet k lodi');
  assert.equal(find(fleetCard, (n) => n.className === 'gas-status')[0].textContent, 'gas.fleet-updated {"time":"10:00 UTC"}');
  assert.equal(find(fleetCard, (n) => n.className === 'gas-note')[0].textContent, 'gas.fleet-note {"ships":"1"}');
  assert.equal(find(fleetCard, (n) => n.className === 'gas-source')[0].textContent, 'gas.fleet-source {"date":"2026-09-13"}');
  const fleetButtons = find(fleetCard, (n) => n.className === 'gas-range');
  assert.deepEqual(fleetButtons.map((b) => [b.dataset.action, b.hidden]), [['refresh', false], ['enable-ais', true]]);
  fleetButtons[0].listeners.click[0]();
  await flush();
  assert.equal(calls.filter((c) => c === 'fleet').length, 2, 'OBNOVIŤ načíta znova');
  assert.equal(find(supplyCard, (n) => n.className === 'gas-headline-value')[0].textContent, formatGwhDay(3044.1, 'sk'));
  assert.equal(find(supplyCard, (n) => n.className === 'gas-headline-label')[0].textContent, 'gas.supply-eu · 11. 9. 2026');
  assert.equal(find(supplyCard, (n) => n.className === 'gas-headline-sub')[0].textContent, 'gas.supply-origin-LNG 99 % · gas.supply-origin-RU 1,4 % · gas.supply-complete {"n":2,"m":2}');
  const supplyRows = find(supplyCard, (n) => n.className === 'gas-legend-row');
  assert.equal(supplyRows.length, 8);
  assert.deepEqual([supplyRows[0].dataset.key, supplyRows[0].dataset.level, supplyRows[1].dataset.key], ['LNG', 'ok', 'RU']);
  assert.equal(supplyRows[7].dataset.level, 'nodata', 'pôvody bez hlásiaceho bodu sú bez dát, nie nula');
  assert.equal(find(supplyCard, (n) => n.className === 'gas-status')[0].textContent, 'gas.supply-updated {"date":"11. 9. 2026"}');
  assert.equal(find(supplyCard, (n) => n.className === 'gas-source')[0].textContent, 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/ · gas.supply-lng-source');
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
  const pricesCardEl = find(body, (n) => n.dataset.card === 'prices')[0];
  const buttons = find(pricesCardEl, (n) => n.className === 'gas-range');
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
  assert.deepEqual(calls, ['prices', 'flows', 'storage', 'lng', 'imports', 'fleet', 'fleet'], 'všetky karty sa načítajú naraz, každá raz (LNG tankery + jedno ručné OBNOVIŤ)');
});

test('panel: chyba proxy = stav error s hláškou; bez koreňa v DOM vracia null; open() otvorí panel', async () => {
  const doc = fakeDoc();
  let collapsed = null;
  const panel = installGasPanel({
    doc, t, lang: 'sk', refreshMs: 0,
    api: {
      prices: async () => { throw new Error('HTTP 502'); },
      flows: async () => { throw new Error('HTTP 429'); },
      storage: async () => { const e = new Error('no_key'); e.status = 503; e.code = 'no_key'; throw e; },
      lng: async () => { throw new Error('HTTP 504'); },
      imports: async () => { throw new Error('HTTP 502 eurostat'); },
      fleet: async () => { throw new Error('HTTP 500 fleet'); },
    },
    setCollapsed: (v) => { collapsed = v; },
  });
  await flush();
  const st = panel._getStateForTest();
  assert.equal(st.loaded, false);
  assert.equal(st.status, 'error');
  assert.equal(st.lastError, 'HTTP 502');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[0].textContent, 'gas.unavailable');
  assert.deepEqual(st.flows, { loaded: false, ok: false, status: 'error', lastError: 'HTTP 429', rows: 0 }, 'karta TOKY zlyhá nezávisle od cien');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[1].textContent, 'gas.flows-unavailable');
  assert.equal(st.supply.status, 'error', 'mix dodávok bez tokov nejde');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[2].textContent, 'gas.supply-unavailable');
  assert.equal(st.storage.status, 'error');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[3].textContent, 'gas.gie-no-key', '503 no_key = hláška o chýbajúcom kľúči, nie generická');
  assert.equal(st.lng.status, 'error');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[4].textContent, 'gas.lng-unavailable');
  assert.equal(st.imports.status, 'error');
  assert.equal(st.imports.lastError, 'HTTP 502 eurostat');
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[6].textContent, 'gas.imports-unavailable');
  assert.deepEqual([st.fleet.status, st.fleet.lastError], ['error', 'HTTP 500 fleet']);
  assert.equal(find(doc.root.body, (n) => n.className === 'gas-status')[5].textContent, 'gas.fleet-unavailable');
  panel.open();
  assert.equal(collapsed, false);
  assert.equal(installGasPanel({ doc: { getElementById: () => null }, t }), null);
});

test('panel: LNG tankery bez feedu AIS = stav off s tlačidlom ZAPNÚŤ AIS, ktoré zapne vrstvu lodí a o 8 s načíta znova', async () => {
  const doc = fakeDoc();
  const calls = [];
  const timeouts = [];
  let enabled = 0;
  const panel = installGasPanel({
    doc, t, lang: 'sk', refreshMs: 0, nowMs: () => NOW,
    api: {
      prices: async () => PAYLOAD, flows: async () => FLOWS, storage: async () => STORAGE, lng: async () => LNG, imports: async () => IMPORTS,
      fleet: async () => { calls.push('fleet'); return FLEET_OFF; },
    },
    onEnableAis: () => { enabled += 1; },
    setTimeoutImpl: (fn, ms) => { timeouts.push([fn, ms]); return 7; },
  });
  await flush();
  const st = panel._getStateForTest().fleet;
  assert.deepEqual([st.loaded, st.ok, st.state, st.status, st.count, st.enableVisible], [true, false, 'off', 'off', 0, true]);
  const fleetCard = find(doc.root.body, (n) => n.dataset.card === 'fleet')[0];
  assert.equal(find(fleetCard, (n) => n.className === 'gas-status')[0].textContent, 'gas.fleet-off');
  const enableBtn = find(fleetCard, (n) => n.dataset.action === 'enable-ais')[0];
  assert.equal(enableBtn.hidden, false);
  enableBtn.listeners.click[0]();
  assert.equal(enabled, 1, 'zapne vrstvu Živé plavidlá AIS cez ui.js');
  assert.deepEqual(timeouts.map(([, ms]) => ms), [8000]);
  timeouts[0][0]();
  await flush();
  assert.equal(calls.length, 2, 'po zapnutí feedu sa karta načíta znova');
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
  assert.match(ui, /onFlyTo: \(\{ id, lat, lon \}\) => \{/, 'klik na riadok toku preletí kameru');
  assert.match(ui, /selectStationByRowId\?\.\(id\)/, 'a otvorí rozšírenú kartu stanice');
  assert.match(ui, /setEnabled\?\.\('gas-flows', true, \{ origin: 'user' \}\)/, 'a zapne vrstvu staníc');
  const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(main, /import gasFlowsLayer from '\.\/data\/gasFlowsLayer\.js';/);
  assert.match(main, /dataManager\.register\(gasFlowsLayer\);/, 'vrstva tokov je zaregistrovaná');
  for (const key of ['panel.gas', 'gas.prices', 'gas.ttf-derived', 'gas.ttf-derived-note', 'gas.eu-lng', 'gas.nwe', 'gas.south', 'gas.range-1m', 'gas.range-1y', 'gas.range-max', 'gas.per-kwh', 'gas.source-acer', 'gas.source-monthly', 'gas.monthly-label', 'gas.max-label', 'gas.last-label', 'gas.loading', 'gas.unavailable', 'gas.updated', 'gas.stale']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.ttf-derived-note'], /Nie je to burzová kotácia/, 'odvodený TTF sa nikdy nevydáva za kotáciu');
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function gasProxy\(\)/);
  assert.match(vite, /gasProxy\(\),/, 'plugin je zaregistrovaný');
  assert.match(vite, /middlewares\.use\('\/api\/gas\/prices'/);
  assert.match(vite, /middlewares\.use\('\/api\/gas\/flows'/);
  assert.match(vite, /entsogFlowsUrl\(GAS_FLOW_POINTS, window\)/, 'všetky smery jedným dopytom');
  assert.match(vite, /FLOWS_TTL_MS = 60 \* 60_000/, 'ENTSOG čl. 5.6: raz za hodinu');
  for (const key of ['gas.flows', 'gas.flows-sk', 'gas.flows-east', 'gas.flows-loading', 'gas.flows-unavailable', 'gas.flows-updated', 'gas.flows-note', 'gas.flow-mcm', 'gas.flow-avg7', 'gas.flow-provisional', 'gas.flow-confirmed', 'gas.flow-nodata', 'gas.note-vyrava', 'gas.note-kapusany', 'gas.note-lab', 'gas.note-turkstream', 'gas.note-transbalkan', 'gas.note-nordstream', 'gas.note-imatra', 'gas.note-baltic', 'gas.note-kotlovka', 'gas.note-sudzha', 'gas.note-belarus', 'gas.note-isaccea', 'gas.note-bereg', 'gas.note-ungheni', 'gas.note-tap', 'gas.note-kipi']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.flows-updated'], /predbežné, D−1/, 'toky sa nikdy nevydávajú za živé');
  assert.match(vite, /middlewares\.use\('\/api\/gas\/storage', withGieKey\(storage\)\)/);
  assert.match(vite, /middlewares\.use\('\/api\/gas\/lng', withGieKey\(lng\)\)/);
  assert.match(vite, /headers: \{ 'x-key': gieKey\(\), 'User-Agent': USER_AGENT/, 'kľúč GIE ide len v hlavičke zo servera');
  assert.match(vite, /error: 'no_key', detail: 'GIE_API_KEY missing'/, 'bez kľúča 503 no_key');
  assert.match(vite, /GIE_TTL_MS = 3 \* 60 \* 60_000/);
  assert.ok(!/process\.env/.test(readFileSync(new URL('./data/gasStorage.js', import.meta.url), 'utf8')), 'klient kľúč nikdy nečíta (žiadne process.env v klientskom module)');
  for (const key of ['gas.storage', 'gas.storage-loading', 'gas.storage-unavailable', 'gas.storage-updated', 'gas.storage-eu', 'gas.storage-twh', 'gas.storage-net-in', 'gas.storage-net-out', 'gas.storage-year-ago', 'gas.storage-days', 'gas.storage-note', 'gas.status-estimated', 'gas.status-confirmed', 'gas.range-5y', 'gas.lng', 'gas.lng-loading', 'gas.lng-unavailable', 'gas.lng-updated', 'gas.lng-eu', 'gas.lng-inventory', 'gas.lng-tanks', 'gas.lng-note', 'gas.gie-no-key', 'gas.gie-source']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.gie-source'], /GIE AGSI\+ \/ ALSI/, 'GIE ako zdroj je podmienka API');
  // Etapa 6: dovoz podľa pôvodu z Eurostatu (bez kľúča, raz denne, zoskupenie v proxy).
  assert.match(vite, /middlewares\.use\('\/api\/gas\/imports', imports\.handler\)/);
  assert.match(vite, /fetchText\(eurostatImportsUrl\(\)\)/);
  assert.match(vite, /IMPORTS_TTL_MS = 24 \* 60 \* 60_000/, 'Eurostat aktualizuje mesačne — raz denne stačí');
  for (const key of ['gas.imports', 'gas.imports-loading', 'gas.imports-unavailable', 'gas.imports-updated', 'gas.imports-eu', 'gas.imports-twh', 'gas.imports-yoy', 'gas.imports-ru-share', 'gas.imports-transit-share', 'gas.imports-lng-share', 'gas.imports-intra', 'gas.imports-of-which-lng', 'gas.imports-year-ago', 'gas.imports-group-no', 'gas.imports-group-ru', 'gas.imports-group-transit', 'gas.imports-group-dz', 'gas.imports-group-az', 'gas.imports-group-us', 'gas.imports-group-qa', 'gas.imports-group-lng-other', 'gas.imports-group-other', 'gas.imports-note', 'gas.imports-source', 'gas.range-2y']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.imports-note'], /tranzit/, 'poznámka priznáva tranzitné priradenie partnera');
  assert.match(SK_STRINGS['gas.imports-source'], /Eurostat/, 'Eurostat ako zdroj (podmienka re-use)');
  assert.match(SK_STRINGS['gas.imports-source'], /nezodpovedá/, 'Eurostat žiada disclaimer pri upravených dátach');
  assert.match(css, /\.gas-legend-row \{/);
  // Etapa 7: mix dodávok podľa pôvodu — žiadny nový dopyt, len katalóg bodov s pôvodom a LNG z ALSI.
  for (const key of ['gas.flows-west', 'gas.note-franpipe', 'gas.note-zeepipe', 'gas.note-interconnector', 'gas.note-dornum', 'gas.note-emden', 'gas.note-nybro', 'gas.note-bbl', 'gas.note-medgaz', 'gas.note-transmed', 'gas.note-greenstream', 'gas.note-tarifa', 'gas.supply', 'gas.supply-loading', 'gas.supply-unavailable', 'gas.supply-updated', 'gas.supply-eu', 'gas.supply-mcm', 'gas.supply-complete', 'gas.supply-avg7', 'gas.supply-points', 'gas.supply-lng-points', 'gas.supply-lng-source', 'gas.supply-note', 'gas.supply-origin-NO', 'gas.supply-origin-RU', 'gas.supply-origin-RU-UA', 'gas.supply-origin-DZ', 'gas.supply-origin-LY', 'gas.supply-origin-AZ', 'gas.supply-origin-UK', 'gas.supply-origin-LNG']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.supply-updated'], /predbežné, D−1/, 'mix sa nikdy nevydáva za živý');
  assert.match(SK_STRINGS['gas.supply-note'], /Bez domácej ťažby/, 'poznámka priznáva, čo v mixe nie je');
  // Etapa 8: LNG tankery z úložiska AIS tejto relácie — trasa nikdy nespúšťa feed sama.
  assert.match(vite, /middlewares\.use\('\/api\/gas\/lng-fleet'/);
  const fleetRoute = vite.slice(vite.indexOf("middlewares.use('/api/gas/lng-fleet'"), vite.indexOf("middlewares.use('/api/gas/storage'"));
  assert.ok(fleetRoute.length > 100 && !/ensureAisStreamConnection/.test(fleetRoute), 'trasa LNG tankerov nesmie otvárať AISStream — to robí vrstva lodí');
  assert.match(vite, /'Cache-Control': 'no-store', 'X-GEV-Cache': 'NONE' \}\);\n\s+res\.end\(JSON\.stringify\(payload\)\);/, 'živá odpoveď bez cache');
  assert.match(ui, /onFlyToVessel: \(\{ mmsi, lat, lon \}\) => \{/, 'klik na loď preletí kameru');
  assert.match(ui, /selectById\?\.\(mmsi\)/, 'a vyberie loď vo vrstve');
  assert.match(ui, /onEnableAis: \(\) => \{ void this\._dataManager\?\.setEnabled\?\.\('ais-live-vessels', true, \{ origin: 'user' \}\); \}/);
  assert.match(css, /\.gas-flow-row\[data-fleet\] \{ grid-template-columns: 1fr;/);
  for (const key of ['gas.fleet', 'gas.fleet-loading', 'gas.fleet-unavailable', 'gas.fleet-off', 'gas.fleet-missing-key', 'gas.fleet-connecting', 'gas.fleet-error', 'gas.fleet-updated', 'gas.fleet-label', 'gas.fleet-confirmed-n', 'gas.fleet-likely-n', 'gas.fleet-eu-bound', 'gas.fleet-moving', 'gas.fleet-confirmed', 'gas.fleet-likely', 'gas.fleet-reason-wikidata-imo', 'gas.fleet-reason-wikidata-mmsi', 'gas.fleet-reason-name', 'gas.fleet-reason-name-size', 'gas.fleet-reason-terminal-size', 'gas.fleet-no-destination', 'gas.fleet-built', 'gas.fleet-speed', 'gas.fleet-age-min', 'gas.fleet-age-h', 'gas.fleet-eu', 'gas.fleet-fly', 'gas.fleet-refresh', 'gas.fleet-enable-ais', 'gas.fleet-note', 'gas.fleet-source']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['gas.fleet-note'], /tretina svetovej flotily/, 'poznámka priznáva pokrytie zoznamu');
  assert.match(SK_STRINGS['gas.fleet-likely'], /pravdepodobne/, 'heuristika sa nevydáva za potvrdenie');
  assert.match(css, /#history-panel\.collapsed,\n#gas-panel\.collapsed \{\n  width: var\(--left-collapsed-width\);/, 'zbalené panely ľavého stĺpca majú jednu šírku');
  assert.match(vite, /OKO-gas\/0\.1 \(https:\/\/github\.com\/vladouh76; vladouh76@gmail\.com\)/, 'User-Agent s kontaktom');
  assert.match(vite, /parseAcerCsv\(await fetchText\(ACER_HISTORICAL_URL\)\)/);
  assert.ok(!/eex\.com|theice\.com/i.test(vite.slice(vite.indexOf('function gasProxy('), vite.indexOf('function gasProxy(') + 8000)), 'žiadne burzové zdroje bez licencie');
});
