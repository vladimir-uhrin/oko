// src/data/ukraineMapLegibility.test.mjs — čitateľnosť mapy frontu (2026-09-24,
// vlastník: „čo by si vylepšil na mape?" → body 1–3): značky smerov na fronte
// namiesto stredu záberu, oslobodené územia šrafou 135° (nie „voda") a hrubší
// tmavý lem popiskov sídiel v bežnom štýle.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { REPORT_MARKER_DY, createUkraineReportLayer, placeLabelOutlinePx } from './ukraineReportLayer.js';
import { FRONT_CENTROID_WEIGHT, FRONT_FAR_KM, buildPlaceIndex, directionAnchor } from './ukraineReportPlaces.js';
import { HATCH_MATERIAL_TYPE, HATCH_MATERIAL_TYPE_135, HatchMaterialProperty, ensureHatchMaterial, hatchMaterialFor } from './screenPatternMaterials.js';
import { DEEPSTATE_STYLES, FRONT_SAMPLE_RADII_KM, buildPolyIndex, createUkraineDeepStateLayer, frontDistanceKm } from '../ukraineDeepStateLayer.js';
import { DEEPSTATE_COLORS } from './ukraineDeepState.js';

// ── 1) kotva značky smeru ───────────────────────────────────────────────────
test('kotva smeru: bez sídiel null, inak skutočné sídlo najbližšie k váženému ťažisku', () => {
  assert.equal(directionAnchor([]), null);
  assert.equal(directionAnchor(null), null);
  assert.equal(directionAnchor([{ name: 'X', lat: NaN, lon: 37 }]), null, 'bez platných súradníc nič');
  // Línia do „L": ťažisko (37,5 / 48,5) leží mimo línie, kotva musí byť sídlo z nej.
  const line = [
    { name: 'A', lat: 48.0, lon: 37.0, mentions: 1 },
    { name: 'B', lat: 48.0, lon: 38.0, mentions: 1 },
    { name: 'C', lat: 49.0, lon: 38.0, mentions: 1 },
  ];
  const a = directionAnchor(line);
  assert.ok(line.some((p) => p.lat === a.lat && p.lon === a.lon), 'kotva = jedno z menovaných sídiel, nie bod v poli');
  assert.equal(a.name, 'B', 'najbližšie k ťažisku (37,67 / 48,33)');
  // Váha zmienok ťahá kotvu k sídlu, o ktorom hlásenie hovorí najviac.
  const weighted = directionAnchor([{ ...line[0], mentions: 6 }, line[1], line[2]]);
  assert.equal(weighted.name, 'A');
  assert.deepEqual(Object.keys(weighted).sort(), ['cls', 'displaced', 'en', 'front', 'frontKm', 'lat', 'lon', 'name']);
  assert.equal(weighted.front, false, 'bez línie = ťažisko');
});

test('kotva smeru: sídlo pri kotve iného smeru sa preskočí, keď je iné; inak ostane', () => {
  const places = [
    { name: 'Blízko', lat: 48.50, lon: 37.50, mentions: 3 },
    { name: 'Ďalej', lat: 48.60, lon: 37.70, mentions: 1 },
  ];
  assert.equal(directionAnchor(places).name, 'Blízko');
  const other = [{ lat: 48.51, lon: 37.51 }];
  assert.equal(directionAnchor(places, { avoid: other }).name, 'Ďalej', 'dve značky nestoja na sebe');
  assert.equal(directionAnchor(places, { avoid: other }).displaced, true, 'karta povie, že je posunutá');
  assert.equal(directionAnchor(places).displaced, false);
  const both = [{ lat: 48.5, lon: 37.5 }, { lat: 48.6, lon: 37.7 }];
  assert.equal(directionAnchor(places, { avoid: both }).name, 'Blízko', 'keď je všetko obsadené, vyhrá najbližšie');
  assert.equal(directionAnchor(places, { avoid: other, minKm: 0.5 }).name, 'Blízko', 'mimo polomeru sa nič nepreskakuje');
});

