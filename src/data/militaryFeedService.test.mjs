// src/data/militaryFeedService.test.mjs — vojenské lety: adsb.fi hlavný, adsb.lol záloha z rozpočtu, STALE
// namiesto prázdna (2026-10-23, vlastník: „oprav všetko").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADSBFI_ERROR_PAUSE_MS, MIL_FEED_CACHE_MS, MIL_FEED_PROVIDERS, createMilitaryFeedService,
} from './militaryFeedService.js';
import { createAdsbLolBudget } from './adsbLolBudget.js';
import { createUpstreamRegistry } from './upstreamStatus.js';

const FI = 'https://opendata.adsb.fi/api/v2/mil';
const LOL = 'https://api.adsb.lol/v2/mil';
const body = (n, tag) => JSON.stringify({ ac: Array.from({ length: n }, (_, i) => ({ hex: `ae${String(i).padStart(4, '0')}`, lat: 48, lon: 17, tag })), now: 1 });
const ok = (text, headers = {}) => ({ ok: true, status: 200, headers: new Headers(headers), text: async () => text });
const fail = (status, headers = {}) => ({ ok: false, status, headers: new Headers(headers), text: async () => '' });

function harness({ fi = () => ok(body(3, 'fi')), lol = () => ok(body(5, 'lol')) } = {}) {
  let t = 10_000_000;
  const calls = [];
  const registry = createUpstreamRegistry({ now: () => t });
  const budget = createAdsbLolBudget({ now: () => t, registry });
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === FI) { const r = fi(); if (r instanceof Error) throw r; return r; }
    if (url === LOL) { const r = lol(); if (r instanceof Error) throw r; return r; }
    throw new Error('neznáma URL ' + url);
  };
  const logs = [];
  const svc = createMilitaryFeedService({ fetchImpl, now: () => t, budget, registry, log: (m) => logs.push(m) });
  const res = () => { const r = { status: 0, headers: null, body: '', okoHistoryRecord: undefined, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } }; return r; };
  return { svc, calls, logs, budget, registry, res, tick: (ms) => { t += ms; }, now: () => t };
}

test('poradie zdrojov: adsb.fi hlavný, adsb.lol záloha; 60 s cache pre všetkých; hlavičky zdroja, veku a počtu', async () => {
  assert.deepEqual(MIL_FEED_PROVIDERS.map((p) => [p.name, p.budgeted]), [['adsb.fi', false], ['adsb.lol', true]]);
  assert.equal(MIL_FEED_CACHE_MS, 60_000);
  const h = harness();
  const a = await h.svc.snapshot();
  assert.equal(a.status, 200);
  assert.deepEqual(h.calls, [FI], 'adsb.lol sa nevolá, kým adsb.fi odpovedá');
  assert.equal(a.headers['X-Flight-Source'], 'adsb.fi');
  assert.equal(a.headers['X-ADS-B-Cache'], 'MISS');
  assert.equal(a.headers['X-Flight-Count'], '3');
  assert.equal(a.stale, false);
  h.tick(30_000);
  const b = await h.svc.snapshot();
  assert.equal(b.headers['X-ADS-B-Cache'], 'HIT');
  assert.equal(b.headers['X-ADS-B-Age-S'], '30');
  assert.equal(h.calls.length, 1, 'v cache');
  h.tick(30_001);
  await h.svc.snapshot();
  assert.deepEqual(h.calls, [FI, FI]);
  assert.equal(h.budget.status().spentToday.mil, undefined, 'rozpočet adsb.lol nedotknutý');
});

