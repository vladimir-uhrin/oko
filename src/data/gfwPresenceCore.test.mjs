// src/data/gfwPresenceCore.test.mjs
// GFW satelitná prítomnosť lodí (2026-09-12): výrez, okno = posledný úplný deň
// s exkluzívnym koncom, URL správy v oboch režimoch, CSV zo ZIPu, normalizácia
// JSON, posledná hodinová bunka na loď s dopĺňaním identity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GFW_DELAY_HOURS, GFW_MAX_BBOX_SPAN_DEG, GFW_MODES, GFW_PRESENCE_DATASET, GFW_SAR_DATASET, GFW_SAR_WINDOW_DAYS,
  gfwBboxError, gfwBboxPolygon, gfwPresenceCacheKey, gfwPresenceDateRange, gfwPreviousDayRange, gfwReportUrl, gfwSarDateRange, gfwTimeRangeMs,
  latestGfwCellPerVessel, latestGfwSarDetections, normalizeGfwPresence, parseCsvRecords, parseGfwBbox, parseGfwPresenceCsv, quantizeGfwBbox,
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

test('gfwPresenceDateRange: posledný ÚPLNÝ deň (D−4 pri 72 h), `to` je exkluzívny koniec = deň + 1; krok o deň späť', () => {
  const now = Date.UTC(2026, 8, 12, 12, 0, 0); // 12. 9. 2026 12:00 Z
  const r = gfwPresenceDateRange(now);
  assert.equal(r.delayHours, GFW_DELAY_HOURS);
  // 12. 9. 12:00 − 72 h = 9. 9. 12:00 → deň pred = 8. 9. (naživo 2026-09-12: dni 4.–8. 9. dostupné, 9. nie)
  assert.deepEqual(r, { day: '2026-09-08', from: '2026-09-08', to: '2026-09-09', delayHours: 72 });
  assert.equal(gfwPresenceDateRange(now, { delayHours: 0 }).day, '2026-09-11');
  assert.deepEqual(gfwPreviousDayRange(r), { day: '2026-09-07', from: '2026-09-07', to: '2026-09-08', delayHours: 72 });
  assert.equal(gfwPresenceCacheKey({ west: 47, south: 23, east: 60, north: 31 }, r), '47,23,60,31@2026-09-08');
});

test('gfwReportUrl: hlavný režim HIGH + HOURLY + CSV, záložný LOW + ENTIRE + JSON; group-by VESSEL_ID; rozsah from,to', () => {
  const range = { day: '2026-09-08', from: '2026-09-08', to: '2026-09-09' };
  const url = new URL(gfwReportUrl(range));
  assert.equal(url.origin + url.pathname, 'https://gateway.api.globalfishingwatch.org/v3/4wings/report');
  assert.equal(url.searchParams.get('spatial-resolution'), 'HIGH', '0,01° — inak lode stoja v stĺpcoch mriežky 0,1°');
  assert.equal(url.searchParams.get('temporal-resolution'), 'HOURLY', 'len HOURLY má čas na bunku; pri ENTIRE sú pečiatky za celú loď');
  assert.equal(url.searchParams.get('format'), 'CSV', 'ZIP s CSV je 6× menší než JSON');
  assert.equal(url.searchParams.get('group-by'), 'VESSEL_ID', 'po ID lode nesie správa meno, typ, vlajku, volací znak a IMO');
  assert.equal(url.searchParams.get('datasets[0]'), GFW_PRESENCE_DATASET);
  assert.equal(url.searchParams.get('date-range'), '2026-09-08,2026-09-09');
  const fallback = new URL(gfwReportUrl(range, { mode: GFW_MODES.dayCell }));
  assert.equal(fallback.searchParams.get('spatial-resolution'), 'LOW');
  assert.equal(fallback.searchParams.get('temporal-resolution'), 'ENTIRE');
  assert.equal(fallback.searchParams.get('format'), 'JSON');
  assert.equal(GFW_MODES.hourly.cellDeg, 0.01);
  assert.equal(GFW_MODES.dayCell.cellDeg, 0.1);
});

test('parseCsvRecords: úvodzovky, zdvojené úvodzovky, čiarka a nový riadok v poli, CRLF, koncová čiarka, prázdne riadky', () => {
  const text = 'a,b,c\r\n1,"x, y","he said ""hi"""\r\n\r\n2,"multi\nline",\n3,,\n';
  assert.deepEqual(parseCsvRecords(text), [
    ['a', 'b', 'c'],
    ['1', 'x, y', 'he said "hi"'],
    ['2', 'multi\nline', ''],
    ['3', '', ''],
  ]);
  assert.deepEqual(parseCsvRecords(''), []);
  assert.deepEqual(parseCsvRecords('solo'), [['solo']]);
});

