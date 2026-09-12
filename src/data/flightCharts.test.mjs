// src/data/flightCharts.test.mjs
// Grafy celého letu pre sledovanú kartu (2026-09-12): aktuálny úsek, zlúčenie
// histórie so živým radom, koše po osi, odhad zostupu/stúpania, režim času.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIMB_GUESS_MAX_FRACTION, CRUISE_GUESS_M, FLIGHT_CHART_SAMPLES,
  bucketSeries, buildFlightCharts, currentLegFixes, forecastAltitude, haversineKm, mergeTrackSamples,
} from './flightCharts.js';
import { EN_STRINGS } from '../i18nStrings.js';

const tEn = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), EN_STRINGS[key] ?? key);
const NOW_S = 1_800_000_000;
const HAM = { code: 'HAM', lat: 53.63, lon: 9.99 };
const ZAD = { code: 'ZAD', lat: 44.11, lon: 15.35 };

test('haversineKm a currentLegFixes: vzdialenosť, len posledný úsek, medzera po poslednom fixe = nič', () => {
  assert.ok(Math.abs(haversineKm(HAM.lat, HAM.lon, ZAD.lat, ZAD.lon) - 1130) < 20, 'HAM–ZAD ≈ 1 130 km');
  assert.equal(haversineKm(null, 1, 2, 3), null);
  const fixes = [
    { t: NOW_S - 5 * 3600, alt: 1000 }, { t: NOW_S - 4.9 * 3600, alt: 2000 }, // včerajší úsek
    { t: NOW_S - 3600, alt: 500 }, { t: NOW_S - 1800, alt: 6000 }, { t: NOW_S - 60, alt: 9000 },
  ];
  assert.deepEqual(currentLegFixes(fixes, NOW_S).map((f) => f.alt), [500, 6000, 9000], 'medzera > 30 min delí úseky');
  assert.deepEqual(currentLegFixes(fixes.slice(0, 2), NOW_S), [], 'posledný fix pred 4,9 h = iný let, nie tento');
  assert.deepEqual(currentLegFixes([{ t: NOW_S + 3600 }], NOW_S), [], 'fix z budúcnosti sa ignoruje');
  assert.deepEqual(currentLegFixes(null, NOW_S), []);
});

test('mergeTrackSamples: história + živý rad + teraz chronologicky, blízke body sa spoja (živý dopĺňa polohu)', () => {
  const rows = mergeTrackSamples(
    [{ t: 100, alt: 1000, gs: 100, lat: 1, lon: 1 }, { t: 200, alt: 2000, gs: 120, lat: 2, lon: 2 }],
    [{ epochMs: 150_000, altitudeM: 1500, speedMps: 110 }, { epochMs: 201_000, altitudeM: null, speedMps: 121 }],
    { epochMs: 300_000, altitudeM: 3000, speedMps: 130, lat: 3, lon: 3 },
  );
  assert.deepEqual(rows.map((r) => r.t), [100, 150, 200, 300]);
  assert.deepEqual(rows[2], { t: 200, alt: 2000, gs: 121, lat: 2, lon: 2 }, 'vzorka o sekundu neskôr doplnila rýchlosť, výšku nezmazala');
  assert.deepEqual(rows[3], { t: 300, alt: 3000, gs: 130, lat: 3, lon: 3 });
});

test('bucketSeries: priemer v koši, lineárne doplnené medzery, mimo známeho rozsahu null', () => {
  const s = bucketSeries([{ x: 0, v: 0 }, { x: 0, v: 2 }, { x: 0.5, v: 10 }], 5);
  assert.deepEqual(s, [1, 5.5, 10, null, null], 'kôš 0 = priemer (0+2)/2, kôš 2 = 10, kôš 1 doplnený lineárne, za posledným známym null');
  assert.deepEqual(bucketSeries([], 3), [null, null, null]);
  assert.deepEqual(bucketSeries([{ x: 1, v: 7 }], 3), [null, null, 7]);
});

