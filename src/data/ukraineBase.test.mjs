// src/data/ukraineBase.test.mjs — podklad UKRAJINA (etapa 1): mená v latinke,
// stupne viditeľnosti, kohorta obcí, riedenie popisov, dátum snímku.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LABEL_GRID,
  PLACE_FLY_HEIGHT_M,
  PLACE_LABEL_FAR_M,
  PLACE_POINT_FAR_M,
  RIVER_STYLE,
  ROAD_STYLE,
  VILLAGE_COHORT_MAX,
  VILLAGE_LOAD_MAX_HEIGHT_M,
  declutterLabels,
  inWindow,
  lineLabel,
  placeFlyView,
  placeImportance,
  placeLabel,
  placeLabelDisplayCondition,
  placeMapText,
  placePointDisplayCondition,
  riverDisplayCondition,
  roadStyle,
  selectVillageCohort,
  snapshotDateText,
  villagesWanted,
} from './ukraineBase.js';

test('placeLabel: name:en vyhráva, inak ukrajinský prepis; originál ostáva pre kartu', () => {
  assert.deepEqual(placeLabel({ name: 'Лиман', lang: 'uk', en: 'Lyman' }), { text: 'Lyman', original: 'Лиман' });
  // Bez name:en: ukrajinský prepis (г → h, и → y), nie ruský.
  assert.deepEqual(placeLabel({ name: 'Ужгород', lang: 'uk' }), { text: 'Uzhhorod', original: 'Ужгород' });
  assert.deepEqual(placeLabel({ name: 'Гуляйполе', lang: 'uk' }), { text: 'Hulyaypole', original: 'Гуляйполе' });
  // Bez `lang` na území UA = stále ukrajinsky.
  assert.equal(placeLabel({ name: 'Гірське' }).text, 'Hirske');
  // Ruský uzol v pohraničí bez ukrajinského variantu = ruský prepis.
  assert.deepEqual(placeLabel({ name: 'Суджа', lang: 'ru' }), { text: 'Sudzha', original: 'Суджа' });
  // Ruský `name` s ukrajinským variantom → prepis ukrajinského, originál = name.
  assert.deepEqual(placeLabel({ name: 'Белгород', lang: 'ru', uk: 'Бєлгород' }), { text: 'Byelhorod', original: 'Белгород' });
  assert.deepEqual(placeLabel({}), { text: '', original: null });
  assert.deepEqual(placeLabel({ name: 'Kyiv' }), { text: 'Kyiv', original: null }, 'latinka bez zmeny');
});

test('placeMapText: mestá verzálkami, ostatné ako sú', () => {
  assert.equal(placeMapText({ cls: 'city', name: 'Краматорськ', lang: 'uk', en: 'Kramatorsk' }), 'KRAMATORSK');
  assert.equal(placeMapText({ cls: 'town', name: 'Лиман', lang: 'uk', en: 'Lyman' }), 'Lyman');
  assert.equal(placeMapText({ cls: 'village', name: 'Ямпіль', lang: 'uk' }), 'Yampil');
});

test('lineLabel pre rieky a oblasti', () => {
  assert.deepEqual(lineLabel({ name: 'Оскіл', lang: 'uk', en: 'Oskil' }), { text: 'Oskil', original: 'Оскіл' });
  assert.deepEqual(lineLabel({ name: 'Жеребець', lang: 'uk' }), { text: 'Zherebets', original: 'Жеребець' });
});

test('dôležitosť a podmienky zobrazenia podľa triedy', () => {
  assert.ok(placeImportance({ cls: 'city', pop: 150_000 }) > placeImportance({ cls: 'city', pop: 20_000 }));
  assert.ok(placeImportance({ cls: 'town', pop: 20_000 }) > placeImportance({ cls: 'village', pop: 5_000_000 }), 'trieda vyhráva nad ľudnatosťou');
  assert.deepEqual(placeLabelDisplayCondition('city'), [0, PLACE_LABEL_FAR_M.city]);
  assert.deepEqual(placeLabelDisplayCondition('neznáme'), [0, PLACE_LABEL_FAR_M.village]);
  assert.deepEqual(placePointDisplayCondition('town'), [0, PLACE_POINT_FAR_M.town]);
  assert.equal(roadStyle('motorway'), ROAD_STYLE.motorway);
  assert.equal(roadStyle('tertiary'), ROAD_STYLE.secondary, 'neznáma trieda padne na najtenšiu');
  assert.deepEqual(riverDisplayCondition(650), [0, RIVER_STYLE.farM]);
  assert.deepEqual(riverDisplayCondition(45), [0, RIVER_STYLE.smallFarM]);
  assert.equal(villagesWanted(VILLAGE_LOAD_MAX_HEIGHT_M - 1), true);
  assert.equal(villagesWanted(VILLAGE_LOAD_MAX_HEIGHT_M), false);
  assert.equal(villagesWanted(NaN), false);
  assert.equal(inWindow(37.8, 49.0), true);
  assert.equal(inWindow(17.1, 48.1), false, 'Bratislava je mimo okna');
});

