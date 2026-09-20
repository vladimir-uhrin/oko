// src/data/ukraineBaseLayer.test.mjs — prekryv podkladu UKRAJINA (etapa 1):
// lenivé načítanie štyroch súborov po meta, čipy = show zdrojov, obce až
// zblízka a len kohorta, riedenie popisov, karta pri prechode myšou, chýbajúci
// snímok sa prizná, destroy uprace.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { UKRAINE_BASE_ID, createUkraineBaseLayer } from './ukraineBaseLayer.js';
import { VILLAGE_LOAD_MAX_HEIGHT_M } from './ukraineBase.js';

const META = { snapshot: '2026-09-19T12:00:00.000Z', datasets: { places: { features: 2 } } };
const point = (id, cls, name, lon, lat, extra = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, cls, name, lang: 'uk', ...extra } });
const line = (props, coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props });
const DATA = {
  meta: META,
  places: { type: 'FeatureCollection', features: [point(1, 'city', 'Краматорськ', 37.55, 48.72, { en: 'Kramatorsk', pop: 150000 }), point(2, 'town', 'Лиман', 37.80, 48.99, { pop: 20000 })] },
  villages: { type: 'FeatureCollection', features: [point(3, 'village', 'Ямпіль', 37.95, 48.95), point(4, 'village', 'Дробишеве', 37.75, 49.05), point(5, 'village', 'Далеко', 30.0, 50.0)] },
  roads: { type: 'FeatureCollection', features: [line({ cls: 'primary', ref: 'M-03' }, [[37.5, 48.9], [37.9, 48.9]]), line({ cls: 'secondary' }, [[37.5, 49.0], [37.9, 49.0]])] },
  rivers: { type: 'FeatureCollection', features: [line({ name: 'Сіверський Донець', en: 'Siverskyi Donets', lang: 'uk', km: 650 }, [[37.4, 48.95], [38.0, 48.95]]), line({ name: 'Жеребець', lang: 'uk', km: 45 }, [[37.9, 48.9], [37.95, 49.1]])] },
  oblasts: { type: 'FeatureCollection', features: [line({ rels: [100, 200] }, [[37.0, 48.0], [38.0, 48.0]])], oblasts: [{ id: 100, name: 'Донецька область', en: 'Donetsk Oblast', iso: 'UA-14', center: [37.5, 48.3] }] },
};

function fakeFetch(data = DATA, calls = []) {
  return async (url) => {
    calls.push(String(url));
    const name = String(url).replace(/^.*\/api\/ukraine\/base\//, '').replace(/\?.*$/, '');
    if (!(name in data)) return { ok: false, status: 404, json: async () => ({ error: 'no_snapshot' }) };
    return { ok: true, status: 200, json: async () => data[name] };
  };
}
function fakeDataSource(id) {
  const values = [];
  return {
    id, show: true,
    entities: { values, add(e) { const entity = { ...e }; values.push(entity); return entity; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; } },
  };
}
function fakeViewer({ height = 120_000, lon = 37.75, lat = 48.95, pick = () => null, rect = null } = {}) {
  const moveEnd = { listeners: [], addEventListener(fn) { this.listeners.push(fn); return () => { this.listeners = this.listeners.filter((f) => f !== fn); }; } };
  const canvas = { clientWidth: 1200, clientHeight: 800, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, removeEventListener(type) { delete this.listeners[type]; } };
  return {
    dataSources: { added: [], removed: [], add(ds) { this.added.push(ds); }, remove(ds) { this.removed.push(ds); } },
    scene: { canvas, pick, requestRender() { this.renders = (this.renders || 0) + 1; } },
    camera: {
      positionCartographic: { height, longitude: Cesium.Math.toRadians(lon), latitude: Cesium.Math.toRadians(lat) },
      computeViewRectangle: () => (rect ? Cesium.Rectangle.fromDegrees(...rect) : Cesium.Rectangle.fromDegrees(37.2, 48.6, 38.4, 49.4)),
      moveEnd,
      flights: [],
      flyTo(options) { this.flights.push(options); },
    },
  };
}
let lastHoverFactoryOptions = null;
function fakeHover(options) {
  lastHoverFactoryOptions = options || null;
  return { shown: [], hidden: 0, show(model, at, key) { this.shown.push({ model, at, key }); return true; }, hide() { this.hidden += 1; }, isHovered: () => false, destroy() { this.destroyed = true; } };
}
function fakeHandler() {
  return {
    actions: {}, destroyed: false,
    setInputAction(fn, type) { this.actions[type] = fn; },
    get fn() { return this.actions[Cesium.ScreenSpaceEventType.MOUSE_MOVE]; },
    get click() { return this.actions[Cesium.ScreenSpaceEventType.LEFT_CLICK]; },
    destroy() { this.destroyed = true; },
  };
}
/** Premietnutie: lon → x, lat → y v px (bez Cesia), aby sa dalo riediť. */
const projector = () => (position) => {
  const c = Cesium.Cartographic.fromCartesian(position);
  return { x: (Cesium.Math.toDegrees(c.longitude) - 37) * 1000, y: (49.5 - Cesium.Math.toDegrees(c.latitude)) * 1000 };
};
const timers = () => {
  const pending = [];
  return { pending, setTimer: (fn) => { pending.push(fn); return pending.length; }, clearTimer: (id) => { pending[id - 1] = null; }, flush() { const fns = pending.splice(0); for (const fn of fns) if (fn) fn(); } };
};
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);

