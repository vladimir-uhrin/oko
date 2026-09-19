// src/data/ukraineDeepState.test.mjs — DeepState snímka: názvy s trojitou lomkou,
// druhy (jednotky a cudzie územia preč), plochy, čistenie kruhov, pečiatka.
import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanRings, deepstateKind, deepstateSnapshotFromApi, deepstateStampText, descriptionEn, parseDeepStateName, polygonAreaKm2, ringAreaKm2 } from './ukraineDeepState.js';

test('názvy a druhy', () => {
  assert.deepEqual(parseDeepStateName('Окуповано /// Occupied /// geoJSON.status.occupied\n'), { uk: 'Окуповано', en: 'Occupied', group: 'status', key: 'occupied' });
  assert.deepEqual(parseDeepStateName('Статус невідомий /// Unknown status /// geoJSON.status.unknown'), { uk: 'Статус невідомий', en: 'Unknown status', group: 'status', key: 'unknown' });
  assert.deepEqual(parseDeepStateName('Аеродром Сакі /// Saki airfield /// geoJSON.airfield.saki'), { uk: 'Аеродром Сакі', en: 'Saki airfield', group: 'airfield', key: 'saki' });
  assert.deepEqual(parseDeepStateName('bez značky'), { uk: 'bez značky', en: null, group: null, key: null });
  assert.equal(deepstateKind('status', 'occupied', 'Polygon'), 'occupied');
  assert.equal(deepstateKind('status', 'unknown', 'Polygon'), 'grey');
  assert.equal(deepstateKind('status', 'dismissed', 'Polygon'), 'liberated');
  assert.equal(deepstateKind('status', 'dismissed_at', 'Polygon'), 'liberated-recent');
  assert.equal(deepstateKind('status', 'attack_direction', 'Point'), 'attack');
  assert.equal(deepstateKind('status', 'attack_direction', 'Polygon'), null);
  assert.equal(deepstateKind('territories', 'crimea', 'Polygon'), 'crimea');
  assert.equal(deepstateKind('territories', 'ordlo', 'Polygon'), 'ordlo');
  assert.equal(deepstateKind('territories', 'abkhazia', 'Polygon'), null, 'cudzie konflikty preč');
  assert.equal(deepstateKind('territories', 'prussia', 'Polygon'), null);
  assert.equal(deepstateKind('territories', 'kyiv', 'Point'), null);
  assert.equal(deepstateKind('units', 'brigade', 'Point'), null, 'jednotky nikdy');
  assert.equal(deepstateKind('airbase', 'taganrog', 'Point'), 'airfield');
  assert.equal(deepstateKind(null, null, 'Point'), null);
});

test('plochy, kruhy, popis, pečiatka', () => {
  // ~1° × 1° pri 48° š.: 111 km × 74 km ≈ 8 260 km²
  const ring = [[37, 48], [38, 48], [38, 49], [37, 49], [37, 48]];
  const a = ringAreaKm2(ring);
  assert.ok(a > 7900 && a < 8600, String(a));
  const hole = [[37.4, 48.4], [37.6, 48.4], [37.6, 48.6], [37.4, 48.6], [37.4, 48.4]];
  assert.ok(polygonAreaKm2([ring, hole]) < a && polygonAreaKm2([ring, hole]) > a * 0.9);
  assert.equal(ringAreaKm2([[1, 1]]), 0);
  assert.deepEqual(cleanRings([[[37.123456789, 48.1, 0], [37.2, 48.2, 0], [37.3, 48.1, 0], [37.123456789, 48.1, 0]], [[1, 1], [2, 2]]]), [[[37.12346, 48.1], [37.2, 48.2], [37.3, 48.1], [37.12346, 48.1]]]);
  assert.equal(descriptionEn('Окупована в 1992.<br>///<br>Occupied in 1992 by 14-th Army.<br>/// geoJSON.descriptions.#35'), 'Occupied in 1992 by 14-th Army.');
  assert.equal(descriptionEn(''), null);
  assert.equal(deepstateStampText({ at: '2026-09-18T19:25:38.000Z' }), '18.9.2026 19:25 UTC');
  assert.equal(deepstateStampText(null), '');
});

test('snímka z API: filtre, počty, plochy, deň z id', () => {
  const api = {
    id: 1789759538, datetime: '18.09 o 21:25',
    map: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Окуповано /// Occupied /// geoJSON.status.occupied' }, geometry: { type: 'Polygon', coordinates: [[[37, 48, 0], [38, 48, 0], [38, 49, 0], [37, 49, 0], [37, 48, 0]]] } },
      { type: 'Feature', properties: { name: 'Статус невідомий /// Unknown status /// geoJSON.status.unknown' }, geometry: { type: 'MultiPolygon', coordinates: [[[[36, 48, 0], [36.5, 48, 0], [36.5, 48.5, 0], [36, 48, 0]]], [[[35, 47, 0], [35.5, 47, 0], [35.5, 47.5, 0], [35, 47, 0]]]] } },
      { type: 'Feature', properties: { name: 'Напрямок удару /// Direction of attack /// geoJSON.status.attack_direction' }, geometry: { type: 'Point', coordinates: [36.8, 48.06, 0] } },
      { type: 'Feature', properties: { name: '38-ма бригада /// 38th Brigade /// geoJSON.units.brigade' }, geometry: { type: 'Point', coordinates: [36.9, 48.1, 0] } },
      { type: 'Feature', properties: { name: 'Окупована Абхазія /// Occupied Abkhazia /// geoJSON.territories.abkhazia' }, geometry: { type: 'Polygon', coordinates: [[[40, 43, 0], [41, 43, 0], [41, 44, 0], [40, 43, 0]]] } },
      { type: 'Feature', properties: { name: 'Аеродром Сакі /// Saki airfield /// geoJSON.airfield.saki' }, geometry: { type: 'Point', coordinates: [33.598, 45.094, 0] } },
      { type: 'Feature', properties: { name: 'x' }, geometry: { type: 'Point', coordinates: [1, 1, 0] } },
    ] },
  };
  const s = deepstateSnapshotFromApi(api);
  assert.equal(s.id, 1789759538);
  assert.equal(s.at, '2026-09-18T19:25:38.000Z');
  assert.equal(s.day, '2026-09-18');
  assert.deepEqual(s.counts, { occupied: 1, grey: 2, attack: 1, airfield: 1 });
  assert.equal(s.features.length, 5);
  assert.ok(s.areaKm2.occupied > 7900 && s.areaKm2.occupied < 8600);
  assert.ok(s.areaKm2.grey > 0);
  assert.equal(s.features.find((f) => f.kind === 'attack').lat, 48.06);
  assert.ok(!s.features.some((f) => /brigade|abkhazia/.test(f.key || '')));
  assert.equal(deepstateSnapshotFromApi({}).day, null);
});
