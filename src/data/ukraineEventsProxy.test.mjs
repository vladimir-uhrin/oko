// src/data/ukraineEventsProxy.test.mjs — archivár + /api/ukraine/events: tiky
// so vstreknutým fetch (vlastné proxy, médiá), rozsah dní, odpoveď, gzip, stav,
// časovače štart/stop. Bez siete, dočasný koreň.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';

import { EVENTS_MAX_DAYS, ukraineEventsProxy } from './ukraineEventsProxy.js';

const NOW = Date.UTC(2026, 8, 19, 12);
const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ukr-proxy-'));
const response = (body, { status = 200, headers = {} } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => JSON.parse(String(body)),
  arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
});
function fakeRes() {
  const out = { status: 0, headers: {}, body: null };
  return { out, writeHead(s, h) { out.status = s; out.headers = h; }, end(b) { out.body = b; } };
}
const decode = (res) => JSON.parse((res.out.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(res.out.body) : res.out.body).toString('utf8'));
async function call(plugin, url, { gzip = false } = {}) {
  const server = { middlewares: { use: (p, h) => { server.handler = h; } }, httpServer: null };
  plugin.configureServer(server);
  const res = fakeRes();
  await server.handler({ method: 'GET', url, headers: gzip ? { 'accept-encoding': 'gzip, deflate' } : {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
}

test('archivár: tik správ (unfurl náhľadu cez vlastnú proxy) a tik médií zapíšu dni, odpoveď ich vráti', async () => {
  const root = await tmpRoot();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/api/situation-news')) return response(JSON.stringify({ items: [
      { title: 'Russian strike on Kharkiv kills 2', url: 'https://news/1', source: 'BBC News', publishedAt: Date.UTC(2026, 8, 19, 9), image: null },
      { title: 'RFE item', url: 'https://news/2', source: 'RFE/RL', publishedAt: Date.UTC(2026, 8, 18, 9), image: null, noImage: true },
      { title: 'no time', url: 'https://news/3' },
    ] }));
    if (url.includes('/api/link-image')) return response(JSON.stringify({ image: 'https://img/1.jpg' }));
    if (url.includes('/api/ukraine/report')) return response(JSON.stringify({ ok: true, reportedAt: '2026-09-19T05:00:00.000Z', total: 213, directions: [{ name: 'x' }], fetchedAt: NOW }));
    if (url.includes('channel_id=UCGAC5yzlYgjKoJABDZ7zEyw')) return response('<feed xmlns:yt="x" xmlns:media="y"><entry><yt:videoId>abcdefgh</yt:videoId><title>Drone strike on Kharkiv</title><published>2026-09-19T10:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/abcdefgh/hqdefault.jpg"/><media:description>x</media:description></media:group></entry></feed>');
    return response('', { status: 503 });
  };
  const plugin = ukraineEventsProxy({ root, env: {}, fetchImpl, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {} });
  plugin._start('http://127.0.0.1:4173');
  await plugin._tick('news');
  assert.equal(plugin._state.last.news.result.added, 2);
  assert.equal(plugin._state.last.news.result.unfurled, 1, 'noImage sa neunfurluje');
  assert.ok(calls.some((u) => u === 'http://127.0.0.1:4173/api/link-image?url=' + encodeURIComponent('https://news/1')));
  await plugin._tick('media');
  assert.equal(plugin._state.last.media.result.items, 1, 'jeden YouTube kanál prešiel, ostatné zlyhali samostatne');
  await plugin._tick('report');
  assert.equal(plugin._state.last.report.result.status, 'stored');
  const res = await call(plugin, '/?from=2026-09-18&to=2026-09-19', { gzip: true });
  assert.equal(res.out.status, 200);
  assert.equal(res.out.headers['Content-Encoding'], 'gzip');
  const json = decode(res);
  assert.equal(json.days, 2);
  assert.equal(json.news.length, 2);
  assert.equal(json.news.find((n) => n.url === 'https://news/1').image, 'https://img/1.jpg');
  assert.equal(json.media.length, 1);
  assert.equal(json.reports['2026-09-19'].total, 213);
  assert.deepEqual(json.coverage.news, ['2026-09-18', '2026-09-19']);
  assert.equal(json.archiver.enabled, true);
  const status = await call(plugin, '/status');
  assert.equal(status.out.status, 200);
  assert.equal(decode(status).base, 'http://127.0.0.1:4173');
  const summary = await call(plugin, '/summary?from=2026-09-01&to=2026-09-19');
  assert.equal(decode(summary).days['2026-09-19'].news, 1);
  assert.equal(decode(summary).days['2026-09-19'].media, 1);
  assert.equal(decode(summary).days['2026-09-19'].report.total, 213);
  // kontrola: bez snímky 404 s poctivým kódom, po tiku snímka platná pre deň
  const none = await call(plugin, '/control?at=2026-09-19');
  assert.equal(none.out.status, 404);
  assert.equal(decode(none).error, 'no_control_snapshot');
  assert.equal((await call(plugin, '/control?at=zle')).out.status, 400);
});

