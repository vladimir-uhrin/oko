// src/eventLoopWatch.test.mjs — merač zablokovania vlákna dev servera (2026-09-30, bod 2
// „zasekávanie pár minút po reštarte": najprv zmerať, kde vzniká).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENT_LOOP_TICK_MS,
  EVENT_LOOP_WARN_MS,
  eventLoopLagMs,
  eventLoopWatchPlugin,
  formatEventLoopWarning,
} from '../scripts/lib/eventLoopWatch.mjs';

test('oneskorenie ticku: len kladné a konečné', () => {
  assert.equal(eventLoopLagMs(0, 500, 500), 0);
  assert.equal(eventLoopLagMs(0, 4700, 500), 4200);
  assert.equal(eventLoopLagMs(1000, 900, 500), 0, 'hodiny idú dozadu → 0');
  assert.equal(eventLoopLagMs(0, NaN, 500), 0);
  assert.ok(EVENT_LOOP_WARN_MS > EVENT_LOOP_TICK_MS);
});

test('riadok logu nesie čas, dĺžku blokovania a dobu od štartu', () => {
  const line = formatEventLoopWarning({ lagMs: 4210.4, uptimeS: 412.6, at: new Date(2026, 8, 30, 15, 40, 12) });
  assert.match(line, /^\[event-loop\] /);
  assert.match(line, /4210 ms/);
  assert.match(line, /413 s od štartu/);
  assert.match(line, /15:40:12/);
});

test('plugin hlási len nad prahom a pri zatvorení servera časovač zastaví', () => {
  const logs = [];
  let tick = null;
  let cleared = null;
  let t = 0;
  let onClose = null;
  const plugin = eventLoopWatchPlugin({
    log: (line) => logs.push(line),
    now: () => t,
    uptime: () => 60,
    clock: () => new Date(2026, 8, 30, 12, 0, 0),
    setIntervalFn: (fn) => { tick = fn; return { id: 7, unref() {} }; },
    clearIntervalFn: (timer) => { cleared = timer; },
  });
  plugin.configureServer({ httpServer: { once: (event, fn) => { if (event === 'close') onClose = fn; } } });
  t = 500; tick();
  t = 1200; tick();
  assert.equal(logs.length, 0, 'bežné ticky mlčia');
  t = 4000; tick();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /2300 ms/);
  onClose();
  assert.equal(cleared?.id, 7);
});

test('vite.config.js merač zapája', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /import \{ eventLoopWatchPlugin \} from '\.\/scripts\/lib\/eventLoopWatch\.mjs';/);
  assert.match(vite, /eventLoopWatchPlugin\(\),/);
});
