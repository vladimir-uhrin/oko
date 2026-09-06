import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEarthquakeFeed, mergeEarthquakeCatalogs, earthquakeSolutionsMatch } from './earthquakeCatalog.js';

const time = Date.parse('2026-09-05T12:00:00Z');
const feature = (id = 'one', extra = {}) => ({ id, geometry: { coordinates: [18, 48, 12] }, properties: { mag: 3.2, time, place: 'Test', ...extra } });
const normalized = (source, id, extra = {}) => normalizeEarthquakeFeed({ features: [feature(id, extra)] }, source).records[0];

test('EMSC ISO time and negative GeoJSON Z become positive depth, without borrowing USGS convention', () => {
  const f = feature('emsc', { time: new Date(time).toISOString(), lastupdate: new Date(time + 1000).toISOString(), magtype: 'ml', flynn_region: 'SLOVAKIA' });
  f.geometry.coordinates[2] = -12;
  delete f.properties.place;
  const e = normalizeEarthquakeFeed({ features: [f] }, 'EMSC').records[0];
  assert.equal(e.depth, 12); assert.equal(e.time, time); assert.equal(e.updated, time + 1000);
  assert.equal(e.magType, 'ml'); assert.equal(e.place, 'SLOVAKIA');
  assert.equal(e.id, 'EMSC:emsc');
});

test('invalid individual features are skipped; missing magnitude is not zero; invalid batch fails', () => {
  const invalid = [null, { geometry: null }, feature('null-mag', { mag: null }), feature('bad-time', { time: 'bad' })];
  const result = normalizeEarthquakeFeed({ features: [feature(), ...invalid] }, 'USGS');
  assert.equal(result.records.length, 1); assert.equal(result.rejected, 4);
  assert.throws(() => normalizeEarthquakeFeed({ features: invalid }, 'USGS'));
  assert.throws(() => normalizeEarthquakeFeed({}, 'USGS'));
  assert.deepEqual(normalizeEarthquakeFeed({ features: [] }, 'EMSC').records, []);
});

test('same-source revisions replace by id; magnitudes from different sources are never averaged', () => {
  const data = normalizeEarthquakeFeed({ features: [feature('a', { updated: time + 1 }), feature('a', { mag: 3.4, updated: time + 2 })] }, 'USGS');
  assert.equal(data.records.length, 1); assert.equal(data.records[0].mag, 3.4);
  const emsc = normalized('EMSC', 'b', { mag: 3.8, depth: 12 });
  const result = mergeEarthquakeCatalogs([...data.records, emsc]);
  assert.equal(result.length, 1); assert.equal(result[0].mag, 3.4);
  assert.equal(result[0].association, 'probable');
  assert.deepEqual(result[0].solutions.map(s => s.mag), [3.4, 3.8]);
});

test('ambiguity stays separate and no transitive aftershock merging occurs', () => {
  const u = normalized('USGS', 'u'); const e1 = normalized('EMSC', 'e1', { depth: 12 });
  const e2 = normalized('EMSC', 'e2', { time: time + 1000, depth: 12 });
  assert.equal(mergeEarthquakeCatalogs([u, e1, e2]).length, 3);
  assert.equal(mergeEarthquakeCatalogs([u, { ...u, id: 'USGS:u2' }, e1]).length, 3);
  assert.equal(earthquakeSolutionsMatch(u, { ...e1, time: time + 21000 }), false);
  assert.equal(earthquakeSolutionsMatch(u, { ...e1, lat: 49 }), false);
});

test('matching works across dateline, preserves selected identity when a second catalog arrives, and prefers current data', () => {
  const u = { ...normalized('USGS', 'u'), lon: 179.95 };
  const e = { ...normalized('EMSC', 'e', { depth: 12 }), lon: -179.95 };
  assert.equal(earthquakeSolutionsMatch(u, e), true);
  const previous = mergeEarthquakeCatalogs([e]);
  const merged = mergeEarthquakeCatalogs([u, e], previous);
  assert.equal(merged[0].id, previous[0].id);
  assert.equal(mergeEarthquakeCatalogs([{ ...u, stale: true }, e])[0].source, 'EMSC');
  assert.deepEqual(mergeEarthquakeCatalogs([e, u]), mergeEarthquakeCatalogs([u, e]));
});
