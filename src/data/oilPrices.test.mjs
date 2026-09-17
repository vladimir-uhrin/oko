import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRED_BRENT_SERIES,
  FRED_WTI_SERIES,
  buildOilModel,
  fetchOilPrices,
  formatUsdBbl,
  oilFredUrls,
} from './oilPrices.js';

const NOW = Date.UTC(2026, 8, 16); // 2026-09-16
const brentRows = [
  { date: '2026-09-11', value: 118.06 },
  { date: '2026-09-14', value: 121.25 },
  { date: '2026-09-15', value: 130.80 },
];
const wtiRows = [
  { date: '2026-09-14', value: 102.42 },
  { date: '2026-09-15', value: 107.02 },
];

test('oilFredUrls points at the keyless FRED CSV for both series', () => {
  const { brent, wti } = oilFredUrls();
  assert.ok(brent.includes('fredgraph.csv'));
  assert.ok(brent.includes(FRED_BRENT_SERIES));
  assert.ok(wti.includes(FRED_WTI_SERIES));
  assert.ok(brent.startsWith('https://'));
});

test('formatUsdBbl formats to two decimals and honours the empty case', () => {
  assert.equal(formatUsdBbl(130.8, 'en'), '130.80 $/bbl');
  assert.equal(formatUsdBbl(null), '—');
  assert.equal(formatUsdBbl(Number.NaN), '—');
});

test('buildOilModel fails closed on empty input', () => {
  assert.equal(buildOilModel(null).ok, false);
  assert.equal(buildOilModel({ brent: { rows: [] }, wti: { rows: [] } }).ok, false);
});

test('buildOilModel derives latest price, day change and direction for both grades', () => {
  const model = buildOilModel(
    { brent: { rows: brentRows }, wti: { rows: wtiRows }, fetchedAt: NOW },
    { nowMs: NOW, lang: 'en', translate: (key) => key },
  );
  assert.equal(model.ok, true);
  assert.equal(model.brent.value, 130.8);
  assert.match(model.brent.text, /130\.80 \$\/bbl/);
  assert.equal(model.brent.dir, 'up'); // 121.25 -> 130.80
  assert.ok(model.brent.pct > 0);
  assert.equal(model.wti.value, 107.02);
  assert.equal(model.wti.dir, 'up');
  assert.equal(model.brent.label, 'oil.brent');
  assert.equal(model.wti.label, 'oil.wti');
});

test('buildOilModel returns spark points inside the range and a fresh verdict', () => {
  const model = buildOilModel(
    { brent: { rows: brentRows }, wti: { rows: wtiRows } },
    { nowMs: NOW, range: '1m' },
  );
  assert.equal(model.spark.brent.length, 3);
  assert.equal(model.spark.wti.length, 2);
  assert.ok(model.spark.brent.every((p) => Number.isFinite(p.t) && Number.isFinite(p.v)));
  assert.equal(model.freshness.latestDate, '2026-09-15');
  assert.equal(model.freshness.stale, false);
  assert.equal(model.freshness.ageDays, 1);
});

test('buildOilModel flags a stale series when the latest print is old', () => {
  const model = buildOilModel(
    { brent: { rows: [{ date: '2026-08-01', value: 90 }] }, wti: { rows: [] } },
    { nowMs: NOW },
  );
  assert.equal(model.ok, true);
  assert.equal(model.freshness.stale, true);
  assert.ok(model.freshness.ageDays > 5);
  assert.equal(model.wti, null);
});

test('a down day is reported as a falling direction', () => {
  const model = buildOilModel(
    { brent: { rows: [{ date: '2026-09-14', value: 130 }, { date: '2026-09-15', value: 121 }] } },
    { nowMs: NOW },
  );
  assert.equal(model.brent.dir, 'down');
  assert.ok(model.brent.delta < 0);
});

test('fetchOilPrices returns the payload and raises the proxy error shape', async () => {
  const ok = await fetchOilPrices({
    fetcher: async () => ({ ok: true, json: async () => ({ brent: { rows: brentRows } }) }),
  });
  assert.deepEqual(ok.brent.rows, brentRows);

  await assert.rejects(
    fetchOilPrices({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }),
    (err) => err.message === 'upstream' && err.status === 502,
  );
});
