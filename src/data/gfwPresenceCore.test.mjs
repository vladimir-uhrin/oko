// src/data/gfwPresenceCore.test.mjs
// GFW satelitná prítomnosť lodí (2026-09-12): výrez, okno dní, URL správy,
// normalizácia odpovede 4Wings, posledná bunka na loď.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GFW_DELAY_HOURS, GFW_MAX_BBOX_SPAN_DEG, GFW_PRESENCE_DATASET,
  gfwBboxError, gfwBboxPolygon, gfwPresenceCacheKey, gfwPresenceDateRange, gfwReportUrl,
  latestGfwCellPerVessel, normalizeGfwPresence, parseGfwBbox, quantizeGfwBbox,
} from './gfwPresenceCore.js';

test('parseGfwBbox: west,south,east,north; odmietne nezmysly, antimeridián a mimo sveta', () => {
  assert.deepEqual(parseGfwBbox('47,23,60,31'), { west: 47, south: 23, east: 60, north: 31 });
  assert.deepEqual(parseGfwBbox(' 47.5 , 23 , 60 , 31 '), { west: 47.5, south: 23, east: 60, north: 31 });
  assert.equal(parseGfwBbox(''), null);
  assert.equal(parseGfwBbox(null), null);
  assert.equal(parseGfwBbox('a,b,c,d'), null);
  assert.equal(parseGfwBbox('1,2,3'), null);
  assert.equal(parseGfwBbox('170,-10,-170,10'), null, 'cez antimeridián v1 neberieme');
  assert.equal(parseGfwBbox('10,20,10,30'), null, 'nulová šírka');
  assert.equal(parseGfwBbox('-200,0,10,10'), null);
});

test('quantizeGfwBbox: roztiahne VON na celé stupne, oreže na svet, nikdy nulový', () => {
  assert.deepEqual(quantizeGfwBbox({ west: 47.3, south: 23.9, east: 59.1, north: 30.2 }), { west: 47, south: 23, east: 60, north: 31 });
  assert.deepEqual(quantizeGfwBbox({ west: -180, south: -90, east: 180, north: 90 }), { west: -180, south: -90, east: 180, north: 90 });
  assert.deepEqual(quantizeGfwBbox({ west: 5, south: 5, east: 5.0001, north: 5.0001 }), { west: 5, south: 5, east: 6, north: 6 });
  assert.deepEqual(quantizeGfwBbox({ west: 47.3, south: 23.9, east: 59.1, north: 30.2 }, 5), { west: 45, south: 20, east: 60, north: 35 });
});

test('gfwBboxError: chýbajúci a priveľký výrez', () => {
  assert.match(gfwBboxError(null), /bbox required/);
  assert.equal(gfwBboxError({ west: 47, south: 23, east: 60, north: 31 }), null);
  assert.match(gfwBboxError({ west: -20, south: 0, east: 30, north: 10 }), /too large/);
  assert.match(gfwBboxError({ west: 0, south: -30, east: 10, north: 20 }), /too large/);
  assert.equal(GFW_MAX_BBOX_SPAN_DEG, 40);
});

test('gfwBboxPolygon: uzavretý obdĺžnik proti smeru hodinových ručičiek', () => {
  const p = gfwBboxPolygon({ west: 47, south: 23, east: 60, north: 31 });
  assert.equal(p.type, 'Polygon');
  assert.deepEqual(p.coordinates[0], [[47, 23], [60, 23], [60, 31], [47, 31], [47, 23]]);
});

test('gfwPresenceDateRange: okno končí deň PRED koncom 72 h oneskorenia, 2 dni', () => {
  const now = Date.UTC(2026, 8, 12, 12, 0, 0); // 12. 9. 2026 12:00 Z
  const r = gfwPresenceDateRange(now);
  assert.equal(r.delayHours, GFW_DELAY_HOURS);
  // 12. 9. 12:00 − 72 h = 9. 9. 12:00 → deň pred = 8. 9.; okno 2 dni = 7.–8. 9.
  assert.equal(r.to, '2026-09-08');
  assert.equal(r.from, '2026-09-07');
  assert.deepEqual(gfwPresenceDateRange(now, { windowDays: 1 }), { from: '2026-09-08', to: '2026-09-08', delayHours: 72 });
  assert.equal(gfwPresenceDateRange(now, { delayHours: 0, windowDays: 3 }).to, '2026-09-11');
});

