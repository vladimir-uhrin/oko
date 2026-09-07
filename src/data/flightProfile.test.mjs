// src/data/flightProfile.test.mjs
// Mini profil letu na karte (2026-09-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROFILE_MAX_SAMPLES,
  PROFILE_SAMPLE_INTERVAL_MS,
  createProfileStore,
  levelLabel,
  normalizeSeries,
  profileRowFromSamples,
} from './flightProfile.js';

const t = (key, vars) => (key === 'card.profile-span' ? `last ${vars.min} min` : key);

test('sklad: jedna vzorka za interval, kruhový buffer prepisuje najstaršie, mazanie', () => {
  const store = createProfileStore({ intervalMs: 60_000, maxSamples: 4 });
  assert.equal(store.record('abc123', 0, 1000, 100), true);
  assert.equal(store.record('abc123', 30_000, 1100, 110), false, 'pod interval sa nezapíše');
  assert.equal(store.record('abc123', 60_000, 1200, 120), true);
  assert.equal(store.record('abc123', 120_000, 1300, 130), true);
  assert.equal(store.record('abc123', 180_000, 1400, 140), true);
  assert.equal(store.record('abc123', 240_000, 1500, 150), true, 'piata vzorka prepíše prvú');
  const rows = store.samples('abc123');
  assert.deepEqual(rows.map((r) => r.epochMs), [60_000, 120_000, 180_000, 240_000], 'chronologicky, bez prvej');
  assert.deepEqual(rows.map((r) => r.altitudeM), [1200, 1300, 1400, 1500]);
  assert.equal(store.record('abc123', 300_000, NaN, undefined), true, 'neznáma výška = NaN, nie 0');
  assert.ok(Number.isNaN(store.samples('abc123').at(-1).altitudeM));
  assert.equal(store.size, 1);
  store.delete('abc123');
  assert.deepEqual(store.samples('abc123'), []);
  assert.equal(store.record('', 0, 1, 1), false);
  store.record('x', 0, 1, 1);
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(PROFILE_MAX_SAMPLES, 31, '30 min po minúte + aktuálna');
  assert.equal(PROFILE_SAMPLE_INTERVAL_MS, 60_000);
});

test('riadok: normalizované krivky, popisky hladín a rýchlosti, rozpätie v minútach', () => {
  const now = 1_000_000_000;
  const samples = [];
  for (let i = 0; i <= 20; i += 1) {
    samples.push({ epochMs: now - (20 - i) * 60_000, altitudeM: 3000 + i * 400, speedMps: 150 + i * 5 });
  }
  const row = profileRowFromSamples(samples, now, { translate: t });
  assert.ok(row);
  assert.equal(row.altitude.length, 21);
  assert.equal(row.altitude[0], 0);
  assert.equal(row.altitude[20], 1);
  assert.equal(row.speed[0], 0);
  assert.equal(row.speed[20], 1);
  assert.equal(row.spanMin, 20);
  assert.equal(row.label, '9 843 ft → FL361');
  assert.equal(row.sublabel, '292 → 486 kts · last 20 min');
});

test('riadok: okno 30 min, minimum 3 vzorky a 2 min, plochý let v strede, bez rýchlosti bez krivky', () => {
  const now = 5_000_000;
  const old = [{ epochMs: now - 40 * 60_000, altitudeM: 1000, speedMps: 100 }];
  const fresh = [
    { epochMs: now - 10 * 60_000, altitudeM: 10_000, speedMps: 230 },
    { epochMs: now - 5 * 60_000, altitudeM: 10_050, speedMps: 232 },
    { epochMs: now, altitudeM: 10_020, speedMps: 231 },
  ];
  assert.equal(profileRowFromSamples(old.concat(fresh.slice(0, 2)), now, { translate: t }), null, 'stará vzorka vypadne, 2 nestačia');
  const flat = profileRowFromSamples(old.concat(fresh), now, { translate: t });
  assert.ok(flat);
  assert.deepEqual(flat.altitude, [0.5, 0.5, 0.5], 'cestovná hladina: rovná čiara v strede');
  assert.deepEqual(flat.speed, [0.5, 0.5, 0.5]);
  assert.equal(flat.label, 'FL328 → FL329');
  assert.equal(profileRowFromSamples([
    { epochMs: now - 60_000, altitudeM: 1, speedMps: 1 },
    { epochMs: now - 30_000, altitudeM: 2, speedMps: 1 },
    { epochMs: now, altitudeM: 3, speedMps: 1 },
  ], now), null, 'pod 2 min rozpätia');
  const noSpeed = profileRowFromSamples(fresh.map((s) => ({ ...s, speedMps: NaN })), now, { translate: t });
  assert.deepEqual(noSpeed.speed, []);
  assert.equal(noSpeed.sublabel, 'last 10 min');
  assert.equal(profileRowFromSamples(null, now), null);
  assert.deepEqual(normalizeSeries([5, 5, 5], 1), [0.5, 0.5, 0.5]);
  assert.equal(levelLabel(0), '0 ft');
  assert.equal(levelLabel(10_668), 'FL350');
});

test('tripwire: flotila zapisuje vzorky pri každom novom fixe a karta číta profil', () => {
  const flights = readFileSync(new URL('./flights.js', import.meta.url), 'utf8');
  assert.match(flights, /_profileStore\.record\(icao24, fixEpochMs, alt, meta\.velocity\)/, 'zápis pri novom fixe (spolu s DR históriou)');
  assert.match(flights, /_profileStore\.delete\(icao24\)/, 'mazanie spolu s históriou');
  assert.match(flights, /_profileStore\.clear\(\)/, 'čistenie pri vypnutí vrstvy');
  assert.match(flights, /profile: profileRowFromSamples\(_profileStore\.samples\(icao24\), nowMs/, 'karta dostáva riadok profilu');
  const readout = readFileSync(new URL('./trackedReadout.js', import.meta.url), 'utf8');
  assert.match(readout, /profile: model\.profile \?\? null/, 'hostiteľ prenáša profil do entry');
});
