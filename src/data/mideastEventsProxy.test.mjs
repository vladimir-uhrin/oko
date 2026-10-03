// src/data/mideastEventsProxy.test.mjs — archivár + /api/mideast/events modulu
// BLÍZKY VÝCHOD (etapa 2, 2026-09-26): tik kontroly so vstreknutým fetch (mock
// MediaWiki podľa titulu), /control po moduloch (404 → 200 po tiku, 400 bad_module /
// bad_day, izolácia modulov), gzip, 405, časovače rozostúpené po minúte, /status bez
// textov chýb. Bez siete, dočasný koreň, falošný server ako pri ukraineEventsProxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';

import { AIRSPACE_FIRST_DELAY_MS, AIRSPACE_TICK_MS, UKMTO_FIRST_DELAY_MS, UKMTO_TICK_MS, CONTROL_FIRST_DELAY_MS, CONTROL_STAGGER_MS, CONTROL_TICK_MS, MIDEAST_EVENTS_MOUNT, PORTWATCH_FIRST_DELAY_MS, PORTWATCH_TICK_MS, acceptsGzip, controlJobName, mideastEventsProxy } from './mideastEventsProxy.js';
import { MIDEAST_CONTROL_MODULE_IDS } from './wikiControl.js';
import { controlFile } from '../../scripts/lib/mideastArchive.mjs';

