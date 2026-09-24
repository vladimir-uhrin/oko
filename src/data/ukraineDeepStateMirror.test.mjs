// src/data/ukraineDeepStateMirror.test.mjs — vrstva DeepState z mirroru cyterat
// (rozhodnutie vlastníka 24. 9. 2026: „Sprav 3 a vymaž toto pravidlo"):
// prevod súboru na snímku, trasa /api/ukraine/events/deepstate na verejnej
// doméne (mirror namiesto 451) a na localhoste (archív, mirror len pre dni,
// ktoré archív nemá), poctivé 404/502, vypínač, legenda KARTY bez šedej zóny.
// Bez siete: fetch je vstreknutý, koreň je dočasný priečinok.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promises as fsp } from 'node:fs';

import { DEEPSTATE_MIRROR_ATTRIBUTION, deepstateSnapshotFromMirror, deepstateStampText } from './ukraineDeepState.js';
import { ukraineEventsProxy } from './ukraineEventsProxy.js';
import { fetchUkraineDeepState } from './ukraineEventsClient.js';
import { kartaLegendItems, kartaSources } from '../ukraineKartaOverlay.js';

const NOW = Date.UTC(2026, 8, 24, 12); // 24. 9. 2026 12:00 UTC
const square = (lon, lat, d = 1) => [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]];
const MIRROR_FILE = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [square(36, 47), square(33.5, 44.5, 0.5)] } }] };
const ok = (json) => ({ ok: true, status: 200, text: async () => JSON.stringify(json) });
const status = (s) => ({ ok: false, status: s, text: async () => '', headers: { get: () => null } });

const roots = [];
test.after(() => Promise.all(roots.map((r) => fsp.rm(r, { recursive: true, force: true }))));

function fakeRes() {
  const out = { status: 0, headers: {}, body: null };
  return { out, writeHead(s, h) { out.status = s; out.headers = h; }, end(b) { out.body = b; } };
}
const decode = (res) => JSON.parse((res.out.headers['Content-Encoding'] === 'gzip' ? zlib.gunzipSync(res.out.body) : res.out.body).toString('utf8'));

