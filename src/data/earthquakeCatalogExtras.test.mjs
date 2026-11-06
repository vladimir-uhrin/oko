// Obdobia, „Významné", dopady USGS pri spájaní, odhad dosahu bez Cesia (2026-11-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EARTHQUAKE_PERIODS, earthquakePeriod, isSignificantEarthquake, mergeEarthquakeCatalogs, normalizeEarthquakeFeed,
  earthquakeFeltRadiusM, EARTHQUAKE_FELT_MIN_MAG,
} from './earthquakeCatalog.js';

const time = Date.parse('2026-09-05T12:00:00Z');
const feature = (id = 'one', extra = {}) => ({ id, geometry: { coordinates: [18, 48, 12] }, properties: { mag: 3.2, time, place: 'Test', ...extra } });
const normalized = (source, id, extra = {}) => normalizeEarthquakeFeed({ features: [feature(id, extra)] }, source).records[0];

test('periods: 24 h / 7 days / 30 days with the catalog magnitude floor; unknown falls back to 24 h', () => {
  assert.deepEqual(Object.keys(EARTHQUAKE_PERIODS), ['day', 'week', 'month']);
  assert.equal(earthquakePeriod('week').ms, 7 * 86_400_000); assert.equal(earthquakePeriod('week').floor, 2.5);
  assert.equal(earthquakePeriod('month').usgsFeed, '4.5_month'); assert.equal(earthquakePeriod('month').floor, 4.5);
  assert.equal(earthquakePeriod('nonsense').id, 'day'); assert.equal(earthquakePeriod(undefined).floor, -3);
});

test('significant filter: M6+, PAGER yellow+, ocean flag or USGS sig >= 600; a green M5 is not', () => {
  assert.equal(isSignificantEarthquake({ mag: 6.1, alert: 'green' }), true);
  assert.equal(isSignificantEarthquake({ mag: 5.2, alert: 'yellow' }), true);
  assert.equal(isSignificantEarthquake({ mag: 5.2, tsunami: true }), true);
  assert.equal(isSignificantEarthquake({ mag: 4.9, sig: 640 }), true);
  assert.equal(isSignificantEarthquake({ mag: 5.4, alert: 'green', sig: 449 }), false);
  assert.equal(isSignificantEarthquake(null), false);
});

test('USGS impact fields survive association even when the EMSC solution is displayed', () => {
  const u = { ...normalized('USGS', 'u', { alert: 'yellow', felt: 12, sig: 700, types: ',shakemap,' }), stale: true };
  const e = normalized('EMSC', 'e', { depth: 12 });
  const [merged] = mergeEarthquakeCatalogs([u, e]);
  assert.equal(merged.source, 'EMSC', 'fresh EMSC outranks cached USGS for display');
  assert.equal(merged.alert, 'yellow'); assert.equal(merged.felt, 12); assert.equal(merged.sig, 700); assert.equal(merged.hasShakemap, true);
  const [emscOnly] = mergeEarthquakeCatalogs([e]);
  assert.equal(emscOnly.alert, null); assert.equal(emscOnly.hasShakemap, false);
});

test('felt-reach estimate lives in the Cesium-free catalog (server watcher) and matches the pulse re-export', async () => {
  assert.equal(Math.round(earthquakeFeltRadiusM(4.5) / 1000), 105);
  assert.equal(EARTHQUAKE_FELT_MIN_MAG, 4.5);
  const pulse = await import('./earthquakePulse.js');
  assert.equal(pulse.earthquakeFeltRadiusM, earthquakeFeltRadiusM);
});