const NOW = Date.UTC(2026, 8, 24, 12); // 24. 9. 2026 — deň surových fixtúr modulov
const tmpRoot = async () => fsp.mkdtemp(path.join(os.tmpdir(), 'oko-mideast-proxy-'));
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
function mount(plugin) {
  const server = { middlewares: { use: (p, h) => { server.mountPath = p; server.handler = h; } }, httpServer: null };
  plugin.configureServer(server);
  return server;
}
async function call(plugin, url, { gzip = false, method = 'GET', headers = null } = {}) {
  const server = mount(plugin);
  const res = fakeRes();
  await server.handler({ method, url, headers: headers || (gzip ? { 'accept-encoding': 'gzip, deflate' } : {}), socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
}

/** 12 izraelských/palestínskych sídiel — dosť na telo > 1 KiB (gzip). */
const IP_MARKS = Array.from({ length: 12 }, (_, i) => `{ lat = "${(31.3 + i * 0.05).toFixed(3)}", long = "${(34.4 + i * 0.03).toFixed(3)}", mark = "${i % 3 === 0 ? 'Location dot lime.svg' : (i % 3 === 1 ? 'Location dot blue.svg' : 'Location dot green.svg')}", marksize = "14", label = "[[Settlement number ${i} with a long descriptive name]]" }`).join(',\n');
const LUA_IP = `return { marks = {\n${IP_MARKS}\n} }`;
const LUA_LEBANON = 'return { marks = {\n{ lat = "33.886", long = "35.505", mark = "Map-dot-grey-68a.svg", marksize = "32", label = "[[Beirut]]" },\n{ lat = "33.9", long = "35.6", mark = "Weird icon.svg", marksize = "8", label = "[[Nikde]]" },\n} }';
const wikiJson = (revid, content, timestamp) => JSON.stringify({ query: { pages: [{ title: 'x', revisions: [{ revid, timestamp, size: content.length, slots: { main: { content } } }] }] } });
const wikiFetch = async (url) => {
  if (!url.includes('wikipedia.org')) return response('', { status: 503 });
  const title = new URL(url).searchParams.get('titles') || '';
  if (title.includes('Israeli-Palestinian')) return response(wikiJson(303, LUA_IP, '2026-09-24T09:15:00Z'));
  if (title.includes('Lebanese insurgency')) return response(wikiJson(202, LUA_LEBANON, '2026-09-23T20:00:00Z'));
  return response(JSON.stringify({ query: { pages: [{ title, revisions: [] }] } }));
};
const makePlugin = (root, extra = {}) => mideastEventsProxy({ root, env: {}, fetchImpl: wikiFetch, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {}, ...extra });

test('montáž a mená úloh: /api/mideast/events, jedna úloha control:<modul> na každý modul', async () => {
  const plugin = makePlugin(await tmpRoot());
  assert.equal(plugin.name, 'mideast-events-proxy');
  assert.equal(MIDEAST_EVENTS_MOUNT, '/api/mideast/events');
  assert.equal(mount(plugin).mountPath, '/api/mideast/events');
  assert.equal(controlJobName('yemen'), 'control:yemen');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
});

test('/control: 404 pred snímkou, po tiku 200 s bodmi a metadátami, izolácia modulov, cache po module', async () => {
  const root = await tmpRoot();
  const plugin = makePlugin(root);
  plugin._start('http://127.0.0.1:4173');
  const none = await call(plugin, '/control?module=israel-palestine&at=2026-09-24');
  assert.equal(none.out.status, 404);
  assert.deepEqual(decode(none), { error: 'no_control_snapshot', module: 'israel-palestine', at: '2026-09-24', days: 0 });
  assert.equal(none.out.headers['Cache-Control'], 'no-store');
  await plugin._tick('control:israel-palestine');
  const last = plugin._state.last['control:israel-palestine'];
  assert.equal(last.result.status, 'updated');
  assert.equal(last.result.count, 12);
  assert.equal(last.result.day, '2026-09-24');
  assert.deepEqual(last.result.unmapped, {});
  const res = await call(plugin, '/control?module=israel-palestine&at=2026-09-24', { gzip: true });
  assert.equal(res.out.status, 200);
  assert.equal(res.out.headers['Content-Encoding'], 'gzip', 'telo > 1 KiB sa komprimuje');
  assert.equal(res.out.headers['Cache-Control'], 'public, max-age=60');
  const json = decode(res);
  assert.equal(json.module, 'israel-palestine');
  assert.equal(json.kind, 'control');
  assert.equal(json.count, 12);
  assert.equal(json.points.length, 12);
  assert.equal(json.points[1].side, 'israel');
  assert.equal(json.points[0].side, 'hamas');
  assert.equal(json.points[2].side, 'pa');
  assert.equal(json.requestedAt, '2026-09-24');
  assert.equal(json.snapshots, 1);
  assert.equal(json.first, '2026-09-24');
  assert.equal(json.last, '2026-09-24');
  assert.equal(json.revisionAt, '2026-09-24T09:15:00Z');
  assert.equal(json.license, 'CC BY-SA 4.0');
  assert.equal(json.revisions.main.revid, 303);
  assert.match(json.attribution, /Wikipedia contributors · Module:Israeli-Palestinian conflict detailed map · CC BY-SA 4.0/);
  assert.equal(json.source, 'https://en.wikipedia.org/wiki/Module:Israeli-Palestinian_conflict_detailed_map');
  assert.equal(json.summary.settlements.israel, 4);
  assert.equal(json.summary.settlements.hamas, 4);
  assert.equal(json.summary.settlements.pa, 4);
  assert.deepEqual(json.summary.unmapped, {});
  // bez `at` = dnes; skorší deň pred prvou snímkou = 404; neskorší deň dostane poslednú snímku
  assert.equal(decode(await call(plugin, '/control?module=israel-palestine')).requestedAt, '2026-09-24');
  assert.equal((await call(plugin, '/control?module=israel-palestine&at=2026-09-01')).out.status, 404, 'pred prvou snímkou nič');
  assert.equal(decode(await call(plugin, '/control?module=israel-palestine&at=2026-10-05')).requestedAt, '2026-10-05');
  // izolácia: Libanon nemá snímku, kým jeho úloha nebeží; potom má vlastnú legendu
  assert.equal((await call(plugin, '/control?module=lebanon&at=2026-09-24')).out.status, 404);
  assert.equal((await call(plugin, '/control?module=yemen&at=2026-09-24')).out.status, 404);
  await plugin._tick('control:lebanon');
  assert.deepEqual(plugin._state.last['control:lebanon'].result.unmapped, { 'Weird icon.svg': 1 }, 'neznáma ikona sa hlási, nie zaraďuje');
  const lb = decode(await call(plugin, '/control?module=lebanon&at=2026-09-24'));
  assert.equal(lb.count, 1);
  assert.equal(lb.points[0].side, 'laf');
  assert.deepEqual(lb.summary.unmapped, { 'Weird icon.svg': 1 });
  assert.equal(decode(await call(plugin, '/control?module=israel-palestine&at=2026-09-24')).count, 12, 'cache IP ostala po tiku Libanonu');
  // modul bez revízie: úloha skončí poctivo error, /control ostáva 404
  await plugin._tick('control:yemen');
  assert.equal(plugin._state.last['control:yemen'].result.status, 'error');
  assert.match(plugin._state.last['control:yemen'].result.error, /no revision/);
  assert.equal((await call(plugin, '/control?module=yemen&at=2026-09-24')).out.status, 404);
  await plugin._tick('control:neexistuje');
  assert.equal(plugin._state.last['control:neexistuje'], undefined, 'neznáma úloha sa ticho ignoruje');
});

test('validácia: bad_module so zoznamom modulov, bad_day, 405 pre iné metódy, neznáma trasa 404, zlé URL', async () => {
  const plugin = makePlugin(await tmpRoot());
  const noModule = await call(plugin, '/control?at=2026-09-24');
  assert.equal(noModule.out.status, 400);
  assert.deepEqual(decode(noModule), { error: 'bad_module', modules: [...MIDEAST_CONTROL_MODULE_IDS] });
  const wrong = await call(plugin, '/control?module=ukraine&at=2026-09-24');
  assert.equal(wrong.out.status, 400);
  assert.equal(decode(wrong).error, 'bad_module', 'Ukrajina má vlastnú trasu /api/ukraine/events/control');
  const badDay = await call(plugin, '/control?module=lebanon&at=2026-13-01');
  assert.equal(badDay.out.status, 400);
  assert.deepEqual(decode(badDay), { error: 'bad_day' });
  assert.equal((await call(plugin, '/control?module=lebanon&at=zle')).out.status, 400);
  const post = await call(plugin, '/control?module=lebanon', { method: 'POST' });
  assert.equal(post.out.status, 405);
  assert.equal((await call(plugin, '/status', { method: 'DELETE' })).out.status, 405);
  const other = await call(plugin, '/?from=2026-09-24');
  assert.equal(other.out.status, 404, 'udalosti prídu v ďalších etapách — kým nie, poctivé 404');
  assert.deepEqual(decode(other).routes, ['/status', '/control?module=<id>&at=YYYY-MM-DD', '/portwatch?keys=<k,…>&days=N', '/airspace', '/ukmto?days=N']);
  const server = mount(plugin);
  const res = fakeRes();
  await server.handler({ method: 'GET', url: 'http://[zle', headers: {}, socket: {} }, res);
  assert.equal(res.out.status, 400, 'nevalidná URL nezhodí server');
  assert.equal(decode(res).error, 'bad_url');
});

test('časovače: štyri úlohy rozostúpené po minúte od 200 s, vypnutý archivár nič neplánuje, stop ruší', async () => {
  const root = await tmpRoot();
  const timers = []; const cleared = [];
  const setTimer = (fn, ms) => { timers.push(ms); return timers.length; };
  const clearTimer = (id) => cleared.push(id);
  const off = mideastEventsProxy({ root, env: { MIDEAST_ARCHIVE: 'off' }, fetchImpl: wikiFetch, now: () => NOW, setTimer, clearTimer, log: () => {} });
  off._start('http://127.0.0.1:4173');
  assert.equal(timers.length, 0, 'MIDEAST_ARCHIVE=off nič neplánuje');
  assert.equal(off._state.enabled, false);
  assert.equal((await call(off, '/control?module=lebanon&at=2026-09-24')).out.status, 404, 'trasa funguje aj s vypnutým archivárom');
  const on = mideastEventsProxy({ root, env: {}, fetchImpl: wikiFetch, now: () => NOW, setTimer, clearTimer, log: () => {} });
  on._start('http://127.0.0.1:4173');
  assert.equal(timers.length, 7, 'jedna úloha na modul + PortWatch (etapa 5a) + vzdušný priestor (5b) + UKMTO (5c)');
  assert.deepEqual(timers, [200_000, 260_000, 320_000, 380_000, 440_000, 500_000, 560_000], 'prvé spustenia rozostúpené o minútu (Wikipedia: jeden dopyt naraz), PortWatch, EASA a UKMTO po nich');
  assert.equal(CONTROL_FIRST_DELAY_MS, 200_000);
  assert.equal(CONTROL_STAGGER_MS, 60_000);
  assert.equal(CONTROL_TICK_MS, 6 * 60 * 60_000);
  assert.equal(PORTWATCH_FIRST_DELAY_MS, 440_000);
  assert.equal(PORTWATCH_TICK_MS, 6 * 60 * 60_000);
  assert.equal(AIRSPACE_FIRST_DELAY_MS, 500_000);
  assert.equal(AIRSPACE_TICK_MS, 6 * 60 * 60_000);
  assert.equal(UKMTO_FIRST_DELAY_MS, 560_000);
  assert.equal(UKMTO_TICK_MS, 60 * 60_000, 'varovania pre lode sa pýtajú raz za hodinu');
  assert.equal(on._state.base, 'http://127.0.0.1:4173');
  on._stop();
  assert.ok(cleared.length >= 7, 'stop zruší všetky časovače');
});

test('stop počas rozbehnutého tiku: po await sa úloha znova nenaplánuje (zatvorený server = žiadny zombie archivár); bez stopu sa preplánuje na 6 h; reštart nezdvojí', async () => {
  const root = await tmpRoot();
  const armed = [];
  const setTimer = (fn, ms) => { armed.push({ fn, ms }); return armed.length; };
  const clearTimer = () => {};
  // brána: fetch čaká, kým test nepovie (ako 60 s dopyt na Wikipédiu)
  let release; const gate = new Promise((r) => { release = r; });
  const slowFetch = async (url) => { await gate; return wikiFetch(url); };
  const plugin = mideastEventsProxy({ root, env: {}, fetchImpl: slowFetch, now: () => NOW, setTimer, clearTimer, log: () => {} });
  plugin._start('http://127.0.0.1:4173');
  assert.equal(armed.length, 7, '4 moduly + PortWatch + vzdušný priestor + UKMTO');
  assert.equal(armed[0].ms, CONTROL_FIRST_DELAY_MS);
  const inflight = armed[0].fn(); // časovač control:israel-palestine vystrelil, tik čaká na Wikipédiu
  await new Promise((r) => setImmediate(r));
  assert.equal(plugin._state.running['control:israel-palestine'], true, 'tik beží');
  plugin._stop(); // server zavrel (reštart Vite) uprostred dopytu
  release();
  await inflight;
  assert.equal(armed.length, 7, 'po stop() sa rozbehnutý tik NEpreplánuje');
  assert.equal(plugin._state.running['control:israel-palestine'], false);
  assert.equal(plugin._state.last['control:israel-palestine'].result.status, 'updated', 'rozbehnutý tik poctivo dobehne a snímku uloží');
  // bez stopu: spätné volanie sa po tiku preplánuje presne na tik 6 h
  const armed2 = [];
  const live = mideastEventsProxy({ root: await tmpRoot(), env: {}, fetchImpl: wikiFetch, now: () => NOW, setTimer: (fn, ms) => { armed2.push({ fn, ms }); return armed2.length; }, clearTimer, log: () => {} });
  live._start('http://127.0.0.1:4173');
  await armed2[3].fn(); // control:lebanon
  assert.equal(armed2.length, 8, 'jeden nový časovač');
  assert.equal(armed2[7].ms, CONTROL_TICK_MS);
  // reštart (stop + start) počas tiku: nová generácia si naplánuje svojich 7, starý tik nepridá ďalší
  const armed3 = [];
  let release3; const gate3 = new Promise((r) => { release3 = r; });
  const restart = mideastEventsProxy({ root: await tmpRoot(), env: {}, fetchImpl: async (url) => { await gate3; return wikiFetch(url); }, now: () => NOW, setTimer: (fn, ms) => { armed3.push({ fn, ms }); return armed3.length; }, clearTimer, log: () => {} });
  restart._start('http://127.0.0.1:4173');
  const old = armed3[0].fn();
  await new Promise((r) => setImmediate(r));
  restart._stop();
  restart._start('http://127.0.0.1:4173');
  assert.equal(armed3.length, 14, 'nový štart naplánoval svojich 7');
  release3();
  await old;
  assert.equal(armed3.length, 14, 'starý tik z predošlej generácie nič nepridal');
});

test('gzip len pri výslovnom tokene s q > 0, Vary: Accept-Encoding na každej stlačiteľnej 200, nie na malých ani chybových', async () => {
  assert.equal(acceptsGzip('gzip, deflate'), true);
  assert.equal(acceptsGzip('GZIP;q=0.5'), true, 'bez rozlíšenia veľkosti písmen');
  assert.equal(acceptsGzip('gzip;q=0, identity'), false, 'q=0 je odmietnutie');
  assert.equal(acceptsGzip('gzip; q=0.000'), false);
  assert.equal(acceptsGzip('gzip;q=zle'), false, 'nečitateľné q = identita (vždy bezpečná)');
  assert.equal(acceptsGzip('deflate, br'), false);
  assert.equal(acceptsGzip('*'), false, 'hviezdička sa zámerne neberie');
  assert.equal(acceptsGzip('x-gzip'), false);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip(undefined), false);
  const root = await tmpRoot();
  const plugin = makePlugin(root);
  await plugin._tick('control:israel-palestine');
  const url = '/control?module=israel-palestine&at=2026-09-24';
  const refused = await call(plugin, url, { headers: { 'accept-encoding': 'gzip;q=0, identity' } });
  assert.equal(refused.out.status, 200);
  assert.equal(refused.out.headers['Content-Encoding'], undefined, 'gzip;q=0 nedostane gzip');
  assert.equal(refused.out.headers.Vary, 'Accept-Encoding', 'aj nestlačená odpoveď nesie Vary — telo závisí od hlavičky');
  assert.equal(decode(refused).count, 12);
  const none = await call(plugin, url, { headers: { 'accept-encoding': 'deflate, br' } });
  assert.equal(none.out.headers['Content-Encoding'], undefined);
  assert.equal(none.out.headers.Vary, 'Accept-Encoding');
  const yes = await call(plugin, url, { headers: { 'accept-encoding': 'GZIP;q=0.5' } });
  assert.equal(yes.out.headers['Content-Encoding'], 'gzip');
  assert.equal(yes.out.headers.Vary, 'Accept-Encoding');
  assert.equal(yes.out.headers['Cache-Control'], 'public, max-age=60');
  assert.equal(decode(yes).count, 12);
  const bare = await call(plugin, url);
  assert.equal(bare.out.headers['Content-Encoding'], undefined, 'bez Accept-Encoding identita');
  assert.equal(bare.out.headers.Vary, 'Accept-Encoding');
  const small = await call(plugin, '/control?module=lebanon&at=2026-09-24', { gzip: true });
  assert.equal(small.out.status, 404);
  assert.equal(small.out.headers.Vary, undefined, 'chybová odpoveď (a telo ≤ 1 KiB) bez Vary a bez gzipu');
  assert.equal(small.out.headers['Content-Encoding'], undefined);
  const status = await call(plugin, '/status', { gzip: true });
  assert.equal(status.out.headers.Vary, undefined, '/status je malý → nestlačiteľný, bez Vary');
});

test('/control: nečitateľná snímka nezakryje staršiu (200 zo staršej), a keď je nečitateľné všetko ≤ at → 500 archive_read_failed, nie 404', async () => {
  const root = await tmpRoot();
  const plugin = makePlugin(root);
  await plugin._tick('control:israel-palestine'); // 2026-09-24.json platný
  await fsp.writeFile(controlFile(root, 'israel-palestine', '2026-09-25'), '{"day":"2026-09-25","points":[', 'utf8'); // orezaný súbor
  const fallback = await call(plugin, '/control?module=israel-palestine&at=2026-09-25');
  assert.equal(fallback.out.status, 200, 'staršia platná snímka sa nájde');
  const json = decode(fallback);
  assert.deepEqual([json.day, json.count, json.requestedAt, json.snapshots, json.first, json.last], ['2026-09-24', 12, '2026-09-25', 2, '2026-09-24', '2026-09-25']);
  // aj jediná platná sa pokazí → všetko ≤ at nečitateľné = chyba archívu (iný kľúč cache než hore)
  await fsp.writeFile(controlFile(root, 'israel-palestine', '2026-09-24'), 'nie JSON', 'utf8');
  const broken = await call(plugin, '/control?module=israel-palestine&at=2026-09-26');
  assert.equal(broken.out.status, 500);
  assert.deepEqual(decode(broken), { error: 'archive_read_failed' }, 'bez detailu — ide von cez tunel');
  assert.equal(broken.out.headers['Cache-Control'], 'no-store');
  const s = decode(await call(plugin, '/status'));
  assert.equal(s.errors, 1, 'chyba archívu sa počíta v /status (len počet)');
  assert.equal(typeof s.lastErrorAt, 'number');
  assert.equal(s.control['israel-palestine'].snapshots, 2, 'index z adresára vidí oba súbory');
  assert.equal(decode(await call(plugin, '/control?module=israel-palestine&at=2026-09-25')).count, 12, 'cache z prvého dopytu ostáva 10 min');
  assert.equal((await call(plugin, '/control?module=israel-palestine&at=2026-09-23')).out.status, 404, 'pred prvým dňom ostáva poctivé 404');
  assert.equal((await call(plugin, '/control?module=yemen&at=2026-09-26')).out.status, 404, 'modul bez snímok = 404, nie 500');
});

test('/status je verejný: počty a časy, žiadne texty chýb; vnútorný _state ich má', async () => {
  const root = await tmpRoot();
  const plugin = mideastEventsProxy({ root, env: {}, fetchImpl: async () => { throw new Error('SECRET-no-network-detail'); }, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {} });
  plugin._start('http://127.0.0.1:4173');
  const before = await call(plugin, '/status');
  assert.equal(before.out.status, 200);
  const s0 = decode(before);
  assert.equal(s0.enabled, true);
  assert.equal(s0.now, NOW);
  assert.equal(s0.errors, 0);
  assert.deepEqual(s0.last, {});
  assert.deepEqual(s0.control.lebanon, { snapshots: 0, first: null, last: null });
  assert.deepEqual(Object.keys(s0.control), [...MIDEAST_CONTROL_MODULE_IDS]);
  await plugin._tick('control:lebanon');
  // knižnica zlyhanie zachytí a vráti status 'error' s textom — ten ostáva len v _state
  assert.equal(plugin._state.last['control:lebanon'].result.status, 'error');
  assert.match(plugin._state.last['control:lebanon'].result.error, /SECRET-no-network-detail/);
  const after = await call(plugin, '/status');
  const text = after.out.body.toString('utf8');
  assert.doesNotMatch(text, /SECRET-no-network-detail/, 'text chyby nesmie ísť von cez tunel');
  const s1 = JSON.parse(text);
  assert.equal(s1.last['control:lebanon'].ok, false);
  assert.equal(s1.last['control:lebanon'].status, 'error');
  assert.equal(s1.last['control:lebanon'].count, 0);
  assert.equal(typeof s1.last['control:lebanon'].at, 'number');
  assert.equal(s1.errors, 0, 'chyba zachytená knižnicou nie je výnimka úlohy');
  assert.equal(s1.base, undefined, 'vnútorná adresa servera sa nezverejňuje');
  // výnimka úlohy (nie výsledok) ide do state.errors — von len počet
  const boom = mideastEventsProxy({ root, env: {}, fetchImpl: wikiFetch, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {} });
  const origFor = boom._tick;
  await origFor('control:israel-palestine');
  assert.equal(boom._state.last['control:israel-palestine'].result.status, 'updated');
  const s2 = decode(await call(boom, '/status'));
  assert.equal(s2.last['control:israel-palestine'].ok, true);
  assert.equal(s2.last['control:israel-palestine'].count, 12);
  assert.equal(s2.last['control:israel-palestine'].revisionAt, '2026-09-24T09:15:00Z');
  assert.deepEqual(s2.control['israel-palestine'], { snapshots: 1, first: '2026-09-24', last: '2026-09-24' });
  assert.equal(s2.errors, 0);
  assert.equal(s2.lastErrorAt, null);
});

/** Falošný ArcGIS pre PortWatch: pre každú úžinu 60 dní do 20. 9. 2026 (počet = 10 + index úžiny). */
const pwFetch = (calls = []) => async (url) => {
  if (!url.includes('arcgis.com')) return wikiFetch(url);
  calls.push(url);
  const portid = /portid='([^']+)'/.exec(new URL(url).searchParams.get('where') || '')?.[1] || '';
  const n = Number(portid.replace('chokepoint', '')) || 0;
  const features = [];
  for (let i = 59; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(2026, 8, 20) - i * 86_400_000).toISOString().slice(0, 10);
    features.push({ attributes: { date: d, n_total: 10 + n, n_tanker: n, n_container: 0, n_dry_bulk: 0, n_general_cargo: 0, n_roro: 0, capacity: 1000, capacity_tanker: 0 } });
  }
  return response(JSON.stringify({ features }));
};

