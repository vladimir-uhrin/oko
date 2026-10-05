// src/data/flightEstimate.test.mjs — odhadovaná poloha lietadla bez signálu (2026-10-04).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATE_MISSING_AFTER_S, ESTIMATE_NO_ROUTE_MAX_S, createEstimateTracker, estimatePosition, fixFromState,
  qualifiesForEstimate, uncertaintyKm,
} from './flightEstimate.js';
import { greatCircleKm } from './routePlausible.js';

const T0 = 1_791_000_000; // s
// Lietadlo nad Írskom smerom na západ (Atlantik), FL370, 240 m/s.
const state = (hex, lon, lat, { t = T0, alt = 11_300, gs = 240, trk = 270, ground = false, cs = 'DLH400' } = {}) =>
  [hex, `${cs}  `, 'Germany', t, t, lon, lat, alt, ground, gs, trk, 0, null, alt + 50, '1000', false, 0, 3];
const JFK = { code: 'JFK', icao: 'KJFK', name: 'New York', lat: 40.6413, lon: -73.7781, country: 'US' };
const FRA = { code: 'FRA', icao: 'EDDF', name: 'Frankfurt', lat: 50.0379, lon: 8.5622, country: 'DE' };
const ROUTE = { origin: FRA, destination: JFK, airline: 'Lufthansa', callsignIata: 'LH400' };

test('kto dostane odhad: len vo vzduchu, vysoko a rýchlo', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  assert.equal(qualifiesForEstimate(fix), true);
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { ground: true }), T0)), false, 'na zemi nie');
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { alt: 1200 }), T0)), false, 'nízko (pristáva/štartuje) nie');
  assert.equal(qualifiesForEstimate(fixFromState(state('a', -10, 53, { gs: 60 }), T0)), false, 'pomaly (vrtuľník) nie');
  assert.equal(fix.cs, 'DLH400');
  assert.equal(fix.altM, 11_350, 'geometrická výška má prednosť');
});

test('so známym cieľom letí po veľkej kružnici k cieľu poslednou rýchlosťou a pri cieli skončí', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  const totalKm = greatCircleKm(53, -10, JFK.lat, JFK.lon);
  const oneHour = estimatePosition(fix, ROUTE, (T0 + 3600) * 1000);
  assert.equal(oneHour.method, 'route');
  assert.ok(Math.abs(oneHour.distanceKm - 864) < 1, 'za hodinu 240 m/s = 864 km');
  // Prechod z posledného kurzu na trasu (45 → 150 min): po 30 min ešte presne v poslednom kurze,
  // po 3 h už na kružnici k cieľu.
  const halfHour = estimatePosition(fix, ROUTE, (T0 + 1800) * 1000);
  const straight = estimatePosition(fix, null, (T0 + 1800) * 1000);
  assert.ok(greatCircleKm(halfHour.lat, halfHour.lon, straight.lat, straight.lon) < 0.5, 'prvých 45 min drží posledný kurz');
  const threeHours = estimatePosition(fix, ROUTE, (T0 + 3 * 3600) * 1000);
  const leftKm = greatCircleKm(threeHours.lat, threeHours.lon, JFK.lat, JFK.lon);
  assert.ok(Math.abs(leftKm - (totalKm - 3 * 864)) < 2, 'po prechode leží na kružnici k cieľu');
  assert.ok(oneHour.lon < -10 && oneHour.lon > -40, 'nad Atlantikom smerom na západ');
  assert.equal(oneHour.ended, false);
  assert.ok(oneHour.uncertaintyKm > 60 && oneHour.uncertaintyKm < 80, 'neistota rastie so vzdialenosťou');
  const arrived = estimatePosition(fix, ROUTE, (T0 + Math.ceil(totalKm * 1000 / 240) + 10) * 1000);
  assert.equal(arrived.ended, true);
  assert.equal(arrived.reason, 'arrived');
  const near = estimatePosition(fix, ROUTE, (T0 + Math.floor((totalKm - 100) * 1000 / 240)) * 1000);
  assert.ok(near.altM < fix.altM, 'posledných 200 km klesá');
});

