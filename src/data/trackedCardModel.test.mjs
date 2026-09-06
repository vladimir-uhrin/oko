// src/data/trackedCardModel.test.mjs
// Štruktúrovaný model karty sledovaného letu (2026-09-05): titulok = volací
// znak (+ IATA číslo) s vlajkou registrácie, letový riadok s kurzom a
// stúpaním, riadky ostávajú reťazce, trasa a progres (so zostatkom a hodinou
// príletu) sú vlastné riadky, footer nesie zdroj/vek fixu/squawk/hex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACKED_FLIGHT_ACCENT,
  buildTrackedCardModel,
  routeRowFromRoute,
  progressRowFromProgress,
  formatFlightLine,
  formatVerticalRate,
  formatTrack,
  formatFixAge,
  formatEtaClock,
  formatMetaLine,
  formatThousands,
} from './trackedCardModel.js';

const ROUTE = {
  origin: { code: 'CDG', name: 'Paris', country: 'FR', lat: 49.01, lon: 2.55 },
  destination: { code: 'ABJ', name: 'Abidjan', country: 'CI', lat: 5.26, lon: -3.93 },
};
const NOW = Date.UTC(2026, 8, 5, 16, 5, 0);
const NBSP = '\u202f';

test('karta: letový riadok — hladina s trendom a ft/min, rýchlosť, trojmiestny kurz; na zemi bez trendu', () => {
  assert.equal(formatFlightLine({ altitudeM: 10_363, verticalRateMps: 5, speedMps: 256.7, trackDeg: 214.4 }), `FL340↑ 980 ft/min · 499 kts · 214°`);
  assert.equal(formatFlightLine({ altitudeM: 10_668, verticalRateMps: 0, speedMps: 250, trackDeg: 95 }), 'FL350 · 486 kts · 095°');
  assert.equal(formatFlightLine({ altitudeM: 10_668, verticalRateMps: -8.1, speedMps: 250 }), `FL350↓ 1${NBSP}590 ft/min · 486 kts`, 'klesanie, bez kurzu');
  assert.equal(formatFlightLine({ altitudeM: 1_200, verticalRateMps: 1, speedMps: 90, trackDeg: 360 }), `3${NBSP}937 ft · 175 kts · 000°`, 'pod FL180 stopy, malý trend sa nehlási');
  assert.equal(formatFlightLine({ altitudeM: 0, onGround: true, verticalRateMps: 4, speedMps: 6, trackDeg: 10 }), '0 ft · 12 kts · 010°', 'na zemi žiadny trend ani stúpanie');
  assert.equal(formatFlightLine({}), '0 ft');
});