test('adsb.fi padne → adsb.lol z rozpočtu (druh mil), hlavičky limitu do rozpočtu; ďalšie okno zasa adsb.fi', async () => {
  let fiDown = true;
  const h = harness({ fi: () => (fiDown ? fail(503) : ok(body(3, 'fi'))), lol: () => ok(body(5, 'lol'), { 'x-ratelimit-limit': '500, 4;w=1, 60;w=60, 500;w=86400', 'x-ratelimit-remaining': '410', 'x-ratelimit-reset': '40000' }) });
  const a = await h.svc.snapshot();
  assert.equal(a.status, 200);
  assert.deepEqual(h.calls, [FI, LOL]);
  assert.equal(a.headers['X-Flight-Source'], 'adsb.lol');
  assert.equal(h.budget.status().remaining, 410, 'zostatok z hlavičky adsb.lol');
  assert.equal(h.budget.status().spentToday.mil, 1);
  assert.ok(h.logs.some((m) => /adsb\.fi: HTTP 503/.test(m)));
  // adsb.fi je po chybe minútu v pokoji; adsb.lol má 5 min odstup → ďalšie okno dá STALE z adsb.lol.
  h.tick(MIL_FEED_CACHE_MS + 1);
  fiDown = false;
  const b = await h.svc.snapshot();
  assert.equal(b.headers['X-Flight-Source'], 'adsb.fi', 'po pokoji adsb.fi znova hlavný');
  assert.deepEqual(h.calls, [FI, LOL, FI]);
  assert.equal(ADSBFI_ERROR_PAUSE_MS, 60_000);
});

test('oba zdroje mimo: posledný známy stav ako STALE s vekom (200), jeden pokus na okno, bez stavu 503 s Retry-After', async () => {
  let down = false;
  const h = harness({ fi: () => (down ? fail(429) : ok(body(2, 'fi'))), lol: () => (down ? fail(429, { 'x-ratelimit-limit': '500, 4;w=1, 60;w=60, 500;w=86400', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '30000' }) : ok(body(5, 'lol'))) });
  await h.svc.snapshot();
  down = true;
  h.tick(MIL_FEED_CACHE_MS + 1);
  const a = await h.svc.snapshot();
  assert.equal(a.status, 200);
  assert.equal(a.stale, true);
  assert.equal(a.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(a.headers['X-ADS-B-Age-S'], '60');
  assert.equal(a.headers['X-Flight-Source'], 'adsb.fi');
  assert.deepEqual(h.calls, [FI, FI, LOL]);
  assert.equal(h.budget.paused(), true, '429 adsb.lol s denným resetom = pauza');
  h.tick(10_000);
  const b = await h.svc.snapshot();
  assert.equal(b.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(h.calls.length, 3, 'v tom istom okne sa neopakuje');
  h.tick(MIL_FEED_CACHE_MS);
  const c = await h.svc.snapshot();
  assert.deepEqual(h.calls, [FI, FI, LOL, FI], 'po minúte pokoja adsb.fi skúsi znova (jeden pokus), adsb.lol v pauze dňa sa nevolá');
  assert.equal(c.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(c.headers['X-ADS-B-Age-S'], '130');
  // Služba bez akéhokoľvek stavu: 503 s Retry-After, nie 429.
  const empty = harness({ fi: () => fail(500), lol: () => new Error('ECONNRESET') });
  const e = await empty.svc.snapshot();
  assert.equal(e.status, 503);
  assert.match(e.headers['Retry-After'], /^\d+$/);
  assert.equal(JSON.parse(e.body).error, 'military_feed_unavailable');
  assert.equal(empty.budget.status().lastStatus, 0, 'chyba siete adsb.lol zapísaná');
});

test('middleware: STALE a chybové odpovede sa do histórie nezapisujú (okoHistoryRecord=false), čerstvé áno', async () => {
  let down = false;
  const h = harness({ fi: () => (down ? fail(503) : ok(body(2, 'fi'))), lol: () => fail(503) });
  const r1 = h.res();
  await h.svc.middleware({}, r1);
  assert.equal(r1.status, 200);
  assert.equal(r1.okoHistoryRecord, undefined, 'čerstvá odpoveď sa zapíše');
  assert.equal(JSON.parse(r1.body).ac.length, 2);
  down = true;
  h.tick(MIL_FEED_CACHE_MS + 1);
  const r2 = h.res();
  await h.svc.middleware({}, r2);
  assert.equal(r2.status, 200);
  assert.equal(r2.headers['X-ADS-B-Cache'], 'STALE');
  assert.equal(r2.okoHistoryRecord, false);
  assert.equal(h.svc.status().source, 'adsb.fi');
  assert.equal(h.svc.status().count, 2);
});

test('súbežné dopyty zdieľajú jeden pokus (INFLIGHT); chybný JSON alebo chýbajúce ac[] = chyba zdroja', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ fi: () => ({ ok: true, status: 200, headers: new Headers(), text: () => gate.then(() => body(1, 'fi')) }) });
  const p1 = h.svc.snapshot();
  const p2 = h.svc.snapshot();
  release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual([a.headers['X-ADS-B-Cache'], b.headers['X-ADS-B-Cache']].sort(), ['INFLIGHT', 'MISS']);
  const bad = harness({ fi: () => ok('{"msg":"no ac"}'), lol: () => ok('nie json') });
  const e = await bad.svc.snapshot();
  assert.equal(e.status, 503);
  assert.ok(bad.logs.some((m) => /no ac\[\]/.test(m)) && bad.logs.some((m) => /invalid JSON/.test(m)));
});

