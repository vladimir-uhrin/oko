// scripts/lib/mideastStage6.test.mjs — archív etapy 6 modulu BLÍZKY VÝCHOD (2026-11-06): poplachy HFC
// (mirror ako dáta → denné súbory + katalóg; polygóny zo ZIP bez knižnice + okresy → areas.json), súčty Tech
// for Palestine (len čísla, denná snímka), OONI po krajinách (zlúčenie dní). Sieť je falošná (vstreknutý
// fetchImpl), odpovede = skutočné výrezy zo 6. 11. 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  ALERTS_FRESH_MS, ALERT_AREAS_FRESH_MS, HUMANITARIAN_FRESH_MS, INTERNET_FRESH_MS, alertAreasFile, alertAreasPayload, alertAreasRefresh, alertsDayFile, alertsPayload,
  alertsRefresh, humanitarianDayFile, humanitarianPayload, humanitarianRefresh, internetCountryFile, internetPayload, internetRefresh, stage6Index, unzipSingleEntry,
} from './mideastArchive.mjs';
import { ALERTS_MIRROR_JS, ALERT_DISTRICTS_PY, ALERT_POLYGONS, OONI_IR_AGGREGATION, T4P_SUMMARY_V3 } from '../../src/data/fixtures/mideastStage6Fixtures.mjs';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const DAY = 86_400_000;

/** Jeden záznam ZIP (deflate alebo store) s centrálnym adresárom — ako `zip` z príkazového riadku. */
function makeZip(name, data, { store = false } = {}) {
  const nameBuf = Buffer.from(name, 'utf8');
  const body = store ? data : zlib.deflateRawSync(data);
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(store ? 0 : 8, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + body.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + nameBuf.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, body, central, nameBuf, eocd]);
}
const POLY_ZIP = makeZip('area_to_polygon.json', Buffer.from(JSON.stringify(ALERT_POLYGONS)));

function fakeNet(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    for (const [re, reply] of Object.entries(overrides)) if (new RegExp(re).test(url)) return typeof reply === 'function' ? reply(url) : reply;
    if (/events\.js$/.test(url)) return new Response(ALERTS_MIRROR_JS, { status: 200 });
    if (/area_to_polygon\.json\.zip$/.test(url)) return new Response(POLY_ZIP, { status: 200 });
    if (/area_to_district\.py$/.test(url)) return new Response(ALERT_DISTRICTS_PY, { status: 200 });
    if (/techforpalestine/.test(url)) return new Response(JSON.stringify(T4P_SUMMARY_V3), { status: 200 });
    if (/api\.ooni\.io/.test(url)) return new Response(JSON.stringify(OONI_IR_AGGREGATION), { status: 200 });
    return new Response('Not Found', { status: 404 });
  };
  return { calls, fetchImpl };
}
async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'oko-mideast-e6-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('ZIP s jedným záznamom: deflate aj store, bez knižnice; cudzie bajty sú chyba', () => {
  const data = Buffer.from('{"a":[[1,2]]}');
  assert.equal(unzipSingleEntry(makeZip('x.json', data)).toString(), data.toString());
  assert.equal(unzipSingleEntry(makeZip('x.json', data, { store: true })).toString(), data.toString());
  assert.throws(() => unzipSingleEntry(Buffer.from('not a zip at all, really not')), /end of central directory/);
  assert.throws(() => unzipSingleEntry(Buffer.alloc(3)), /too short/);
});

