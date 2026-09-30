// src/data/openSkyRegion.test.mjs — výrez OpenSky pri priblížení (2026-09-30, vlastník: „kredity treba
// šetriť, lebo web je aj tak prevažne na SK ľudí"). Testy SPRÁVANIA: priblížený pohľad stojí 1 kredit
// namiesto 4, lietadlá mimo výrezu nezmiznú (svet z posledného snímku), svet sa berie najviac raz za
// minútu, viac návštevníkov v okolí zdieľa jeden výrez, výrezy nikdy nestoja viac než svet, pri
// nedostatku kreditov ostáva doterajší režim a do histórie ide len čerstvý výrez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REGION_FETCHES_PER_WORLD_MAX, REGION_MAX_HEIGHT_M, mergeWorldAndRegion, openSkyAreaCredits,
  openSkyRegionForView, openSkyRegionUrl, regionPolicy,
} from './openSkyRegion.js';
import { _resetOpenSkyProxyForTest, flightHistoryProxy, openSkyProxy } from '../../vite.config.js';

const view = (lat, lon, h) => new URLSearchParams({ lat: String(lat), lon: String(lon), h: String(h) });

test('cena dopytu podľa plochy výrezu: do 25 štv. stupňov 1 kredit … celý svet 4', () => {
  assert.equal(openSkyAreaCredits(null), 4);
  assert.equal(openSkyAreaCredits({ lamin: 0, lamax: 4.8, lomin: 0, lomax: 5 }), 1);
  assert.equal(openSkyAreaCredits({ lamin: 0, lamax: 5.2, lomin: 0, lomax: 5 }), 2);
  assert.equal(openSkyAreaCredits({ lamin: 0, lamax: 10, lomin: 0, lomax: 10 }), 2);
  assert.equal(openSkyAreaCredits({ lamin: 0, lamax: 20, lomin: 0, lomax: 20 }), 3);
  assert.equal(openSkyAreaCredits({ lamin: 0, lamax: 21, lomin: 0, lomax: 20 }), 4);
});

test('výrez pohľadu: priblížená kamera → 1 kredit, okolie zdieľa výrez, vysoko alebo bez výšky celý svet', () => {
  const ba = openSkyRegionForView(view(48.1564, 17.1743, 1488));
  assert.deepEqual({ ...ba, key: undefined }, { lamin: 45.6, lomin: 14.5, lamax: 50.4, lomax: 19.5, key: undefined });
  assert.equal(openSkyAreaCredits(ba), 1);
  // Kamera je vo výreze s rezervou ≥ 2,15° na každú stranu.
  assert.ok(48.1564 - ba.lamin >= 2.15 && ba.lamax - 48.1564 >= 2.15);
  assert.ok(17.1743 - ba.lomin >= 2.15 && ba.lomax - 17.1743 >= 2.15);
  assert.equal(openSkyRegionForView(view(48.05, 16.9, 800)).key, ba.key, 'návštevník o pár km ďalej = ten istý výrez (cache)');
  assert.notEqual(openSkyRegionForView(view(48.7, 21.26, 800)).key, ba.key, 'Košice majú vlastný výrez');
  assert.equal(openSkyRegionForView(view(48.15, 17.17, REGION_MAX_HEIGHT_M + 1)), null, 'vysoko = celý svet');
  assert.equal(openSkyRegionForView(new URLSearchParams('lat=48.15&lon=17.17')), null, 'bez výšky (strážca, starší klient) = celý svet');
  assert.equal(openSkyRegionForView(new URLSearchParams('lat=48.15&lon=17.17&h=')), null);
  assert.ok(openSkyRegionForView(view(31.5, 35.4, -300)), 'pri Mŕtvom mori je kamera pod elipsoidom a stále priblížená');
  // Pól a 180. poludník: výrez sa posunie dovnútra, cena ostane 1 kredit.
  for (const [lat, lon] of [[89.9, 10], [-89.9, 10], [10, 179.9], [10, -179.9]]) {
    const r = openSkyRegionForView(view(lat, lon, 1000));
    assert.ok(r.lamin >= -90 && r.lamax <= 90 && r.lomin >= -180 && r.lomax <= 180, `${lat},${lon}`);
    assert.equal(openSkyAreaCredits(r), 1);
  }
  assert.match(openSkyRegionUrl(ba), /^https:\/\/opensky-network\.org\/api\/states\/all\?extended=1&lamin=45\.6&lomin=14\.5&lamax=50\.4&lomax=19\.5$/);
});

