// src/data/trackedHistory.test.mjs
// História sledovaného letu pre grafy karty (2026-09-12): cache s TTL, jeden
// dopyt naraz, onDone len po skutočnom fetchi, 503 vypne ďalšie dopyty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKED_HISTORY_FAILURE_TTL_MS, TRACKED_HISTORY_TTL_MS, TRACKED_HISTORY_WINDOW_S,
  _resetTrackedHistoryForTest, cachedTrackedHistory, forgetTrackedHistory, requestTrackedHistory, trackedHistoryDisabled,
} from './trackedHistory.js';

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
