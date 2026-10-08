// src/data/meteogram.test.mjs
// Meteogram po kliknutí na mapu (2026-10-08, „ako Windy"): model dát, serverová služba s cache
// a stropom, pomôcky pásu. Správanie, nie text kódu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columnIndexForTime, coordinateLabel, meteogramCell, meteogramColumns, meteogramDays, meteogramHour,
  nearestPlaceName, normalizeOpenMeteoPoint, openMeteoPointUrl, rampCssColor, utcOffsetLabel, windArrowRotation,
} from './meteogram.js';
import { createMeteoPointService, METEO_POINT_FRESH_MS } from './meteoPointService.js';
import { bottomAboveAnchor, cellText, temperaturePath } from '../meteogramPanel.js';

const H = 3600_000;
const T0 = Date.parse('2026-10-08T00:00:00Z');

function openMeteoJson(hours = 24, { offset = 7200 } = {}) {
  const time = Array.from({ length: hours }, (_, i) => (T0 + i * H) / 1000);
  return {
    latitude: 48.2, longitude: 17.1, elevation: 134, utc_offset_seconds: offset, timezone_abbreviation: 'GMT+2',
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 10 + i),
      precipitation: time.map((_, i) => (i >= 3 && i < 6 ? 0.4 : 0)),
      cloud_cover: time.map(() => 50),
      wind_speed_10m: time.map((_, i) => i),
      wind_direction_10m: time.map(() => 270),
      wind_gusts_10m: time.map((_, i) => (i === 4 ? 20 : 5)),
      pressure_msl: time.map(() => 1013),
    },
  };
}

test('bod sa zaokrúhli na bunku 0,1° a neplatné súradnice sa odmietnu', () => {
  assert.deepEqual(meteogramCell(48.1449, 17.1077), { lat: 48.1, lon: 17.1, key: '48.10,17.10' });
  assert.equal(meteogramCell(48.16, 17.14).key, '48.20,17.10');
  assert.equal(meteogramCell(91, 0), null);
  assert.equal(meteogramCell('x', 0), null);
});

test('adresa Open-Meteo pýta model GFS, vietor v m/s a miestny čas', () => {
  const url = new URL(openMeteoPointUrl({ lat: 48.1, lon: 17.1 }));
  assert.equal(url.searchParams.get('models'), 'gfs_global');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.ok(url.searchParams.get('hourly').includes('wind_gusts_10m'));
});

test('normalizácia: časy v ms, chýbajúce hodnoty null, bez časov null', () => {
  const json = openMeteoJson(6);
  json.hourly.temperature_2m[2] = null;
  const s = normalizeOpenMeteoPoint(json);
  assert.equal(s.times[1], T0 + H);
  assert.equal(s.temp[2], null);
  assert.equal(s.utcOffsetSec, 7200);
  assert.equal(normalizeOpenMeteoPoint({ hourly: { time: [] } }), null);
  assert.equal(normalizeOpenMeteoPoint(null), null);
});

test('stĺpce po 3 h od kroku najbližšieho k teraz: zrážky súčet, nárazy maximum', () => {
  const s = normalizeOpenMeteoPoint(openMeteoJson(24));
  const cols = meteogramColumns(s, { nowMs: T0 + 4 * H }); // najbližší krok = 03Z
  assert.equal(cols[0].t, T0 + 3 * H);
  assert.equal(cols[0].temp, 13);
  assert.equal(cols[0].precip, 1.2); // 3 × 0,4 mm
  assert.equal(cols[0].gust, 20); // maximum 03–05Z
  assert.equal(cols[1].precip, 0);
  assert.equal(cols[1].t - cols[0].t, 3 * H);
  assert.deepEqual(meteogramColumns(null), []);
});

test('dni a hodiny v miestnom čase miesta', () => {
  const s = normalizeOpenMeteoPoint(openMeteoJson(48));
  const cols = meteogramColumns(s, { nowMs: T0 });
  assert.equal(meteogramHour(cols[0].t, 7200), '02');
  const days = meteogramDays(cols, 7200, 'sk');
  assert.equal(days[0].label, 'Št 8. 10.');
  assert.equal(days.reduce((n, d) => n + d.span, 0), cols.length);
  assert.equal(meteogramDays(cols, 7200, 'en')[0].label, 'Thu 8/10');
  assert.equal(utcOffsetLabel(7200), 'UTC+2');
  assert.equal(utcOffsetLabel(-12600), 'UTC−3:30');
  assert.equal(utcOffsetLabel(0), 'UTC');
});

