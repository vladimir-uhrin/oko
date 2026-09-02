// src/data/airportsData.test.mjs
// Čisté funkcie letiskového datasetu: filter OurAirports riadkov, tvar
// geojsonl feature a text karty. Build skript (scripts/build-airports.mjs)
// aj vrstva konzumujú presne tieto funkcie — čo prejde tu, je kontrakt
// bundlu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRPORTS_LAYER_ID,
  airportFeatureFromRow,
  airportImportance,
  airportOverlayCopy,
  airportRowAccepted,
} from './airportsData.js';

const LZIB = {
  ident: 'LZIB',
  type: 'large_airport',
  name: 'M. R. Štefánik Airport',
  latitude_deg: '48.17022',
  longitude_deg: '17.21267',
  elevation_ft: '436',
  iso_country: 'SK',
  municipality: 'Bratislava',
  scheduled_service: 'yes',
  icao_code: 'LZIB',
  iata_code: 'BTS',
};

test('filter: veľké a stredné letiská vždy, malé len s pravidelnou dopravou', () => {
  assert.equal(airportRowAccepted(LZIB), true);
  assert.equal(airportRowAccepted({ type: 'medium_airport', scheduled_service: 'no' }), true);
  assert.equal(airportRowAccepted({ type: 'small_airport', scheduled_service: 'yes' }), true);
  assert.equal(airportRowAccepted({ type: 'small_airport', scheduled_service: 'no' }), false);
  assert.equal(airportRowAccepted({ type: 'heliport', scheduled_service: 'yes' }), false);
  assert.equal(airportRowAccepted({ type: 'seaplane_base', scheduled_service: 'yes' }), false);
  // Živé dáta používajú hodnotu 'closed' (data dictionary tvrdí
  // 'closed_airport' — sú rozsynchronizované; filter drží ŽIVÚ hodnotu).
  // 8 zatvorených letísk má scheduled_service=yes — vylúčenie musí byť
  // explicitné, nie cez scheduled flag.
  assert.equal(airportRowAccepted({ type: 'closed', scheduled_service: 'yes' }), false);
  assert.equal(airportRowAccepted({ type: 'closed_airport', scheduled_service: 'yes' }), false);
  assert.equal(airportRowAccepted({}), false);
});

test('feature: LZIB sa premapuje so súradnicami, kódmi a výškou', () => {
  const feature = airportFeatureFromRow(LZIB);
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.id, 'LZIB');
  assert.deepEqual(feature.geometry, { type: 'Point', coordinates: [17.21267, 48.17022] });
  assert.deepEqual(feature.properties, {
    name: 'M. R. Štefánik Airport',
    icao: 'LZIB',
    iata: 'BTS',
    type: 'large',
    municipality: 'Bratislava',
    country: 'SK',
    elevFt: 436,
    scheduled: true,
  });
});

test('feature: chýbajúce polia degradujú na null, zlé súradnice na null feature', () => {
  // 812 riadkov filtra nemá IATA, 667 ICAO, 201 výšku — bundel ich drží
  // s nullmi a UI ich toleruje; ident je jediné vždy prítomné pole.
  const bare = airportFeatureFromRow({
    ident: 'XX01', type: 'medium_airport', name: 'Bare Field',
    latitude_deg: '10', longitude_deg: '20',
  });
  assert.equal(bare.properties.icao, null);
  assert.equal(bare.properties.iata, null);
  assert.equal(bare.properties.elevFt, null);
  assert.equal(bare.properties.municipality, null);
  assert.equal(bare.properties.scheduled, false);

  assert.equal(airportFeatureFromRow({ ...LZIB, latitude_deg: '' }), null);
  assert.equal(airportFeatureFromRow({ ...LZIB, latitude_deg: '91' }), null);
  assert.equal(airportFeatureFromRow({ ...LZIB, longitude_deg: '181' }), null);
  assert.equal(airportFeatureFromRow({ ...LZIB, ident: ' ' }), null);
});

test('karta: kódy a typ na prvom riadku, mesto/krajina/výška na druhom', () => {
  assert.deepEqual(airportOverlayCopy({
    icao: 'LZIB', iata: 'BTS', type: 'large',
    municipality: 'Bratislava', country: 'SK', elevFt: 436,
  }), ['BTS · LZIB · LARGE', 'Bratislava, SK · ELEV 436 FT']);
  // Bez kódov a výšky sa riadky zúžia, prázdne sa negenerujú.
  assert.deepEqual(airportOverlayCopy({ type: 'medium', country: 'AQ' }), ['MEDIUM', 'AQ']);
  assert.deepEqual(airportOverlayCopy({}), []);
});

test('dôležitosť: veľké > stredné > malé — kohorta štítkov uprednostní huby', () => {
  const large = airportImportance({ type: 'large' });
  const medium = airportImportance({ type: 'medium' });
  const small = airportImportance({ type: 'small' });
  assert.ok(large > medium && medium > small && small > 0);
  assert.equal(airportImportance({}), 0);
});

test('layer id je stabilný (persistencia + share-link tokeny na ňom stoja)', () => {
  assert.equal(AIRPORTS_LAYER_ID, 'local-airports');
});