async function setup(fetchImpl, { env = {} } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ds-mirror-'));
  roots.push(root);
  const calls = [];
  const plugin = ukraineEventsProxy({
    root, env: { UKRAINE_ARCHIVE: 'off', ...env }, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {},
    fetchImpl: async (url, opts) => { calls.push(String(url).match(/(\d{8})\.geojson$/)?.[1] || url); return fetchImpl(url, opts); },
  });
  const server = { middlewares: { use: (p, h) => { server.handler = h; } }, httpServer: null };
  plugin.configureServer(server);
  const call = async (url, host) => {
    const res = fakeRes();
    await server.handler({ method: 'GET', url, headers: { host }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return res;
  };
  return { root, calls, call };
}

test('súbor mirroru → snímka vrstvy: len okupované, deň súboru ~03:00 UTC, zdroj mirror', () => {
  const snap = deepstateSnapshotFromMirror(MIRROR_FILE, { dateKey: '20260923', fallbackDays: 1, upstreamUnavailable: false });
  assert.equal(snap.source, 'mirror');
  assert.equal(snap.day, '2026-09-23');
  assert.equal(snap.at, '2026-09-23T03:00:00.000Z');
  assert.equal(snap.atApprox, true);
  assert.equal(snap.features.length, 2, 'každý polygón MultiPolygonu = jeden prvok');
  assert.ok(snap.features.every((f) => f.kind === 'occupied' && f.type === 'Polygon' && f.rings.length === 1));
  assert.deepEqual(snap.counts, { occupied: 2 });
  assert.ok(snap.areaKm2.occupied > 8000 && snap.areaKm2.occupied < 11000, String(snap.areaKm2.occupied));
  assert.equal(snap.fallbackDays, 1);
  assert.equal(deepstateStampText(snap), '23.9.2026', 'len deň — čas DeepState z mirroru nepoznáme');
  const empty = deepstateSnapshotFromMirror({ type: 'FeatureCollection', features: [] }, { dateKey: '20260923' });
  assert.deepEqual(empty.features, []);
  assert.deepEqual(empty.areaKm2, {});
  assert.equal(deepstateSnapshotFromMirror(MIRROR_FILE, { dateKey: 'zle' }).at, null);
});

test('verejná doména: namiesto 451 snímka z mirroru so zdrojom a licenciou', async () => {
  const s = await setup(async () => ok(MIRROR_FILE));
  const res = await s.call('/deepstate?at=2026-09-24', 'oko.uhrin.digital');
  assert.equal(res.out.status, 200);
  const json = decode(res);
  assert.equal(json.source, 'mirror');
  assert.equal(json.day, '2026-09-24');
  assert.equal(json.requestedAt, '2026-09-24');
  assert.equal(json.attribution, DEEPSTATE_MIRROR_ATTRIBUTION);
  assert.match(json.license.data, /not open data/);
  assert.match(json.note, /Not a live front line/);
  assert.equal(json.features.length, 2);
  assert.deepEqual(s.calls, ['20260924']);
  await s.call('/deepstate?at=2026-09-24', 'oko.uhrin.digital');
  assert.deepEqual(s.calls, ['20260924'], 'druhý dopyt z cache');
  const future = await s.call('/deepstate?at=2026-09-30', 'oko.uhrin.digital');
  assert.equal(decode(future).day, '2026-09-24', 'budúci deň = dnešný súbor');
});

test('verejná doména: deň pred históriou mirroru = 404 so zdrojom; výpadok = 502; vypínač vráti 451', async () => {
  const s = await setup(async () => status(500));
  const early = await s.call('/deepstate?at=2024-01-15', 'oko.uhrin.digital');
  assert.equal(early.out.status, 404);
  assert.deepEqual(decode(early), { error: 'no_deepstate_snapshot', source: 'mirror', at: '2024-01-15', firstDay: '2024-07-08' });
  const down = await s.call('/deepstate?at=2026-09-20', 'oko.uhrin.digital');
  assert.equal(down.out.status, 502);
  assert.equal(decode(down).error, 'deepstate_mirror_unavailable');
  assert.equal(decode(down).upstreamStatus, 500);

  const off = await setup(async () => ok(MIRROR_FILE), { env: { UKRAINE_DEEPSTATE_MIRROR: 'off' } });
  const gated = await off.call('/deepstate?at=2026-09-24', 'oko.uhrin.digital');
  assert.equal(gated.out.status, 451);
  assert.deepEqual(off.calls, []);
  const dsOff = await setup(async () => ok(MIRROR_FILE), { env: { UKRAINE_DEEPSTATE: 'off' } });
  assert.equal((await dsOff.call('/deepstate?at=2026-09-24', 'oko.uhrin.digital')).out.status, 451, 'UKRAINE_DEEPSTATE=off vypína aj mirror');
});

test('localhost: vlastný archív má prednosť, mirror len pre dni, ktoré archív nemá', async () => {
  const s = await setup(async () => ok(MIRROR_FILE));
  const dir = path.join(s.root, '.gev-cache', 'ukraine', 'events', 'deepstate');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '2026-09-19.json'), JSON.stringify({ id: 1, at: '2026-09-19T10:00:00.000Z', day: '2026-09-19', features: [{ kind: 'grey', type: 'Polygon', rings: square(37, 48) }], counts: { grey: 1 }, areaKm2: { grey: 8000 }, source: 'https://deepstatemap.live/api/history/last' }));
  const archive = await s.call('/deepstate?at=2026-09-22', 'localhost:4173');
  assert.equal(archive.out.status, 200);
  assert.equal(decode(archive).source, 'archive', 'URL zo súboru archívu sa prepíše na druh zdroja');
  assert.equal(decode(archive).day, '2026-09-19');
  assert.deepEqual(s.calls, []);
  const older = await s.call('/deepstate?at=2025-03-01', 'localhost:4173');
  assert.equal(older.out.status, 200);
  const body = decode(older);
  assert.equal(body.source, 'mirror', 'pred 19. 9. 2026 archív nemá nič — história z mirroru');
  assert.equal(body.day, '2025-03-01');
  assert.equal(body.archiveFirst, '2026-09-19');
  assert.deepEqual(s.calls, ['20250301']);
});

