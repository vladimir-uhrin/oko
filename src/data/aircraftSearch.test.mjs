// Jednotné hľadanie lietadla (2026-10-04): z textu na typ, prevádzkovateľa, registráciu, volací znak, hex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftTypeName, looksLikeAircraftQuery, operatorFromCallsign, parseAircraftQuery, scoreAircraft, searchAircraft } from './aircraftSearch.js';

test('Ruslan nájdený každým spôsobom, ako ho človek napíše', () => {
  for (const q of ['Ruslan', 'ruslan', 'An-124', 'an124', 'AN 124', 'A124', 'Antonov An-124 Ruslan']) {
    assert.deepEqual(parseAircraftQuery(q).types.map(t => t.code), ['A124'], q);
  }
  assert.equal(aircraftTypeName('a124'), 'Antonov An-124 Ruslan');
});

test('registrácia, volací znak, hex a prevádzkovateľ', () => {
  assert.equal(parseAircraftQuery('UR-82072').registration, 'UR-82072');
  assert.equal(parseAircraftQuery('om-byw').registration, 'OM-BYW');
  assert.equal(parseAircraftQuery('ADB3017').callsign, 'ADB3017');
  assert.equal(parseAircraftQuery('508035').hex, '508035');
  assert.equal(parseAircraftQuery('Bratislava').hex, null);
  const antonov = parseAircraftQuery('Antonov');
  assert.deepEqual(antonov.operators.map(op => op.icao), ['ADB']);
  assert.ok(antonov.types.some(t => t.code === 'A124') && antonov.types.length <= 6, 'výrobca dá jeho typy, najviac 6');
  assert.equal(operatorFromCallsign('ADB3017').name, 'Antonov Airlines');
  assert.equal(operatorFromCallsign('X1'), null);
  // Iľjušin bez diakritiky aj s ňou.
  assert.deepEqual(parseAircraftQuery('Iľjušin').types.map(t => t.code), ['IL76', 'IL62', 'IL96'], 'Il-76 (prezývka) prvý, potom typy výrobcu');
});

test('pole „miesto" pošle do palety lietadiel len jednoznačné dopyty', () => {
  for (const q of ['Ruslan', 'An-124', 'UR-82072', 'ADB3017', '508035', 'A380', 'globemaster']) assert.equal(looksLikeAircraftQuery(q), true, q);
  for (const q of ['Bratislava', 'Atlas', 'Qatar', 'Viedeň', 'Letisko M. R. Štefánika', 'Lipsko']) assert.equal(looksLikeAircraftQuery(q), false, q);
});

test('poradie zhody: hex > volací znak / registrácia > typ > prevádzkovateľ > začiatok > text', () => {
  const fleet = [
    { hex: '508035', callsign: 'ADB3017', registration: 'UR-82072', typeCode: 'A124' },
    { hex: '508036', callsign: 'ADB4022', registration: 'UR-82073', typeCode: null },
    { hex: '4ca123', callsign: 'RYR12AB', registration: 'EI-ABC', typeCode: 'B738', operator: 'Ryanair' },
    { hex: '3c4b26', callsign: 'DLH400', registration: 'D-ABYA', typeCode: 'B748', typeName: 'Boeing 747-8' },
  ];
  assert.deepEqual(searchAircraft(fleet, 'Ruslan').map(a => a.hex), ['508035'], 'typ A124 len ten, čo ho má');
  assert.deepEqual(searchAircraft(fleet, 'antonov').map(a => a.hex), ['508035', '508036'], 'typ aj volací znak ADB');
  assert.equal(searchAircraft(fleet, 'ur-82073')[0].hex, '508036', 'registrácia bez ohľadu na pomlčku a veľkosť');
  assert.equal(searchAircraft(fleet, '3c4b26')[0].score, 100);
  assert.deepEqual(searchAircraft(fleet, 'ryanair').map(a => a.hex), ['4ca123']);
  assert.deepEqual(searchAircraft(fleet, 'jumbo').map(a => a.hex), ['3c4b26']);
  assert.deepEqual(searchAircraft(fleet, 'x'), [], 'jedno písmeno nehľadá');
  assert.equal(scoreAircraft({ hex: 'aaaaaa' }, parseAircraftQuery('Bratislava')), 0);
});
