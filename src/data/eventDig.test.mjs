// src/data/eventDig.test.mjs — dolovanie chýbajúcich údajov udalosti (2026-10-01, vlastník: „vydolovať
// chýbajúce dáta"). Testy SPRÁVANIA: na FZ1073 zo skutočných stôp sa nájde diera po páde (05:22–05:31) aj
// koniec údajov vo vzduchu; pokrytie počíta len INÉ lietadlá v čase a okolí diery (vlastné nie, ďaleké nie,
// mimo času nie); ďalší let z letiska = odvodené pristátie, vo vzduchu nie; text rozlíši slepé miesto
// od miesta, kde siete iné lietadlá videli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simplifyTrack } from './eventCard.js';
import { DIG_DEFAULTS, distanceToSegmentKm, eventHoles, gapCoverage, holeLine, nextDeparture } from './eventDig.js';
import { airportsFromIndex } from './airportNearest.js';
import { parseAirportIndex } from './airportLookup.js';
import { normalizeTrack } from './flightAnomalies.js';
import { fz1073, fz1073Event } from './fixtures/flightEventFixtures.mjs';

const utc = (s) => Date.parse(s) / 1000;

async function fzEvent() {
  const e = await fz1073Event();
  const { oko, adsblol } = fz1073();
  e.track = simplifyTrack(normalizeTrack([...oko, ...adsblol]));
  e.window = { fromT: utc('2026-09-30T05:00:00Z'), toT: utc('2026-09-30T07:00:00Z') };
  return e;
}

test('FZ1073: diera po páde a koniec údajov vo vzduchu (v okne udalosti; dávna diera nad Saudskou Arábiou mimo okna nie)', async () => {
  const holes = eventHoles(await fzEvent());
  assert.deepEqual(holes.map((h) => h.kind), ['gap', 'end']);
  const [gap, end] = holes;
  assert.ok(Math.abs(gap.fromT - utc('2026-09-30T05:22:13Z')) <= 2 && Math.abs(gap.toT - utc('2026-09-30T05:31:26Z')) <= 2);
  assert.ok(gap.a.altFt > 25_000 && gap.b.altFt < 16_000, 'pád cez dieru');
  assert.ok(Math.abs(end.fromT - utc('2026-09-30T05:53:33Z')) <= 2);
  assert.ok(end.a.altFt > 14_000, 'koniec údajov vo výške');
  assert.match(holeLine(gap, null), /^05:22–05:31 bez údajov \(9 min, 9\d km\)$/);
  assert.equal(holeLine(end, null), '05:53 koniec údajov vo výške 15 025 ft');
  // Pristátie v dátach (posledný bod na zemi) nie je „koniec vo vzduchu".
  const landed = { track: [[0, 30, 38, 30000], [60, 30.1, 38.1, 0]] };
  assert.deepEqual(eventHoles(landed), []);
});

test('pokrytie: len iné lietadlá v čase diery do 150 km od nej; vlastné, ďaleké a mimo času sa nerátajú', () => {
  const hole = { kind: 'gap', fromT: 1000, toT: 1600, a: { lat: 29.77, lon: 38.29 }, b: { lat: 30.58, lon: 38.0 } };
  const rows = [
    ['aaa111', 1100, 30.0, 38.5, 11_000], // blízko, vysoko
    ['aaa111', 1200, 30.1, 38.5, 11_000], // to isté lietadlo znova
    ['bbb222', 1300, 30.2, 39.3, 3_000], // ~100 km, nízko
    ['ccc333', 1300, 32.5, 38.2, 11_000], // ~210 km severne — ďaleko
    ['ddd444', 900, 30.0, 38.2, 11_000], // pred dierou
    ['8965d1', 1300, 30.1, 38.1, 9_000], // lietadlo udalosti
  ];
  const cov = gapCoverage(hole, rows, '8965d1');
  assert.deepEqual([cov.aircraft, cov.high, cov.fixes], [2, 1, 3]);
  // (30,0; 38,5) leží ~0,29° východne od diery na tej istej šírke → ~27 km kolmo na ňu.
  assert.ok(cov.nearestKm >= 24 && cov.nearestKm <= 30, `najbližšie ${cov.nearestKm} km`);
  assert.match(holeLine(hole, cov), /siete videli v okolí 2 iných lietadiel \(1 vo výške nad 20 tis\. ft, najbližšie \d+ km\)$/);
  const blind = gapCoverage(hole, [['ccc333', 1300, 32.5, 38.2, 11_000]], '8965d1');
  assert.equal(blind.aircraft, 0);
  assert.match(holeLine(hole, blind), /slepé miesto prijímačov\)$/);
  assert.ok(Math.abs(distanceToSegmentKm({ lat: 30, lon: 38.29 }, hole.a, { lat: 30.58, lon: 38.29 })) < 1e-9, 'bod na úsečke = 0 km');
  assert.equal(DIG_DEFAULTS.radiusKm, 150);
});

test('ďalší let po konci údajov: z letiska (na zemi / nízko pri ňom) = odvodené miesto pristátia; vo vzduchu alebo bez letu nič', () => {
  const airports = airportsFromIndex(parseAirportIndex(readFileSync(new URL('./local_data/airports/airports.geojsonl', import.meta.url), 'utf8')));
  const end = utc('2026-09-30T05:53:33Z');
  const fromTabuk = nextDeparture([
    { t: end + 120, lat: 30.7, lon: 38.0, altM: 4500, gnd: false }, // ešte ten istý let (do 10 min) — preskočí sa
    { t: end + 30 * 3600, lat: 28.368, lon: 36.63, altM: null, gnd: true },
  ], end, airports);
  assert.equal(fromTabuk.airport.icao, 'OETB');
  assert.equal(fromTabuk.airport.iata, 'TUU');
  const airborne = nextDeparture([{ t: end + 3600, lat: 31, lon: 37, altM: 9000, gnd: false }], end, airports);
  assert.equal(airborne.airport, null, 'vo vzduchu sa letisko neodvodzuje');
  assert.equal(nextDeparture([], end, airports), null);
});
