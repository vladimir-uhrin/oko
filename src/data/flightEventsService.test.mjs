// src/data/flightEventsService.test.mjs — služba Udalostí, etapa 1 (2026-09-30). Testy SPRÁVANIA celej
// cesty spúšťač → čakanie → stopa z druhej siete → overenie → uložená udalosť, na skutočných stopách:
// FZ1073 sa uloží ako overený a po 30 min uzavrie; šum 7500 sa uloží ako vyvrátený; body, ktoré archív
// prevzal z adsb.lol, sa neoverujú samy sebou; pri blokovaní adsb.lol pauza; API len z tohto počítača.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANALYSIS_VERSION, EVENT_FETCH_GAP_MS, createFlightEventsService, eventId, isOwnLocalPost, parseTimeParam } from './flightEventsService.js';
import { EMERGENCY_CODES, DIVE_VR_MPS } from './flightAnomalies.js';
import { STATE_BACKFILL_BLOCK_PAUSE_MS } from './stateAircraftBackfill.js';
import { createEventCardRenderer } from './eventCardRender.js';
import { createEventVideoStore } from './eventVideoRender.js';
import { createShareStore } from '../shareStore.js';
import { FDB1073_ROUTE, NOISE_CASES, T, fz1073, fz1073Event, noiseCase } from './fixtures/flightEventFixtures.mjs';

const fixtureText = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const row = (p, src = 'opensky') => [p.t, p.lat, p.lon, p.alt, p.gs, p.trk, p.vr, p.squawk, p.gnd ? 1 : 0, null, null, null, src];
const isTrigger = (p) => !p.gnd && (EMERGENCY_CODES[p.squawk] || (p.vr !== null && p.vr <= DIVE_VR_MPS && (p.alt ?? 0) >= 3000));
const triggersOf = (hex, points, src = 'opensky') => points.filter(isTrigger).map((p) => ({ icao24: hex, t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, vr: p.vr, squawk: p.squawk, src }));

function harness({ tracks = {}, triggers = [], legs = {}, traces = {}, startMs, routes = {}, news = null, trusted = null }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-events-'));
  let nowMs = startMs;
  const fetched = [];
  const aux = [];
  const waits = [];
  const logs = [];
  let httpStatus = 200;
  let trustedFile = null;
  if (trusted) {
    trustedFile = path.join(dir, 'trusted-news.json');
    writeFileSync(trustedFile, JSON.stringify({ domains: trusted }));
  }
  const store = {
    async triggersSince(fromS, toS) { return triggers.filter((r) => r.t >= fromS && r.t < toS); },
    async track(hex, { fromS, toS, withSrc }) {
      assert.equal(withSrc, true, 'služba potrebuje zdroj každého fixu');
      return (tracks[hex] || []).filter((r) => r[0] >= fromS && r[0] <= toS);
    },
    async flightsOf(hex) { return legs[hex] || []; },
  };
  const reply = (status, body = '') => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => Buffer.from(body), text: async () => body });
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.startsWith('https://api.adsbdb.com/')) {
      aux.push(u);
      const cs = decodeURIComponent(u.split('/').pop());
      return routes[cs] ? reply(200, JSON.stringify({ response: { flightroute: routes[cs] } })) : reply(404, '{"response":"unknown callsign"}');
    }
    if (u.startsWith('https://api.gdeltproject.org/')) {
      aux.push(u);
      const r = news ? news(new URL(u), nowMs) : { status: 200, body: '{}' };
      return reply(r.status, r.body);
    }
    fetched.push(u);
    if (httpStatus !== 200) return reply(httpStatus);
    const body = traces[u];
    if (!body) return reply(404);
    return reply(200, body);
  };
  const make = (extra = {}) => createFlightEventsService({
    getStore: () => store,
    eventsDir: dir,
    isLocal: (req) => req.local === true,
    fetchImpl,
    now: () => nowMs,
    sleep: async (ms) => { waits.push(ms); nowMs += ms; },
    log: (m) => logs.push(m),
    tickMs: 3_600_000,
    trustedFile,
    ...extra,
  });
  return {
    dir, fetched, aux, waits, logs, make,
    at: (iso) => { nowMs = Date.parse(iso); },
    setHttp: (s) => { httpStatus = s; },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function call(service, url, local = true, { method = 'GET', headers = {}, body = undefined } = {}) {
  const res = { status: 0, body: '', headers: {}, writeHead(s, h = {}) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  const req = { url, local, method, headers };
  if (body !== undefined) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    req[Symbol.asyncIterator] = async function* stream() { yield buf; };
  }
  await service.handle(req, res);
  const isJson = String(res.headers['Content-Type'] || '').startsWith('application/json');
  return { status: res.status, headers: res.headers, json: isJson ? JSON.parse(res.body) : null, body: res.body };
}
/** POST z vlastnej stránky OKO na localhoste (tak, ako ho pošle prehliadač vlastníka). */
const OWN_POST = { method: 'POST', headers: { origin: 'http://localhost:4173', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } };

const LIVE_FZ = 'https://adsb.lol/data/traces/d1/trace_full_8965d1.json';

test('FZ1073 celou cestou: čaká 3 min, overí adsb.lol, uloží OVERENÚ udalosť s časovou osou; po 30 min ju uzavrie', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T05:24:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    triggers: triggersOf('8965d1', oko),
    legs: { '8965d1': [{ callsign: 'FDB1073', firstT: T('2026-09-30T03:05:00Z'), lastT: T('2026-09-30T05:53:33Z') }] },
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const service = h.make();
    await service.tick();
    assert.equal(h.fetched.length, 0, '05:24 — ešte sa čaká (3 min po prvom spúšťači)');
    assert.equal(service.status().candidates, 1);
    h.at('2026-09-30T05:26:00Z');
    await service.tick();
    assert.deepEqual(h.fetched, [LIVE_FZ], 'dnešok ešte nie je v dennom archíve — živá stopa');
    // Klesanie rýchlejšie než 8 000 ft/min začína v stope o 05:21:48 (najprudšie 05:22:05).
    const id = eventId('8965d1', triggersOf('8965d1', oko)[0].t);
    assert.equal(id, '8965d1-20260930T0521');
    const first = service.store.get(id);
    assert.equal(first.status, 'confirmed');
    assert.deepEqual([first.callsign, first.reg, first.typeCode, first.final], ['FDB1073', 'A6-FKF', 'B38M', false]);
    assert.ok(first.timelineText.sk.some((l) => l.includes('strmhlavé klesanie')), first.timelineText.sk.join('\n'));
    assert.ok(!first.timelineText.sk.some((l) => l.includes('7500')), 'o 05:26 ešte 7500 (05:36) nie je — nič dopredu');
    assert.ok(existsSync(path.join(h.dir, '2026-09', `${id}.json`)), 'uložené ako JSON po mesiacoch');
    h.at('2026-09-30T06:00:00Z');
    await service.tick();
    assert.equal(h.fetched.length, 2, 'konečné spracovanie 30 min po poslednom spúšťači');
    const closed = service.store.get(id);
    assert.equal(closed.final, true);
    assert.ok(closed.timelineText.sk.includes('05:36:18 UTC — transpondér vysiela 7500 (nezákonný zásah) (adsb.lol)'), closed.timelineText.sk.join('\n'));
    assert.ok(closed.timelineText.sk.some((l) => l.startsWith('05:53:33 UTC — koniec údajov vo výške')), 'koniec údajov, nie vymyslené pristátie');
    assert.equal(service.status().candidates, 0);
    h.at('2026-09-30T06:05:00Z');
    await service.tick();
    assert.equal(h.fetched.length, 2, 'uzavretá udalosť sa znova nespracúva');
  } finally {
    h.cleanup();
  }
});