function make(overrides = {}) {
  const calls = [];
  const viewer = overrides.viewer || fakeViewer(overrides.camera);
  const hover = fakeHover();
  const handler = fakeHandler();
  const clock = timers();
  const layer = createUkraineBaseLayer({
    viewer,
    fetchImpl: fakeFetch(overrides.data || DATA, calls),
    translate: tKey,
    lang: () => 'sk',
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => handler,
    hoverFactory: (o) => { fakeHover(o); return hover; },
    groundSupport: () => true,
    terrainSampler: overrides.terrainSampler || (async (points) => { sampled.push(points.length); return points.map(() => 120); }),
    projectorFactory: projector,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { layer, viewer, hover, handler, clock, calls, sampled };
}
const sampled = [];
const settle = () => new Promise((r) => setTimeout(r, 0));

test('bez viewera je prekryv neškodný', async () => {
  const layer = createUkraineBaseLayer({});
  assert.equal(await layer.show(), false);
  assert.equal(layer.getState().error, 'no-viewer');
});

test('show: meta najprv, potom 4 súbory s verziou snímku; entity podľa častí; villages sa neťahajú zďaleka', async () => {
  const { layer, viewer, calls } = make({ camera: { height: 900_000 } });
  assert.equal(viewer.dataSources.added.length, 4, 'štyri zdroje (sídla, cesty, rieky, oblasti)');
  assert.equal(viewer.dataSources.added.every((ds) => ds.show === false), true, 'na začiatku skryté');
  const ok = await layer.show();
  assert.equal(ok, true);
  assert.equal(calls[0], '/api/ukraine/base/meta');
  assert.deepEqual(calls.slice(1).map((u) => u.replace(/\?.*$/, '')).sort(), ['/api/ukraine/base/oblasts', '/api/ukraine/base/places', '/api/ukraine/base/rivers', '/api/ukraine/base/roads']);
  assert.ok(calls[1].includes('?v=2026-09-19T12%3A00%3A00.000Z'), 'súbory nesú verziu snímku');
  assert.equal(calls.some((u) => u.includes('/villages')), false, 'z 900 km sa obce neťahajú');
  const { sources, placeRecords } = layer._getStateForTest();
  assert.equal(placeRecords.size, 2);
  assert.equal(sources.places.entities.values.length, 2);
  assert.equal(sources.roads.entities.values.length, 2);
  assert.equal(sources.rivers.entities.values.length, 3, '2 čiary + 1 popisok veľkej rieky (Donec ≥ 200 km), Žerebec bez popisku');
  assert.equal(sources.oblasts.entities.values.length, 2, 'hranica + popisok oblasti');
  assert.equal(sources.places.show, true);
  const state = layer.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.snapshotDate?.startsWith('19.'), true);
  assert.deepEqual(state.counts, { places: 2, villagesCohort: 0, roads: 2, rivers: 2, oblasts: 1 });
  // Popisok mesta je verzálkami z name:en, mestečko prepisom.
  const labels = sources.places.entities.values.map((e) => e.label.text);
  assert.deepEqual(labels, ['KRAMATORSK', 'Lyman']);
  // Čiary sú na zemi s klasifikáciou BOTH a DDC.
  const road = sources.roads.entities.values[0];
  assert.equal(road.polyline.clampToGround, true);
  assert.equal(road.polyline.classificationType, Cesium.ClassificationType.BOTH);
  assert.ok(road.polyline.distanceDisplayCondition instanceof Cesium.DistanceDisplayCondition);
  // Body a popisky NEmajú CLAMP_TO_GROUND (pri streamovaní dlaždíc drahé); terén ich nekryje.
  const city = sources.places.entities.values[0];
  assert.equal(city.point.heightReference, undefined);
  assert.equal(city.label.heightReference, undefined);
  assert.equal(city.label.disableDepthTestDistance, Number.POSITIVE_INFINITY);
});

test('výšky: sídla aj voľné popisky sa zdvihnú RAZ z resolvera (dávkovo), nie pri každej dlaždici; zlyhanie = elipsoid + odklad', async () => {
  sampled.length = 0;
  const { layer } = make({ camera: { height: 900_000 } });
  await layer.show();
  await settle(); await settle();
  const { placeRecords, looseLabels, liftSamples } = layer._getStateForTest();
  assert.deepEqual(sampled, [2, 2], 'jedna dávka pre sídla, jedna pre popisky riek/oblastí');
  assert.equal(liftSamples, 4);
  for (const r of placeRecords.values()) {
    assert.equal(r.lifted, true);
    assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(r.position).height - 120) < 0.5, 'záznam nesie zdvihnutú polohu');
    assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(r.entity.position.getValue ? r.entity.position.getValue(Cesium.JulianDate.now()) : r.entity.position).height - 120) < 0.5, 'entita tiež');
  }
  assert.equal(looseLabels.every((l) => l.lifted), true);
  await layer.show();
  await settle();
  assert.deepEqual(sampled, [2, 2], 'druhý show nič nevzorkuje');
  // Zlyhanie resolvera: ostáva elipsoid, ďalší pokus až po odklade.
  sampled.length = 0;
  const failing = make({ camera: { height: 900_000 }, terrainSampler: async (points) => { sampled.push(points.length); throw new Error('proxy down'); } });
  await failing.layer.show();
  await settle(); await settle();
  const first = [...failing.layer._getStateForTest().placeRecords.values()][0];
  assert.equal(first.lifted, false);
  assert.ok(Math.abs(Cesium.Cartographic.fromCartesian(first.position).height) < 0.5);
  assert.equal(sampled.length, 1, 'po chybe sa druhá dávka (popisky) v odklade nespúšťa');
});

