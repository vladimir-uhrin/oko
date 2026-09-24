// src/data/ukraineReportLayer.test.mjs — značky stretov z hlásenia GŠ (etapa 2):
// kreslenie po presetoch, farby intenzity, čip/prekryv, karta s prekladom, destroy.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { REPORT_BOLT_FAR_M, REPORT_MARKER_URI, UKRAINE_REPORT_ID, boltSizePx, createUkraineReportLayer, deconflictLabels, defaultBoltImage, labelBox, placeLabelOffsetX, reportIntensityColor, reportMarkerText } from './ukraineReportLayer.js';
import { buildPlaceIndex } from './ukraineReportPlaces.js';

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
  const moveEnd = { listeners: [], addEventListener(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; } };
  return {
    dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } },
    scene: { canvas: { addEventListener() {}, removeEventListener() {}, clientWidth: 1200, clientHeight: 800 }, pick, requestRender() {} },
    camera: { moveEnd },
  };
}
const timers = () => { const pending = []; return { setTimer: (fn) => { pending.push(fn); return pending.length; }, clearTimer: (id) => { pending[id - 1] = null; }, flush() { for (const fn of pending.splice(0)) if (fn) fn(); } }; };
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

const settle = () => new Promise((r) => setTimeout(r, 0));

function make({ pick, report = REPORT, translateText, nowMs = 1_000_000, placeIndex, reservePlaces, boltImageFactory, projectorFactory } = {}) {
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
    terrainSampler: async (points) => points.map(() => 80),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: () => nowMs,
    placeIndex,
    reservePlaces,
    boltImageFactory,
    projectorFactory,
    settleMs: 0,
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
  assert.equal(bb.heightReference, undefined, 'bez CLAMP_TO_GROUND — výška z resolvera');
  assert.equal(bb.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  await new Promise((r) => setTimeout(r, 0));
  const lymanPos = records.get('lyman').entity.position;
  const carto = Cesium.Cartographic.fromCartesian(lymanPos.getValue ? lymanPos.getValue(Cesium.JulianDate.now()) : lymanPos);
  assert.ok(Math.abs(carto.height - 80) < 0.5, 'značka zdvihnutá na výšku terénu');
  assert.equal(records.get('lyman').lifted, true);
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

test('sídla z odsekov: bod + popisok na každé menované sídlo, sídlo dvoch smerov raz so sčítanými zmienkami, karta sídla, neurčené spočítané, override prekreslí', async () => {
  const index = buildPlaceIndex([
    { geometry: { type: 'Point', coordinates: [37.86, 48.98] }, properties: { id: 11, name: 'Торське', lang: 'uk', cls: 'village', pop: 2000 } },
    { geometry: { type: 'Point', coordinates: [37.7, 49.0] }, properties: { id: 12, name: 'Новоселівка', lang: 'uk', cls: 'village' } },
    { geometry: { type: 'Point', coordinates: [37.3, 48.4] }, properties: { id: 13, name: 'Новоселівка', lang: 'uk', cls: 'village' } },
    { geometry: { type: 'Point', coordinates: [37.20337, 48.35399] }, properties: { id: 14, name: 'Родинське', lang: 'uk', en: 'Rodynske', cls: 'town', pop: 9000 } },
  ]);
  const reservations = [];
  const report = { ...REPORT, directions: [
    { gs: 'Лиманський', attacks: 5, text: 'П’ять атак росіяни здійснили на Лиманському напрямку — у районі Торського та в напрямках Надії й Новоселівки.' },
    { gs: 'Покровський', attacks: 29, text: 'Найбільше бойових зіткнень відбулося на Покровському напрямку — 29. Ворог атакував у районах Родинського, Новоселівки та Торського.' },
  ] };
  let picked = null;
  let indexCalls = 0;
  const { layer, hover, handler, clock } = make({ pick: () => picked, report, placeIndex: async () => { indexCalls += 1; return index; }, reservePlaces: (ids) => reservations.push([...ids].sort()) });
  await layer.show();
  await settle();
  const { placeRecords, ds } = layer._getStateForTest();
  assert.deepEqual(reservations.at(-1), [11, 12, 13, 14], 'podklad dostal id nakreslených sídiel');
  const byName = (name) => [...placeRecords.values()].filter((r) => r.place.name === name);
  assert.equal(placeRecords.size, 4, 'Torske raz, Rodynske raz, dve rôzne Novoselivky');
  assert.equal(byName('Новоселівка').length, 2, 'rovnaké meno na dvoch miestach = dva body (kľúč meno + poloha)');
  assert.deepEqual(byName('Новоселівка').map((r) => `${r.lon}:${r.hits[0].scene.id}`).sort(), ['37.3:pokrovsk', '37.7:lyman'], 'každý smer dostal svoju Novoselivku');
  const [torske] = byName('Торське');
  assert.equal(torske.mentions, 2, 'Torske menujú dva smery → jeden bod');
  assert.deepEqual(torske.hits.map((h) => h.scene.id), ['lyman', 'pokrovsk']);
  assert.equal(torske.entity.label.text, 'Torske ×2', 'popisok latinkou + počet zmienok');
  assert.equal(torske.entity.point.color.toCssHexString(), Cesium.Color.fromCssColorString(reportIntensityColor(29)).toCssHexString(), 'farba = intenzívnejší z oboch smerov');
  assert.equal(byName('Родинське')[0].entity.label.text, 'Rodynske');
  assert.equal(ds.entities.values.filter((e) => String(e.id).includes(':place:')).length, 4);
  const state = layer.getState();
  assert.equal(state.placesCount, 4);
  assert.equal(state.placesUnresolved, 1, '„Надії" nie je v indexe');
  assert.equal(indexCalls, 1);
  // Karta sídla.
  picked = { id: torske.entity };
  handler.move({ endPosition: { x: 10, y: 10 } });
  clock.flush();
  const model = hover.shown.at(-1).model;
  assert.equal(model.kindText, 'ukraine.report.place-kind');
  assert.equal(model.title, 'Torske · Торське');
  assert.equal(model.details[0], 'ukraine.report.place-mentions {"n":2}');
  assert.equal(model.details[1], 'Lyman direction · ukraine.report.attacks {"n":5}');
  assert.equal(model.details[2], 'Pokrovsk direction · ukraine.report.attacks {"n":29}');
  assert.ok(model.details.includes('ukraine.report.place-note'));
  assert.equal(model.details.at(-1), 'ukraine.report.claim');
  // Historické hlásenie bez sídiel → body zmiznú; návrat na živé ich vráti.
  layer.setOverride({ ...report, directions: [{ gs: 'Лиманський', attacks: 1, text: 'Одна атака на Лиманському напрямку.' }] });
  await settle();
  assert.equal(placeRecords.size, 0);
  assert.equal(ds.entities.values.filter((e) => String(e.id).includes(':place:')).length, 0);
  assert.deepEqual(reservations.at(-1), [], 'bez sídiel sa rezervácia uvoľní');
  layer.setOverride(null);
  await settle();
  assert.equal(placeRecords.size, 4);
  assert.deepEqual(reservations.at(-1), [11, 12, 13, 14]);
  // Čip STRETY vypnutý = podklad dostane svoje obce späť; zapnutý = znova rezervované.
  layer.setEnabled(false);
  assert.deepEqual(reservations.at(-1), []);
  layer.setEnabled(true);
  assert.deepEqual(reservations.at(-1), [11, 12, 13, 14]);
  const n = reservations.length;
  layer.setEnabled(true);
  assert.equal(reservations.length, n, 'nezmenená rezervácia sa neposiela znova');
});

test('K4: blesk pri sídle — veľkosť podľa intenzity, odstup popisku, kreslenie do plátna', () => {
  assert.equal(boltSizePx(null), 15, 'bez počtu = základ');
  assert.ok(boltSizePx(5) > 15 && boltSizePx(29) > boltSizePx(5), 'väčšia intenzita = väčší blesk');
  assert.ok(boltSizePx(29) <= 26, 'strop');
  assert.ok(boltSizePx(5, 3) > boltSizePx(5, 1), 'viac zmienok o kúsok väčší');
  assert.equal(placeLabelOffsetX(false), 8, 'bod = 8 px');
  assert.equal(placeLabelOffsetX(true, 20), 14, 'blesk = polovica + 4');
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, scale() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {} };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  assert.ok(defaultBoltImage('#f87171', doc, 2), 'plátno vzniklo');
  assert.equal(defaultBoltImage('#f87171', null), null, 'bez document nič');
});

test('K4: v štýle karta sú sídla z hlásenia blesky (bod skrytý), default = bod; setStyle prepína a dohľad blesku', async () => {
  const index = buildPlaceIndex([
    { geometry: { type: 'Point', coordinates: [37.86, 48.98] }, properties: { id: 11, name: 'Торське', lang: 'uk', cls: 'village' } },
  ]);
  const report = { ...REPORT, directions: [{ gs: 'Лиманський', attacks: 5, text: 'Бої у районі Торського.' }] };
  const boltCalls = [];
  const { layer } = make({ report, placeIndex: async () => index, boltImageFactory: (css) => { boltCalls.push(css); return `bolt:${css}`; } });
  await layer.show();
  await settle();
  const { placeRecords } = layer._getStateForTest();
  assert.equal(placeRecords.size, 1);
  const rec = [...placeRecords.values()][0];
  const e = rec.entity;
  assert.equal(e.billboard.image, 'bolt:#e6eef4', 'blesk sfarbený intenzitou (5 útokov)');
  assert.ok(boltCalls.includes('#e6eef4'));
  // default: bod viditeľný, blesk skrytý, popisok bez podložky
  assert.equal(e.point.show, true);
  assert.equal(e.billboard.show, false);
  assert.equal(e.label.pixelOffset.x, 8);
  assert.equal(e.label.showBackground, false, 'v default žiadna podložka popisku');
  assert.equal(e.billboard.distanceDisplayCondition.far, REPORT_BOLT_FAR_M);
  // karta: bod skrytý, blesk viditeľný, popisok odsadený od blesku
  layer.setStyle('karta');
  assert.equal(layer.getStyle(), 'karta');
  assert.equal(e.point.show, false);
  assert.equal(e.billboard.show, true);
  assert.equal(e.label.pixelOffset.x, placeLabelOffsetX(true, rec.boltSize));
  assert.equal(e.label.showBackground, true, 'na KARTE tmavá podložka popisku bojov');
  // späť
  layer.setStyle('default');
  assert.equal(e.point.show, true);
  assert.equal(e.billboard.show, false);
});

test('K4: bez boltImageFactory ostane bod aj v karte (napr. Node/headless)', async () => {
  const index = buildPlaceIndex([{ geometry: { type: 'Point', coordinates: [37.86, 48.98] }, properties: { id: 11, name: 'Торське', lang: 'uk', cls: 'village' } }]);
  const report = { ...REPORT, directions: [{ gs: 'Лиманський', attacks: 5, text: 'Бої у районі Торського.' }] };
  const { layer } = make({ report, placeIndex: async () => index, boltImageFactory: () => null });
  await layer.show();
  await settle();
  const rec = [...layer._getStateForTest().placeRecords.values()][0];
  assert.equal(rec.hasBolt, false);
  assert.equal(rec.entity.billboard, undefined, 'žiadny billboard');
  layer.setStyle('karta');
  assert.equal(rec.entity.point.show, true, 'bod ostane, keď blesk nie je');
});

test('K4: rozmiestnenie popiskov — labelBox polohy, greedy bez prekryvu, meče pevné, plno = skryť', () => {
  const it = { x: 100, y: 100, w: 40, h: 16, off: 10 };
  assert.deepEqual(labelBox(it, 'right'), { x: 110, y: 92, w: 40, h: 16 });
  assert.deepEqual(labelBox(it, 'left'), { x: 50, y: 92, w: 40, h: 16 });
  assert.deepEqual(labelBox(it, 'up'), { x: 80, y: 74, w: 40, h: 16 });
  assert.deepEqual(labelBox(it, 'down'), { x: 80, y: 110, w: 40, h: 16 });
  // dva takmer na sebe: vyššia priorita ostane vpravo, nižšia ustúpi inam (nie null)
  const a = { key: 'a', x: 100, y: 100, w: 60, h: 16, off: 8, priority: 10 };
  const b = { key: 'b', x: 108, y: 100, w: 60, h: 16, off: 8, priority: 5 };
  const r = deconflictLabels([a, b]);
  assert.equal(r.a, 'right');
  assert.notEqual(r.b, 'right', 'nižšia priorita nedostane obsadené right');
  assert.ok(r.b !== null, 'našla sa iná voľná poloha');
  // meč (fixed) je vždy right a nikdy sa neskrýva
  const m = { key: 'm', x: 100, y: 100, w: 30, h: 16, off: 16, fixed: 'right', priority: Infinity };
  assert.equal(deconflictLabels([m]).m, 'right');
  // obklopený zo všetkých strán → skrytý
  const big = { key: 'big', x: 100, y: 100, w: 400, h: 400, off: 0, fixed: 'right', priority: Infinity };
  const t = { key: 't', x: 150, y: 150, w: 40, h: 16, off: 8, priority: 1 };
  assert.equal(deconflictLabels([big, t]).t, null, 'keď žiadna poloha nesadne, popisok sa skryje');
});

test('K4: relayout na KARTE presunie/schová prekrývajúce sa popisky (všetky na jednom mieste)', async () => {
  const index = buildPlaceIndex([
    { geometry: { type: 'Point', coordinates: [37.80, 48.99] }, properties: { id: 21, name: 'Торське', lang: 'uk', cls: 'village' } },
    { geometry: { type: 'Point', coordinates: [37.70, 49.00] }, properties: { id: 22, name: 'Ямпіль', lang: 'uk', cls: 'village' } },
    { geometry: { type: 'Point', coordinates: [37.30, 48.40] }, properties: { id: 23, name: 'Дружба', lang: 'uk', cls: 'village' } },
  ]);
  const report = { ...REPORT, directions: [{ gs: 'Лиманський', attacks: 12, text: 'Бої у районах Торського, Ямполя та Дружби.' }] };
  const proj = () => () => ({ x: 600, y: 400 }); // všetko na jeden bod = maximálny konflikt
  const { layer } = make({ report, placeIndex: async () => index, boltImageFactory: (css) => `bolt:${css}`, projectorFactory: proj });
  layer.setStyle('karta');
  await layer.show();
  await settle();
  layer.relayout();
  const labels = [...layer._getStateForTest().placeRecords.values()].map((r) => r.entity.label);
  assert.ok(labels.length >= 2, 'aspoň dve sídla');
  const plainRight = labels.filter((l) => l.show !== false && l.pixelOffset.y === 0 && l.pixelOffset.x > 0).length;
  assert.ok(plainRight < labels.length, 'nie všetky ostali vpravo — konflikt vyriešený');
  assert.ok(labels.some((l) => l.show === false) || labels.some((l) => l.pixelOffset.y !== 0 || l.pixelOffset.x < 0), 'aspoň presun alebo skrytie');
  // Aj v bežnom štýle sa prekrývajúce popisky rozmiestnia (vlastník 2026-09-24);
  // odstup je od bodu (8 px), nie od blesku.
  layer.setStyle('default');
  layer.relayout();
  const after = [...layer._getStateForTest().placeRecords.values()].map((r) => r.entity.label);
  const plainAfter = after.filter((l) => l.show !== false && l.pixelOffset.y === 0 && l.pixelOffset.x > 0).length;
  assert.ok(plainAfter < after.length, 'aj v bežnom štýle konflikt vyriešený');
  assert.ok(after.every((l) => l.show === false || Math.abs(l.pixelOffset.x) === 8 || l.pixelOffset.x === 0), 'odstup od bodu 8 px (bez blesku)');
  // Skrytá vrstva vráti všetko do pôvodnej polohy.
  layer.hide();
  layer.relayout();
  assert.ok([...layer._getStateForTest().placeRecords.values()].every((r) => r.entity.label.show !== false && r.entity.label.pixelOffset.x === 8), 'skrytá = pôvodná poloha');
});
