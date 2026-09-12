// src/data/trackedCardModel.test.mjs
// Štruktúrovaný model karty sledovaného letu (2026-09-05): titulok = volací
// znak (+ IATA číslo) s vlajkou registrácie, letový riadok s kurzom a
// stúpaním, riadky ostávajú reťazce, trasa a progres (so zostatkom a hodinou
// príletu) sú vlastné riadky, footer nesie zdroj/vek fixu/squawk/hex.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';
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
  compassLabel,
  formatEtaPlain,
  formatFlightLinesPlain,
  formatTrackPlain,
  regionDisplayName,
} from './trackedCardModel.js';

const ROUTE = {
  origin: { code: 'CDG', name: 'Paris', country: 'FR', lat: 49.01, lon: 2.55 },
  destination: { code: 'ABJ', name: 'Abidjan', country: 'CI', lat: 5.26, lon: -3.93 },
};
const NOW = Date.UTC(2026, 8, 5, 16, 5, 0);
const NBSP = '\u202f';

test('karta: letový riadok — hladina s trendom a ft/min, rýchlosť, trojmiestny kurz; na zemi bez trendu', () => {
  assert.equal(formatFlightLine({ altitudeM: 10_363, verticalRateMps: 5, speedMps: 256.7, trackDeg: 214.4 }), `FL340 (≈ 10 363 m) ↑980 ft/min (5,0 m/s) · 499 kts (924 km/h) · 214° (SW)`);
  assert.equal(formatFlightLine({ altitudeM: 10_668, verticalRateMps: 0, speedMps: 250, trackDeg: 95 }), 'FL350 (≈ 10 668 m) · 486 kts (900 km/h) · 095° (E)');
  assert.equal(formatFlightLine({ altitudeM: 10_668, verticalRateMps: -8.1, speedMps: 250 }), `FL350 (≈ 10${NBSP}668 m) ↓1${NBSP}590 ft/min (8,1 m/s) · 486 kts (900 km/h)`, 'klesanie, bez kurzu');
  assert.equal(formatFlightLine({ altitudeM: 1_200, verticalRateMps: 1, speedMps: 90, trackDeg: 360 }), `3${NBSP}937 ft (1${NBSP}200 m) · 175 kts (324 km/h) · 000° (N)`, 'pod FL180 stopy s metrami, malý trend sa nehlási');
  assert.equal(formatFlightLine({ altitudeM: 0, onGround: true, verticalRateMps: 4, speedMps: 6, trackDeg: 10 }), 'on ground · 12 kts (22 km/h) · 010° (N)', 'na zemi žiadny trend ani stúpanie, výška sa nekreslí');
  assert.equal(formatFlightLine({}), '0 ft (0 m)', 'bez údajov ostáva nula ako doteraz, len v oboch jednotkách');
});

test('karta: pomocné formáty — vertikálna rýchlosť, kurz, tisícky, vek fixu, hodina príletu', () => {
  assert.equal(formatVerticalRate(2.4), '', 'pod prahom trendu');
  assert.equal(formatVerticalRate(2.6), '↑510 ft/min (2,6 m/s)');
  assert.equal(formatVerticalRate(-12.7), `↓2${NBSP}500 ft/min (12,7 m/s)`);
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
  assert.equal(formatMetaLine({ source: 'OpenSky Network', lastContactEpochMs: NOW - 6000, nowMs: NOW, squawk: '1000', hex: '3c6444' }), 'OpenSky Network · position 6 s ago · squawk 1000 · ICAO 3C6444');
  assert.equal(formatMetaLine({ source: 'adsb.lol', hex: 'abc123' }), 'adsb.lol · ICAO ABC123');
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
  // Štát z Intl.DisplayNames (2026-09-12, „KONYA bude aj Turecko"); presné znenie je vec ICU.
  assert.equal(model.route.origin.iso2, 'fr');
  assert.equal(model.route.destination.iso2, 'ci');
  assert.equal(model.route.origin.label, 'CDG Paris (France)');
  assert.match(model.route.destination.label, /^ABJ Abidjan \(Côte d.Ivoire\)$/);
  assert.equal(model.progress.fraction, 0.33);
  const clock = formatEtaClock(215, NOW);
  assert.equal(model.progress.label, `33 % of the route · 3${NBSP}245 km left · landing in 3 h 35 min (${clock})`);
});

test('karta: IATA rovnaké ako volací znak sa neopakuje; STALE ide do titulku; squawk poplach je VLASTNÉ pole (červený rám), nie footer', () => {
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
  assert.deepEqual(model.footer, ['OpenSky Network · N12345']);
  assert.equal(model.alert, 'SQUAWK 7700 · EMERGENCY');
  assert.equal(model.profile, null);
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
  assert.deepEqual(buildTrackedCardModel(), { title: '', details: [], footer: [], accent: TRACKED_FLIGHT_ACCENT, titleFlag: null, route: null, progress: null, profile: null, alert: null });
  const withProfile = buildTrackedCardModel({ callsign: 'X', profile: { altitude: [0, 1], speed: [], label: 'a', sublabel: 'b' } });
  assert.deepEqual(withProfile.profile, { altitude: [0, 1], speed: [], label: 'a', sublabel: 'b' });
  assert.equal(buildTrackedCardModel({ callsign: 'X', profile: 'nope' }).profile, null);
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
  assert.equal(routeRowFromRoute({ destination: { code: 'ZAD', name: 'Zemunik (Zadar)', country: 'hr' } }, 'en').destination.label, 'ZAD Zemunik (Croatia)', 'zátvorka z mena letiska ustúpi štátu');
  assert.equal(routeRowFromRoute({ destination: { code: 'ZAD', name: 'Zemunik (Zadar)', country: 'hr' } }, 'sk').destination.label, 'ZAD Zemunik (Chorvátsko)');
});