test('gfwTimeRangeMs: hodinový kôš, samotný deň, nezmysel', () => {
  assert.equal(gfwTimeRangeMs('2026-09-08 04:00'), Date.UTC(2026, 8, 8, 4, 0, 0));
  assert.equal(gfwTimeRangeMs('2026-09-08T23:00'), Date.UTC(2026, 8, 8, 23, 0, 0));
  assert.equal(gfwTimeRangeMs('2026-09-08'), Date.UTC(2026, 8, 8, 0, 0, 0));
  assert.equal(gfwTimeRangeMs('2026-09-07,2026-09-08'), Date.UTC(2026, 8, 7, 0, 0, 0), 'rozsah ENTIRE → začiatok');
  assert.equal(gfwTimeRangeMs(''), null);
  assert.equal(gfwTimeRangeMs(null), null);
});

const CSV = [
  'Lat,Lon,Time Range,Vessel ID,Flag,Vessel Name,Entry Timestamp,Exit Timestamp,Gear Type,Vessel Type,MMSI,IMO,CallSign,First Transmission Date,Last Transmission Date,Vessel Presence Hours',
  '25.190000,56.410000,2026-09-08 04:00,0483d64b0,MUS,DN 30,2026-09-08T00:00:00Z,2026-09-08T23:00:00Z,OTHER,OTHER,645164000,8821735,3BLQ,2012-01-12T09:41:22Z,2026-09-10T07:24:30Z,1.00',
  '25.540000,57.810001,2026-09-08 09:00,dba991cbc,IRN,"+(!,)`% ""278""",2026-09-08T07:00:00Z,2026-09-08T22:00:00Z,GEAR,GEAR,422002100,,,2026-09-03T16:04:01Z,2026-09-10T22:01:40Z,1.00',
  '91,4,2026-09-08 09:00,bad,NLD,VLISSINGEN,,,CARGO,CARGO,244660815,,,,,1.00',
  '26.610000,56.240002,2026-09-07 05:00,9f0c,IRN,MANZAR2,2026-09-07T04:00:00Z,2026-09-07T07:00:00Z,OTHER,CARGO,620800157,,,,,1.00',
  '',
].join('\r\n');

test('parseGfwPresenceCsv: hlavička 4Wings → náš tvar; Time Range je firstSeen aj lastSeen; zlé súradnice vypadnú; úvodzovky v mene', () => {
  const rows = parseGfwPresenceCsv(CSV);
  assert.equal(rows.length, 3, 'riadok s lat 91 vypadol, prázdny riadok tiež');
  assert.deepEqual(rows[0], {
    mmsi: '645164000', name: 'DN 30', type: 'OTHER', flag: 'MUS', callsign: '3BLQ', imo: '8821735',
    lat: 25.19, lon: 56.41, hours: 1, detections: 0, firstSeen: Date.UTC(2026, 8, 8, 4), lastSeen: Date.UTC(2026, 8, 8, 4), vesselId: '0483d64b0',
  });
  assert.equal(rows[1].name, '+(!,)`% "278"', 'čiarka aj zdvojené úvodzovky v mene');
  assert.equal(rows[1].imo, '');
  assert.equal(rows[1].callsign, '');
  assert.equal(rows[2].mmsi, '620800157');
  assert.deepEqual(parseGfwPresenceCsv(''), []);
  assert.deepEqual(parseGfwPresenceCsv('foo,bar\n1,2\n'), [], 'bez Lat/Lon nie je čo čítať');
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
    detections: 0, firstSeen: Date.parse('2026-09-07T11:00:00Z'), lastSeen: Date.parse('2026-09-07T13:00:00Z'), vesselId: 'abc',
  });
  assert.equal(rows[2].name, 'UNKNOWN');
  assert.equal(rows[2].lastSeen, null, 'bez časov = null, nie NaN');
  assert.deepEqual(normalizeGfwPresence(null), []);
  assert.deepEqual(normalizeGfwPresence({ entries: 'x' }), []);
});

