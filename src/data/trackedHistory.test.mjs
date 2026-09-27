// src/data/trackedHistory.test.mjs
// História sledovaného letu pre grafy karty (2026-09-12): cache s TTL, jeden
// dopyt naraz, onDone len po skutočnom fetchi, 503 vypne ďalšie dopyty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKED_HISTORY_FAILURE_TTL_MS, TRACKED_HISTORY_TTL_MS, TRACKED_HISTORY_WINDOW_S,
  _resetTrackedHistoryForTest, cachedTrackedHistory, forgetTrackedHistory, requestTrackedHistory, trackedHistoryDisabled,
  loadTrackedHistory, trailWaypointsFromHistory, TRAIL_HISTORY_MAX_POINTS,
} from './trackedHistory.js';
import { readFileSync } from 'node:fs';

const NOW = 1_800_000_000_000;
const compact = (t, alt, gs) => [t, 48.15, 17.11, alt, gs, 90, 0, '1000', 0];

test('requestTrackedHistory: okno 24 h, fixy do cache, onDone po fetchi; v TTL sa nepýta znova; hex musí byť platný', async () => {
  _resetTrackedHistoryForTest();
  const urls = [];
  let done = 0;
  const fetcher = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ icao24: '3c5ef5', fixes: [compact(NOW / 1000 - 600, 8000, 200), compact(NOW / 1000 - 60, 9000, 210)] }) }; };
  assert.equal(await requestTrackedHistory('3C5EF5', { fetcher, onDone: () => { done += 1; }, nowMs: NOW }), true);
  assert.equal(urls.length, 1);
  const u = new URL(urls[0], 'http://localhost');
  assert.equal(u.pathname, '/api/history/track');
  assert.equal(u.searchParams.get('icao24'), '3c5ef5');
  assert.equal(Number(u.searchParams.get('from')), Math.floor(NOW / 1000) - TRACKED_HISTORY_WINDOW_S);
  assert.equal(done, 1);
  const fixes = cachedTrackedHistory('3c5ef5');
  assert.equal(fixes.length, 2);
  assert.equal(fixes[1].alt, 9000);
  assert.equal(fixes[1].gs, 210);
  assert.equal(await requestTrackedHistory('3c5ef5', { fetcher, onDone: () => { done += 1; }, nowMs: NOW + TRACKED_HISTORY_TTL_MS - 1 }), false, 'v TTL bez dopytu');
  assert.equal(await requestTrackedHistory('3c5ef5', { fetcher, onDone: () => { done += 1; }, nowMs: NOW + TRACKED_HISTORY_TTL_MS + 1 }), true, 'po TTL znova');
  assert.equal(urls.length, 2);
  assert.equal(done, 2);
  assert.equal(await requestTrackedHistory('nope', { fetcher, nowMs: NOW }), false);
  forgetTrackedHistory('3c5ef5');
  assert.deepEqual(cachedTrackedHistory('3c5ef5'), []);
});

test('requestTrackedHistory: chyba drží staré fixy a čaká 5 min; 503 vypne históriu úplne', async () => {
  _resetTrackedHistoryForTest();
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls === 1) return { ok: true, status: 200, json: async () => ({ fixes: [compact(NOW / 1000 - 60, 1000, 100)] }) }; return { ok: false, status: 500 }; };
  assert.equal(await requestTrackedHistory('abc123', { fetcher: flaky, nowMs: NOW }), true);
  assert.equal(await requestTrackedHistory('abc123', { fetcher: flaky, nowMs: NOW + TRACKED_HISTORY_TTL_MS + 1 }), false, 'HTTP 500 = neúspech');
  assert.equal(cachedTrackedHistory('abc123').length, 1, 'staré fixy ostali');
  assert.equal(await requestTrackedHistory('abc123', { fetcher: flaky, nowMs: NOW + TRACKED_HISTORY_TTL_MS + 1000 }), false, 'po chybe sa 5 min nepýta');
  assert.equal(calls, 2);
  assert.equal(await requestTrackedHistory('abc123', { fetcher: flaky, nowMs: NOW + TRACKED_HISTORY_TTL_MS + TRACKED_HISTORY_FAILURE_TTL_MS + 2000 }), false);
  assert.equal(calls, 3, 'po 5 min skúsi znova');
  assert.equal(trackedHistoryDisabled(), false);
  const off = async () => ({ ok: false, status: 503, json: async () => ({ error: 'history_disabled' }) });
  _resetTrackedHistoryForTest();
  assert.equal(await requestTrackedHistory('abc123', { fetcher: off, nowMs: NOW }), false);
  assert.equal(trackedHistoryDisabled(), true, '503 = história vypnutá');
  let asked = 0;
  assert.equal(await requestTrackedHistory('def456', { fetcher: async () => { asked += 1; return { ok: true, json: async () => ({ fixes: [] }) }; }, nowMs: NOW }), false);
  assert.equal(asked, 0, 'vypnutá história = žiadne ďalšie dopyty');
  _resetTrackedHistoryForTest();
});