test('/portwatch (etapa 5a): 404 pred sťahovaním, úloha stiahne štyri úžiny postupne, chvost + priemer pred krízou, allowlist kľúčov, orez dní, cache', async () => {
  const root = await tmpRoot();
  const calls = [];
  const slept = [];
  const plugin = makePlugin(root, { fetchImpl: pwFetch(calls), sleep: async (ms) => { slept.push(ms); } });
  const before = await call(plugin, '/portwatch?keys=hormuz');
  assert.equal(before.out.status, 404);
  assert.deepEqual(decode(before), { error: 'no_portwatch_snapshot', keys: ['hormuz'] });
  await plugin._tick('portwatch');
  assert.equal(calls.length, 4, 'jedna strana na úžinu');
  assert.deepEqual(calls.map((u) => /portid='([^']+)'/.exec(new URL(u).searchParams.get('where'))[1]), ['chokepoint6', 'chokepoint4', 'chokepoint1', 'chokepoint7']);
  assert.deepEqual(slept, [1500, 1500, 1500], 'pauza medzi úžinami, nie pred prvou');
  assert.equal(plugin._state.last.portwatch.result.status, 'updated');
  assert.equal(plugin._state.last.portwatch.result.day, '2026-09-20');
  const ok = await call(plugin, '/portwatch?keys=hormuz,cape&days=45', { gzip: true });
  assert.equal(ok.out.status, 200);
  const json = decode(ok);
  assert.deepEqual(json.chokepoints.map((c) => c.key), ['hormuz', 'cape']);
  assert.equal(json.chokepoints[0].rows.length, 45);
  assert.equal(json.chokepoints[0].rows.at(-1)[1], 16, 'Hormuz = chokepoint6 → 16/deň v syntetickej sérii');
  assert.equal(json.chokepoints[0].baseline.id, 'iran-war');
  assert.equal(json.chokepoints[0].baseline.mean, null, 'syntetická séria nesiaha do okna pred krízou → null, nie vymyslené číslo');
  assert.match(json.attribution, /International Monetary Fund/);
  // orez dní na 30–1 000 a allowlist
  assert.equal(decode(await call(plugin, '/portwatch?keys=suez&days=5')).chokepoints[0].rows.length, 30);
  const bad = await call(plugin, '/portwatch?keys=hormuz,../etc');
  assert.equal(bad.out.status, 400);
  assert.deepEqual(decode(bad), { error: 'bad_keys', keys: ['hormuz', 'bab-el-mandeb', 'suez', 'cape'] });
  assert.equal((await call(plugin, '/portwatch?keys=')).out.status, 200, 'prázdne keys = všetky štyri');
  // /status ukazuje úlohu PortWatch bez textov chýb
  const s = decode(await call(plugin, '/status'));
  assert.equal(s.last.portwatch.ok, true);
  assert.equal(s.last.portwatch.count, 240);
});

