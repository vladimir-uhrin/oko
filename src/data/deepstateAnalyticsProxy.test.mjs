// src/data/deepstateAnalyticsProxy.test.mjs — testy pre /api/deepstate/analytics
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  deepstateAnalyticsProxy,
  getFormattedDateKey,
  formatDisplayDate,
  deepstateRawUrl,
  calculateGeoJsonAreaKm2,
  getClientIp,
} from './deepstateAnalyticsProxy.js';

test('getFormattedDateKey: korektné formátovanie a odpočítavanie dní', () => {
  const base = new Date('2026-09-23T12:00:00Z');
  assert.equal(getFormattedDateKey(1, base), '20260922');
  assert.equal(getFormattedDateKey(2, base), '20260921');
  assert.equal(getFormattedDateKey(24, base), '20260830');
});

test('formatDisplayDate: formátovanie na ISO YYYY-MM-DD', () => {
  assert.equal(formatDisplayDate('20260922'), '2026-09-22');
  assert.equal(formatDisplayDate('invalid'), 'invalid');
  assert.equal(formatDisplayDate(null), null);
});

test('deepstateRawUrl: URL zodpovedá repo cyterat/deepstate-map-data', () => {
  assert.equal(
    deepstateRawUrl('20260922'),
    'https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_20260922.geojson'
  );
});

test('calculateGeoJsonAreaKm2: výpočet plochy polygónu a multipolygónu', () => {
  // Štvorcový polygón ~ 1° x 1° okolo rovníka (cca 111 km x 111 km ≈ 12 300 km²)
  const sampleGeoJson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [30.0, 48.0],
              [31.0, 48.0],
              [31.0, 49.0],
              [30.0, 49.0],
              [30.0, 48.0],
            ],
          ],
        },
      },
    ],
  };

  const area = calculateGeoJsonAreaKm2(sampleGeoJson);
  assert.ok(area > 7000 && area < 9000, `Plocha ${area} km² má byť v očakávanom geodetickom rozsahu`);
});

test('getClientIp: zohľadňuje CF-Connecting-IP aj remoteAddress', () => {
  assert.equal(getClientIp({ headers: { 'cf-connecting-ip': '85.12.34.56' } }), '85.12.34.56');
  assert.equal(getClientIp({ socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

function fakeRes() {
  return {
    status: 0,
    headers: null,
    body: null,
    writeHead(s, h) {
      this.status = s;
      this.headers = h;
    },
    end(b) {
      this.body = b;
    },
  };
}

const mockFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [35.0, 47.0],
            [36.0, 47.0],
            [36.0, 48.0],
            [35.0, 48.0],
            [35.0, 47.0],
          ],
        ],
      },
    },
  ],
};

test('handler: úspešné načítanie z upstreamu, cache zápis a opätovný odber z cache', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-deepstate-'));
  const calls = [];
  const plugin = deepstateAnalyticsProxy({
    root,
    now: () => new Date('2026-09-23T12:00:00Z').getTime(),
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockFeatureCollection),
      };
    },
    log: () => {},
  });

  const req = {
    method: 'GET',
    url: '/api/deepstate/analytics?date=20260922',
    headers: {},
    socket: { remoteAddress: '::1' },
  };

  const res1 = fakeRes();
  await plugin._handler(req, res1);

  assert.equal(res1.status, 200);
  assert.equal(res1.headers['X-OKO-Source'], 'upstream');
  const payload1 = JSON.parse(res1.body);
  assert.equal(payload1.ok, true);
  assert.equal(payload1.date, '2026-09-22');
  assert.equal(payload1.dateKey, '20260922');
  assert.ok(payload1.areaKm2 > 0);
  assert.equal(calls.length, 1);

  // Druhý dopyt musí ísť z pamäťovej cache bez ďalšieho volania fetch
  const res2 = fakeRes();
  await plugin._handler(req, res2);
  assert.equal(res2.status, 200);
  assert.equal(res2.headers['X-OKO-Source'], 'memory');
  assert.equal(calls.length, 1);

  await fsp.rm(root, { recursive: true, force: true });
});

test('handler: fallback pri 404 z predchádzajúceho dňa', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-deepstate-fallback-'));
  const calls = [];

  const plugin = deepstateAnalyticsProxy({
    root,
    now: () => new Date('2026-09-23T12:00:00Z').getTime(),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('20260922')) {
        return { ok: false, status: 404 }; // Včerajšok ešte nie je
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(mockFeatureCollection),
      };
    },
    log: () => {},
  });

  const req = {
    method: 'GET',
    url: '/api/deepstate/analytics?date=20260922',
    headers: {},
    socket: { remoteAddress: '::1' },
  };

  const res = fakeRes();
  await plugin._handler(req, res);

  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.dateKey, '20260921'); // Padlo to na predvčerom
  assert.equal(payload.fallbackDays, 1);
  assert.equal(calls.length, 2);

  await fsp.rm(root, { recursive: true, force: true });
});

test('handler: 405 pri nepovolenej HTTP metóde', async () => {
  const plugin = deepstateAnalyticsProxy({ log: () => {} });
  const req = { method: 'POST', url: '/api/deepstate/analytics' };
  const res = fakeRes();
  await plugin._handler(req, res);
  assert.equal(res.status, 405);
});