test('gfwReportUrl: LOW, ENTIRE, group-by VESSEL_ID, dataset prítomnosti, JSON', () => {
  const url = new URL(gfwReportUrl({ from: '2026-09-07', to: '2026-09-08' }));
  assert.equal(url.origin + url.pathname, 'https://gateway.api.globalfishingwatch.org/v3/4wings/report');
  assert.equal(url.searchParams.get('spatial-resolution'), 'LOW');
  assert.equal(url.searchParams.get('temporal-resolution'), 'ENTIRE');
  assert.equal(url.searchParams.get('group-by'), 'VESSEL_ID', 'po ID lode nesie správa meno, typ, vlajku, volací znak a IMO');
  assert.equal(url.searchParams.get('datasets[0]'), GFW_PRESENCE_DATASET);
  assert.equal(url.searchParams.get('date-range'), '2026-09-07,2026-09-08');
  assert.equal(url.searchParams.get('format'), 'JSON');
  assert.equal(gfwPresenceCacheKey({ west: 47, south: 23, east: 60, north: 31 }, { from: '2026-09-07', to: '2026-09-08' }), '47,23,60,31@2026-09-07_2026-09-08');
});

const SAMPLE = {
  total: 2,
  entries: [{
    'public-global-presence:v3.0': [
      { mmsi: '663103000', shipName: 'RIA DE DAKAR', vesselType: 'FISHING', flag: 'SEN', callsign: 'DAK1142', imo: '9003342', lat: 15.68, lon: -17.06, hours: 1.88, entryTimestamp: '2026-09-07T11:00:00Z', exitTimestamp: '2026-09-07T13:00:00Z', vesselId: 'abc' },
      { mmsi: '663103000', shipName: 'RIA DE DAKAR', vesselType: 'FISHING', flag: 'SEN', lat: 15.78, lon: -17.16, hours: 0.5, entryTimestamp: '2026-09-08T02:00:00Z', exitTimestamp: '2026-09-08T03:00:00Z', vesselId: 'abc' },
      { mmsi: '', shipName: 'UNKNOWN', lat: 26.1, lon: 56.2, hours: 3 },
      { mmsi: '244660815', shipName: 'VLISSINGEN', vesselType: 'CARGO', flag: 'NLD', lat: '91', lon: 4, hours: 1 },
      { mmsi: '211000000', shipName: 'NORDIC', vesselType: 'TANKER', flag: 'DEU', callsign: 'DABC', lat: 26.5, lon: 56.0, hours: 2, exitTimestamp: '2026-09-08T10:00:00Z', vesselId: 'id-with-name' },
      { mmsi: '211000000', lat: 26.6, lon: 56.1, hours: 5, exitTimestamp: '2026-09-08T10:00:00Z', vesselId: 'id-anonymous' },
    ],
  }],
};

test('normalizeGfwPresence: sploští záznamy, zahodí nepoužiteľné súradnice, toleruje chýbajúce polia', () => {
  const rows = normalizeGfwPresence(SAMPLE);
  assert.equal(rows.length, 5, 'riadok s lat 91 vypadol');
  assert.deepEqual(rows[0], {
    mmsi: '663103000', name: 'RIA DE DAKAR', type: 'FISHING', flag: 'SEN', callsign: 'DAK1142', imo: '9003342', lat: 15.68, lon: -17.06, hours: 1.88,
    firstSeen: Date.parse('2026-09-07T11:00:00Z'), lastSeen: Date.parse('2026-09-07T13:00:00Z'), vesselId: 'abc',
  });
  assert.equal(rows[2].name, 'UNKNOWN');
  assert.equal(rows[2].lastSeen, null, 'bez časov = null, nie NaN');
  assert.deepEqual(normalizeGfwPresence(null), []);
  assert.deepEqual(normalizeGfwPresence({ entries: 'x' }), []);
});

test('latestGfwCellPerVessel: jedna bunka na MMSI = najneskoršia, pri zhode viac hodín; identita sa dopĺňa z inej bunky tej istej lode; bez MMSI ostáva', () => {
  const rows = latestGfwCellPerVessel(normalizeGfwPresence(SAMPLE));
  const byMmsi = Object.fromEntries(rows.filter(r => r.mmsi).map(r => [r.mmsi, r]));
  assert.equal(rows.length, 3, '2 lode + 1 bez MMSI');
  assert.equal(byMmsi['663103000'].lat, 15.78, 'neskorší exitTimestamp vyhráva');
  assert.equal(byMmsi['663103000'].callsign, 'DAK1142', 'volací znak z prvej bunky ostal aj víťaznej');
  const nordic = byMmsi['211000000'];
  assert.equal(nordic.hours, 5, 'zhoda času → viac hodín');
  assert.equal(nordic.vesselId, 'id-anonymous', 'víťazí bunka bez mena…');
  assert.equal(nordic.name, 'NORDIC', '…ale meno prišlo z druhého ID tej istej lode');
  assert.equal(nordic.type, 'TANKER');
  assert.equal(nordic.flag, 'DEU');
  assert.equal(nordic.callsign, 'DABC');
  assert.equal(nordic.imo, '', 'chýbajúce pole ostáva prázdne, nič sa nevymýšľa');
  assert.ok(rows.some(r => r.mmsi === '' && r.name === 'UNKNOWN'));
});