test('kontrola cez proxy: tik stiahne moduly Wikipédie, /control vráti snímku platnú pre deň', async () => {
  const root = await tmpRoot();
  const lua = 'mk = { rus = "Location dot red.svg" }\nreturn { marks = { { lat = "48.282", long = "37.185", mark = mk.rus, marksize = 14, label = "[[Pokrovsk]]" } } }';
  const wiki = JSON.stringify({ query: { pages: [{ title: 'x', revisions: [{ revid: 7, timestamp: '2026-09-18T10:00:00Z', size: 1, slots: { main: { content: lua } } }] }] } });
  const fetchImpl = async (url) => (url.includes('wikipedia.org') ? response(wiki) : response('', { status: 503 }));
  const plugin = ukraineEventsProxy({ root, env: {}, fetchImpl, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {} });
  plugin._start('http://127.0.0.1:4173');
  await plugin._tick('control');
  assert.equal(plugin._state.last.control.result.status, 'updated');
  const res = await call(plugin, '/control?at=2026-09-19');
  assert.equal(res.out.status, 200);
  const json = decode(res);
  assert.equal(json.count, 1);
  assert.equal(json.points[0].name, 'Pokrovsk');
  assert.equal(json.requestedAt, '2026-09-19');
  assert.equal(json.snapshots, 1);
  assert.equal((await call(plugin, '/control?at=2026-09-01')).out.status, 404, 'pred prvou snímkou nič');
  await plugin._tick('fires');
  assert.match(plugin._state.last.fires.result.status, /error|stale/);
});

test('validácia rozsahu, metóda, vypnutý archivár, časovače', async () => {
  const root = await tmpRoot();
  const timers = []; const cleared = [];
  const plugin = ukraineEventsProxy({ root, env: { UKRAINE_ARCHIVE: 'off' }, fetchImpl: async () => { throw new Error('no network'); }, now: () => NOW, setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: (id) => cleared.push(id), log: () => {} });
  plugin._start('http://127.0.0.1:4173');
  assert.equal(timers.length, 0, 'vypnutý archivár nič neplánuje');
  assert.equal(decode(await call(plugin, '/?from=2026-09-19')).days, 1, 'to = from');
  assert.equal((await call(plugin, '/?from=2026-13-01&to=2026-09-19')).out.status, 400);
  assert.equal((await call(plugin, '/?from=2026-09-19&to=2026-09-18')).out.status, 400);
  const tooLong = await call(plugin, `/?from=2026-01-01&to=2026-09-19`);
  assert.equal(tooLong.out.status, 400);
  assert.equal(decode(tooLong).maxDays, EVENTS_MAX_DAYS);
  const empty = decode(await call(plugin, '/?from=2026-09-10&to=2026-09-12'));
  assert.deepEqual(empty.counts, { viina: 0, geoconfirmed: 0, news: 0, media: 0, reports: 0, fires: 0 });
  assert.equal(empty.archiver.enabled, false);
  const server = { middlewares: { use: (p, h) => { server.handler = h; } }, httpServer: null };
  plugin.configureServer(server);
  const res = fakeRes();
  await server.handler({ method: 'POST', url: '/', headers: {}, socket: {} }, res);
  assert.equal(res.out.status, 405);
  const on = ukraineEventsProxy({ root, env: {}, fetchImpl: async () => { throw new Error('no network'); }, now: () => NOW, setTimer: (fn, ms) => { timers.push(ms); return timers.length; }, clearTimer: (id) => cleared.push(id), log: () => {} });
  on._start('http://127.0.0.1:4173');
  assert.equal(timers.length, 7, 'sedem úloh naplánovaných (správy, médiá, GŠ, GeoConfirmed, VIINA, kontrola, požiare)');
  on._stop();
  assert.equal(cleared.length >= 7, true);
  await on._tick('news');
  assert.match(on._state.last.news.error, /no network/);
  assert.equal(on._state.errors.length, 1);
});