// Harness vrstvy (kópia vzoru z ukraineReportLayer.test.mjs; vlastný terrainSampler pre súbeh).
function fakeDataSource(id) {
  const values = [];
  return { id, show: true, entities: { values, add(e) { const en = { ...e }; values.push(en); return en; }, remove(e) { const i = values.indexOf(e); if (i >= 0) values.splice(i, 1); return i >= 0; } } };
}
function fakeViewer(pick = () => null) {
  const moveEnd = { listeners: [], addEventListener(fn) { this.listeners.push(fn); return () => {}; } };
  return {
    dataSources: { add() {}, remove() {} },
    scene: { canvas: { addEventListener() {}, removeEventListener() {}, clientWidth: 1200, clientHeight: 800 }, pick, requestRender() {} },
    camera: { moveEnd },
  };
}
function fakeHandler() {
  return { actions: {}, setInputAction(fn, type) { this.actions[type] = fn; }, get move() { return this.actions[Cesium.ScreenSpaceEventType.MOUSE_MOVE]; }, destroy() {} };
}
function fakeHover() {
  return { shown: [], key: null, show(model, at, key) { this.shown.push(model); this.key = key; return true; }, hide() { this.key = null; }, current() { return this.key; }, isHovered: () => false, destroy() {} };
}
const tKey = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const settle = () => new Promise((r) => setTimeout(r, 0));
const REPORT = {
  ok: true, total: 120, reportedAtText: '08:00 24.9.', url: 'https://armyinform.com.ua/x', source: 'ArmyInform', official: 'ua',
  directions: [
    { gs: 'Лиманський', attacks: 5, text: 'П’ять атак росіяни здійснили на Лиманському напрямку — у районі Торського та Ямполя.' },
    { gs: 'Покровський', attacks: 29, text: 'Найбільше бойових зіткнень відбулося на Покровському напрямку — 29.' },
  ],
};
const INDEX = () => buildPlaceIndex([
  { geometry: { type: 'Point', coordinates: [37.86, 48.98] }, properties: { id: 11, name: 'Торське', en: 'Torske', lang: 'uk', cls: 'village' } },
  { geometry: { type: 'Point', coordinates: [37.70, 49.00] }, properties: { id: 12, name: 'Ямпіль', en: 'Yampil', lang: 'uk', cls: 'village' } },
]);
function make({ placeIndex, terrainSampler = async (pts) => pts.map(() => 80), pick, frontKm = null } = {}) {
  const hover = fakeHover();
  const handler = fakeHandler();
  const pending = [];
  const layer = createUkraineReportLayer({
    viewer: fakeViewer(pick),
    fetchImpl: async () => REPORT,
    translate: tKey,
    lang: () => 'sk',
    translateText: async (text) => `SK: ${text}`,
    dataSourceFactory: fakeDataSource,
    handlerFactory: () => handler,
    hoverFactory: () => hover,
    terrainSampler,
    setTimer: (fn) => { pending.push(fn); return pending.length; },
    clearTimer: (id) => { pending[id - 1] = null; },
    now: () => 1_000_000,
    placeIndex,
    frontKm,
    settleMs: 0,
  });
  return { layer, hover, handler, flush: () => { for (const fn of pending.splice(0)) if (fn) fn(); } };
}
const cartoOf = (entity) => {
  const p = entity.position?.getValue ? entity.position.getValue(Cesium.JulianDate.now()) : entity.position;
  const c = Cesium.Cartographic.fromCartesian(p);
  return { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude), h: c.height };
};