test('šum: „7500" z archívu OKO, adsb.lol v tom čase s bežným kódom → uložené ako VYVRÁTENÉ, s kódom druhej siete', async () => {
  const c = NOISE_CASES[0];
  const { oko } = noiseCase(c);
  const live = `https://adsb.lol/data/traces/${c.hex.slice(-2)}/trace_full_${c.hex}.json`;
  const h = harness({
    startMs: Date.parse('2026-09-30T00:10:00Z'),
    tracks: { [c.hex]: oko.map((p) => row(p)) },
    triggers: triggersOf(c.hex, oko),
    traces: { [live]: fixtureText(c.file) },
  });
  try {
    const service = h.make();
    await service.tick();
    const [summary] = service.store.list();
    assert.equal(summary.status, 'rejected');
    const e = service.store.get(summary.id);
    assert.deepEqual(e.triggers.map((t) => [t.code, t.status, t.verification.adsblol.codes]), [['7500', 'contradicted', [c.otherCode]]]);
    assert.ok(!e.timeline.some((m) => m.kind === 'squawk'), 'šum nie je na časovej osi');
  } finally {
    h.cleanup();
  }
});

test('nezávislosť: body, ktoré archív prevzal z adsb.lol (náhrada), sa s adsb.lol neoverujú → NEOVERENÉ, nie overené', async () => {
  const t0 = T('2026-09-30T10:00:00Z');
  const readsb = {
    icao: 'abc123', r: 'OM-ABC', t: 'A320', timestamp: t0,
    trace: Array.from({ length: 11 }, (_, i) => [i * 30, 48 + i * 0.01, 17, 30000, 400, 90, 0, 0, i === 0 ? { flight: 'TEST1', squawk: '7500' } : null, 'adsb_icao', null, null, null, null]),
  };
  const regional = Array.from({ length: 11 }, (_, i) => ({ t: t0 + i * 30, lat: 48 + i * 0.01, lon: 17, alt: 9144, gs: 205, trk: 90, vr: 0, squawk: '7500', gnd: false }));
  const h = harness({
    startMs: Date.parse('2026-09-30T10:10:00Z'),
    tracks: { abc123: regional.map((p) => row(p, 'adsb.lol/regional')) },
    triggers: triggersOf('abc123', regional, 'adsb.lol/regional'),
    traces: { 'https://adsb.lol/data/traces/23/trace_full_abc123.json': JSON.stringify(readsb) },
  });
  try {
    const service = h.make();
    await service.tick();
    const [summary] = service.store.list();
    assert.equal(summary.status, 'unverified', 'tá istá sieť dvakrát nie je overenie');
  } finally {
    h.cleanup();
  }
});

test('vojenský výcvik: strmhlavé klesanie vojenského lietadla (adsb.lol dbFlags) = rutina, nie udalosť; zo zoznamu vojenských sa ani nepýta', async () => {
  const t0 = T('2026-09-30T17:14:00Z');
  const dive = (i) => [i * 20, 40 + i * 0.01, -100, Math.max(5000, 25000 - i * 3000), 350, 90, 0, i >= 1 && i <= 4 ? -9500 : 0, i === 0 ? { flight: 'NINJA42' } : null, 'adsb_icao', null, null, null, null];
  const readsb = { icao: 'adffc6', r: '64-10297', t: 'C130', dbFlags: 1, timestamp: t0, trace: Array.from({ length: 12 }, (_, i) => dive(i)) };
  const { traceToFlight } = await import('./adsblolTrace.js');
  const flight = traceToFlight(readsb);
  assert.equal(flight.military, true);
  assert.equal(traceToFlight({ ...readsb, dbFlags: 0 }).military, false);
  const oko = flight.points.map((p) => ({ ...p, squawk: null }));
  const h = harness({
    startMs: Date.parse('2026-09-30T17:30:00Z'),
    tracks: { adffc6: oko.map((p) => row(p)) },
    triggers: [...triggersOf('adffc6', oko), ...triggersOf('ae0100', oko, 'adsb.lol/mil').map((r) => ({ ...r, icao24: 'ae0100' }))],
    traces: { 'https://adsb.lol/data/traces/c6/trace_full_adffc6.json': JSON.stringify(readsb) },
  });
  try {
    const service = h.make();
    await service.tick();
    assert.deepEqual(h.fetched, ['https://adsb.lol/data/traces/c6/trace_full_adffc6.json'], 'ae0100 (zo zoznamu vojenských) sa nepýta');
    const all = await call(service, '/?status=all');
    assert.deepEqual(all.json.events.map((e) => [e.id.slice(0, 6), e.status, e.military]), [['adffc6', 'routine', true]]);
    assert.equal(service.store.get(all.json.events[0].id).routineReason, 'military');
    assert.deepEqual((await call(service, '/')).json.events, [], 'predvolený zoznam = len udalosti');
  } finally {
    h.cleanup();
  }
});

