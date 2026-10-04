// src/data/flightHistoryStoreColumns.test.mjs — údaje navyše v histórii letov (2026-09-30).
// Používateľ: „chcem čo najviac informácií ukladať a nezáleží na veľkosti". Testy SPRÁVANIA:
// existujúci archív (schéma v2, mesiace dát) sa rozšíri bez straty a bez zmeny verzie, starší
// kód ho ďalej otvorí, novšiu verziu nikto nezmaže a nové polia sa naozaj zapíšu a vrátia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ADDITIVE_COLUMNS,
  LEGACY_DROP_BELOW,
  POS_SRC,
  SCHEMA_VERSION,
  schemaAction,
  fixFromAdsbLolAircraft,
  fixFromOpenSkyRow,
  openFlightHistory,
  openSkyCategoryFromReadsb,
  posSrcFromReadsbType,
  readsbExtrasJson,
} from './flightHistoryStore.js';

const T0 = 1_759_000_000;

// Presná kópia schémy v2 tak, ako ju vytvoril kód do 2026-09-30 (archív na D: je v nej).
const V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS fixes (
  icao24 TEXT NOT NULL,
  t INTEGER NOT NULL,
  lat INTEGER NOT NULL,
  lon INTEGER NOT NULL,
  alt INTEGER,
  gs INTEGER,
  trk INTEGER,
  vr INTEGER,
  squawk TEXT,
  gnd INTEGER NOT NULL DEFAULT 0,
  src TEXT,
  PRIMARY KEY (icao24, t)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fixes_t ON fixes(t);
CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icao24 TEXT NOT NULL,
  callsign TEXT NOT NULL DEFAULT '',
  country TEXT,
  first_t INTEGER NOT NULL,
  last_t INTEGER NOT NULL,
  fixes INTEGER NOT NULL DEFAULT 0,
  max_alt REAL,
  max_gs REAL,
  squawks TEXT,
  src TEXT
);
CREATE INDEX IF NOT EXISTS legs_icao ON legs(icao24, last_t);
CREATE INDEX IF NOT EXISTS legs_callsign ON legs(callsign);
CREATE INDEX IF NOT EXISTS legs_last ON legs(last_t);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;
// INSERT-y starého kódu (menujú stĺpce — nové stĺpce im nesmú prekážať).
const OLD_INSERT_FIX = `INSERT OR IGNORE INTO fixes (icao24, t, lat, lon, alt, gs, trk, vr, squawk, gnd, src)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const OLD_INSERT_LEG = `INSERT INTO legs (icao24, callsign, country, first_t, last_t, fixes, max_alt, max_gs, squawks, src)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`;

// OpenSky riadok so všetkými 18 slotmi (+ voliteľné sloty identity regionálnej náhrady).
const osRow = (icao, cs, t, { lon = 17.2, lat = 48.1, alt = 10000, geo = 10180, spi = false, posSrc = 0, cat = 4, ident = [] } = {}) => [
  icao, cs, 'Slovakia', t, t, lon, lat, alt, false, 230, 90, 0, null, geo, '1000', spi, posSrc, cat, ...ident,
];
const body = (time, rows) => JSON.stringify({ time, states: rows });

function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'oko-fhc-'));
  return { file: path.join(dir, 'h.sqlite'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function columnsOf(file, table) {
  const db = new DatabaseSync(file);
  try { return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name); } finally { db.close(); }
}

test('existujúci archív v2: otvorenie doplní stĺpce, nič nezmaže a verzia ostane 2', () => {
  const { file, cleanup } = tempDb();
  try {
    const raw = new DatabaseSync(file);
    raw.exec(V2_SCHEMA);
    raw.exec('PRAGMA user_version = 2');
    raw.prepare(OLD_INSERT_FIX).run('4b1805', T0, 4_810_000, 1_720_000, 10000, 2300, 900, 0, '1000', 0, 'opensky');
    raw.prepare(OLD_INSERT_LEG).run('4b1805', 'SWR11H', 'Switzerland', T0, T0, 10000, 230, '1000', 'opensky');
    raw.exec("INSERT INTO meta (key, value) VALUES ('fixes_count', 1), ('legs_count', 1)");
    raw.close();

    const store = openFlightHistory(file, { now: () => (T0 + 60) * 1000 });
    const st = store.status();
    assert.equal(st.fixes, 1, 'starý fix ostal');
    assert.equal(st.legs, 1, 'starý úsek ostal');
    const oldFix = store.track('4b1805')[0];
    assert.deepEqual(oldFix.slice(0, 9), [T0, 48.1, 17.2, 10000, 230, 90, 0, '1000', 0], 'staré hodnoty presne');
    assert.deepEqual(oldFix.slice(9), [null, null, null], 'nové polia starého fixu sú prázdne, nie vymyslené');
    const oldLeg = store.search('SWR')[0];
    assert.equal(oldLeg.callsign, 'SWR11H');
    assert.equal(oldLeg.registration, null);
    store.close();

    for (const [table, columns] of Object.entries(ADDITIVE_COLUMNS)) {
      const have = columnsOf(file, table);
      for (const [name] of columns) assert.ok(have.includes(name), `${table}.${name} pribudol`);
    }
    const check = new DatabaseSync(file);
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 2, 'verzia sa NEZVÝŠILA — starší kód archív nezahodí');
    assert.equal(SCHEMA_VERSION, 2);
    // Starší kód (iná vetva) zapisuje ďalej svojimi INSERT-mi.
    check.prepare(OLD_INSERT_FIX).run('4b1805', T0 + 30, 4_811_000, 1_721_000, 10100, 2310, 900, 0, '1000', 0, 'opensky');
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM fixes').get().n, 2);
    check.close();

    // Opakované otvorenie je nečinné (žiadne druhé ALTER, žiadna chyba) a dáta sú tam.
    const again = openFlightHistory(file, { now: () => (T0 + 60) * 1000 });
    assert.equal(again.track('4b1805').length, 2);
    again.close();
  } finally {
    cleanup();
  }
});

test('novšia verzia schémy: otvorenie zlyhá a NIČ sa nezmaže', () => {
  const { file, cleanup } = tempDb();
  try {
    const raw = new DatabaseSync(file);
    raw.exec(V2_SCHEMA);
    raw.prepare(OLD_INSERT_FIX).run('4b1805', T0, 1, 1, 1, 1, 1, 1, null, 0, 'opensky');
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    raw.close();
    assert.throws(() => openFlightHistory(file), /newer/);
    const check = new DatabaseSync(file);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM fixes').get().n, 1, 'dáta novšej verzie ostali');
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION + 1);
    check.close();
  } finally {
    cleanup();
  }
});

test('verzia schémy: zahodí sa len prastará dev cache (0/1); archív novšej aj staršej verzie bez migrácie sa odmietne, nezmaže', () => {
  assert.equal(schemaAction(2, 2), 'ok');
  assert.equal(schemaAction(0, 2), 'drop-legacy', 'prázdny súbor / pred 2026-09-07');
  assert.equal(schemaAction(1, 2), 'drop-legacy');
  assert.equal(schemaAction(3, 2), 'refuse-newer');
  // Budúce zvýšenie verzie bez napísanej migrácie nesmie zmazať mesiace dát.
  assert.equal(schemaAction(2, 3), 'refuse-no-migration');
  assert.equal(schemaAction(LEGACY_DROP_BELOW, LEGACY_DROP_BELOW + 5), 'refuse-no-migration');
  assert.equal(schemaAction(LEGACY_DROP_BELOW - 1, LEGACY_DROP_BELOW + 5), 'drop-legacy');
});

test('OpenSky riadok: geometrická výška, zdroj polohy, IDENT, kategória; identita regionálnej náhrady bez prevádzkovateľa', () => {
  const f = fixFromOpenSkyRow(osRow('4b1805', 'SWR11H', T0, { geo: 10180, spi: true, posSrc: 2, cat: 6 }), T0);
  assert.equal(f.geoAlt, 10180);
  assert.equal(f.posSrc, POS_SRC.MLAT);
  assert.equal(f.spi, 1);
  assert.equal(f.cat, 6);
  assert.equal(f.reg, null);
  const regional = fixFromOpenSkyRow(osRow('a1b2c3', 'UAL123', T0, { ident: ['B763', 'N397UP', 'UNITED PARCEL SERVICE CO', 'BOEING 767-300'] }), T0);
  assert.equal(regional.acType, 'B763');
  assert.equal(regional.reg, 'N397UP');
  assert.equal(regional.acDesc, 'BOEING 767-300');
  assert.doesNotMatch(JSON.stringify(regional), /UNITED PARCEL/, 'majiteľ/prevádzkovateľ sa neukladá (stroje, nie ľudia)');
  const bad = fixFromOpenSkyRow([...osRow('4b1805', 'X', T0).slice(0, 16), 9, 99], T0);
  assert.equal(bad.posSrc, null, 'mimo 0–3 nie je zdroj OpenSky');
  assert.equal(bad.cat, null, 'mimo 0–20 nie je kategória OpenSky');
});

test('adsb.lol záznam: výška GNSS, zdroj polohy z readsb type, kategória, identita a doplnky bez prevádzkovateľa a šumu prijímača', () => {
  const ac = {
    hex: 'ae0940', flight: 'RCH123 ', lat: 50, lon: 10, alt_baro: 32000, alt_geom: 32575, gs: 450, track: 270,
    baro_rate: -1000, squawk: '4501', seen_pos: 1, type: 'mlat', category: 'A5', r: '05-5139', t: 'C17',
    desc: 'BOEING C-17 Globemaster III', ownOp: 'United States Air Force', ias: 280, tas: 452, mach: 0.78,
    wd: 250, ws: 45, oat: -48, nav_qnh: 1013.6, nav_altitude_mcp: 32000, nav_heading: 268.2,
    nav_modes: ['autopilot', 'althold'], emergency: 'none', rssi: -21.4, messages: 12345, seen: 0.4, dbFlags: 1,
  };
  const f = fixFromAdsbLolAircraft(ac, 2_000_000);
  assert.ok(Math.abs(f.geoAlt - 32575 * 0.3048) < 1e-6);
  assert.equal(f.posSrc, POS_SRC.MLAT);
  assert.equal(f.cat, 6, 'A5 (Heavy) = OpenSky 6');
  assert.equal(f.reg, '05-5139');
  assert.equal(f.acType, 'C17');
  assert.equal(f.acDesc, 'BOEING C-17 Globemaster III');
  const extras = JSON.parse(f.x);
  assert.deepEqual(
    { ias: extras.ias, tas: extras.tas, mach: extras.mach, wd: extras.wd, ws: extras.ws, oat: extras.oat, nav_qnh: extras.nav_qnh,
      nav_altitude_mcp: extras.nav_altitude_mcp, nav_heading: extras.nav_heading, nav_modes: extras.nav_modes, emergency: extras.emergency, dbFlags: extras.dbFlags },
    { ias: 280, tas: 452, mach: 0.78, wd: 250, ws: 45, oat: -48, nav_qnh: 1013.6, nav_altitude_mcp: 32000, nav_heading: 268.2,
      nav_modes: ['autopilot', 'althold'], emergency: 'none', dbFlags: 1 },
  );
  assert.equal(extras.type, 'mlat', 'pôvod správy ostane aj surový');
  assert.doesNotMatch(f.x, /United States Air Force|ownOp/, 'prevádzkovateľ nie');
  for (const noise of ['rssi', 'messages', 'seen']) assert.equal(extras[noise], undefined, `${noise} nie`);
  assert.equal(readsbExtrasJson({ hex: 'x', lat: 1, lon: 2 }), null, 'bez doplnkov = null, nie „{}"');
  assert.equal(fixFromAdsbLolAircraft({ hex: 'abc123', lat: 1, lon: 2 }, 10).x, null);
});

test('mapovania: readsb type → zdroj polohy, readsb kategória → OpenSky', () => {
  assert.equal(posSrcFromReadsbType('adsb_icao'), POS_SRC.ADSB);
  assert.equal(posSrcFromReadsbType('adsb_icao_nt'), POS_SRC.ADSB);
  assert.equal(posSrcFromReadsbType('mlat'), POS_SRC.MLAT);
  assert.equal(posSrcFromReadsbType('tisb_trackfile'), POS_SRC.TISB);
  assert.equal(posSrcFromReadsbType('adsr_icao'), POS_SRC.ADSR);
  assert.equal(posSrcFromReadsbType('adsc'), POS_SRC.ADSC);
  assert.equal(posSrcFromReadsbType('mode_s'), null);
  assert.equal(posSrcFromReadsbType(undefined), null);
  // Rovnaké číslovanie ako regionálna náhrada (adsbLolFallback.js) + zvyšok zoznamu OpenSky.
  assert.deepEqual(['A1', 'A3', 'A7', 'B1', 'B4', 'B6', 'B7'].map(openSkyCategoryFromReadsb), [2, 4, 8, 9, 12, 14, 15]);
  assert.deepEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map(openSkyCategoryFromReadsb), [16, 17, 18, 19, 20]);
  assert.equal(openSkyCategoryFromReadsb('A0'), 1, '„bez informácie o kategórii"');
  assert.equal(openSkyCategoryFromReadsb('B5'), null, 'rezervované');
  assert.equal(openSkyCategoryFromReadsb('D2'), null);
  assert.equal(openSkyCategoryFromReadsb(''), null);
});

test('zápis a čítanie: nové polia sa uložia, stopa ich vráti na konci (staré indexy platia), úsek nesie identitu', () => {
  let nowMs = (T0 + 60) * 1000;
  const store = openFlightHistory(':memory:', { now: () => nowMs });
  // OpenSky: kategória 0 (bez informácie), bez registrácie.
  assert.equal(store.recordOpenSkyBody(body(T0, [osRow('ae0940', 'RCH123', T0, { geo: 9900, posSrc: 0, cat: 0 })])), 1);
  // Ten istý stroj z adsb.lol/mil o 30 s: kategória, registrácia, typ a doplnky.
  const mil = JSON.stringify({ now: (T0 + 31) * 1000, ac: [{ hex: 'ae0940', flight: 'RCH123', lat: 50.1, lon: 10.1, alt_baro: 33000, alt_geom: 33500, gs: 440, track: 90, seen_pos: 1, type: 'adsb_icao', category: 'A5', r: '05-5139', t: 'C17', desc: 'BOEING C-17 Globemaster III', ias: 285 }] });
  assert.equal(store.recordAdsbLolBody(mil), 1);
  // Ďalší mil fix s inou registráciou (chyba feedu) prvú neprepíše.
  const mil2 = JSON.stringify({ now: (T0 + 61) * 1000, ac: [{ hex: 'ae0940', flight: 'RCH123', lat: 50.2, lon: 10.2, alt_baro: 33000, seen_pos: 1, category: 'A3', r: 'XX-0000' }] });
  assert.equal(store.recordAdsbLolBody(mil2), 1);

  const legs = store.search('RCH');
  assert.equal(legs.length, 1, 'jeden úsek');
  assert.equal(legs[0].category, 6, 'kategória 0 sa prepísala prvou skutočnou (A5)');
  assert.equal(legs[0].registration, '05-5139', 'prvá registrácia ostáva');
  assert.equal(legs[0].typeCode, 'C17');
  assert.equal(legs[0].typeName, 'BOEING C-17 Globemaster III');

  const track = store.track('ae0940');
  assert.equal(track.length, 3);
  assert.equal(track[0][9], 9900, 'geoAlt z OpenSky');
  assert.equal(track[0][10], POS_SRC.ADSB);
  assert.equal(track[0][11], null);
  assert.equal(track[1][9], Math.round(33500 * 0.3048), 'geoAlt z adsb.lol v metroch');
  assert.equal(track[1][10], POS_SRC.ADSB);
  assert.deepEqual(track[1][11], { ias: 285, type: 'adsb_icao' }, 'doplnky ako objekt');
  assert.equal(track[1][3], Math.round(33000 * 0.3048), 'staré indexy (výška) nezmenené');

  // Regionálna náhrada: slot [16] je tam vždy 0 → zdroj polohy neznámy, nie „ADS-B".
  store.recordOpenSkyBody(body(T0 + 90, [osRow('a1b2c3', 'UAL123', T0 + 90, { posSrc: 0, ident: ['B763', 'N397UP', 'UPS', 'BOEING 767-300'] })]), 'adsb.lol/regional');
  const regionalFix = store.track('a1b2c3')[0];
  assert.equal(regionalFix[10], null);
  const regionalLeg = store.search('UAL')[0];
  assert.equal(regionalLeg.registration, 'N397UP');
  assert.equal(regionalLeg.typeCode, 'B763');
  store.close();
});