test('klient nesie telo chyby (zdroj 404); KARTA pri mirrori bez šedej zóny a so zdrojom', async () => {
  const fetcher = async () => ({ ok: false, status: 404, json: async () => ({ error: 'no_deepstate_snapshot', source: 'mirror' }) });
  await assert.rejects(fetchUkraineDeepState('2024-01-01', { fetcher, base: '/x' }), (err) => err.status === 404 && err.body?.source === 'mirror');
  const t = (k) => k;
  assert.deepEqual(kartaSources({ deepstate: { shown: true, source: 'mirror' }, translate: t }), ['ukraine.karta.src.deepstate-mirror', 'ukraine.karta.src.osm']);
  assert.deepEqual(kartaSources({ deepstate: { shown: true, source: 'archive' }, translate: t }), ['ukraine.karta.src.deepstate', 'ukraine.karta.src.osm']);
  const keys = (ds) => kartaLegendItems({ deepstate: ds, translate: t }).map((i) => i.key);
  assert.ok(!keys({ shown: true, source: 'mirror' }).includes('grey'), 'mirror šedú zónu nemá');
  assert.ok(keys({ shown: true, source: 'archive' }).includes('grey'));
});

test('kontrola 24. 9.: KARTA pri mirrore uvádza aj Wikipédiu a pás bojov; bez polygónov DeepState nie je zdroj', async () => {
  const t = (k) => k;
  assert.deepEqual(kartaSources({ deepstate: { shown: true, source: 'mirror', features: 21 }, control: { shown: true }, translate: t }),
    ['ukraine.karta.src.deepstate-mirror', 'ukraine.karta.src.wiki', 'ukraine.karta.src.osm']);
  assert.deepEqual(kartaSources({ deepstate: { shown: true, source: 'mirror', features: 0 }, control: { shown: true }, translate: t }),
    ['ukraine.karta.src.wiki', 'ukraine.karta.src.osm'], 'mirror sa ešte načítava / 404 — kreslí len Wikipédia');
  const keys = (ds, control) => kartaLegendItems({ deepstate: ds, control, translate: t }).map((i) => i.key);
  assert.deepEqual(keys({ shown: true, source: 'mirror', features: 21 }, { shown: true }).slice(0, 2), ['occupied', 'contested']);
  assert.ok(keys({ shown: true, source: 'mirror', features: 0 }, { shown: true }).includes('ru'));
});

test('kontrola 24. 9.: limiter nejde obísť striedaním prvej hodnoty X-Forwarded-For', async () => {
  const s = await setup(async () => ok(MIRROR_FILE));
  const server = { middlewares: { use: (p, h) => { server.handler = h; } }, httpServer: null };
  const plugin = ukraineEventsProxy({ root: s.root, env: { UKRAINE_ARCHIVE: 'off' }, now: () => NOW, setTimer: () => 0, clearTimer: () => {}, log: () => {}, fetchImpl: async () => ok(MIRROR_FILE) });
  plugin.configureServer(server);
  let last = null;
  for (let i = 0; i < 42; i += 1) {
    const res = fakeRes();
    await server.handler({ method: 'GET', url: '/deepstate?at=2026-09-24', headers: { host: 'oko.uhrin.digital', 'x-forwarded-for': `198.18.7.${i}, 192.0.2.202`, 'cf-connecting-ip': '192.0.2.202' }, socket: { remoteAddress: '127.0.0.1' } }, res);
    last = res.out.status;
  }
  assert.equal(last, 429);
});