test('zapojenie: vite.config.js obsluhuje /api/adsblol/mil službou, regionálna záloha ide na adsb.lol len z rozpočtu, história berie zdroj z hlavičky', () => {
  const cfg = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(cfg, /import \{ adsbLolBudget \} from '\.\/src\/data\/adsbLolBudget\.js';/);
  assert.match(cfg, /const feed = createMilitaryFeedService\(\);/);
  assert.match(cfg, /server\.middlewares\.use\('\/api\/adsblol\/mil', \(req, res\) => \{ void feed\.middleware\(req, res\); \}\);/);
  assert.doesNotMatch(cfg, /fetch\('https:\/\/api\.adsb\.lol\/v2\/mil'/, 'priame volanie /v2/mil z configu by rozpočet obišlo');
  assert.match(cfg, /if \(budgeted && !adsbLolBudget\.allow\('regional'\)\) continue;/);
  assert.match(cfg, /if \(budgeted\) adsbLolBudget\.record\('regional', \{ status: upstream\.status, headers: upstream\.headers \}\);/);
  assert.match(cfg, /recordAdsbLolBody\(body, `\$\{res\.getHeader\('X-Flight-Source'\) \|\| 'adsb\.lol'\}\/mil`\)/);
  assert.match(cfg, /intervalMs: \(\) => KEEPER_STATE_INTERVAL_MS \}/);
  assert.match(cfg, /adsbLol: adsbLolBudget\.status\(\), milFeed: _milFeedStatus\(\)/);
  const keeper = readFileSync(new URL('./flightHistoryKeeper.js', import.meta.url), 'utf8');
  assert.match(keeper, /export const KEEPER_MIL_INTERVAL_MS = 5 \* 60_000;/);
  assert.match(keeper, /export const KEEPER_STATE_INTERVAL_MS = 5 \* 60_000;/);
  const search = readFileSync(new URL('./aircraftSearchService.js', import.meta.url), 'utf8');
  assert.match(search, /!budget\.allow\('search'\)/);
  assert.match(search, /budget\.record\('search', \{ status: res\.status, headers: res\.headers \}\)/);
  const state = readFileSync(new URL('./stateAircraftService.js', import.meta.url), 'utf8');
  assert.match(state, /if \(!budget\.allow\('state'\)\) throw new Error/);
  assert.match(state, /'X-ADS-B-Cache': 'STALE'/);
  const layer = readFileSync(new URL('./militaryFlights.js', import.meta.url), 'utf8');
  assert.match(layer, /_feedStale = String\(response\.headers\?\.get\?\.\('x-ads-b-cache'\) \|\| ''\)\.toUpperCase\(\) === 'STALE';/);
  assert.match(layer, /stale: _backoff \|\| _feedStale,/);
  assert.match(layer, /_lastUpdate = _feedStale \? Date\.now\(\) - _feedAgeS \* 1000 : Date\.now\(\);/);
});
