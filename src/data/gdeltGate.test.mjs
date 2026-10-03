// src/data/gdeltGate.test.mjs — spoločná brána dopytov na GDELT (2026-10-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GDELT_BACKOFF_MAX_MS, GDELT_BACKOFF_MS, GDELT_MAX_WAIT_MS, GDELT_MIN_GAP_MS, createGdeltGate, isGdeltRateLimit, sharedGdeltGate } from './gdeltGate.js';

/**
 * Virtuálny čas: `sleep` zaradí budík, `drain()` ich budí v poradí času a hodiny
 * posúva na čas budíka — nič reálne nečaká a súbežné spánky sa nesčítavajú.
 */
function clock(start = 1_000_000) {
  let t = start;
  const timers = [];
  return {
    now: () => t,
    sleep: (ms) => new Promise((resolve) => { timers.push({ at: t + ms, resolve }); }),
    advance: (ms) => { t += ms; },
    async drain() {
      for (let guard = 0; guard < 100; guard += 1) {
        await new Promise((r) => setImmediate(r));
        if (!timers.length) return;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        t = Math.max(t, next.at);
        next.resolve();
      }
    },
  };
}

test('dopyty idú za sebou s odstupom 5,5 s, aj keď prídu naraz', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  const starts = [];
  const task = (name) => async () => { starts.push([name, c.now()]); return name; };
  const all = Promise.all([gate.run(task('a')), gate.run(task('b')), gate.run(task('c'))]);
  await c.drain();
  const results = await all;
  assert.deepEqual(results.map((r) => r.value), ['a', 'b', 'c']);
  assert.deepEqual(starts.map(([, t]) => t - 1_000_000), [0, GDELT_MIN_GAP_MS, 2 * GDELT_MIN_GAP_MS]);
  assert.equal(gate.state().ran, 3);
});

test('dopyt, ktorý by čakal dlhšie než strop, sa preskočí (volajúci má Google News)', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  const calls = [];
  const runs = [];
  for (let i = 0; i < 5; i += 1) runs.push(gate.run(async () => { calls.push(i); return i; }));
  await c.drain();
  const results = await Promise.all(runs);
  // 0 s, 5,5 s, 11 s sa zmestia pod strop 12 s; ďalšie by čakali 16,5 s a 22 s
  assert.deepEqual(results.map((r) => r.skipped || r.value), [0, 1, 2, 'busy', 'busy']);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.ok(GDELT_MAX_WAIT_MS < 3 * GDELT_MIN_GAP_MS);
  assert.equal(gate.state().skippedBusy, 2);
});

test('po 429 brána minútu nepýta; potom zas áno', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  const limited = Object.assign(new Error('upstream HTTP 429 (api.gdeltproject.org)'), { upstreamStatus: 429 });
  await assert.rejects(gate.run(async () => { throw limited; }), /429/);
  let called = false;
  c.advance(10_000);
  assert.deepEqual(await gate.run(async () => { called = true; }), { skipped: 'backoff' });
  assert.equal(called, false, 'počas pauzy sa GDELT nevolá vôbec');
  c.advance(GDELT_BACKOFF_MS);
  assert.deepEqual(await gate.run(async () => 'ok'), { value: 'ok' });
  assert.equal(gate.state().rateLimited, 1);
  assert.equal(gate.state().skippedBackoff, 1);
});

test('opakované 429 predlžujú pauzu (1, 2, 4… min, strop 15 min); úspech ju vráti na minútu', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  const limited = () => Object.assign(new Error('upstream HTTP 429'), { upstreamStatus: 429 });
  const pauses = [];
  for (let i = 0; i < 6; i += 1) {
    await assert.rejects(gate.run(async () => { throw limited(); }));
    pauses.push(gate.state().pausedUntil - c.now());
    c.advance(gate.state().pausedUntil - c.now());
  }
  assert.deepEqual(pauses.map((ms) => ms / 60_000), [1, 2, 4, 8, 15, 15]);
  assert.equal(GDELT_BACKOFF_MAX_MS, 15 * 60_000);
  assert.deepEqual(await gate.run(async () => 'ok'), { value: 'ok' });
  assert.equal(gate.state().streak, 0);
  c.advance(GDELT_MIN_GAP_MS);
  await assert.rejects(gate.run(async () => { throw limited(); }));
  assert.equal(gate.state().pausedUntil - c.now(), GDELT_BACKOFF_MS, 'po úspechu znova od minúty');
});

test('čakajúci dopyt, počas ktorého prišla 429, sa po prebudení nespustí', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  const limited = Object.assign(new Error('Please limit requests to one every 5 seconds'), {});
  const first = gate.run(async () => { throw limited; });
  let secondRan = false;
  const second = gate.run(async () => { secondRan = true; });
  await assert.rejects(first);
  await c.drain();
  assert.deepEqual(await second, { skipped: 'backoff' });
  assert.equal(secondRan, false);
});

test('iná chyba (výpadok siete) pauzu nezapne a ide ďalej k volajúcemu', async () => {
  const c = clock();
  const gate = createGdeltGate({ now: c.now, sleep: c.sleep });
  await assert.rejects(gate.run(async () => { throw new Error('fetch failed'); }), /fetch failed/);
  c.advance(GDELT_MIN_GAP_MS);
  assert.deepEqual(await gate.run(async () => 1), { value: 1 });
  assert.equal(gate.state().pausedUntil, 0);
});

test('isGdeltRateLimit pozná 429 aj text o limite pri HTTP 200; sharedGdeltGate je jedna na proces', () => {
  assert.equal(isGdeltRateLimit({ upstreamStatus: 429 }), true);
  assert.equal(isGdeltRateLimit(new Error('GDELT returned non-JSON: Please limit requests to one every 5 seconds')), true);
  assert.equal(isGdeltRateLimit(new Error('Upstream returned 429')), true, 'regionálny brífing hlási 429 len textom');
  assert.equal(isGdeltRateLimit(new Error('fetch failed')), false);
  assert.equal(isGdeltRateLimit(new Error('Upstream returned 4290 bytes')), false);
  assert.equal(isGdeltRateLimit(null), false);
  assert.equal(sharedGdeltGate(), sharedGdeltGate());
});
