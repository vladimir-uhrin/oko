// src/data/airportsData.test.mjs
// Čisté funkcie letiskového datasetu: filter OurAirports riadkov, tvar
// geojsonl feature a text karty. Build skript (scripts/build-airports.mjs)
// aj vrstva konzumujú presne tieto funkcie — čo prejde tu, je kontrakt
// bundlu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIRPORTS_LAYER_ID,
  AIRPORT_DETAILS_FILE,
  airportDetailsFromRows,
  airportFeatureFromRow,
  airportImportance,
  airportOverlayCopy,
  airportRowAccepted,
  airportTitleFlag,
  formatElevation,
  formatFrequencyMhz,
  frequencyRows,
  liveAtcUrl,
  runwayLabel,
  runwaySurfaceKey,
} from './airportsData.js';
import { EN_STRINGS } from '../i18nStrings.js';

const tEn = (key) => EN_STRINGS[key] || key;

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
    ident: 'LZIB',
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

test('karta (2026-09-05): kódy + mesto na prvom riadku, slovný typ + výška v metroch na druhom, vlajka štátu', () => {
  const props = airportFeatureFromRow(LZIB).properties;
  assert.deepEqual(airportOverlayCopy({ ...props, iata: 'BTS', icao: 'LZIB' }, tEn), [
    'BTS · LZIB · Bratislava',
    'Large airport · 133 m (436 ft)',
  ]);
  assert.deepEqual(airportOverlayCopy({ name: 'X', type: 'small', municipality: 'Nowhere' }, tEn), ['Nowhere', 'Small airport'], 'chýbajúce polia vypadnú, riadky nie sú prázdne');
  assert.deepEqual(airportOverlayCopy({}, tEn), []);
  assert.equal(airportTitleFlag(props), 'sk');
  assert.equal(airportTitleFlag({ country: 'XXX' }), null);
  assert.equal(formatElevation(436), '133 m (436 ft)');
  assert.equal(formatElevation(null), '');
});

test('detaily: frekvencie zoradené podľa skupín (ATIS, TWR, GND, APP…), dráhy bez zatvorených, odkazy len https', () => {
  const details = airportDetailsFromRows(
    { iso_region: 'SK-BL', home_link: 'https://www.bts.aero', wikipedia_link: 'https://en.wikipedia.org/wiki/Bratislava_Airport', gps_code: 'LZIB', local_code: '' },
    [
      { type: 'APP', description: 'Bratislava Approach', frequency_mhz: '120.3' },
      { type: 'TWR', description: 'Bratislava Tower', frequency_mhz: '118.3' },
      { type: 'ATIS', description: 'ATIS', frequency_mhz: '124.555' },
      { type: 'GND', description: 'Ground', frequency_mhz: '121.9' },
      { type: 'MISC', description: 'bad', frequency_mhz: '' },
    ],
    [
      { le_ident: '04', he_ident: '22', length_ft: '9514', width_ft: '197', surface: 'ASP', lighted: '1', closed: '0' },
      { le_ident: '13', he_ident: '31', length_ft: '10466', width_ft: '148', surface: 'CON', lighted: '1', closed: '0' },
      { le_ident: '09', he_ident: '27', length_ft: '3000', width_ft: '100', surface: 'GRS', lighted: '0', closed: '1' },
    ],
  );
  assert.deepEqual(details.freq.map((f) => f[0]), ['ATIS', 'TWR', 'GND', 'APP'], 'poradie skupín, nečíselná frekvencia vypadla');
  assert.equal(details.freq[1][2], 118.3);
  assert.equal(details.rwy.length, 2, 'zatvorená dráha sa nebundluje');
  assert.equal(details.rwy[0][0], '13', 'najdlhšia dráha prvá');
  assert.equal(details.region, 'SK-BL');
  assert.equal(details.web, 'https://www.bts.aero');
  assert.equal(airportDetailsFromRows({ home_link: 'javascript:alert(1)' }).web, null, 'len http(s) odkazy');
  assert.equal(AIRPORT_DETAILS_FILE, 'airport-details.json');
});

test('detaily: formáty pre kartu — MHz na tri desatinné, orez „+N", dráha v metroch s povrchom, LiveATC len odkaz', () => {
  assert.equal(formatFrequencyMhz(118.3), '118.300');
  assert.equal(formatFrequencyMhz('x'), '');
  const many = Array.from({ length: 15 }, (_, i) => ['TWR', `T${i}`, 118 + i / 100]);
  const { rows, more } = frequencyRows(many);
  assert.equal(rows.length, 12);
  assert.equal(more, 3);
  assert.deepEqual(rows[0], { type: 'TWR', description: 'T0', mhz: '118.000' });
  assert.equal(runwayLabel(['04', '22', 9514, 197, 'ASP', 1, 0], tEn), '04/22 · 2\u202f900 × 60 m · asphalt · lighted');
  assert.equal(runwayLabel(['13', '31', null, null, 'GRS', 0, 0], tEn), '13/31 · grass');
  assert.equal(runwayLabel(null), '');
  assert.equal(runwaySurfaceKey('ASPH'), 'airport.surface.asphalt');
  assert.equal(runwaySurfaceKey('CONC'), 'airport.surface.concrete');
  assert.equal(runwaySurfaceKey('TURF'), 'airport.surface.grass');
  assert.equal(runwaySurfaceKey('GRVL'), 'airport.surface.gravel');
  assert.equal(runwaySurfaceKey('WATER'), 'airport.surface.water');
  assert.equal(runwaySurfaceKey('UNK'), '');
  assert.equal(liveAtcUrl('lzib'), 'https://www.liveatc.net/search/?icao=LZIB');
  assert.equal(liveAtcUrl('BTS'), null, 'IATA nie je ICAO');
  assert.equal(liveAtcUrl(null), null);
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
