// src/data/gasFlowsLayer.test.mjs
// Vrstva „Toky plynu“ (2026-09-13): zoskupenie smerov do staníc, karty v overlay
// (kompaktná „card“ + rozšírená „tracked“ s grafmi toku a ceny), normalizácia
// 31-dňových radov, lifecycle na falošnom Cesiu a overlay hostovi, klik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAS_FLOWS_LAYER_ID, GAS_FLOWS_LAYER_REFRESH_MS, GAS_FLOWS_OVERLAY_SOURCE_ID, GAS_FLOW_CHART_DAYS, GAS_FLOW_COLORS, createGasFlowsLayer,
  groupStations, normalizeDaily, stationColor, stationCompactCard, stationContextProperties, stationLabelText, stationTrackedCard,
} from './gasFlowsLayer.js';
import { buildFlowsModel, buildFlowsPayload } from './gasFlows.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

const NOW = Date.UTC(2026, 8, 13, 10);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const row = (operatorKey, pointKey, directionKey, day, kwh) => ({ periodFrom: `${day}T06:00:00+02:00`, operatorKey, pointKey, directionKey, unit: 'kWh/d', value: kwh, flowStatus: 'Provisional' });
const day = (i) => new Date(Date.UTC(2026, 8, 11) - i * 86_400_000).toISOString().slice(0, 10);
const PAYLOAD = buildFlowsPayload([
  ...Array.from({ length: 20 }, (_, i) => row('SK-TSO-0001', 'ITP-00051', 'entry', day(i), 20_000_000 + i * 200_000)),
  ...Array.from({ length: 20 }, (_, i) => row('SK-TSO-0001', 'ITP-00051', 'exit', day(i), i < 5 ? 0 : 3_000_000)),
  row('BG-TSO-0001', 'ITP-00549', 'entry', '2026-09-11', 380_900_000),
  row('UA-TSO-0001', 'ITP-00184', 'entry', '2026-09-11', 0),
], { fetchedAt: NOW });
const PRICES = { acer: { rows: Array.from({ length: 40 }, (_, i) => ({ date: day(39 - i), eu: 70 + i * 0.2, benchmark: -2, ttf: 72 + i * 0.2 })) }, fetchedAt: NOW };
const seriesById = new Map(PAYLOAD.points.map((p) => [p.id, p.series]));

function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { values.push(e); return e; }, removeAll() { values.length = 0; } } };
}
function fakeHandler() {
  return { fn: null, destroyed: false, setInputAction(fn) { this.fn = fn; }, destroy() { this.destroyed = true; } };
}
function fakeHost() {
  return {
    entries: null, options: null, visible: null, cleared: 0, hit: null,
    setEntries(src, entries, options) { this.src = src; this.entries = entries; this.options = options; },
    setVisible(src, v) { this.visible = v; },
    clearSource() { this.cleared += 1; this.entries = null; },
    hitTest() { return this.hit; },
  };
}
function fakeViewer(pick = { value: null }) {
  return {
    dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } },
    scene: { canvas: {}, pick: () => pick.value, requestRender() {} },
    selectedEntity: undefined,
  };
}

test('groupStations: smery jednej stanice spolu, rady po smeroch, úroveň stanice = najlepší smer; popis, farba, metadáta karty kontextu', () => {
  const model = buildFlowsModel(PAYLOAD, { lang: 'sk', translate: tKey, nowMs: NOW });
  const stations = groupStations(model.groups.flatMap((g) => g.rows), seriesById);
  assert.equal(stations.length, 21, '32 smerov = 21 staníc (7 SK + 14 na východe)');
  assert.equal(stations[0].name, 'Lanžhot');
  assert.equal(stations[0].rows.length, 2);
  assert.equal(stations[0].rows[0].series.length, 20, 'rad smeru ide s riadkom');
  assert.equal(stations[0].level, 'flow');
  const strandzha = stations.find((s) => s.rows.some((r) => r.id === 'strandzha2'));
  assert.equal(strandzha.name, 'Strandža 2 (TurkStream) / Strandža 1 (Trans-Balkán)');
  assert.equal(stations.find((s) => s.rows[0].id === 'sudzha').level, 'zero');
  assert.equal(stations.find((s) => s.rows[0].id === 'mozyr').level, 'nodata');
  assert.equal(stationLabelText(stations[0]), 'Lanžhot\nCZ → SK 20,0 GWh/d\nSK → CZ 0 GWh/d');
  assert.equal(stationColor('flow').toCssHexString().toLowerCase(), GAS_FLOW_COLORS.flow);
  assert.equal(stationColor('x').toCssHexString().toLowerCase(), GAS_FLOW_COLORS.nodata);
  const props = stationContextProperties(stations[0], tKey);
  assert.match(props['CZ → SK'], /^20,0 GWh\/d · gas\.flow-mcm /);
  assert.equal(props['gas.flow-context-day'], '11. 9. · gas.flow-provisional');
  assert.equal(stationContextProperties(stations.find((s) => s.rows[0].id === 'sudzha'), tKey)['gas.flow-context-flow'], '0 GWh/d');
});

