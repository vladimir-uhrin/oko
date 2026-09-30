// src/data/flightHistoryClient.test.mjs — história letov v samostatnom vlákne (2026-09-30).
// CPU profil dev servera: zápis snímku OpenSky do SQLite blokoval hlavné vlákno ~4,4 s každých
// ~90 s a verejné /api na okolive.sk vtedy stálo. Testy SPRÁVANIA: klient cez worker zapisuje
// a číta rovnako ako synchrónny store — a hlavné vlákno počas veľkého zápisu ostáva voľné.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HISTORY_RECORD_QUEUE_MAX, openFlightHistoryWorker } from './flightHistoryClient.js';

const T0 = Math.floor(Date.now() / 1000) - 600;
const openSkyBody = (time, rows) => JSON.stringify({ time, states: rows });
const row = (icao, cs, t, lon, lat, alt) => [icao, cs, 'Slovakia', t, t, lon, lat, alt, false, 230, 90, 0, null, alt + 30, '1000'];

test('zápis a čítanie cez vlákno: snímok, stav, vyhľadanie, stopa, úsek', async () => {
  const history = openFlightHistoryWorker(':memory:');
  try {
    await history.ready;
    const body = openSkyBody(T0, [row('4b1805', 'SWR11H', T0, 17.2, 48.1, 10000), row('3c6444', 'DLH123', T0, 8.5, 50.0, 11000)]);
    assert.equal(await history.recordOpenSkyBody(Buffer.from(body), 'opensky'), 2, 'Buffer ide ako text');
    assert.equal(await history.recordOpenSkyBody(body, 'opensky'), 0, 'ten istý snímok druhýkrát nie');
    await history.recordOpenSkyBody(openSkyBody(T0 + 30, [row('4b1805', 'SWR11H', T0 + 30, 17.3, 48.2, 10200)]), 'opensky');
    const status = await history.status();
    assert.equal(status.fixes, 3);
    const legs = await history.search('SWR', { sinceS: 0, limit: 10 });
    assert.equal(legs.length, 1);
    assert.equal(legs[0].fixes, 2);
    const fixes = await history.track('4b1805', { fromS: 0, toS: T0 + 60 });
    assert.equal(fixes.length, 2);
    const leg = await history.leg(legs[0].id);
    assert.equal(leg.callsign, 'SWR11H');
  } finally {
    await history.close();
  }
  await assert.rejects(history.status(), /closed/, 'po zatvorení sa nič nevolá');
});

test('veľký zápis nezablokuje hlavné vlákno (ako 12 000 lietadiel zo snímku OpenSky)', async () => {
  const history = openFlightHistoryWorker(':memory:');
  try {
    await history.ready;
    const rows = [];
    for (let i = 0; i < 30_000; i += 1) {
      rows.push(row((0x400000 + i).toString(16), `TST${i}`, T0, 10 + (i % 100) * 0.1, 45 + Math.floor(i / 100) * 0.01, 10000));
    }
    const body = openSkyBody(T0, rows);
    let last = Date.now();
    let worstGapMs = 0;
    const ticker = setInterval(() => {
      const now = Date.now();
      worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
    }, 10);
    const inserted = await history.recordOpenSkyBody(body, 'opensky');
    clearInterval(ticker);
    assert.equal(inserted, 30_000);
    assert.ok(worstGapMs < 250, `hlavné vlákno čakalo ${worstGapMs} ms — zápis musí bežať mimo neho`);
  } finally {
    await history.close();
  }
});

test('preťaženie: čakajúce zápisy sú ohraničené, prebytočné snímky sa zahodia bez chyby', async () => {
  const history = openFlightHistoryWorker(':memory:');
  try {
    await history.ready;
    const results = await Promise.all(Array.from({ length: HISTORY_RECORD_QUEUE_MAX + 3 }, (_, i) => (
      history.recordOpenSkyBody(openSkyBody(T0 + i, [row('4b1805', 'SWR11H', T0 + i, 17.2, 48.1, 10000)]), 'opensky')
    )));
    assert.equal(results.filter((n) => n === 1).length, HISTORY_RECORD_QUEUE_MAX, 'zapísaných najviac toľko, koľko pustí front');
    assert.equal(results.filter((n) => n === 0).length, 3, 'ostatné zahodené (0), nie chyba');
  } finally {
    await history.close();
  }
});

test('vite.config.js: história letov ide cez vlákno, pri reštarte servera sa vlákno ukončí', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /import \{ openFlightHistoryWorker \} from '\.\/src\/data\/flightHistoryClient\.js';/);
  assert.match(vite, /store = openFlightHistoryWorker\(cfg\.dbPath, \{ retentionDays: cfg\.retentionDays, rawHours: cfg\.rawHours \}\);/);
  assert.doesNotMatch(vite, /openFlightHistory\(cfg\.dbPath/, 'synchrónny store na hlavnom vlákne nie');
  assert.match(vite, /server\.httpServer\?\.once\('close', \(\) => \{ store\?\.close\(\); store = null; \}\);/);
});