test('kategória a volací znak: klesanie ľahkého lietadla (A1) a nedopravného letu (Mirage F1 ATAC3 má kategóriu 3) = rutina; dopravný let ostáva udalosťou; núdzový kód vždy', async () => {
  const t0 = T('2026-09-30T12:00:00Z');
  const trace = (hex, category, squawk = null, flight = 'ABC123') => ({
    icao: hex, r: 'N1', t: 'X', timestamp: t0,
    trace: Array.from({ length: 12 }, (_, i) => [i * 20, 40, -100 + i * 0.01, Math.max(4000, 20000 - i * 3000), 150, 90, 0, i >= 1 && i <= 4 ? -9500 : 0,
      i === 0 ? { flight, category, ...(squawk ? { squawk } : {}) } : null, 'adsb_icao', null, null, null, null]),
  });
  const cases = [
    ['a00001', 'A1', null, 'routine', 'ABC123'],
    ['a00002', 'A3', null, 'confirmed', 'ABC123'],
    ['a00003', 'A1', '7700', 'confirmed', 'JUMP1'],
    ['a00004', 'A2', null, 'routine', 'ATAC3'],
  ];
  const { traceToFlight } = await import('./adsblolTrace.js');
  const tracks = {};
  const triggers = [];
  const traces = {};
  for (const [hex, cat, sq, , cs] of cases) {
    const json = trace(hex, cat, sq, cs);
    const pts = traceToFlight(json).points;
    tracks[hex] = pts.map((p) => row(p));
    triggers.push(...triggersOf(hex, pts));
    traces[`https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`] = JSON.stringify(json);
  }
  const h = harness({ startMs: Date.parse('2026-09-30T12:30:00Z'), tracks, triggers, traces });
  try {
    const service = h.make();
    await service.tick();
    const got = Object.fromEntries(service.store.list({ statuses: null }).map((e) => [e.icao24, e.status]));
    assert.deepEqual(got, Object.fromEntries(cases.map(([hex, , , want]) => [hex, want])));
    const light = service.store.list({ statuses: null }).find((e) => e.icao24 === 'a00001');
    assert.equal(service.store.get(light.id).routineReason, 'category');
    const contractor = service.store.list({ statuses: null }).find((e) => e.icao24 === 'a00004');
    assert.equal(service.store.get(contractor.id).routineReason, 'not-airline');
  } finally {
    h.cleanup();
  }
});

test('nová verzia pravidiel: udalosť analyzovaná staršou verziou sa v okne spätného dohľadania spracuje nanovo', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T06:00:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    triggers: triggersOf('8965d1', oko),
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const first = h.make();
    await first.tick();
    const [e] = first.store.list();
    assert.equal(first.store.get(e.id).version, ANALYSIS_VERSION);
    first.store.save({ ...first.store.get(e.id), version: 1, status: 'unverified' });
    const again = h.make();
    await again.tick();
    assert.equal(h.fetched.length, 2, 'staršia verzia = nie uzavreté');
    assert.deepEqual([again.store.get(e.id).status, again.store.get(e.id).version], ['confirmed', ANALYSIS_VERSION]);
    const third = h.make();
    await third.tick();
    assert.equal(h.fetched.length, 2, 'aktuálna verzia uzavretá — nepýta sa znova');
  } finally {
    h.cleanup();
  }
});

