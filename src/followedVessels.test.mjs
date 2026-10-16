// src/followedVessels.test.mjs — sledované lode (2026-10-11, bod 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { followKey, followMatches, sanitizeFollow, validFollowKey } from './auth/follows.js';
import {
  VESSEL_FOLLOW_LIVE_REMOTE_MS,
  VESSEL_FOLLOW_REMOTE_MAX,
  createFollowedVessels,
  fetchVesselLiveContact,
  followBellPlacement,
  vesselFollowHint,
  vesselFollowStatus,
  vesselFollowTransitions,
} from './followedVessels.js';
import { createFollowedFlights } from './followedFlights.js';
import { FOLLOW_WATCH_INTERVAL_MS } from './auth/server/pushWatch.js';
import { createShipServer } from './data/shipServer/index.js';

test('kľúč lode mmsi:, validácia aj na serveri; lety sa nezmenili', () => {
  assert.equal(followKey({ mmsi: '241190000' }), 'mmsi:241190000');
  assert.equal(followKey({ mmsi: 241190000 }), 'mmsi:241190000');
  assert.equal(followKey({ mmsi: '2411900' }), null, 'krátke MMSI');
  assert.equal(followKey({ hex: '4ca1d3', callsign: 'AUA40H' }), 'cs:AUA40H');
  assert.equal(validFollowKey('mmsi:241190000'), true);
  assert.equal(validFollowKey('mmsi:24119000x'), false);
  assert.deepEqual(sanitizeFollow({ mmsi: '241190000', label: 'MINERVA\u0000 ZEN' }),
    { key: 'mmsi:241190000', hex: null, callsign: null, label: 'MINERVA ZEN', mmsi: '241190000' });
  assert.equal(sanitizeFollow({ mmsi: '241190000' }).label, '241190000');
  assert.equal(followMatches({ key: 'mmsi:241190000' }, { mmsi: 241190000 }), true);
  assert.equal(followMatches({ key: 'mmsi:241190000' }, { hex: '241190' }), false);
});

test('stav: živé AIS má prednosť, inak plavba z registra', () => {
  const sailing = { voyage: { lastPort: 'Newport News', departedAt: 1 }, destinationPort: { name: 'Wilmington' } };
  const docked = { voyage: { lastPort: 'Wilmington', arrivedAt: 5, departedAt: null } };
  assert.deepEqual(vesselFollowStatus(null, sailing), { status: 'underway', port: 'Newport News', to: 'Wilmington', source: 'register' });
  assert.deepEqual(vesselFollowStatus(null, docked), { status: 'port', port: 'Wilmington', to: null, source: 'register' });
  assert.equal(vesselFollowStatus({ sog: 12.4, navStatus: 0 }, docked).status, 'underway', 'živé AIS prebije starý register');
  assert.equal(vesselFollowStatus({ sog: 0, navStatus: 5 }, sailing).status, 'port', 'moored');
  assert.equal(vesselFollowStatus({ sog: 0.2, navStatus: 1 }, null).status, 'anchor');
  assert.equal(vesselFollowStatus({ sog: 1.5, navStatus: 0 }, null).status, 'stopped', 'manéver pod 3 kn nie je cesta');
  assert.equal(vesselFollowStatus({ sog: 0.3, navStatus: 15 }, docked).status, 'port', 'stojí a register hovorí prístav');
  assert.equal(vesselFollowStatus(null, null).status, 'unknown');
});

test('prechody: vyplávala / priplávala; základ, kotva a neznámy nič nehlásia', () => {
  const m = (pairs) => new Map(pairs.map(([k, s]) => [k, { status: s }]));
  assert.deepEqual(vesselFollowTransitions(null, m([['a', 'underway']])), []);
  assert.deepEqual(vesselFollowTransitions(m([['a', 'port'], ['b', 'underway'], ['c', 'anchor'], ['d', 'unknown']]),
    m([['a', 'underway'], ['b', 'port'], ['c', 'underway'], ['d', 'underway']])),
  [{ key: 'a', type: 'departed' }, { key: 'b', type: 'arrived' }, { key: 'c', type: 'departed' }]);
  assert.deepEqual(vesselFollowTransitions(m([['a', 'underway']]), m([['a', 'anchor']])), [], 'kotva na rejde nie je príchod');
});

