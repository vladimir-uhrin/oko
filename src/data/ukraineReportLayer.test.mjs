// src/data/ukraineReportLayer.test.mjs — značky stretov z hlásenia GŠ (etapa 2):
// kreslenie po presetoch, farby intenzity, čip/prekryv, karta s prekladom, destroy.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { REPORT_MARKER_URI, UKRAINE_REPORT_ID, createUkraineReportLayer, reportIntensityColor, reportMarkerText } from './ukraineReportLayer.js';

const REPORT = {
  ok: true, total: 213, reportedAtText: '08:00 19.9.', url: 'https://armyinform.com.ua/x', source: 'ArmyInform', official: 'ua',
  directions: [
    { gs: 'Північно-Слобожанський', attacks: 0, text: 'На Північно-Слобожанському та Курському напрямках російські війська наступальних дій не проводили.', shared: true },
    { gs: 'Курський', attacks: 0, text: 'На Північно-Слобожанському та Курському напрямках російські війська наступальних дій не проводили.', shared: true },
    { gs: 'Лиманський', attacks: 5, text: 'П\'ять атак росіяни здійснили на Лиманському напрямку.' },
    { gs: 'Покровський', attacks: 29, text: 'Найбільше бойових зіткнень відбулося на Покровському напрямку — 29.' },
    { gs: 'Оріхівський', attacks: null, text: 'На Оріхівському напрямку тривали бої.' },
  ],
};

function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { const en = { ...e }; values.push(en); return en; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; } } };
}
function fakeHandler() {
  return { actions: {}, destroyed: false, setInputAction(fn, type) { this.actions[type] = fn; }, get move() { return this.actions[Cesium.ScreenSpaceEventType.MOUSE_MOVE]; }, destroy() { this.destroyed = true; } };
}
function fakeHover() {
  return { shown: [], hidden: 0, key: null, show(model, at, key) { this.shown.push({ model, at, key }); this.key = key; return true; }, hide() { this.hidden += 1; this.key = null; }, current() { return this.key; }, isHovered: () => false, destroy() { this.destroyed = true; } };
}
function fakeViewer(pick = () => null) {
  return { dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } }, scene: { canvas: { addEventListener() {}, removeEventListener() {} }, pick, requestRender() {} }, camera: {} };
}
const timers = () => { const pending = []; return { setTimer: (fn) => { pending.push(fn); return pending.length; }, clearTimer: (id) => { pending[id - 1] = null; }, flush() { for (const fn of pending.splice(0)) if (fn) fn(); } }; };
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

function make({ pick, report = REPORT, translateText, nowMs = 1_000_000 } = {}) {
  const viewer = fakeViewer(pick);
  const hover = fakeHover();
  const handler = fakeHandler();
  const clock = timers();
  const fetches = [];
  const layer = createUkraineReportLayer({
    viewer,
    fetchImpl: async () => { fetches.push(1); if (report instanceof Error) throw report; return report; },
    translate: tKey,
    lang: () => 'sk',
    translateText: translateText || (async (text) => `SK: ${text}`),
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => handler,
    hoverFactory: () => hover,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => nowMs,
  });
  return { layer, viewer, hover, handler, clock, fetches };
}

test('farby intenzity a text značky', () => {
  assert.equal(reportIntensityColor(null), '#8a97a3');
  assert.equal(reportIntensityColor(0), '#8aa0b6');
  assert.equal(reportIntensityColor(5), '#e6eef4');
  assert.equal(reportIntensityColor(12), '#ffb547');
  assert.equal(reportIntensityColor(29), '#f87171');
  assert.equal(reportMarkerText(null), '—');
  assert.equal(reportMarkerText(0), '0');
  assert.equal(reportMarkerText(29.4), '29');
  assert.match(REPORT_MARKER_URI, /^data:image\/svg\+xml;charset=utf-8,/);
});

test('bez viewera neškodné', async () => {
  const layer = createUkraineReportLayer({});
  assert.equal(await layer.show(), false);
  assert.equal(layer.getState().error, 'no-viewer');
});

