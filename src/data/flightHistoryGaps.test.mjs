// src/data/flightHistoryGaps.test.mjs — lety cez diery v pokrytí (2026-09-30). Naživo: vládny A319 letel
// Shannon → Newark a Newark → Bratislava, v zozname však boli štyri polovice („SNN → neznáme",
// „neznáme → EWR"…), lebo nad Atlantikom nie sú prijímače a denné stopy končia o polnoci UTC.
// Testy SPRÁVANIA: jeden let ostane jedným letom (živý záznam, import, oprava starých úsekov),
// medzipristátie ich nespojí, stav archívu nehlási spätný import ako začiatok záznamu a
// prehrávanie doplní dieru odhadom po veľkej kružnici (označeným), nič sa pritom nevymyslí do archívu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { traceToFlight } from './adsblolTrace.js';
import { bridgeCoverageGaps, greatCirclePoint, interpolateFix, trackSummary } from './flightHistory.js';
import { AIR_GAP_MAX_S, continuesInAir, openFlightHistory } from './flightHistoryStore.js';

const T0 = Date.UTC(2026, 8, 20, 16, 0) / 1000;
// Shannon → Newark: posledná poloha pred Atlantikom a prvá za ním (4 h bez pokrytia).
const BEFORE = { t: T0 + 3300, lat: 54.0, lon: -15.0, alt: 11_000, gs: 240, gnd: false };
const AFTER = { t: T0 + 3300 + 4 * 3600, lat: 46.0, lon: -54.0, alt: 11_300, gs: 235, gnd: false };

test('pokračuje let cez dieru? oceán v cestovnej výške áno; pristátie, medzipristátie, nízko, priveľa hodín nie; polnoc UTC áno', () => {
  assert.equal(continuesInAir(BEFORE, AFTER), true, 'Atlantik: 2 700 km za 4 h pri ~240 m/s');
  assert.equal(continuesInAir(BEFORE, { ...AFTER, gnd: true }), false, 'na zemi = pristál');
  assert.equal(continuesInAir(BEFORE, { ...AFTER, lat: 53.0, lon: -25.0 }), false, 'príliš krátka vzdialenosť za 4 h = medzipristátie');
  assert.equal(continuesInAir({ ...BEFORE, alt: 3000 }, AFTER), false, 'nízko = priblíženie alebo vzlet');
  assert.equal(continuesInAir(BEFORE, { ...AFTER, t: BEFORE.t + AIR_GAP_MAX_S + 1 }), false);
  const midnight = { t: T0 + 100, lat: 50, lon: 10, alt: 2500, gs: 120, gnd: false };
  assert.equal(continuesInAir(midnight, { ...midnight, t: T0 + 101, lat: 50.001 }), true, 'polnoc UTC medzi dennými stopami');
  assert.equal(continuesInAir(midnight, { ...midnight, t: T0 + 101, lat: 51 }), false, '110 km za sekundu nie je ten istý let');
  assert.equal(continuesInAir(null, AFTER), false);
});

const osRow = (icao, cs, t, lat, lon, alt, gs = 240, gnd = false) => [icao, cs, 'Slovakia', t, t, lon, lat, alt, gnd, gs, 270, 0, null, alt + 50, '1000', false, 0, 4];
const snapshot = (t, rows) => JSON.stringify({ time: t, states: rows });

