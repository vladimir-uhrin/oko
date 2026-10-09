// src/data/weatherHealth.test.mjs — stráženie čerstvosti dát počasia (2026-10-09). Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meteoRunHealth, radarHealth, stationsHealth, warningsHealth } from './weatherHealth.js';
import { FEEDS, feedForPath, isStatusPath } from '../admin/server/feeds.js';

const NOW = Date.parse('2026-10-09T16:17:00Z');

test('GFS: beh starší než 14 h nie je v poriadku (dnešný problém: 00Z o 16:17); 12,75 h pred ďalším sťahovaním je bežných', () => {
  assert.equal(meteoRunHealth('2026-10-09T03:32:00Z', NOW).ok, true, '12,75 h');
  const bad = meteoRunHealth('2026-10-09T00:00:00Z', NOW);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /16\.3 h \(limit 14 h\)/);
  assert.equal(meteoRunHealth('2026-10-09T06:00:00Z', NOW).ok, true);
  assert.equal(meteoRunHealth(null, NOW).ok, false);
});

test('radar a stanice: limity 45 a 30 min', () => {
  assert.equal(radarHealth('2026-10-09T15:50:00Z', NOW).ok, true);
  assert.equal(radarHealth('2026-10-09T15:20:00Z', NOW).ok, false);
  assert.equal(radarHealth(null, NOW).ok, false);
  assert.equal(stationsHealth('2026-10-09T16:00:00Z', NOW).ok, true);
  assert.equal(stationsHealth('2026-10-09T15:40:00Z', NOW).ok, false);
});

test('výstrahy: chyba aj podržané staré dáta = nie ok', () => {
  assert.equal(warningsHealth({ status: 200, payload: { warnings: [1, 2] } }).ok, true);
  assert.equal(warningsHealth({ status: 200, payload: { warnings: [], stale: true } }).ok, false);
  assert.equal(warningsHealth({ status: 502, error: 'down' }).ok, false);
});

test('admin vzorkuje stavové adresy počasia a nikdy ich neblokuje', () => {
  const byId = Object.fromEntries(FEEDS.map((f) => [f.id, f]));
  for (const [id, status] of [['meteo', '/api/meteo/health'], ['opera', '/api/opera/radar/health'], ['shmu-stations', '/api/shmu-stations/health'], ['warnings', '/api/weather-warnings/health']]) {
    assert.equal(byId[id].status, status);
    assert.equal(byId[id].sample, true);
    assert.equal(isStatusPath(status), true);
  }
  assert.equal(feedForPath('/api/shmu-stations').id, 'shmu-stations', 'stanice nie sú radar SHMÚ');
  assert.equal(feedForPath('/api/shmu/radar').id, 'shmu');
});