test('značka smeru sa presunie zo stredu záberu na sídlo z odseku, zdvihne sa a karta povie prečo', async () => {
  let picked = null;
  const { layer, hover, handler, flush } = make({ placeIndex: async () => INDEX(), pick: () => picked });
  await layer.show();
  await settle(); await settle();
  const { records } = layer._getStateForTest();
  const lyman = records.get('lyman');
  const center = lyman.scene.center;
  assert.ok(Math.abs(lyman.lon - center.lon) + Math.abs(lyman.lat - center.lat) > 0.01, 'už nie v strede záberu');
  assert.ok(['Torske', 'Yampil'].includes(lyman.anchor), 'kotva = sídlo z odseku (latinkou)');
  const at = cartoOf(lyman.entity);
  assert.ok(Math.abs(at.lon - lyman.lon) < 1e-6 && Math.abs(at.lat - lyman.lat) < 1e-6, 'entita stojí na kotve');
  assert.ok(Math.abs(at.h - 80) < 0.5, 'a je zdvihnutá na terén');
  assert.equal(lyman.lifted, true);
  // Pokrovsk bez menovaných sídiel ostáva v strede záberu, bez vety o kotve.
  const pokrovsk = records.get('pokrovsk');
  assert.equal(pokrovsk.anchor, null);
  assert.equal(pokrovsk.lon, pokrovsk.scene.center.lon);
  // Značka sedí nad sídlom (bod a meno sídla ostávajú viditeľné).
  assert.equal(lyman.entity.billboard.pixelOffset.y, REPORT_MARKER_DY);
  assert.equal(lyman.entity.label.pixelOffset.y, REPORT_MARKER_DY);
  assert.ok(REPORT_MARKER_DY < 0, 'nad bodom, nie pod ním');
  // Karta vysvetlí, prečo značka stojí práve tam.
  picked = { id: lyman.entity };
  handler.move({ endPosition: { x: 10, y: 10 } });
  flush();
  const details = hover.shown.at(-1).details;
  assert.ok(details.includes(`ukraine.report.anchor ${JSON.stringify({ place: lyman.anchor })}`), details.join(' | '));
  picked = { id: pokrovsk.entity };
  handler.move({ endPosition: { x: 12, y: 10 } });
  flush();
  assert.ok(!hover.shown.at(-1).details.some((d) => d.startsWith('ukraine.report.anchor')), 'bez kotvy žiadna veta');
});

test('bez indexu sídiel značka ostane v strede záberu (poctivo, bez kotvy)', async () => {
  const { layer } = make();
  await layer.show();
  await settle();
  const lyman = layer._getStateForTest().records.get('lyman');
  assert.equal(lyman.anchor, null);
  assert.equal(lyman.lon, lyman.scene.center.lon);
  assert.equal(lyman.lat, lyman.scene.center.lat);
});

test('súbeh: výška zo stredu záberu, ktorá príde po presune na front, sa nepoužije', async () => {
  const calls = [];
  const terrainSampler = (pts) => new Promise((resolve) => calls.push({ pts, resolve }));
  const { layer } = make({ placeIndex: async () => INDEX(), terrainSampler });
  await layer.show();
  await settle(); await settle();
  const lyman = layer._getStateForTest().records.get('lyman');
  assert.ok(lyman.anchor, 'značka už presunutá');
  // Prvá dávka (stredy záberov) dobehne až teraz — s výškou 999 pre starý bod.
  const first = calls[0];
  assert.ok(first.pts.some(([lon, lat]) => lon === lyman.scene.center.lon && lat === lyman.scene.center.lat));
  first.resolve(first.pts.map(() => 999));
  await settle();
  assert.equal(lyman.lifted, false, 'výška starého bodu sa zahodila');
  // Nová dávka pre presunutú značku (na kotve) — až tá ju zdvihne.
  const again = calls.find((c, i) => i > 0 && c.pts.some(([lon, lat]) => lon === lyman.lon && lat === lyman.lat));
  assert.ok(again, 'po zahodení sa výška vypýtala znova pre kotvu');
  for (const c of calls.slice(1)) c.resolve(c.pts.map(() => 80));
  await settle(); await settle();
  assert.equal(lyman.lifted, true);
  const at = cartoOf(lyman.entity);
  assert.ok(Math.abs(at.h - 80) < 0.5, `výška kotvy, nie starého bodu (${at.h})`);
  assert.ok(Math.abs(at.lon - lyman.lon) < 1e-6);
});

// ── 2) oslobodené územia: šrafa 135°, nie plná modrá ako rieka ──────────────
test('šrafa 135°: druhý materiál, opačný smer; 45° ostáva nezmenená', () => {
  assert.equal(ensureHatchMaterial(Cesium), true);
  const m135 = Cesium.Material._materialCache.getMaterial(HATCH_MATERIAL_TYPE_135);
  assert.ok(m135);
  assert.match(m135.fabric.source, /gl_FragCoord\.x - gl_FragCoord\.y/);
  assert.equal(m135.translucent, true);
  assert.match(Cesium.Material._materialCache.getMaterial(HATCH_MATERIAL_TYPE).fabric.source, /gl_FragCoord\.x \+ gl_FragCoord\.y/);
  assert.equal(new HatchMaterialProperty({ direction: -1 }).getType(), HATCH_MATERIAL_TYPE_135);
  assert.equal(new HatchMaterialProperty().getType(), HATCH_MATERIAL_TYPE, 'predvolene 45°');
  assert.equal(hatchMaterialFor('#4fa3ff', { direction: -1 }).getType(), HATCH_MATERIAL_TYPE_135);
});