test('živý záznam: let cez Atlantik ostane jedným úsekom; po pristátí a novom vzlete nový úsek', () => {
  let nowMs = (T0 + 86_400) * 1000;
  const store = openFlightHistory(':memory:', { now: () => nowMs });
  store.recordOpenSkyBody(snapshot(T0 + 3000, [osRow('505c06', 'SSG001', T0 + 3000, 53.8, -13.0, 10_800)]));
  store.recordOpenSkyBody(snapshot(BEFORE.t, [osRow('505c06', 'SSG001', BEFORE.t, BEFORE.lat, BEFORE.lon, BEFORE.alt)]));
  store.recordOpenSkyBody(snapshot(AFTER.t, [osRow('505c06', 'SSG001', AFTER.t, AFTER.lat, AFTER.lon, AFTER.alt, 235)]));
  assert.equal(store.flightsOf('505c06').length, 1, 'jeden let aj cez 4 h dieru nad oceánom');
  // Pristátie v Newarku (priblíženie v pokrytí, 20 min) a o 2 h nový let s tým istým volacím znakom = nový úsek.
  const land = AFTER.t + 1200;
  store.recordOpenSkyBody(snapshot(land, [osRow('505c06', 'SSG001', land, 40.69, -74.17, 0, 5, true)]));
  const again = land + 2 * 3600;
  store.recordOpenSkyBody(snapshot(again, [osRow('505c06', 'SSG001', again, 40.9, -73.5, 3000, 150)]));
  assert.equal(store.flightsOf('505c06').length, 2, 'medzipristátie let rozdelí');
  assert.deepEqual(store.recount(), { fixes: 5, legs: 2 });
  store.close();
});

const tracePoint = (sec, lat, lon, alt, { gs = 460, flags = 0, flight = null } = {}) =>
  [sec, lat, lon, alt, gs, 270, flags, 0, flight ? { flight } : null, 'adsb_icao', null, null, null, null];

test('import denných stôp: let cez polnoc UTC a let s dierou nad oceánom v stope sú jedným letom', () => {
  const store = openFlightHistory(':memory:');
  const day1 = Date.UTC(2026, 8, 24) / 1000;
  const day2 = day1 + 86_400;
  // Poradie ako spätný import: najprv novší deň, potom starší. Polohy a časy zodpovedajú letu
  // A319 (~240 m/s): Newark 21:00 UTC, nad Atlantikom bez pokrytia, Bratislava 04:00 UTC.
  store.importFlight(traceToFlight({ icao: '505c06', timestamp: day2, trace: [
    tracePoint(0, 50.5, -34.997, 36_000, { flight: 'SSG001' }), // ~200 m od poslednej polohy pred polnocou
    tracePoint(600, 50.8, -31.0, 36_000),
    tracePoint(3 * 3600 + 5 * 60, 49.5, 5.0, 36_000), // za dierou v pokrytí (~2 h 55 min, ~2 570 km)
    tracePoint(4 * 3600, 48.17, 17.21, 'ground', { gs: 10 }),
  ] }));
  store.importFlight(traceToFlight({ icao: '505c06', timestamp: day1, trace: [
    tracePoint(21 * 3600, 40.69, -74.17, 'ground', { gs: 5, flags: 2, flight: 'SSG001' }),
    tracePoint(21 * 3600 + 900, 41.5, -71.0, 20_000),
    tracePoint(86_399, 50.5, -35.0, 36_000), // za dierou (~2 h 45 min, ~2 900 km), tesne pred polnocou
  ] }));
  const flights = store.flightsOf('505c06');
  assert.equal(flights.length, 1, 'Newark → Bratislava je jeden let, nie štyri kúsky');
  assert.equal(flights[0].firstT, day1 + 21 * 3600);
  assert.equal(flights[0].lastT, day2 + 4 * 3600);
  assert.deepEqual(store.recount().legs, 1, 'počítadlo úsekov sedí so skutočnosťou');
  assert.equal(store.status().legs, 1);
  store.close();
});

