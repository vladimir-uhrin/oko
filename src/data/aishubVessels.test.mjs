// src/data/aishubVessels.test.mjs
// Lode · ONESKORENÉ (AISHub cez aiscast, 2026-09-15): vrstva s náhradami za
// fetch/kolekciu/overlay/kameru. Dôraz na zadanie: dedup proti živej vrstve,
// odmietnutie priveľkého výrezu (žiadny dopyt), poctivý label (nikdy LIVE),
// a že bez výrezu sa endpoint nevolá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AISHUB_LAYER_ID,
  AISHUB_OVERLAY_SOURCE_ID,
  aishubAgeLabel,
  aishubContactSummary,
  aishubCourseDeg,
  aishubLabelCard,
  aishubSpeedScale,
  aishubDelayedLabel,
  aishubSourceLabel,
  aishubViewBbox,
  createAishubVesselsLayer,
  sameBbox,
} from './aishubVessels.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

function fakeViewer({ heightM = 800_000, rect = { west: 55.5, south: 25.8, east: 57.2, north: 27.2 }, onScreen = true } = {}) {
  const toRad = (d) => (d * Math.PI) / 180;
  const listeners = new Set();
  const changedListeners = new Set();
  const primitives = [];
  return {
    listeners, changedListeners, primitives,
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
  return { calls, setEntries(s, e, o) { calls.push({ op: 'set', s, e, o }); }, setVisible(s, v) { calls.push({ op: 'visible', s, v }); }, clearSource(s) { calls.push({ op: 'clear', s }); } };
}
const jsonResponse = (payload, ok = true, status = 200) => ({ ok, status, json: async () => payload });

// Riadky v tvare, aký vracia proxy (už normalizované).
const PAYLOAD = {
  rows: [
    { mmsi: '470000001', name: 'GULF STAR', type: '70', sog: 12.3, cog: 210, heading: 208, navStatus: 0, source: 'aishub', lat: 26.4, lon: 56.3, observedAt: Date.UTC(2026, 8, 15, 20, 5) },
    { mmsi: '470000002', name: '', type: '80', sog: 0.1, cog: 0, heading: 511, source: 'aishub', lat: 26.5, lon: 56.4, observedAt: Date.UTC(2026, 8, 15, 20, 4) },
    { mmsi: '470000003', name: 'ALREADY LIVE', type: '70', sog: 8, cog: 90, source: 'aishub', lat: 26.6, lon: 56.5, observedAt: Date.UTC(2026, 8, 15, 20, 3) },
    { mmsi: '470000009', name: 'OWN FEED', type: '70', sog: 5, cog: 45, source: 'aisstream', lat: 26.7, lon: 56.6, observedAt: Date.UTC(2026, 8, 15, 20, 2) },
  ],
  meta: { source: 'AISHub via Open Waters AIS (aiscast)', delayed: true, attribution: { aishub: 'Open Waters AIS (https://openwaters.io/ais/). AISHub (https://www.aishub.net)' }, counts: { aishub: 3, aisstream: 1 } },
};

test('register + i18n + kredit: token z, EN aj SK kľúče, kredit aishub, label nikdy LIVE', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === AISHUB_LAYER_ID);
  assert.ok(entry, 'aishub-vessels je v registri');
  assert.equal(entry.token, 'z');
  assert.equal(entry.disposition, 'enabled-only');
  for (const key of ['layer.aishub-vessels.name', 'aishub.delayed', 'aishub.delayed-source', 'aishub.zoom-in', 'aishub.empty', 'aishub.throttled']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  assert.match(SK_STRINGS['aishub.delayed'], /AISHub · oneskorené ~1–6 min/);
  assert.doesNotMatch(SK_STRINGS['aishub.delayed'], /LIVE|živé|live/i);
  assert.ok(DATA_CREDITS.find((c) => c.key === 'aishub'), 'kredit aishub existuje');
  assert.match(DATA_CREDITS.find((c) => c.key === 'aishub').html, /AISHub/);
});

