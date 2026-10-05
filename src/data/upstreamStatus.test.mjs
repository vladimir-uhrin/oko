// Spoločný register externých zdrojov (2026-10-05): počty po hodinách, pauza po 429, prehľad pre admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstreamRegistry, upstream } from './upstreamStatus.js';
import { createAdsbLolTypeFallback } from './adsbLolTypeFallback.js';
import { createAircraftSearchService } from './aircraftSearchService.js';

test('počty za hodinu a 24 h, 429 s pauzou, chyby; staré hodiny vypadnú', () => {
  let t = 10 * 3600_000;
  const r = createUpstreamRegistry({ now: () => t });
  r.record('adsbdb', { status: 200 });
  r.record('adsbdb', { status: 404 });
  r.record('adsbdb', { status: 429, pauseMs: 305_000 });
  r.record('adsbdb', { error: true });
  assert.equal(r.paused('adsbdb'), true);
  assert.equal(r.paused('nominatim'), false, 'neznámy zdroj nie je zablokovaný');
  let snap = r.snapshot()[0];
  assert.deepEqual(snap.lastHour, { n: 4, limited: 1, errors: 1 }, '404 nie je chyba zdroja');
  assert.equal(snap.pausedUntil, t + 305_000);
  t += 306_000;
  assert.equal(r.paused('adsbdb'), false);
  assert.equal(r.snapshot()[0].pausedUntil, null);
  t += 2 * 3600_000;
  r.record('adsbdb', { status: 200 });
  snap = r.snapshot()[0];
  assert.deepEqual([snap.lastHour.n, snap.last24h.n, snap.last24h.limited], [1, 5, 1]);
  t += 60 * 3600_000;
  r.record('adsbdb', { status: 200 });
  assert.equal(r.snapshot()[0].last24h.n, 1, 'po 48 h sa staré hodiny zahodia');
  assert.equal(typeof upstream.record, 'function', 'spoločná inštancia procesu');
});

test('zablokovaný adsb.lol zastaví menej dôležité volania (záložný typ, hľadanie lietadla) bez dopytu', async () => {
  let t = 0;
  const registry = createUpstreamRegistry({ now: () => t });
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ac: [] }) }; };
  const type = createAdsbLolTypeFallback({ fetchImpl, now: () => t, sleep: async () => {}, registry });
  const search = createAircraftSearchService({ fetchImpl, now: () => t, sleep: async () => {}, registry });
  // Iná časť OKO (vrstva vojenských lietadiel) dostala 429.
  registry.record('adsb.lol', { status: 429, pauseMs: 60_000 });
  assert.equal(await type.lookup('471f05'), null);
  assert.equal((await search.search('Ruslan')).limited, true);
  assert.equal(calls.length, 0, 'počas spoločnej pauzy sa adsb.lol nevolá');
  t = 61_000;
  await type.lookup('471f05');
  assert.equal(calls.length, 1);
  assert.equal(registry.snapshot()[0].lastHour.n, 2, 'volanie sa zapísalo do registra');
});