test('DeepState: oslobodené v bežnom štýle šrafou 135° s tenkým okrajom, KARTA plná ako predtým', () => {
  const d = DEEPSTATE_STYLES.default;
  assert.equal(d.liberatedHatch.direction, -1);
  assert.equal(d.recentHatch.direction, -1);
  assert.ok(d.recentHatch.lineAlpha > d.liberatedHatch.lineAlpha, 'nedávno oslobodené výraznejšie');
  assert.ok(d.liberatedHatch.fillAlpha <= 0.06, 'takmer bez výplne — plná modrá vyzerala ako voda');
  assert.ok(d.liberatedWidth < d.width && d.liberatedOutline < d.outline, 'okraj tenší a bledší než okupované');
  assert.equal(DEEPSTATE_STYLES.karta.liberatedHatch, undefined, 'KARTA sa nemení');

  const doc = { createElement: () => ({ className: '', hidden: false, remove() {} }) };
  const viewer = {
    scene: { primitives: { add: (x) => x, remove() {} }, requestRender() {} },
    dataSources: { add() {}, remove() {} },
    container: { ownerDocument: doc, appendChild() {} },
  };
  const layer = createUkraineDeepStateLayer({ viewer, documentRef: doc, terrainSampler: async (pts) => pts.map(() => 0) });
  const sq = (lon, lat, s) => [[lon, lat], [lon + s, lat], [lon + s, lat + s], [lon, lat + s], [lon, lat]];
  layer.setSnapshot({ features: [
    { type: 'Polygon', kind: 'liberated', rings: [sq(36, 48, 0.5)] },
    { type: 'Polygon', kind: 'liberated-recent', rings: [sq(36.6, 48, 0.5)] },
    { type: 'Polygon', kind: 'occupied', rings: [sq(38, 48, 0.5)] },
  ] });
  const polys = () => layer._getStateForTest().ds.entities.values.filter((e) => e.polygon);
  const typeOf = (e) => (e.polygon.material.getType ? e.polygon.material.getType(Cesium.JulianDate.now()) : null);
  const kinds = () => polys().map((e) => [e.properties.deepstate.getValue().kind, typeOf(e)]);
  assert.deepEqual(kinds(), [['liberated', HATCH_MATERIAL_TYPE_135], ['liberated-recent', HATCH_MATERIAL_TYPE_135], ['occupied', 'Color']]);
  const lib = polys()[0].polygon.material.getValue();
  assert.equal(lib.lineColor.withAlpha(1).toCssHexString(), DEEPSTATE_COLORS.liberated);
  layer.setStyle('karta');
  assert.deepEqual(kinds().map((k) => k[1]), ['Color', 'Color', 'Color'], 'KARTA: plné farby ako predtým');
  layer.destroy();
});

// ── 3) popisky sídiel: hrubší tmavý lem v bežnom štýle ──────────────────────
test('lem popisku sídla: bežný štýl 4 px, KARTA 2 px (má podložku)', async () => {
  assert.equal(placeLabelOutlinePx('default'), 4);
  assert.equal(placeLabelOutlinePx('karta'), 2);
  const { layer } = make({ placeIndex: async () => INDEX() });
  await layer.show();
  await settle(); await settle();
  const labels = () => [...layer._getStateForTest().placeRecords.values()].map((r) => r.entity.label);
  assert.ok(labels().length >= 1);
  assert.ok(labels().every((l) => l.outlineWidth === 4));
  layer.setStyle('karta');
  assert.ok(labels().every((l) => l.outlineWidth === 2));
  layer.setStyle('default');
  assert.ok(labels().every((l) => l.outlineWidth === 4));
});

// ── 1b) kotva pri LÍNII (polygóny DeepState) ────────────────────────────────
const sq = (lon, lat, w, h = w) => [[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]];

