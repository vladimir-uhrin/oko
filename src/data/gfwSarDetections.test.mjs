// src/data/gfwSarDetections.test.mjs
// Radarové detekcie lodí · Sentinel-1 (Global Fishing Watch, 2026-09-12):
// registrácia, i18n, kredit s Copernicus atribúciou, riadok zdroja, karta so
// zhodou aj bez AIS, popisky len so zhodou, terč podľa zhody a veku, lifecycle
// s náhradami, zoom-in a no_key, tripwire proxy.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GFW_SAR_DARK_CSS, GFW_SAR_LAYER_ID, GFW_SAR_OVERLAY_SOURCE_ID,
  createGfwSarLayer, sarAgeAlpha, sarContactSummary, sarDisplayName, sarIconDataUrl, sarLabelCard, sarPassLabel, sarSourceLabel,
} from './gfwSarDetections.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { GFW_PRESENCE_RETRY_MS } from './gfwPresence.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';
import { VESSEL_TIER_SCALE } from './aisLiveVessels.js';

const tEn = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), EN_STRINGS[key] ?? key);
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 12, 16, 0, 0);

function fakeViewer({ heightM = 800_000, rect = { west: 47.3, south: 23.9, east: 59.1, north: 30.2 }, onScreen = true } = {}) {
  const toRad = (d) => (d * Math.PI) / 180;
  const listeners = new Set();
  const changedListeners = new Set();
  const primitives = [];
  return {
    listeners,
    changedListeners,
    primitives,
    scene: {
      canvas: { clientWidth: 1280, clientHeight: 720 },
      cartesianToCanvasCoordinates: () => (onScreen ? { x: 640, y: 360 } : { x: -50, y: -50 }),
      requestRender() {},
      primitives: { add(p) { primitives.push(p); }, remove(p) { const i = primitives.indexOf(p); if (i >= 0) primitives.splice(i, 1); return i >= 0; } },
    },
    camera: {
      positionCartographic: { height: heightM },
      computeViewRectangle: () => (rect ? { west: toRad(rect.west), south: toRad(rect.south), east: toRad(rect.east), north: toRad(rect.north) } : undefined),
      moveEnd: { addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); } },
      changed: { addEventListener(fn) { changedListeners.add(fn); return () => changedListeners.delete(fn); } },
    },
  };
}

function fakeCollection() {
  const items = [];
  return { show: false, items, get length() { return items.length; }, add(o) { items.push(o); return o; }, removeAll() { items.length = 0; } };
}

function fakeOverlay() {
  const calls = [];
  return {
    calls,
    setEntries(sourceId, entries, options) { calls.push({ op: 'set', sourceId, entries, options }); },
    setVisible(sourceId, visible) { calls.push({ op: 'visible', sourceId, visible }); },
    clearSource(sourceId) { calls.push({ op: 'clear', sourceId }); },
  };
}

const ROWS = [
  { key: 'v:374969000', matched: true, mmsi: '374969000', name: 'GALAXY', type: 'CARGO', flag: 'PAN', callsign: '3ELF5', imo: '9287156', lat: 25.41, lon: 56.52, hours: 0, detections: 2, firstSeen: Date.UTC(2026, 8, 7, 14), lastSeen: Date.UTC(2026, 8, 9, 2), vesselId: '01a6de42e' },
  { key: 'c:26.93,56.31', matched: false, mmsi: '', name: '', type: '', flag: '', callsign: '', imo: '', lat: 26.93, lon: 56.31, hours: 0, detections: 3, firstSeen: Date.UTC(2026, 8, 7, 14), lastSeen: Date.UTC(2026, 8, 9, 2), vesselId: '' },
  { key: 'v:422002100', matched: true, mmsi: '422002100', name: '', type: '80', flag: 'IRN', callsign: '', imo: '', lat: 25.54, lon: 57.81, hours: 0, detections: 1, firstSeen: Date.UTC(2026, 8, 3, 2), lastSeen: Date.UTC(2026, 8, 3, 2), vesselId: 'dba991cbc' },
];
const META = { range: { from: '2026-09-02', to: '2026-09-13' }, day: '2026-09-12', days: 10, latestDay: '2026-09-09', delayHours: 72, bbox: { west: 47, south: 23, east: 60, north: 31 }, cellDeg: 0.01, mode: 'hourly', fallback: null };
const META_DAY = { ...META, cellDeg: 0.1, mode: 'sarDay', fallback: 'too_large' };

