// Hľadanie miesta zadarmo cez Nominatim (2026-10-05): tvar výsledku ako Google, 1. pád, fronta, cache, limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGeocodeService, googleTypesFor, nominativeGuesses, toGoogleResult } from './geocodeService.js';

const KOSICE = { lat: '48.7172', lon: '21.2496', class: 'boundary', type: 'administrative', addresstype: 'city',
  display_name: 'Košice, okres Košice I, Košický kraj, Slovensko', boundingbox: ['48.6', '48.8', '21.1', '21.4'] };

test('výsledok Nominatimu má tvar Google Geocoding (poloha, viewport, typ na rámovanie)', () => {
  const r = toGoogleResult(KOSICE);
  assert.deepEqual(r.geometry.location, { lat: 48.7172, lng: 21.2496 });
  assert.deepEqual(r.geometry.viewport, { southwest: { lat: 48.6, lng: 21.1 }, northeast: { lat: 48.8, lng: 21.4 } });
  assert.deepEqual(r.types, ['locality', 'political'], 'mesto = city-overview');
  assert.equal(r.formatted_address, 'Košice, okres Košice I, Košický kraj');
  assert.deepEqual(googleTypesFor({ addresstype: 'country' }), ['country', 'political']);
  assert.deepEqual(googleTypesFor({ class: 'aeroway', type: 'aerodrome' }), ['airport', 'establishment']);
  assert.deepEqual(googleTypesFor({ class: 'natural', type: 'peak' }), ['natural_feature']);
  assert.equal(toGoogleResult({ lat: 'x' }), null);
});

test('1. pád: Košíc → Košice, Bratislavu → Bratislava, Žiliny → Žilina; viac slov a čísla bez zmeny', () => {
  assert.deepEqual(nominativeGuesses('Košíc').slice(0, 2), ['Košíc', 'Košice']);
  assert.deepEqual(nominativeGuesses('Bratislavu').slice(0, 2), ['Bratislavu', 'Bratislava']);
  assert.deepEqual(nominativeGuesses('Žiliny').slice(0, 2), ['Žiliny', 'Žilina']);
  assert.deepEqual(nominativeGuesses('Letisko Bratislava'), ['Letisko Bratislava']);
  assert.ok(nominativeGuesses('Košice').length <= 3);
});

test('služba: spoločná fronta, cache 24 h, jazyk, viewbox okolo kamery; HTTP limit a validácia', async t => {
  const calls = [];
  let scheduled = 0;
  let clock = 0;
  const service = createGeocodeService({
    fetchImpl: async (url, opts) => { calls.push({ url, ua: opts.headers['User-Agent'] }); return { ok: true, json: async () => (url.includes('Xyzzy') ? [] : [KOSICE]) }; },
    schedule: task => { scheduled++; return task(); }, now: () => clock, perIpPerMin: 4,
  });
  const first = await service.lookup('Košice', { lat: 48.1, lon: 17.1 });
  assert.equal(first.geometry.location.lat, 48.7172);
  assert.equal(scheduled, 1, 'ide cez spoločnú frontu Nominatimu');
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('accept-language'), 'sk,en');
  assert.equal(url.searchParams.get('viewbox'), '12.100,53.100,22.100,43.100');
  assert.match(calls[0].ua, /OKO-okolive\.sk/);
  await service.lookup('košice');
  assert.equal(calls.length, 1, 'cache bez ohľadu na veľkosť písmen');
  clock += 25 * 3600_000;
  await service.lookup('Košice');
  assert.equal(calls.length, 2, 'po 24 h znova');
  assert.equal(await service.lookup('Xyzzy'), null);

  const server = http.createServer((req, res) => service.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/geocode?q=x`)).status, 400);
  const ok = await (await fetch(`${base}/api/geocode?q=Ko%C5%A1ice`)).json();
  assert.deepEqual([ok.status, ok.results.length, ok.source], ['OK', 1, 'nominatim']);
  assert.equal((await (await fetch(`${base}/api/geocode?q=Xyzzy`)).json()).status, 'ZERO_RESULTS');
  for (let i = 0; i < 2; i++) await fetch(`${base}/api/geocode?q=Ko%C5%A1ice`);
  assert.equal((await fetch(`${base}/api/geocode?q=Ko%C5%A1ice`)).status, 429, 'piaty dopyt za minútu z jednej IP');
});