test('oprava už uložených úsekov: polovice letu rozdelené starším kódom sa spoja, medzipristátie nie', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-gap-'));
  const file = path.join(dir, 'h.sqlite');
  let store = null;
  try {
    store = openFlightHistory(file, { retentionDays: 3650, rawHours: 87_600, now: () => (AFTER.t + 86_400) * 1000 });
    store.recordOpenSkyBody(snapshot(BEFORE.t, [osRow('505c06', 'SSG001', BEFORE.t, BEFORE.lat, BEFORE.lon, BEFORE.alt)]));
    store.close();
    // Druhá polovica ako samostatný úsek — tak, ako ju zapísal kód pred 2026-09-30.
    const raw = new DatabaseSync(file);
    raw.prepare(`INSERT INTO fixes (icao24, t, lat, lon, alt, gs, trk, vr, squawk, gnd, src) VALUES (?, ?, ?, ?, ?, ?, 2700, 0, '1000', 0, 'opensky')`)
      .run('505c06', AFTER.t, Math.round(AFTER.lat * 1e5), Math.round(AFTER.lon * 1e5), AFTER.alt, AFTER.gs * 10);
    raw.prepare(`INSERT INTO legs (icao24, callsign, country, first_t, last_t, fixes, max_alt, max_gs, squawks, src) VALUES ('505c06', 'SSG001', 'Slovakia', ?, ?, 1, ?, 235, '1000', 'opensky')`)
      .run(AFTER.t, AFTER.t, AFTER.alt);
    raw.exec("UPDATE meta SET value = value + 1 WHERE key IN ('fixes_count', 'legs_count')");
    raw.close();
    store = openFlightHistory(file, { retentionDays: 3650, rawHours: 87_600, now: () => (AFTER.t + 86_400) * 1000 });
    assert.equal(store.flightsOf('505c06').length, 2);
    assert.equal(store.mergeAirGaps('505c06'), 1, 'jeden spoj');
    const [flight] = store.flightsOf('505c06');
    assert.equal(flight.firstT, BEFORE.t);
    assert.equal(flight.lastT, AFTER.t);
    assert.equal(flight.fixes, 2);
    assert.deepEqual(store.recount(), { fixes: 2, legs: 1 });
    assert.equal(store.mergeAirGaps('505c06'), 0, 'opakovaná oprava nič nezmení');
  } finally {
    try { store?.close(); } catch { /* už zatvorené */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* dočasný priečinok */ }
  }
});

test('import cez dva živé kúsky toho istého letu: jeden let, nie päťminútový „let ?→?" vnútri iného', () => {
  // Naživo OM-BYA 10. 9. Malta → Bratislava: živý záznam zachytil 19:47–19:52 v cestovnej výške a po
  // hodinovej diere priblíženie (nový úsek), import celej stopy predĺžil len druhý kúsok.
  const day = Date.UTC(2026, 8, 10) / 1000;
  const at = (h, m, s = 0) => day + h * 3600 + m * 60 + s;
  const store = openFlightHistory(':memory:', { retentionDays: 3650, rawHours: 87_600, now: () => (day + 86_400) * 1000 });
  store.recordOpenSkyBody(snapshot(at(19, 47, 44), [osRow('505c06', 'SSG004', at(19, 47, 44), 41.757, 15.139, 12_207)]));
  store.recordOpenSkyBody(snapshot(at(19, 52, 39), [osRow('505c06', 'SSG004', at(19, 52, 39), 42.382, 15.160, 12_192)]));
  store.recordOpenSkyBody(snapshot(at(20, 55, 1), [osRow('505c06', 'SSG004', at(20, 55, 1), 48.05, 17.05, 800, 80)]));
  assert.equal(store.flightsOf('505c06').length, 2, 'živý záznam: dva kúsky (hodina bez záznamu, potom priblíženie)');
  const r = store.importFlight(traceToFlight({ icao: '505c06', timestamp: day, trace: [
    tracePoint(at(18, 31, 43) - day, 35.857, 14.477, 'ground', { gs: 5, flags: 2, flight: 'SSG004' }),
    tracePoint(at(18, 45) - day, 37.0, 14.8, 30_000),
    tracePoint(at(19, 30, 11) - day, 39.618, 14.981, 38_000),
    tracePoint(at(19, 50, 17) - day, 42.08, 15.163, 40_000),
    tracePoint(at(20, 30) - day, 46.5, 16.4, 30_000),
    tracePoint(at(20, 57, 22) - day, 48.17, 17.21, 'ground', { gs: 10 }),
  ] }));
  assert.equal(r.legsMerged, 1, 'kúsok vnútri predĺženého letu sa pripojil');
  const flights = store.flightsOf('505c06');
  assert.equal(flights.length, 1, 'Malta → Bratislava je jeden let');
  assert.equal(flights[0].firstT, at(18, 31, 43));
  assert.equal(flights[0].lastT, at(20, 57, 22));
  assert.equal(flights[0].fixes, 3 + 6, 'každý fix raz — počty sa sčítajú, nič dvakrát');
  assert.deepEqual(store.recount(), { fixes: 9, legs: 1 });
  assert.equal(store.status().legs, 1, 'počítadlo úsekov sedí');
  store.close();
});