test('aishubViewBbox: null nad výškou, null nad plochou (>90 sq°), zaokrúhlený výrez inak; tripwire — bez rect sa nedopytuje', async () => {
  assert.equal(aishubViewBbox(null), null);
  assert.equal(aishubViewBbox(fakeViewer({ heightM: 9_000_000 })), null, 'privysoko = null');
  assert.equal(aishubViewBbox(fakeViewer({ rect: null })), null, 'bez obdĺžnika = null');
  assert.equal(aishubViewBbox(fakeViewer({ rect: { west: 0, south: 0, east: 20, north: 20 } })), null, '400 sq° > strop = null');
  assert.deepEqual(aishubViewBbox(fakeViewer({ rect: { west: 55.5, south: 25.8, east: 57.2, north: 27.2 } })), { west: 55.5, south: 25.8, east: 57.2, north: 27.2 });
  assert.equal(sameBbox({ west: 1, south: 2, east: 3, north: 4 }, { west: 1, south: 2, east: 3, north: 4 }), true);

  // Tripwire: nad stropom plochy vrstva enable() NEzavolá fetch (žiadny ?bbox=).
  let calls = 0;
  const layer = createAishubVesselsLayer({ fetchImpl: async () => { calls += 1; return jsonResponse(PAYLOAD); }, collectionFactory: fakeCollection, overlayHost: fakeOverlay() });
  layer.init(fakeViewer({ rect: { west: 0, south: 0, east: 20, north: 20 } }));
  await layer.enable();
  assert.equal(calls, 0, 'priveľký výrez → žiadny dopyt (žiadne predstieranie pokrytia)');
  assert.equal(layer._getStateForTest().status, 'zoom-in');
});

test('load + dedup: aisstream riadky a MMSI, ktoré vidí živá vrstva, sa zahodia; billboardy a popisky len pre zvyšné', async () => {
  const overlay = fakeOverlay();
  const urls = [];
  const layer = createAishubVesselsLayer({
    fetchImpl: async (url) => { urls.push(url); return jsonResponse(PAYLOAD); },
    collectionFactory: fakeCollection,
    overlayHost: overlay,
    isLive: (mmsi) => mmsi === '470000003', // túto loď už vidí živá vrstva
  });
  layer.init(fakeViewer());
  await layer.enable();
  await new Promise((r) => setImmediate(r));

  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/api\/aiscast\/vessels\?bbox=55\.5,25\.8,57\.2,27\.2$/, 'dopyt na viditeľný výrez');
  const state = layer._getStateForTest();
  // 4 riadky − 1 aisstream (OWN FEED) − 1 živý (ALREADY LIVE) = 2
  assert.equal(state.rows, 2, 'aisstream aj živý MMSI vypadli');
  assert.equal(state.points, 2, 'dva billboardy');
  assert.equal(layer.hasContact('470000001'), true);
  assert.equal(layer.hasContact('470000003'), false, 'živú loď táto vrstva nekreslí');
  assert.equal(layer.hasContact('470000009'), false, 'aisstream riadok nie');
  const setCall = overlay.calls.find((c) => c.op === 'set');
  assert.ok(setCall && setCall.e.length >= 1, 'popisky publikované');
});