test('latestGfwCellPerVessel (denné bunky): najneskoršia bunka, pri zhode viac hodín; hodiny sa sčítajú; identita z inej bunky; bez MMSI ostáva', () => {
  const rows = latestGfwCellPerVessel(normalizeGfwPresence(SAMPLE));
  const byMmsi = Object.fromEntries(rows.filter(r => r.mmsi).map(r => [r.mmsi, r]));
  assert.equal(rows.length, 3, '2 lode + 1 bez MMSI');
  assert.equal(byMmsi['663103000'].lat, 15.78, 'neskorší exitTimestamp vyhráva');
  assert.equal(byMmsi['663103000'].hours, 2.38, 'súčet hodín za všetky bunky lode');
  assert.equal(byMmsi['663103000'].firstSeen, Date.parse('2026-09-07T11:00:00Z'), 'prvá pečiatka zo staršej bunky');
  assert.equal(byMmsi['663103000'].callsign, 'DAK1142', 'volací znak z prvej bunky ostal aj víťaznej');
  const nordic = byMmsi['211000000'];
  assert.equal(nordic.vesselId, 'id-anonymous', 'zhoda času → víťazí bunka s viac hodinami, hoci bez mena…');
  assert.equal(nordic.hours, 7);
  assert.equal(nordic.name, 'NORDIC', '…ale meno prišlo z druhého ID tej istej lode');
  assert.equal(nordic.type, 'TANKER');
  assert.equal(nordic.flag, 'DEU');
  assert.equal(nordic.callsign, 'DABC');
  assert.equal(nordic.imo, '', 'chýbajúce pole ostáva prázdne, nič sa nevymýšľa');
  assert.ok(rows.some(r => r.mmsi === '' && r.name === 'UNKNOWN'));
});

test('latestGfwCellPerVessel (hodinové bunky): posledná hodina dňa vyhráva bez ohľadu na hodiny bunky; súčet hodín, prvá a posledná hodina', () => {
  const hour = (h) => Date.UTC(2026, 8, 8, h);
  const cell = (h, lat, lon, extra = {}) => ({ mmsi: '620800157', name: 'MANZAR2', type: 'CARGO', flag: 'IRN', callsign: '', imo: '', lat, lon, hours: 1, firstSeen: hour(h), lastSeen: hour(h), vesselId: '9f0c', ...extra });
  const rows = latestGfwCellPerVessel([
    cell(4, 26.65, 56.25), cell(5, 26.61, 56.24), cell(7, 26.32, 56.24), cell(6, 26.44, 56.24, { hours: 0.4 }),
    { mmsi: '645164000', name: '', type: '', flag: '', callsign: '', imo: '', lat: 25.19, lon: 56.41, hours: 1, firstSeen: hour(2), lastSeen: hour(2), vesselId: 'x' },
    { mmsi: '645164000', name: 'DN 30', type: 'OTHER', flag: 'MUS', callsign: '3BLQ', imo: '8821735', lat: 25.19, lon: 56.41, hours: 1, firstSeen: hour(1), lastSeen: hour(1), vesselId: 'y' },
  ]);
  const manzar = rows.find((r) => r.mmsi === '620800157');
  assert.equal(manzar.lat, 26.32, 'bunka z 07:00 — loď ide na juh, posledná hodina je posledná poloha');
  assert.equal(manzar.lastSeen, hour(7));
  assert.equal(manzar.firstSeen, hour(4));
  assert.equal(manzar.hours, 3.4);
  const dn30 = rows.find((r) => r.mmsi === '645164000');
  assert.equal(dn30.vesselId, 'x', 'novšia hodina (02:00) vyhráva…');
  assert.equal(dn30.name, 'DN 30', '…a identita sa doplní z 01:00');
  assert.equal(dn30.callsign, '3BLQ');
});

test('gfwSarDateRange: posledných N dní vrátane dneška, exkluzívny zajtrajšok, kľúč = dnešok; URL radaru', () => {
  const now = Date.UTC(2026, 8, 12, 16, 0, 0);
  assert.deepEqual(gfwSarDateRange(now), { day: '2026-09-12', from: '2026-09-02', to: '2026-09-13', days: 10 });
  assert.equal(GFW_SAR_WINDOW_DAYS, 10);
  assert.deepEqual(gfwSarDateRange(now, { days: 3 }), { day: '2026-09-12', from: '2026-09-09', to: '2026-09-13', days: 3 });
  const url = new URL(gfwReportUrl(gfwSarDateRange(now), { dataset: GFW_SAR_DATASET, mode: GFW_MODES.sarDay }));
  assert.equal(url.searchParams.get('datasets[0]'), 'public-global-sar-presence:latest');
  assert.equal(url.searchParams.get('temporal-resolution'), 'DAILY', 'záloha radaru drží deň preletu');
  assert.equal(url.searchParams.get('spatial-resolution'), 'LOW');
  assert.equal(url.searchParams.get('date-range'), '2026-09-02,2026-09-13');
  assert.equal(GFW_MODES.sarDay.cellDeg, 0.1);
});