// VZDUŠNÝ PRIESTOR (etapa 5b, 2026-10-03): skutočné odpovede EASA a výrez VATSpy z fixtúr.
const fixtureText = (name) => fsp.readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
async function airspaceFetch(calls) {
  const exportAll = JSON.parse(await fixtureText('easa-czib-export-20261003.json')).conflict_zones;
  const exportBody = JSON.stringify({ conflict_zones: exportAll.filter((r) => ['143862', '143899'].includes(r.Nid)) });
  const feed = await fixtureText('easa-czib-feed-20261003.xml');
  const pages = { 'czib-2026-05-r2': await fixtureText('easa-czib-iraq-20261003.html'), 'czib-2026-07r3': await fixtureText('easa-czib-gulf-20261003.html') };
  const boundaries = await fixtureText('vatspy-boundaries-sample-20261003.geojson');
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('export-json')) return response(exportBody);
    if (String(url).endsWith('feed.xml')) return response(feed);
    if (String(url).includes('vatspy-data-project')) return response(boundaries);
    const slug = String(url).split('/').pop();
    return pages[slug] ? response(pages[slug]) : response('nope', { status: 404 });
  };
}

test('/airspace (etapa 5b): 404 pred stiahnutím, úloha stiahne bulletiny EASA a hranice FIR, telo s polygónmi, cache', async () => {
  const root = await tmpRoot();
  const calls = [];
  const slept = [];
  const plugin = makePlugin(root, { fetchImpl: await airspaceFetch(calls), sleep: async (ms) => { slept.push(ms); } });
  const before = await call(plugin, '/airspace');
  assert.equal(before.out.status, 404);
  assert.deepEqual(decode(before), { error: 'no_airspace_snapshot' });
  await plugin._tick('airspace');
  assert.equal(plugin._state.last.airspace.result.status, 'updated');
  assert.equal(plugin._state.last.airspace.result.count, 2);
  assert.equal(calls.length, 5, 'export + RSS + 2 stránky + hranice FIR');
  assert.deepEqual(slept, [1200], 'pauza len medzi stránkami');
  const ok = await call(plugin, '/airspace', { gzip: true });
  assert.equal(ok.out.status, 200);
  const json = decode(ok);
  assert.deepEqual(json.bulletins.map((b) => b.czib).sort(), ['CZIB-2026-05-R2', 'CZIB-2026-07R3']);
  assert.deepEqual(Object.keys(json.firs).sort(), ['OBBB', 'OKAC', 'OMAE', 'OOMM', 'ORBB', 'OTDF']);
  assert.match(json.attribution, /European Union Aviation Safety Agency/);
  assert.match(json.firAttribution, /VATSpy.*CC BY-SA 4\.0.*approximate/);
  // druhý dopyt z cache, druhý tik je čerstvý (žiadna sieť)
  assert.equal((await call(plugin, '/airspace')).out.status, 200);
  await plugin._tick('airspace');
  assert.equal(plugin._state.last.airspace.result.status, 'fresh');
  assert.equal(calls.length, 5);
  const s = decode(await call(plugin, '/status'));
  assert.equal(s.last.airspace.ok, true);
});