test('kontrola 24. 9.: sklad uloží snímku pod jej dňom s requestedAt toho dňa; atribúcia obrázka nesie DeepState', async () => {
  const { createUkraineEventStore } = await import('./ukraineEventsClient.js');
  const { buildAttributionLine } = await import('../shareTargets.js');
  let calls = 0;
  const store = createUkraineEventStore({ now: () => NOW, fetchDeepState: async (day) => { calls += 1; return { day: '2026-09-23', requestedAt: day, source: 'mirror' }; } });
  assert.equal((await store.deepstate('2026-09-24')).requestedAt, '2026-09-24');
  const alias = await store.deepstate('2026-09-23');
  assert.equal(alias.requestedAt, '2026-09-23', 'vek sa meria od dňa, pod ktorým je uložená');
  assert.equal(calls, 1);
  const line = buildAttributionLine('OpenStreetMap · Natural Earth · NASA · Esri · Stadia · GIBS · DeepStateMap.live (via mirror cyterat/deepstate-map-data)');
  assert.match(line, /DeepStateMap\.live \(via mirror/);
});

test('záložný mirror lazar-bit: deň, ktorý cyterat nemá, alebo výpadok cyteratu; pôvod súboru prežije reštart', async () => {
  const { DEEPSTATE_MIRRORS, createDeepStateMirror } = await import('./deepstateAnalyticsProxy.js');
  const { deepstateMirrorAttribution } = await import('./ukraineDeepState.js');
  assert.deepEqual(DEEPSTATE_MIRRORS.map((m) => m.id), ['cyterat', 'lazar-bit']);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ds-fork-'));
  roots.push(root);
  const hits = [];
  const fetchImpl = async (url) => {
    const fork = url.includes('lazar-bit');
    hits.push(`${fork ? 'L' : 'C'}:${url.match(/(\d{8})\.geojson$/)[1]}`);
    if (url.includes('20251126')) return fork ? ok(MIRROR_FILE) : status(404); // cyterat ten deň nemá
    if (url.includes('20260910')) return fork ? ok(MIRROR_FILE) : status(503); // cyterat padol
    if (url.includes('20260911')) return status(404);
    return status(500);
  };
  let t = NOW;
  const m = createDeepStateMirror({ root, fetchImpl, now: () => t, log: () => {}, mirrors: DEEPSTATE_MIRRORS });
  const gap = await m.lookup({ requestedDate: '20251126', maxFallback: 0 });
  assert.equal(gap.found.mirror, 'lazar-bit');
  assert.deepEqual(hits.splice(0), ['C:20251126', 'L:20251126']);
  const none = await m.lookup({ requestedDate: '20260911', maxFallback: 0 });
  assert.equal(none.found, null);
  assert.equal(none.upstreamProblem, false, 'oba 404 = poctivé „nie je"');
  hits.splice(0);
  const down = await m.lookup({ requestedDate: '20260910', maxFallback: 0 });
  assert.equal(down.found.mirror, 'lazar-bit', 'výpadok cyteratu: odpovie fork');
  assert.equal(down.upstreamProblem, false);
  assert.deepEqual(hits.splice(0), ['C:20260910', 'L:20260910']);
  // cyterat po chybe dostal pauzu — ďalší deň ide rovno na fork (chyba sa nezahodila)
  t += 10_000;
  const bad = await m.lookup({ requestedDate: '20260912', maxFallback: 0 });
  assert.deepEqual(hits.splice(0), ['L:20260912'], 'cyterat v pauze sa nepýta');
  assert.equal(bad.upstreamProblem, true, 'fork zlyhal, cyterat v pauze = výpadok');
  t += 61_000;
  await m.lookup({ requestedDate: '20260913', maxFallback: 0 });
  assert.deepEqual(hits.splice(0), ['C:20260913', 'L:20260913'], 'po pauze oba znova');
  // nové jadro (reštart servera) číta z disku aj pôvod
  const again = createDeepStateMirror({ root, fetchImpl: async () => { throw new Error('bez siete'); }, now: () => NOW, log: () => {}, mirrors: DEEPSTATE_MIRRORS });
  assert.equal((await again.lookup({ requestedDate: '20251126', maxFallback: 0 })).found.mirror, 'lazar-bit');
  assert.match(deepstateMirrorAttribution('lazar-bit'), /lazar-bit\/deepstate-map-data-analytics \(fork of cyterat/);
  assert.match(deepstateMirrorAttribution('cyterat'), /cyterat\/deepstate-map-data$/);
  // predvolene (bez voľby) len cyterat — pôvodné správanie
  const oneRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ds-one-'));
  roots.push(oneRoot);
  const single = createDeepStateMirror({ root: oneRoot, fetchImpl, now: () => NOW, log: () => {} });
  assert.deepEqual(single.mirrors.map((x) => x.id), ['cyterat']);
});

test('trasa vrstvy: deň z forku nesie jeho atribúciu a pôvod', async () => {
  const s = await setup(async (url) => (url.includes('lazar-bit') ? ok(MIRROR_FILE) : status(404)));
  const res = await s.call('/deepstate?at=2025-11-26', 'oko.uhrin.digital');
  assert.equal(res.out.status, 200);
  const json = decode(res);
  assert.equal(json.mirror, 'lazar-bit');
  assert.match(json.attribution, /lazar-bit/);
});

test('kontrola 24. 9. (fork): atribúcia aj licencia menujú skutočný mirror; pôvod na disku sa nerozíde so súborom', async () => {
  const { DEEPSTATE_MIRRORS, deepstateAnalyticsProxy, deepstateAnalyticsAttribution, deepstateMirrorLicense, createDeepStateMirror } = await import('./deepstateAnalyticsProxy.js');
  assert.match(deepstateAnalyticsAttribution('lazar-bit'), /lazar-bit\/deepstate-map-data-analytics \(fork of cyterat/);
  assert.equal(deepstateMirrorLicense('lazar-bit').mirrorUrl, 'https://github.com/lazar-bit/deepstate-map-data-analytics');
  assert.equal(deepstateMirrorLicense('cyterat').mirrorUrl, 'https://github.com/cyterat/deepstate-map-data');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'oko-ds-fork-'));
  roots.push(root);
  let forkOnly = true;
  const fetchImpl = async (url) => (url.includes('lazar-bit') ? ok(MIRROR_FILE) : (forkOnly ? status(404) : ok(MIRROR_FILE)));
  const mirror = createDeepStateMirror({ root, fetchImpl, now: () => NOW, log: () => {}, mirrors: DEEPSTATE_MIRRORS });
  const plugin = deepstateAnalyticsProxy({ mirror, log: () => {} });
  const res = { status: 0, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  await plugin._handler({ method: 'GET', url: '/?date=20251126&maxFallback=0', headers: {}, socket: { remoteAddress: '10.0.0.9' } }, res);
  const body = JSON.parse(res.body.toString('utf8'));
  assert.equal(body.mirror, 'lazar-bit');
  assert.match(body.attribution, /lazar-bit/);
  assert.equal(body.license.mirrorUrl, 'https://github.com/lazar-bit/deepstate-map-data-analytics');
  assert.match(body.sourceUrl, /lazar-bit/);
  const side = path.join(mirror.cacheDir, '20251126.mirror');
  assert.equal((await fsp.readFile(side, 'utf8')).trim(), 'lazar-bit');
  // ten istý deň neskôr od cyteratu (súbor zmazaný z disku) — starý štítok zmizne
  await fsp.rm(path.join(mirror.cacheDir, '20251126.geojson'));
  forkOnly = false;
  const fresh = createDeepStateMirror({ root, fetchImpl, now: () => NOW, log: () => {}, mirrors: DEEPSTATE_MIRRORS });
  assert.equal((await fresh.lookup({ requestedDate: '20251126', maxFallback: 0 })).found.mirror, 'cyterat');
  await assert.rejects(fsp.access(side), 'bočný súbor forku po zápise z cyteratu preč');
  // neznámy obsah bočného súboru = cyterat
  await fsp.writeFile(side, 'bogus');
  const third = createDeepStateMirror({ root, fetchImpl: async () => { throw new Error('bez siete'); }, now: () => NOW, log: () => {}, mirrors: DEEPSTATE_MIRRORS });
  assert.equal((await third.lookup({ requestedDate: '20251126', maxFallback: 0 })).found.mirror, 'cyterat');
});