test('vzdialenosť k línii: prvá zmena strany v kruhoch; hranica dvoch ruských druhov nie je front', () => {
  // Okupované východne od 38,0°; ORDLO priamo za ním (vnútorná hranica na 38,5°).
  const index = buildPolyIndex([
    { type: 'Polygon', kind: 'occupied', rings: [sq(38.0, 47.5, 0.5, 2)] },
    { type: 'Polygon', kind: 'ordlo', rings: [sq(38.5, 47.5, 1.0, 2)] },
  ]);
  const kmLon = 111.32 * Math.cos((48.5 * Math.PI) / 180);
  // Bod 1,5 km západne od línie (strana UA): prvý polomer, ktorý ju prekročí, je 2 km.
  assert.equal(frontDistanceKm(index, 38.0 - 1.5 / kmLon, 48.5), 2);
  // Bod v okupovanom 4 km od línie → 5 km (polomery 1, 2, 3, 5 …).
  assert.equal(frontDistanceKm(index, 38.0 + 4 / kmLon, 48.5), 5);
  // Bod pri vnútornej hranici okupované × ORDLO (0,5 km), 37 km od línie → nič do 24 km.
  assert.equal(frontDistanceKm(index, 38.5 + 0.5 / kmLon, 48.5), Infinity, 'hranica ORDLO nie je front');
  assert.equal(frontDistanceKm([], 38, 48.5), null);
  assert.equal(frontDistanceKm(index, NaN, 48.5), null);
  assert.equal(FRONT_SAMPLE_RADII_KM.at(-1), 24);
});

test('kotva pri línii: vyhrá sídlo pri línii, aj keď ťažisko padne inam; bez línie ťažisko', () => {
  // Pokrovsk 2026-09-24: ťažisko menovaných sídiel pri Svitlom (v okupovanom),
  // línia pri Rodynskom. Svitle je najbližšie k ťažisku, Rodynske k línii.
  const places = [
    { name: 'Svitle', lat: 48.31, lon: 37.23, mentions: 2 },
    { name: 'Rodynske', lat: 48.35, lon: 37.20, mentions: 1 },
    { name: 'Hlboko', lat: 48.20, lon: 37.30, mentions: 2 },
  ];
  const km = { Svitle: 8, Rodynske: 1, Hlboko: Infinity };
  const frontKm = (lon, lat) => km[places.find((p) => p.lon === lon && p.lat === lat).name];
  assert.equal(directionAnchor(places).name, 'Svitle', 'bez línie ťažisko');
  const a = directionAnchor(places, { frontKm });
  assert.equal(a.name, 'Rodynske');
  assert.equal(a.front, true);
  assert.equal(a.frontKm, 1);
  // Všetko mimo dosahu vzorkovania (Infinity) alebo bez dát (null) → ťažisko.
  assert.equal(directionAnchor(places, { frontKm: () => Infinity }).front, false);
  assert.equal(directionAnchor(places, { frontKm: () => null }).name, 'Svitle');
  assert.equal(directionAnchor(places, { frontKm: () => { throw new Error('x'); } }).name, 'Svitle', 'chyba resolvera = bez línie');
  assert.ok(FRONT_FAR_KM > FRONT_SAMPLE_RADII_KM.at(-1) && FRONT_CENTROID_WEIGHT < 1);
});

test('vrstva: kotva podľa línie, karta to povie, reanchor po novej snímke značku presunie a zdvihne', async () => {
  let front = null; // pred načítaním DeepState línia nie je
  let picked = null;
  const { layer, hover, handler, flush } = make({ placeIndex: async () => INDEX(), pick: () => picked, frontKm: (lon) => front?.(lon) ?? null });
  await layer.show();
  await settle(); await settle();
  const lyman = layer._getStateForTest().records.get('lyman');
  const first = lyman.anchor;
  assert.equal(lyman.anchorFront, false);
  // Snímka DeepState dorazila: línia je pri sídle, ktoré NIE JE prvou kotvou.
  const target = first === 'Torske' ? 37.70 : 37.86;
  front = (lon) => (Math.abs(lon - target) < 1e-6 ? 1 : 12);
  layer.reanchor();
  assert.notEqual(lyman.anchor, first, 'značka prešla k sídlu pri línii');
  assert.equal(lyman.anchorFront, true);
  assert.equal(lyman.lon, target);
  assert.equal(lyman.lifted, false, 'nová poloha čaká na výšku');
  await settle(); await settle();
  assert.equal(lyman.lifted, true);
  picked = { id: lyman.entity };
  handler.move({ endPosition: { x: 10, y: 10 } });
  flush();
  assert.ok(hover.shown.at(-1).details.includes(`ukraine.report.anchor-front ${JSON.stringify({ place: lyman.anchor, km: 1, day: '?' })}`));
  assert.ok(!hover.shown.at(-1).details.includes('ukraine.report.anchor-displaced'), 'nič neposunuté');
  // Rovnaká línia znova → nič sa nehýbe (reanchor je lacný pri častých onChange).
  layer.reanchor();
  assert.equal(lyman.lifted, true);
});

