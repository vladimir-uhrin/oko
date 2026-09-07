// src/data/flightHistory.test.mjs
// Klientská história letov: parsovanie, súhrn, interpolácia, graf, API (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHART_SAMPLES,
  bearingDeg,
  chartSeries,
  fetchFlightTrack,
  fixFromCompact,
  formatClockUtc,
  formatDuration,
  interpolateFix,
  legTitle,
  lerpLon,
  parseTrackPayload,
  searchFlightHistory,
  trackSummary,
} from './flightHistory.js';

const T0 = 1_757_000_000;
const compact = (dt, lat, lon, alt, gs, trk = 90, vr = 0, squawk = '1000', gnd = 0) => [T0 + dt, lat, lon, alt, gs, trk, vr, squawk, gnd];
const FIXES = parseTrackPayload({ fixes: [compact(0, 48, 17, 1000, 100), compact(60, 48.1, 17.2, 3000, 150, 90, 5), compact(120, 48.2, 17.4, 5000, 200, 100, 0, '7700'), compact(300, 48.5, 18.0, 5000, 200)] });

test('kompaktné pole → fix; nezmysly null; payload sa zoradí chronologicky', () => {
  const f = fixFromCompact([T0, 48.1, 17.2, null, 230, 90, -3, '1000', 1]);
  assert.equal(f.alt, null, 'chýbajúca výška ostane null, nie 0');
  assert.equal(f.gnd, true);
  assert.equal(fixFromCompact([T0, null, 17]), null);
  assert.equal(fixFromCompact('x'), null);
  const unsorted = parseTrackPayload({ fixes: [compact(60, 1, 1, 1, 1), compact(0, 0, 0, 0, 0)] });
  assert.deepEqual(unsorted.map((x) => x.t), [T0, T0 + 60]);
  assert.deepEqual(parseTrackPayload(null), []);
});

test('súhrn: trvanie, maximá, vzdialenosť po veľkokružniciach, squawky', () => {
  const s = trackSummary(FIXES);
  assert.equal(s.fixes, 4);
  assert.equal(s.durationS, 300);
  assert.equal(s.maxAltM, 5000);
  assert.equal(s.maxGsMps, 200);
  assert.ok(s.distanceKm > 80 && s.distanceKm < 100, `vzdialenosť ${s.distanceKm}`);
  assert.deepEqual(s.squawks, ['1000', '7700']);
  assert.equal(trackSummary([FIXES[0]]), null);
});

test('interpolácia: medzi fixmi lineárne, mimo rozsahu krajný, kurz cez 0°, dĺžka cez ±180°', () => {
  const mid = interpolateFix(FIXES, T0 + 30);
  assert.ok(Math.abs(mid.lat - 48.05) < 1e-9);
  assert.ok(Math.abs(mid.alt - 2000) < 1e-9);
  assert.ok(Math.abs(mid.gs - 125) < 1e-9);
  assert.equal(mid.index, 0);
  assert.ok(Math.abs(mid.frac - 0.1) < 1e-9);
  assert.equal(interpolateFix(FIXES, T0 - 100).t, T0, 'pred začiatkom prvý fix');
  assert.equal(interpolateFix(FIXES, T0 + 999).t, T0 + 300, 'po konci posledný');
  assert.equal(interpolateFix(FIXES, T0 + 90).squawk, '7700', 'bližší fix nesie squawk');
  assert.ok(Math.abs(lerpLon(179, -179, 0.5) - 180) < 1e-9 || Math.abs(lerpLon(179, -179, 0.5) + 180) < 1e-9);
  assert.ok(Math.abs(lerpLon(350, 10, 0.5) - 0) < 1e-9, 'kurz 350°→10° ide cez 0, nie cez 180');
  const noTrk = interpolateFix([{ ...FIXES[0], trk: null }, { ...FIXES[1], trk: null }], T0 + 30);
  assert.ok(noTrk.trk > 30 && noTrk.trk < 60, `kurz z azimutu segmentu: ${noTrk.trk}`);
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 1e-9);
  assert.equal(interpolateFix([], 1), null);
});

test('graf: rovnomerné vzorky v čase, normalizované 0..1, popisy okrajov', () => {
  const s = chartSeries(FIXES, { samples: 11 });
  assert.equal(s.alt.length, 11);
  assert.equal(s.alt[0], 0.2, 'prvá výška 1000/5000');
  assert.equal(s.alt[10], 1);
  assert.equal(s.gs[0], 0.5);
  assert.equal(s.startT, T0);
  assert.equal(s.endT, T0 + 300);
  assert.equal(chartSeries([FIXES[0]]), null);
  assert.equal(CHART_SAMPLES, 240);
});

test('formáty: UTC hodina, trvanie, titulok úseku', () => {
  assert.equal(formatClockUtc(0), '00:00');
  assert.equal(formatClockUtc(NaN), '--:--');
  assert.equal(formatDuration(48 * 60), '48 min');
  assert.equal(formatDuration(3600 + 23 * 60), '1 h 23 min');
  assert.equal(formatDuration(7200), '2 h');
  assert.equal(legTitle({ callsign: 'SWR11H', icao24: '4b1805' }), 'SWR11H');
  assert.equal(legTitle({ callsign: '', icao24: '4b1805' }), '4B1805');
});

test('API: search a track volajú /api/history s parametrami a rozbalia odpoveď; HTTP chyba vyhodí', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.startsWith('/api/history/search')) return { ok: true, json: async () => ({ legs: [{ id: 1, callsign: 'SWR11H' }] }) };
    if (url.startsWith('/api/history/track')) return { ok: true, json: async () => ({ fixes: [compact(0, 1, 2, 3, 4)] }) };
    return { ok: false, status: 500 };
  };
  const legs = await searchFlightHistory(' swr ', { hours: 72, limit: 10, fetcher });
  assert.equal(legs[0].callsign, 'SWR11H');
  assert.equal(calls[0], '/api/history/search?q=swr&hours=72&limit=10');
  const fixes = await fetchFlightTrack('4B1805', { fromS: T0, toS: T0 + 300.4, fetcher });
  assert.equal(fixes.length, 1);
  assert.equal(calls[1], `/api/history/track?icao24=4b1805&from=${T0}&to=${T0 + 301}`);
  await assert.rejects(() => searchFlightHistory('x', { fetcher: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
});