test('trasa z archívu (vlastník 09-27: „trasa sa niekedy objaví a niekedy nie"): len aktuálny let, pred prvým živým fixom, preriedená', () => {
  const nowS = 1_800_000_000;
  const fix = (t, lat, alt, gnd = false) => ({ t, lat, lon: 17, alt, gnd });
  const fixes = [
    fix(nowS - 20_000, 40, 10_000), fix(nowS - 19_000, 41, 10_000), // ráno iný let
    fix(nowS - 3_600, 48.1, 150, true), fix(nowS - 3_000, 48.5, 5_000), fix(nowS - 1_200, 49, 10_000), fix(nowS - 60, 49.5, 10_000),
  ];
  const way = trailWaypointsFromHistory(fixes, { nowS, beforeS: nowS - 100 });
  assert.deepEqual(way.map((w) => w.lat), [48.1, 48.5, 49], 'predošlý let a body po prvom živom fixe vynechané');
  assert.equal(way[0].baroAlt, null, 'na zemi = výška podľa terénu (ako OpenSky on_ground)');
  assert.equal(way[1].baroAlt, 5_000);
  assert.deepEqual(trailWaypointsFromHistory([], { nowS }), []);
  assert.deepEqual(trailWaypointsFromHistory([fix(nowS - 7_200, 48, 9_000)], { nowS }), [], 'posledný fix pred 2 h = let skončil, nič');
  // dlhý let: najviac TRAIL_HISTORY_MAX_POINTS, začiatok aj koniec zachované
  const long = Array.from({ length: 1_000 }, (_, i) => fix(nowS - 10_000 + i * 10, 40 + i / 100, 10_000));
  const thin = trailWaypointsFromHistory(long, { nowS });
  assert.equal(thin.length, TRAIL_HISTORY_MAX_POINTS);
  assert.equal(thin[0].lat, 40);
  assert.equal(thin.at(-1).lat, long.at(-1).lat);
});

test('loadTrackedHistory počká na rozpracovaný dopyt grafov — trasa a karta nerobia dva dopyty', async () => {
  _resetTrackedHistoryForTest();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetcher = async () => { calls += 1; await gate; return { ok: true, status: 200, json: async () => ({ fixes: [compact(Date.now() / 1000 - 60, 9000, 200)] }) }; };
  const chart = requestTrackedHistory('abc123', { fetcher });
  const trail = loadTrackedHistory('abc123', { fetcher });
  release();
  assert.equal(await chart, true);
  assert.equal((await trail).length, 1);
  assert.equal(calls, 1);
  _resetTrackedHistoryForTest();
});

test('flights.js: trasa sa dopĺňa najprv z archívu, OpenSky /tracks len ako záloha', () => {
  const src = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function _backfillTrail('), src.indexOf('function _clearTrail('));
  assert.ok(body.indexOf('loadTrackedHistory(icao24)') > 0);
  assert.ok(body.indexOf('loadTrackedHistory(icao24)') < body.indexOf("'/api/opensky-track?icao24='"), 'archív pred OpenSky');
  assert.match(body, /if \(!parsed\.length\) \{\s*let path = null;/, 'OpenSky len keď archív nič nemá');
});