test('poctivý label: karta pod kurzorom hovorí ONESKORENÉ, nikdy LIVE; ukazuje rýchlosť a kurz z AIS', () => {
  const tSk = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), SK_STRINGS[key] ?? key);
  const now = Date.UTC(2026, 8, 15, 20, 8); // 3 min po row0
  const summary = aishubContactSummary(PAYLOAD.rows[0], tSk, now);
  assert.equal(summary.layerId, AISHUB_LAYER_ID);
  assert.equal(summary.callsign, 'GULF STAR');
  // Zjednotené so živými loďami: operator = nav status; oneskorené + vek v route.
  assert.equal(summary.operator, 'UNDER WAY', 'nav status ako pri živých lodiach');
  assert.match(summary.route, /oneskorené/i);
  assert.match(summary.route, /3 min/, 'vek údaja (jazyk podľa currentLanguage)');
  assert.doesNotMatch(summary.route, /\bLIVE\b/i);
  assert.equal(summary.source, 'AISHub');
  assert.equal(summary.stale, false);
  assert.ok(Math.abs(summary.speedMps - 12.3 * 0.514444) < 1e-6, 'sog kn → m/s');
  assert.equal(summary.trackDeg, 208, 'kurz: heading má prednosť pred cog');
  assert.match(aishubDelayedLabel(tSk), /AISHub · oneskorené ~1–6 min/);
  assert.doesNotMatch(aishubDelayedLabel(tSk), /LIVE/i);
  // zdroj mimo aishub sa v karte prizná pravdivo (v poli source)
  const other = aishubContactSummary({ ...PAYLOAD.rows[0], source: 'barentswatch' }, tSk);
  assert.match(other.source, /barentswatch/);
  assert.match(other.source, /AISHub/);
  // riadok zdroja v paneli nesie atribúciu a nikdy nie je LIVE
  const src = aishubSourceLabel(PAYLOAD.meta, tSk);
  assert.match(src, /AISHub · oneskorené ~1–6 min/);
  assert.match(src, /openwaters\.io/);
  assert.doesNotMatch(src, /LIVE/i);
});

test('getStats + throttled: 429 dá poctivú hlášku, stav sa nezasekne', async () => {
  const layer = createAishubVesselsLayer({ fetchImpl: async () => jsonResponse({ error: 'rate_limited' }, false, 429), collectionFactory: fakeCollection, overlayHost: fakeOverlay() });
  layer.init(fakeViewer());
  await layer.enable();
  await new Promise((r) => setImmediate(r));
  assert.match(layer.getStats().error, /429|obmedzuje|throttl/i);
  // getStats() používa globálne t (v testoch EN): „delayed", nie „oneskorené".
  assert.match(layer.getStats().source, /AISHub · (delayed|oneskorené) ~1–6 min/);
  assert.doesNotMatch(layer.getStats().source, /LIVE/i);
});

test('aishubCourseDeg: heading má prednosť (0–359), inak cog; 511/mimo rozsahu/nič = null (trup na sever)', () => {
  assert.equal(aishubCourseDeg({ heading: 208, cog: 210 }), 208, 'heading vyhráva');
  assert.equal(aishubCourseDeg({ heading: 511, cog: 210 }), 210, 'heading 511 = nedostupné → cog');
  assert.equal(aishubCourseDeg({ heading: null, cog: 0 }), 0, 'cog 0 je platný smer');
  assert.equal(aishubCourseDeg({ cog: 359.9 }), 359.9);
  assert.equal(aishubCourseDeg({ heading: null, cog: null }), null, 'bez smeru → null (sever)');
  assert.equal(aishubCourseDeg({ heading: 400, cog: 720 }), null, 'mimo rozsahu = null');
  assert.equal(aishubCourseDeg({}), null);
});

test('veľkosť trupu podľa rýchlosti — rovnaké prahy ako živé lode', () => {
  assert.equal(aishubSpeedScale(0), 0.6);
  assert.equal(aishubSpeedScale(5), 0.6);
  assert.equal(aishubSpeedScale(8), 0.68);
  assert.equal(aishubSpeedScale(12.3), 0.68);
  assert.equal(aishubSpeedScale(18), 0.78);
  assert.equal(aishubSpeedScale(25), 0.78);
  assert.equal(aishubSpeedScale(null), 0.6);
});

test('vek údaja: pod 90 s v sekundách, inak v minútach; SK/EN; bez času prázdne', () => {
  const t0 = Date.UTC(2026, 8, 15, 20, 0, 0);
  assert.equal(aishubAgeLabel(t0, t0 + 45_000, 'sk'), 'pred 45 s');
  assert.equal(aishubAgeLabel(t0, t0 + 45_000, 'en'), '45s ago');
  assert.equal(aishubAgeLabel(t0, t0 + 3 * 60_000, 'sk'), 'pred 3 min');
  assert.equal(aishubAgeLabel(t0, t0 + 3 * 60_000, 'en'), '3 min ago');
  assert.equal(aishubAgeLabel(null, t0), '');
});