test('selectVillageCohort: obdĺžnik + okraj, najbližšie k stredu, strop', () => {
  const village = (lon, lat) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { cls: 'village', name: `${lon},${lat}` } });
  const features = [village(37.5, 49.0), village(37.9, 49.1), village(36.8, 49.0), village(30.0, 50.0), village(37.55, 49.55)];
  const rect = [37.2, 48.7, 38.2, 49.3];
  const cohort = selectVillageCohort(features, rect, { lon: 37.7, lat: 49.0 });
  assert.deepEqual(cohort.map((f) => f.properties.name), ['37.5,49', '37.9,49.1', '37.55,49.55'], 'okraj 0,3° pustí 49,55 (0,25° za severom), ale nie 36,8 (0,4° za západom) ani Kyjev');
  const capped = selectVillageCohort(features, rect, { lon: 37.9, lat: 49.1 }, { max: 1 });
  assert.deepEqual(capped.map((f) => f.properties.name), ['37.9,49.1'], 'strop nechá najbližšie');
  assert.deepEqual(selectVillageCohort(features, null, { lon: 0, lat: 0 }), []);
  assert.ok(VILLAGE_COHORT_MAX >= 1000);
});

test('declutterLabels: dôležitejší vyhráva bunku, mimo obrazovky nič', () => {
  const w = LABEL_GRID.widthPx;
  const visible = declutterLabels([
    { id: 'village', importance: 60, x: 10, y: 10 },
    { id: 'city', importance: 300, x: 20, y: 12 }, // tá istá bunka
    { id: 'town', importance: 150, x: 20 + 2 * w, y: 12 }, // iná bunka
    { id: 'off', importance: 999, x: -5, y: 12 },
  ], { width: 1000, height: 800 });
  assert.deepEqual([...visible].sort(), ['city', 'town']);
  assert.deepEqual([...declutterLabels([], { width: 10, height: 10 })], []);
});

test('placeFlyView: výška podľa triedy, kamera južne od sídla, sklon −48°', () => {
  const city = placeFlyView(37.55, 48.72, 'city');
  assert.equal(city.heightM, PLACE_FLY_HEIGHT_M.city);
  assert.equal(city.pitchDeg, -48);
  assert.equal(city.headingDeg, 0);
  assert.equal(city.lon, 37.55);
  // odstup = h·tan(42°) ≈ 40,5 km ≈ 0,365°
  assert.ok(city.lat > 48.72 - 0.4 && city.lat < 48.72 - 0.33, `odstup na juh, dostali sme ${city.lat}`);
  assert.equal(placeFlyView(0, 0, 'village').heightM, PLACE_FLY_HEIGHT_M.village);
  assert.equal(placeFlyView(0, 0, 'neznáme').heightM, PLACE_FLY_HEIGHT_M.village, 'neznáma trieda = obec');
});

test('snapshotDateText: dátum snímku po slovensky aj anglicky, bez meta null', () => {
  const sk = snapshotDateText({ snapshot: '2026-09-19T14:05:00.000Z' }, { lang: 'sk' });
  assert.match(sk.dateText, /^19\.\s?9\.\s?2026$/);
  assert.equal(sk.snapshotIso, '2026-09-19T14:05:00.000Z');
  assert.match(snapshotDateText({ snapshot: '2026-09-19T14:05:00.000Z' }, { lang: 'en' }).dateText, /19\/09\/2026/);
  assert.deepEqual(snapshotDateText(null), { dateText: null, snapshotIso: null });
  assert.equal(snapshotDateText({ snapshot: 'nie dátum' }).dateText, null);
});