test('kedy výrez: pri dostatku kreditov (aj neznámom zostatku) áno, pod 1 200 doterajší režim', () => {
  assert.deepEqual(regionPolicy(null), { regionTtlMs: 20_000, worldMaxAgeMs: 60_000 });
  assert.ok(regionPolicy(4000));
  assert.ok(regionPolicy(1201));
  assert.equal(regionPolicy(1200), null);
  assert.equal(regionPolicy(0), null);
});

test('svet + výrez: stroje z výrezu nahradia staršie riadky, ostatné ostanú, prázdny výrez nič nezmaže', () => {
  const world = { time: 100, states: [['aaa111', 'OLD'], ['bbb222', 'B'], ['ccc333', 'C']] };
  const region = { time: 130, states: [['AAA111', 'NEW'], ['ddd444', 'D']] };
  const merged = mergeWorldAndRegion(world, region);
  assert.equal(merged.time, 130);
  assert.deepEqual(merged.states.map((s) => s[1]).sort(), ['B', 'C', 'D', 'NEW']);
  assert.deepEqual(mergeWorldAndRegion(world, { time: 130, states: null }).states, world.states);
});

// --- proxy so zdvojeným serverom a falošným OpenSky --------------------------------------------

const T0 = Math.floor(Date.now() / 1000);
const row = (icao, t, lat, lon) => [icao, 'TEST1', 'Slovakia', t, t, lon, lat, 10_000, false, 230, 90, 0, null, 10_030, '1000', false, 0, 4];

function fakeServer() {
  const httpServer = new EventEmitter();
  httpServer.listening = false;
  httpServer.address = () => null;
  const routes = [];
  return { httpServer, routes, middlewares: { use(route, fn) { routes.push({ route, fn }); } } };
}
function fakeRes() {
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    writeHead(status, h = {}) { res.statusCode = status; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v; return res; },
    write() { return true; },
    end(chunk) { res.body = chunk ?? null; return res; },
    headers,
  };
  return res;
}

/** Falošný OpenSky: svet (3 stroje) a výrez (posunutý stroj + nový), zostatok kreditov nastaviteľný. */
function fakeOpenSky(clock) {
  const calls = [];
  const state = { remaining: 3500, regionStatus: 200 };
  const reply = (status, body, extra = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => ({ 'x-rate-limit-remaining': String(state.remaining), ...extra })[String(k).toLowerCase()] ?? null },
    text: async () => body,
  });
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    const t = Math.floor(clock.now / 1000);
    if (!u.startsWith('https://opensky-network.org/')) return reply(503, '');
    if (u.includes('lamin=')) {
      if (state.regionStatus === 429) return reply(429, '', { 'x-rate-limit-retry-after-seconds': '600' });
      if (state.regionStatus !== 200) return reply(state.regionStatus, '');
      state.remaining -= 1;
      return reply(200, JSON.stringify({ time: t, states: [row('505abc', t, 48.3, 17.4), row('4b1805', t, 48.0, 17.0)] }));
    }
    state.remaining -= 4;
    return reply(200, JSON.stringify({ time: t, states: [row('505abc', t, 48.1, 17.2), row('3c6444', t, 50.0, 8.0), row('a12345', t, 40.6, -73.8)] }));
  };
  return { calls, state, fetchImpl, regionCalls: () => calls.filter((c) => c.includes('lamin=')).length, worldCalls: () => calls.filter((c) => c.startsWith('https://opensky-network.org/') && !c.includes('lamin=')).length };
}