test('DeepState vrstva: frontKm z aktuálnej snímky, cache sa po novej snímke zahodí; skrytá vrstva líniu nedáva', async () => {
  const doc = { createElement: () => ({ className: '', hidden: false, remove() {} }) };
  const viewer = { scene: { primitives: { add: (x) => x, remove() {} }, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { ownerDocument: doc, appendChild() {} } };
  const layer = createUkraineDeepStateLayer({ viewer, documentRef: doc, terrainSampler: async (pts) => pts.map(() => 0) });
  await layer.show({ load: false });
  assert.equal(layer.frontKm(37.9, 48.5), null, 'bez snímky null');
  layer.setSnapshot({ features: [{ type: 'Polygon', kind: 'liberated', rings: [sq(36, 48, 1)] }] });
  assert.equal(layer.frontKm(36.5, 48.5), null, 'bez ruských polygónov null');
  layer.setSnapshot({ features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(38.0, 47.5, 1, 2)] }] });
  assert.equal(layer.frontKm(37.99, 48.5), 1);
  layer.setSnapshot({ features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(38.3, 47.5, 1, 2)] }] });
  assert.ok(layer.frontKm(37.99, 48.5) > 1, 'línia sa posunula → nová hodnota, nie stará z cache');
  // Skrytá vrstva drží snímku iného dňa (časová os ju nemení) → žiadna línia.
  layer.hide();
  assert.equal(layer.frontKm(37.99, 48.5), null);
  await layer.show({ load: false });
  assert.ok(Number.isFinite(layer.frontKm(37.99, 48.5)));
  layer.destroy();
});

// ── nálezy kontroly (2026-09-24) ─────────────────────────────────────────────
test('poctivé príznaky: sídlo bez vlastnej vzdialenosti k línii nie je „pri línii"', () => {
  // Kotvu vytlačila susedná značka k sídlu mimo dosahu vzorkovania.
  const places = [{ name: 'A', lat: 48.5, lon: 37.5, mentions: 1 }, { name: 'B', lat: 48.9, lon: 37.5, mentions: 1 }];
  const km = { A: 1, B: Infinity };
  const frontKm = (lon, lat) => km[places.find((p) => p.lat === lat).name];
  const a = directionAnchor(places, { avoid: [{ lat: 48.51, lon: 37.5 }], frontKm });
  assert.equal(a.name, 'B');
  assert.equal(a.front, false, 'B nemá vzdialenosť k línii → žiadna veta o línii');
  assert.equal(a.frontKm, null);
  assert.equal(a.displaced, true);
});

test('„в бік X" je spúšťač zoznamu sídiel (Kupiansk 24. 9.)', async () => {
  const { extractPlaceMentions } = await import('./ukraineReportPlaces.js');
  assert.deepEqual(extractPlaceMentions('Ворог атакував у бік Курилівки, Новоосинового та Ківшарівки.'), ['Курилівки', 'Новоосинового', 'Ківшарівки']);
  assert.deepEqual(extractPlaceMentions('Окупанти намагалися просунутися в бік Білицького.'), ['Білицького']);
  assert.deepEqual(extractPlaceMentions('просунутися в бік населених пунктів Мирне та Затишшя'), ['Мирне', 'Затишшя'], 'aj s „населених пунктів"');
  assert.deepEqual(extractPlaceMentions('на цьому боці'), [], 'iné tvary slova „бік" nie');
});