test('text stavu do palety', () => {
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(vesselFollowHint({ status: 'underway', to: 'Wilmington' }, t), 'follow.vessel.status.underway-to{"port":"Wilmington"}');
  assert.equal(vesselFollowHint({ status: 'port', port: null }, t), 'follow.vessel.status.port');
  assert.equal(vesselFollowHint(null, t), 'follow.vessel.status.unknown');
});

test('zvonček je vľavo od krížika v tej istej výške', () => {
  const p = followBellPlacement({ x: 100, y: 50, w: 300, h: 200 });
  assert.equal(p.y, 56);
  assert.equal(p.x, 100 + 300 - 26 - 6 - 26 - 6);
});

function fakeAccount() {
  let state = { user: null };
  const subs = new Set();
  let list = [];
  const calls = [];
  const client = {
    getState: () => state,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    follows: async () => ({ follows: list }),
    follow: async (body) => { calls.push(['follow', body]); const item = sanitizeFollow(body); list = [{ key: item.key, hex: item.hex, callsign: item.callsign, label: item.label }, ...list.filter((f) => f.key !== item.key)]; return { follows: list }; },
    unfollow: async (key) => { calls.push(['unfollow', key]); list = list.filter((f) => f.key !== key); return { follows: list }; },
  };
  const opened = [];
  return {
    account: { client, open: async (_, o) => opened.push(o), close: () => {} },
    signIn(id = 'u1') { state = { user: { id } }; for (const fn of subs) fn(state); },
    setList(l) { list = l; },
    calls, opened,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('controller: host → prihlásenie a loď sa pridá sama; toast pri vyplávaní; lety lode nevidia', async () => {
  const acc = fakeAccount();
  const notes = [];
  let live = { sog: 0, navStatus: 5 };
  let clock = 1_000_000;
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const fetches = [];
  const followed = createFollowedVessels({
    account: acc.account,
    translate: (k, v) => `${k}${v ? JSON.stringify(v) : ''}`,
    notify: (n) => notes.push(n),
    findLive: () => live,
    fetchInfo: async (mmsi) => { fetches.push(mmsi); return { voyage: { lastPort: 'Wilmington', arrivedAt: 5, departedAt: null } }; },
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    now: () => clock,
    storage,
  });
  const flights = createFollowedFlights({ account: acc.account, translate: (k) => k, setIntervalImpl: () => 2, clearIntervalImpl: () => {}, storage });
  // Host
  assert.equal(await followed.toggle({ mmsi: '241190000', name: 'MINERVA ZEN' }), false);
  assert.equal(acc.opened[0].reason, 'follow.vessel.login-reason');
  assert.equal(followed.hasPending(), true);
  // Prihlásenie → pridá sa sama
  acc.signIn();
  for (let i = 0; i < 6; i += 1) await tick();
  assert.deepEqual(acc.calls[0], ['follow', { mmsi: '241190000', label: 'MINERVA ZEN' }]);
  assert.equal(followed.getFollows().length, 1);
  assert.equal(flights.getFollows().length, 0, 'loď nie je v sledovaných letoch');
  assert.match(notes.at(-1), /follow\.vessel\.added/);
  // Základ (v prístave), potom vypláva
  await followed.evaluate({ baseline: true });
  assert.equal(followed.statusFor('241190000').status, 'port');
  live = { sog: 13.2, navStatus: 0 };
  clock += 30_000;
  await followed.evaluate();
  assert.match(notes.at(-1), /follow\.vessel\.departed-from.*Wilmington/);
  assert.equal(fetches.length, 1, 'register len raz za 15 min');
  // Paleta
  const cmds = followed.commands();
  assert.equal(cmds[0].group, 'follows');
  assert.equal(cmds[0].label, 'MINERVA ZEN');
  assert.match(cmds[0].hint, /underway/);
  // Odobratie
  await followed.toggle({ mmsi: '241190000' });
  assert.deepEqual(acc.calls.at(-1), ['unfollow', 'mmsi:241190000']);
  assert.equal(followed.getFollows().length, 0);
});

test('cieľ z AIS na čítanie; nová loď má stav hneď po pridaní (2026-10-11, snímka z okolive.sk)', async () => {
  const { prettyAisDestination } = await import('./followedVessels.js');
  assert.equal(prettyAisDestination('WILMINGTON.NC.USA'), 'Wilmington NC USA');
  assert.equal(prettyAisDestination('NLRTM'), 'NLRTM');
  assert.equal(prettyAisDestination('US ILM>NL RTM'), 'US ILM NL RTM');
  assert.equal(prettyAisDestination(''), null);
  assert.equal(vesselFollowStatus(null, { voyage: { lastPort: 'X', departedAt: 1 }, destination: 'WILMINGTON.NC.USA' }).to, 'Wilmington NC USA');
  const acc = fakeAccount();
  const followed = createFollowedVessels({
    account: acc.account, translate: (k) => k, findLive: () => ({ sog: 9.5, navStatus: 0 }),
    setIntervalImpl: () => 1, clearIntervalImpl: () => {}, storage: null,
  });
  acc.signIn();
  for (let i = 0; i < 4; i += 1) await tick();
  await followed.toggle({ mmsi: '232063671', name: 'CMA CGM JANE' });
  for (let i = 0; i < 4; i += 1) await tick();
  assert.equal(followed.statusFor('232063671')?.status, 'underway');
});

// --- 2026-10-16: lode sú predvolene vypnuté (d421beb) → getLiveContact vracia null. Živý stav
// sledovanej lode dá server (/api/ais-live/contact), vrstva lodí sa nezapína. ---

const DOCKED = { voyage: { lastPort: 'Wilmington', arrivedAt: 5, departedAt: null } };
const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };
const vesselList = (...mmsis) => mmsis.map((m, i) => ({ key: `mmsi:${m}`, hex: null, callsign: null, label: `LOD ${i + 1}` }));

async function signedInFollowed({ list, findLive, fetchLive, clock, fetchInfo = async () => DOCKED, liveAllowed }) {
  const acc = fakeAccount();
  acc.setList(list);
  const notes = [];
  const followed = createFollowedVessels({
    account: acc.account,
    translate: (k, v) => `${k}${v ? JSON.stringify(v) : ''}`,
    notify: (n) => notes.push(n),
    findLive,
    fetchLive,
    ...(liveAllowed ? { liveAllowed } : {}),
    fetchInfo,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    now: () => clock.t,
    storage: null,
  });
  acc.signIn(); // načíta zoznam → základ (baseline)
  await flush();
  return { followed, notes };
}

test('lode vypnuté: živý stav sledovanej lode dá server, najviac raz za 5 min; vyplávanie nečaká na register (2026-10-16)', async () => {
  const clock = { t: 1_000_000 };
  let server = { sog: 0, navStatus: 5 };
  const asked = [];
  const { followed, notes } = await signedInFollowed({
    list: vesselList('241190000'),
    clock,
    findLive: () => null, // vrstva lodí vypnutá
    fetchLive: async (mmsi) => { asked.push(mmsi); if (server instanceof Error) throw server; return server; },
  });
  assert.deepEqual(asked, ['241190000'], 'základ sa pýta servera');
  assert.equal(followed.statusFor('241190000').status, 'port');
  assert.equal(followed.statusFor('241190000').source, 'live', 'stav zo živého AIS servera, nie z registra');
  // Vyplávala; kolo o 30 s je ešte v takte → bez dopytu, bez toastu
  server = { sog: 12.4, navStatus: 0 };
  clock.t += 30_000;
  await followed.evaluate();
  assert.equal(asked.length, 1, 'v rámci 5 min žiadny ďalší dopyt na tú istú loď');
  assert.equal(notes.length, 0);
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS;
  await followed.evaluate();
  assert.equal(asked.length, 2);
  assert.equal(followed.statusFor('241190000').status, 'underway');
  assert.match(notes.at(-1), /follow\.vessel\.departed-from.*Wilmington/, 'toast do 5 min, nie po 15 min z registra');
  // Výpadok servera: posledný kontakt ostáva — starý register („v prístave") nesmie ohlásiť príchod
  server = new Error('503');
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS;
  await followed.evaluate();
  assert.equal(asked.length, 3);
  assert.equal(followed.statusFor('241190000').status, 'underway');
  assert.equal(notes.length, 1, 'bez falošného príchodu');
  clock.t += 30_000;
  await followed.evaluate();
  assert.equal(asked.length, 3, 'aj chyba drží takt 5 min');
  // Server loď v dosahu nemá (null) → stav z registra ako predtým
  server = null;
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS;
  await followed.evaluate();
  assert.equal(asked.length, 4);
  assert.equal(followed.statusFor('241190000').source, 'register');
});

test('lode zapnuté: kontakt z vrstvy v prehliadači, server sa nepýta; po vypnutí vrstvy prevezme server (2026-10-16)', async () => {
  const clock = { t: 2_000_000 };
  let local = { sog: 13, navStatus: 0 };
  const asked = [];
  const { followed } = await signedInFollowed({
    list: vesselList('232063671'),
    clock,
    findLive: () => local,
    fetchLive: async (mmsi) => { asked.push(mmsi); return { sog: 0, navStatus: 5 }; },
  });
  assert.equal(followed.statusFor('232063671').status, 'underway');
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS * 2;
  await followed.evaluate();
  assert.deepEqual(asked, [], 'loď je vo vrstve → žiadny dopyt na server');
  assert.equal(followed.statusFor('232063671').status, 'underway');
  local = null;
  clock.t += 30_000;
  await followed.evaluate();
  assert.deepEqual(asked, ['232063671'], 'vrstva loď stratila → hneď server');
  assert.equal(followed.statusFor('232063671').status, 'port');
});

test('strop: server sa pýta len na prvých VESSEL_FOLLOW_REMOTE_MAX lodí, rovnako ako register (2026-10-16)', async () => {
  const mmsis = Array.from({ length: VESSEL_FOLLOW_REMOTE_MAX + 5 }, (_, i) => String(241000000 + i));
  const asked = [];
  const { followed } = await signedInFollowed({
    list: vesselList(...mmsis),
    clock: { t: 3_000_000 },
    findLive: () => null,
    fetchLive: async (m) => { asked.push(m); return { sog: 10, navStatus: 0 }; },
  });
  assert.deepEqual(asked, mmsis.slice(0, VESSEL_FOLLOW_REMOTE_MAX));
  assert.equal(followed.statusFor(mmsis[0]).source, 'live');
  assert.equal(followed.statusFor(mmsis.at(-1)).status, 'unknown', 'za stropom ani register, ani server');
});

test('poradie toastov podľa zoznamu, aj keď server odpovie v inom poradí; dopyty bežia súbežne (2026-10-16)', async () => {
  const clock = { t: 4_000_000 };
  const pending = new Map();
  let immediate = { sog: 0, navStatus: 5 };
  const { followed, notes } = await signedInFollowed({
    list: vesselList('241190000', '232063671'),
    clock,
    findLive: () => null,
    fetchLive: (m) => (immediate ? Promise.resolve(immediate) : new Promise((resolve) => pending.set(m, resolve))),
  });
  assert.equal(followed.statusFor('241190000').status, 'port');
  assert.equal(followed.statusFor('232063671').status, 'port');
  immediate = null;
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS;
  const run = followed.evaluate();
  await flush(1);
  assert.deepEqual([...pending.keys()], ['241190000', '232063671'], 'oba dopyty naraz, nie loď po lodi');
  pending.get('232063671')({ sog: 11, navStatus: 0 });
  await flush(1);
  assert.equal(notes.length, 0, 'čaká na všetky odpovede');
  pending.get('241190000')({ sog: 12, navStatus: 0 });
  await run;
  assert.equal(notes.length, 2);
  assert.match(notes[0], /LOD 1/);
  assert.match(notes[1], /LOD 2/);
});

test('staršie vyhodnotenie s pomalým serverom sa uplatní pred novším, nie po ňom (2026-10-16)', async () => {
  const clock = { t: 5_000_000 };
  let local = null;
  let release = null;
  let slow = false;
  const { followed, notes } = await signedInFollowed({
    list: vesselList('241190000'),
    clock,
    findLive: () => local,
    fetchLive: () => (slow ? new Promise((resolve) => { release = resolve; }) : Promise.resolve({ sog: 0, navStatus: 5 })),
  });
  assert.equal(followed.statusFor('241190000').status, 'port');
  // 1. kolo: vrstva vypnutá, server odpovedá pomaly
  slow = true;
  clock.t += VESSEL_FOLLOW_LIVE_REMOTE_MS;
  const first = followed.evaluate();
  // 2. kolo: medzitým zapnutá vrstva vidí loď na ceste
  local = { sog: 12, navStatus: 0 };
  const second = followed.evaluate();
  await flush(2);
  local = null;
  release({ sog: 0, navStatus: 5 }); // odpoveď na starší dopyt: ešte v prístave
  await Promise.all([first, second]);
  assert.equal(followed.statusFor('241190000').status, 'underway', 'platí novšie kolo');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /departed/);
});

