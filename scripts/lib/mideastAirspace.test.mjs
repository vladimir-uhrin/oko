// scripts/lib/mideastAirspace.test.mjs — archív VZDUŠNÉHO PRIESTORU (EASA CZIB + hranice FIR
// z VATSpy), etapa 5b modulu BLÍZKY VÝCHOD (2026-10-03). Sieť je falošná a obsluhuje skutočné
// odpovede zo 3. 10. 2026 (src/data/fixtures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AIRSPACE_FRESH_MS, CZIB_DETAIL_PAUSE_MS, FIR_FRESH_MS, airspacePayload, czibFile, czibRefresh, firBoundariesRefresh, firFile } from './mideastArchive.mjs';
import { CZIB_EXPORT_URL, CZIB_FEED_URL, VATSPY_BOUNDARIES_URL } from '../../src/data/czib.js';

const fixture = (name) => readFileSync(new URL(`../../src/data/fixtures/${name}`, import.meta.url), 'utf8');
const PAGES = { 143862: 'iraq', 143899: 'gulf', 136057: 'ukraine', 20582: 'libya', 20599: 'syria' };
const T0 = Date.parse('2026-10-03T12:00:00Z');

/** Export obmedzený na bulletiny, ku ktorým máme stránku (+ jeden stiahnutý). */
function exportJson(mutate = (rows) => rows) {
  const all = JSON.parse(fixture('easa-czib-export-20261003.json')).conflict_zones;
  const rows = all.filter((r) => PAGES[r.Nid] || r.Nid === '140425');
  return JSON.stringify({ conflict_zones: mutate(rows.map((r) => ({ ...r }))) });
}
function fakeNet({ exportBody = exportJson(), exportStatus = 200, boundaries = fixture('vatspy-boundaries-sample-20261003.geojson') } = {}) {
  const calls = [];
  const feed = fixture('easa-czib-feed-20261003.xml');
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === CZIB_EXPORT_URL) return new Response(exportBody, { status: exportStatus });
    if (url === CZIB_FEED_URL) return new Response(feed, { status: 200 });
    if (url === VATSPY_BOUNDARIES_URL) return new Response(boundaries, { status: 200 });
    const nid = Object.keys(PAGES).find((n) => feed.includes(`${url}</link>`) && feed.split(`${url}</link>`)[1].split('</guid>')[0].includes(`>${n} on`));
    if (nid) return new Response(fixture(`easa-czib-${PAGES[nid]}-20261003.html`), { status: 200 });
    return new Response('nope', { status: 404 });
  };
  return { fetchImpl, calls };
}
async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'oko-air-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('prvý beh: export + RSS + stránky aktívnych bulletinov s pauzou; stiahnutý bulletin nie', async () => {
  await withRoot(async (root) => {
    const { fetchImpl, calls } = fakeNet();
    const slept = [];
    const r = await czibRefresh(root, { fetchImpl, now: T0, sleep: async (ms) => { slept.push(ms); } });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 5, 'Izrael 2024 (Withdrawn) vypadol');
    assert.equal(r.fetched, 5);
    assert.deepEqual(slept, [CZIB_DETAIL_PAUSE_MS, CZIB_DETAIL_PAUSE_MS, CZIB_DETAIL_PAUSE_MS, CZIB_DETAIL_PAUSE_MS]);
    assert.equal(calls.length, 7, 'export + RSS + 5 stránok');
    const snap = JSON.parse(readFileSync(czibFile(root), 'utf8'));
    assert.equal(snap.fetchedAt, T0);
    assert.match(snap.attribution, /European Union Aviation Safety Agency/);
    const iraq = snap.bulletins.find((b) => b.nid === '143862');
    assert.equal(iraq.czib, 'CZIB-2026-05-R2');
    assert.deepEqual(iraq.firs, ['ORBB']);
    assert.equal(iraq.url, 'https://www.easa.europa.eu/domains/air-operations/czibs/czib-2026-05-r2');
  });
});

