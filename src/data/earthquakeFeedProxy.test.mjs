import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEarthquakeFeedCache, earthquakeFeedUrl, EARTHQUAKE_CACHE_MS } from './earthquakeFeedProxy.js';
import { EARTHQUAKE_DAY_MS } from './earthquakeCatalog.js';

const time = Date.parse('2026-09-05T12:00:00Z');
const payload = { features: [{ id: 'u', geometry: { coordinates: [18, 48, 12] }, properties: { mag: 4, time } }] };

test('fixed source URL is global and bounded to one day, with no caller-controlled upstream', () => {
  const url = new URL(earthquakeFeedUrl('EMSC', time));
  assert.equal(Date.parse(url.searchParams.get('endtime')) - Date.parse(url.searchParams.get('starttime')), EARTHQUAKE_DAY_MS);
  assert.equal(url.searchParams.get('limit'), '20000');
  assert.equal(url.searchParams.has('minlatitude'), false);
  assert.throws(() => earthquakeFeedUrl('https://evil.example'));
});

test('concurrent requests share one fetch; cache and failure backoff retain honest last-good data', async () => {
  let clock = time; let calls = 0; let fail = false;
  const get = createEarthquakeFeedCache({ now: () => clock, fetchImpl: async () => {
    calls++; if (fail) throw new Error('offline');
    return new Response(JSON.stringify(payload), { status: 200 });
  } });
  const results = await Promise.all([get('USGS'), get('USGS'), get('USGS')]);
  assert.equal(calls, 1); assert.equal(results[0].records.length, 1);
  await get('USGS'); assert.equal(calls, 1);
  fail = true; clock += EARTHQUAKE_CACHE_MS;
  const stale = await get('USGS'); assert.equal(stale.stale, true); assert.equal(stale.records.length, 1);
  assert.equal(stale.fetchedAt, time); assert.equal(stale.error, 'offline');
  await get('USGS'); assert.equal(calls, 2);
  clock += EARTHQUAKE_DAY_MS; assert.equal((await get('USGS')).records.length, 0);
});

test('empty FDSN 204 is valid; corrupted and oversized responses cannot replace a good snapshot', async () => {
  let clock = time; let mode = 'valid';
  const get = createEarthquakeFeedCache({ now: () => clock, fetchImpl: async () => {
    if (mode === 'empty') return new Response(null, { status: 204 });
    if (mode === 'oversized') return new Response('{}', { headers: { 'content-length': '999999999' } });
    return new Response(JSON.stringify(mode === 'bad' ? { features: [null] } : payload));
  } });
  await get('USGS');
  for (mode of ['bad', 'oversized']) {
    clock += EARTHQUAKE_CACHE_MS;
    const result = await get('USGS'); assert.equal(result.stale, true); assert.equal(result.records.length, 1);
  }
  mode = 'empty'; clock += EARTHQUAKE_CACHE_MS;
  const result = await get('USGS'); assert.equal(result.stale, false); assert.deepEqual(result.records, []);
});