async function withProxy(fn, { history = false } = {}) {
  const clock = { now: T0 * 1000 };
  const sky = fakeOpenSky(clock);
  const saved = { fetch: globalThis.fetch, now: Date.now, env: {} };
  const dir = history ? mkdtempSync(path.join(tmpdir(), 'oko-osr-')) : null;
  const env = { OPENSKY_AUTH_MODE: 'anon', FLIGHT_HISTORY: 'on', FLIGHT_HISTORY_KEEPER: 'off', FLIGHT_HISTORY_MIN_FREE_GB: '', ...(dir ? { FLIGHT_HISTORY_DB: path.join(dir, 'h.sqlite') } : {}) };
  for (const [k, v] of Object.entries(env)) { saved.env[k] = process.env[k]; process.env[k] = v; }
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  globalThis.fetch = sky.fetchImpl;
  Date.now = () => clock.now;
  _resetOpenSkyProxyForTest();
  const srv = fakeServer();
  const historyPlugin = history ? flightHistoryProxy() : null;
  try {
    historyPlugin?.configureServer(srv);
    openSkyProxy().configureServer(srv);
    const chain = srv.routes.filter((r) => r.route === '/api/opensky').map((r) => r.fn);
    const get = async (query = '') => {
      const res = fakeRes();
      const req = { url: `/${query ? `?${query}` : ''}`, headers: { host: 'okolive.sk', 'cf-connecting-ip': '198.51.100.7' }, socket: { remoteAddress: '127.0.0.1' } };
      let i = 0;
      const next = async () => { const fn = chain[i++]; if (fn) await fn(req, res, next); };
      await next();
      return { status: res.statusCode, cache: res.headers['x-opensky-cache'], region: res.headers['x-opensky-region'] ?? null, json: res.body ? JSON.parse(res.body) : null };
    };
    const historyStatus = async () => {
      const res = fakeRes();
      await srv.routes.find((r) => r.route === '/api/history').fn({ url: '/status', headers: { host: 'localhost:4173' }, socket: { remoteAddress: '127.0.0.1' } }, res);
      return JSON.parse(res.body);
    };
    await fn({ clock, sky, get, historyStatus, advance: (ms) => { clock.now += ms; } });
  } finally {
    srv.httpServer.emit('close');
    globalThis.fetch = saved.fetch;
    Date.now = saved.now;
    if (history) await new Promise((r) => setTimeout(r, 300));
    console.warn = origWarn;
    console.log = origLog;
    for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    _resetOpenSkyProxyForTest();
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows drží súbor vlákna */ } }
  }
}

const BA = 'lat=48.1564&lon=17.1743&h=1488';
const icaos = (json) => json.states.map((s) => s[0]).sort();

test('priblížený pohľad: výrez za 1 kredit, lietadlá mimo výrezu ostanú, svet najviac raz za minútu', async () => {
  await withProxy(async ({ sky, get, advance }) => {
    const first = await get(BA);
    assert.equal(sky.worldCalls(), 1, 'bez snímku sveta najprv svet');
    assert.deepEqual(icaos(first.json), ['3c6444', '505abc', 'a12345']);
    advance(10_000);
    const early = await get(BA);
    assert.equal(sky.calls.length, 1, 'svet mladší než 20 s stačí — nič sa nesťahuje (predtým po 9 s znova celý svet)');
    assert.deepEqual(icaos(early.json), ['3c6444', '505abc', 'a12345']);
    advance(20_000);
    const merged = await get(BA);
    assert.equal(sky.regionCalls(), 1, 'po 30 s len výrez');
    assert.equal(sky.worldCalls(), 1);
    assert.equal(merged.cache, 'REGION');
    assert.equal(merged.region, '45.6,14.5,50.4,19.5');
    assert.deepEqual(icaos(merged.json), ['3c6444', '4b1805', '505abc', 'a12345'], 'nový stroj z výrezu + svet mimo výrezu');
    assert.equal(merged.json.states.find((s) => s[0] === '505abc')[6], 48.3, 'stroj vo výreze má čerstvú polohu');
    advance(5_000);
    const neighbour = await get('lat=48.05&lon=16.9&h=800');
    assert.equal(sky.calls.length, 2, 'druhý návštevník v okolí dostane ten istý výrez z cache');
    assert.equal(neighbour.cache, 'REGION-HIT');
    advance(26_000);
    await get(BA);
    assert.equal(sky.worldCalls(), 2, 'svet starší než minúta sa obnoví (aj pre históriu)');
    assert.equal(sky.regionCalls(), 1);
    // Celkom za minútu jedného návštevníka: 2× svet + 1× výrez = 9 kreditov; predtým každý dopyt po 9 s svet.
    advance(3_000);
    const world = await get('lat=48.15&lon=17.17&h=20000000');
    assert.equal(sky.calls.length, 3, 'vzdialený pohľad dostal čerstvý svet z cache');
    assert.equal(world.region, null);
  });
});

