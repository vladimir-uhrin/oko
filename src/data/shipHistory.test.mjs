// src/data/shipHistory.test.mjs — história lode v paneli (2026-10-11, bod 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchShipHistory,
  interpolateShipSample,
  shipHistorySummary,
  shipSampleLine,
  shipSpeedSeries,
  shipSummaryLine,
  splitShipRuns,
} from './shipHistory.js';

const T0 = Date.parse('2026-10-10T00:00:00Z') / 1000;
const S = [
  { t: T0, lat: 36.98, lon: -76.43, sog: 0, cog: null },
  { t: T0 + 600, lat: 36.95, lon: -76.3, sog: 10, cog: 350 },
  { t: T0 + 1200, lat: 36.9, lon: -76.1, sog: 12, cog: 10 },
  // 5 h bez príjmu
  { t: T0 + 1200 + 5 * 3600, lat: 35.0, lon: -75.0, sog: 13, cog: 200 },
];

test('zhrnutie: km, priemer len v pohybe, max, medzery', () => {
  const s = shipHistorySummary(S);
  assert.equal(s.points, 4);
  assert.equal(s.gaps, 1);
  assert.equal(s.maxSog, 13);
  assert.equal(s.avgSog, 11.7);
  assert.ok(s.distanceKm > 240 && s.distanceKm < 280, String(s.distanceKm));
  assert.equal(shipHistorySummary([]), null);
});

test('interpolácia: medzi bodmi, kurz cez sever, medzera označená, okraje', () => {
  const mid = interpolateShipSample(S, T0 + 900);
  assert.ok(Math.abs(mid.lat - 36.925) < 1e-9);
  assert.equal(mid.sog, 11);
  assert.equal(Math.round(mid.cog), 0, '350° → 10° cez sever, nie cez juh');
  assert.equal(mid.gap, false);
  assert.equal(interpolateShipSample(S, T0 + 3 * 3600).gap, true);
  assert.equal(interpolateShipSample(S, T0 - 5).t, T0);
  assert.equal(interpolateShipSample(S, T0 + 1e7).lat, 35.0);
});

test('úseky a medzery na kreslenie', () => {
  const { runs, gaps } = splitShipRuns(S);
  assert.deepEqual(runs.map((r) => r.length), [3, 1]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0][1].lat, 35.0);
});

test('graf rýchlosti: medzera v príjme = null (žiadna vymyslená rýchlosť)', () => {
  const series = shipSpeedSeries(S, 50);
  assert.equal(series.values.length, 50);
  assert.ok(series.values.some((v) => v === null));
  assert.ok(series.values.every((v) => v === null || (v >= 0 && v <= 1)));
});

test('texty: riadok polohy a zhrnutia po slovensky', () => {
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(shipSampleLine({ ...S[2], gap: false }, t, 'sk'), '10. 10. 00:20 UTC · 12,0 kn · 10° · 36,900° N 76,100° W');
  assert.match(shipSampleLine({ ...S[2], gap: true }, t, 'sk'), /shiphistory\.gap/);
  assert.match(shipSummaryLine(shipHistorySummary(S), t, 'sk'), /^10\. 10\. 00:00 UTC – 10\. 10\. 05:20 UTC · shiphistory\.distance/);
});

test('dopyt na server: zlé body vyhodí, zoradí; chyba servera = výnimka', async () => {
  const urls = [];
  const out = await fetchShipHistory('241190000', 30, async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ samples: [S[1], { t: 1, lat: null, lon: 2 }, S[0]], total: 2, first: T0 }) };
  });
  assert.equal(urls[0], '/api/ais-live/history?mmsi=241190000&days=30');
  assert.deepEqual(out.samples.map((s) => s.t), [T0, T0 + 600]);
  assert.equal(out.first, T0);
  await assert.rejects(fetchShipHistory('241190000', 7, async () => ({ ok: false, status: 503 })));
});

test('zastávky: 2 h do 2 km = zastávka, prechod nie; GPX a KML (2026-10-11)', async () => {
  const { detectShipStops, shipDurationLabel, shipHistoryGpx, shipHistoryKml } = await import('./shipHistory.js');
  const base = Date.parse('2026-10-08T00:00:00Z') / 1000;
  const s = [];
  for (let i = 0; i < 30; i += 1) s.push({ t: base + i * 600, lat: 51.95 + (i % 2) * 0.004, lon: 4.1, sog: 0, cog: null }); // 5 h v Rotterdame
  for (let i = 1; i <= 20; i += 1) s.push({ t: base + 30 * 600 + i * 600, lat: 51.95, lon: 4.1 - i * 0.05, sog: 12, cog: 270 }); // plavba
  s.push({ t: s.at(-1).t + 600, lat: s.at(-1).lat, lon: s.at(-1).lon, sog: 0, cog: null }); // 10 min státie = nie zastávka
  const stops = detectShipStops(s);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].startT, base);
  assert.equal(stops[0].endT, base + 29 * 600);
  assert.ok(Math.abs(stops[0].lon - 4.1) < 1e-9);
  assert.equal(shipDurationLabel(stops[0].endT - stops[0].startT, 'sk'), '4 h 50 min');
  assert.equal(shipDurationLabel(2 * 86400 + 5 * 3600, 'sk'), '2 d 5 h');
  assert.equal(shipDurationLabel(45 * 60, 'sk'), '45 min');
  const gpx = shipHistoryGpx(s.slice(0, 2), { name: 'OSLEEN & co', mmsi: '268238202' });
  assert.match(gpx, /<name>OSLEEN &amp; co<\/name>/);
  assert.match(gpx, /<trkpt lat="51.95000" lon="4.10000"><time>2026-10-08T00:00:00.000Z<\/time><extensions><sog>0<\/sog><\/extensions><\/trkpt>/);
  const kml = shipHistoryKml(s.slice(0, 2), { name: 'OSLEEN', mmsi: '268238202', stops: [{ ...stops[0], label: 'Rotterdam' }] });
  assert.match(kml, /<Placemark><name>Rotterdam<\/name><TimeSpan>/);
  assert.match(kml, /<coordinates>4.10000,51.95000,0 4.10000,51.95400,0<\/coordinates>/);
});