test('/ukmto (etapa 5c): 404 pred stiahnutím, úloha stiahne incidenty UKMTO, okno dní s orezom, cache, stav', async () => {
  const root = await tmpRoot();
  const calls = [];
  const body = await fixtureText('ukmto-all-20261003.json');
  const NOW_UKMTO = Date.UTC(2026, 9, 3, 16);
  const plugin = makePlugin(root, { now: () => NOW_UKMTO, fetchImpl: async (url) => { calls.push(String(url)); return response(body); } });
  const before = await call(plugin, '/ukmto');
  assert.equal(before.out.status, 404);
  assert.deepEqual(decode(before), { error: 'no_ukmto_snapshot' });
  await plugin._tick('ukmto');
  assert.deepEqual(calls, ['https://sccd.royalnavy.mod.uk/api/ukmto/all'], 'jeden dopyt na rozhranie UKMTO — nie mscio.eu');
  assert.equal(plugin._state.last.ukmto.result.status, 'updated');
  assert.equal(plugin._state.last.ukmto.result.count, 21);
  const ok = await call(plugin, '/ukmto', { gzip: true });
  assert.equal(ok.out.status, 200);
  const json = decode(ok);
  assert.equal(json.days, 90);
  assert.equal(json.incidents.length, 19);
  assert.equal(json.incidents[0].ref, '149-26');
  assert.match(json.attribution, /Open Government Licence v3\.0/);
  assert.deepEqual(decode(await call(plugin, '/ukmto?days=7')).incidents.map((x) => x.ref), ['149-26', '148-26', '147-26']);
  assert.equal(decode(await call(plugin, '/ukmto?days=99999')).days, 400, 'orez na 400 dní');
  assert.equal(decode(await call(plugin, '/ukmto?days=abc')).days, 90, 'nečíslo = predvolených 90');
  await plugin._tick('ukmto');
  assert.equal(plugin._state.last.ukmto.result.status, 'fresh', 'do hodiny bez ďalšieho dopytu');
  assert.equal(calls.length, 1);
  assert.equal(decode(await call(plugin, '/status')).last.ukmto.ok, true);
});