const SAR_CSV = [
  'Lat,Lon,Time Range,Vessel ID,Flag,Vessel Name,Entry Timestamp,Exit Timestamp,Gear Type,Vessel Type,MMSI,IMO,CallSign,First Transmission Date,Last Transmission Date,Detections',
  '26.930000,56.310001,2026-09-07 14:00,,,,2026-09-03T02:14:17Z,2026-09-09T02:14:53Z,,,,,,,,1',
  '26.930000,56.310001,2026-09-09 02:00,,,,2026-09-03T02:14:17Z,2026-09-09T02:14:53Z,,,,,,,,2',
  '25.400000,56.500000,2026-09-07 14:00,01a6de42e,PAN,GALAXY,2026-09-07T14:16:17Z,2026-09-09T02:14:53Z,CARGO,CARGO,374969000,9287156,3ELF5,2018-12-20T10:44:22Z,2026-09-10T23:59:27Z,1',
  '25.410000,56.520000,2026-09-09 02:00,01a6de42e,PAN,,2026-09-07T14:16:17Z,2026-09-09T02:14:53Z,CARGO,,374969000,,,,,1',
  '25.940000,55.840000,2026-09-03 02:00,,,,2026-09-03T02:14:17Z,2026-09-09T02:14:53Z,,,,,,,,1',
].join('\n');

test('parseGfwPresenceCsv (radar): stĺpec Detections, prázdna identita = bez zhody, čas preletu z Time Range', () => {
  const rows = parseGfwPresenceCsv(SAR_CSV);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].detections, 1);
  assert.equal(rows[0].hours, 0);
  assert.equal(rows[0].mmsi, '');
  assert.equal(rows[0].vesselId, '');
  assert.equal(rows[0].lastSeen, Date.UTC(2026, 8, 7, 14), 'Entry/Exit sú za región — čas je z Time Range');
  assert.equal(rows[2].name, 'GALAXY');
  assert.equal(rows[2].detections, 1);
});

test('latestGfwSarDetections: loď so zhodou = posledný prelet + identita z iného riadku; bez zhody = jedna značka na bunku, detekcie sa sčítajú', () => {
  const out = latestGfwSarDetections(parseGfwPresenceCsv(SAR_CSV));
  assert.equal(out.length, 3, 'GALAXY ×1, bunka 26.93/56.31 ×1, bunka 25.94/55.84 ×1');
  const galaxy = out.find((r) => r.key === 'v:374969000');
  assert.equal(galaxy.matched, true);
  assert.equal(galaxy.lat, 25.41, 'posledný prelet 9. 9. 02:00 vyhráva');
  assert.equal(galaxy.lastSeen, Date.UTC(2026, 8, 9, 2));
  assert.equal(galaxy.firstSeen, Date.UTC(2026, 8, 7, 14));
  assert.equal(galaxy.name, 'GALAXY', 'meno doplnené z riadku zo 7. 9.');
  assert.equal(galaxy.callsign, '3ELF5');
  assert.equal(galaxy.imo, '9287156');
  assert.equal(galaxy.detections, 2);
  const dark = out.find((r) => r.key === 'c:26.93,56.310001');
  assert.equal(dark.matched, false);
  assert.equal(dark.detections, 3, '1 + 2 detekcie v tej istej bunke');
  assert.equal(dark.lastSeen, Date.UTC(2026, 8, 9, 2));
  assert.equal(dark.name, '');
  assert.equal(out.find((r) => r.key === 'c:25.94,55.84').detections, 1);
  assert.deepEqual(latestGfwSarDetections([]), []);
});

test('normalizeGfwPresence: DAILY/HOURLY JSON berie čas bunky z `date`, ENTIRE rozsah s čiarkou nie; nesie detections', () => {
  const rows = normalizeGfwPresence({ entries: [{ x: [
    { lat: 26.9, lon: 56.4, detections: 8, date: '2026-09-07', entryTimestamp: '2026-09-03T02:14:17Z', exitTimestamp: '2026-09-09T02:14:53Z' },
    { lat: 26.9, lon: 56.4, hours: 2, date: '2026-09-07,2026-09-08', entryTimestamp: '2026-09-07T00:00:00Z', exitTimestamp: '2026-09-07T23:00:00Z' },
  ] }] });
  assert.equal(rows[0].lastSeen, Date.UTC(2026, 8, 7), 'deň preletu, nie regionálny exit');
  assert.equal(rows[0].firstSeen, Date.UTC(2026, 8, 7));
  assert.equal(rows[0].detections, 8);
  assert.equal(rows[1].lastSeen, Date.parse('2026-09-07T23:00:00Z'), 'ENTIRE: rozsah s čiarkou → ostáva exit');
  assert.equal(rows[1].detections, 0);
});
