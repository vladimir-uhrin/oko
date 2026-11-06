import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  slovakiaPointsFromObce, slovakiaReach, quakeAlertCandidates, quakePushPayload, solutionIds,
  QUAKE_ALERT_MIN_MAG, QUAKE_ALERT_MAX_AGE_MS,
} from './quakeAlert.js';

const POINTS = slovakiaPointsFromObce(JSON.parse(readFileSync(new URL('./local_data/volby/obce-geo.json', import.meta.url), 'utf8')));
const NOW = Date.parse('2026-11-06T12:00:00Z');
const quake = (id, mag, lat, lon, minutesAgo = 5, place = id) => ({ id, mag, lat, lon, time: NOW - minutesAgo * 60_000, place,
  solutions: [{ id, source: id.split(':')[0] }] });

test('the bundled municipalities cover Slovakia (2 900+ points inside the national bbox)', () => {
  assert.ok(POINTS.length > 2900, String(POINTS.length));
  assert.deepEqual(slovakiaPointsFromObce({ rows: [['x', 10, 10, 'obec'], ['y', 'a', 18, 'obec'], ['z', 48.1, 17.1, 'obec']] }), [[48.1, 17.1]]);
});

test('reach: a small quake inside Slovakia, a M4.5 near Budapest and a M5 in Vienna basin are felt; Japan and Rome are not', () => {
  assert.equal(slovakiaReach(quake('EMSC:sk', 3.1, 48.73, 19.15), POINTS).felt, true, 'Banská Bystrica M3.1');
  assert.equal(slovakiaReach(quake('USGS:hu', 4.5, 47.5, 19.04), POINTS).felt, true, 'Budapest M4.5 (~45 km to Štúrovo)');
  assert.equal(slovakiaReach(quake('EMSC:at', 4.2, 47.9, 16.3), POINTS).felt, true, 'Vienna basin M4.2');
  assert.equal(slovakiaReach(quake('USGS:jp', 7.5, 35, 142), POINTS).felt, false);
  assert.equal(slovakiaReach(quake('EMSC:it', 5.5, 41.9, 12.5), POINTS).felt, false, 'Rome M5.5 (~150 km reach)');
  const r = slovakiaReach(quake('USGS:hu', 4.5, 47.5, 19.04), POINTS);
  assert.equal(r.city.name, 'Nitry'); assert.ok(r.city.km > 100 && r.city.km < 130, String(r.city.km));
  assert.equal(slovakiaReach(null, POINTS), null);
});

test('candidates: M3+, at most 2 h old, felt in Slovakia, each event (any of its solutions) only once, oldest first', () => {
  const events = [
    quake('EMSC:new', 3.4, 48.5, 18.9, 3), quake('EMSC:older', 4.6, 47.6, 19.0, 50),
    quake('EMSC:weak', 2.8, 48.5, 18.9, 3), quake('EMSC:old', 4.6, 48.5, 18.9, 3 * 60),
    { ...quake('USGS:pair', 4.0, 48.4, 17.9, 10), solutions: [{ id: 'USGS:pair' }, { id: 'EMSC:pair' }] },
    quake('USGS:far', 6.0, 10, 100, 3),
  ];
  const picked = quakeAlertCandidates(events, { points: POINTS, now: NOW, notified: new Set(['EMSC:pair']) });
  assert.deepEqual(picked.map(p => p.event.id), ['EMSC:older', 'EMSC:new']);
  assert.equal(QUAKE_ALERT_MIN_MAG, 3); assert.equal(QUAKE_ALERT_MAX_AGE_MS, 7_200_000);
  assert.deepEqual(solutionIds({ id: 'x', solutions: [] }), ['x']);
});

test('push text: magnitude with a decimal comma, age, distance from the nearest regional city, honest estimate, deep link', () => {
  const event = quake('USGS:us7000abcd', 4.6, 47.5, 19.04, 6, '3 km N of Budapest, Hungary');
  const payload = quakePushPayload(event, slovakiaReach(event, POINTS), NOW);
  assert.equal(payload.title, 'Zemetrasenie M4,6 · 3 km N of Budapest, Hungary');
  assert.match(payload.body, /^pred 6 min · \d+ km od Nitry · otrasy môžu byť citeľné aj na Slovensku \(odhad OKO z magnitúdy\)$/);
  assert.equal(payload.url, '/?quake=USGS%3Aus7000abcd'); assert.equal(payload.tag, 'quake:USGS:us7000abcd');
});
