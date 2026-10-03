// scripts/lib/mideastUkmto.test.mjs — archív INCIDENTOV LODÍ (UKMTO), etapa 5c modulu BLÍZKY
// VÝCHOD (2026-10-03). Sieť je falošná, odpoveď = skutočné incidenty zo 3. 10. 2026 (fixtúra).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UKMTO_FRESH_MS, ukmtoFile, ukmtoPayload, ukmtoRefresh } from './mideastArchive.mjs';
import { UKMTO_API_URL } from '../../src/data/ukmto.js';

const all = () => JSON.parse(readFileSync(new URL('../../src/data/fixtures/ukmto-all-20261003.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-10-03T16:00:00Z');
function fakeNet(body, status = 200) {
  const calls = [];
  return { calls, fetchImpl: async (url) => { calls.push(String(url)); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); } };
}
async function withRoot(fn) {
  const root = mkdtempSync(path.join(tmpdir(), 'oko-ukmto-'));
  try { await fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('prvý beh uloží incidenty s licenciou; do 14 minút sa znova nepýta, tik úlohy (15 min) už áno', async () => {
  await withRoot(async (root) => {
    const net = fakeNet(all());
    const r = await ukmtoRefresh(root, { fetchImpl: net.fetchImpl, now: T0 });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 21);
    assert.equal(r.added, 21);
    assert.equal(r.day, '2026-10-02', 'deň najnovšieho incidentu');
    assert.deepEqual(net.calls, [UKMTO_API_URL]);
    const snap = JSON.parse(readFileSync(ukmtoFile(root), 'utf8'));
    assert.equal(snap.license, 'Open Government Licence v3.0');
    assert.match(snap.attribution, /UKMTO/);
    assert.equal(snap.incidents[0].ref, '149-26');
    const again = fakeNet(all());
    assert.equal((await ukmtoRefresh(root, { fetchImpl: again.fetchImpl, now: T0 + UKMTO_FRESH_MS - 1 })).status, 'fresh');
    assert.equal(again.calls.length, 0);
    assert.equal(UKMTO_FRESH_MS, 14 * 60_000, 'čerstvosť kratšia než tik úlohy, aby každý tik naozaj stiahol');
    assert.equal((await ukmtoRefresh(root, { fetchImpl: again.fetchImpl, now: T0 + 15 * 60_000 })).status, 'updated', 'ďalší tik po 15 min sťahuje znova');
    assert.equal(again.calls.length, 1);
  });
});

test('archív rastie: incident, ktorý rozhranie prestalo vracať, ostáva; doplnené varovanie sa prepíše', async () => {
  await withRoot(async (root) => {
    await ukmtoRefresh(root, { fetchImpl: fakeNet(all()).fetchImpl, now: T0 });
    // o mesiac: rozhranie už nevracia júlové incidenty, pribudol nový a číslo 149 dostalo doplnenie
    const later = all().filter((x) => Date.parse(x.utcDateOfIncident) > Date.parse('2026-08-01T00:00:00Z'))
      .map((x) => (x.incidentNumber === 149 ? { ...x, otherDetails: `${x.otherDetails}\r\nUpdate 001: The crew are safe.` } : x));
    later.push({ ...all()[0], sitecoreId: '11111111-2222-3333-4444-555555555555', incidentNumber: 160, utcDateOfIncident: '2026-11-02T08:00:00Z', otherDetails: 'UKMTO WARNING 160-26 - ATTACK\r\nUKMTO has received a report of an incident 10NM north of Khasab, Oman.' });
    const r = await ukmtoRefresh(root, { fetchImpl: fakeNet(later).fetchImpl, now: T0 + 30 * 86_400_000 });
    assert.equal(r.status, 'updated');
    assert.equal(r.added, 1);
    assert.equal(r.count, 22, '21 pôvodných + 1 nový; júlové ostali');
    const snap = JSON.parse(readFileSync(ukmtoFile(root), 'utf8'));
    assert.equal(snap.incidents[0].ref, '160-26');
    assert.ok(snap.incidents.some((x) => x.ref === '078-26'), 'incident z 1. 7. je stále v archíve');
    assert.match(snap.incidents.find((x) => x.ref === '149-26').text, /Update 001: The crew are safe\.$/);
  });
});

test('výpadok alebo zlá odpoveď: starý archív ostáva (stale), bez neho error; prázdne pole archív nemaže', async () => {
  await withRoot(async (root) => {
    assert.equal((await ukmtoRefresh(root, { fetchImpl: fakeNet('nope', 503).fetchImpl, now: T0 })).status, 'error');
    await ukmtoRefresh(root, { fetchImpl: fakeNet(all()).fetchImpl, now: T0 });
    const later = T0 + UKMTO_FRESH_MS + 1;
    assert.equal((await ukmtoRefresh(root, { fetchImpl: fakeNet('<html>', 200).fetchImpl, now: later })).status, 'stale');
    assert.equal((await ukmtoRefresh(root, { fetchImpl: fakeNet({ error: 'x' }).fetchImpl, now: later })).status, 'stale', 'objekt namiesto poľa');
    assert.equal((await ukmtoRefresh(root, { fetchImpl: async () => { throw new Error('offline'); }, now: later })).status, 'stale');
    assert.equal(JSON.parse(readFileSync(ukmtoFile(root), 'utf8')).fetchedAt, T0, 'súbor nezmenený');
    const empty = await ukmtoRefresh(root, { fetchImpl: fakeNet([]).fetchImpl, now: later });
    assert.equal(empty.status, 'updated');
    assert.equal(empty.count, 21, 'prázdna odpoveď (pokoj na mori) archív nezmazala');
    assert.equal((await ukmtoRefresh(root, { now: 'bad' })).status, 'error');
  });
});

test('403 od Cloudflare: jeden pokus druhým prenosom; iná chyba druhý prenos nevolá; oba 403 = starý archív', async () => {
  await withRoot(async (root) => {
    const blocked = fakeNet('<!DOCTYPE html><title>Access denied</title>', 403);
    const alt = fakeNet(all());
    const r = await ukmtoRefresh(root, { fetchImpl: blocked.fetchImpl, altFetchImpl: alt.fetchImpl, now: T0 });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 21);
    assert.deepEqual(blocked.calls, [UKMTO_API_URL]);
    assert.deepEqual(alt.calls, [UKMTO_API_URL], 'práve jeden pokus druhým klientom');
    const later = T0 + UKMTO_FRESH_MS + 1;
    const down = fakeNet('nope', 503);
    const altUnused = fakeNet(all());
    assert.equal((await ukmtoRefresh(root, { fetchImpl: down.fetchImpl, altFetchImpl: altUnused.fetchImpl, now: later })).status, 'stale');
    assert.equal(altUnused.calls.length, 0, 'pri 503 sa druhý prenos nevolá (nie je to blok klienta)');
    const alt403 = fakeNet('denied', 403);
    const both = await ukmtoRefresh(root, { fetchImpl: fakeNet('denied', 403).fetchImpl, altFetchImpl: alt403.fetchImpl, now: later });
    assert.equal(both.status, 'stale');
    assert.match(both.error, /UKMTO HTTP 403/);
    assert.equal(alt403.calls.length, 1);
    assert.equal(JSON.parse(readFileSync(ukmtoFile(root), 'utf8')).fetchedAt, T0, 'archív nezmenený');
  });
});

test('telo /ukmto: incidenty za posledných N dní, rozsah archívu, licencia; bez archívu null', async () => {
  await withRoot(async (root) => {
    assert.equal(await ukmtoPayload(root), null);
    await ukmtoRefresh(root, { fetchImpl: fakeNet(all()).fetchImpl, now: T0 });
    const p90 = await ukmtoPayload(root, { days: 90, nowMs: T0 });
    assert.equal(p90.incidents.length, 19, 'incidenty z 1. 7. a z 5. 7. ráno sú staršie než 90 dní (hranica 5. 7. 16:00)');
    assert.ok(p90.incidents.every((x) => x.t >= T0 - 90 * 86_400_000));
    assert.equal(p90.archived, 21);
    assert.equal(p90.firstT, Date.parse('2026-07-01T11:22:00Z'));
    assert.equal(p90.fetchedAt, T0);
    assert.equal(p90.licenseUrl, 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/');
    const p7 = await ukmtoPayload(root, { days: 7, nowMs: T0 });
    assert.deepEqual(p7.incidents.map((x) => x.ref), ['149-26', '148-26', '147-26']);
  });
});