test('čerstvá snímka sa nesťahuje; po 6 h sa stiahne len stránka zmeneného bulletinu', async () => {
  await withRoot(async (root) => {
    await czibRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0, sleep: async () => {} });
    const quiet = fakeNet();
    assert.equal((await czibRefresh(root, { fetchImpl: quiet.fetchImpl, now: T0 + AIRSPACE_FRESH_MS - 1 })).status, 'fresh');
    assert.equal(quiet.calls.length, 0);
    const changed = fakeNet({ exportBody: exportJson((rows) => rows.map((r) => (r.Nid === '143899' ? { ...r, updated: '<time datetime="2026-10-03T10:00:00+03:00">x</time>' } : r))) });
    const r = await czibRefresh(root, { fetchImpl: changed.fetchImpl, now: T0 + AIRSPACE_FRESH_MS + 1, sleep: async () => {} });
    assert.equal(r.status, 'updated');
    assert.equal(r.fetched, 1, 'len Perzský záliv s novým `updated`');
    assert.ok(changed.calls.some((u) => u.endsWith('czib-2026-07r3')));
  });
});

test('výpadok exportu: stará snímka ostáva (stale), bez nej error; nikdy nehádže', async () => {
  await withRoot(async (root) => {
    assert.equal((await czibRefresh(root, { fetchImpl: fakeNet({ exportStatus: 503 }).fetchImpl, now: T0 })).status, 'error');
    await czibRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0, sleep: async () => {} });
    const r = await czibRefresh(root, { fetchImpl: fakeNet({ exportStatus: 503 }).fetchImpl, now: T0 + AIRSPACE_FRESH_MS + 1 });
    assert.equal(r.status, 'stale');
    assert.equal(r.count, 5);
    assert.equal(JSON.parse(readFileSync(czibFile(root), 'utf8')).fetchedAt, T0, 'súbor nezmenený');
    assert.equal((await czibRefresh(root, { fetchImpl: async () => { throw new Error('offline'); }, now: T0 + 2 * AIRSPACE_FRESH_MS })).status, 'stale');
    assert.equal((await czibRefresh(root, { now: 'bad' })).status, 'error');
  });
});

test('hranice FIR: raz za 7 dní, len základné FIR; orezaný súbor sa neprijme', async () => {
  await withRoot(async (root) => {
    const r = await firBoundariesRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0 });
    assert.deepEqual(r, { status: 'updated', count: 130 });
    const saved = JSON.parse(readFileSync(firFile(root), 'utf8'));
    assert.equal(saved.license, 'CC BY-SA 4.0');
    assert.ok(saved.firs.ORBB && !saved.firs['ORBB-N']);
    assert.equal((await firBoundariesRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0 + FIR_FRESH_MS - 1 })).status, 'fresh');
    const tiny = JSON.stringify({ type: 'FeatureCollection', features: [{ properties: { id: 'ORBB' }, geometry: { type: 'Polygon', coordinates: [[[40, 30], [45, 30], [45, 35], [40, 30]]] } }] });
    const bad = await firBoundariesRefresh(root, { fetchImpl: fakeNet({ boundaries: tiny }).fetchImpl, now: T0 + FIR_FRESH_MS + 1 });
    assert.equal(bad.status, 'stale');
    assert.match(bad.error, /only 1 FIRs/);
    assert.equal(JSON.parse(readFileSync(firFile(root), 'utf8')).fetchedAt, T0, 'dobrý súbor ostal');
  });
});

test('telo /airspace: bulletiny + polygóny menovaných FIR (každý raz), chýbajúce kódy, uplynutá platnosť', async () => {
  await withRoot(async (root) => {
    assert.equal(await airspacePayload(root), null, 'bez snímky null → 404');
    await czibRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0, sleep: async () => {} });
    await firBoundariesRefresh(root, { fetchImpl: fakeNet().fetchImpl, now: T0 });
    const p = await airspacePayload(root, { nowMs: T0 });
    assert.equal(p.bulletins.length, 5);
    assert.deepEqual(Object.keys(p.firs).sort(), ['HLLL', 'OBBB', 'OKAC', 'OMAE', 'OOMM', 'ORBB', 'OSTT', 'OTDF', 'UKBV', 'UKLV']);
    assert.deepEqual(p.missingFirs.sort(), ['UKBU', 'UKDV', 'UKFV', 'UKOV'], 'vo výreze VATSpy chýbajú (UKBU nemá ani plný súbor)');
    assert.equal(p.firLicense, 'CC BY-SA 4.0');
    assert.ok(p.bulletins.every((b) => b.lapsed === false));
    const later = await airspacePayload(root, { nowMs: Date.parse('2027-02-01T00:00:00Z') });
    assert.equal(later.bulletins.find((b) => b.nid === '143862').lapsed, true, 'Irak platil do 16. 11. 2026');
  });
});