test('fetchVesselLiveContact: tvar skutočnej trasy /api/ais-live/contact, chyba = výnimka, časový limit (2026-10-16)', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'follow-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const NOW = Date.parse('2026-10-16T12:00:00Z');
  const vessels = new Map([['232063671', { mmsi: '232063671', lat: 51.2, lon: 1.9, speed: 11, nav_status: 0, last_position_epoch: NOW / 1000 - 30, name: 'JANE' }]]);
  const srv = createShipServer({
    rootDir: root,
    env: { SHIP_HISTORY_DIR: path.join(root, 'ships'), AIS_SUPPLEMENTS: 'off', DMA_BACKFILL: 'off' },
    vessels, tracks: new Map(), appendTrack: () => {}, cacheMax: 10, staleMs: 6 * 3600_000,
    feedStatus: () => ({ lastMessageAt: NOW, status: 'live' }), persistEnabled: () => false,
    createDiskGuard: () => ({ ok: () => true }), now: () => NOW,
  });
  const calls = [];
  // fetch → tá istá trasa servera (bez kľúča, len MMSI)
  const viaServer = async (url, init) => {
    calls.push([url, init?.headers?.Accept]);
    const incoming = new URL(url, 'http://localhost');
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    const handled = await srv.handleRoute({ socket: { remoteAddress: '1.2.3.4' }, headers: {} }, res, new URL(incoming.pathname.replace('/api/ais-live', '') + incoming.search, 'http://x'));
    assert.equal(handled, true);
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  const contact = await fetchVesselLiveContact('232063671', { fetchImpl: viaServer });
  assert.deepEqual(calls[0], ['/api/ais-live/contact?mmsi=232063671', 'application/json']);
  assert.equal(contact.sog, 11);
  assert.equal(contact.navStatus, 0);
  assert.equal(vesselFollowStatus(contact, null).status, 'underway');
  assert.equal(await fetchVesselLiveContact('241190000', { fetchImpl: viaServer }), null, 'server loď nemá → null');
  assert.equal(await fetchVesselLiveContact('12', { fetchImpl: viaServer }), null, 'zlé MMSI → bez dopytu');
  assert.equal(calls.length, 2);
  await assert.rejects(fetchVesselLiveContact('232063671', { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), /ais_contact_503/);
  let aborted = false;
  const hang = (_, init) => new Promise(() => { init?.signal?.addEventListener('abort', () => { aborted = true; }); });
  await assert.rejects(fetchVesselLiveContact('232063671', { fetchImpl: hang, timeoutMs: 5 }), /ais_contact_timeout/);
  assert.equal(aborted, true, 'visiaci dopyt sa zruší');
});

test('takt = takt serverového strážcu Web Push; main.js dáva fetchLive a vrstvu lodí kvôli tomu nezapína (2026-10-16)', () => {
  assert.equal(VESSEL_FOLLOW_LIVE_REMOTE_MS, FOLLOW_WATCH_INTERVAL_MS);
  const main = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  const start = main.indexOf('followedVessels = createFollowedVessels({');
  assert.ok(start > 0);
  const block = main.slice(start, main.indexOf('installVesselFollowButtons(viewer', start));
  assert.match(block, /fetchLive: \(mmsi\) => fetchVesselLiveContact\(mmsi\)/);
  assert.doesNotMatch(block, /setEnabled|setLayerEnabled|enableLayer/);
});

test('skrytá stránka sa servera na živý stav lode nepýta (2026-10-16: dopyt = návštevník → zdroje navyše naplno)', async () => {
  const clock = { t: 2_000_000 };
  let visible = false;
  const asked = [];
  const { followed } = await signedInFollowed({
    list: vesselList('241190000'),
    clock,
    findLive: () => null,
    fetchLive: async (mmsi) => { asked.push(mmsi); return { sog: 11, navStatus: 0 }; },
    liveAllowed: () => visible,
  });
  assert.deepEqual(asked, [], 'skrytá: žiadny dopyt');
  assert.equal(followed.statusFor('241190000').source, 'register');
  visible = true;
  clock.t += 30_000;
  await followed.evaluate();
  assert.deepEqual(asked, ['241190000'], 'po zobrazení hneď, nie až o 5 min');
  assert.equal(followed.statusFor('241190000').source, 'live');
});
