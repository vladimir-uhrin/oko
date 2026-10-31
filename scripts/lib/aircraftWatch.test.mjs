// scripts/lib/aircraftWatch.test.mjs — strážca lietadiel verejných činiteľov (2026-11-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA_REPEAT_MS, LOST_AFTER_MS, formatWatchEvent, isWatchWorthy, nearestAirport, observationFromAdsb, stepArea, stepTracked,
} from './aircraftWatch.mjs';

const T0 = Date.UTC(2026, 10, 1, 13, 0);
const SPLIT = [43.5389, 16.298];
const ac = (o = {}) => ({ hex: '440100', flight: 'SKV555  ', r: 'OE-EJJ', t: 'PC12', lat: 43.56, lon: 16.31, alt_baro: 2000, alt_geom: 2100, gs: 160, track: 350, baro_rate: 1500, seen_pos: 2, ...o });

test('záznam adsb.fi → pozorovanie: stopy na metre, zem, oneskorenie polohy, bez polohy nič', () => {
  const o = observationFromAdsb(ac(), T0);
  assert.deepEqual(o, { hex: '440100', callsign: 'SKV555', reg: 'OE-EJJ', type: 'PC12', t: T0 - 2000, lat: 43.56, lon: 16.31, altM: 640, onGround: false, gsKt: 160, track: 350, climbFpm: 1500 });
  const g = observationFromAdsb(ac({ alt_baro: 'ground', alt_geom: undefined, hex: '~440100' }), T0);
  assert.equal(g.onGround, true);
  assert.equal(g.altM, 0);
  assert.equal(g.hex, '440100');
  assert.equal(observationFromAdsb(ac({ lat: undefined }), T0), null);
});

test('sledovaný stroj: zem → vzlet zo Splitu raz, krátky výpadok nič, dlhý výpadok nízko = pristátie pri Bratislave', () => {
  let s = stepTracked(undefined, null, T0);
  assert.equal(s.state.phase, 'ground');
  assert.deepEqual(s.events, []);

  s = stepTracked(s.state, observationFromAdsb(ac(), T0), T0);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].type, 'vzlet');
  assert.equal(s.events[0].firstSeen, false);
  assert.equal(s.events[0].from.icao, 'LDSP');

  s = stepTracked(s.state, observationFromAdsb(ac({ lat: 45, lon: 16.8, alt_geom: 25000 }), T0 + 30 * 60_000), T0 + 30 * 60_000);
  assert.deepEqual(s.events, [], 'ďalší bod vo vzduchu nie je udalosť');

  const lastT = T0 + 75 * 60_000;
  s = stepTracked(s.state, observationFromAdsb(ac({ lat: 48.15, lon: 17.22, alt_geom: 1200, baro_rate: -700, seen_pos: 0 }), lastT), lastT);
  assert.deepEqual(stepTracked(s.state, null, lastT + LOST_AFTER_MS - 1000).events, [], 'výpadok kratší ako hranica nie je pristátie');
  const end = stepTracked(s.state, null, lastT + LOST_AFTER_MS + 1000);
  assert.equal(end.events.length, 1);
  assert.equal(end.events[0].type, 'pristatie');
  assert.equal(end.events[0].sure, false);
  assert.equal(end.events[0].airport.icao, 'LZIB');
  assert.equal(end.state.phase, 'ground');
});

test('sledovaný stroj: už vo vzduchu pri štarte, zem v dátach = isté pristátie, zmiznutie vysoko = strata signálu', () => {
  let s = stepTracked(undefined, observationFromAdsb(ac({ lat: 46, lon: 17, alt_geom: 26000 }), T0), T0);
  assert.equal(s.events[0].type, 'vzlet');
  assert.equal(s.events[0].firstSeen, true);
  assert.equal(s.events[0].from, null, 'prvý bod vysoko (FL260 pri Záhrebe) — letisko odletu sa nepripisuje');
  const ground = stepTracked(s.state, observationFromAdsb(ac({ lat: 48.171, lon: 17.214, alt_baro: 'ground' }), T0 + 3600_000), T0 + 3600_000);
  assert.equal(ground.events[0].type, 'pristatie');
  assert.equal(ground.events[0].sure, true);
  assert.equal(ground.events[0].airport.icao, 'LZIB');

  const high = stepTracked(s.state, null, T0 + LOST_AFTER_MS + 5000);
  assert.equal(high.events[0].type, 'strata_signalu');
  assert.equal(high.state.phase, 'unknown');
});

test('oblasť: ohlási stúpajúci biznis stroj pri Splite raz za 3 h; linku, klesajúci a vzdialený nie', () => {
  const area = { name: 'Split', center: SPLIT, radiusKm: 120 };
  const list = [
    ac({ hex: '4b1234', flight: 'HBX1', r: 'HB-XYZ', t: 'C56X' }),
    ac({ hex: '4ca111', flight: 'RYR12AB', r: 'EI-ABC', t: 'B738' }),
    ac({ hex: '3c0001', flight: 'DLH1709', r: 'D-AIZZ', t: 'A320' }),
    ac({ hex: '4b9999', flight: 'HBY2', t: 'PC24', baro_rate: -900 }),
    ac({ hex: '4b8888', flight: 'HBZ3', t: 'GLEX', lat: 46.5, lon: 16.3 }),
  ].map((a) => observationFromAdsb(a, T0));
  const first = stepArea({}, list, area, T0);
  assert.deepEqual(first.events.map((e) => e.hex), ['4b1234']);
  assert.equal(first.events[0].type, 'odlet_z_oblasti');
  assert.equal(stepArea(first.seen, list, area, T0 + 60_000).events.length, 0, 'opakovanie hneď nie');
  assert.equal(stepArea(first.seen, list, area, T0 + AREA_REPEAT_MS + 1).events.length, 1, 'po 3 h znova');
});

test('oblasť: sledovaný hex a vládny let SSG sa ohlásia aj s typom dopravného lietadla', () => {
  const area = { name: 'Split', center: SPLIT, radiusKm: 120 };
  const gov = observationFromAdsb(ac({ hex: '505c0a', flight: 'SSG04A', t: 'A319' }), T0);
  const tracked = observationFromAdsb(ac({ t: 'XXXX' }), T0);
  assert.equal(isWatchWorthy(gov), true);
  assert.equal(isWatchWorthy(tracked, ['440100']), true);
  assert.equal(isWatchWorthy(tracked), false);
  assert.deepEqual(stepArea({}, [gov, tracked], area, T0, ['440100']).events.map((e) => e.hex), ['505c0a', '440100']);
});

test('najbližšie letisko a text udalosti po slovensky', () => {
  assert.equal(nearestAirport(SPLIT).icao, 'LDSP');
  assert.equal(nearestAirport([0, 0]), null);
  const e = stepTracked({ phase: 'ground' }, observationFromAdsb(ac({ seen_pos: 0 }), T0), T0).events[0];
  const line = formatWatchEvent(e);
  assert.match(line, /^VZLET SKV555 · OE-EJJ · PC12 1\. 11\. 14:00 — Split LDSP \(\d+ km\), 640 m, kurz 350°$/);
});