test('reštart servera: zastavená služba rozbehnutý tik nedokončí (nič neuloží, ďalej sa nepýta); bez archívu sa neanalyzuje', async () => {
  const { oko } = fz1073();
  const c = NOISE_CASES[0];
  const noise = noiseCase(c);
  let service = null;
  const h = harness({
    startMs: Date.parse('2026-09-30T06:00:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)), [c.hex]: noise.oko.map((p) => row(p)) },
    triggers: [...triggersOf('8965d1', oko), ...triggersOf(c.hex, noise.oko)],
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    service = h.make();
    const origFetchCount = () => h.fetched.length;
    // Stop príde počas prvého dopytu (Vite reštartoval, nová inštancia už beží).
    const tick = service.tick();
    service.stop();
    await tick;
    assert.ok(origFetchCount() <= 1, `po zastavení žiadne ďalšie dopyty (${origFetchCount()})`);
    assert.equal(service.store.list({ statuses: null }).length, 0, 'zastavená inštancia nič neuloží');
    const orphan = createFlightEventsService({
      getStore: () => null, eventsDir: h.dir, isLocal: () => true,
      fetchImpl: async () => { throw new Error('bez archívu sa nepýta'); }, now: () => Date.parse('2026-09-30T06:00:00Z'), log: () => {},
    });
    assert.deepEqual(await orphan.analyze('8965d1', T('2026-09-30T03:00:00Z'), T('2026-09-30T06:00:00Z')), { error: 'no_store' });
  } finally {
    service?.stop();
    h.cleanup();
  }
});

test('správy: dve dôveryhodné médiá → na zverejnenie (dáta + správy); skôr nič, bulvár nie; 429 = pauza; nové spracovanie správy nezmaže', async () => {
  const { oko } = fz1073();
  const gdelt = { status: 200, calls: [] };
  const art = (domain, iso, title) => ({ url: `https://${domain}/x/${iso}`, title, seendate: iso.replace(/[-:]/g, '').replace('.000', ''), domain, language: 'English' });
  const articles = [
    art('mirror.co.uk', '2026-09-30T08:00:00Z', 'Terror on flydubai jet bound for Tel Aviv'),
    art('jta.org', '2026-09-30T18:00:00Z', 'Passengers from the attempted flydubai hijacking are back in Israel'),
    art('jpost.com', '2026-09-30T19:00:00Z', 'Why two extra pilots flew on the flydubai jet during the hijacking attempt over Israel-bound route'),
  ];
  const h = harness({
    startMs: Date.parse('2026-09-30T05:26:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    triggers: triggersOf('8965d1', oko),
    legs: { '8965d1': [{ callsign: 'FDB1073', firstT: T('2026-09-30T03:05:00Z'), lastT: T('2026-09-30T05:53:33Z') }] },
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
    routes: { FDB1073: FDB1073_ROUTE },
    trusted: ['jta.org', 'jpost.com', 'theguardian.com'],
    news: (url, nowMs) => {
      gdelt.calls.push(url);
      if (gdelt.status !== 200) return { status: gdelt.status, body: 'Please limit requests' };
      const to = url.searchParams.get('enddatetime');
      const inWindow = articles.filter((a) => a.seendate.replace('T', '').replace('Z', '') <= to);
      return { status: 200, body: JSON.stringify({ articles: inWindow }) };
    },
  });
  try {
    const service = h.make();
    await service.tick();
    let [e] = service.store.list();
    assert.equal(e.status, 'confirmed');
    assert.deepEqual([e.news, e.publishable], ['none', false], '05:26 — správy ešte nie sú');
    assert.equal(gdelt.calls.length, 1);
    assert.match(gdelt.calls[0].searchParams.get('query'), /"Fly Dubai" OR FlyDubai OR FZ1073/);
    h.at('2026-09-30T06:00:00Z');
    await service.tick();
    assert.equal(service.store.get(e.id).final, true, 'konečné spracovanie údajov');
    assert.equal(service.store.get(e.id).news.status, 'none', 'správy sa pri novom spracovaní nestratili');
    h.at('2026-09-30T09:00:00Z');
    await service.tick();
    [e] = service.store.list();
    assert.equal(e.news, 'reported', 'len bulvár — nie overené');
    gdelt.status = 429;
    h.at('2026-09-30T18:40:00Z');
    await service.tick();
    const blockedCalls = gdelt.calls.length;
    h.at('2026-09-30T18:45:00Z');
    await service.tick();
    assert.equal(gdelt.calls.length, blockedCalls, 'po 429 pauza');
    gdelt.status = 200;
    h.at('2026-09-30T19:30:00Z');
    await service.tick();
    [e] = service.store.list();
    assert.deepEqual([e.news, e.newsType, e.publishable], ['verified', 'hijack', true]);
    const full = service.store.get(e.id);
    assert.deepEqual(full.news.trusted.map((t) => t.domain), ['jta.org', 'jpost.com']);
    assert.equal(full.route.flightIata, 'FZ1073');
    const callsBefore = gdelt.calls.length;
    h.at('2026-09-30T21:00:00Z');
    await service.tick();
    assert.equal(gdelt.calls.length, callsBefore, 'overené správy sa už nehľadajú');
    // Ručné nové spracovanie údajov (napr. preverenie z denného archívu) správy zachová.
    await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.equal(service.store.get(e.id).news.status, 'verified');
    assert.equal(h.aux.filter((u) => u.startsWith('https://api.adsbdb.com/')).length, 1, 'trasa z adsbdb raz, potom z udalosti');
  } finally {
    h.cleanup();
  }
});

test('adsb.lol blokuje (403): nič sa neuloží, 30 min pauza, potom znova; dopyty najviac raz za 10 s', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T05:26:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    triggers: triggersOf('8965d1', oko),
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const service = h.make();
    h.setHttp(403);
    await service.tick();
    assert.equal(service.store.list().length, 0);
    assert.ok(service.status().blockedUntil > Date.parse('2026-09-30T05:26:00Z'));
    h.setHttp(200);
    h.at('2026-09-30T05:40:00Z');
    await service.tick();
    assert.equal(h.fetched.length, 1, 'počas pauzy žiadny dopyt');
    h.at(new Date(Date.parse('2026-09-30T05:26:00Z') + STATE_BACKFILL_BLOCK_PAUSE_MS + 1000).toISOString());
    await service.tick();
    assert.equal(h.fetched.length, 2);
    assert.equal(service.store.list()[0].status, 'confirmed');
    // Dva dopyty hneď po sebe (ručná analýza) čakajú 10 s.
    await service.analyze('8965d1', T('2026-09-30T03:00:00Z'), T('2026-09-30T06:00:00Z'));
    await service.analyze('8965d1', T('2026-09-30T03:00:00Z'), T('2026-09-30T06:00:00Z'));
    assert.ok(h.waits.includes(EVENT_FETCH_GAP_MS), `čakania ${h.waits}`);
  } finally {
    h.cleanup();
  }
});

test('neskoré overenie: živá stopa už zmizla (404) → NEOVERENÉ; keď vyjde denný archív, preverí sa znova pod tým istým id', async () => {
  const { oko } = fz1073();
  const DAY_FZ = 'https://adsb.lol/globe_history/2026/09/30/traces/d1/trace_full_8965d1.json';
  const h = harness({
    startMs: Date.parse('2026-09-30T20:20:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    traces: { [DAY_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const service = h.make();
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.deepEqual([r.json.status, r.json.recheckDay], ['unverified', '2026-09-30'], 'bez druhej siete nič nie je overené');
    assert.deepEqual(h.fetched, [LIVE_FZ]);
    const id = r.json.id;
    h.at('2026-09-30T23:00:00Z');
    await service.tick();
    assert.equal(h.fetched.length, 1, 'denný archív 30. 9. ešte nevyšiel');
    h.at('2026-10-01T03:00:00Z');
    await service.tick();
    assert.deepEqual(h.fetched.slice(1), [DAY_FZ], 'po zverejnení dňa z denného archívu');
    const again = service.store.get(id);
    assert.deepEqual([again.status, again.recheckDay], ['confirmed', null]);
    assert.equal(service.store.list({ statuses: null }).length, 1, 'to isté id — žiadny dvojník');
    await service.tick();
    assert.equal(h.fetched.length, 2, 'preverené sa znova nepýta');
  } finally {
    h.cleanup();
  }
});

test('denný archív adsb.lol vyjde neskôr než o 02:00 (404): udalosť NEostane navždy neoverená — nový pokus o 30 min, po vydaní OVERENÁ; bez archívu najviac 24 pokusov', async () => {
  const { oko } = fz1073();
  const DAY_FZ = 'https://adsb.lol/globe_history/2026/09/30/traces/d1/trace_full_8965d1.json';
  const traces = {};
  const h = harness({ startMs: Date.parse('2026-09-30T20:20:00Z'), tracks: { '8965d1': oko.map((p) => row(p)) }, traces });
  try {
    const service = h.make();
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    const id = r.json.id;
    assert.deepEqual([r.json.status, r.json.recheckDay], ['unverified', '2026-09-30']);
    h.at('2026-10-01T02:01:00Z');
    await service.tick();
    assert.deepEqual(h.fetched.slice(1), [DAY_FZ], 'o 02:01 pokus o denný archív');
    let e = service.store.get(id);
    assert.deepEqual([e.status, e.recheckDay, e.recheckTries], ['unverified', '2026-09-30', 1], 'archív ešte nie je — preverí sa znova');
    h.at('2026-10-01T02:20:00Z');
    await service.tick();
    assert.equal(h.fetched.length, 2, 'nie každú minútu — až o 30 min');
    traces[DAY_FZ] = fixtureText('adsblol-trace-8965d1-20260930.json');
    h.at('2026-10-01T02:32:00Z');
    await service.tick();
    e = service.store.get(id);
    assert.deepEqual([e.status, e.recheckDay], ['confirmed', null], 'po vydaní archívu overená');
    assert.equal(h.fetched.length, 3);
    // Lietadlo, ktoré v archíve naozaj nie je: po 24 pokusoch koniec (žiadne nekonečné dopyty).
    // Bez uloženej stopy (tú by preverenie použilo — test nižšie): lietadlo v archíve naozaj nie je.
    const lone = { ...service.store.get(id), id: '8965d1-20260930T0600', status: 'unverified', recheckDay: '2026-09-30', recheckTries: 0, recheckNotBefore: null, secondNetworkTrace: null };
    delete traces[DAY_FZ];
    service.store.save(lone);
    let t = Date.parse('2026-10-01T03:00:00Z');
    for (let i = 0; i < 30; i += 1) { h.at(new Date(t).toISOString()); await service.tick(); t += 31 * 60_000; }
    const gaveUp = service.store.get(lone.id);
    assert.deepEqual([gaveUp.status, gaveUp.recheckDay, gaveUp.recheckTries], ['unverified', null, 24]);
    assert.equal(h.fetched.length, 3 + 24, 'presne 24 pokusov');
  } finally {
    h.cleanup();
  }
});

test('API len z tohto počítača: zoznam, detail, ručná analýza ľubovoľného letu; reštart načíta uložené a uzavreté nevracia', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T08:00:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const service = h.make();
    assert.equal((await call(service, '/', false)).status, 404, 'verejnosť nevidí nič (etapa 1 je súkromná)');
    const bad = await call(service, '/analyze?hex=8965d1&from=2026-09-28T00:00:00Z&to=2026-09-30T06:00:00Z');
    assert.equal(bad.status, 400, 'okno nad 48 h');
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T06:00:00Z&save=1');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'confirmed');
    assert.equal(r.json.final, true, 'okno skončilo pred viac než 30 min');
    const list = await call(service, '/?status=confirmed');
    assert.deepEqual(list.json.events.map((e) => e.id), [r.json.id]);
    assert.equal((await call(service, `/${r.json.id}`)).json.reg, 'A6-FKF');
    assert.equal((await call(service, '/../../etc/passwd')).status, 404);
    // Reštart: nová inštancia načíta udalosti z disku a spúšťač vnútri uzavretej udalosti nevráti.
    const restarted = createFlightEventsService({
      getStore: () => ({ triggersSince: async () => triggersOf('8965d1', oko), track: async () => [], flightsOf: async () => [] }),
      eventsDir: h.dir,
      isLocal: () => true,
      fetchImpl: async () => { throw new Error('nemá sa pýtať'); },
      now: () => Date.parse('2026-09-30T08:05:00Z'),
      log: () => {},
    });
    assert.equal(restarted.store.list().length, 1);
    await restarted.tick();
    assert.equal(restarted.status().candidates, 0);
    assert.equal(parseTimeParam('1790745725'), 1790745725);
    assert.equal(parseTimeParam('2026-09-30T05:22:05Z'), T('2026-09-30T05:22:05Z'));
    assert.equal(parseTimeParam('zajtra'), null);
  } finally {
    h.cleanup();
  }
});

const LOCAL_DATA = fileURLToPath(new URL('./local_data', import.meta.url));

test('zverejnenie celou cestou: bez overenia správami nie; cudzia stránka nie; klik vlastníka → trvalý odkaz okolive.sk/s/<id> s obrázkom, verejný pohľad, text pre FB; stiahnutie → 404', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T08:00:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    legs: { '8965d1': [{ callsign: 'FDB1073', firstT: T('2026-09-30T03:05:00Z'), lastT: T('2026-09-30T05:53:33Z') }] },
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  const shareDir = path.join(h.dir, 'share');
  const shares = createShareStore({ dir: shareDir, now: () => Date.parse('2026-09-30T20:00:00Z') });
  try {
    const service = h.make({ renderCard: createEventCardRenderer({ dataDir: LOCAL_DATA }), shareStore: shares });
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    const id = r.json.id;
    assert.equal(r.json.status, 'confirmed');
    assert.ok(r.json.track.length > 50 && r.json.track.length <= 420, `stopa na obrázok ${r.json.track.length} bodov`);
    // Pred zverejnením: verejnosť nič, vlastník náhľad presne toho, čo uvidí verejnosť.
    assert.equal((await call(service, `/public/${id}`, false)).status, 404, 'nezverejnené verejnosť nevidí');
    const preview = await call(service, `/public/${id}`);
    assert.deepEqual([preview.status, preview.json.preview, preview.json.publishable], [200, true, false]);
    // Dáta overené, správy ešte nie → zverejniť sa nedá.
    const early = await call(service, `/${id}/publish`, true, OWN_POST);
    assert.deepEqual([early.status, early.json.error], [409, 'not_publishable']);
    // Overené aj správami (2 dôveryhodné médiá — ako z GDELT v teste vyššie).
    const verified = await fz1073Event();
    service.store.save({ ...service.store.get(id), route: verified.route, news: verified.news });
    // Cudzia stránka otvorená v prehliadači vlastníka (CSRF) ani „jednoduchý" formulár nič nezverejnia.
    const evil = await call(service, `/${id}/publish`, true, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' } });
    assert.equal(evil.status, 403);
    const form = await call(service, `/${id}/publish`, true, { method: 'POST', headers: { origin: 'http://localhost:4173', 'content-type': 'text/plain' } });
    assert.equal(form.status, 403);
    assert.equal((await call(service, `/${id}/publish`, false, OWN_POST)).status, 404, 'z verejnej adresy vôbec nie');
    assert.equal(service.store.get(id).published ?? null, null, 'nič nezverejnené');
    // Klik vlastníka.
    const pub = await call(service, `/${id}/publish`, true, OWN_POST);
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const url = pub.json.published.url;
    assert.match(url, /^https:\/\/okolive\.sk\/s\/[A-Za-z0-9]{10}$/, 'verejná adresa, nie localhost');
    assert.equal(pub.json.facebook, `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
    assert.ok(pub.json.text.includes(`Rekonštrukcia letu na mape: ${url}`));
    assert.ok(pub.json.text.startsWith('Nezákonný zásah na palube (únos): let FZ1073 (Fly Dubai) Dubai → Tel Aviv, 30. 9. 2026'), pub.json.text);
    const record = shares.read(pub.json.published.shareId);
    assert.equal(record.keep, true, 'odkaz z príspevku retencia nemaže');
    assert.match(record.hash, /^lat=\d+\.\d{4}&lon=\d+\.\d{4}&alt=\d+&heading=0&pitch=-90&event=8965d1-20260930T0521$/);
    assert.ok(record.title.startsWith('Nezákonný zásah na palube (únos): let FZ1073'));
    assert.ok(record.description.includes('OpenSky, adsb.lol') && record.description.includes('JTA'));
    const meta = await sharp(readFileSync(shares.imagePath(record.id))).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 1200, 630], 'obrázok pre náhľad odkazu na FB');
    // Verejný pohľad po zverejnení: bez interných polí, s médiami a momentmi.
    const pubView = await call(service, `/public/${id}`, false);
    assert.equal(pubView.status, 200);
    assert.equal(pubView.headers['Cache-Control'], 'public, max-age=60');
    assert.deepEqual([pubView.json.preview, pubView.json.publishable, pubView.json.published.url], [false, true, url]);
    assert.equal(pubView.json.moments.length, 6);
    assert.deepEqual(pubView.json.news.sources.map((s) => s.name), ['JTA', 'The Jerusalem Post', 'The Guardian', 'Arab News']);
    for (const key of ['secondNetwork', 'query', 'routineReason', 'triggers', 'timelineText']) assert.ok(!(key in pubView.json), `bez ${key}`);
    assert.ok(!JSON.stringify(pubView.json).includes('gdeltproject'), 'bez dopytu do GDELT');
    // Opakované zverejnenie = ten istý odkaz; nové spracovanie údajov zverejnenie nezmaže.
    const again = await call(service, `/${id}/publish`, true, OWN_POST);
    assert.equal(again.json.published.url, url);
    assert.equal(readdirSync(shareDir).length, 2, 'jeden záznam + jeden obrázok');
    await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.equal(service.store.get(id).published.url, url);
    assert.equal(service.store.list({ statuses: null })[0].published, url, 'zoznam ukazuje odkaz');
    // Obrázok do príspevku (1080×1350) a text na kontrolu.
    const feed = await call(service, `/${id}/card.jpg?format=feed`);
    assert.equal(feed.headers['Content-Type'], 'image/jpeg');
    const feedMeta = await sharp(feed.body).metadata();
    assert.deepEqual([feedMeta.width, feedMeta.height], [1080, 1350]);
    assert.equal((await call(service, `/${id}/card.jpg`, false)).status, 404, 'obrázok na kontrolu len lokálne');
    assert.equal((await call(service, `/${id}/post`)).json.text, pub.json.text);
    // Stiahnutie: odkaz aj verejný pohľad preč.
    const down = await call(service, `/${id}/unpublish`, true, OWN_POST);
    assert.deepEqual([down.status, down.json.published], [200, null]);
    assert.equal(shares.read(record.id), null, '/s/<id> potom 404');
    assert.equal((await call(service, `/public/${id}`, false)).status, 404);
  } finally {
    h.cleanup();
  }
});

test('staršia udalosť bez stopy: obrázok si stopu doplní z archívu OKO (len OpenSky a adsb.lol), bez nového dopytu a overovania', async () => {
  const { oko } = fz1073();
  const other = { t: T('2026-09-30T05:00:00Z') + 1, lat: 10, lon: 10, alt: 10000, gs: 200, trk: 0, vr: 0, squawk: null, gnd: false };
  const h = harness({
    startMs: Date.parse('2026-09-30T08:00:00Z'),
    tracks: { '8965d1': [...oko.map((p) => row(p)), row(other, 'iny-zdroj')] },
  });
  try {
    let drawn = null;
    const service = h.make({ renderCard: async (event) => { drawn = event; return { jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), width: 1200, height: 630 }; } });
    const e = { ...(await fz1073Event()), window: { fromT: T('2026-09-30T03:00:00Z'), toT: T('2026-09-30T07:00:00Z') } };
    delete e.track;
    service.store.save(e);
    const card = await call(service, `/${e.id}/card.jpg`);
    assert.equal(card.status, 200);
    assert.ok(drawn.track.length > 50, `${drawn.track.length}`);
    assert.ok(!drawn.track.some((p) => p[1] === 10 && p[2] === 10), 'bod iného zdroja (mimo atribúcie) nie');
    assert.deepEqual(h.fetched, [], 'žiadny dopyt na adsb.lol — overenie ostáva, ako bolo');
    assert.ok(service.store.get(e.id).track.length > 50, 'stopa uložená k udalosti');
    assert.equal(service.store.get(e.id).status, e.status);
  } finally {
    h.cleanup();
  }
});

test('isOwnLocalPost: POST z vlastnej stránky / curl s JSON áno; cudzia stránka, iný web alebo bez JSON nie', () => {
  const req = (headers) => ({ headers });
  assert.equal(isOwnLocalPost(req({ origin: 'http://localhost:4173', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' })), true);
  assert.equal(isOwnLocalPost(req({ 'content-type': 'application/json; charset=utf-8' })), true, 'curl z tohto počítača');
  assert.equal(isOwnLocalPost(req({ origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' })), true);
  assert.equal(isOwnLocalPost(req({ origin: 'https://okolive.sk', 'content-type': 'application/json' })), false);
  assert.equal(isOwnLocalPost(req({ 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })), false);
  assert.equal(isOwnLocalPost(req({ origin: 'http://localhost:4173', 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' })), false, 'formulár bez predletu');
  assert.equal(isOwnLocalPost(req({ origin: 'http://localhost.evil.example', 'content-type': 'application/json' })), false);
});

test('uložená stopa druhej siete: pri overení sa uloží; keď ju adsb.lol zmaže (živá zmizla, v dennom archíve lietadlo chýba), udalosť ostane OVERENÁ', async () => {
  const { oko } = fz1073();
  const traces = { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') };
  const h = harness({ startMs: Date.parse('2026-09-30T08:00:00Z'), tracks: { '8965d1': oko.map((p) => row(p)) }, traces });
  try {
    const service = h.make();
    const first = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.equal(first.json.status, 'confirmed');
    const stored = service.store.get(first.json.id).secondNetworkTrace;
    assert.deepEqual([stored.source, stored.origin, stored.url], ['adsb.lol', 'fetch', LIVE_FZ]);
    assert.ok(stored.points.length > 300, `${stored.points.length} bodov v okne`);
    // Naživo FZ1073: živá stopa o 20:20 zmizla a denný archív 30. 9. lietadlo nemá.
    delete traces[LIVE_FZ];
    h.at('2026-10-01T06:00:00Z');
    const again = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.equal(again.json.status, 'confirmed', 'neskoršie spracovanie potvrdenú udalosť nezhodí');
    assert.ok(again.json.secondNetwork.some((s) => s.status === 404), 'adsb.lol stopu už nemá');
    assert.ok(again.json.secondNetwork.some((s) => s.status === 'stored'), 'priznané: overené uloženou stopou');
    assert.ok(again.json.timelineText.sk.some((l) => l.includes('7500') && l.includes('adsb.lol')), 'kódy, ktoré videla len adsb.lol, ostanú');
  } finally {
    h.cleanup();
  }
});

test('dodaná stopa (ručne, napr. živá stopa uložená skôr): FZ1073 z NEOVERENEJ na OVERENÚ s pôvodom; cudzie lietadlo, zlý čas a cudzia stránka nie', async () => {
  const { oko } = fz1073();
  const h = harness({ startMs: Date.parse('2026-10-01T06:00:00Z'), tracks: { '8965d1': oko.map((p) => row(p)) }, traces: {} });
  try {
    const service = h.make();
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    const id = r.json.id;
    assert.equal(r.json.status, 'unverified', 'adsb.lol stopu nemá — bez druhej siete nič nie je overené');
    const trace = JSON.parse(fixtureText('adsblol-trace-8965d1-20260930.json'));
    const body = { trace, capturedAt: '2026-09-30T20:00:00Z', origin: 'adsb.lol data/traces (živá stopa)', note: 'uložená pred zmazaním' };
    assert.equal((await call(service, `/${id}/second-network`, true, { ...OWN_POST, body: { ...body, trace: { ...trace, icao: 'abc123' } } })).json.error, 'other_aircraft');
    assert.equal((await call(service, `/${id}/second-network`, true, { ...OWN_POST, body: { ...body, capturedAt: 'včera' } })).json.error, 'bad_captured_at');
    assert.equal((await call(service, `/${id}/second-network`, true, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await call(service, `/${id}/second-network`, false, { ...OWN_POST, body })).status, 404, 'z verejnej adresy vôbec nie');
    assert.equal(service.store.get(id).status, 'unverified', 'nič z toho udalosť nezmenilo');
    const fetchedBefore = h.fetched.length;
    const ok = await call(service, `/${id}/second-network`, true, { ...OWN_POST, body });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual([ok.json.status, ok.json.recheckDay], ['confirmed', null]);
    const e = service.store.get(id);
    assert.deepEqual([e.secondNetworkTrace.origin, e.secondNetworkTrace.capturedAt, e.secondNetworkTrace.meta.reg], ['adsb.lol data/traces (živá stopa)', '2026-09-30T20:00:00.000Z', 'A6-FKF']);
    assert.ok(e.timelineText.sk.includes('05:36:18 UTC — transpondér vysiela 7500 (nezákonný zásah) (adsb.lol)'));
    assert.equal(h.fetched.length, fetchedBefore, 'dodaná stopa sa nepýta adsb.lol');
    // Preverenie z denného archívu (aj keď lietadlo v ňom nie je) už potvrdenú udalosť nezhodí.
    h.at('2026-10-01T07:00:00Z');
    await service.tick();
    assert.equal(service.store.get(id).status, 'confirmed');
  } finally {
    h.cleanup();
  }
});

test('video do príspevku: 3D video nahrá skript len z tohto počítača (vlastná hlavička, MP4), vlastník ho stiahne; platí len pre tie isté údaje; „karta" na požiadanie', async () => {
  const { oko } = fz1073();
  const h = harness({ startMs: Date.parse('2026-09-30T08:00:00Z'), tracks: { '8965d1': oko.map((p) => row(p)) } });
  try {
    const got = [];
    let failWith = null;
    const file2d = path.join(h.dir, 'karta.mp4');
    const eventVideo = {
      async get(event) {
        got.push(event);
        if (failWith) throw Object.assign(new Error('zlyhanie'), { code: failWith });
        writeFileSync(file2d, 'KARTA');
        return { file: file2d, cached: false };
      },
    };
    const videoStore = createEventVideoStore({ dir: path.join(h.dir, 'event-video', '3d') });
    const service = h.make({ eventVideo, videoStore });
    const e = { ...(await fz1073Event()), window: { fromT: T('2026-09-30T03:00:00Z'), toT: T('2026-09-30T07:00:00Z') } };
    delete e.track;
    service.store.save(e);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12), Buffer.from('....moov'), Buffer.alloc(64, 7)]);
    const UP = { method: 'POST', headers: { 'content-type': 'video/mp4', 'x-oko-video-upload': '1' } };
    // Pred nahratím: tlačidlo nie je pripravené, stiahnutie nič nevráti.
    const before = (await call(service, `/${e.id}/post`)).json;
    assert.deepEqual([before.video, before.videoReady], [true, false]);
    assert.deepEqual((await call(service, `/${e.id}/video.mp4`)).json, { error: 'video_not_captured' });
    // Nahratie: len z tohto počítača, s vlastnou hlavičkou, len MP4.
    assert.equal((await call(service, `/${e.id}/video.mp4`, false, { ...UP, body: mp4 })).status, 404, 'z verejnej adresy vôbec nie');
    assert.equal((await call(service, `/${e.id}/video.mp4`, true, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: mp4 })).status, 403, 'bez vlastnej hlavičky nie');
    assert.equal((await call(service, `/${e.id}/video.mp4`, true, { ...UP, headers: { ...UP.headers, origin: 'https://evil.example' }, body: mp4 })).status, 403, 'cudzia stránka nie');
    assert.equal((await call(service, `/${e.id}/video.mp4`, true, { ...OWN_POST, body: {} })).status, 403, 'JSON zo stránky nie je nahratie');
    assert.deepEqual((await call(service, `/${e.id}/video.mp4`, true, { ...UP, body: Buffer.from('<html>nie video</html>'.padEnd(120, ' ')) })).json, { error: 'not_mp4' });
    assert.equal(videoStore.find(service.store.get(e.id)), null, 'nič neplatné sa neuložilo');
    const up = await call(service, `/${e.id}/video.mp4`, true, { ...UP, body: mp4 });
    assert.deepEqual([up.status, up.json.ok, up.json.bytes], [200, true, mp4.length]);
    // Stiahnutie (vlastník): príloha s menom udalosti, presne nahraté bajty; verejnosť nie.
    assert.equal((await call(service, `/${e.id}/post`)).json.videoReady, true);
    const r = await call(service, `/${e.id}/video.mp4`);
    assert.deepEqual([r.status, r.headers['Content-Type'], r.headers['Content-Disposition']], [200, 'video/mp4', `attachment; filename="oko-udalost-${e.id}.mp4"`]);
    assert.deepEqual(Buffer.from(r.body), mp4);
    assert.deepEqual([(await call(service, `/${e.id}/video.mp4`, true, { method: 'HEAD' })).status, (await call(service, `/${e.id}/video.mp4`, true, { method: 'HEAD' })).body], [200, undefined]);
    assert.equal((await call(service, `/${e.id}/video.mp4`, false)).status, 404, 'verejnosť nie');
    // Zmena údajov (iné momenty) — staré video už neplatí, treba nahrať nové.
    const stored = service.store.get(e.id);
    service.store.save({ ...stored, timeline: stored.timeline.slice(0, 3) });
    assert.equal((await call(service, `/${e.id}/post`)).json.videoReady, false);
    assert.equal((await call(service, `/${e.id}/video.mp4`)).status, 404);
    // „Karta" (2D video, kreslí server) na požiadanie, zo stopy doplnenej z archívu OKO.
    const k = await call(service, `/${e.id}/video.mp4?style=karta`);
    assert.deepEqual([k.status, Buffer.from(k.body).toString()], [200, 'KARTA']);
    assert.ok(got[0].track.length > 50, 'stopa doplnená z archívu OKO');
    failWith = 'FFMPEG_MISSING';
    assert.deepEqual((await call(service, `/${e.id}/video.mp4?style=karta`)).json, { error: 'video_unavailable' });
    failWith = 'NO_TRACK';
    assert.deepEqual((await call(service, `/${e.id}/video.mp4?style=karta`)).json, { error: 'no_track' });
    // Služba bez úložiska videí: tlačidlo nie je.
    const without = h.make();
    assert.equal((await call(without, `/${e.id}/post`)).json.video, false);
    assert.equal((await call(without, `/${e.id}/video.mp4`)).status, 404);
    assert.equal((await call(without, `/${e.id}/video.mp4`, true, { ...UP, body: mp4 })).status, 503);
  } finally {
    h.cleanup();
  }
});

test('chýbajúce údaje zo správ (FZ1073 → Tabuk): zápis len z tohto počítača; neoverený zdroj sa odmietne celý; text príspevku ich ukáže; nové spracovanie ich nezmaže; prázdny zoznam ich zmaže', async () => {
  const { FZ1073_REPORTED_INPUT } = await import('./fixtures/flightEventFixtures.mjs');
  const { oko } = fz1073();
  const trusted = ['arabnews.com', 'aljazeera.com', 'reuters.com'];
  const h = harness({ startMs: Date.parse('2026-10-01T06:00:00Z'), tracks: { '8965d1': oko.map((p) => row(p)) }, trusted });
  try {
    const service = h.make({ airportsFile: fileURLToPath(new URL('./local_data/airports/airports.geojsonl', import.meta.url)) });
    const id = (await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1')).json.id;
    const body = JSON.parse(JSON.stringify(FZ1073_REPORTED_INPUT));
    assert.equal((await call(service, `/${id}/reported`, false, { ...OWN_POST, body })).status, 404, 'z verejnej adresy vôbec nie');
    assert.equal((await call(service, `/${id}/reported`, true, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body })).status, 403);
    const blog = JSON.parse(JSON.stringify(body));
    blog.facts[0].sources[1].url = 'https://blog.example.com/fz1073';
    const refused = await call(service, `/${id}/reported`, true, { ...OWN_POST, body: blog });
    assert.deepEqual([refused.status, refused.json.error, refused.json.index], [400, 'untrusted_source', 0]);
    assert.equal(service.store.get(id).reported ?? null, null, 'odmietnuté sa neuložilo ani napoly');
    const ok = await call(service, `/${id}/reported`, true, { ...OWN_POST, body });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual(ok.json.reported.map((f) => f.kind), ['descent', 'landing']);
    const saved = service.store.get(id);
    assert.equal(saved.reported[1].airport.icao, 'OETB', 'letisko z OurAirports');
    const post = await call(service, `/${id}/post`);
    assert.ok(post.json.text.includes('— núdzové pristátie na letisku Tabuk (TUU) — podľa správ (Arab News, Al Jazeera)'), post.json.text);
    // Nové spracovanie udalosti (ručná analýza s uložením) fakty zo správ nezmaže.
    await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    assert.equal(service.store.get(id).reported.length, 2);
    // Prázdny zoznam = zmazať.
    assert.equal((await call(service, `/${id}/reported`, true, { ...OWN_POST, body: { facts: [] } })).status, 200);
    assert.equal(service.store.get(id).reported, null);
    assert.ok(h.logs.some((l) => l.includes('doplnené zo správ: descent (aljazeera.com, arabnews.com); landing (arabnews.com, aljazeera.com)')), h.logs.join('\n'));
  } finally {
    h.cleanup();
  }
});

test('DO ŠTÚDIA (2026-10-03): udalosť → návrh v Štúdiu s obrázkom feed, textom a hotovým 3D videom; bez Štúdia 503; verejná adresa 404', async () => {
  const { oko } = fz1073();
  const h = harness({
    startMs: Date.parse('2026-09-30T08:00:00Z'),
    tracks: { '8965d1': oko.map((p) => row(p)) },
    legs: { '8965d1': [{ callsign: 'FDB1073', firstT: T('2026-09-30T03:05:00Z'), lastT: T('2026-09-30T05:53:33Z') }] },
    traces: { [LIVE_FZ]: fixtureText('adsblol-trace-8965d1-20260930.json') },
  });
  try {
    const imports = [];
    const videoStore = createEventVideoStore({ dir: path.join(h.dir, '3d') });
    const service = h.make({ renderCard: createEventCardRenderer({ dataDir: LOCAL_DATA }), videoStore,
      studioImport: async (input) => { imports.push(input); return { created: imports.length === 1, reason: imports.length === 1 ? null : 'exists', draft: { id: 'd1' } }; } });
    const r = await call(service, '/analyze?hex=8965d1&from=2026-09-30T03:00:00Z&to=2026-09-30T07:00:00Z&save=1');
    const id = r.json.id;
    assert.equal((await call(service, `/${id}/studio`, false, OWN_POST)).status, 404, 'z verejnej adresy nie');
    assert.equal((await call(service, `/${id}/post`)).json.studio, true, 'panel vie, že Štúdio je');
    const first = await call(service, `/${id}/studio`, true, OWN_POST);
    assert.deepEqual([first.status, first.json.created, first.json.draftId, first.json.video], [200, true, 'd1', false]);
    assert.equal(imports[0].template, 'event');
    assert.equal(imports[0].eventKey, `event:${id}`);
    assert.ok(imports[0].title.length > 3 && imports[0].text.includes('OpenSky'));
    // Rám reelu (2026-10-04, háčik): „čo sa stalo + ktorý let" nad videom, potom riadok letu; čas = začiatok udalosti.
    const m = imports[0].meta;
    // Let = číslo IATA z trasy, inak volací znak (táto fixtúra trasu nemá → FDB1073).
    assert.match(m.hook.text, /^[A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ0-9 ()]+: LET (FZ|FDB)1073$/, m.hook.text);
    assert.ok(m.hook.text.endsWith(m.hook.accent), 'let farebne');
    assert.equal(m.kicker, 'LETECKÁ UDALOSŤ');
    assert.ok(m.headline.startsWith(`Let ${m.hook.accent}`), m.headline);
    assert.ok(Number.isFinite(m.at) && m.at > Date.parse('2026-09-29') && m.at < Date.parse('2026-10-01'), 'čas udalosti v ms');
    const meta = await sharp(imports[0].image).metadata();
    assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1350, 'jpeg'], 'obrázok feed');
    // Karusel (2026-10-04): snímky kľúčových momentov, každá iná (stopa po moment), najviac 4, rovnaký formát.
    assert.ok(imports[0].images.length >= 1 && imports[0].images.length <= 4, `snímok karuselu: ${imports[0].images.length}`);
    assert.equal(first.json.slides, 1 + imports[0].images.length);
    const slide = await sharp(imports[0].images[0]).metadata();
    assert.deepEqual([slide.width, slide.height], [1080, 1350]);
    assert.ok(!imports[0].images[0].equals(imports[0].image), 'snímka momentu sa líši od hlavnej karty');
    // S hotovým 3D videom ide aj cesta k súboru.
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16), Buffer.from('moov'), Buffer.alloc(64)]);
    videoStore.save(service.store.get(id), mp4);
    const second = await call(service, `/${id}/studio`, true, OWN_POST);
    assert.deepEqual([second.json.created, second.json.reason, second.json.video], [false, 'exists', true]);
    assert.ok(existsSync(imports[1].videoFile));
    const none = h.make({ renderCard: createEventCardRenderer({ dataDir: LOCAL_DATA }) });
    assert.equal((await call(none, `/${id}/post`)).json.studio, false);
    assert.equal((await call(none, `/${id}/studio`, true, OWN_POST)).status, 503);
  } finally { h.cleanup(); }
});
