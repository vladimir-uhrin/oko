// src/data/flightHistoryKeeper.test.mjs — nepretržitý záznam histórie letov (2026-09-30).
// Používateľ: „chcem čo najviac informácií ukladať…". Dovtedy sa história zapisovala len vtedy,
// keď mal niekto otvorenú mapu (celé dni prázdne). Testy SPRÁVANIA: strážca v tichu sťahuje
// celosvetové snímky, neberie kredity OpenSky návštevníkom, ustúpi pri návštevníkoch, pri
// kreditovom cooldowne a pri plnom disku, po chybách spomalí a pripojí sa k skutočnému serveru.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
  HISTORY_MIN_FREE_BYTES,
  KEEPER_CLIENT_IDLE_MS,
  KEEPER_HEADER,
  KEEPER_MAX_BACKOFF_MS,
  KEEPER_MIL_INTERVAL_MS,
  KEEPER_PROBE_MS,
  KEEPER_RESERVE_CREDITS,
  createDiskGuard,
  createHistoryKeeper,
  keeperBackoffMs,
  keeperDecision,
  keeperOpenSkyIntervalMs,
} from './flightHistoryKeeper.js';

const okResponse = (headers = {}) => ({
  ok: true,
  status: 200,
  headers: new Headers(headers),
  arrayBuffer: async () => new ArrayBuffer(0),
});

/** Simulácia: hodiny, kredity OpenSky (−4 za celosvetový snímok), záznam dopytov. */
function simulation({ credits = 4000, clientActive = () => false, blockedUntil = () => 0, fail = () => false, canRecord = () => true } = {}) {
  const sim = { nowMs: Date.UTC(2026, 8, 30, 0, 0, 0), credits, calls: [], logs: [] };
  sim.keeper = createHistoryKeeper({
    streams: [
      { id: 'opensky', path: '/api/opensky', intervalMs: () => keeperOpenSkyIntervalMs(sim.credits), blockedUntilMs: () => blockedUntil(sim.nowMs) },
      { id: 'mil', path: '/api/adsblol/mil', intervalMs: () => KEEPER_MIL_INTERVAL_MS },
    ],
    openSkyCredits: () => sim.credits,
    canRecord,
    now: () => sim.nowMs,
    log: (msg) => sim.logs.push(msg),
    fetchImpl: async (url, init) => {
      sim.calls.push({ url, at: sim.nowMs, creditsBefore: sim.credits, keeperHeader: init?.headers?.[KEEPER_HEADER] });
      if (fail(url, sim.nowMs)) throw new Error('upstream down');
      if (url.endsWith('/api/opensky')) sim.credits = Math.max(0, sim.credits - 4);
      return okResponse();
    },
  });
  sim.keeper.start('http://127.0.0.1:4173/');
  sim.keeper.stop(); // bez skutočného časovača — kroky riadi test
  sim.keeper.start('http://127.0.0.1:4173');
  sim.run = async (ms, stepMs = 15_000) => {
    const end = sim.nowMs + ms;
    while (sim.nowMs < end) {
      if (clientActive(sim.nowMs)) {
        sim.keeper.noteClient('opensky');
        sim.keeper.noteClient('mil');
      }
      await Promise.all(sim.keeper.tick());
      sim.nowMs += stepMs;
    }
  };
  sim.openskyCalls = () => sim.calls.filter((c) => c.url.endsWith('/api/opensky'));
  return sim;
}

test('odstup snímkov podľa zostatku kreditov: plno 90 s, stredne 120 s, rezerva len sonda', () => {
  assert.equal(keeperOpenSkyIntervalMs(null), 90_000, 'neznámy zostatok: prvý snímok ho zistí');
  assert.equal(keeperOpenSkyIntervalMs(4000), 90_000);
  assert.equal(keeperOpenSkyIntervalMs(2401), 90_000);
  assert.equal(keeperOpenSkyIntervalMs(2400), 120_000);
  assert.equal(keeperOpenSkyIntervalMs(KEEPER_RESERVE_CREDITS + 1), 120_000);
  assert.equal(keeperOpenSkyIntervalMs(KEEPER_RESERVE_CREDITS), KEEPER_PROBE_MS);
  assert.equal(keeperOpenSkyIntervalMs(0), KEEPER_PROBE_MS);
});

test('rozhodnutie: cooldown a návštevníci majú prednosť, potom interval', () => {
  const base = { nowMs: 1_000_000, lastClientMs: 0, lastPollMs: 0, intervalMs: 90_000 };
  assert.equal(keeperDecision(base), 'poll');
  assert.equal(keeperDecision({ ...base, blockedUntilMs: 1_000_001 }), 'blocked');
  assert.equal(keeperDecision({ ...base, lastClientMs: 1_000_000 - KEEPER_CLIENT_IDLE_MS + 1 }), 'clients');
  assert.equal(keeperDecision({ ...base, lastClientMs: 1_000_000 - KEEPER_CLIENT_IDLE_MS }), 'poll');
  assert.equal(keeperDecision({ ...base, lastPollMs: 1_000_000 - 89_999 }), 'wait');
  assert.equal(keeperBackoffMs(90_000, 0), 90_000);
  assert.equal(keeperBackoffMs(90_000, 1), 180_000);
  assert.equal(keeperBackoffMs(90_000, 3), 720_000);
  assert.equal(keeperBackoffMs(90_000, 50), KEEPER_MAX_BACKOFF_MS);
});

