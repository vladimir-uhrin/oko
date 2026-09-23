// src/data/ukraineDirectionTrend.test.mjs — karta smeru (B5): rozsah dní,
// rad po dňoch (diera ≠ nula ≠ nespomenutý), čiastkové popoludňajšie hlásenie
// mimo priemerov, smer trendu, najčastejšie sídla a sklad odsekov smerov.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACES_DAYS, TREND_DAYS, directionSeries, directionTopPlaces, isPartialReport, reportRefDay, trendRange, trendStats,
} from './ukraineDirectionTrend.js';
import { buildPlaceIndex } from './ukraineReportPlaces.js';
import { createUkraineEventStore, fetchUkraineDirections } from './ukraineEventsClient.js';

const SCENES = {
  lyman: { id: 'lyman', center: { lat: 49.0, lon: 37.85 }, gs: ['Лиманський'] },
  sumy: { id: 'sumy', center: { lat: 51.0, lon: 34.85 }, gs: ['Північно-Слобожанський', 'Курський'] },
  front: { id: 'front', overview: true, gs: [] },
};
const sceneFor = (gs) => Object.values(SCENES).find((s) => s.gs.includes(gs)) || null;
const rep = (dirs, { total = 200, text = '08:00 22.9.' } = {}) => ({ total, reportedAtText: text, directions: dirs });
const lyman = (attacks, text = 'На Лиманському напрямку бої.') => ({ gs: 'Лиманський', attacks, text, shared: false });

test('rozsah dní a deň hlásenia', () => {
  assert.equal(TREND_DAYS, 30);
  assert.deepEqual(trendRange('2026-09-23'), { from: '2026-08-25', to: '2026-09-23' });
  assert.deepEqual(trendRange('2026-03-01', 3), { from: '2026-02-27', to: '2026-03-01' });
  assert.equal(trendRange('zle'), null);
  assert.equal(reportRefDay({ reportedAt: '2026-09-22T05:00:00.000Z' }), '2026-09-22');
  assert.equal(reportRefDay(null, Date.UTC(2026, 8, 23, 12)), '2026-09-23', 'bez hlásenia dnešok');
});

test('čiastkové hlásenie = popoludňajšia značka; bez hodiny ranné', () => {
  assert.equal(isPartialReport({ reportedAtText: '16:00 31.7.' }), true);
  assert.equal(isPartialReport({ reportedAtText: '08:00 22.9.' }), false);
  assert.equal(isPartialReport({ reportedAtText: '8:00 1.9.' }), false);
  assert.equal(isPartialReport({ reportedAtText: '11.9.' }), false, 'posunutá značka nesie len dátum');
  assert.equal(isPartialReport(null), false);
});

test('rad: chýbajúce hlásenie je diera, nespomenutý smer nie je nula, dva GŠ smery presetu sa sčítajú', () => {
  const days = {
    '2026-09-20': rep([lyman(5)]),
    '2026-09-21': rep([{ gs: 'Слов\'янський', attacks: 3, text: 'x', shared: false }]),
    // 22. chýba
    '2026-09-23': rep([lyman(null)]),
  };
  const s = directionSeries(days, SCENES.lyman, sceneFor, { from: '2026-09-20', to: '2026-09-23' });
  assert.deepEqual(s.map((p) => [p.day, p.attacks, p.missing, p.unmentioned, p.unknown]), [
    ['2026-09-20', 5, false, false, false],
    ['2026-09-21', null, false, true, false],
    ['2026-09-22', null, true, false, false],
    ['2026-09-23', null, false, false, true],
  ]);
  const sumy = directionSeries({ '2026-09-20': rep([
    { gs: 'Північно-Слобожанський', attacks: 3, text: 'a', shared: false },
    { gs: 'Курський', attacks: 2, text: 'b', shared: false },
  ]) }, SCENES.sumy, sceneFor, { from: '2026-09-20', to: '2026-09-20' });
  assert.equal(sumy[0].attacks, 5);
  const front = directionSeries({ '2026-09-20': rep([], { total: 221 }), '2026-09-21': rep([], { total: null }) }, SCENES.front, sceneFor, { from: '2026-09-20', to: '2026-09-21' });
  assert.deepEqual(front.map((p) => [p.attacks, p.unknown]), [[221, false], [null, true]], 'prehľad berie súčet frontu');
  assert.deepEqual(directionSeries({}, null, sceneFor, { from: '2026-09-20', to: '2026-09-21' }), []);
  assert.deepEqual(directionSeries({}, SCENES.lyman, sceneFor, { from: '2026-09-21', to: '2026-09-20' }), []);
});