test('register, i18n a kredit: token 8 za gfw-presence, EN aj SK kľúče, atribúcia GFW aj Copernicus', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === GFW_SAR_LAYER_ID);
  assert.deepEqual(entry, { id: 'gfw-sar', token: '8', disposition: 'enabled-only' });
  for (const key of ['layer.gfw-sar.name', 'sar.source', 'sar.latest-pass', 'sar.no-pass', 'sar.pass', 'sar.pass-short', 'sar.dark', 'sar.matched', 'sar.type', 'sar.split', 'sar.cell-note', 'sar.cell-note-one', 'sar.cell-note-few', 'sar.empty']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  const credit = DATA_CREDITS.find((c) => c.key === 'gfw-sar');
  assert.ok(credit, 'kredit existuje');
  assert.match(credit.html, /Powered by Global Fishing Watch\./, 'povinné znenie atribúcie GFW');
  assert.match(credit.html, /Contains modified Copernicus Sentinel data \d{4}\./, 'povinné znenie Copernicus');
  assert.match(credit.html, /CC BY-NC 4\.0/);
  assert.match(credit.html, /without AIS/);
});

test('sarIconDataUrl a sarAgeAlpha: terč podľa farby a zhody (bodka), útlm podľa veku preletu', () => {
  const a = sarIconDataUrl('#39d5ff', true);
  const b = sarIconDataUrl('#39d5ff', false);
  const c = sarIconDataUrl(GFW_SAR_DARK_CSS, false);
  assert.match(a, /^data:image\/svg\+xml;base64,/);
  assert.notEqual(a, b, 'zhoda má bodku');
  assert.notEqual(b, c, 'farba sa líši');
  assert.equal(sarIconDataUrl('#39d5ff', true), a, 'cache');
  const svg = Buffer.from(b.slice(b.indexOf(',') + 1), 'base64').toString('utf8');
  assert.match(svg, /fill="#39d5ff" fill-opacity="0.12"/, 'jemná výplň — dutý stred by pick minul (karta BEZ AIS sa neotvárala)');
  assert.match(svg, /fill="none" stroke="#39d5ff"/, 'obrys ostáva čistý');
  assert.equal(sarAgeAlpha(0), 0.95);
  assert.equal(sarAgeAlpha(3 * DAY), 0.95);
  assert.equal(sarAgeAlpha(5 * DAY), 0.75);
  assert.equal(sarAgeAlpha(9 * DAY), 0.55);
  assert.equal(sarAgeAlpha(NaN), 0.95);
});