test('forecastAltitude: v hladine drží po TOD (3° ≈ 300 ft/NM), potom lineárne na 0; klesanie ide rovno na cieľ; stúpanie po cestovnú hladinu', () => {
  // FL360 ≈ 10 973 m → 36 000 ft / 300 = 120 NM ≈ 222 km zostupu z 1 000 km trasy → TOD na x ≈ 0,78
  const level = forecastAltitude({ xNow: 0.3, altitudeM: 10_973, verticalRateMps: 0, speedMps: 230, totalKm: 1000, cruiseAltM: 10_973 });
  assert.equal(level.length, 3);
  assert.deepEqual(level[0], { x: 0.3, v: 10_973 });
  assert.ok(Math.abs(level[1].x - 0.7777) < 0.01 && level[1].v === 10_973, 'TOD ≈ 0,78');
  assert.deepEqual(level[2], { x: 1, v: 0 });
  const descending = forecastAltitude({ xNow: 0.9, altitudeM: 3000, verticalRateMps: -8, speedMps: 150, totalKm: 1000, cruiseAltM: 10_973 });
  assert.deepEqual(descending, [{ x: 0.9, v: 3000 }, { x: 1, v: 0 }], 'už klesá → lineárne na cieľ');
  const climbing = forecastAltitude({ xNow: 0.05, altitudeM: 3000, verticalRateMps: 10, speedMps: 200, totalKm: 1000, cruiseAltM: 3000 });
  assert.equal(climbing[1].v, CRUISE_GUESS_M, 'bez známej cestovnej hladiny sa stúpa na typickú');
  assert.ok(climbing[1].x > 0.05 && climbing[1].x <= 0.05 + CLIMB_GUESS_MAX_FRACTION + 1e-9, 'stúpanie zaberie kus trasy podľa rýchlosti stúpania');
  assert.equal(climbing[climbing.length - 1].v, 0);
  const late = forecastAltitude({ xNow: 0.95, altitudeM: 10_973, verticalRateMps: 0, speedMps: 230, totalKm: 1000, cruiseAltM: 10_973 });
  assert.deepEqual(late, [{ x: 0.95, v: 10_973 }, { x: 1, v: 0 }], 'TOD už prešiel → zostup hneď');
  assert.deepEqual(forecastAltitude({ xNow: 1, altitudeM: 100, totalKm: 10 }), []);
  assert.deepEqual(forecastAltitude({ xNow: 0.5, altitudeM: null, totalKm: 10 }), []);
});

test('buildFlightCharts (trasa): minulosť po osi trasy, budúcnosť čiarkovaná od „teraz", os = kódy letísk, popisky v oboch jednotkách', () => {
  const fixes = [];
  // let z HAM smerom k ZAD: 40 fixov, stúpanie do 11 000 m, potom hladina
  for (let i = 0; i <= 40; i += 1) {
    const f = i / 100; // 0 .. 0,40 trasy
    fixes.push({ t: NOW_S - (40 - i) * 120, lat: HAM.lat + (ZAD.lat - HAM.lat) * f, lon: HAM.lon + (ZAD.lon - HAM.lon) * f, alt: Math.min(11_000, i * 500), gs: 200 + i * 2 });
  }
  const now = { epochMs: NOW_S * 1000, altitudeM: 11_000, speedMps: 280, verticalRateMps: 0, lat: fixes[40].lat, lon: fixes[40].lon };
  const charts = buildFlightCharts({ fixes, samples: [], now, route: { origin: HAM, destination: ZAD }, progress: { fractionDone: 0.4, totalKm: 1130 }, translate: tEn });
  assert.ok(charts);
  assert.equal(charts.mode, 'route');
  assert.equal(charts.forecast, true);
  assert.deepEqual(charts.axis, { left: 'HAM', right: 'ZAD' });
  const n = FLIGHT_CHART_SAMPLES;
  const iNow = Math.round(0.4 * (n - 1));
  assert.equal(charts.altitude.past.length, n);
  assert.equal(charts.altitude.past[0], 0, 'štart na zemi');
  assert.ok(Math.abs(charts.altitude.past[iNow] - 1) < 0.02, 'teraz = maximum (cestovná hladina)');
  assert.equal(charts.altitude.past[iNow + 3], null, 'minulosť končí pri „teraz"');
  assert.equal(charts.altitude.future[iNow - 1], null, 'budúcnosť začína pri „teraz"');
  assert.ok(Math.abs(charts.altitude.future[iNow] - 1) < 0.02);
  assert.equal(charts.altitude.future[n - 1], 0, 'odhad končí na letisku');
  assert.ok(charts.altitude.future[Math.round(0.7 * (n - 1))] > 0.95, 'pred TOD ešte v hladine');
  assert.ok(charts.altitude.future[Math.round(0.9 * (n - 1))] < 0.6, 'po TOD klesá');
  assert.equal(charts.speed.past.length, n);
  assert.ok(Math.abs(charts.speed.past[iNow] - 1) < 0.02, 'rýchlosť teraz je maximum');
  assert.equal(charts.speed.past[iNow + 3], null);
  assert.equal(charts.altitude.label, 'altitude max FL361 · now FL361');
  assert.equal(charts.speed.label, 'speed max 544 kts · now 544 kts (1\u202f008 km/h)');
  assert.equal(charts.altitude.xNow, 0.4);
});

