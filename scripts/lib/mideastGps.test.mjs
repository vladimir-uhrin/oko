// scripts/lib/mideastGps.test.mjs — zberač RUŠENIA GPS (adsb.lol → bunky 0,5° po dňoch), etapa 5d
// modulu BLÍZKY VÝCHOD (2026-10-03). Sieť je falošná a vracia skutočné odpovede adsb.lol zo
// 3. 10. 2026 (fixtúra); kruhy bez fixtúry vracajú prázdny zoznam lietadiel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GPS_CIRCLE_PAUSE_MS, GPS_RETRY_AFTER_429_MS, gpsCollect, gpsDayFile, gpsPayload, gpsWorkFile } from './mideastArchive.mjs';
import { GPS_CIRCLES, GPS_LICENSE, gpsCircleUrl } from '../../src/data/gpsInterference.js';
import { createAdsbLolBudget } from '../../src/data/adsbLolBudget.js';
import { createUpstreamRegistry } from '../../src/data/upstreamStatus.js';

const fx = JSON.parse(readFileSync(new URL('../../src/data/fixtures/adsblol-gps-circles-20261003.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-10-03T16:00:00Z');
// Oba zdroje (2026-10-30): adsb.fi hlavný, adsb.lol záloha — tá istá fixtúra a ten istý plán odpovedí pre kruh.
const byUrl = new Map(GPS_CIRCLES.flatMap((c) => [[gpsCircleUrl(c), c.id], [gpsCircleUrl(c, 'adsb.lol'), c.id]]));
const lolUrls = new Set(GPS_CIRCLES.map((c) => gpsCircleUrl(c, 'adsb.lol')));

/** Falošné adsb.lol: `plan[id]` = pole odpovedí pre kruh (status alebo 'html'), inak fixtúra / prázdno. */
function fakeNet(plan = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const id = byUrl.get(String(url));
    calls.push(id);
    const step = Array.isArray(plan[id]) ? plan[id].shift() : undefined;
    if (step === 'html') return new Response('<html><h1>502</h1></html>', { status: 200 });
    if (typeof step === 'number') return new Response('<html>429 Too Many Requests</html>', { status: step });
    return new Response(JSON.stringify(fx[id] || { ac: [], now: T0, total: 0 }), { status: 200 });
  };
  return { calls, fetchImpl };
}
async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'oko-gps-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('jedno kolo: šesť kruhov postupne s pauzou 5 s, snímka do rozpracovaného dňa', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    const slept = [];
    const r = await gpsCollect(root, { fetchImpl: net.fetchImpl, now: T0, sleep: async (ms) => { slept.push(ms); } });
    assert.equal(r.status, 'updated');
    assert.equal(r.day, '2026-10-03');
    assert.equal(r.circles, 6);
    assert.equal(r.samples, 103);
    assert.equal(r.degraded, 11);
    assert.deepEqual(net.calls, GPS_CIRCLES.map((c) => c.id), 'kruhy v poradí katalógu, každý raz');
    assert.deepEqual(slept, [GPS_CIRCLE_PAUSE_MS, GPS_CIRCLE_PAUSE_MS, GPS_CIRCLE_PAUSE_MS, GPS_CIRCLE_PAUSE_MS, GPS_CIRCLE_PAUSE_MS], 'pauza medzi kruhmi, nie pred prvým');
    const work = JSON.parse(readFileSync(gpsWorkFile(root, '2026-10-03'), 'utf8'));
    assert.equal(work.snapshots, 1);
    assert.equal(Object.keys(work.cells).length, 66);
    // druhé kolo to isté lietadlá nezdvojí
    const again = await gpsCollect(root, { fetchImpl: fakeNet().fetchImpl, now: T0 + 15 * 60_000, sleep: async () => {} });
    assert.equal(again.snapshots, 2);
    const p = await gpsPayload(root, { days: 1, nowMs: T0 + 16 * 60_000 });
    assert.equal(p.snapshots, 2);
    assert.equal(p.aircraft, 103, 'rovnaké lietadlá v druhej snímke sa nerátajú znova');
  });
});