test('sarSourceLabel, sarPassLabel a sarContactSummary: okno, posledný prelet, pomer; karta so zhodou aj BEZ AIS', () => {
  assert.equal(sarSourceLabel(META, { matched: 1231, dark: 655 }, tEn, 'en'), 'Global Fishing Watch · Sentinel-1 radar detections 0.01° · last 10 days · latest pass 9 Sep · 1231 AIS-matched · 655 without AIS · CC BY-NC 4.0');
  assert.equal(sarSourceLabel(META_DAY, null, tEn, 'en'), 'Global Fishing Watch · Sentinel-1 radar detections 0.1° · last 10 days · latest pass 9 Sep · CC BY-NC 4.0', 'záložný režim = 0,1°');
  assert.match(sarSourceLabel(null, null, tEn, 'en'), /last 10 days · no pass yet · CC BY-NC 4\.0$/);
  assert.equal(sarPassLabel(ROWS[0], META, tEn, 'en'), 'RADAR · 9 Sep 02:00 UTC');
  assert.equal(sarPassLabel(ROWS[0], META_DAY, tEn, 'en'), 'RADAR · 9 Sep', 'denné bunky nemajú hodinu');
  assert.equal(sarPassLabel({ lastSeen: null }, META, tEn, 'en'), 'no pass yet');
  const s = sarContactSummary(ROWS[0], META, tEn, 'en');
  assert.equal(s.layerId, 'gfw-sar');
  assert.equal(s.id, 'v:374969000');
  assert.equal(s.callsign, 'GALAXY');
  assert.equal(s.registration, '3ELF5');
  assert.equal(s.operator, 'RADAR · 9 Sep 02:00 UTC · AIS match');
  assert.equal(s.type, 'CARGO');
  assert.equal(s.route, '0.01° cell · 2 detections in 10 days');
  assert.equal(s.countryIso, 'PA');
  assert.equal(s.lastContactEpochMs, Date.UTC(2026, 8, 9, 2), 'čas preletu = vek fixu');
  assert.equal(s.trackDeg, null);
  assert.equal(s.speedMps, null);
  const dark = sarContactSummary(ROWS[1], META, tEn, 'en');
  assert.equal(dark.callsign, 'NO AIS MATCH', 'bez identity je titulkom BEZ AIS');
  assert.equal(dark.type, 'RADAR', 'typ nikdy prázdny');
  assert.equal(dark.operator, 'RADAR · 9 Sep 02:00 UTC', 'BEZ AIS je už v titulku');
  assert.equal(dark.route, '0.01° cell · 3 detections in 10 days');
  assert.equal(dark.registration, null);
  assert.equal(dark.countryIso, null);
  const anon = sarContactSummary(ROWS[2], META, tEn, 'en');
  assert.equal(anon.callsign, '422002100', 'so zhodou bez mena = MMSI');
  assert.equal(anon.type, 'TANKER', 'číselný typ 80 sa normalizuje');
  assert.equal(anon.countryIso, 'IR');
  assert.equal(anon.route, '0.01° cell · 1 detection in 10 days', 'jednotné číslo (SK: 1 detekcia / 2–4 detekcie / 5+ detekcií)');
  assert.equal(sarContactSummary(null, META, tEn, 'en'), null);
  assert.equal(sarDisplayName({ matched: true, name: '', mmsi: '' }, tEn), 'VESSEL');
});

test('sarLabelCard: karta ako pri lodiach — meno, vlajka, „TYP · RADAR · deň"; novší prelet a meno majú prednosť', () => {
  const card = sarLabelCard(ROWS[0], { x: 1, y: 2, z: 3 }, META, tEn, 'en', NOW);
  assert.equal(card.id, 'sar:v:374969000');
  assert.equal(card.title, 'GALAXY');
  assert.equal(card.titleFlag, 'PA');
  assert.deepEqual(card.details, ['CARGO · RADAR · 9 Sep']);
  assert.equal(card.actionable, false);
  const older = sarLabelCard(ROWS[2], { x: 0, y: 0, z: 0 }, META, tEn, 'en', NOW);
  assert.ok(card.priority > older.priority, 'meno a novší prelet pred starším bez mena');
  assert.deepEqual(older.details, ['TANKER · RADAR · 3 Sep']);
});

