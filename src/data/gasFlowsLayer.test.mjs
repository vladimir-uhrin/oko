// src/data/gasFlowsLayer.test.mjs
// Vrstva „Toky plynu“ (2026-09-13): zoskupenie smerov do staníc, popis a farba,
// metadáta karty, lifecycle na falošnom Cesiu (init/enable/update/klik/disable/destroy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAS_FLOWS_LAYER_ID, GAS_FLOWS_LAYER_REFRESH_MS, GAS_FLOW_COLORS, createGasFlowsLayer, groupStations, stationColor,
  stationContextProperties, stationLabelText,
} from './gasFlowsLayer.js';
import { buildFlowsModel, buildFlowsPayload } from './gasFlows.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

const NOW = Date.UTC(2026, 8, 13, 10);
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const row = (operatorKey, pointKey, directionKey, day, kwh) => ({ periodFrom: `${day}T06:00:00+02:00`, operatorKey, pointKey, directionKey, unit: 'kWh/d', value: kwh, flowStatus: 'Provisional' });
const PAYLOAD = buildFlowsPayload([
  row('SK-TSO-0001', 'ITP-00051', 'entry', '2026-09-11', 24_610_000),
  row('SK-TSO-0001', 'ITP-00051', 'exit', '2026-09-11', 0),
  row('BG-TSO-0001', 'ITP-00549', 'entry', '2026-09-11', 380_900_000),
  row('UA-TSO-0001', 'ITP-00184', 'entry', '2026-09-11', 0),
], { fetchedAt: NOW });

function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { values.push(e); return e; }, removeAll() { values.length = 0; } } };
}
function fakeHandler() {
  return { fn: null, destroyed: false, setInputAction(fn) { this.fn = fn; }, destroy() { this.destroyed = true; } };
}
function fakeViewer(pickResult = null) {
  return {
    dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } },
    scene: { canvas: {}, pick: () => pickResult.value, requestRender() {} },
    selectedEntity: undefined,
  };
}

test('groupStations: smery jednej stanice spolu (Lanžhot vstup+výstup, Strandža 1+2), poradie katalógu, úroveň stanice = najlepší smer', () => {
  const model = buildFlowsModel(PAYLOAD, { lang: 'sk', translate: tKey, nowMs: NOW });
  const stations = groupStations(model.groups.flatMap((g) => g.rows));
  assert.equal(stations.length, 21, '32 smerov = 21 staníc (7 SK + 14 na východe)');
  assert.equal(stations[0].name, 'Lanžhot');
  assert.equal(stations[0].rows.length, 2);
  assert.equal(stations[0].level, 'flow', 'vstup tečie, výstup nula → stanica tečie');
  const strandzha = stations.find((s) => s.rows.some((r) => r.id === 'strandzha2'));
  assert.equal(strandzha.rows.length, 2, 'TurkStream + Trans-Balkán na jednej stanici');
  assert.equal(strandzha.name, 'Strandža 2 (TurkStream) / Strandža 1 (Trans-Balkán)');
  assert.equal(strandzha.level, 'flow');
  const sudzha = stations.find((s) => s.rows[0].id === 'sudzha');
  assert.equal(sudzha.level, 'zero');
  assert.equal(stations.find((s) => s.rows[0].id === 'mozyr').level, 'nodata');
  assert.equal(stationLabelText(stations[0]), 'Lanžhot\nCZ → SK 24,6 GWh/d\nSK → CZ 0 GWh/d');
  assert.equal(stationColor('flow').toCssHexString().toLowerCase(), GAS_FLOW_COLORS.flow);
  assert.equal(stationColor('cokolvek').toCssHexString().toLowerCase(), GAS_FLOW_COLORS.nodata);
  const props = stationContextProperties(stations[0], tKey);
  assert.equal(props['CZ → SK'], '24,6 GWh/d · gas.flow-mcm {"v":"2,3"} · gas.flow-avg7 {"v":"24,6 GWh/d"}');
  assert.equal(props['SK → CZ'], '0 GWh/d');
  assert.equal(props['gas.flow-context-day'], '11. 9. · gas.flow-provisional');
  const kap = stations.find((s) => s.rows[0].id === 'kapusany-in');
  assert.equal(stationContextProperties(kap, tKey)['gas.flow-context-note'], 'gas.note-kapusany');
  const single = stationContextProperties(sudzha, tKey);
  assert.equal(single['gas.flow-context-flow'], '0 GWh/d', 'stanica s jedným smerom má generický kľúč');
});