test('show: jeden fetch, značka na každý preset so smerom (Sumy zlúčené, Orichiv „—"), farby, opakovaný show bez fetchu', async () => {
  const { layer, viewer, fetches } = make();
  assert.equal(viewer.dataSources.added.length, 1);
  assert.equal(await layer.show(), true);
  assert.equal(fetches.length, 1);
  const { ds, records } = layer._getStateForTest();
  assert.equal(ds.show, true);
  assert.deepEqual([...records.keys()].sort(), ['lyman', 'orikhiv', 'pokrovsk', 'sumy']);
  const label = (id) => records.get(id).entity.label;
  assert.equal(label('sumy').text, '0');
  assert.equal(label('lyman').text, '5');
  assert.equal(label('pokrovsk').text, '29');
  assert.equal(label('orikhiv').text, '—');
  assert.equal(label('pokrovsk').fillColor.toCssHexString().toLowerCase(), '#f87171');
  const bb = records.get('lyman').entity.billboard;
  assert.equal(bb.image, REPORT_MARKER_URI);
  assert.equal(bb.heightReference, Cesium.HeightReference.CLAMP_TO_GROUND);
  assert.equal(bb.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  await layer.show();
  assert.equal(fetches.length, 1, 'do 30 min sa znova neťahá');
  const state = layer.getState();
  assert.equal(state.report.total, 213);
  assert.deepEqual(state.byScene.sumy, { attacks: 0, unknown: false, gs: ['Північно-Слобожанський', 'Курський'] });
  assert.equal(state.byScene.orikhiv.unknown, true);
});

test('čip STRETY (setEnabled) a hide skryjú zdroj; refresh ťahá znova; chyba sa prizná', async () => {
  const { layer } = make();
  await layer.show();
  const { ds } = layer._getStateForTest();
  layer.setEnabled(false);
  assert.equal(ds.show, false);
  assert.equal(layer.isEnabled(), false);
  layer.setEnabled(true);
  assert.equal(ds.show, true);
  layer.hide();
  assert.equal(ds.show, false);
  assert.equal(layer.isShown(), false);
  const failing = make({ report: new Error('upstream') });
  assert.equal(await failing.layer.show(), false);
  assert.equal(failing.layer.getState().error, 'upstream');
  assert.equal(failing.layer._getStateForTest().records.size, 0);
});

test('karta: smer, počet, hlásenie, originál, po preklade sa karta prekreslí; päta = celé hlásenie', async () => {
  let picked = null;
  const resolvers = [];
  const { layer, hover, handler, clock } = make({ pick: () => picked, translateText: () => new Promise((resolve) => resolvers.push(resolve)) });
  await layer.show();
  const { records } = layer._getStateForTest();
  picked = { id: records.get('lyman').entity };
  handler.move({ endPosition: { x: 100, y: 120 } });
  clock.flush();
  assert.equal(hover.shown.length, 1);
  const first = hover.shown[0].model;
  assert.equal(first.layerId, 'ukraine-report');
  assert.equal(first.title, 'Lyman direction');
  assert.equal(first.kindText, 'ukraine.report.kind');
  assert.deepEqual(first.details.slice(0, 2), ['ukraine.report.attacks {"n":5}', 'ukraine.report.summary {"total":213,"time":"08:00 19.9."}']);
  assert.equal(first.details[2], 'П\'ять атак росіяни здійснили на Лиманському напрямку.');
  assert.equal(first.details.at(-1), 'ukraine.report.claim');
  assert.equal(first.source, 'ukraine.report.source');
  assert.equal(resolvers.length, 1, 'preklad sa vyžiadal raz');
  resolvers[0]('Päť útokov Rusi vykonali na Lymanskom smere.');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(hover.shown.length, 2, 'po preklade sa karta prekreslí');
  assert.equal(hover.shown[1].model.details[2], 'Päť útokov Rusi vykonali na Lymanskom smere.');
  assert.match(hover.shown[1].model.details[3], /^ukraine\.report\.translated · ukraine\.report\.original: П'ять/);
  // Orichiv: neuvedený počet.
  picked = { id: records.get('orikhiv').entity };
  handler.move({ endPosition: { x: 100, y: 120 } });
  clock.flush();
  assert.equal(hover.shown.at(-1).model.details[0], 'ukraine.report.unknown');
  // Mimo značky: karta zmizne, ale len ak bola naša.
  picked = null;
  handler.move({ endPosition: { x: 5, y: 5 } });
  clock.flush();
  assert.ok(hover.hidden >= 1);
});

test('destroy odoberie zdroj, handler aj kartu', async () => {
  const { layer, viewer, handler, hover } = make();
  await layer.show();
  layer.destroy();
  assert.equal(viewer.dataSources.removed.length, 1);
  assert.equal(handler.destroyed, true);
  assert.equal(hover.destroyed, true);
  assert.equal(await layer.show(), false);
  assert.equal(layer.id, UKRAINE_REPORT_ID);
});