test('vrstva: enable → dopyt na /api/gfw/sar, terče (zhoda = farba typu + bodka, bez zhody biely), útlm podľa veku, popisky len so zhodou, štatistika, hover, zameriavače; disable a destroy upracú', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ rows: ROWS, meta: META }) }; };
  const collection = fakeCollection();
  const overlay = fakeOverlay();
  const layer = createGfwSarLayer({ fetchImpl, collectionFactory: () => collection, overlayHost: overlay, now: () => NOW });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(viewer.primitives.length, 1);
  await layer.enable();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['/api/gfw/sar?bbox=47,23,60,31'], 'jeden dopyt na zaokrúhlený výrez');
  assert.equal(collection.show, true);
  assert.equal(collection.length, 3);
  const byKey = Object.fromEntries(collection.items.map((b) => [b.id.key, b]));
  assert.equal(byKey['v:374969000'].id.sar, true, 'pick id nesie sar:true → hover ide na gfw-sar');
  assert.equal(byKey['v:374969000'].id.matched, true);
  assert.equal(byKey['v:374969000'].image, sarIconDataUrl('#39d5ff', true), 'zhoda: farba typu CARGO + bodka');
  assert.equal(byKey['c:26.93,56.31'].image, sarIconDataUrl(GFW_SAR_DARK_CSS, false), 'bez zhody: biely prázdny terč');
  assert.equal(byKey['v:422002100'].image, sarIconDataUrl('#ffb347', true), 'tanker jantárový ako pri živých lodiach');
  assert.ok(Math.abs(byKey['v:374969000'].color.alpha - 0.75) < 1e-6, 'prelet 9. 9. 02:00 vs 12. 9. 16:00 = 3,58 dňa → stredný útlm');
  assert.ok(Math.abs(byKey['v:422002100'].color.alpha - 0.55) < 1e-6, 'prelet 3. 9. → slabý');
  assert.equal(byKey['v:374969000'].rotation, 0);
  assert.ok(Math.abs(byKey['v:374969000'].scale - 0.5 * VESSEL_TIER_SCALE.medium) < 1e-9, 'stupeň medium pri 800 km ako trupy');
  const set = overlay.calls.find((c) => c.op === 'set');
  assert.ok(set, 'popisky publikované');
  assert.equal(set.sourceId, GFW_SAR_OVERLAY_SOURCE_ID);
  assert.equal(set.entries.length, 2, 'len detekcie so zhodou majú popisku');
  assert.equal(set.entries[0].title, 'GALAXY');
  assert.equal(set.entries[0].variant, 'card');
  assert.ok(set.entries[0].details[0].endsWith('RADAR · 9 Sep'), set.entries[0].details[0]);
  const stats = layer.getStats();
  assert.equal(stats.count, 3);
  assert.equal(stats.lastUpdate, NOW);
  assert.match(stats.source, /latest pass 9 Sep · 2 AIS-matched · 1 without AIS · CC BY-NC 4\.0$/);
  assert.equal(stats.error, null);
  const st = layer._getStateForTest();
  assert.equal(st.labels, 2);
  assert.deepEqual(st.counts, { matched: 2, dark: 1 });
  assert.equal(layer.hasContact('v:374969000'), true);
  assert.equal(layer.hasContact('374969000'), false, 'kľúč, nie holé MMSI — inak by živé lode kradli kartu');
  assert.equal(layer.getContactSummary('c:26.93,56.31').callsign, 'NO AIS MATCH');
  assert.equal(layer.getContactSummary('nope'), null);
  const objs = layer.getDetectableObjects({ maxCount: 1, seed: 0, hovered: [{ layerId: 'gfw-sar', sourceId: 'c:26.93,56.31' }] });
  const dark = objs.find((o) => o.sourceId === 'c:26.93,56.31');
  assert.ok(dark, 'objekt pod kurzorom je v kohorte napriek stride');
  assert.equal(dark.type, 'SEA');
  assert.equal(dark.klass, 'RADAR');
  assert.equal(dark.skipLabel, false, 'bez zhody nemá overlay popisku → zameriavač ukáže BEZ AIS');
  assert.equal(dark.id, 'NO AIS MATCH');
  assert.equal(dark.metric, 'RADAR · 9 Sep');
  // stupeň terča sleduje kameru počas letu
  viewer.camera.positionCartographic.height = 3_500_000;
  for (const fn of viewer.changedListeners) fn();
  assert.equal(layer._getStateForTest().iconTier, 'micro');
  assert.ok(Math.abs(collection.items[0].scale - 0.5 * VESSEL_TIER_SCALE.micro) < 1e-9);
  // ten istý výrez znova → bez ďalšieho dopytu
  for (const fn of viewer.listeners) fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  layer.disable();
  assert.equal(collection.show, false);
  assert.equal(viewer.listeners.size, 0, 'moveEnd odhlásený');
  assert.equal(viewer.changedListeners.size, 0, 'camera.changed odhlásený');
  assert.ok(overlay.calls.some((c) => c.op === 'clear'));
  assert.ok(overlay.calls.some((c) => c.op === 'visible' && c.visible === false));
  layer.destroy(viewer);
  assert.equal(viewer.primitives.length, 0);
});

