// scripts/lib/mideastIncidents.test.mjs — archív OVERENÝCH UDALOSTÍ (GeoConfirmed + UCDP), etapa 4
// modulu BLÍZKY VÝCHOD (2026-11-05). Sieť je falošná (vstreknutý fetchImpl), odpovede = skutočné
// riadky exportu GeoConfirmed z 5. 11. 2026 a malý súbor v tvare UCDP Candidate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  GEOCONFIRMED_FRESH_MS, geoconfirmedDayFile, geoconfirmedDir, geoconfirmedMetaFile, geoconfirmedRefresh, incidentsIndex, incidentsPayload,
  incidentsSummaryPayload, monthList, ucdpMonthFile, ucdpRefresh,
} from './mideastArchive.mjs';
import { UCDP_CSV } from '../../src/data/fixtures/ucdpCandidateFixture.mjs';

const fixture = (name) => readFileSync(new URL(`../../src/data/fixtures/${name}`, import.meta.url), 'utf8');
const IRAN = fixture('geoconfirmed-iran-20261105.csv');
const ISRAEL = fixture('geoconfirmed-israel-20261105.csv');
const HEADER_ONLY = `﻿${IRAN.split('\r\n')[0]}\r\n`;
const NOW = Date.parse('2026-11-05T12:00:00Z');
const DAY = 86_400_000;

