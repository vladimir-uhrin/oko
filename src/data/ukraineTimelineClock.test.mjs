// src/data/ukraineTimelineClock.test.mjs — hodiny časovej osi: LIVE/PREHRÁVANIE,
// okná, rýchlosti, tik, koniec = späť do LIVE, rozsah mapy, histogram.
import test from 'node:test';
import assert from 'node:assert/strict';

import { MAP_WINDOW_ALL_MS, TIMELINE_SINCE_MS, createTimelineClock, cursorText, histogramBins } from './ukraineTimelineClock.js';

const H = 3_600_000; const D = 24 * H;
const T0 = Date.UTC(2026, 8, 19, 12);

test('LIVE: okno končí teraz a posúva sa; okno „od 2022" má pevný začiatok', () => {
  let now = T0;
  const clock = createTimelineClock({ now: () => now });
  assert.deepEqual(clock.range(), { start: T0 - D, end: T0 });
  now += H;
  assert.deepEqual(clock.range(), { start: T0 + H - D, end: T0 + H });
  clock.setWindow('7d');
  assert.equal(clock.range().start, T0 + H - 7 * D);
  clock.setWindow('all');
  assert.equal(clock.range().start, TIMELINE_SINCE_MS);
  assert.deepEqual(clock.mapRange(), { start: T0 + H - MAP_WINDOW_ALL_MS, end: T0 + H }, 'mapa pri „od 2022" = 7 dní');
  clock.setWindow('30d');
  assert.equal(clock.mapRange().start, T0 + H - 30 * D);
  assert.equal(cursorText(clock.getState(), (k) => k), 'ukraine.tl.live-now');
});

test('PREHRÁVANIE: kurzor, scrub, rýchlosť, tik, koniec vráti LIVE, krok', () => {
  const now = T0;
  const clock = createTimelineClock({ now: () => now, windowId: '7d', speedId: '6h' });
  const reasons = [];
  clock.onChange((s, reason) => reasons.push(reason));
  clock.setCursor(T0 - 2 * D);
  assert.equal(clock.mode, 'replay');
  assert.deepEqual(clock.range(), { start: T0 - 9 * D, end: T0 - 2 * D });
  assert.equal(cursorText(clock.getState()), '17.9.2026 12:00 UTC');
  clock.scrub(0.5);
  assert.equal(clock.getState().cursor, T0 - 9 * D + 3.5 * D, 'scrub počíta z rozsahu pred posunom');
  clock.setCursor(TIMELINE_SINCE_MS - 5 * D);
  assert.equal(clock.getState().cursor, TIMELINE_SINCE_MS, 'nie pred 24. 2. 2022');
  clock.setCursor(T0 - D);
  clock.play();
  assert.equal(clock.playing, true);
  assert.equal(clock.tick(1000), true);
  assert.equal(clock.getState().cursor, T0 - D + 6 * H, '6 h za sekundu');
  clock.setSpeed('1d');
  clock.tick(500);
  assert.equal(clock.getState().cursor, T0 - D + 6 * H + 12 * H);
  assert.equal(clock.tick(0), false);
  clock.tick(100_000);
  assert.equal(clock.mode, 'live', 'na konci späť do LIVE');
  assert.equal(clock.playing, false);
  assert.ok(reasons.includes('end'));
  clock.play();
  assert.equal(clock.mode, 'replay', 'play z LIVE začne okno dozadu');
  assert.equal(clock.getState().cursor, T0 - 7 * D);
  clock.pause();
  clock.step(-1);
  assert.equal(clock.getState().cursor, T0 - 14 * D);
  clock.step(+1);
  clock.step(+1);
  assert.equal(clock.mode, 'live', 'krok dopredu za teraz = LIVE');
  clock.setMode('replay');
  assert.equal(clock.mode, 'replay');
  clock.setMode('live');
  assert.equal(clock.mode, 'live');
});

test('histogram: hodiny z udalostí pri krátkom okne, dni zo súhrnu pri dlhom', () => {
  const range = { start: T0 - D, end: T0 };
  const events = [{ t: T0 - 23 * H, severity: 'critical' }, { t: T0 - 23 * H + 60_000, severity: 'minor' }, { t: T0 - H }, { t: T0 - 5 * D }];
  const h = histogramBins(range, events, null, { bins: 24 });
  assert.equal(h.bins.length, 24);
  assert.equal(h.bins[1].count, 2, 'T0−23 h je druhá hodina okna');
  assert.equal(h.bins[1].critical, 1);
  assert.equal(h.bins[23].count, 1);
  assert.equal(h.max, 2);
  const long = { start: T0 - 30 * D, end: T0 };
  const summary = { '2026-09-18': { viina: 80, geoconfirmed: 5, media: 10, critical: 20 }, '2026-08-01': { viina: 50 }, '2026-09-19': { viina: 3 } };
  const s = histogramBins(long, events, summary, { bins: 30 });
  assert.equal(s.max, 98, '18. a 19. 9. (12:00) padnú do posledného koša 30-dňového pásu');
  assert.equal(s.bins[28].count + s.bins[29].count, 98, '18. a 19. 9. padnú do posledných košov');
  assert.equal(s.bins.reduce((n, b) => n + b.critical, 0), 20);
});