test('deň bez návštevníkov: súvislá história (stovky snímkov, žiadna medzera nad 30 min) a rezerva kreditov pre živú mapu ostane', async () => {
  const sim = simulation({ credits: 4000 });
  await sim.run(24 * 3600_000);
  const calls = sim.openskyCalls();
  assert.ok(calls.length >= 650, `celosvetových snímkov za deň: ${calls.length}`);
  // Pod rezervou už len sonda raz za 30 min (zistí obnovu kreditov): najviac 8 kreditov za hodinu.
  const inReserve = calls.filter((c) => c.creditsBefore <= KEEPER_RESERVE_CREDITS);
  for (let i = 1; i < inReserve.length; i += 1) {
    assert.ok(inReserve[i].at - inReserve[i - 1].at >= KEEPER_PROBE_MS, 'pod rezervou len sondy');
  }
  const hoursInReserve = inReserve.length ? (sim.nowMs - inReserve[0].at) / 3600_000 : 0;
  assert.ok(inReserve.length <= Math.ceil(hoursInReserve * 2) + 1, `sond: ${inReserve.length} za ${hoursInReserve.toFixed(1)} h`);
  assert.ok(sim.credits >= KEEPER_RESERVE_CREDITS - 4 * inReserve.length, `návštevníkom ostalo ${sim.credits} kreditov`);
  assert.ok(sim.credits >= 1100, `rezerva pre živú mapu: ${sim.credits}`);
  let maxGap = 0;
  for (let i = 1; i < calls.length; i += 1) maxGap = Math.max(maxGap, calls[i].at - calls[i - 1].at);
  assert.ok(maxGap <= KEEPER_PROBE_MS, `najväčšia medzera ${maxGap / 60_000} min`);
  const firstHour = calls.filter((c) => c.at < calls[0].at + 3600_000).length;
  assert.ok(firstHour >= 38 && firstHour <= 41, `pri plných kreditoch ~40 snímkov/h, bolo ${firstHour}`);
  const mil = sim.calls.filter((c) => c.url.endsWith('/api/adsblol/mil')).length;
  assert.ok(mil >= 1400 && mil <= 1441, `vojenské lietadlá ~raz za minútu: ${mil}`);
  assert.ok(sim.calls.every((c) => c.keeperHeader === '1'), 'každý dopyt strážcu je označený (návštevník to nie je)');
  assert.ok(sim.calls.every((c) => c.url.startsWith('http://127.0.0.1:4173/api/')), 'len lokálny server, žiadny externý zdroj');
});

test('návštevník pozerá: strážca nesťahuje (návštevník zapisuje sám), po odchode pokračuje', async () => {
  const start = Date.UTC(2026, 8, 30, 0, 0, 0);
  const visitUntil = start + 3600_000;
  const sim = simulation({ clientActive: (t) => t < visitUntil });
  await sim.run(3600_000);
  assert.equal(sim.calls.length, 0, 'počas návštevy nič');
  await sim.run(KEEPER_CLIENT_IDLE_MS + 30_000);
  assert.ok(sim.openskyCalls().length >= 1, 'po odchode návštevníka znova záznam');
  assert.ok(sim.openskyCalls()[0].at >= visitUntil + KEEPER_CLIENT_IDLE_MS - 15_000, 'až po 2 min ticha');
});

test('kreditový cooldown / regionálny režim: ani jeden dopyt, kým neskončí', async () => {
  const start = Date.UTC(2026, 8, 30, 0, 0, 0);
  const sim = simulation({ blockedUntil: () => start + 20 * 60_000 });
  await sim.run(20 * 60_000 - 15_000);
  assert.equal(sim.openskyCalls().length, 0);
  assert.ok(sim.calls.length > 0, 'vojenský zdroj kredity nemá, beží ďalej');
  await sim.run(60_000);
  assert.equal(sim.openskyCalls().length, 1, 'po cooldowne jeden snímok');
});

test('opakované chyby: odstup sa zdvojuje, log je stručný, po úspechu späť na normál', async () => {
  let down = true;
  const sim = simulation({ fail: (url) => down && url.endsWith('/api/opensky') });
  await sim.run(60 * 60_000);
  const failing = sim.openskyCalls().length;
  assert.ok(failing <= 7, `počas výpadku najviac pár pokusov za hodinu: ${failing}`);
  assert.ok(sim.logs.filter((m) => m.includes('upstream down')).length <= 7, 'chyby sa nelogujú pri každom pokuse');
  down = false;
  await sim.run(2 * KEEPER_MAX_BACKOFF_MS);
  const before = sim.openskyCalls().length;
  await sim.run(30 * 60_000);
  const after = sim.openskyCalls().length - before;
  assert.ok(after >= 19, `po zotavení ~40/h: za 30 min ${after}`);
  assert.equal(sim.keeper.status().streams.opensky.intervalMs, 90_000);
});

