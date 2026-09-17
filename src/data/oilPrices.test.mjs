import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMODITY_UNITS,
  YAHOO_SYMBOLS,
  buildOilModel,
  changeOverDays,
  fetchOilPrices,
  formatEurBbl,
  formatUsdBbl,
  parseYahooChart,
  yahooChartUrl,
} from './oilPrices.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 1);
// A rising daily series 100..139 over 40 days.
const series = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * DAY, v: 100 + i }));
const quote = (over) => ({ price: 139, series, week52High: 150, week52Low: 90, dayHigh: 140, dayLow: 137, marketTimeMs: T0 + 39 * DAY, ...over });

test('yahooChartUrl defaults to a one-year daily series and is keyless', () => {
  const url = yahooChartUrl(YAHOO_SYMBOLS.brent);
  assert.ok(url.startsWith('https://query1.finance.yahoo.com/'));
  assert.ok(url.includes(encodeURIComponent('BZ=F')));
  assert.ok(url.includes('range=1y'));
});

test('formatters produce USD/EUR per barrel and fail closed', () => {
  assert.equal(formatUsdBbl(104.72, 'en'), '104.72 $/bbl');
  assert.equal(formatEurBbl(91.22, 'en'), '91.22 €/bbl');
  assert.equal(formatUsdBbl(null), '—');
});

test('changeOverDays is series-based (robust to a broken previous close)', () => {
  assert.ok(Math.abs(changeOverDays(series, 1, 139) - ((139 - 138) / 138) * 100) < 1e-9); // vs prior close
  assert.ok(Math.abs(changeOverDays(series, 7, 139) - ((139 - 132) / 132) * 100) < 1e-9); // vs a week ago
  assert.equal(changeOverDays([], 7, 100), null);
  assert.equal(changeOverDays(series, 7, Number.NaN), null);
});

test('parseYahooChart normalizes and drops null closes', () => {
  const json = {
    chart: {
      result: [{
        meta: { symbol: 'BZ=F', currency: 'USD', regularMarketPrice: 104.7, regularMarketDayHigh: 106, regularMarketDayLow: 101, fiftyTwoWeekHigh: 126, fiftyTwoWeekLow: 58, regularMarketTime: 1_789_000_000 },
        timestamp: [1_788_000_000, 1_788_086_400, 1_788_172_800],
        indicators: { quote: [{ close: [100, null, 104.7] }] },
      }],
    },
  };
  const q = parseYahooChart(json);
  assert.equal(q.price, 104.7);
  assert.equal(q.week52High, 126);
  assert.equal(q.series.length, 2);
  assert.equal(parseYahooChart({}), null);
});

test('buildOilModel gives period changes, a 52-week position and EUR', () => {
  const model = buildOilModel({
    brent: quote(),
    wti: quote({ price: 132 }),
    eurusd: { price: 1.148 },
    fetchedAt: T0,
  }, { lang: 'en', translate: (k) => k });

  assert.equal(model.ok, true);
  assert.equal(model.brent.dir, 'up');
  assert.ok(model.brent.changes.day > 0 && model.brent.changes.week > model.brent.changes.day);
  assert.ok(Number.isFinite(model.brent.changes.month) && Number.isFinite(model.brent.changes.year));
  // 52-week position: (139-90)/(150-90)
  assert.ok(Math.abs(model.brent.range52.pos - (49 / 60)) < 1e-9);
  assert.match(model.brent.eurText, /€\/bbl/);
  assert.ok(Math.abs(model.spread - (139 - 132)) < 1e-9);
  assert.equal(model.chart.series.length, 2);
});

test('buildOilModel adds compact commodities with their own units', () => {
  const model = buildOilModel({
    brent: quote(),
    natgas: quote({ price: 2.86 }),
    gasoline: quote({ price: 3.22 }),
    diesel: quote({ price: 4.85 }),
  }, { lang: 'en', translate: (k) => k });
  const byKey = Object.fromEntries(model.commodities.map((c) => [c.key, c]));
  assert.equal(byKey.natgas.unit, COMMODITY_UNITS.natgas);
  assert.match(byKey.natgas.priceText, /\$\/MMBtu/);
  assert.match(byKey.gasoline.priceText, /\$\/gal/);
  assert.equal(model.commodities.length, 3);
});

test('without a EUR rate the EUR figure is omitted; empty payload fails closed', () => {
  const m = buildOilModel({ brent: quote() }, { translate: (k) => k });
  assert.equal(m.brent.eur, null);
  assert.equal(m.wti, null);
  assert.equal(buildOilModel(null).ok, false);
});

test('fetchOilPrices returns the payload and raises the proxy error shape', async () => {
  const ok = await fetchOilPrices({ fetcher: async () => ({ ok: true, json: async () => ({ brent: { price: 1 } }) }) });
  assert.equal(ok.brent.price, 1);
  await assert.rejects(
    fetchOilPrices({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }),
    (err) => err.message === 'upstream' && err.status === 502,
  );
});