function fakeNet({ status = 200, body = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (body !== null) return new Response(body, { status });
    if (/export\/Iran\//.test(url)) return new Response(IRAN, { status });
    if (/export\/israel\//.test(url)) return new Response(ISRAEL, { status });
    if (/GEDEvent_v26_0_(\d+)\.csv$/.test(url)) {
      const m = Number(/_0_(\d+)\.csv$/.exec(url)[1]);
      return m <= 9 ? new Response(m === 9 || m === 3 ? UCDP_CSV : `${UCDP_CSV.split('\r\n')[0]}\r\n`, { status: 200 }) : new Response('Not Found', { status: 404 });
    }
    return new Response(HEADER_ONLY, { status });
  };
  return { calls, fetchImpl };
}
async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'oko-mideast-inc-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const noSleep = async () => {};

test('GeoConfirmed: prvé naplnenie JEDNÝM dopytom od 28. 2.; každý deň okna má súbor; meta drží štatistiku filtra; do 6 h fresh', async () => {
  await withRoot(async (root) => {
    const net = fakeNet();
    const r = await geoconfirmedRefresh(root, 'iran', { fetchImpl: net.fetchImpl, now: NOW });
    assert.equal(r.status, 'updated');
    assert.equal(r.backfill, true);
    assert.deepEqual(net.calls, ['https://geoconfirmed.org/api/Map/export/Iran/csv?start=2026-02-28&end=2026-11-05']);
    assert.equal(r.count, 10);
    assert.equal(r.days, 251);
    assert.deepEqual(r.dropped, { 'no-date': 1, pov: 2, position: 2, 'non-kinetic': 2, units: 1, person: 1 });
    const files = readdirSync(geoconfirmedDir(root, 'iran')).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
    assert.equal(files.length, 251, 'aj prázdne dni, aby bolo pokrytie známe');
    const empty = JSON.parse(readFileSync(geoconfirmedDayFile(root, 'iran', '2026-06-01'), 'utf8'));
    assert.deepEqual(empty.items, []);
    const feb28 = JSON.parse(readFileSync(geoconfirmedDayFile(root, 'iran', '2026-02-28'), 'utf8'));
    assert.equal(feb28.kind, 'geoconfirmed');
    assert.equal(feb28.conflict, 'iran');
    assert.ok(feb28.items.length >= 8);
    const meta = JSON.parse(readFileSync(geoconfirmedMetaFile(root, 'iran'), 'utf8'));
    assert.equal(meta.backfilledFrom, '2026-02-28');
    assert.equal(meta.backfill.rows, 19);
    assert.equal(meta.backfill.kept, 10);
    assert.match(meta.attribution, /GeoConfirmed/);
    const again = fakeNet();
    assert.equal((await geoconfirmedRefresh(root, 'iran', { fetchImpl: again.fetchImpl, now: NOW + GEOCONFIRMED_FRESH_MS - 1 })).status, 'fresh');
    assert.equal(again.calls.length, 0);
  });
});

test('GeoConfirmed: po prvom naplnení rolujúce okno 30 dní; staršie dni ostávajú, ako boli', async () => {
  await withRoot(async (root) => {
    await geoconfirmedRefresh(root, 'israel', { fetchImpl: fakeNet().fetchImpl, now: NOW });
    const later = NOW + 6 * 3_600_000;
    const net = fakeNet({ body: HEADER_ONLY });
    const r = await geoconfirmedRefresh(root, 'israel', { fetchImpl: net.fetchImpl, now: later });
    assert.equal(r.status, 'updated');
    assert.equal(r.backfill, false);
    assert.deepEqual(net.calls, ['https://geoconfirmed.org/api/Map/export/israel/csv?start=2026-10-07&end=2026-11-05']);
    assert.equal(r.days, 30);
    assert.equal(JSON.parse(readFileSync(geoconfirmedDayFile(root, 'israel', '2026-03-08'), 'utf8')).items.length, 1, 'deň mimo okna sa neprepísal');
    const meta = JSON.parse(readFileSync(geoconfirmedMetaFile(root, 'israel'), 'utf8'));
    assert.equal(meta.backfilledFrom, '2026-02-28', 'prvé naplnenie si meta pamätá');
    assert.equal(meta.backfill.kept, 4);
    assert.deepEqual(meta.window, ['2026-10-07', '2026-11-05']);
  });
});

test('GeoConfirmed: výpadok alebo nie-CSV = starý archív (stale), bez neho error; neznámy konflikt a zlé now sú chyba', async () => {
  await withRoot(async (root) => {
    assert.equal((await geoconfirmedRefresh(root, 'yemen', { fetchImpl: fakeNet({ status: 503, body: 'down' }).fetchImpl, now: NOW })).status, 'error');
    assert.equal(existsSync(geoconfirmedMetaFile(root, 'yemen')), false);
    await geoconfirmedRefresh(root, 'yemen', { fetchImpl: fakeNet().fetchImpl, now: NOW });
    const later = NOW + GEOCONFIRMED_FRESH_MS + 1;
    assert.equal((await geoconfirmedRefresh(root, 'yemen', { fetchImpl: fakeNet({ body: '<html>Cloudflare</html>' }).fetchImpl, now: later })).status, 'stale');
    assert.equal((await geoconfirmedRefresh(root, 'yemen', { fetchImpl: async () => { throw new Error('offline'); }, now: later })).status, 'stale');
    assert.equal((await geoconfirmedRefresh(root, 'lebanon', { now: NOW })).status, 'error');
    assert.equal((await geoconfirmedRefresh(root, 'yemen', { now: 'zlé' })).status, 'error');
  });
});

test('UCDP: chýbajúce mesiace od februára, 404 = ešte nevyšiel a ďalej sa nepýta; uložený mesiac sa nesťahuje znova; kontrola raz za deň', async () => {
  assert.deepEqual(monthList('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  await withRoot(async (root) => {
    const net = fakeNet();
    const r = await ucdpRefresh(root, { fetchImpl: net.fetchImpl, now: NOW, sleep: noSleep });
    assert.equal(r.status, 'updated');
    assert.deepEqual(r.fetched, ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    assert.equal(r.missing, '2026-10', 'októbrový súbor ešte nevyšiel');
    assert.equal(net.calls.length, 9);
    assert.equal(r.count, 6, 'len región, presný deň, poloha do okresu (fixtúra je v marci aj v septembri)');
    const sep = JSON.parse(readFileSync(ucdpMonthFile(root, '2026-09'), 'utf8'));
    assert.equal(sep.license, 'CC BY 4.0');
    assert.equal(sep.items.length, 3);
    const again = fakeNet();
    assert.equal((await ucdpRefresh(root, { fetchImpl: again.fetchImpl, now: NOW + 3_600_000, sleep: noSleep })).status, 'fresh');
    assert.equal(again.calls.length, 0);
    const next = fakeNet();
    const r2 = await ucdpRefresh(root, { fetchImpl: next.fetchImpl, now: NOW + DAY, sleep: noSleep });
    assert.deepEqual(next.calls, ['https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_10.csv'], 'pýta sa len chýbajúci mesiac');
    assert.equal(r2.status, 'fresh');
  });
});

test('payload okna: GC všetkých konfliktov + UCDP po dedupe, najnovšie prvé, dejisko podľa obdĺžnika; súhrn po dňoch; bez archívu null', async () => {
  await withRoot(async (root) => {
    assert.equal(await incidentsPayload(root, { from: '2026-03-01', to: '2026-03-31' }), null);
    assert.equal(await incidentsSummaryPayload(root, { from: '2026-02-28', to: '2026-11-05' }), null);
    const net = fakeNet();
    for (const slug of ['iran', 'israel']) await geoconfirmedRefresh(root, slug, { fetchImpl: net.fetchImpl, now: NOW });
    await ucdpRefresh(root, { fetchImpl: net.fetchImpl, now: NOW, sleep: noSleep });
    // UCDP 700007 = 8. 3. v Gaze 0,0 km od udalosti GeoConfirmed (Al-Katiba) → duplicita
    const march = await incidentsPayload(root, { from: '2026-03-01', to: '2026-03-31', nowMs: NOW });
    assert.equal(march.duplicates, 1);
    assert.equal(march.counts.ucdp, 0);
    assert.deepEqual(march.counts, { total: 4, geoconfirmed: 4, ucdp: 0 });
    assert.ok(march.incidents.every((x, i, a) => !i || a[i - 1].t >= x.t), 'najnovšie prvé');
    assert.equal(march.incidents.find((x) => x.day === '2026-03-08').ucdp, true, 'GC nesie príznak potvrdenia z UCDP');
    assert.equal(march.coverage.geoconfirmed.iran, 31);
    assert.equal(march.coverage.geoconfirmed.yemen, 0);
    assert.deepEqual(march.coverage.ucdp, ['2026-03']);
    assert.match(march.sources.ucdp.attribution, /CC BY 4\.0/);
    const gaza = await incidentsPayload(root, { from: '2026-03-01', to: '2026-03-31', rect: [34.15, 31.2, 34.6, 31.65], theatre: 'gaza', nowMs: NOW });
    assert.deepEqual(gaza.incidents.map((x) => x.day), ['2026-03-08'], 'len body v Gaze (+0,5°)');
    assert.equal(gaza.theatre, 'gaza');
    const sum = await incidentsSummaryPayload(root, { from: '2026-02-28', to: '2026-11-05', nowMs: NOW });
    assert.equal(sum.total, 10 + 4 + 2, 'GC Irán + GC Izrael + 2 UCDP zo septembra (duplicita z 8. 3. vypadla)');
    assert.equal(sum.days['2026-09-10'].ucdp, 1);
    assert.equal(sum.days['2026-03-08'].total, 1);
    assert.equal(sum.days['2026-03-08'].byType.air, 1);
    assert.equal(sum.byType.air >= 3, true);
    assert.ok(!('2026-06-01' in sum.days), 'len dni s udalosťou');
    const idx = await incidentsIndex(root);
    assert.equal(idx.geoconfirmed.iran.count, 10);
    assert.equal(idx.geoconfirmed.syria, null);
    assert.equal(idx.ucdp.missing, '2026-10');
  });
});
