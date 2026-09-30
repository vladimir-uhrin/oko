// src/data/flightEventsService.test.mjs — služba Udalostí, etapa 1 (2026-09-30). Testy SPRÁVANIA celej
// cesty spúšťač → čakanie → stopa z druhej siete → overenie → uložená udalosť, na skutočných stopách:
// FZ1073 sa uloží ako overený a po 30 min uzavrie; šum 7500 sa uloží ako vyvrátený; body, ktoré archív
// prevzal z adsb.lol, sa neoverujú samy sebou; pri blokovaní adsb.lol pauza; API len z tohto počítača.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ANALYSIS_VERSION, EVENT_FETCH_GAP_MS, createFlightEventsService, eventId, parseTimeParam } from './flightEventsService.js';
import { EMERGENCY_CODES, DIVE_VR_MPS } from './flightAnomalies.js';
import { STATE_BACKFILL_BLOCK_PAUSE_MS } from './stateAircraftBackfill.js';
import { NOISE_CASES, T, fz1073, noiseCase } from './fixtures/flightEventFixtures.mjs';

const fixtureText = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const row = (p, src = 'opensky') => [p.t, p.lat, p.lon, p.alt, p.gs, p.trk, p.vr, p.squawk, p.gnd ? 1 : 0, null, null, null, src];
const isTrigger = (p) => !p.gnd && (EMERGENCY_CODES[p.squawk] || (p.vr !== null && p.vr <= DIVE_VR_MPS && (p.alt ?? 0) >= 3000));
const triggersOf = (hex, points, src = 'opensky') => points.filter(isTrigger).map((p) => ({ icao24: hex, t: p.t, lat: p.lat, lon: p.lon, alt: p.alt, vr: p.vr, squawk: p.squawk, src }));

function harness({ tracks = {}, triggers = [], legs = {}, traces = {}, startMs }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-events-'));
  let nowMs = startMs;
  const fetched = [];
  const waits = [];
  const logs = [];
  let httpStatus = 200;
  const store = {
    async triggersSince(fromS, toS) { return triggers.filter((r) => r.t >= fromS && r.t < toS); },
    async track(hex, { fromS, toS, withSrc }) {
      assert.equal(withSrc, true, 'služba potrebuje zdroj každého fixu');
      return (tracks[hex] || []).filter((r) => r[0] >= fromS && r[0] <= toS);
    },
    async flightsOf(hex) { return legs[hex] || []; },
  };
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (httpStatus !== 200) return { ok: false, status: httpStatus, arrayBuffer: async () => new ArrayBuffer(0) };
    const body = traces[url];
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) };
  };
  const make = () => createFlightEventsService({
    getStore: () => store,
    eventsDir: dir,
    isLocal: (req) => req.local === true,
    fetchImpl,
    now: () => nowMs,
    sleep: async (ms) => { waits.push(ms); nowMs += ms; },
    log: (m) => logs.push(m),
    tickMs: 3_600_000,
  });
  return {
    dir, fetched, waits, logs, make,
    at: (iso) => { nowMs = Date.parse(iso); },
    setHttp: (s) => { httpStatus = s; },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function call(service, url, local = true) {
  const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  await service.handle({ url, local }, res);
  return { status: res.status, json: JSON.parse(res.body) };
}

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
