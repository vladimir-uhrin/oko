// src/data/volbyLive.test.mjs — priebežné výsledky z JSON stránky ŠÚ SR (2026-10-24 20:40): stĺpce C01–C07,
// súhrn tab01, 404 ako HTML, cache, a zapojenie do /api/volby (prehľad, kraj, obec) po zatvorení miestností.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createVolbyLive, liveCandidates, liveFlag, liveSummary } from './volbyLive.js';

const ROWS = [
  { C01: '1', C02: 'Juraj', C03: 'Droba', C04: 'SaS, PS', C05: '12 345', C06: '48,20', C07: '' },
  { C01: '2', C02: 'Rastislav', C03: 'Gajarský', C04: 'Smer-SD', C05: '13 270', C06: '51,80', C07: '' },
  { C01: 'Spolu', C02: '', C03: '', C04: '', C05: '25 615', C06: '100', C07: '' },
];

test('liveFlag, liveCandidates (poradie podľa hlasov, súčtový riadok preč, vedie/zvolený), liveSummary', () => {
  assert.equal(liveFlag('zvolený'), 'elected');
  assert.equal(liveFlag('1'), 'elected');
  assert.equal(liveFlag('X'), 'withdrawn');
  assert.equal(liveFlag('vzdal sa'), 'withdrawn');
  assert.equal(liveFlag(''), null);
  const c = liveCandidates(ROWS);
  assert.deepEqual(c.map((x) => [x.n, x.priezvisko, x.votes, x.pct, x.rank, x.leads, x.elected]), [[2, 'Gajarský', 13270, 51.8, 1, true, false], [1, 'Droba', 12345, 48.2, 2, false, false]]);
  const e = liveCandidates([{ ...ROWS[0], C07: 'zvolený' }, ROWS[1]]);
  assert.equal(e.find((x) => x.n === 1).elected, true);
  assert.ok(e.every((x) => !x.leads), 'so zvoleným nikto „nevedie"');
  assert.deepEqual(liveSummary([{ C01: '24.10.2026 21:10', C03: '6 029', C04: '1 207', C05: '20,02 %' }]), { okrskyTotal: 6029, okrskyDone: 1207, pct: 20.02, updated: '24.10.2026 21:10', registered: null, voted: null, turnoutPct: null });
  // skutočný riadok ŠÚ SR o 21:00
  assert.deepEqual(liveSummary([{ C01: '24.10.2026 21:00:00 SELČ', C03: '6 029', C04: '623', C05: '10,33 %', C06: '127 851', C07: '54 100', C08: '42,31 %' }]), { okrskyTotal: 6029, okrskyDone: 623, pct: 10.33, updated: '24.10.2026 21:00:00 SELČ', registered: 127851, voted: 54100, turnoutPct: 42.31 });
  assert.equal(liveSummary([]), null);
});

test('createVolbyLive: 404 ako HTML = null, JSON z cache 2 min, URL podľa kraja a obce', async () => {
  const calls = [];
  let t = 0;
  const live = createVolbyLive({ now: () => t, fetchImpl: async (url) => {
    calls.push(url);
    if (url.endsWith('tab06b/1.json')) return { ok: true, status: 200, text: async () => JSON.stringify(ROWS) };
    return { ok: false, status: 404, text: async () => '<html>404</html>' };
  } });
  assert.equal((await live.predseda('1'))[0].priezvisko, 'Gajarský');
  assert.equal(await live.starosta('501921'), null);
  await live.predseda('1');
  assert.equal(calls.filter((u) => u.endsWith('tab06b/1.json')).length, 1, 'cache');
  t += 3 * 60_000;
  await live.predseda('1');
  assert.equal(calls.filter((u) => u.endsWith('tab06b/1.json')).length, 2, 'po TTL znova');
  assert.ok(calls.includes('https://volbysr.sk/oso/json/tab05/501921.json'));
});