test('farby buniek z rámp mapy, šípka ukazuje kam vietor fúka', () => {
  assert.equal(rampCssColor('wind', 0), 'rgb(98, 113, 183)'); // #6271b7, prvá zastávka
  assert.equal(rampCssColor('wind', 999), 'rgb(231, 215, 215)'); // posledná
  assert.equal(rampCssColor('temp', null), null);
  assert.equal(windArrowRotation(270), 90); // západný vietor fúka na východ
  assert.equal(windArrowRotation(0), 180);
  assert.equal(windArrowRotation(null), null);
});

test('stĺpec času mapy a súradnice ako text', () => {
  const cols = [{ t: T0 }, { t: T0 + 3 * H }];
  assert.equal(columnIndexForTime(cols, '2026-10-08T03:00:00Z'), 1);
  assert.equal(columnIndexForTime(cols, '2026-10-08T04:00:00Z'), -1);
  assert.equal(coordinateLabel(48.146, 17.107, 'sk'), '48,15° S · 17,11° V');
  assert.equal(coordinateLabel(-33.9, -70.6, 'en'), '33.90° S · 70.60° W');
});

test('meno sídla: najbližšie, veľké mesto má trojnásobný dosah, nič ďaleko', () => {
  const places = [
    { name: 'Bratislava', lat: 48.1486, lon: 17.1077, pop: 475_000 },
    { name: 'Stupava', lat: 48.2747, lon: 17.0317, pop: 10_000 },
    { name: 'Malá obec', lat: 48.17, lon: 17.20, pop: 900 },
  ];
  // ~10 km od Bratislavy, ~4 km od obce — veľké mesto vyhrá (10/3 < 4)
  assert.equal(nearestPlaceName(places, 48.15, 17.24), 'Bratislava');
  assert.equal(nearestPlaceName(places, 48.27, 17.04), 'Stupava');
  assert.equal(nearestPlaceName(places, 49.5, 19.5), null);
});

function fakeFetch(json = openMeteoJson(24), { ok = true } = {}) {
  const calls = [];
  const impl = async (url) => { calls.push(url); return { ok, status: ok ? 200 : 500, text: async () => JSON.stringify(json) }; };
  return { impl, calls };
}

test('služba: druhý dopyt z tej istej bunky ide z cache, súbežné sa spoja', async () => {
  let now = T0;
  const f = fakeFetch();
  const svc = createMeteoPointService({ fetchImpl: f.impl, now: () => now });
  const [a, b] = await Promise.all([svc.get(48.14, 17.11), svc.get(48.11, 17.09)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(f.calls.length, 1);
  const c = await svc.get('48.1', '17.1');
  assert.equal(c.cache, 'HIT');
  assert.equal(c.payload.model, 'GFS 0.25°');
  assert.equal(c.payload.temp[0], 10);
  now += METEO_POINT_FRESH_MS + 1;
  const d = await svc.get(48.1, 17.1);
  assert.equal(d.cache, 'MISS');
  assert.equal(f.calls.length, 2);
});

test('služba: chyba Open-Meteo vráti staré dáta, inak 502; strop dopytov 429; zlé súradnice 400', async () => {
  let now = T0;
  let ok = true;
  const impl = async () => ({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(openMeteoJson(24)) });
  const svc = createMeteoPointService({ fetchImpl: impl, now: () => now, upstreamPerHour: 2 });
  assert.equal((await svc.get(48.1, 17.1)).status, 200);
  now += METEO_POINT_FRESH_MS + 1;
  ok = false;
  const stale = await svc.get(48.1, 17.1);
  assert.equal(stale.status, 200);
  assert.equal(stale.payload.stale, true);
  assert.equal((await svc.get(10, 10)).status, 429); // strop 2/h vyčerpaný
  assert.equal((await svc.get(999, 10)).status, 400);
  now += 3600_000;
  assert.equal((await svc.get(20, 20)).status, 502); // nová hodina, ale upstream padá a cache nie je
});

test('pás: krivka teploty, desatinná čiarka, poloha nad časovou osou', () => {
  assert.equal(temperaturePath([10, null]), '');
  const d = temperaturePath([10, 20], 40, 34);
  assert.equal(d, 'M20.0,30.0L60.0,4.0');
  assert.equal(cellText(0.25, 1, 'sk'), '0,3');
  assert.equal(cellText(0.25, 1, 'en'), '0.3');
  assert.equal(cellText(-0.2), '0');
  assert.equal(cellText(null), '–');
  assert.equal(bottomAboveAnchor({ top: 650, height: 77 }, 860), 218);
  assert.equal(bottomAboveAnchor({ top: 0, height: 0 }, 860), null);
});