test('karta: pomocné formáty — vertikálna rýchlosť, kurz, tisícky, vek fixu, hodina príletu', () => {
  assert.equal(formatVerticalRate(2.4), '', 'pod prahom trendu');
  assert.equal(formatVerticalRate(2.6), '↑510 ft/min');
  assert.equal(formatVerticalRate(-12.7), `↓2${NBSP}500 ft/min`);
  assert.equal(formatTrack(-5), '355°');
  assert.equal(formatTrack(NaN), '');
  assert.equal(formatThousands(4843.4), `4${NBSP}843`);
  assert.equal(formatThousands(12), '12');
  assert.equal(formatFixAge(NOW - 6_000, NOW), '6 s');
  assert.equal(formatFixAge(NOW - 150_000, NOW), '3 min');
  assert.equal(formatFixAge(NOW - 7_200_000, NOW), '2 h');
  assert.equal(formatFixAge(NOW + 1000, NOW), '', 'budúci fix = neznámy');
  assert.equal(formatFixAge(undefined, NOW), '');
  const clock = formatEtaClock(215, NOW);
  const d = new Date(NOW + 215 * 60_000);
  assert.equal(clock, `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, 'miestny čas zariadenia');
  assert.equal(formatEtaClock(null, NOW), '');
  assert.equal(formatEtaClock(10, NaN), '');
});

test('karta: riadok o dátach — zdroj, vek fixu, squawk, hex; prázdne časti vypadnú', () => {
  assert.equal(formatMetaLine({ source: 'OpenSky Network', lastContactEpochMs: NOW - 6000, nowMs: NOW, squawk: '1000', hex: '3c6444' }), 'OpenSky Network · fix 6 s ago · SQ 1000 · 3C6444');
  assert.equal(formatMetaLine({ source: 'adsb.lol', hex: 'abc123' }), 'adsb.lol · ABC123');
  assert.equal(formatMetaLine({}), '');
});

test('karta: plný model — IATA v titulku, vlajka registrácie, footer so zdrojom, trasa s vlajkami, progres so zostatkom a hodinou', () => {
  const model = buildTrackedCardModel({
    callsign: 'AFR702',
    flightIata: 'AF702',
    flightLine: 'FL340↑ 980 ft/min · 499 kts · 214°',
    identLine: 'Air France · Boeing 777 328ER · F-GZNP',
    route: ROUTE,
    progress: { fractionDone: 0.33, remainingKm: 3245.2, etaMinutes: 215 },
    metaLine: 'OpenSky Network · fix 6 s ago · SQ 1000 · 3C6444',
    nowMs: NOW,
    countryIso: 'FR',
    originCountry: 'France',
  });
  assert.equal(model.title, 'AFR702 · AF702');
  assert.deepEqual(model.details, ['FL340↑ 980 ft/min · 499 kts · 214°', 'Air France · Boeing 777 328ER · F-GZNP']);
  assert.deepEqual(model.footer, ['OpenSky Network · fix 6 s ago · SQ 1000 · 3C6444']);
  assert.equal(model.accent, TRACKED_FLIGHT_ACCENT);
  assert.equal(model.titleFlag, 'fr');
  assert.deepEqual(model.route, {
    origin: { label: 'CDG Paris', iso2: 'fr' },
    destination: { label: 'ABJ Abidjan', iso2: 'ci' },
  });
  assert.equal(model.progress.fraction, 0.33);
  const clock = formatEtaClock(215, NOW);
  assert.equal(model.progress.label, `33 % · 3${NBSP}245 km left · ETA 3:35 (${clock})`);
});

test('karta: IATA rovnaké ako volací znak sa neopakuje; STALE ide do titulku; squawk poplach je posledný footer riadok', () => {
  const model = buildTrackedCardModel({
    callsign: 'N12345',
    flightIata: 'n12345',
    flightLine: 'FL350 · 486 kts · 095°',
    stale: true,
    identLine: 'TEST AIR · A320',
    metaLine: 'OpenSky Network · N12345',
    alertLine: 'SQUAWK 7700 · EMERGENCY',
    originCountry: 'United States',
  });
  assert.equal(model.title, 'N12345 · STALE');
  assert.deepEqual(model.details, ['FL350 · 486 kts · 095°', 'TEST AIR · A320']);
  assert.deepEqual(model.footer, ['OpenSky Network · N12345', 'SQUAWK 7700 · EMERGENCY']);
  assert.equal(model.titleFlag, 'us');
  assert.equal(model.route, null);
  assert.equal(model.progress, null);
});

test('karta: neznámy štát a chýbajúce dáta — bez vlajky, bez prázdnych riadkov', () => {
  const model = buildTrackedCardModel({ callsign: '4b1a2c', originCountry: 'Atlantis' });
  assert.equal(model.title, '4b1a2c');
  assert.deepEqual(model.details, []);
  assert.deepEqual(model.footer, []);
  assert.equal(model.titleFlag, null);
  assert.equal(model.route, null);
  assert.equal(model.progress, null);
  assert.deepEqual(buildTrackedCardModel(), { title: '', details: [], footer: [], accent: TRACKED_FLIGHT_ACCENT, titleFlag: null, route: null, progress: null });
});

test('karta: riadok trasy — letisko bez štátu má vlajku null, bez kódu aj mesta sa riadok nevykreslí', () => {
  const row = routeRowFromRoute({ origin: { code: 'AUS', name: 'Austin' }, destination: { code: 'LAX' } });
  assert.deepEqual(row, {
    origin: { label: 'AUS Austin', iso2: null },
    destination: { label: 'LAX', iso2: null },
  });
  assert.equal(routeRowFromRoute({ origin: {}, destination: {} }), null);
  assert.equal(routeRowFromRoute(null), null);
  assert.equal(routeRowFromRoute({ origin: { code: 'VIE', country: 'at' } }).origin.iso2, 'at');
});

test('karta: riadok progresu — zostatok a hodina len keď sú známe; podiel mimo 0–1 = žiadny bar', () => {
  assert.deepEqual(progressRowFromProgress({ fractionDone: 0, remainingKm: 2000, etaMinutes: 133 }, NaN), { fraction: 0, label: `0 % · 2${NBSP}000 km left · ETA 2:13` });
  assert.deepEqual(progressRowFromProgress({ fractionDone: 1, etaMinutes: 0 }), { fraction: 1, label: '100 % · ETA 0:00' });
  assert.deepEqual(progressRowFromProgress({ fractionDone: 0.5, etaMinutes: null }), { fraction: 0.5, label: '50 %' });
  const withClock = progressRowFromProgress({ fractionDone: 0.5, remainingKm: 100, etaMinutes: 60 }, NOW);
  assert.equal(withClock.label, `50 % · 100 km left · ETA 1:00 (${formatEtaClock(60, NOW)})`);
  assert.equal(progressRowFromProgress({ fractionDone: 1.2 }), null);
  assert.equal(progressRowFromProgress({ fractionDone: NaN }), null);
  assert.equal(progressRowFromProgress(null), null);
});