test('buildFlightCharts (bez trasy): os = čas od začiatku záznamu po teraz, bez odhadu; pod 2 body null', () => {
  const samples = [
    { epochMs: (NOW_S - 1200) * 1000, altitudeM: 8000, speedMps: 200 },
    { epochMs: (NOW_S - 600) * 1000, altitudeM: 9000, speedMps: 210 },
  ];
  const now = { epochMs: NOW_S * 1000, altitudeM: 10_000, speedMps: 220, verticalRateMps: 3 };
  const charts = buildFlightCharts({ fixes: [], samples, now, route: null, progress: null, translate: tEn });
  assert.equal(charts.mode, 'time');
  assert.equal(charts.forecast, false);
  assert.equal(charts.axis.right, 'now');
  assert.match(charts.axis.left, /^\d\d:\d\d$/);
  assert.equal(charts.altitude.xNow, 1);
  assert.ok(charts.altitude.future.every((v) => v === null), 'bez trasy sa nič neodhaduje');
  assert.equal(charts.altitude.past[0], 0.8);
  assert.equal(charts.altitude.past[FLIGHT_CHART_SAMPLES - 1], 1);
  assert.equal(buildFlightCharts({ fixes: [], samples: [], now, translate: tEn }), null, 'jediný bod nie je graf');
  assert.equal(buildFlightCharts({ now: null }), null);
});

test('buildFlightCharts: stroj na letisku (celý záznam v x ≈ 0) spadne z osi trasy na os času, aby graf nebol prázdny', () => {
  const fixes = [];
  for (let i = 0; i < 10; i += 1) fixes.push({ t: NOW_S - (10 - i) * 60, lat: HAM.lat + i * 0.0001, lon: HAM.lon, alt: 20 + i, gs: 5 });
  const now = { epochMs: NOW_S * 1000, altitudeM: 30, speedMps: 5, verticalRateMps: 0, lat: HAM.lat + 0.001, lon: HAM.lon };
  const charts = buildFlightCharts({ fixes, samples: [], now, route: { origin: HAM, destination: ZAD }, progress: { fractionDone: 0, totalKm: 1130 }, translate: tEn });
  assert.ok(charts, 'graf existuje');
  assert.equal(charts.mode, 'time', 'os času namiesto jediného koša trasy');
  assert.equal(charts.forecast, false, 'bez osi trasy sa neodhaduje');
  assert.equal(charts.axis.right, 'now');
  assert.ok(charts.altitude.past.filter((v) => v !== null).length >= 2);
});