test('smery s najmenej sídlami vyberajú prvé — značky nestoja na sebe', async () => {
  // Lyman menuje Torske aj Yampil; Sloviansk–Kramatorsk len Torske. Pri výbere
  // v poradí presetov by Lyman zobral Torske a druhá značka by stála na ňom.
  const report = { ...REPORT, directions: [
    { gs: 'Лиманський', attacks: 5, text: 'Бої у районах Торського та Ямполя.' },
    { gs: 'Слов’янський', attacks: 2, text: 'Бої у районі Торського.' },
    { gs: 'Краматорський', attacks: 2, text: 'Бої у районі Торського.' },
  ] };
  const index = INDEX();
  const layer = createUkraineReportLayer({
    viewer: fakeViewer(), fetchImpl: async () => report, translate: tKey, lang: () => 'sk', translateText: async (x) => x,
    dataSourceFactory: fakeDataSource, handlerFactory: () => fakeHandler(), hoverFactory: () => fakeHover(),
    terrainSampler: async (pts) => pts.map(() => 80), setTimer: () => 0, clearTimer: () => {}, now: () => 1, placeIndex: async () => index, settleMs: 0,
  });
  await layer.show();
  await settle(); await settle();
  const records = layer._getStateForTest().records;
  const withAnchor = [...records.values()].filter((r) => r.anchor);
  assert.ok(withAnchor.length >= 2, withAnchor.map((r) => r.scene.id).join(','));
  const lyman = records.get('lyman');
  const other = withAnchor.find((r) => r !== lyman);
  assert.equal(other.anchor, 'Torske', 'smer s jediným sídlom dostal svoje sídlo');
  assert.equal(lyman.anchor, 'Yampil', 'Lyman mal na výber a uhol');
});

test('KARTA: posun značky necháva meno jej sídla vpravo (prekážky ikony a čísla ho nekryjú)', async () => {
  const { deconflictLabels, LABEL_H_PX } = await import('./ukraineReportLayer.js');
  const x = 600; const y = 400; const my = y + REPORT_MARKER_DY;
  const items = [
    { key: 'm:icon', x, y: my, w: 22, h: 22, off: -11, fixed: 'right', priority: Infinity },
    { key: 'm:n', x, y: my, w: 40, h: LABEL_H_PX + 2, off: 16, fixed: 'right', priority: Infinity },
    { key: 'p:anchor', x, y, w: 80, h: LABEL_H_PX, off: 8, priority: 5 },
    { key: 'p:anchor-bolt', x: x + 300, y, w: 80, h: LABEL_H_PX, off: 14, priority: 5 },
    { key: 'm2:icon', x: x + 300, y: my, w: 22, h: 22, off: -11, fixed: 'right', priority: Infinity },
    { key: 'm2:n', x: x + 300, y: my, w: 40, h: LABEL_H_PX + 2, off: 16, fixed: 'right', priority: Infinity },
  ];
  const placement = deconflictLabels(items, { pad: 2 });
  assert.equal(placement['p:anchor'], 'right');
  assert.equal(placement['p:anchor-bolt'], 'right');
  assert.ok(REPORT_MARKER_DY <= -21, 'polovica ikony 11 + polovica popisku 8 + odstup 2');
});

// ── druhá kontrola (2026-09-24) ─────────────────────────────────────────────
test('„в бік населеного пункту X" (jednotné číslo) aj „в районі населеного пункту X"', async () => {
  const { extractPlaceMentions } = await import('./ukraineReportPlaces.js');
  assert.deepEqual(extractPlaceMentions('проводячи штурмові дії в бік населеного пункту Борова.'), ['Борова'], 'Kupiansk 23. 9.');
  assert.deepEqual(extractPlaceMentions('у районі Новоселівки та в районі населеного пункту Зарічне'), ['Новоселівки', 'Зарічне']);
});

