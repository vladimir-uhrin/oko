// Server zemetrasení: obdobia katalógu a mapa otrasov ShakeMap (2026-11-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createEarthquakeFeedCache, earthquakeFeedUrl, createShakemapCache, validShakemapId, applyShakemapAlpha, shakemapPublicMeta,
  earthquakeFeedProxy,
} from './earthquakeFeedProxy.js';
import { EARTHQUAKE_DAY_MS } from './earthquakeCatalog.js';

const time = Date.parse('2026-09-05T12:00:00Z');

test('period URLs: USGS summary feeds, EMSC window and magnitude floor; 24 h keeps the old URL', () => {
  assert.equal(earthquakeFeedUrl('USGS', time), 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
  assert.equal(earthquakeFeedUrl('USGS', time, 'week'), 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson');
  assert.equal(earthquakeFeedUrl('USGS', time, 'month'), 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson');
  assert.equal(new URL(earthquakeFeedUrl('EMSC', time)).searchParams.has('minmagnitude'), false);
  const month = new URL(earthquakeFeedUrl('EMSC', time, 'month'));
  assert.equal(Date.parse(month.searchParams.get('endtime')) - Date.parse(month.searchParams.get('starttime')), 30 * EARTHQUAKE_DAY_MS);
  assert.equal(month.searchParams.get('minmagnitude'), '4.5');
});

test('each period has its own cache entry and keeps records of its whole window', async () => {
  const urls = [];
  const old = { features: [{ id: 'w', geometry: { coordinates: [18, 48, 12] }, properties: { mag: 5, time: time - 3 * EARTHQUAKE_DAY_MS } }] };
  const get = createEarthquakeFeedCache({ now: () => time, fetchImpl: async (url) => { urls.push(url); return new Response(JSON.stringify(old)); } });
  assert.equal((await get('USGS')).records.length, 0, 'a 3-day-old event is outside 24 h');
  const week = await get('USGS', 'week');
  assert.equal(week.records.length, 1); assert.equal(week.period, 'week');
  assert.equal(urls.length, 2); assert.match(urls[1], /2\.5_week/);
});

test('ShakeMap: id guard, alpha for weak shaking, public metadata without disk paths', () => {
  assert.equal(validShakemapId('us7000twg9'), true);
  for (const bad of ['../etc', 'US7000', 'a', 'us7000twg9.png', null]) assert.equal(validShakemapId(bad), false, String(bad));
  const px = Uint8Array.from([255, 255, 255, 255, 250, 200, 20, 255, 0, 0, 0, 0]);
  applyShakemapAlpha(px);
  assert.deepEqual([px[3], px[7], px[11]], [0, 190, 0], 'white (I–III) and originally transparent stay transparent');
  const meta = shakemapPublicMeta({ id: 'us1abc', version: '17', bbox: [1, 2, 3, 4], mmi: 7.2, file: 'C:/secret/path.png' });
  assert.deepEqual(meta, { id: 'us1abc', version: '17', bbox: [1, 2, 3, 4], mmi: 7.2, image: '/api/earthquakes/shakemap/us1abc.png?v=17' });
  assert.equal(shakemapPublicMeta(null), null);
});

function fakeUsgs(calls) {
  const detail = { properties: { mmi: 6.4, products: { shakemap: [{ updateTime: 1793996910732, contents: {
    'download/intensity_overlay.png': { url: 'https://usgs.example/overlay.png' }, 'download/intensity_overlay.pngw': { url: 'https://usgs.example/overlay.pngw' } } }] } } };
  return async (url) => {
    calls.push(url);
    if (url.includes('/detail/us1abc')) return new Response(JSON.stringify(detail));
    if (url.includes('/detail/')) return new Response(JSON.stringify({ properties: { products: {} } }));
    if (url.endsWith('.pngw')) return new Response('0.01\n0\n0\n-0.01\n140.005\n36.995\n');
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
  };
}
// sharp podvrh: obrázok 200×100 (pixely z bufferu), výstup PNG = surové bajty po úprave alfy
const loadSharp = async () => (input, options) => ({
  ensureAlpha: () => ({ raw: () => ({ toBuffer: async () => ({ data: Buffer.from([255, 255, 255, 255, 250, 150, 20, 255]), info: { width: 200, height: 100 } }) }) }),
  png: () => ({ toBuffer: async () => Buffer.from(options?.raw ? input : []) }),
});

test('ShakeMap cache: one USGS build per version kept on disk; a quake without ShakeMap is a cached miss', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oko-shakemap-'));
  const calls = [];
  try {
    let clock = 0;
    const cache = createShakemapCache({ root, fetchImpl: fakeUsgs(calls), loadSharp, now: () => clock });
    const meta = await cache.meta('us1abc');
    assert.deepEqual(meta.bbox, [140, 36, 142, 37]); assert.equal(meta.mmi, 6.4); assert.equal(meta.version, '1793996910732');
    assert.deepEqual([...await cache.image('us1abc')], [255, 255, 255, 0, 250, 150, 20, 190]);
    const before = calls.length;
    await cache.meta('us1abc'); assert.equal(calls.length, before, 'metadata cached in memory');
    clock += 31 * 60_000;
    await createShakemapCache({ root, fetchImpl: fakeUsgs(calls), loadSharp, now: () => clock }).meta('us1abc');
    assert.equal(calls.filter((u) => u.endsWith('overlay.png')).length, 1, 'the processed image is reused from disk');
    assert.equal(await cache.meta('us2none'), null);
    const misses = calls.filter((u) => u.includes('us2none')).length;
    assert.equal(await cache.meta('us2none'), null);
    assert.equal(calls.filter((u) => u.includes('us2none')).length, misses, 'miss cached');
    assert.equal(await cache.meta('../bad'), null);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

function serve(proxy) {
  let handler;
  proxy.configureServer({ middlewares: { use: (prefix, fn) => { handler = fn; } } });
  return async (url) => {
    const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
    await handler({ method: 'GET', url }, res);
    return res;
  };
}

test('route: shakemap json/png, unknown period is 400, bad ids fall through to 404', async () => {
  const proxy = earthquakeFeedProxy({ shakemap: {
    meta: async (id) => (id === 'us1abc' ? { id, version: '9', bbox: [1, 2, 3, 4], mmi: null, file: 'x' } : null),
    image: async (id) => (id === 'us1abc' ? Buffer.from([1]) : null),
  } });
  const get = serve(proxy);
  const json = await get('/shakemap/us1abc.json');
  assert.equal(json.statusCode, 200); assert.equal(JSON.parse(json.body).image, '/api/earthquakes/shakemap/us1abc.png?v=9');
  assert.equal((await get('/shakemap/us9zzz.json')).statusCode, 404);
  const png = await get('/shakemap/us1abc.png');
  assert.equal(png.headers['content-type'], 'image/png');
  assert.equal((await get('/shakemap/US1ABC.png')).statusCode, 404);
  assert.equal((await get('/usgs?period=year')).statusCode, 400);
});