test('zlyhanie adsb.fi: záloha adsb.lol z rozpočtu, bez opakovania po 429; kruh bez odpovede sa vynechá; všetko zlyhá = nič sa nezapíše', async () => {
  await withRoot(async (root) => {
    // Plán sa míňa po poradí volaní kruhu: prvé je adsb.fi, druhé adsb.lol.
    const net = fakeNet({ levant: [429], hormuz: [429, 429], iraq: ['html'] });
    const urls = [];
    const fetchImpl = async (url) => { urls.push(String(url)); return net.fetchImpl(url); };
    const slept = [];
    let t = T0;
    const budget = createAdsbLolBudget({ now: () => t, registry: createUpstreamRegistry({ now: () => t }) });
    const r = await gpsCollect(root, { fetchImpl, now: T0, sleep: async (ms) => { slept.push(ms); }, budget });
    assert.equal(r.status, 'partial');
    assert.equal(r.circles, 5);
    assert.deepEqual(r.failed.map((f) => f.split(':')[0]), ['hormuz']);
    assert.match(r.failed[0], /adsb.fi: HTTP 429, adsb.lol: HTTP 429/);
    assert.deepEqual(r.sources, { 'adsb.lol': 2, 'adsb.fi': 3 });
    assert.equal(net.calls.filter((id) => id === 'levant').length, 2, 'Levanta: adsb.fi 429 → adsb.lol');
    assert.equal(net.calls.filter((id) => id === 'hormuz').length, 2, 'Hormuz: oba zdroje raz, bez tretieho pokusu');
    assert.equal(urls.filter((u) => lolUrls.has(u)).length, 3, 'adsb.lol len ako záloha pre tri zlyhané kruhy');
    assert.equal(slept.filter((ms) => ms === GPS_RETRY_AFTER_429_MS).length, 0, 'po 429 sa nečaká na opakovanie');
    assert.equal(budget.paused(), true, '429 adsb.lol = pauza rozpočtu');
    assert.ok(r.samples > 0 && r.samples < 103, 'bez Hormuzu');
    const dead = fakeNet(Object.fromEntries(GPS_CIRCLES.map((c) => [c.id, [503, 503]])));
    t = T0 + 2 * 3600_000;
    const none = await gpsCollect(root, { fetchImpl: dead.fetchImpl, now: T0 + 15 * 60_000, sleep: async () => {}, budget: createAdsbLolBudget({ now: () => t, registry: createUpstreamRegistry({ now: () => t }) }) });
    assert.equal(none.status, 'error');
    assert.equal(JSON.parse(readFileSync(gpsWorkFile(root, '2026-10-03'), 'utf8')).snapshots, 1, 'neúspešné kolo snímku nepridá');
    assert.equal((await gpsCollect(root, { now: 'bad' })).status, 'error');
  });
});

test('nový deň uzavrie starý: výsledok bez adries lietadiel, pracovný súbor zmizne', async () => {
  await withRoot(async (root) => {
    await gpsCollect(root, { fetchImpl: fakeNet().fetchImpl, now: T0, sleep: async () => {} });
    assert.ok(existsSync(gpsWorkFile(root, '2026-10-03')));
    const next = T0 + 86_400_000;
    await gpsCollect(root, { fetchImpl: fakeNet().fetchImpl, now: next, sleep: async () => {} });
    assert.equal(existsSync(gpsWorkFile(root, '2026-10-03')), false, 'rozpracovaný včerajšok zmazaný');
    const closed = JSON.parse(readFileSync(gpsDayFile(root, '2026-10-03'), 'utf8'));
    assert.equal(closed.day, '2026-10-03');
    assert.equal(closed.aircraft, 103);
    assert.equal(closed.license, GPS_LICENSE);
    assert.match(closed.license, /adsb.fi.*ODbL 1.0/);
    assert.ok(closed.cells.every((row) => row.every(Number.isInteger)));
    assert.doesNotMatch(JSON.stringify(closed), /[0-9a-f]{6}"/, 'žiadna adresa lietadla v uzavretom dni');
    assert.ok(existsSync(gpsWorkFile(root, '2026-10-04')));
  });
});

test('telo /gps: okno dní, stupne buniek, prahy, kruhy, čiastočný dnešok; bez dát null', async () => {
  await withRoot(async (root) => {
    assert.equal(await gpsPayload(root, { nowMs: T0 }), null);
    await gpsCollect(root, { fetchImpl: fakeNet().fetchImpl, now: T0, sleep: async () => {} });
    await gpsCollect(root, { fetchImpl: fakeNet().fetchImpl, now: T0 + 86_400_000, sleep: async () => {} });
    const p = await gpsPayload(root, { days: 2, nowMs: T0 + 86_400_000 + 60_000 });
    assert.deepEqual(p.days, ['2026-10-03', '2026-10-04']);
    assert.equal(p.todayPartial, true);
    assert.equal(p.snapshots, 2);
    assert.equal(p.cellDeg, 0.5);
    assert.deepEqual(p.thresholds, { low: 0.02, high: 0.1, minAircraft: 4 });
    assert.equal(p.circles.length, 6);
    assert.match(p.attribution, /adsb\.lol/);
    const amman = p.cells.find((c) => c[0] === 63 && c[1] === 71);
    assert.deepEqual(amman, [63, 71, 8, 8, 6, 'high'], 'dva dni: 4 + 4 lietadlá, zhoršené 4 + 4, po odpočte 3 + 3');
    assert.equal(p.counts.high >= 1, true);
    const one = await gpsPayload(root, { days: 1, nowMs: T0 + 86_400_000 + 60_000 });
    assert.deepEqual(one.days, ['2026-10-04']);
    assert.equal((await gpsPayload(root, { days: 99, nowMs: T0 + 86_400_000 + 60_000 })).requestedDays, 7, 'okno najviac 7 dní');
  });
});