test('bez cieľa (alebo s nezmyselnou trasou) letí v poslednom smere najviac 2 hodiny', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  const est = estimatePosition(fix, null, (T0 + 1800) * 1000);
  assert.equal(est.method, 'track');
  assert.ok(Math.abs(est.lat - 53) < 0.6 && est.lon < -15, 'na západ po kružnici');
  assert.equal(estimatePosition(fix, null, (T0 + ESTIMATE_NO_ROUTE_MAX_S + 1) * 1000).ended, true);
  // Trasa opačným smerom (letí na západ, cieľ Frankfurt za chrbtom) sa nepoužije.
  const wrong = estimatePosition(fix, { origin: JFK, destination: FRA }, (T0 + 1800) * 1000);
  assert.equal(wrong.method, 'track', 'cieľ za chrbtom = trasa neplatí');
});

test('neistota: 5 km + 8 % preletenej vzdialenosti', () => {
  assert.equal(uncertaintyKm(0), 5);
  assert.equal(uncertaintyKm(1000), 85);
});

test('sledovač: zmiznuté lietadlo vo vzduchu ide do odhadov, návrat signálu ho vyradí; pristávajúce nie', () => {
  const tracker = createEstimateTracker();
  const world = (extra = [], t = T0) => ({ time: t, states: [...Array.from({ length: 200 }, (_, i) => state(`f${String(i).padStart(5, '0')}`, 10 + i * 0.01, 48, { t, cs: 'XXX1' })), ...extra] });
  tracker.ingest(world([state('3c6444', -10, 53), state('4b1805', 17.2, 48.17, { alt: 900, gs: 70 })]));
  // Ďalší snímok o 30 s bez nich — ešte nie je „bez signálu".
  assert.equal(tracker.ingest(world([], T0 + 30)), 0);
  assert.equal(tracker.list((T0 + 30) * 1000).length, 0);
  // Po ESTIMATE_MISSING_AFTER_S áno — ale len to vo výške, nie pristávajúce nízko a pomaly.
  assert.equal(tracker.ingest(world([], T0 + ESTIMATE_MISSING_AFTER_S + 10)), 1);
  const list = tracker.list((T0 + 200) * 1000);
  assert.deepEqual(list.map((e) => e.hex), ['3c6444']);
  assert.equal(list[0].route, null);
  // Signál sa vrátil.
  tracker.ingest(world([state('3c6444', -25, 52, { t: T0 + 3600 })], T0 + 3600));
  assert.equal(tracker.list((T0 + 3600) * 1000).length, 0);
});

test('sledovač: polovičný snímok (výpadok, regionálna záloha) nevyrobí falošné odhady', () => {
  const tracker = createEstimateTracker();
  const many = (t, n) => ({ time: t, states: Array.from({ length: n }, (_, i) => state(`a${String(i).padStart(5, '0')}`, -20 + i * 0.001, 50, { t })) });
  tracker.ingest(many(T0, 1000));
  assert.equal(tracker.ingest(many(T0 + 600, 100)), 0, 'tretina snímku = nič nezmizlo');
  assert.equal(tracker.list((T0 + 600) * 1000).length, 0);
  assert.equal(tracker.status().skippedPartial, 1);
  assert.equal(tracker.ingest(many(T0 + 600, 1000)), 0, 'starší alebo rovnaký čas snímku sa ignoruje');
});

