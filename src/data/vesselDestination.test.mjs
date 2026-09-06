// src/data/vesselDestination.test.mjs
// Cieľový prístav lode z AIS textu (2026-09-05). Vzorky sú SKUTOČNÉ reťazce
// odchytené zo živého feedu — práve ich neporiadok je dôvod, prečo je toto
// samostatný testovaný modul.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_DESTINATION_DISTANCE_KM,
  MIN_ETA_SPEED_KT,
  buildPortIndex,
  destinationCardLine,
  greatCircleKm,
  matchDestinationPort,
  nameKey,
  normalizeDestination,
  parseLocode,
  voyageToPort,
} from './vesselDestination.js';
import { EN_STRINGS, SK_STRINGS } from '../i18nStrings.js';

const t = (key, vars) => { let s = EN_STRINGS[key] || key; for (const [k, v] of Object.entries(vars || {})) s = s.replaceAll(`{${k}}`, String(v)); return s; };

const PORTS = [
  { id: 'wpi-1', geometry: { coordinates: [4.4, 51.95] }, properties: { name: 'Rotterdam', locode: 'NLRTM', country: 'Netherlands' } },
  { id: 'wpi-2', geometry: { coordinates: [9.97, 53.54] }, properties: { name: 'Hamburg', locode: 'DEHAM', country: 'Germany' } },
  { id: 'wpi-3', geometry: { coordinates: [100.6, 13.7] }, properties: { name: 'Bangkok', locode: 'THBKK', country: 'Thailand' } },
  { id: 'wpi-4', geometry: { coordinates: [133.72, 34.5] }, properties: { name: 'Mizushima', locode: 'JPMIZ', country: 'Japan' } },
  { id: 'wpi-5', geometry: { coordinates: [114.16, 22.3] }, properties: { name: 'Hong Kong', locode: 'HKHKG', country: 'Hong Kong' } },
  { id: 'wpi-6', geometry: { coordinates: [null, 10] }, properties: { name: 'Broken', locode: 'XXBRK' } },
];
const index = buildPortIndex(PORTS);

test('cieľ: normalizácia AIS textu — výplň, šum a posledný úsek plavby', () => {
  assert.equal(normalizeDestination('NLRTM'), 'NLRTM');
  assert.equal(normalizeDestination('INCHEON@@@@@@@@@@@'), 'INCHEON', 'výplňové @ (NULL v 6-bitovom AIS)');
  assert.equal(normalizeDestination('ECPSJ>JPYOK'), 'JPYOK', 'posledný úsek je cieľ');
  assert.equal(normalizeDestination('AUDBCT>>> FIKOK'), 'FIKOK');
  assert.equal(normalizeDestination('USNOLA>USCHS'), 'USCHS');
  assert.equal(normalizeDestination('US^09WQ>06NC'), '06NC');
  assert.equal(normalizeDestination('  hamburg  '), 'HAMBURG');
  assert.equal(normalizeDestination(''), '');
  assert.equal(normalizeDestination(null), '');
});

test('cieľ: LOCODE s medzerou aj bez nej; názov nie je LOCODE', () => {
  assert.equal(parseLocode('NLRTM'), 'NLRTM');
  assert.equal(parseLocode('TH BKK'), 'THBKK');
  assert.equal(parseLocode('EG PSD'), 'EGPSD');
  assert.equal(parseLocode('HAMBURG'), null);
  assert.equal(parseLocode('SAR'), null);
  assert.equal(nameKey('Hong Kong'), 'HONG KONG');
  assert.equal(nameKey('Sétubal'), 'SETUBAL', 'diakritika sa odstráni');
});

test('cieľ: index preskočí prístav bez súradníc a drží prvý zápis názvu', () => {
  assert.equal(index.byLocode.get('NLRTM').name, 'Rotterdam');
  assert.equal(index.byLocode.has('XXBRK'), false, 'prístav bez súradníc sa neindexuje');
  assert.equal(index.byName.get('HONG KONG').locode, 'HKHKG');
  assert.equal(buildPortIndex(null).size, 0);
});

