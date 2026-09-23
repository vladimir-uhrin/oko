// src/data/deepstateAnalyticsProxyHardening.test.mjs — dokončenie
// /api/deepstate/analytics (2026-09-23): UTC dátumy v každom pásme, overenie
// dátumu a maxFallback, negatívna cache 404, 502 pri výpadku mirroru bez
// ďalšieho bombardovania, nepoužiteľný súbor sa neukladá, starší súbor z disku
// keď mirror stojí, jeden dopyt naraz, poctivé polia o zdroji, gzip/HEAD/429.
// Bez siete: fetch je vstreknutý, koreň je dočasný priečinok.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';

import {
  DEEPSTATE_ANALYTICS_ATTRIBUTION, DEEPSTATE_ANALYTICS_LICENSE, DEEPSTATE_ANALYTICS_NOTE, MIRROR_FIRST_DAY, STALE_DISK_MAX_DAYS,
  deepstateAnalyticsProxy, getFormattedDateKey, isUsableSnapshot, parseDateKey, parseMaxFallback,
} from './deepstateAnalyticsProxy.js';

const NOW = Date.UTC(2026, 8, 23, 12); // 23. 9. 2026 12:00 UTC → včerajšok = 20260922
const polygon = (lon) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[lon, 47], [lon + 1, 47], [lon + 1, 48], [lon, 48], [lon, 47]]] } }],
});
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const status = (s, headers = {}) => ({ ok: false, status: s, text: async () => '', headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
const roots = [];
test.after(() => Promise.all(roots.map((r) => fsp.rm(r, { recursive: true, force: true }))));

function fakeRes() {
  return { status: 0, headers: null, body: undefined, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
}
const json = (res) => JSON.parse((res.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(res.body) : res.body).toString('utf8'));
const req = (url, { ip = '10.0.0.1', method = 'GET', headers = {} } = {}) => ({ method, url, headers, socket: { remoteAddress: ip } });

async function setup(fetchImpl, { now = () => NOW } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-dsa-'));
  roots.push(root);
  const calls = [];
  const plugin = deepstateAnalyticsProxy({ root, now, log: () => {}, fetchImpl: async (url, opts) => { calls.push(url.match(/(\d{8})\.geojson$/)?.[1]); return fetchImpl(url, opts); } });
  const call = async (url, opts) => { const res = fakeRes(); await plugin._handler(req(url, opts), res); return res; };
  return { root, calls, plugin, call, dir: plugin._dir };
}

test('dátumy sú UTC v každom časovom pásme; neexistujúci dátum sa neprevalí', () => {
  const saved = process.env.TZ;
  try {
    for (const tz of ['America/New_York', 'Pacific/Kiritimati', 'Europe/Bratislava']) {
      process.env.TZ = tz;
      assert.equal(getFormattedDateKey(1, new Date(NOW)), '20260922', tz);
      assert.equal(getFormattedDateKey(0, new Date(Date.UTC(2026, 8, 22))), '20260922', `${tz}: polnoc UTC`);
      assert.equal(getFormattedDateKey(1, new Date(Date.UTC(2027, 2, 28, 22, 30))), '20270327', `${tz}: noc zmeny času`);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
  assert.equal(parseDateKey('20261399'), null);
  assert.equal(parseDateKey('20230229'), null);
  assert.equal(parseDateKey('20240229'), Date.UTC(2024, 1, 29));
  assert.equal(parseDateKey('abc'), null);
});

test('maxFallback: nečíslo = predvolené, inak 0 … 14', () => {
  assert.equal(parseMaxFallback('abc'), 7);
  assert.equal(parseMaxFallback(null), 7);
  assert.equal(parseMaxFallback('0'), 0);
  assert.equal(parseMaxFallback('-3'), 0);
  assert.equal(parseMaxFallback('99'), 14);
});

test('zlý, budúci a predmirrorový dátum = 400 bez jediného dopytu na GitHub; maxFallback=abc funguje', async () => {
  const { call, calls } = await setup(async () => ok(polygon(35)));
  for (const [date, reason] of [['20261399', 'invalid'], ['abc', 'invalid'], ['20260924', 'future'], ['20240707', 'before_mirror']]) {
    const res = await call(`/api/deepstate/analytics?date=${date}`);
    assert.equal(res.status, 400, date);
    assert.equal(json(res).reason, reason, date);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
  assert.deepEqual(calls, []);
  assert.equal(MIRROR_FIRST_DAY, '20240708');
  const today = await call('/api/deepstate/analytics?date=20260923');
  assert.equal(today.status, 200, 'dnešný súbor môže existovať od ~03:00 UTC');
  const nan = await call('/api/deepstate/analytics?maxFallback=abc');
  assert.equal(nan.status, 200);
  assert.equal(json(nan).requestedDate, null, 'predvolený včerajšok');
});

test('negatívna cache: chýbajúci včerajšok sa 30 min znova nepýta, potom áno', async () => {
  let t = NOW;
  const { call, calls } = await setup(async (url) => (url.includes('20260922') ? status(404) : ok(polygon(35))), { now: () => t });
  const first = await call('/api/deepstate/analytics');
  assert.equal(json(first).dateKey, '20260921');
  assert.equal(json(first).fallbackDays, 1);
  assert.equal(json(first).stale, true);
  assert.deepEqual(calls, ['20260922', '20260921']);
  await call('/api/deepstate/analytics');
  assert.deepEqual(calls, ['20260922', '20260921'], 'druhý dopyt: 404 z cache, 21. z pamäte');
  t += 31 * 60_000;
  const later = await call('/api/deepstate/analytics');
  assert.deepEqual(calls, ['20260922', '20260921', '20260922'], 'po 30 min sa včerajšok skúsi znova');
  assert.equal(later.headers['X-OKO-Source'], 'disk', '21. už z disku (pamäť po 15 min vypršala)');
});

test('výpadok mirroru (500): jeden pokus, potom len disk; bez disku 502, nie 404', async () => {
  const a = await setup(async () => status(500));
  const res = await a.call('/api/deepstate/analytics');
  assert.equal(res.status, 502);
  assert.equal(json(res).error, 'upstream_unavailable');
  assert.equal(json(res).upstreamStatus, 500);
  assert.deepEqual(a.calls, ['20260922'], 'po prvej chybe už na GitHub nechodí');

  const b = await setup(async () => status(429));
  await fsp.mkdir(b.dir, { recursive: true });
  await fsp.writeFile(path.join(b.dir, '20260919.geojson'), JSON.stringify(polygon(36)));
  const disk = await b.call('/api/deepstate/analytics');
  assert.equal(disk.status, 200);
  assert.equal(json(disk).dateKey, '20260919');
  assert.equal(json(disk).fallbackDays, 3);
  assert.equal(disk.headers['X-OKO-Source'], 'disk');
  assert.deepEqual(b.calls, ['20260922']);

  const c = await setup(async () => { throw new TypeError('fetch failed'); });
  const net = await c.call('/api/deepstate/analytics');
  assert.equal(net.status, 502);
  assert.equal(json(net).upstreamStatus, 'network');
});

test('mirror stojí dlhšie než okno: najnovší súbor z disku s príznakom outsideWindow', async () => {
  const s = await setup(async () => status(404));
  await fsp.mkdir(s.dir, { recursive: true });
  await fsp.writeFile(path.join(s.dir, '20260917.geojson'), JSON.stringify(polygon(36)));
  await fsp.writeFile(path.join(s.dir, '20260915.geojson'), JSON.stringify(polygon(37)));
  await fsp.writeFile(path.join(s.dir, '20260916.geojson'), '{"type":"FeatureCollection","features":[]}');
  const res = await s.call('/api/deepstate/analytics?maxFallback=1');
  assert.equal(res.status, 200);
  const body = json(res);
  assert.equal(body.dateKey, '20260917');
  assert.equal(body.outsideWindow, true);
  assert.equal(body.stale, true);
  assert.equal(body.fallbackDays, 5);
  assert.equal(res.headers['X-OKO-Source'], 'disk-stale');
  assert.deepEqual(s.calls, ['20260922', '20260921']);
  const none = await (await setup(async () => status(404))).call('/api/deepstate/analytics?maxFallback=1');
  assert.equal(none.status, 404, 'všetko 404 a prázdny disk = poctivé 404');
});

test('prázdna kolekcia z mirroru sa neuloží a deň sa preskočí', async () => {
  const s = await setup(async (url) => (url.includes('20260922') ? ok({ type: 'FeatureCollection', features: [] }) : ok(polygon(35))));
  const res = await s.call('/api/deepstate/analytics');
  assert.equal(json(res).dateKey, '20260921');
  const files = await fsp.readdir(s.dir);
  assert.deepEqual(files.sort(), ['20260921.geojson']);
  assert.equal(isUsableSnapshot({ type: 'FeatureCollection', features: [] }), false);
  assert.equal(isUsableSnapshot(null), false);
  assert.equal(isUsableSnapshot(polygon(35)), true);
});

test('jeden dopyt na deň naraz; zlyhaný dopyt nezablokuje ďalší pokus', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await setup(async () => { await gate; return ok(polygon(35)); });
  const both = Promise.all([s.call('/api/deepstate/analytics'), s.call('/api/deepstate/analytics', { ip: '10.0.0.2' })]);
  await new Promise((r) => setTimeout(r, 10));
  release();
  const [r1, r2] = await both;
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.deepEqual(s.calls, ['20260922']);

  // Skutočne SYNCHRÓNNY throw (bez async obalu setup()) — pôvodná chyba
  // nechávala zamietnutý sľub v mape navždy.
  const froot = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-dsa-'));
  roots.push(froot);
  let t = NOW;
  let first = true;
  let fcalls = 0;
  const f = deepstateAnalyticsProxy({ root: froot, now: () => t, log: () => {}, fetchImpl: () => { fcalls += 1; if (first) { first = false; throw new Error('sync boom'); } return Promise.resolve(ok(polygon(35))); } });
  const fcall = async (url) => { const res = fakeRes(); await f._handler(req(url), res); return res; };
  const boom = await fcall('/api/deepstate/analytics');
  assert.equal(boom.status, 502);
  assert.equal(json(boom).upstreamStatus, 'network');
  assert.equal(boom.headers['Retry-After'], '60');
  t += 30_000;
  assert.equal((await fcall('/api/deepstate/analytics')).status, 502, 'počas pauzy po chybe sa na GitHub nechodí');
  assert.equal(fcalls, 1);
  t += 31_000;
  const retry = await fcall('/api/deepstate/analytics');
  assert.equal(retry.status, 200, 'po pauze nový pokus — rozbehnutý dopyt po chybe nevisí v mape');
  assert.equal(json(retry).dateKey, '20260922');
  assert.equal(fcalls, 2);
});

test('odpoveď nesie zdroj, licenciu, výhrady a metódu; gzip, HEAD, 429 s Retry-After', async () => {
  const s = await setup(async () => ok(polygon(35)));
  const res = await s.call('/api/deepstate/analytics', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['Content-Encoding'], 'gzip');
  assert.equal(res.headers['Content-Length'], String(res.body.length));
  const body = json(res);
  assert.equal(body.attribution, DEEPSTATE_ANALYTICS_ATTRIBUTION);
  assert.match(body.attribution, /according to DeepStateMap\.live/);
  assert.deepEqual(body.license, { ...DEEPSTATE_ANALYTICS_LICENSE });
  assert.match(body.license.data, /not open data/);
  assert.match(body.license.mirrorCode, /not to the data/);
  assert.equal(body.note, DEEPSTATE_ANALYTICS_NOTE);
  assert.match(body.note, /Not a live front line/);
  assert.match(body.note, /2–3 day delay/);
  assert.match(body.areaMethod, /not a DeepState figure/);
  assert.equal(body.stale, false);
  assert.equal(body.outsideWindow, false);
  assert.ok(!/ODbL|no consent issue/i.test(JSON.stringify(body)), 'nikdy netvrdiť otvorenú licenciu');

  const head = await s.call('/api/deepstate/analytics', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.ok(Number(head.headers['Content-Length']) > 1024);

  const post = await s.call('/api/deepstate/analytics', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET, HEAD');

  const l = await setup(async () => ok(polygon(35)));
  for (let i = 0; i < 600; i += 1) await l.call('/api/deepstate/analytics?date=20260922', { ip: `192.0.2.${i}` });
  let last;
  for (let i = 0; i < 61; i += 1) last = await l.call('/api/deepstate/analytics?date=20260922', { ip: '203.0.113.9' });
  assert.equal(last.status, 429);
  assert.equal(last.headers['Retry-After'], '60');
  assert.equal(last.headers['Cache-Control'], 'no-store');
  assert.deepEqual(l.calls, ['20260922'], '600 klientov, jeden dopyt na GitHub');
});

test('pauza po 429 platí aj pre ďalšie dopyty (Retry-After, strop 15 min); 200 z disku priznáva nedostupný mirror', async () => {
  let t = NOW;
  const s = await setup(async () => status(429, { 'retry-after': '120' }), { now: () => t });
  await fsp.mkdir(s.dir, { recursive: true });
  await fsp.writeFile(path.join(s.dir, '20260920.geojson'), JSON.stringify(polygon(36)));
  const a = await s.call('/api/deepstate/analytics');
  assert.equal(a.status, 200);
  const body = json(a);
  assert.equal(body.dateKey, '20260920');
  assert.equal(body.upstreamUnavailable, true, 'starší súbor kvôli nedostupnému mirroru, nie preto, že novší neexistuje');
  assert.equal(body.upstreamStatus, 429);
  t += 100_000;
  const b = await s.call('/api/deepstate/analytics');
  assert.equal(json(b).dateKey, '20260920');
  assert.deepEqual(s.calls, ['20260922'], 'Retry-After 120 s — druhý dopyt po 100 s na GitHub nešiel');
  t += 30_000;
  await s.call('/api/deepstate/analytics');
  assert.deepEqual(s.calls, ['20260922', '20260922'], 'po Retry-After znova');
});

test('poškodená adresa = 400, nie pád servera', async () => {
  const s = await setup(async () => ok(polygon(35)));
  for (const url of ['//x:99999', '//[', '//%']) {
    const res = await s.call(url);
    assert.equal(res.status, 400, url);
    assert.equal(json(res).error, 'bad_url');
  }
  assert.deepEqual(s.calls, []);
});

test('starší súbor z disku mimo okna: len pri predvolenom dopyte a najviac 30 dní', async () => {
  assert.equal(STALE_DISK_MAX_DAYS, 30);
  const s = await setup(async () => status(404));
  await fsp.mkdir(s.dir, { recursive: true });
  await fsp.writeFile(path.join(s.dir, '20250301.geojson'), JSON.stringify(polygon(36)));
  const explicit = await s.call('/api/deepstate/analytics?date=20250310&maxFallback=0');
  assert.equal(explicit.status, 404, 'výslovný dátum dostane poctivé „nie je", nie náhodný starý súbor');
  const old = await s.call('/api/deepstate/analytics?maxFallback=1');
  assert.equal(old.status, 404, 'súbor spred 30+ dní sa pri predvolenom dopyte neponúkne');
});

test('vyčerpaný čas (30 s) bez chyby = 503 upstream_slow, nie „žiadne dáta"', async () => {
  let t = NOW;
  const s = await setup(async () => { t += 29_500; return status(404); }, { now: () => t });
  const res = await s.call('/api/deepstate/analytics');
  assert.equal(res.status, 503);
  const body = json(res);
  assert.equal(body.error, 'upstream_slow');
  assert.equal(body.checkedDays, 1, 'skontrolovaný je len deň, na ktorý GitHub naozaj odpovedal');
  assert.equal(body.unresolvedDays, 7);
  assert.equal(res.headers['Retry-After'], '30');
});