test('čipy: časť vypnutá = zdroj skrytý; hide skryje všetko bez straty dát; druhý show nič neťahá', async () => {
  const { layer, calls } = make({ camera: { height: 900_000 } });
  await layer.show();
  const { sources } = layer._getStateForTest();
  layer.setPart('roads', false);
  assert.equal(sources.roads.show, false);
  assert.equal(sources.rivers.show, true);
  assert.deepEqual(layer.getParts(), { places: true, roads: false, rivers: true, oblasts: true });
  layer.hide();
  assert.equal(layer.isShown(), false);
  assert.equal(sources.places.show, false);
  const before = calls.length;
  await layer.show();
  assert.equal(calls.length, before, 'už načítané — žiadny ďalší fetch');
  assert.equal(sources.roads.show, false, 'čip prežije hide/show');
  assert.equal(sources.places.show, true);
  layer.setPart('nope', true);
  assert.deepEqual(layer.getParts(), { places: true, roads: false, rivers: true, oblasts: true }, 'neznáma časť sa ignoruje');
});

test('obce: zblízka sa lenivo načítajú a kreslí sa kohorta v pohľade; po odlete zmiznú, dáta ostanú', async () => {
  const camera = { height: 120_000, lon: 37.8, lat: 48.97 };
  const { layer, viewer, calls, clock } = make({ camera });
  await layer.show();
  // show() → refresh → obce chýbajú → fetch (asynchrónne), po ňom refresh + emit
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.some((u) => u.includes('/villages')), true, `pod ${VILLAGE_LOAD_MAX_HEIGHT_M / 1000} km sa obce ťahajú`);
  const { villageRecords, sources } = layer._getStateForTest();
  assert.deepEqual([...villageRecords.keys()].sort(), [3, 4], 'kohorta = obce v pohľade, Kyjevská obec mimo');
  assert.equal(layer.getState().counts.villagesCohort, 2);
  assert.equal(layer.getState().villagesLoaded, true);
  // Odlet: kamera vysoko → moveEnd → po pauze refresh → kohorta preč, dáta ostanú.
  viewer.camera.positionCartographic.height = 500_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(villageRecords.size, 0);
  assert.equal(sources.places.entities.values.length, 2, 'mestá ostali');
  assert.equal(layer.getState().villagesLoaded, true, 'súbor sa nezahodil');
  // Návrat: bez ďalšieho fetchu.
  const before = calls.length;
  viewer.camera.positionCartographic.height = 100_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(calls.length, before);
  assert.equal(villageRecords.size, 2);
});