test('vrstva: nad 4 000 km je stav zoom-in bez dopytu; prázdne okno hlási sar.empty; 503 no_key sa prizná', async () => {
  const calls = [];
  const highViewer = fakeViewer({ heightM: 9_000_000 });
  const layer = createGfwSarLayer({ fetchImpl: async (u) => { calls.push(u); return { ok: true, json: async () => ({ rows: [] }) }; }, collectionFactory: fakeCollection, overlayHost: fakeOverlay() });
  layer.init(highViewer);
  await layer.enable();
  assert.equal(calls.length, 0);
  assert.equal(layer.getStats().status, 'zoom-in');
  layer.destroy(highViewer);

  const empty = createGfwSarLayer({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ rows: [], meta: { ...META, latestDay: null } }) }), collectionFactory: fakeCollection, overlayHost: fakeOverlay() });
  const v0 = fakeViewer();
  empty.init(v0);
  await empty.enable();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(empty.getStats().status, 'empty');
  assert.ok(/10/.test(empty.getStats().loadingLabel), 'hláška nesie okno dní');
  empty.destroy(v0);

  const noKey = createGfwSarLayer({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'no_key' }) }), collectionFactory: fakeCollection, overlayHost: fakeOverlay() });
  const v = fakeViewer();
  noKey.init(v);
  await noKey.enable();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(noKey.getStats().error, 'chyba je viditeľná v riadku');
  assert.equal(noKey._getStateForTest().status, 'no_key');
  noKey.destroy(v);
});

test('proxy vo vite.config.js: trasa /api/gfw/sar s plánom radaru — dataset SAR, okno 10 dní, záloha DAILY, atribúcia Copernicus (tripwire)', () => {
  const src = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(src, /middlewares\.use\('\/api\/gfw\/sar', handleReport\(PLANS\.sar\)\)/);
  assert.match(src, /dataset: GFW_SAR_DATASET, primary: GFW_MODES\.hourly, fallback: GFW_MODES\.sarDay/);
  assert.match(src, /merge: latestGfwSarDetections/);
  assert.match(src, /rangeFor: \(now\) => gfwSarDateRange\(now\)/);
  assert.match(src, /Contains modified Copernicus Sentinel data ' \+ new Date\(\)\.getUTCFullYear\(\)/);
  assert.match(src, /cacheKey: \(bbox, range\) => 'sar:' \+ gfwPresenceCacheKey\(bbox, range\)/, 'vlastný priestor cache');
  assert.ok(!/GFW_API_TOKEN/.test(readFileSync(new URL('./gfwSarDetections.js', import.meta.url), 'utf8')), 'klient token nikdy nečíta');
});

test('vrstva: 429 = dočasné odmietnutie (nie rozpočet) a tichý pokus o 30 s ako pri AIS vrstve', async () => {
  const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = [];
    let ok = false;
    const layer = createGfwSarLayer({
      fetchImpl: async (u) => { calls.push(u); return ok ? { ok: true, status: 200, json: async () => ({ rows: [], meta: { ...META, latestDay: null } }) } : { ok: false, status: 429, json: async () => ({ error: 'upstream', detail: 'upstream HTTP 429' }) }; },
      collectionFactory: fakeCollection, overlayHost: fakeOverlay(),
    });
    const v = fakeViewer();
    layer.init(v);
    await layer.enable();
    await flush();
    assert.equal(calls.length, 1);
    assert.match(layer.getStats().error, /429/);
    assert.doesNotMatch(layer.getStats().error, /rozpočet|budget/, 'upstream 429 nie je minutý rozpočet');
    ok = true;
    mock.timers.tick(GFW_PRESENCE_RETRY_MS);
    await flush();
    assert.equal(calls.length, 2, 'tichý pokus bez pohybu kamery');
    assert.equal(layer.getStats().error, null);
    assert.equal(layer.getStats().status, 'empty');
    layer.destroy(v);
  } finally {
    mock.timers.reset();
  }
});