test('výrezy nikdy nestoja viac než svet: štvrté okolie do ďalšieho snímku dostane svet', async () => {
  await withProxy(async ({ sky, get, advance }) => {
    await get(BA);
    advance(25_000);
    const places = ['lat=48.7&lon=21.26&h=900', 'lat=50.08&lon=14.43&h=900', 'lat=47.5&lon=19.04&h=900', 'lat=52.23&lon=21.01&h=900'];
    const replies = [];
    for (const q of places) replies.push(await get(q));
    assert.equal(sky.regionCalls(), REGION_FETCHES_PER_WORLD_MAX);
    assert.equal(sky.worldCalls(), 1);
    assert.equal(replies[3].cache, 'HIT', 'Varšava: svet z posledného snímku, bez ďalšieho dopytu');
    assert.deepEqual(icaos(replies[3].json), ['3c6444', '505abc', 'a12345']);
    advance(40_000);
    await get(places[3]);
    assert.equal(sky.worldCalls(), 2, 'po minúte nový svet a strop sa uvoľní');
    advance(25_000);
    await get(places[3]);
    assert.equal(sky.regionCalls(), REGION_FETCHES_PER_WORLD_MAX + 1);
  });
});

test('zlyhaný výrez: starší výrez nikdy neprepíše novší snímok sveta staršími polohami', async () => {
  await withProxy(async ({ sky, get, advance }) => {
    await get(BA);
    advance(30_000);
    const merged = await get(BA);
    assert.equal(merged.cache, 'REGION');
    advance(31_000);
    await get(BA);
    assert.equal(sky.worldCalls(), 2, 'nový snímok sveta');
    advance(25_000);
    sky.state.regionStatus = 503;
    const failed = await get(BA);
    assert.equal(sky.regionCalls(), 2, 'výrez sa skúsil');
    assert.equal(failed.status, 200);
    assert.equal(failed.cache, 'HIT', 'výrez spred snímku sveta sa nepoužije');
    assert.deepEqual(icaos(failed.json), ['3c6444', '505abc', 'a12345']);
    assert.equal(failed.json.states.find((s) => s[0] === '505abc')[6], 48.1, 'poloha zo sveta, nie staršia z výrezu');
  });
});

test('málo kreditov alebo bez výšky kamery: doterajší režim celého sveta; 429 pri výreze spustí governor', async () => {
  await withProxy(async ({ sky, get, advance }) => {
    sky.state.remaining = 1100;
    await get(BA);
    advance(30_000);
    await get(BA);
    assert.equal(sky.regionCalls(), 0, 'pod 1 200 kreditov žiadny výrez');
    assert.equal(sky.worldCalls(), 1, 'cache 90 s ako doteraz');
  });
  await withProxy(async ({ sky, get, advance }) => {
    await get('lat=48.15&lon=17.17');
    advance(30_000);
    await get('lat=48.15&lon=17.17');
    assert.equal(sky.regionCalls(), 0, 'strážca a starší klient bez výšky kamery pýtajú svet');
    assert.equal(sky.worldCalls(), 2);
  });
  await withProxy(async ({ sky, get, advance }) => {
    await get(BA);
    advance(30_000);
    sky.state.regionStatus = 429;
    const limited = await get(BA);
    assert.equal(limited.status, 200);
    assert.equal(limited.cache, 'STALE', 'pri 429 posledný svet, vrstva nezmizne');
    assert.deepEqual(icaos(limited.json), ['3c6444', '505abc', 'a12345']);
    const before = sky.calls.filter((c) => c.startsWith('https://opensky-network.org/')).length;
    advance(5_000);
    await get(BA);
    assert.equal(sky.calls.filter((c) => c.startsWith('https://opensky-network.org/')).length, before, 'počas cooldownu OpenSky nepýtať');
  });
});

test('história: zo sveta + výrezu sa zapíše len čerstvý výrez, svet z cache druhýkrát nie', async () => {
  await withProxy(async ({ get, advance, historyStatus }) => {
    await get(BA);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal((await historyStatus()).fixes, 3, 'snímok sveta');
    advance(10_000);
    await get(BA);
    advance(20_000);
    await get(BA);
    await new Promise((r) => setTimeout(r, 400));
    const st = await historyStatus();
    assert.equal(st.fixes, 3 + 2, 'k svetu pribudli len dva fixy z výrezu');
    assert.deepEqual({ world: st.opensky.world, region: st.opensky.region, credits: st.opensky.credits }, { world: 1, region: 1, credits: 5 });
  }, { history: true });
});
