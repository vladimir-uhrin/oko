// src/data/flightHistoryStore.test.mjs
// Serverové úložisko histórie letov (2026-09-07) — in-memory SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEG_GAP_S,
  fixFromAdsbLolAircraft,
  fixFromOpenSkyRow,
  normalizeSearchQuery,
  openFlightHistory,
} from './flightHistoryStore.js';

const T0 = 1_757_000_000;
function openSkyBody(time, rows) {
  return JSON.stringify({ time, states: rows });
}
// OpenSky row: [icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt, on_ground, velocity, track, vr, sensors, geo_alt, squawk]
const row = (icao, cs, t, lon, lat, alt, gs = 230, trk = 90, vr = 0, squawk = '1000', gnd = false) => [icao, cs, 'Slovakia', t, t, lon, lat, alt, gnd, gs, trk, vr, null, alt + 30, squawk];

test('fix z OpenSky riadku: normalizovaný hex a volací znak, čas z time_position, bez polohy null', () => {
  const f = fixFromOpenSkyRow(row('4B1805', 'swr11h ', T0, 17.2, 48.1, 10000), T0 + 5);
  assert.equal(f.icao24, '4b1805');
  assert.equal(f.callsign, 'SWR11H');
  assert.equal(f.t, T0);
  assert.equal(f.alt, 10000);
  assert.equal(f.squawk, '1000');
  assert.equal(fixFromOpenSkyRow(['abc123', 'X', 'Y', null, null, null, null], T0), null, 'bez polohy nič');
  assert.equal(fixFromOpenSkyRow(['abc123', 'X', 'Y', null, null, 1, 2, null], T0 + 9).t, T0 + 9, 'bez time_position čas odpovede');
});

test('fix z adsb.lol ac: stopy → m, kt → m/s, ft/min → m/s, ground = 0 m, čas mínus seen_pos', () => {
  const f = fixFromAdsbLolAircraft({ hex: 'AE0940', flight: 'RCH123 ', lat: 50, lon: 10, alt_baro: 32000, gs: 450, track: 270, baro_rate: -1000, squawk: '4501', seen_pos: 4.2 }, 1000);
  assert.equal(f.icao24, 'ae0940');
  assert.equal(f.callsign, 'RCH123');
  assert.ok(Math.abs(f.alt - 9753.6) < 0.01);
  assert.ok(Math.abs(f.gs - 231.5) < 0.01);
  assert.ok(Math.abs(f.vr + 5.08) < 0.01);
  assert.equal(f.t, 996);
  const g = fixFromAdsbLolAircraft({ hex: '~adf123', lat: 1, lon: 2, alt_baro: 'ground' }, 1000);
  assert.equal(g.icao24, 'adf123', 'tilda TIS-B prefix preč');
  assert.equal(g.alt, 0);
  assert.equal(g.gnd, 1);
  assert.equal(fixFromAdsbLolAircraft({ hex: 'abc' }, 1000), null);
});

test('dopyt: 6 hex = hex, inak volací znak veľkými bez LIKE zástupných znakov', () => {
  assert.deepEqual(normalizeSearchQuery('4b1805'), { text: '4B1805', hex: '4b1805' });
  assert.deepEqual(normalizeSearchQuery(' swr1%_ '), { text: 'SWR1', hex: null });
  assert.deepEqual(normalizeSearchQuery(''), { text: '', hex: null });
});