test('lifecycle: init pridá zdroj, enable stiahne toky a postaví 21 bodov s popisom, klik vyberie stanicu, disable zruší handler, destroy uprace', async () => {
  const calls = [];
  const pick = { value: null };
  const handlers = [];
  const layer = createGasFlowsLayer({
    fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => PAYLOAD }; },
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => { const h = fakeHandler(); handlers.push(h); return h; },
    translate: tKey,
    lang: () => 'sk',
    now: () => NOW,
  });
  assert.equal(layer.id, GAS_FLOWS_LAYER_ID);
  assert.equal(layer.updateInterval, GAS_FLOWS_LAYER_REFRESH_MS);
  assert.equal(layer.name, 'layer.gas-flows.name');
  const viewer = fakeViewer(pick);
  layer.init(viewer);
  assert.equal(viewer.dataSources.added.length, 1);
  assert.equal(viewer.dataSources.added[0].show, false, 'zdroj je skrytý, kým vrstva nie je zapnutá');
  layer.enable();
  assert.equal(viewer.dataSources.added[0].show, true);
  assert.equal(handlers.length, 1, 'klikací handler po enable');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ['/api/gas/flows']);
  const st = layer._getStateForTest();
  assert.equal(st.stations, 21);
  assert.equal(st.entities, 21);
  assert.equal(st.error, null);
  const ds = viewer.dataSources.added[0];
  const lanzhot = ds.entities.values[0];
  assert.equal(lanzhot.id, 'gas-flows:48.72,16.97');
  assert.equal(lanzhot.label.text, 'Lanžhot\nCZ → SK 24,6 GWh/d\nSK → CZ 0 GWh/d');
  assert.equal(lanzhot.point.pixelSize, 10, 'tečúca stanica má väčší bod');
  assert.equal(lanzhot.__gasFlowStation, '48.72,16.97');
  const mozyr = ds.entities.values.find((e) => e.properties.name === 'Mozyr');
  assert.equal(mozyr.point.pixelSize, 7);
  assert.equal(mozyr.point.color.toCssHexString().toLowerCase(), GAS_FLOW_COLORS.nodata);
  const stats = layer.getStats();
  assert.equal(stats.count, 3, 'Lanžhot, Strandža, Sudža majú dáta; ostatné nie');
  assert.equal(stats.lastUpdate, NOW);
  assert.match(stats.source, /ENTSOG TP 13-09-2026 https:\/\/transparency\.entsog\.eu\//, 'kredit nesie citáciu podľa čl. 5.2');
  assert.equal(layer.hasContact('gas-flows:48.72,16.97'), true);
  assert.equal(layer.hasContact('nieco'), false);
  // klik: mimo stanice nič, na stanici výber
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(viewer.selectedEntity, undefined);
  pick.value = { id: lanzhot };
  handlers[0].fn({ position: { x: 1, y: 1 } });
  assert.equal(viewer.selectedEntity, lanzhot);
  // update znova: entity sa prestavajú, nie zdvoja
  assert.equal(await layer.update(), true);
  assert.equal(layer._getStateForTest().entities, 21);
  layer.disable();
  assert.equal(handlers[0].destroyed, true);
  assert.equal(ds.show, false);
  assert.equal(viewer.selectedEntity, undefined, 'vypnutie zruší výber stanice');
  layer.destroy(viewer);
  assert.equal(viewer.dataSources.removed.length, 1);
  assert.equal(layer._getStateForTest().entities, null);
});

test('chyba proxy: vrstva ju prizná v getStats a nespadne', async () => {
  const layer = createGasFlowsLayer({ fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }), dataSourceFactory: fakeDataSource, handlerFactory: fakeHandler, translate: tKey, now: () => NOW });
  const viewer = fakeViewer({ value: null });
  layer.init(viewer);
  assert.equal(await layer.update(), false);
  assert.equal(layer.getStats().error, 'upstream');
  assert.equal(layer.getStats().count, 0);
  layer.destroy(viewer);
});

test('register, token a kredit: gas-flows má token 9, i18n meno SK+EN, kredit ENTSOG hovorí „predbežné“ a nesie odkaz', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === GAS_FLOWS_LAYER_ID);
  assert.deepEqual(entry, { id: 'gas-flows', token: '9', disposition: 'enabled-only' });
  assert.ok(EN_STRINGS['layer.gas-flows.name'] && SK_STRINGS['layer.gas-flows.name']);
  for (const key of ['gas.flow-context-flow', 'gas.flow-context-day', 'gas.flow-context-note']) assert.ok(EN_STRINGS[key] && SK_STRINGS[key], key);
  const credit = DATA_CREDITS.find((c) => c.key === 'gas-flows');
  assert.ok(credit, 'kredit existuje');
  assert.match(credit.html, /href="https:\/\/transparency\.entsog\.eu\/"/);
  assert.match(credit.html, /provisional/i);
});