test('línia DeepState len zo snímky blízkeho dňa k hláseniu', async () => {
  const { deepstateDayFits, FRONT_MAX_DAY_GAP } = await import('../ukraineDeepStateLayer.js');
  assert.equal(FRONT_MAX_DAY_GAP, 3);
  assert.equal(deepstateDayFits('2026-09-23', '2026-09-24'), true, 'bežné oneskorenie o deň');
  assert.equal(deepstateDayFits('2026-09-21', '2026-09-24'), true);
  assert.equal(deepstateDayFits('2026-09-20', '2026-09-24'), false, 'os zatvorená v prehrávaní: snímka 4 dni stará');
  assert.equal(deepstateDayFits('2026-09-25', '2026-09-24'), true, 'o deň novšia ešte áno');
  assert.equal(deepstateDayFits('2026-09-26', '2026-09-24'), false);
  assert.equal(deepstateDayFits(null, '2026-09-24'), false);
  assert.equal(deepstateDayFits('2026-09-20', null), true, 'bez dňa hlásenia nerozhodujeme');
  const doc = { createElement: () => ({ className: '', hidden: false, remove() {} }) };
  const viewer = { scene: { primitives: { add: (x) => x, remove() {} }, requestRender() {} }, dataSources: { add() {}, remove() {} }, container: { ownerDocument: doc, appendChild() {} } };
  const layer = createUkraineDeepStateLayer({ viewer, documentRef: doc, terrainSampler: async (pts) => pts.map(() => 0) });
  await layer.show({ load: false });
  layer.setSnapshot({ day: '2026-09-20', features: [{ type: 'Polygon', kind: 'occupied', rings: [sq(38.0, 47.5, 1, 2)] }] });
  assert.equal(layer.frontKm(37.99, 48.5, { reportDay: '2026-09-24' }), null, 'hlásenie 24. 9. nekotvíme podľa línie z 20. 9.');
  assert.equal(layer.frontKm(37.99, 48.5, { reportDay: '2026-09-21' }), 1);
  assert.equal(layer.frontKm(37.99, 48.5), 1);
  layer.destroy();
});

test('karta povie aj deň línie; vrstva hlásenia pošle deň hlásenia', async () => {
  const { dayText } = await import('./ukraineReportLayer.js');
  assert.equal(dayText('2026-09-23'), '23. 9. 2026');
  assert.equal(dayText(null), '?');
  const seen = [];
  let picked = null;
  const hover = fakeHover(); const handler = fakeHandler(); const pending = [];
  const layer = createUkraineReportLayer({
    viewer: fakeViewer(() => picked), fetchImpl: async () => ({ ...REPORT, reportedAt: '2026-09-24T05:00:00.000Z' }), translate: tKey, lang: () => 'sk', translateText: async (x) => x,
    dataSourceFactory: fakeDataSource, handlerFactory: () => handler, hoverFactory: () => hover, terrainSampler: async (pts) => pts.map(() => 80),
    setTimer: (fn) => { pending.push(fn); return pending.length; }, clearTimer: () => {}, now: () => 1, placeIndex: async () => INDEX(), settleMs: 0,
    frontKm: (lon, lat, opts) => { seen.push(opts?.reportDay); return Math.abs(lon - 37.86) < 1e-6 ? 1 : 9; },
    frontDay: () => '2026-09-23',
  });
  await layer.show();
  await settle(); await settle();
  assert.ok(seen.length && seen.every((d) => d === '2026-09-24'), 'deň hlásenia ide do frontKm');
  const lyman = layer._getStateForTest().records.get('lyman');
  picked = { id: lyman.entity };
  handler.move({ endPosition: { x: 5, y: 5 } });
  for (const fn of pending.splice(0)) fn?.();
  assert.ok(hover.shown.at(-1).details.includes(`ukraine.report.anchor-front ${JSON.stringify({ place: 'Torske', km: 1, day: '23. 9. 2026' })}`), hover.shown.at(-1).details.join(' | '));
});

test('rovnaká šrafa = rovnaký materiál (Cesium zlúči plochy do jednej dávky)', () => {
  const a = hatchMaterialFor('#4fa3ff', { lineAlpha: 0.42, fillAlpha: 0.03, spacing: 10, thickness: 0.16, direction: -1 });
  const b = hatchMaterialFor('#4fa3ff', { lineAlpha: 0.42, fillAlpha: 0.03, spacing: 10, thickness: 0.16, direction: -1 });
  assert.notEqual(a, b);
  assert.equal(a.equals(b), true);
  assert.equal(a.equals(hatchMaterialFor('#4fa3ff', { lineAlpha: 0.42, fillAlpha: 0.03, spacing: 10, thickness: 0.16 })), false, 'iný smer = iný materiál');
  assert.equal(a.equals(hatchMaterialFor('#7cc4ff', { lineAlpha: 0.42, fillAlpha: 0.03, spacing: 10, thickness: 0.16, direction: -1 })), false, 'iná farba');
  assert.equal(a.equals(hatchMaterialFor('#4fa3ff', { lineAlpha: 0.42, fillAlpha: 0.03, spacing: 9, thickness: 0.16, direction: -1 })), false, 'iný rozstup');
  assert.equal(a.equals(null), false);
  assert.equal(a.equals({ _type: HATCH_MATERIAL_TYPE_135 }), false);
});