test('sledovač: trasu dohľadá pre volací znak dopravcu; pri cieli vyradí, inak ju pošle s odhadom', async () => {
  const lookups = [];
  const tracker = createEstimateTracker({ lookupGapMs: 0, lookupRoute: async (cs) => { lookups.push(cs); return cs === 'DLH400' ? ROUTE : { origin: FRA, destination: { ...FRA, code: 'XXX', lat: 53.02, lon: -10.02 } }; } });
  const snap = (t, extra) => ({ time: t, states: [...Array.from({ length: 50 }, (_, i) => state(`b${String(i).padStart(5, '0')}`, 5, 45 + i * 0.01, { t, cs: 'N12345' })), ...extra] });
  tracker.ingest(snap(T0, [state('3c6444', -10, 53), state('aaaaaa', -10, 53, { cs: 'EIN105' })]));
  tracker.ingest(snap(T0 + 300, []));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(lookups.sort(), ['DLH400', 'EIN105'], 'len volacie znaky dopravcov');
  const list = tracker.list((T0 + 400) * 1000);
  assert.deepEqual(list.map((e) => e.hex), ['3c6444'], 'EIN105 má cieľ 2 km od poslednej polohy = pristáva, vyradený');
  assert.equal(list[0].route.destination.code, 'JFK');
});

test('naplnenie zo záznamu po štarte: vo vzduchu áno, živé v snímku vypadne, staré bez cieľa nie', () => {
  const tracker = createEstimateTracker();
  const nowMs = (T0 + 600) * 1000;
  const seeded = tracker.seed([
    fixFromState(state('3c6444', -20, 52, { t: T0 }), T0),
    fixFromState(state('4b1805', 17, 48, { t: T0 }), T0), // o chvíľu živé
    fixFromState(state('aaaaaa', -30, 50, { t: T0 - 3 * 3600 }), T0 - 3 * 3600), // 3 h bez cieľa = už neplatí
    { ...fixFromState(state('bbbbbb', -25, 51, { t: T0 }), T0), onGround: true },
  ], nowMs);
  assert.equal(seeded, 2);
  const snap = { time: T0 + 600, states: [state('4b1805', 17.1, 48.1, { t: T0 + 600 }), ...Array.from({ length: 20 }, (_, i) => state(`c${String(i).padStart(5, '0')}`, 5, 45, { t: T0 + 600 }))] };
  tracker.ingest(snap);
  assert.deepEqual(tracker.list(nowMs).map((f) => f.hex), ['3c6444'], 'živé lietadlo zo záznamu vypadne');
});

test('dlhý prelet bez cieľa: kým cieľ čaká v rade, nezobrazí sa, ale ani nezahodí; po dohľadaní letí k cieľu', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const tracker = createEstimateTracker({ lookupGapMs: 0, lookupRoute: async () => { await gate; return ROUTE; } });
  const nowMs = (T0 + 3 * 3600) * 1000; // 3 h bez signálu — bez cieľa by už skončil
  tracker.seed([fixFromState(state('3c6444', -10, 53), T0)], nowMs);
  assert.equal(tracker.list(nowMs).length, 0, 'bez cieľa sa po 2 h nezobrazuje');
  assert.equal(tracker.status().estimated, 1, 'ale čaká na cieľ');
  release();
  await new Promise((r) => setTimeout(r, 10));
  const list = tracker.list(nowMs);
  assert.equal(list.length, 1, 'po dohľadaní cieľa letí ďalej');
  assert.equal(list[0].route.destination.code, 'JFK');
});

test('bez cieľa a pri strate signálu klesalo: odhad najviac 20 min (pristáva mimo pokrytia); s cieľom ako predtým', () => {
  const base = fixFromState(state('3c6444', 20, 5, { cs: 'N123AB' }), T0); // nad Afrikou, bez cieľa
  const descending = { ...base, vrMps: -6 };
  assert.equal(estimatePosition(descending, null, (T0 + 15 * 60) * 1000).ended, false);
  assert.equal(estimatePosition(descending, null, (T0 + 21 * 60) * 1000).ended, true, 'po 20 min koniec');
  assert.equal(estimatePosition({ ...base, vrMps: -1 }, null, (T0 + 60 * 60) * 1000).ended, false, 'mierne klesanie = let pokračuje');
  assert.equal(estimatePosition(base, null, (T0 + 60 * 60) * 1000).ended, false, 'vo výške 2 h');
});