test('poplachy: mirror → denné súbory od 28. 2. po dnešok (aj prázdne), katalóg, meta; čerstvosť 6 h; chyba = stale', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    const r = await alertsRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 147);
    assert.equal(r.day, '2026-06-14', 'posledný deň s dátami');
    assert.equal(r.areas, 4);
    assert.equal(r.dataUpdated, '2026-11-03T15:13:02.043Z');
    assert.equal(r.days, Math.floor((NOW - Date.parse('2026-02-28T00:00:00Z')) / DAY) + 1, 'každý deň po dnešok má súbor (252)');
    assert.ok(existsSync(alertsDayFile(root, '2026-11-06')), 'dnešok prázdny, no známy');
    assert.ok(existsSync(alertsDayFile(root, '2026-02-28')));
    assert.deepEqual(net.calls, ['https://oref-alerts.github.io/events.js']);
    const again = await alertsRefresh(root, { fetchImpl: net.fetchImpl, now: NOW + ALERTS_FRESH_MS - 60_000 });
    assert.equal(again.status, 'fresh');
    assert.equal(net.calls.length, 1, 'do 6 h sa nepýta');
    const broken = fakeNet({ 'events\\.js$': new Response('<html>503</html>', { status: 503 }) });
    const stale = await alertsRefresh(root, { fetchImpl: broken.fetchImpl, now: NOW + ALERTS_FRESH_MS + 1 });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.count, 147, 'archív ostal');
    assert.match(stale.error, /HTTP 503/);
    const notData = fakeNet({ 'events\\.js$': new Response('const EVENTS_BY_AREA = alert(1);\n', { status: 200 }) });
    const bad = await alertsRefresh(root, { fetchImpl: notData.fetchImpl, now: NOW + ALERTS_FRESH_MS + 1 });
    assert.equal(bad.status, 'stale', 'JS, ktorý nie je JSON, sa nikdy nespustí — je to chyba');
    const empty = await alertsRefresh(mkdtempSync(path.join(tmpdir(), 'oko-e6-empty-')), { fetchImpl: broken.fetchImpl, now: NOW });
    assert.equal(empty.status, 'error', 'bez archívu = error');
  });
});

test('oblasti: bez katalógu skipped; ZIP + okresy → areas.json s obrysmi [lon, lat] a okresom; okresy nedostupné = bez okresu; 7 dní čerstvé', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    assert.equal((await alertAreasRefresh(root, { fetchImpl: net.fetchImpl, now: NOW })).status, 'skipped');
    await alertsRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    const r = await alertAreasRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    assert.deepEqual(r, { status: 'updated', count: 4, missing: 0 });
    assert.ok(existsSync(alertAreasFile(root)));
    const payload = await alertAreasPayload(root, { nowMs: NOW });
    assert.equal(payload.count, 4);
    assert.equal(payload.areas['kryyt-shmvnh'].district, 'קו העימות');
    assert.ok(payload.areas['tel-aviv-center'].ring.length >= 10);
    assert.match(payload.source.license, /MIT/);
    assert.equal((await alertAreasRefresh(root, { fetchImpl: net.fetchImpl, now: NOW + ALERT_AREAS_FRESH_MS - 1 })).status, 'fresh');
    const noDistricts = fakeNet({ 'area_to_district\\.py$': new Response('x', { status: 500 }) });
    const r2 = await alertAreasRefresh(root, { fetchImpl: noDistricts.fetchImpl, now: NOW, force: true });
    assert.equal(r2.status, 'updated');
    assert.equal((await alertAreasPayload(root)).areas['kryyt-shmvnh'].district, null);
    const noZip = fakeNet({ 'zip$': new Response('nope', { status: 404 }) });
    const stale = await alertAreasRefresh(root, { fetchImpl: noZip.fetchImpl, now: NOW, force: true });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.count, 4);
  });
});

test('/alerts telo: okno dní s počtami po dňoch (len neprázdne) a po oblastiach, pokrytie, zdroj; bez archívu null', async () => {
  await withRoot(async (root) => {
    assert.equal(await alertsPayload(root, { from: '2026-03-01', to: '2026-03-02' }), null);
    const net = fakeNet();
    await alertsRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    const p = await alertsPayload(root, { from: '2026-02-28', to: '2026-03-09', nowMs: NOW });
    assert.deepEqual(Object.keys(p.days), ['2026-02-28', '2026-03-01', '2026-03-09']);
    assert.deepEqual(p.totals, { r: 69, w: 74, d: 3 });
    assert.deepEqual(p.areas['kryyt-shmvnh'], { r: 10, w: 23, d: 3 });
    assert.equal(p.coverage.days, 10);
    assert.deepEqual([p.coverage.first, p.coverage.last], ['2026-02-28', '2026-06-14']);
    assert.equal(p.dataUpdated, '2026-11-03T15:13:02.043Z');
    assert.match(p.source.attribution, /Pikud HaOref/);
    const quiet = await alertsPayload(root, { from: '2026-10-01', to: '2026-11-06', nowMs: NOW });
    assert.deepEqual(quiet.days, {});
    assert.deepEqual(quiet.areas, {});
    assert.equal(quiet.coverage.days, 37, 'prázdne dni sú pokryté');
  });
});

