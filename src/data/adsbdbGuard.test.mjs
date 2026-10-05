// Ochrana adsbdb (2026-10-05): karty lietadiel prišli o trasu, ETA a typ, lebo odhady polôh
// volali adsbdb 1 500–3 500× za hodinu a adsbdb nás blokoval (429 „rate limited for 300 seconds").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdsbdbGuard, rateLimitSeconds } from './adsbdbGuard.js';

test('dĺžka blokovania z odpovede adsbdb, inak 300 s, najviac hodina', () => {
  assert.equal(rateLimitSeconds('{"response":"rate limited for 300 seconds"}'), 300);
  assert.equal(rateLimitSeconds('rate limited for 60 seconds'), 60);
  assert.equal(rateLimitSeconds('<html>Too Many Requests</html>'), 300);
  assert.equal(rateLimitSeconds('rate limited for 999999 seconds'), 3600);
});

test('po 429 sa adsbdb nevolá, kým blokovanie nevyprší (+5 s)', () => {
  let t = 0;
  const guard = createAdsbdbGuard({ now: () => t });
  assert.equal(guard.paused(), false);
  guard.onRateLimited('{"response":"rate limited for 300 seconds"}');
  assert.equal(guard.paused(), true);
  t = 304_999;
  assert.equal(guard.paused(), true);
  assert.equal(guard.takeBackground(), false, 'ani pozaďový dopyt');
  t = 305_000;
  assert.equal(guard.paused(), false);
});

test('pozaďové dopyty (odhady) majú prídel 2 za minútu — karty ich prednosť nepotrebujú', () => {
  let t = 0;
  const guard = createAdsbdbGuard({ now: () => t, backgroundPerMin: 2 });
  assert.equal(guard.takeBackground(), true);
  assert.equal(guard.takeBackground(), true);
  assert.equal(guard.takeBackground(), false, 'tretí v tej istej minúte nie');
  t = 30_000;
  assert.equal(guard.takeBackground(), true, 'po pol minúte jeden žetón');
  assert.equal(guard.takeBackground(), false);
  // Za hodinu najviac ~120 pozaďových dopytov namiesto 1 200 (každé 3 s).
  let allowed = 0;
  for (t = 60_000; t < 60_000 + 3600_000; t += 3000) if (guard.takeBackground()) allowed++;
  assert.ok(allowed <= 121, `za hodinu ${allowed}`);
});