test('karta: riadok progresu — zostatok a hodina len keď sú známe; podiel mimo 0–1 = žiadny bar', () => {
  assert.deepEqual(progressRowFromProgress({ fractionDone: 0, remainingKm: 2000, etaMinutes: 133 }, NaN), { fraction: 0, label: `0 % of the route · 2${NBSP}000 km left · landing in 2 h 13 min` });
  assert.deepEqual(progressRowFromProgress({ fractionDone: 1, etaMinutes: 0 }), { fraction: 1, label: '100 % of the route · landing in 0 min' });
  assert.deepEqual(progressRowFromProgress({ fractionDone: 0.5, etaMinutes: null }), { fraction: 0.5, label: '50 % of the route' });
  const withClock = progressRowFromProgress({ fractionDone: 0.5, remainingKm: 100, etaMinutes: 60 }, NOW);
  assert.equal(withClock.label, `50 % of the route · 100 km left · landing in 1 h (${formatEtaClock(60, NOW)})`);
  assert.equal(progressRowFromProgress({ fractionDone: 1.2 }), null);
  assert.equal(progressRowFromProgress({ fractionDone: NaN }), null);
  assert.equal(progressRowFromProgress(null), null);
});

test('karta: ACARS riadok (airframes.io, len lokálne) ide do päty PRED riadok o dátach; prázdny sa vynechá', () => {
  const model = buildTrackedCardModel({
    callsign: 'DLH2ME',
    acarsLine: 'ACARS 7 · 03:40 CPDLC ↑ ACFT→ATC · POS N33.6 W116.3',
    metaLine: 'OpenSky Network · 3C6444',
  });
  assert.deepEqual(model.footer, ['ACARS 7 · 03:40 CPDLC ↑ ACFT→ATC · POS N33.6 W116.3', 'OpenSky Network · 3C6444']);
  assert.deepEqual(buildTrackedCardModel({ callsign: 'X', acarsLine: '   ', metaLine: 'M' }).footer, ['M']);
});

test('formatTrack: null, undefined a prázdny reťazec nie sú 0° (GFW lode bez kurzu ukazovali „000°", 2026-09-12)', () => {
  assert.equal(formatTrack(null), '');
  assert.equal(formatTrack(undefined), '');
  assert.equal(formatTrack(''), '');
  assert.equal(formatTrack(0), '000°', 'skutočná nula ostáva sever');
  assert.equal(formatTrack(359.6), '000°');
  assert.equal(formatTrack(231.2), '231°');
});

test('zrozumiteľné riadky (2026-09-12, „aby to pochopil aj debil"): letová hladina s metrami, stúpanie, rýchlosť v km/h, kurz so svetovou stranou, štát, pristátie', () => {
  const tEn = (key, vars = {}) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), EN_STRINGS[key] ?? key);
  assert.deepEqual(formatFlightLinesPlain({ altitudeM: 10_973, verticalRateMps: 5, speedMps: 206.3, trackDeg: 327 }, tEn), [
    'Flight level FL360 (≈ 10 973 m) · climbing 980 ft/min (5,0 m/s)',
    'Speed 401 kts (743 km/h) · heading 327° (NW)',
  ]);
  assert.deepEqual(formatFlightLinesPlain({ altitudeM: 3_810, verticalRateMps: -4, speedMps: 100, trackDeg: 90 }, tEn), [
    'Altitude 12 500 ft (3 810 m) · descending 790 ft/min (4,0 m/s)',
    'Speed 194 kts (360 km/h) · heading 090° (E)',
  ]);
  assert.deepEqual(formatFlightLinesPlain({ altitudeM: 0, onGround: true, speedMps: 6, trackDeg: 10 }, tEn), ['On the ground', 'Speed 12 kts (22 km/h) · heading 010° (N)']);
  assert.deepEqual(formatFlightLinesPlain({ altitudeM: 10_000 }, tEn), ['Flight level FL328 (≈ 10 000 m)'], 'bez rýchlosti a kurzu len jeden riadok');
  assert.equal(compassLabel(327, tEn), 'NW');
  assert.equal(compassLabel(0, tEn), 'N');
  assert.equal(compassLabel(359, tEn), 'N');
  assert.equal(compassLabel(202.5, tEn), 'SW');
  assert.equal(compassLabel(null, tEn), '');
  assert.equal(formatTrackPlain(95, tEn), '095° (E)');
  assert.equal(formatTrackPlain(null, tEn), '');
  assert.equal(formatEtaPlain(52), '52 min');
  assert.equal(formatEtaPlain(215), '3 h 35 min');
  assert.equal(formatEtaPlain(120), '2 h');
  assert.equal(formatEtaPlain(-1), '');
  assert.equal(formatEtaPlain(null), '');
  assert.equal(regionDisplayName('TR', 'sk'), 'Turecko');
  assert.equal(regionDisplayName('DK', 'sk'), 'Dánsko');
  assert.equal(regionDisplayName('TR', 'en'), 'Türkiye');
  assert.equal(regionDisplayName('XX', 'sk'), '', 'neznámy kód nič nevymýšľa');
  assert.equal(regionDisplayName('', 'sk'), '');
  const sk = (key, vars = {}) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), SK_STRINGS[key] ?? key);
  assert.deepEqual(formatFlightLinesPlain({ altitudeM: 10_973, speedMps: 206.3, trackDeg: 327 }, sk), [
    'Letová hladina FL360 (≈ 10 973 m)',
    'Rýchlosť 401 kts (743 km/h) · kurz 327° (SZ)',
  ]);
});