test('normalizeDaily: os 31 dní končí posledným dňom radu, medzery null, normalizácia maximom, podlaha 0', () => {
  const series = [{ date: '2026-09-11', gwh: 24 }, { date: '2026-09-09', gwh: 12 }, { date: '2026-08-01', gwh: 99 }];
  const n = normalizeDaily(series, Date.UTC(2026, 8, 11));
  assert.equal(n.values.length, GAS_FLOW_CHART_DAYS);
  assert.equal(n.firstDay, '2026-08-12');
  assert.equal(n.lastDay, '2026-09-11');
  assert.equal(n.values[30], 1, 'posledný deň = maximum');
  assert.equal(n.values[28], 0.5);
  assert.equal(n.values[29], null, 'chýbajúci deň = medzera');
  assert.equal(n.max, 24);
  assert.equal(n.last, 24);
  assert.equal(n.values[0], null, 'august je mimo okna');
  const zeros = normalizeDaily([{ date: '2026-09-11', gwh: 0 }, { date: '2026-09-10', gwh: 0 }], Date.UTC(2026, 8, 11));
  assert.deepEqual([zeros.values[29], zeros.values[30], zeros.max], [0, 0, 0], 'samé nuly nedelia nulou');
  assert.equal(normalizeDaily([], NOW).last, null);
});

