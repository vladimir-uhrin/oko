// src/stadiaHosts.test.mjs — kde smie bežať Stadia bez kľúča (2026-10-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stadiaAuthorizedHost, STADIA_AUTHORIZED_DOMAINS } from './stadiaHosts.js';

test('localhost bez účtu, okolive.sk s poddoménami z účtu, cudzie domény nie', () => {
  for (const h of ['localhost', '127.0.0.1', 'oko.localhost', 'okolive.sk', 'WWW.OKOLIVE.SK', ' okolive.sk ']) assert.equal(stadiaAuthorizedHost(h), true, h);
  for (const h of ['', null, 'oko.uhrin.digital', 'okolive.sk.evil.example', 'notokolive.sk', 'example.com']) assert.equal(stadiaAuthorizedHost(h), false, String(h));
  assert.deepEqual([...STADIA_AUTHORIZED_DOMAINS], ['okolive.sk']);
});

test('layerBasemap neimportuje meteoLayer (meteo sa načítava lenivo, scripts/check-lazy.js)', () => {
  const src = readFileSync(new URL('./layerBasemap.js', import.meta.url), 'utf8');
  assert.ok(!/from '[^']*meteoLayer/.test(src), 'pravidlo hostiteľa patrí do stadiaHosts.js');
});