test('štatistika: trend, čiastkové hlásenie mimo priemerov, príliš málo dní = bez trendu', () => {
  const mk = (values, partialAt = -1) => values.map((v, i) => ({ day: `d${i}`, attacks: v, missing: v === undefined, unmentioned: false, unknown: v === null, partial: i === partialAt }));
  const rising = trendStats(mk([...Array(23).fill(10), ...Array(7).fill(20)]));
  assert.equal(rising.trend, 'up');
  assert.equal(rising.avgRecent, 20);
  assert.equal(rising.avgEarlier, 10);
  assert.equal(rising.max, 20);
  assert.equal(rising.today, 20);
  assert.equal(trendStats(mk([...Array(23).fill(30), ...Array(7).fill(20)])).trend, 'down');
  assert.equal(trendStats(mk([...Array(23).fill(10), ...Array(7).fill(11)])).trend, 'flat', 'rozdiel pod 1,5 útoku/deň');
  assert.equal(trendStats(mk([...Array(23).fill(1), ...Array(7).fill(2)])).trend, 'flat', 'malé čísla: +100 % je stále len +1 útok');
  assert.equal(trendStats(mk([...Array(23).fill(undefined), ...Array(7).fill(5)])).trend, null, 'bez starších dní niet s čím porovnať');
  const partial = trendStats(mk([...Array(23).fill(10), 10, 10, 10, 10, 10, 10, 2], 29));
  assert.equal(partial.avgRecent, 10, 'popoludňajšie 2 nestiahne priemer');
  assert.equal(partial.today, 2);
  assert.equal(partial.todayPartial, true);
  const gap = trendStats([{ day: 'x', attacks: null, missing: true }]);
  assert.equal(gap.todayMissing, true);
  assert.equal(gap.today, null);
  assert.equal(gap.avgRecent, null);
  assert.equal(trendStats([]).refDay, null);
});

test('najčastejšie sídla: počet DNÍ zmienky, bližšie k smeru, nie prehľad', () => {
  const index = buildPlaceIndex([
    { properties: { name: 'Ставки', cls: 'village' }, geometry: { coordinates: [37.9, 49.05] } },
    { properties: { name: 'Торське', cls: 'village' }, geometry: { coordinates: [37.95, 48.95] } },
    { properties: { name: 'Торське', cls: 'village' }, geometry: { coordinates: [30.0, 50.0] } },
  ]);
  const days = {};
  for (let d = 10; d <= 23; d += 1) days[`2026-09-${String(d).padStart(2, '0')}`] = rep([lyman(4, 'На Лиманському напрямку ворог атакував у районі Ставків.')]);
  days['2026-09-22'] = rep([lyman(3, 'На Лиманському напрямку ворог атакував у районах Ставків та Торського.')]);
  days['2026-09-01'] = rep([lyman(3, 'На Лиманському напрямку ворог атакував у районі Торського.')]); // mimo 14 dní
  const top = directionTopPlaces(days, SCENES.lyman, sceneFor, index, { from: '2026-08-25', to: '2026-09-23' });
  assert.equal(PLACES_DAYS, 14);
  assert.deepEqual(top.map((p) => [p.name, p.days]), [['Ставки', 14], ['Торське', 1]]);
  assert.equal(top[1].lon, 37.95, 'rovnaké meno ďaleko od smeru sa nevyberie');
  assert.equal(top[1].lastDay, '2026-09-22');
  assert.deepEqual(directionTopPlaces(days, SCENES.front, sceneFor, index, { to: '2026-09-23' }), [], 'celý front sídla nekreslí');
  assert.deepEqual(directionTopPlaces(days, SCENES.lyman, sceneFor, new Map(), { to: '2026-09-23' }), []);
});

test('sklad: odseky smerov z proxy, súbežné žiadosti zdieľajú dopyt, cache 10 min, chyba sa necachuje', async () => {
  const urls = [];
  const payload = { from: '2026-08-25', to: '2026-09-23', days: {} };
  const fetcher = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => payload }; };
  assert.equal(await fetchUkraineDirections('2026-08-25', '2026-09-23', { fetcher, base: '/api/ukraine/events' }), payload);
  assert.equal(urls[0], '/api/ukraine/events/directions?from=2026-08-25&to=2026-09-23');
  await assert.rejects(fetchUkraineDirections('a', 'b', { fetcher: async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad_day' }) }) }), /bad_day/);

  let t = 0; let calls = 0; let fail = true;
  const store = createUkraineEventStore({
    now: () => t,
    fetchDirections: async () => { calls += 1; if (fail) { fail = false; throw new Error('boom'); } return payload; },
  });
  await assert.rejects(store.directions('2026-08-25', '2026-09-23'), /boom/);
  const [a, b] = await Promise.all([store.directions('2026-08-25', '2026-09-23'), store.directions('2026-08-25', '2026-09-23')]);
  assert.equal(a, payload); assert.equal(b, payload);
  assert.equal(calls, 2, 'chyba + jeden spoločný dopyt');
  t = 9 * 60_000; await store.directions('2026-08-25', '2026-09-23');
  assert.equal(calls, 2, 'v cache');
  t = 11 * 60_000; await store.directions('2026-08-25', '2026-09-23');
  assert.equal(calls, 3, 'po 10 min znova');
});