test('karty: kompaktná = taktická karta lodí (interaktívna, tok + deň); rozšírená = tracked s vlajkami, cenou, dvoma grafmi 31 dní, profilom druhého smeru a pätou', () => {
  const model = buildFlowsModel(PAYLOAD, { lang: 'sk', translate: tKey, nowMs: NOW });
  const stations = groupStations(model.groups.flatMap((g) => g.rows), seriesById);
  const lanzhot = stations[0];
  const pos = { x: 1, y: 2, z: 3 };
  const compact = stationCompactCard(lanzhot, pos, tKey, { activate: () => true });
  assert.equal(compact.id, 'gas-flows:48.72,16.97');
  assert.equal(compact.variant, 'card');
  assert.equal(compact.cardStyle, 'tactical');
  assert.equal(compact.interactive, true, 'klik na kartu otvorí podrobnosti');
  assert.equal(compact.title, 'Lanžhot');
  assert.deepEqual(compact.details, ['CZ → SK 20,0 GWh/d', 'SK → CZ 0 GWh/d', 'gas.card-day {"date":"11. 9."} · gas.flow-provisional']);
  assert.ok(compact.priority > 1000, 'tečúca stanica má prednosť');
  assert.equal(typeof compact.activate, 'function');
  const tracked = stationTrackedCard(lanzhot, pos, { translate: tKey, lang: 'sk', nowMs: NOW, prices: PRICES.acer.rows, citation: 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/' });
  assert.equal(tracked.variant, 'tracked');
  assert.equal(tracked.tracked, true);
  assert.equal(tracked.protected, true);
  assert.equal(tracked.paintLane, 'tracked');
  assert.deepEqual(tracked.route, { origin: { label: 'CZ', iso2: 'CZ' }, destination: { label: 'SK', iso2: 'SK' } }, 'smer s vlajkami');
  assert.equal(tracked.details.length, 4, 'dva smery + deň + cena');
  assert.match(tracked.details[0], /^CZ → SK 20,0 GWh\/d · gas\.flow-mcm .* · gas\.flow-avg7 /);
  assert.equal(tracked.details[3], 'gas.card-price-line {"v":"79,8 €/MWh","ct":"7,98 ct/kWh","date":"11. 9."}', 'posledná cena TTF na karte');
  assert.equal(tracked.charts.mode, 'time');
  assert.equal(tracked.charts.titles.altitude, 'gas.card-flow-chart {"route":"CZ → SK"}');
  assert.equal(tracked.charts.titles.speed, 'gas.card-price-chart');
  assert.equal(tracked.charts.altitude.past.length, 31);
  assert.equal(tracked.charts.altitude.past[11], 1, 'najstarší deň okna (23,8 GWh/d) je maximum klesajúceho radu');
  assert.ok(Math.abs(tracked.charts.altitude.past[30] - 20 / 23.8) < 1e-9, 'najnovší deň 20,0 z 23,8');
  assert.equal(tracked.charts.altitude.past[0], null, 'pred začiatkom radu medzera');
  assert.equal(tracked.charts.altitude.label, 'gas.card-flow-label {"max":"23,8 GWh/d","last":"20,0 GWh/d"}');
  assert.equal(tracked.charts.speed.past.length, 31);
  assert.equal(tracked.charts.speed.past[30], 1);
  assert.equal(tracked.charts.speed.label, 'gas.card-price-label {"max":"79,8 €/MWh","last":"79,8 €/MWh"}');
  assert.deepEqual(tracked.charts.axis, { left: '12. 8.', right: '11. 9.' });
  assert.equal(tracked.profile.label, 'gas.card-flow-chart {"route":"SK → CZ"}');
  assert.equal(tracked.profile.sublabel, '0 GWh/d');
  assert.equal(tracked.profile.altitude.length, 31);
  assert.equal(tracked.profile.altitude[30], 0, 'posledných 5 dní nula');
  assert.equal(tracked.profile.altitude[20], 1, 'staršie dni 3 GWh/d = maximum');
  assert.deepEqual(tracked.footer, ['gas.card-footer', 'ENTSOG TP 13-09-2026 https://transparency.entsog.eu/']);
  const sudzha = stations.find((s) => s.rows[0].id === 'sudzha');
  const single = stationTrackedCard(sudzha, pos, { translate: tKey, lang: 'sk', nowMs: NOW, prices: null });
  assert.equal(single.profile, null, 'jeden smer = bez profilu');
  assert.equal(single.charts, null, 'jeden deň toku a bez cien = bez grafov');
  assert.equal(single.footer[0], 'gas.note-sudzha', 'poznámka k stanici ide do päty');
  assert.equal(single.details.length, 2);
});

test('lifecycle: init → enable stiahne toky aj ceny, 21 bodov + 21 kompaktných kariet; klik na kartu/bod rozšíri, znova zbalí, prázdno zbalí; výber z panelu; disable/destroy upracú', async () => {
  const calls = [];
  const pick = { value: null };
  const handlers = [];
  const host = fakeHost();
  const layer = createGasFlowsLayer({
    fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => (url.includes('prices') ? PRICES : PAYLOAD) }; },
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; },
    overlayHost: host,
    translate: tKey,
    lang: () => 'sk',
    now: () => NOW,
  });
  assert.equal(layer.id, GAS_FLOWS_LAYER_ID);
  assert.equal(layer.updateInterval, GAS_FLOWS_LAYER_REFRESH_MS);
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  assert.equal(viewer.dataSources.added[0].show, false);
  assert.equal(layer.selectStationByRowId('lanzhot-in'), false, 'pred načítaním sa výber zapamätá');
  layer.enable();
  const managerUpdate = layer.update();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls.sort(), ['/api/gas/flows', '/api/gas/prices'], 'enable + manažérsky update = jedno sťahovanie (single-flight)');
  assert.equal(await managerUpdate, true);
  const st = layer._getStateForTest();
  assert.equal(st.stations, 21);
  assert.equal(st.entities, 21);
  assert.equal(st.prices, 40);
  assert.equal(st.selected, '48.72,16.97', 'zapamätaný výber z panelu sa uplatnil po načítaní');
  assert.equal(host.src, GAS_FLOWS_OVERLAY_SOURCE_ID);
  assert.equal(host.entries.length, 21);
  assert.equal(host.visible, true);
  assert.deepEqual(host.options, { cohortLimit: 24, collisionCapacity: 24, moving: false });
  const trackedNow = host.entries.find((e) => e.variant === 'tracked');
  assert.equal(trackedNow.title, 'Lanžhot');
  assert.equal(trackedNow.charts.speed.past.length, 31, 'graf ceny na karte');
  assert.equal(host.entries.filter((e) => e.variant === 'card').length, 20);
  // aktivácia z klávesnice na rozšírenej karte = zbaliť
  assert.equal(trackedNow.activate(), true);
  assert.equal(layer._getStateForTest().selected, null);
  assert.equal(host.entries.filter((e) => e.variant === 'tracked').length, 0);
  // klik na kompaktnú kartu cez hitTest
  host.hit = { entryId: 'gas-flows:42.04,27.45' };
  handlers[0].fn({ position: { x: 5, y: 5 } });
  assert.equal(layer._getStateForTest().selected, '42.04,27.45', 'Strandža po kliknutí na kartu');
  assert.match(host.entries.find((e) => e.variant === 'tracked').title, /^Strandža/);
  handlers[0].fn({ position: { x: 5, y: 5 } });
  assert.equal(layer._getStateForTest().selected, null, 'druhý klik zbalí');
  // klik na bod
  host.hit = null;
  const ds = viewer.dataSources.added[0];
  const sudzhaEntity = ds.entities.values.find((e) => e.properties.name === 'Sudža');
  pick.value = { id: sudzhaEntity };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, sudzhaEntity.__gasFlowStation);
  assert.equal(viewer.selectedEntity, sudzhaEntity);
  // klik na cudzí objekt nechá výber, klik do prázdna zbalí
  pick.value = { id: { cudzi: true } };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, sudzhaEntity.__gasFlowStation);
  pick.value = null;
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(layer._getStateForTest().selected, null);
  // výber z panelu po načítaní
  assert.equal(layer.selectStationByRowId('strandzha1'), true);
  assert.equal(layer._getStateForTest().selected, '42.04,27.45');
  const stats = layer.getStats();
  assert.equal(stats.count, 3);
  assert.match(stats.source, /ENTSOG TP 13-09-2026/);
  assert.equal(await layer.update(), true);
  assert.equal(layer._getStateForTest().entities, 21, 'obnova nezdvojí body');
  layer.disable();
  assert.equal(handlers[0].destroyed, true);
  assert.equal(host.visible, false);
  assert.ok(host.cleared >= 1);
  assert.equal(layer._getStateForTest().selected, null);
  layer.destroy(viewer);
  assert.equal(viewer.dataSources.removed.length, 1);
  assert.equal(layer._getStateForTest().entities, null);
});