test('plný disk: strážca nesťahuje a oznámi to raz', async () => {
  let full = true;
  const sim = simulation({ canRecord: () => !full });
  await sim.run(10 * 60_000);
  assert.equal(sim.calls.length, 0);
  assert.equal(sim.logs.filter((m) => m.includes('málo voľného miesta')).length, 1);
  full = false;
  await sim.run(60_000);
  assert.ok(sim.calls.length > 0);
});

test('obnova kreditov sa zaznamená (dokumentácia neuvádza čas obnovy)', async () => {
  const sim = simulation({ credits: 1300 });
  await sim.run(30 * 60_000);
  sim.credits = 4000;
  await sim.run(30_000);
  const st = sim.keeper.status();
  assert.equal(st.openSkyCredits >= 3990, true);
  assert.ok(Number.isFinite(st.lastRefillAt), 'čas obnovy je v stave');
  assert.ok(sim.logs.some((m) => m.includes('kredity OpenSky obnovené')));
});

test('skutočný server: strážca sa pripojí po štarte, pýta sa lokálnych /api s hlavičkou a pri zatvorení skončí', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, keeper: req.headers[KEEPER_HEADER] });
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-OpenSky-Cache': 'MISS' });
    res.end('{"time":1,"states":[]}');
  });
  const keeper = createHistoryKeeper({
    streams: [
      { id: 'opensky', path: '/api/opensky', intervalMs: () => 60_000 },
      { id: 'mil', path: '/api/adsblol/mil', intervalMs: () => 60_000 },
    ],
    tickMs: 20,
    log: () => {},
  });
  keeper.attach(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  try {
    // Čakaj, kým strážca odpovede aj DOČÍTA (server ich vidí skôr, než dobehne fetch).
    const done = () => keeper.status().streams.opensky.lastStatus !== null && keeper.status().streams.mil.lastStatus !== null;
    const deadline = Date.now() + 3000;
    while (!done() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen.map((s) => s.url).sort(), ['/api/adsblol/mil', '/api/opensky']);
    assert.ok(seen.every((s) => s.keeper === '1'));
    const st = keeper.status();
    assert.equal(st.running, true);
    assert.equal(st.streams.opensky.lastStatus, 200);
    assert.equal(st.streams.opensky.lastCache, 'MISS');
    assert.equal(st.streams.mil.polls, 1);
    await new Promise((resolve) => server.close(resolve));
    closed = true;
    assert.equal(keeper.status().running, false, 'zatvorenie servera zastaví strážcu');
  } finally {
    if (!closed) server.close();
    keeper.stop();
  }
});

test('poistka disku: pod hranicou nie, nad ňou áno, disk sa nepýta pri každom zápise, chyba zápis nezastaví', () => {
  let nowMs = 0;
  let free = HISTORY_MIN_FREE_BYTES - 1;
  let calls = 0;
  const guard = createDiskGuard({
    dir: 'D:/oko-history',
    now: () => nowMs,
    statfs: () => { calls += 1; return { bavail: free, bsize: 1 }; },
  });
  assert.equal(guard.ok(), false);
  free = HISTORY_MIN_FREE_BYTES * 10;
  assert.equal(guard.ok(), false, 'do ďalšej kontroly platí posledný stav');
  assert.equal(calls, 1);
  nowMs += 60_000;
  assert.equal(guard.ok(), true);
  assert.equal(guard.status().freeBytes, HISTORY_MIN_FREE_BYTES * 10);
  const broken = createDiskGuard({ dir: 'X:/nic', statfs: () => { throw new Error('ENOENT'); } });
  assert.equal(broken.ok(), true);
});

test('vite.config.js: strážca beží v histórii letov, kredity z hlavičky OpenSky, návštevník ≠ strážca, poistka disku pri zápise', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  const history = vite.slice(vite.indexOf('function flightHistoryProxy()'), vite.indexOf('function openSkyProxy()'));
  assert.match(history, /createHistoryKeeper\(\{/);
  assert.match(history, /path: '\/api\/opensky', intervalMs: \(\) => keeperOpenSkyIntervalMs\(_openskyRemainingCredits\)/);
  assert.match(history, /blockedUntilMs: \(\) => Math\.max\(_openskyCooldownUntil, _openskyConstrainedUntil\)/);
  assert.match(history, /path: '\/api\/adsblol\/mil', intervalMs: \(\) => KEEPER_MIL_INTERVAL_MS/);
  assert.match(history, /keeper\.attach\(server\.httpServer\)/);
  assert.match(history, /FLIGHT_HISTORY_KEEPER/);
  assert.match(history, /if \(!isKeeperRequest\(req\)\) keeper\?\.noteClient\('opensky'\)/);
  assert.match(history, /if \(!isKeeperRequest\(req\)\) keeper\?\.noteClient\('mil'\)/);
  assert.match(history, /diskOk\(\)/);
  const proxy = vite.slice(vite.indexOf('function openSkyProxy()'));
  assert.match(proxy, /_openskyRemainingCredits = remaining;/);
  assert.match(proxy, /_openskyRemainingCredits = 0;/);
});