test('súčty: len čísla do latest.json + denná snímka; raz za deň; chyba = stale; telo trasy', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    assert.equal(await humanitarianPayload(root), null);
    const r = await humanitarianRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    assert.deepEqual(r, { status: 'updated', day: '2026-11-05', count: 74618 });
    assert.ok(existsSync(humanitarianDayFile(root, '2026-11-06')));
    const p = await humanitarianPayload(root, { nowMs: NOW });
    assert.equal(p.summary.west_bank.settlerAttacks, 5148);
    assert.doesNotMatch(JSON.stringify(p), /known_killed|male|female/);
    assert.match(p.source.license, /public domain/);
    assert.equal((await humanitarianRefresh(root, { fetchImpl: net.fetchImpl, now: NOW + HUMANITARIAN_FRESH_MS - 1 })).status, 'fresh');
    assert.equal(net.calls.length, 1);
    const broken = fakeNet({ techforpalestine: new Response('{', { status: 200 }) });
    const stale = await humanitarianRefresh(root, { fetchImpl: broken.fetchImpl, now: NOW + HUMANITARIAN_FRESH_MS + 1 });
    assert.equal(stale.status, 'stale');
    assert.equal(stale.count, 74618);
  });
});

test('internet: krajiny postupne s pauzou, zlúčenie s archívom, raz za deň, čiastočný výpadok = partial; telo s ukazovateľmi', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    const pauses = [];
    assert.equal(await internetPayload(root), null);
    const r = await internetRefresh(root, { fetchImpl: net.fetchImpl, now: NOW, sleep: async (ms) => pauses.push(ms), countries: ['IR', 'IQ'] });
    assert.equal(r.status, 'updated');
    assert.equal(r.day, '2026-11-06');
    assert.equal(r.count, 92, '46 dní × 2 krajiny');
    assert.deepEqual(pauses, [1_500]);
    assert.match(net.calls[0], /probe_cc=IR.*since=2026-09-22&until=2026-11-07/);
    assert.ok(existsSync(internetCountryFile(root, 'IQ')));
    const p = await internetPayload(root, { nowMs: NOW, countries: ['IR', 'IQ', 'YE'] });
    assert.deepEqual(Object.keys(p.countries), ['IR', 'IQ'], 'YE bez archívu chýba');
    assert.equal(p.countries.IR.level, 'same');
    assert.equal(p.countries.IR.recent, 41.3);
    assert.match(p.source.license, /NC/);
    assert.equal((await internetRefresh(root, { fetchImpl: net.fetchImpl, now: NOW + INTERNET_FRESH_MS - 1, countries: ['IR'] })).status, 'fresh');
    const half = fakeNet({ 'probe_cc=IQ': new Response('x', { status: 500 }) });
    const partial = await internetRefresh(root, { fetchImpl: half.fetchImpl, now: NOW + INTERNET_FRESH_MS + 1, sleep: async () => {}, countries: ['IR', 'IQ'] });
    assert.equal(partial.status, 'partial');
    assert.deepEqual(partial.errors, ['IQ: HTTP 500']);
    assert.equal(partial.count, 92, 'IQ z archívu ostalo');
  });
});

test('stav pre /status: len meta', async () => {
  await withRoot(async (root) => {
    assert.deepEqual(await stage6Index(root), { alerts: null, humanitarian: null, internet: null });
    const net = fakeNet();
    await alertsRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    await alertAreasRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    await humanitarianRefresh(root, { fetchImpl: net.fetchImpl, now: NOW });
    await internetRefresh(root, { fetchImpl: net.fetchImpl, now: NOW, sleep: async () => {}, countries: ['IR'] });
    const idx = await stage6Index(root);
    assert.equal(idx.alerts.events, 147);
    assert.equal(idx.alerts.last, '2026-06-14');
    assert.equal(idx.alerts.areas.count, 4);
    assert.equal(idx.humanitarian.lastReport, '2026-11-05');
    assert.deepEqual(idx.internet.countries, ['IR']);
    assert.doesNotMatch(JSON.stringify(idx), /error|message/i);
    assert.ok(readdirSync(path.join(root, '.gev-cache', 'mideast', 'events')).includes('humanitarian'));
  });
});