test('chyba proxy tokov: vrstva ju prizná a nespadne; chýbajúce ceny nevadia', async () => {
  const host = fakeHost();
  const layer = createGasFlowsLayer({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }), dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(await layer.update(), false);
  assert.equal(layer.getStats().error, 'upstream');
  layer.destroy(viewer);
  const noPrices = createGasFlowsLayer({ fetchImpl: async (url) => (url.includes('prices') ? { ok: false, status: 503, json: async () => ({ error: 'x' }) } : { ok: true, status: 200, json: async () => PAYLOAD }), dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, overlayHost: host, translate: tKey, lang: () => 'sk', now: () => NOW });
  const v2 = fakeViewer();
  noPrices.init(v2);
  assert.equal(await noPrices.update(), true);
  assert.equal(noPrices._getStateForTest().prices, 0, 'bez cien = prázdny rad, karta bez cenového riadku');
  noPrices.destroy(v2);
});

test('register, token a kredit: gas-flows má token 9, i18n mená a texty kariet SK+EN, kredit ENTSOG', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === GAS_FLOWS_LAYER_ID);
  assert.deepEqual(entry, { id: 'gas-flows', token: '9', disposition: 'enabled-only' });
  for (const key of ['layer.gas-flows.name', 'gas.flow-context-flow', 'gas.flow-context-day', 'gas.flow-context-note', 'gas.card-day', 'gas.card-open', 'gas.card-close', 'gas.card-price-line', 'gas.card-flow-chart', 'gas.card-price-chart', 'gas.card-flow-label', 'gas.card-price-label', 'gas.card-footer']) {
    assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  }
  assert.match(SK_STRINGS['gas.card-footer'], /predbežné/, 'karta nikdy nehovorí naživo');
  const credit = DATA_CREDITS.find((c) => c.key === 'gas-flows');
  assert.ok(credit);
  assert.match(credit.html, /href="https:\/\/transparency\.entsog\.eu\/"/);
});