test('záznam: duplicitný snímok sa ignoruje, úseky rastú, zmena volacieho znaku alebo medzera zakladá nový úsek', () => {
  let nowMs = (T0 + 100) * 1000;
  const store = openFlightHistory(':memory:', { now: () => nowMs });
  const body1 = openSkyBody(T0, [row('4b1805', 'SWR11H', T0, 17.2, 48.1, 10000, 230, 90, 0, '1000'), row('3c6444', 'DLH123', T0, 8.5, 50.0, 11000, 240, 180, -5, '7700')]);
  assert.equal(store.recordOpenSkyBody(body1), 2);
  assert.equal(store.recordOpenSkyBody(body1), 0, 'cache HIT toho istého snímku sa nezapíše');
  // ďalší poll o 30 s
  assert.equal(store.recordOpenSkyBody(openSkyBody(T0 + 30, [row('4b1805', 'SWR11H', T0 + 30, 17.3, 48.2, 10200, 232, 91, 3, '1000')])), 1);
  let legs = store.search('SWR');
  assert.equal(legs.length, 1);
  assert.equal(legs[0].fixes, 2);
  assert.equal(legs[0].firstT, T0);
  assert.equal(legs[0].lastT, T0 + 30);
  assert.equal(legs[0].maxAltM, 10200);
  assert.deepEqual(legs[0].squawks, ['1000']);
  // ten istý drak, nový volací znak → nový úsek
  store.recordOpenSkyBody(openSkyBody(T0 + 60, [row('4b1805', 'SWR22K', T0 + 60, 17.4, 48.3, 9000)]));
  assert.equal(store.search('4b1805').length, 2, 'dva úseky jedného draku');
  assert.equal(store.search('4b1805')[0].callsign, 'SWR22K', 'najnovší prvý');
  // medzera > LEG_GAP_S s tým istým znakom → nový úsek
  store.recordOpenSkyBody(openSkyBody(T0 + 60 + LEG_GAP_S + 5, [row('4b1805', 'SWR22K', T0 + 60 + LEG_GAP_S + 5, 17.5, 48.4, 9000)]));
  assert.equal(store.search('4b1805').length, 3);
  // squawk poplach sa v úseku zachová ako zoznam
  const dlh = store.search('DLH1')[0];
  assert.deepEqual(dlh.squawks, ['7700']);
  assert.equal(dlh.country, 'Slovakia');
  // trasa: chronologicky, kompaktne, v okne
  const track = store.track('4b1805', { fromS: T0, toS: T0 + 30 });
  assert.equal(track.length, 2);
  assert.deepEqual(track[0].slice(0, 4), [T0, 48.1, 17.2, 10000], 'lat/lon × 1e5 sa vrátia presne na 5 desatinných');
  assert.equal(track[1][4], 232);
  assert.equal(track[1][5], 91);
  assert.equal(track[1][6], 3);
  assert.deepEqual(store.track('zzz'), [], 'nehex = prázdne');
  // status
  const st = store.status();
  assert.equal(st.fixes, 5);
  assert.equal(st.legs, 4);
  assert.equal(st.oldestT, T0);
  assert.ok(st.bytes >= 0 && st.rawHours === 24 && st.thinStepS === 120);
  // preriedenie: fixy staršie než 24 h, ale v retencii, ostanú len ~1 na 120 s okno
  const dense = [];
  for (let i = 0; i < 20; i += 1) dense.push(row('aaaaaa', 'THIN1', T0 + 10 + i * 30, 10 + i * 0.01, 50, 8000));
  store.recordOpenSkyBody(openSkyBody(T0 + 10, dense));
  assert.equal(store.track('aaaaaa').length, 20, 'v prvých 24 h plný záznam');
  nowMs = (T0 + 2 * 86_400) * 1000;
  store.prune();
  const thinned = store.track('aaaaaa').length;
  assert.ok(thinned >= 4 && thinned <= 6, `preriedené na ~1/120 s: ${thinned}`);
  // retencia: posuň čas o 8 dní, prune zmaže všetko staršie než 7 dní
  nowMs = (T0 + 8 * 86_400) * 1000;
  assert.ok(store.prune() > 0);
  assert.equal(store.status().fixes, 0);
  store.close();
});

test('adsb.lol mil telo sa zapisuje s vlastným zdrojom; bez dopytu vráti vyhľadávanie najnovšie úseky s ≥ 3 fixmi', () => {
  const store = openFlightHistory(':memory:', { now: () => 2_000_000 * 1000 });
  const mk = (seen) => JSON.stringify({ now: (2_000_000 - 0) * 1000, ac: [{ hex: 'ae0940', flight: 'RCH123', lat: 50, lon: 10 + seen / 100, alt_baro: 30000, gs: 400, track: 90, seen_pos: seen }] });
  assert.equal(store.recordAdsbLolBody(mk(60)), 1);
  assert.equal(store.recordAdsbLolBody(mk(30)), 1);
  assert.equal(store.recordAdsbLolBody(mk(0)), 1);
  const all = store.search('');
  assert.equal(all.length, 1);
  assert.equal(all[0].src, 'adsb.lol/mil');
  assert.equal(all[0].fixes, 3);
  assert.equal(store.search('', { sinceS: 2_000_000 + 1 }).length, 0, 'okno since');
  store.close();
});

test('tripwire: proxy zapisuje odpovede OpenSky aj adsb.lol/mil a vystavuje /api/history; DB je v .gev-cache (gitignored)', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function flightHistoryProxy\(\)/);
  assert.match(vite, /recordOpenSkyBody\(/);
  assert.match(vite, /recordAdsbLolBody\(/);
  assert.match(vite, /middlewares\.use\('\/api\/history'/);
  const plugins = vite.slice(vite.indexOf('    plugins: ['));
  assert.ok(
    plugins.indexOf('flightHistoryProxy(),') < plugins.indexOf('openSkyProxy(),')
      && plugins.indexOf('flightHistoryProxy(),') < plugins.indexOf('adsbLolProxy(),'),
    'záznamový obal musí byť zaregistrovaný PRED OpenSky a adsb.lol proxy (poradie middleware)',
  );
  assert.match(vite, /'\.gev-cache', 'flight-history\.sqlite'/);
  const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^\.gev-cache\/?$/m);
});
