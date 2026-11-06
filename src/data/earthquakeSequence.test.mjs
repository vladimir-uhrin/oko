import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkEarthquakeSequences, aftershockRadiusKm, formatElapsed } from './earthquakeSequence.js';

const T0 = Date.parse('2026-11-06T10:39:27Z');
const q = (id, mag, lat, lon, minutesAfter, place = null) => ({ id, mag, lat, lon, time: T0 + minutesAfter * 60_000, place });

test('aftershock radius doubles per magnitude step with floor and cap', () => {
  assert.equal(aftershockRadiusKm(5), 50); assert.equal(aftershockRadiusKm(6), 100); assert.equal(aftershockRadiusKm(7), 200);
  assert.equal(aftershockRadiusKm(2), 30); assert.equal(aftershockRadiusKm(9.5), 600); assert.equal(aftershockRadiusKm(NaN), 30);
});

test('later weaker events near a M5+ mainshock become its aftershocks; the mainshock counts them', () => {
  const main = q('USGS:main', 6.1, 34.97, 142.12, 0, '144 km SE of Hasaki, Japan');
  const links = linkEarthquakeSequences([
    q('USGS:a1', 4.8, 35.1, 142.0, 134), q('USGS:a2', 4.2, 34.9, 142.3, 20), main,
    q('USGS:far', 4.5, 36.5, 139.0, 60),          // 300 km — mimo polomeru M6,1 (100 km)
    q('USGS:before', 4.0, 34.97, 142.12, -30),    // pred hlavným otrasom — nie dotras
    q('EMSC:other', 5.4, -20, -70, 10, 'Chile'),  // iný hlavný otras bez dotrasov
  ]);
  assert.deepEqual(links.get('USGS:main'), { role: 'mainshock', aftershocks: 2, strongest: { id: 'USGS:a1', mag: 4.8 } });
  const a1 = links.get('USGS:a1');
  assert.equal(a1.role, 'aftershock'); assert.equal(a1.mainshockId, 'USGS:main'); assert.equal(a1.mainshockMag, 6.1);
  assert.equal(a1.mainshockPlace, '144 km SE of Hasaki, Japan'); assert.equal(a1.deltaMs, 134 * 60_000);
  assert.ok(a1.distanceKm > 10 && a1.distanceKm < 25);
  assert.equal(links.get('USGS:a2').role, 'aftershock');
  assert.equal(links.has('USGS:far'), false); assert.equal(links.has('USGS:before'), false);
  assert.equal(links.has('EMSC:other'), false, 'a mainshock without aftershocks gets no line');
});

test('a weaker M5+ inside a bigger mainshock is its aftershock, not a mainshock of its own', () => {
  const links = linkEarthquakeSequences([
    q('big', 7.0, 0, 0, 0), q('mid', 5.5, 0.3, 0.3, 30), q('small', 3.5, 0.35, 0.35, 45),
  ]);
  assert.equal(links.get('mid').role, 'aftershock'); assert.equal(links.get('mid').mainshockId, 'big');
  assert.equal(links.get('small').mainshockId, 'big', 'the biggest accepted mainshock wins');
  assert.equal(links.get('big').aftershocks, 2);
});

test('sequence linking is deterministic and ignores malformed events', () => {
  const list = [q('b', 5.0, 10, 10, 0), q('a', 4.0, 10.1, 10.1, 5), { id: 'bad', mag: 'x' }, null];
  const first = linkEarthquakeSequences(list); const second = linkEarthquakeSequences(list.slice().reverse());
  assert.deepEqual([...first.entries()], [...second.entries()]);
  assert.deepEqual(linkEarthquakeSequences(undefined).size, 0);
});

test('elapsed time formats compactly', () => {
  assert.equal(formatElapsed(12_000), '12 s'); assert.equal(formatElapsed(37 * 60_000), '37 min');
  assert.equal(formatElapsed(134 * 60_000), '2 h 14 min'); assert.equal(formatElapsed(3 * 3_600_000), '3 h');
  assert.equal(formatElapsed(30 * 3_600_000), '1 d 6 h'); assert.equal(formatElapsed(-5), '0 s'); assert.equal(formatElapsed(NaN), '0 s');
});