test('riedenie: dva popisky v tej istej bunke — dôležitejší ostane, druhý sa skryje; zďaleka sa obce do bunky nepočítajú', async () => {
  // Dve sídla 0,01° od seba (10 px v testovom premietnutí) = jedna bunka.
  const data = { ...DATA, places: { type: 'FeatureCollection', features: [point(1, 'city', 'Краматорськ', 37.55, 48.72, { en: 'Kramatorsk' }), point(2, 'town', 'Малé', 37.56, 48.72)] } };
  const { layer } = make({ data, camera: { height: 400_000 } });
  await layer.show();
  const { placeRecords } = layer._getStateForTest();
  assert.equal(placeRecords.get(1).labelShown, true);
  assert.equal(placeRecords.get(2).labelShown, false, 'mestečko v bunke mesta sa skryje');
  assert.equal(placeRecords.get(2).entity.label.show, false);
});

test('karta pri prechode myšou: sídlo (latinka + originál + obyvatelia), rieka, cesta; mimo ničoho sa skryje', async () => {
  let picked = null;
  const viewer = fakeViewer({ height: 120_000, pick: () => picked });
  const { layer, hover, handler, clock } = make({ viewer });
  await layer.show();
  const { sources } = layer._getStateForTest();
  const move = (x, y) => { handler.fn({ endPosition: { x, y } }); clock.flush(); };
  picked = { id: sources.places.entities.values[1] };
  move(100, 100);
  assert.equal(hover.shown.length, 1);
  assert.equal(hover.shown[0].model.title, 'Lyman');
  assert.equal(hover.shown[0].model.kindText, 'ukraine.place.town');
  assert.deepEqual(hover.shown[0].model.details, ['Лиман', 'ukraine.place.population {"n":"20 000"}']);
  assert.match(hover.shown[0].model.source, /^ukraine\.source \{"date":"19\./);
  picked = { id: sources.rivers.entities.values[0] };
  move(120, 100);
  assert.equal(hover.shown[1].model.title, 'Siverskyi Donets');
  assert.deepEqual(hover.shown[1].model.details, ['Сіверський Донець', 'ukraine.river.length {"km":650}']);
  picked = { id: sources.roads.entities.values[0] };
  move(130, 100);
  assert.equal(hover.shown[2].model.title, 'M-03');
  assert.deepEqual(hover.shown[2].model.details, ['ukraine.road.primary']);
  picked = null;
  move(140, 100);
  assert.equal(hover.hidden >= 1, true);
  layer.hide();
  move(150, 100);
  assert.equal(hover.shown.length, 3, 'skrytý prekryv nekreslí karty');
});

test('klik na sídlo = prelet (šikmo z juhu, výška podľa triedy) a karta zmizne; klik na rieku nič; päta karty má vlastný text', async () => {
  let picked = null;
  const viewer = fakeViewer({ height: 120_000, pick: () => picked });
  const { layer, hover, handler } = make({ viewer });
  await layer.show();
  const { sources } = layer._getStateForTest();
  assert.equal(lastHoverFactoryOptions.translate('local.hover-hint'), 'ukraine.hover-hint', 'sľub „klik = karta" lokálnych vrstiev sa nahradí');
  assert.equal(lastHoverFactoryOptions.translate('gas.pipeline-close'), 'gas.pipeline-close', 'ostatné kľúče prechádzajú');
  picked = { id: sources.places.entities.values[0] }; // Kramatorsk, city
  handler.click({ position: { x: 10, y: 10 } });
  assert.equal(viewer.camera.flights.length, 1);
  const flight = viewer.camera.flights[0];
  const carto = Cesium.Cartographic.fromCartesian(flight.destination);
  assert.ok(Math.abs(carto.height - 45_000) < 1, 'mesto z 45 km');
  assert.ok(Cesium.Math.toDegrees(carto.latitude) < 48.72, 'kamera stojí južne od mesta');
  assert.ok(Math.abs(Cesium.Math.toDegrees(carto.longitude) - 37.55) < 1e-6);
  assert.ok(Math.abs(Cesium.Math.toDegrees(flight.orientation.pitch) + 48) < 1e-9);
  assert.ok(hover.hidden >= 1, 'karta po kliku zmizne');
  picked = { id: sources.rivers.entities.values[0] };
  handler.click({ position: { x: 10, y: 10 } });
  assert.equal(viewer.camera.flights.length, 1, 'rieka nelieta');
  layer.hide();
  picked = { id: sources.places.entities.values[1] };
  handler.click({ position: { x: 10, y: 10 } });
  assert.equal(viewer.camera.flights.length, 1, 'skrytý prekryv na klik nereaguje');
});

test('chýbajúci snímok: meta 404 → show() false, error no_snapshot, žiadne ďalšie fetche; loadMeta sa dá zopakovať', async () => {
  const { layer, calls } = make({ data: {} });
  assert.equal(await layer.show(), false);
  assert.equal(layer.getState().error, 'no_snapshot');
  assert.deepEqual(calls, ['/api/ukraine/base/meta']);
  assert.equal(layer.isShown(), true, 'úmysel zobraziť ostáva — keď snímok pribudne, stačí show()');
});

test('onChange hlási zmeny a destroy odoberie zdroje, handler aj kartu', async () => {
  const { layer, viewer, hover, handler } = make({ camera: { height: 900_000 } });
  const states = [];
  const off = layer.onChange((s) => states.push(s.loaded));
  await layer.show();
  assert.ok(states.length >= 2, 'aspoň „načítavam" a „hotovo"');
  assert.equal(states[states.length - 1], true);
  off();
  layer.destroy();
  assert.equal(viewer.dataSources.removed.length, 4);
  assert.equal(handler.destroyed, true);
  assert.equal(hover.destroyed, true);
  assert.equal(viewer.camera.moveEnd.listeners.length, 0, 'poslucháč kamery odobratý');
  assert.equal(await layer.show(), false, 'po destroy sa nič nezobrazí');
  assert.equal(layer.id, UKRAINE_BASE_ID);
});

test('getPlaceIndex: mestá + obce (obce sa pre index dotiahnu aj zďaleka, snímok bez show), kľúče v azbuke, postavený raz', async () => {
  const { layer, calls } = make({ camera: { height: 900_000, lon: 37.8, lat: 48.97 } });
  const index = await layer.getPlaceIndex();
  assert.ok(calls.some((u) => u.includes('/places')), 'snímok sa načítal bez show()');
  assert.ok(calls.some((u) => u.includes('/villages')), 'obce sa pre index dotiahli');
  assert.deepEqual([...index.keys()].sort(), ['далеко', 'дробишеве', 'краматорськ', 'лиман', 'ямпіль']);
  assert.equal(index.get('краматорськ')[0].en, 'Kramatorsk');
  assert.equal(index.get('ямпіль')[0].cls, 'village');
  const before = calls.length;
  assert.equal(await layer.getPlaceIndex(), index, 'druhé volanie = ten istý index');
  assert.equal(calls.length, before, 'bez ďalšieho fetchu');
  assert.equal(layer.getState().villagesLoaded, true);
  assert.equal(index.get('ямпіль')[0].id, 3, 'index nesie OSM id (pre rezerváciu)');
});

test('setStyle karta: čiary polovičné, body a písma menšie (aj obce pridané neskôr), default vráti pôvodné, neznámy režim = default', async () => {
  const camera = { height: 120_000, lon: 37.8, lat: 48.97 };
  const { layer, viewer, clock } = make({ camera });
  await layer.show();
  await settle();
  const { sources, placeRecords, villageRecords } = layer._getStateForTest();
  const road = sources.roads.entities.values[0];
  const river = sources.rivers.entities.values[0];
  const baseRoad = road.polyline.width, baseRiver = river.polyline.width;
  const city = placeRecords.get(1).entity;
  const basePx = city.point.pixelSize, baseFont = city.label.font;
  assert.equal(layer.getStyle(), 'default');
  layer.setStyle('karta');
  assert.equal(layer.getState().style, 'karta');
  assert.equal(road.polyline.width, baseRoad * 0.5);
  assert.equal(river.polyline.width, baseRiver * 0.5);
  assert.ok(Math.abs(city.point.pixelSize - basePx * 0.72) < 1e-9);
  assert.match(city.label.font, /11\.7px/, '13 px × 0,9');
  assert.ok(Math.abs(villageRecords.get(3).entity.point.pixelSize - 3.5 * 0.72) < 1e-9, 'obec v kohorte tiež');
  // obec pridaná až v režime karta dostane násobok hneď pri vzniku
  viewer.camera.positionCartographic.height = 500_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  viewer.camera.positionCartographic.height = 100_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.ok(Math.abs(villageRecords.get(3).entity.point.pixelSize - 3.5 * 0.72) < 1e-9, 'nová kohorta v režime karta');
  layer.setStyle('default');
  assert.equal(road.polyline.width, baseRoad);
  assert.equal(city.point.pixelSize, basePx);
  assert.equal(city.label.font, baseFont);
  assert.equal(villageRecords.get(3).entity.point.pixelSize, 3.5);
  layer.setStyle('nonsense');
  assert.equal(layer.getStyle(), 'default');
});

test('setReservedPlaces: sídla prevzaté hlásením GŠ sa v podklade skryjú (mesto aj obec, aj obec pridaná neskôr), riedenie ich nepočíta, uvoľnenie vráti', async () => {
  const camera = { height: 120_000, lon: 37.8, lat: 48.97 };
  const { layer, viewer, clock } = make({ camera });
  await layer.show();
  await settle();
  const { placeRecords, villageRecords } = layer._getStateForTest();
  assert.equal(villageRecords.size, 2);
  layer.setReservedPlaces([2, 3]);
  assert.equal(placeRecords.get(2).entity.show, false, 'Lyman (mesto) skrytý');
  assert.equal(villageRecords.get(3).entity.show, false, 'Yampil (obec) skrytá');
  assert.notEqual(villageRecords.get(4).entity.show, false, 'nerezervovaná obec ostáva');
  assert.notEqual(placeRecords.get(1).entity.show, false);
  // Odlet a návrat: obec 3 sa pridá znova — a hneď skrytá.
  viewer.camera.positionCartographic.height = 500_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(villageRecords.size, 0);
  viewer.camera.positionCartographic.height = 100_000;
  for (const fn of viewer.camera.moveEnd.listeners) fn();
  clock.flush();
  assert.equal(villageRecords.get(3).entity.show, false, 'nová kohorta rešpektuje rezerváciu');
  assert.equal(villageRecords.get(3).reservedHidden, true);
  layer.setReservedPlaces([]);
  assert.equal(placeRecords.get(2).entity.show, true);
  assert.equal(villageRecords.get(3).entity.show, true);
});
