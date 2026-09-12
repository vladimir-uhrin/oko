// src/data/gfwPresence.test.mjs
// Satelitné AIS · oneskorené (Global Fishing Watch, 2026-09-12): vrstva s
// náhradami za fetch, kolekciu a kameru; karta pod kurzorom; zameriavače.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GFW_PRESENCE_LAYER_ID, GFW_PRESENCE_MAX_CAMERA_M, createGfwPresenceLayer, gfwContactSummary, gfwSourceLabel, gfwViewBbox, sameBbox,
} from './gfwPresence.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';
import { DATA_CREDITS } from './dataCredits.js';

const tEn = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), EN_STRINGS[key] ?? key);

function fakeViewer({ heightM = 800_000, rect = { west: 47.3, south: 23.9, east: 59.1, north: 30.2 } } = {}) {
  const toRad = (d) => (d * Math.PI) / 180;
  const listeners = new Set();
  const primitives = [];
  return {
    listeners,
    primitives,
    scene: { requestRender() {}, primitives: { add(p) { primitives.push(p); }, remove(p) { const i = primitives.indexOf(p); if (i >= 0) primitives.splice(i, 1); return i >= 0; } } },
    camera: {
      positionCartographic: { height: heightM },
      computeViewRectangle: () => (rect ? { west: toRad(rect.west), south: toRad(rect.south), east: toRad(rect.east), north: toRad(rect.north) } : undefined),
      moveEnd: { addEventListener(fn) { listeners.add(fn); return () => listeners.delete(fn); } },
    },
  };
}

function fakeCollection() {
  const items = [];
  return { show: false, items, get length() { return items.length; }, add(o) { items.push(o); return o; }, removeAll() { items.length = 0; } };
}

const ROWS = [
  { mmsi: '244660815', name: 'VLISSINGEN', type: 'CARGO', flag: 'NLD', lat: 26.15, lon: 56.25, hours: 3.4, firstSeen: 1_700_000_000_000, lastSeen: 1_700_003_600_000, vesselId: 'v1' },
  { mmsi: '353136000', name: '', type: '70', flag: 'PAN', lat: 25.05, lon: 55.05, hours: 12, firstSeen: null, lastSeen: null, vesselId: 'v2' },
  { mmsi: '', name: 'NO-MMSI', type: '', flag: '', lat: 27.15, lon: 51.45, hours: 1, firstSeen: null, lastSeen: null, vesselId: 'v3' },
];
const META = { range: { from: '2026-09-07', to: '2026-09-08' }, delayHours: 72, bbox: { west: 47, south: 23, east: 60, north: 31 }, cellDeg: 0.1 };