test('fronta cieľov: odložené dohľadanie ({ limited }) nie je „cieľ neexistuje" — skúsi sa znova, bez záplavy dopytov', async () => {
  const calls = [];
  let limited = true;
  const tracker = createEstimateTracker({
    lookupGapMs: 0, limitedWaitMs: 15,
    lookupRoute: async (cs) => { calls.push(cs); return limited ? { limited: true } : ROUTE; },
  });
  tracker.seed([fixFromState(state('3c6444', -10, 53), T0)], (T0 + 600) * 1000);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(calls.length >= 2 && calls.length <= 5, `počas odkladu len občasný pokus (${calls.length})`);
  assert.equal(tracker.status().queue + 1 >= 1, true);
  assert.equal(tracker.list((T0 + 600) * 1000)[0].route, null, 'zatiaľ bez cieľa, ale stále čaká');
  limited = false;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(tracker.list((T0 + 600) * 1000)[0].route.destination.code, 'JFK', 'po uvoľnení cieľ dostane');
  const settled = calls.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, settled, 'po vybavení sa už nepýta');
});

test('meranie presnosti: len ten istý let v cestovnej výške (nie nový let po pristátí)', () => {
  const samples = [];
  const tracker = createEstimateTracker({ onAccuracy: (x) => samples.push(x) });
  const crowd = (t) => Array.from({ length: 30 }, (_, i) => state(`d${String(i).padStart(5, '0')}`, 5, 45 + i * 0.01, { t, cs: 'N1' }));
  const lose = (hex, cs) => {
    tracker.ingest({ time: T0, states: [...crowd(T0), state(hex, -10, 53, { cs })] });
    tracker.ingest({ time: T0 + 300, states: crowd(T0 + 300) });
  };
  lose('aaa111', 'DLH400');
  tracker.ingest({ time: T0 + 5400, states: [...crowd(T0 + 5400), state('aaa111', 8, 50, { t: T0 + 5400, cs: 'DLH401' })] });
  assert.equal(samples.length, 0, 'iný volací znak = nový let');
  const t2 = createEstimateTracker({ onAccuracy: (x) => samples.push(x) });
  t2.ingest({ time: T0, states: [...crowd(T0), state('bbb222', -10, 53)] });
  t2.ingest({ time: T0 + 300, states: crowd(T0 + 300) });
  t2.ingest({ time: T0 + 5400, states: [...crowd(T0 + 5400), state('bbb222', -9, 53, { t: T0 + 5400, alt: 900 })] });
  assert.equal(samples.length, 0, 'nízko po štarte = nový let');
  const t3 = createEstimateTracker({ onAccuracy: (x) => samples.push(x) });
  t3.ingest({ time: T0, states: [...crowd(T0), state('ccc333', -10, 53)] });
  t3.ingest({ time: T0 + 300, states: crowd(T0 + 300) });
  t3.ingest({ time: T0 + 1800, states: [...crowd(T0 + 1800), state('ccc333', -16, 53, { t: T0 + 1800 })] });
  assert.equal(samples.length, 1, 'ten istý let v cestovnej výške sa meria');
});

test('vietor nabieha postupne: po 10 min takmer bez vplyvu, po 3 h naplno', () => {
  const fix = fixFromState(state('3c6444', -10, 53), T0);
  const model = { gsEffMps: 280, path: null, toDestination: false, nat: null };
  const at = (min) => estimatePosition(fix, null, (T0 + min * 60) * 1000, model).distanceKm;
  const plain = (min) => estimatePosition(fix, null, (T0 + min * 60) * 1000).distanceKm;
  assert.ok(at(10) - plain(10) < 3, 'po 10 min rozdiel pár km');
  assert.ok(at(180) - plain(180) > 300, 'po 3 h +40 m/s takmer naplno');
});