test('cieľ: zhoda podľa LOCODE, presného názvu aj prefixu; nezmyselný text ostáva bez zhody', () => {
  assert.deepEqual(matchDestinationPort('NLRTM', index).port.name, 'Rotterdam');
  assert.equal(matchDestinationPort('TH BKK', index).matchedBy, 'locode');
  assert.equal(matchDestinationPort('HAMBURG', index).matchedBy, 'name');
  assert.equal(matchDestinationPort('HONG KONG', index).port.name, 'Hong Kong');
  assert.equal(matchDestinationPort('MIZUSHIMA JAPAN', index).matchedBy, 'prefix', 'názov + krajina');
  assert.equal(matchDestinationPort('ECPSJ>DEHAM', index).port.name, 'Hamburg', 'posledný úsek plavby');
  // Krátke skratky nesmú chytiť náhodný prístav — radšej nič než zlá čiara.
  assert.equal(matchDestinationPort('SAR', index), null);
  assert.equal(matchDestinationPort('PERAMA', index), null);
  assert.equal(matchDestinationPort('', index), null);
  assert.equal(matchDestinationPort('NLRTM', null), null);
});

test('plavba: vzdialenosť po veľkokružnici, ETA len keď loď pláva, nezmyselná diaľka bez čiary', () => {
  const rotterdam = index.byLocode.get('NLRTM');
  const nearDover = { lat: 51.0, lon: 1.4, speedKt: 12 };
  const voyage = voyageToPort(nearDover, rotterdam, Date.UTC(2026, 8, 5, 12));
  assert.ok(voyage.distanceKm > 200 && voyage.distanceKm < 350, `Dover → Rotterdam ≈ 250 km, dostal ${voyage.distanceKm}`);
  assert.ok(voyage.etaHours > 8 && voyage.etaHours < 16);
  assert.equal(voyage.etaMs, Date.UTC(2026, 8, 5, 12) + voyage.etaHours * 3_600_000);
  // Stojaca loď: vzdialenosť áno, ETA nie.
  const moored = voyageToPort({ ...nearDover, speedKt: MIN_ETA_SPEED_KT - 0.5 }, rotterdam);
  assert.equal(moored.etaHours, null);
  assert.equal(moored.etaMs, null);
  assert.equal(voyageToPort({ lat: NaN, lon: 0 }, rotterdam), null);
  assert.ok(greatCircleKm(0, 0, 0, 90) > 9900 && greatCircleKm(0, 0, 0, 90) < 10100, 'štvrtina rovníka');
  assert.equal(greatCircleKm(0, 0, NaN, 0), null);
  assert.ok(MAX_DESTINATION_DISTANCE_KM > 15_000);
});

test('plavba: riadok karty — prístav s kódom, vzdialenosť, ETA v hodinách alebo dňoch', () => {
  const match = matchDestinationPort('NLRTM', index);
  assert.equal(
    destinationCardLine(match, { distanceKm: 412, etaHours: 21 }, t),
    '→ Rotterdam (NLRTM) · 412 km to go · ETA ~21 h',
  );
  assert.match(destinationCardLine(match, { distanceKm: 8200, etaHours: 260 }, t), /ETA ~11 d/, 'dlhá plavba v dňoch');
  assert.equal(destinationCardLine(match, { distanceKm: 100, etaHours: null }, t), '→ Rotterdam (NLRTM) · 100 km to go');
  assert.equal(destinationCardLine(match, null, t), '→ Rotterdam (NLRTM)');
  assert.equal(destinationCardLine(null, null, t), '');
  for (const key of ['vessel.km-to-go', 'vessel.eta-hours', 'vessel.eta-days']) {
    assert.ok(EN_STRINGS[key], `EN ${key}`);
    assert.ok(SK_STRINGS[key], `SK ${key}`);
  }
});

test('cieľ: tripwire — vrstva lodí index načíta, kreslí čiaru a čistí ju pri zrušení výberu', () => {
  const ais = readFileSync(new URL('./aisLiveVessels.js', import.meta.url), 'utf8');
  assert.match(ais, /matchDestinationPort/);
  assert.match(ais, /createVesselVoyageLine/);
  assert.match(ais, /function loadPortIndex/);
  assert.match(ais, /state\.voyageLine\?\.clear\(\)/, 'zrušenie výberu čiaru zhasne');
  assert.match(ais, /resolveSelectedDestination\(record\)/);
  const line = readFileSync(new URL('./vesselVoyageLine.js', import.meta.url), 'utf8');
  assert.match(line, /registerPickOwner\('voyage-lines'/, 'klik na čiaru nesmie zrušiť výber');
  assert.match(line, /ArcType\.GEODESIC/);
});
