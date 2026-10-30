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
  gcInWindow,
  observeGc,
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
    gc: () => null,
    heapMb: () => null,
    defer: (fn) => fn(),
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

// 2026-10-30: bloky oko-api mali opakovane ~2,2 s pri halde ~1,3 GB — riadok musí rozlíšiť GC od kódu.
test('GC v okne bloku: len prekrytá časť, veľký GC zvlášť', () => {
  const entries = [
    { startTime: 100, duration: 50, major: false },   // pred oknom
    { startTime: 950, duration: 100, major: false },  // 50 ms v okne
    { startTime: 1200, duration: 900, major: true },  // celý v okne
    { startTime: 2900, duration: 400, major: true },  // 100 ms v okne
    { startTime: NaN, duration: 10 },
  ];
  assert.deepEqual(gcInWindow(entries, 1000, 3000), { ms: 1050, majorMs: 1000, count: 3 });
  assert.deepEqual(gcInWindow(null, 0, 1), { ms: 0, majorMs: 0, count: 0 });
});

test('riadok s GC a haldou; bez údajov ostáva pôvodný tvar', () => {
  const at = new Date(2026, 9, 30, 22, 24, 14);
  const line = formatEventLoopWarning({ lagMs: 2202, uptimeS: 1871, at, gcMs: 1463.4, gcMajorMs: 1112.2, heapMb: 1290.6 });
  assert.match(line, /2202 ms \(1871 s od štartu procesu\) · GC 1463 ms \(veľký 1112 ms\) · halda 1291 MB$/);
  assert.match(formatEventLoopWarning({ lagMs: 1200, uptimeS: 3, at, gcMs: 40, gcMajorMs: 0 }), /· GC 40 ms$/);
  assert.match(formatEventLoopWarning({ lagMs: 1200, uptimeS: 3, at }), /od štartu procesu\)$/);
});

test('plugin: hlásenie počká na záznamy GC a pri zatvorení odber zastaví', () => {
  const logs = [];
  let tick = null;
  let t = 0;
  let onClose = null;
  let deferred = null;
  let stopped = false;
  const gcList = [];
  const plugin = eventLoopWatchPlugin({
    log: (line) => logs.push(line),
    now: () => t,
    uptime: () => 1871,
    clock: () => new Date(2026, 9, 30, 22, 24, 14),
    setIntervalFn: (fn) => { tick = fn; return { unref() {} }; },
    clearIntervalFn: () => {},
    gc: () => ({ entries: () => gcList, stop: () => { stopped = true; } }),
    heapMb: () => 1290,
    defer: (fn) => { deferred = fn; },
  });
  plugin.configureServer({ httpServer: { once: (event, fn) => { if (event === 'close') onClose = fn; } } });
  t = 3202; tick();
  assert.equal(logs.length, 0, 'hlásenie je odložené');
  gcList.push({ startTime: 1500, duration: 1400, major: true }); // záznam GC prišiel až po bloku
  deferred();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /2702 ms .* GC 1400 ms \(veľký 1400 ms\) · halda 1290 MB/);
  onClose();
  assert.equal(stopped, true);
});

test('skutočný odber GC z perf_hooks sa dá zapnúť a vypnúť', () => {
  const watch = observeGc();
  assert.ok(watch, 'Node 24 podporuje záznamy gc');
  assert.ok(Array.isArray(watch.entries()));
  watch.stop();
});
