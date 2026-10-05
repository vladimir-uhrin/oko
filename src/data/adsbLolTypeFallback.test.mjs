// Typ a registrácia z adsb.lol, keď ich adsbdb nepozná (2026-10-05): Wizz Air 471f05 = A321 HA-LTL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdsbLolTypeFallback, typeFromReadsb } from './adsbLolTypeFallback.js';

test('záznam readsb → typ pre kartu (ľudský názov zo slovníka, inak desc)', () => {
  assert.deepEqual(typeFromReadsb({ t: 'A321', r: 'HA-LTL', flight: 'WZZ6771 ' }, '471F05'),
    { typeCode: 'A321', typeName: 'Airbus A321', registration: 'HA-LTL', modeS: '471f05', countryIso: null, source: 'adsb.lol' });
  assert.equal(typeFromReadsb({ t: 'C68A', desc: 'CESSNA 680A Citation Latitude' }, 'abcdef').typeName, 'CESSNA 680A Citation Latitude');
  assert.equal(typeFromReadsb({ flight: 'X' }, 'abcdef'), null, 'bez typu aj registrácie nič');
  assert.equal(typeFromReadsb(null, 'abcdef'), null);
});

test('šetrne: po jednom s odstupom, cache (nenájdené kratšie), po 429 pauza, strop fronty', async () => {
  let clock = 0;
  const calls = [];
  let status = 200;
  const service = createAdsbLolTypeFallback({
    now: () => clock, sleep: async ms => { clock += ms; }, maxPending: 2,
    fetchImpl: async url => { calls.push({ url, at: clock }); return { ok: status === 200, status, json: async () => ({ ac: url.endsWith('471f05') ? [{ t: 'A321', r: 'HA-LTL' }] : [] }) }; },
  });
  const [a, b] = await Promise.all([service.lookup('471f05'), service.lookup('4400f8')]);
  assert.equal(a.registration, 'HA-LTL');
  assert.equal(b, null);
  assert.ok(calls[1].at - calls[0].at >= 1100, 'odstup medzi dopytmi');
  await service.lookup('471F05');
  assert.equal(calls.length, 2, 'nájdené z cache');
  clock += 2 * 3600_000 + 1;
  await service.lookup('4400f8');
  assert.equal(calls.length, 3, 'nenájdené sa po 2 h skúsi znova');
  status = 429;
  assert.equal(await service.lookup('aaaaaa'), null);
  const before = calls.length;
  assert.equal(await service.lookup('bbbbbb'), null, 'počas pauzy bez dopytu');
  assert.equal(calls.length, before);
  clock += 61_000; status = 200;
  // Strop fronty: tretí súčasný dopyt nečaká.
  const results = await Promise.all([service.lookup('c00001'), service.lookup('c00002'), service.lookup('c00003')]);
  assert.equal(calls.length, before + 2, 'nad strop fronty sa nevolá');
  assert.deepEqual(results, [null, null, null]);
  assert.equal(await service.lookup('nie-hex'), null);
});