test('klik na loď: výber pripne kartu (variant selected) a zvýrazní zameriavač; opäť prázdny výber zruší', async () => {
  const overlay = fakeOverlay();
  const layer = createAishubVesselsLayer({ fetchImpl: async () => jsonResponse(PAYLOAD), collectionFactory: fakeCollection, overlayHost: overlay });
  layer.init(fakeViewer());
  await layer.enable();
  await new Promise((r) => setImmediate(r));

  // predtým: žiadny výber, karty sú variant 'card'
  assert.equal(layer._getStateForTest().selected, null);
  layer._selectForTest('470000001');
  assert.equal(layer._getStateForTest().selected, '470000001');
  const set = overlay.calls.filter((c) => c.op === 'set').at(-1);
  const sel = set.e.find((entry) => String(entry.id) === 'aishub:470000001');
  assert.ok(sel, 'vybraná loď má kartu');
  assert.equal(sel.variant, 'selected', 'pripnutá karta = variant selected');
  assert.equal(sel.protected, true);
  assert.equal(sel.maxDistance, Infinity, 'vybraná karta sa nestráca so vzdialenosťou');
  // zameriavač: vybraná loď je vynútená v detekcii aj mimo vzorky
  const det = layer.getDetectableObjects({ maxCount: 1 });
  assert.ok(det.some((o) => String(o.sourceId) === '470000001'), 'vybraná loď má vždy zameriavač');

  layer._selectForTest(null);
  assert.equal(layer._getStateForTest().selected, null);
  const set2 = overlay.calls.filter((c) => c.op === 'set').at(-1);
  assert.ok(!set2.e.some((entry) => entry.variant === 'selected'), 'po zrušení žiadna pripnutá karta');
});

test('okolitá loď AISHub: len vlajka a meno; stará poloha (≥ 10 min) sivý okraj + ONESKORENÉ · vek', () => {
  // 2026-09-27 vlastník: „pri tých lodiach je to rušivé, treba dať len základné info a až po prejdení myšou plné info"
  const row = PAYLOAD.rows[0]; // observedAt 20:05
  const fresh = aishubLabelCard(row, { x: 1 }, (k) => k, Date.UTC(2026, 8, 15, 20, 6));
  assert.equal(fresh.title, 'GULF STAR');
  assert.deepEqual(fresh.details, [], 'bez typu, rýchlosti, kurzu a „oneskorené pred 60 s"');
  assert.notEqual(fresh.accent, '146, 156, 165');
  const stale = aishubLabelCard(row, { x: 1 }, (k) => k, Date.UTC(2026, 8, 15, 20, 20));
  assert.equal(stale.details.length, 1);
  assert.match(stale.details[0], /^aishub\.badge · /);
  assert.equal(stale.accent, '146, 156, 165', 'sivý okraj ako posledná známa poloha živých lodí');
  // vybraná (klik) ostáva plná
  const sel = aishubLabelCard(row, { x: 1 }, (k) => k, Date.UTC(2026, 8, 15, 20, 6), true);
  assert.match(sel.details[0], /· 12\.3KT · 208° · /);
});

test('klik: layerLabelCard je klikateľná (actionable → interactive v overlay policy)', () => {
  const card = aishubLabelCard(PAYLOAD.rows[0], { x: 1 }, (k) => k, Date.UTC(2026, 8, 15, 20, 6));
  assert.equal(card.actionable, true, 'karta je klikateľná ako živé lode');
  assert.equal(card.selected, false);
  const selCard = aishubLabelCard(PAYLOAD.rows[0], { x: 1 }, (k) => k, Date.UTC(2026, 8, 15, 20, 6), true);
  assert.equal(selCard.selected, true);
  assert.ok(selCard.priority > card.priority, 'vybraná karta má vyššiu prioritu');
});
