import assert from 'node:assert/strict';
import test from 'node:test';

import {
  YAHOO_SYMBOLS,
  buildOilModel,
  fetchOilPrices,
  formatEurBbl,
  formatUsdBbl,
  parseYahooChart,
  yahooChartUrl,
} from './oilPrices.js';

const yahooJson = (price, prevClose, symbol = 'BZ=F') => ({
  chart: {
    result: [{
      meta: {
        symbol,
        currency: 'USD',
        regularMarketPrice: price,
        chartPreviousClose: prevClose,
        regularMarketDayHigh: price + 1.28,
        regularMarketDayLow: price - 3.17,
        fiftyTwoWeekHigh: 126.1,
        fiftyTwoWeekLow: 58.72,
        regularMarketTime: 1_789_000_000,
      },
      timestamp: [1_788_000_000, 1_788_086_400, 1_788_172_800],
      indicators: { quote: [{ close: [100, null, price] }] },
    }],
  },
});

test('yahooChartUrl is keyless and carries symbol + range', () => {
  const url = yahooChartUrl(YAHOO_SYMBOLS.brent, { range: '6mo' });
  assert.ok(url.startsWith('https://query1.finance.yahoo.com/'));
  assert.ok(url.includes(encodeURIComponent('BZ=F')));
  assert.ok(url.includes('range=6mo'));
});

test('formatters produce USD/EUR per barrel and fail closed', () => {
  assert.equal(formatUsdBbl(104.72, 'en'), '104.72 $/bbl');
  assert.equal(formatEurBbl(91.22, 'en'), '91.22 €/bbl');
  assert.equal(formatUsdBbl(null), '—');
  assert.equal(formatEurBbl(Number.NaN), '—');
});

test('parseYahooChart normalizes the quote and drops null closes from the series', () => {
  const q = parseYahooChart(yahooJson(104.72, 103.42));
  assert.equal(q.price, 104.72);
  assert.equal(q.prevClose, 103.42);
  assert.equal(q.dayHigh, 106);
  assert.equal(q.week52High, 126.1);
  assert.equal(q.currency, 'USD');
  assert.equal(q.marketTimeMs, 1_789_000_000_000);
  assert.equal(q.series.length, 2); // the middle null close is skipped
  assert.ok(q.series.every((p) => Number.isFinite(p.t) && Number.isFinite(p.v)));
});

test('parseYahooChart returns null without a usable price', () => {
  assert.equal(parseYahooChart({}), null);
  assert.equal(parseYahooChart({ chart: { result: [{ meta: {} }] } }), null);
});

test('buildOilModel derives USD+EUR, day change, spread and chart series', () => {
  const model = buildOilModel({
    brent: parseYahooChart(yahooJson(104.72, 103.42, 'BZ=F')),
    wti: parseYahooChart(yahooJson(101.88, 102.43, 'CL=F')),
    eurusd: { price: 1.148 },
    fetchedAt: 1_789_000_100_000,
  }, { lang: 'en', translate: (k) => k });

  assert.equal(model.ok, true);
  assert.equal(model.brent.usd, 104.72);
  assert.equal(model.brent.dir, 'up'); // 103.42 -> 104.72
  assert.ok(model.brent.changePct > 0);
  assert.ok(Math.abs(model.brent.eur - 104.72 / 1.148) < 1e-6);
  assert.match(model.brent.eurText, /€\/bbl/);
  assert.equal(model.wti.dir, 'down'); // 102.43 -> 101.88
  assert.ok(Math.abs(model.spread - (104.72 - 101.88)) < 1e-9);
  assert.equal(model.chart.series.length, 2);
  assert.ok(model.brent.dayRangeText && model.brent.week52Text);
  assert.ok(model.eurusd === 1.148);
});

test('without a EUR/USD rate the EUR figure is omitted, not faked', () => {
  const model = buildOilModel({ brent: parseYahooChart(yahooJson(100, 99)) }, { translate: (k) => k });
  assert.equal(model.brent.eur, null);
  assert.equal(model.brent.eurText, null);
  assert.equal(model.wti, null);
  assert.equal(model.spread, null);
});

test('fetchOilPrices returns the payload and raises the proxy error shape', async () => {
  const ok = await fetchOilPrices({ fetcher: async () => ({ ok: true, json: async () => ({ brent: { price: 1 } }) }) });
  assert.equal(ok.brent.price, 1);
  await assert.rejects(
    fetchOilPrices({ fetcher: async () => ({ ok: false, status: 502, json: async () => ({ error: 'upstream' }) }) }),
    (err) => err.message === 'upstream' && err.status === 502,
  );
});