test('stav archívu: začiatok živého záznamu sa nepohne spätným importom starších dní', () => {
  const live = Date.UTC(2026, 8, 8) / 1000;
  const store = openFlightHistory(':memory:', { retentionDays: 3650, now: () => (live + 86_400) * 1000 });
  store.recordOpenSkyBody(snapshot(live, [osRow('4b1805', 'SWR11H', live, 48.1, 17.2, 10_000)]));
  const old = Date.UTC(2023, 2, 1) / 1000;
  store.importFlight(traceToFlight({ icao: '505c06', timestamp: old, trace: [tracePoint(3600, 48.17, 17.21, 'ground', { flight: 'SSG004', flags: 2 }), tracePoint(4000, 48.3, 17.6, 9000)] }));
  const st = store.status();
  assert.equal(st.oldestT, old + 3600, 'najstarší fix je z importu');
  assert.equal(st.liveSinceT, live, 'živý záznam od 8. 9. 2026');
  store.close();
});

test('prehrávanie: diera nad oceánom sa doplní odhadom po veľkej kružnici (označeným), skutočné polohy ostanú', () => {
  const fixes = [
    { ...BEFORE, trk: 270, vr: 0, squawk: '1000' },
    { ...AFTER, trk: 250, vr: 0, squawk: '1000' },
    { t: AFTER.t + 60, lat: 45.9, lon: -54.9, alt: 11_300, gs: 235, trk: 250, vr: 0, squawk: '1000', gnd: false },
  ];
  const { fixes: bridged, gaps } = bridgeCoverageGaps(fixes);
  assert.equal(gaps, 1);
  const estimated = bridged.filter((f) => f.estimated);
  assert.ok(estimated.length >= 50, `~50 km krok na ~2 700 km: ${estimated.length} bodov`);
  assert.ok(estimated.every((f, i, arr) => i === 0 || f.t > arr[i - 1].t), 'čas plynie');
  assert.deepEqual(bridged.filter((f) => !f.estimated), fixes, 'skutočné polohy nezmenené');
  // Veľká kružnica na severe vedie severnejšie než priamka v stupňoch.
  const mid = estimated[Math.floor(estimated.length / 2)];
  assert.ok(mid.lat > (BEFORE.lat + AFTER.lat) / 2 + 1, `stred po veľkej kružnici ${mid.lat.toFixed(2)}° s. š.`);
  const sample = interpolateFix(bridged, (BEFORE.t + AFTER.t) / 2);
  assert.equal(sample.estimated, true, 'vzorka nad dierou je odhad');
  assert.equal(interpolateFix(bridged, AFTER.t + 30).estimated, false, 'za dierou meranie');
  // Krátka diera ani let po pristátí sa nedopĺňajú.
  assert.equal(bridgeCoverageGaps([{ ...BEFORE }, { ...BEFORE, t: BEFORE.t + 300, lat: 54.1 }]).gaps, 0);
  assert.equal(bridgeCoverageGaps([{ ...BEFORE }, { ...AFTER, gnd: true }]).gaps, 0);
  // Súhrn letu (vzdialenosť) je rovnaký — počíta sa po veľkej kružnici aj bez odhadu.
  assert.ok(Math.abs(trackSummary(bridged).distanceKm - trackSummary(fixes).distanceKm) < 5);
  const eq = greatCirclePoint({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 0.5);
  assert.ok(Math.abs(eq.lat) < 1e-9 && Math.abs(eq.lon - 45) < 1e-9);
});