test('register, i18n a kredit: token 7 abecedne za flights, EN aj SK kľúče, atribúcia „Powered by Global Fishing Watch."', () => {
  const entry = LAYER_STATE_REGISTRY.find((e) => e.id === GFW_PRESENCE_LAYER_ID);
  assert.deepEqual(entry, { id: 'gfw-presence', token: '7', disposition: 'enabled-only' });
  for (const key of ['layer.gfw-presence.name', 'gfw.satellite-ais', 'gfw.delayed', 'gfw.window-pending', 'gfw.zoom-in', 'gfw.empty', 'gfw.no-key', 'gfw.budget', 'gfw.cell-note']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
  const credit = DATA_CREDITS.find((c) => c.key === 'gfw-presence');
  assert.ok(credit, 'kredit existuje');
  assert.match(credit.html, /Powered by Global Fishing Watch\./, 'povinné znenie atribúcie');
  assert.match(credit.html, /href="https:\/\/globalfishingwatch\.org"/, 'odkaz na GFW');
  assert.match(credit.html, /CC BY-NC 4\.0/);
  assert.match(credit.html, /delayed, not live/);
});

test('gfwSourceLabel a gfwContactSummary: obdobie, licencia, ONESKORENÉ; karta v tvare flights s vlajkou z MID', () => {
  assert.equal(gfwSourceLabel(META, tEn), 'Global Fishing Watch · satellite AIS presence 0.1° · 2026-09-07 – 2026-09-08 · CC BY-NC 4.0 · DELAYED ~72 h');
  assert.match(gfwSourceLabel(null, tEn), /window pending · CC BY-NC 4\.0 · DELAYED ~72 h$/);
  const s = gfwContactSummary(ROWS[0], META, tEn);
  assert.equal(s.layerId, 'gfw-presence');
  assert.equal(s.id, '244660815');
  assert.equal(s.callsign, 'VLISSINGEN');
  assert.equal(s.operator, 'DELAYED ~72 h', 'oneskorenie v riadku stroja, nikdy sa netvári ako živé');
  assert.equal(s.type, 'CARGO');
  assert.equal(s.route, 'last observed 0,1° cell · 3.4 h present');
  assert.equal(s.countryIso, 'NL');
  assert.equal(s.lastContactEpochMs, 1_700_003_600_000);
  assert.equal(s.speedMps, null);
  assert.equal(s.altitudeM, null);
  const anon = gfwContactSummary(ROWS[1], META, tEn);
  assert.equal(anon.callsign, '353136000', 'bez mena je titulkom MMSI');
  assert.equal(anon.type, 'CARGO', 'číselný typ 70 sa normalizuje');
  assert.equal(anon.countryIso, 'PA');
  assert.equal(gfwContactSummary(null, META, tEn), null);
});

test('gfwViewBbox: pod stropom výšky výrez z pohľadu zaokrúhlený na celé stupne; nad stropom null', () => {
  assert.deepEqual(gfwViewBbox(fakeViewer()), { west: 47, south: 23, east: 60, north: 31 });
  assert.equal(gfwViewBbox(fakeViewer({ heightM: GFW_PRESENCE_MAX_CAMERA_M + 1 })), null);
  assert.equal(gfwViewBbox(fakeViewer({ rect: null })), null);
  assert.equal(sameBbox({ west: 1, south: 2, east: 3, north: 4 }, { west: 1, south: 2, east: 3, north: 4 }), true);
  assert.equal(sameBbox({ west: 1, south: 2, east: 3, north: 4 }, { west: 1, south: 2, east: 3, north: 5 }), false);
});

test('vrstva: enable → dopyt s výrezom, body, štatistika ONESKORENÉ; hover kandidát navyše; disable skryje; destroy odstráni', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ rows: ROWS, meta: META }) }; };
  const collection = fakeCollection();
  const layer = createGfwPresenceLayer({ fetchImpl, collectionFactory: () => collection, now: () => 123 });
  const viewer = fakeViewer();
  layer.init(viewer);
  assert.equal(viewer.primitives.length, 1);
  await layer.enable();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(calls, ['/api/gfw/presence?bbox=47,23,60,31'], 'jeden dopyt na zaokrúhlený výrez');
  assert.equal(collection.show, true);
  assert.equal(collection.length, 3);
  assert.equal(collection.items[0].id.gfw, true, 'pick id nesie gfw:true → hover kandidát ide najprv na túto vrstvu');
  const stats = layer.getStats();
  assert.equal(stats.count, 3);
  assert.equal(stats.lastUpdate, 123);
  assert.match(stats.source, /DELAYED ~72 h$/);
  assert.equal(stats.error, null);
  assert.equal(layer.hasContact('244660815'), true);
  assert.equal(layer.getContactSummary('244660815').callsign, 'VLISSINGEN');
  assert.equal(layer.getContactSummary('nope'), null);
  const objs = layer.getDetectableObjects({ maxCount: 1, seed: 0, hovered: [{ layerId: 'gfw-presence', sourceId: '353136000' }] });
  assert.ok(objs.some((o) => o.sourceId === '353136000'), 'hovered loď je v kohorte napriek stride');
  assert.ok(objs.every((o) => o.type === 'SEA' && o.metric === 'DELAYED ~72 h'));
  // ten istý výrez znova → bez ďalšieho dopytu
  for (const fn of viewer.listeners) fn();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  layer.disable();
  assert.equal(collection.show, false);
  assert.equal(viewer.listeners.size, 0, 'moveEnd odhlásený');
  layer.destroy(viewer);
  assert.equal(viewer.primitives.length, 0);
});

test('vrstva: nad 4 000 km je stav zoom-in bez dopytu; 503 no_key sa prizná ako chyba', async () => {
  const calls = [];
  const highViewer = fakeViewer({ heightM: 9_000_000 });
  const layer = createGfwPresenceLayer({ fetchImpl: async (u) => { calls.push(u); return { ok: true, json: async () => ({ rows: [] }) }; }, collectionFactory: fakeCollection });
  layer.init(highViewer);
  await layer.enable();
  assert.equal(calls.length, 0);
  assert.equal(layer.getStats().status, 'zoom-in');
  assert.ok(layer.getStats().loadingLabel);
  layer.destroy(highViewer);

  const noKey = createGfwPresenceLayer({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'no_key' }) }), collectionFactory: fakeCollection });
  const v = fakeViewer();
  noKey.init(v);
  await noKey.enable();
  await new Promise((r) => setTimeout(r, 0));
  const st = noKey.getStats();
  assert.equal(st.count, 0);
  assert.ok(st.error, 'chyba je viditeľná v riadku');
  assert.equal(noKey._getStateForTest().status, 'no_key');
  noKey.destroy(v);
});

test('proxy vo vite.config.js: token len na serveri, POST na 4wings/report, cache, rozpočet, limiter, preview hook (tripwire)', () => {
  const src = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(src, /function gfwPresenceProxy\(\)/);
  assert.match(src, /process\.env\.GFW_API_TOKEN/);
  assert.match(src, /Authorization: 'Bearer ' \+ token\(\)/);
  assert.match(src, /gfwPresenceProxy\(\),/, 'zaregistrovaný plugin');
  assert.match(src, /middlewares\.use\('\/api\/gfw\/presence'/);
  assert.match(src, /send\(res, 503, JSON\.stringify\(\{ error: 'no_key'/, 'bez tokenu čistá 503, nie pád');
  assert.match(src, /makeRateLimiter\(\{ windowMs: 60_000, max: 20, globalMax: 60 \}\)/, 'limiter vždy zapnutý');
  assert.match(src, /GFW_DAILY_REQUEST_BUDGET/, 'denný rozpočet');
  assert.match(src, /configurePreviewServer\(server\) \{ install\(server\.middlewares\); \}/, 'funguje aj v preview');
  assert.ok(!/GFW_API_TOKEN/.test(readFileSync(new URL('./gfwPresence.js', import.meta.url), 'utf8')), 'klient token nikdy nečíta');
});
