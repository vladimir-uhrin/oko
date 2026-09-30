// src/data/flightHistoryStore.js
/**
 * @module flightHistoryStore
 * @description Serverové úložisko histórie letov (2026-09-07, používateľ:
 * „chcem spätne nájsť let, trackovať ho, dobré grafické zobrazenie").
 *
 * Beží LEN v Node (dev proxy vo vite.config.js), nikdy v prehliadači.
 * SQLite cez vstavané `node:sqlite` — žiadna závislosť, jeden súbor
 * v `.gev-cache/` (gitignored). Zdroj sú tie isté odpovede, ktoré proxy už
 * posiela klientovi (OpenSky /states aj adsb.lol /v2/mil): obal nad
 * `res.end` ich zapíše bez druhého dopytu na upstream — žiadny nový zdroj,
 * žiadne nové podmienky (OpenSky aj adsb.lol už sú v DATA_SOURCES.md).
 *
 * Model:
 *  - `fixes`  — jeden riadok na (stroj, čas fixu); PK bráni duplicitám
 *               z cache HIT odpovedí (ten istý snímok príde viackrát).
 *  - `legs`   — „let" = súvislý úsek jedného draku s jedným volacím znakom;
 *               keď sa volací znak zmení alebo je medzera > LEG_GAP_S,
 *               začne nový úsek. Vyhľadávanie ide cez legs.
 *  - retencia FLIGHT_HISTORY_RETENTION_DAYS (default 7) — prune raz za hodinu.
 *
 * Objem (meranie 2026-09-07): ~13 000 strojov × 2 polly/min ≈ 37 M fixov
 * denne. Preto sa hodnoty ukladajú ako CELÉ ČÍSLA (lat/lon × 1e5 ≈ 1 m,
 * gs/trk/vr × 10) — SQLite ich kóduje na 1–4 B, riadok ≈ 30 B + index — a
 * fixy staršie než RAW_HOURS sa preriedia na THIN_STEP_S (2 min), takže
 * týždeň zaberie jednotky GB, nie desiatky. Detail posledného dňa ostáva plný.
 *
 * Jednotky v API: metre, m/s, stupne, epoch sekundy (ako OpenSky).
 *
 * Doplnkové údaje (2026-09-30, používateľ: „chcem čo najviac informácií
 * ukladať a nezáleží na veľkosti"): geometrická výška, zdroj polohy, IDENT,
 * kategória vysielača, registrácia a typ stroja, surové doplnky readsb
 * (rýchlosti IAS/TAS/Mach, vietor, nastavenia autopilota…). Pridávajú sa ako
 * STĹPCE NAVYŠE (ALTER TABLE ADD COLUMN) bez zmeny user_version, takže starší
 * kód z inej vetvy databázu otvorí a nič nezahodí. Majiteľ/prevádzkovateľ
 * (readsb `ownOp`) sa zámerne NEUKLADÁ — etická čiara: sledujeme stroje, nie ľudí.
 */
import { DatabaseSync } from 'node:sqlite';

export const FLIGHT_HISTORY_DEFAULT_RETENTION_DAYS = 7;
/** Medzera medzi fixmi, po ktorej sa začne nový úsek (s). */
export const LEG_GAP_S = 30 * 60;
/**
 * Pri importe celých stôp readsb (adsblolTrace.js) nový let určuje hlavne príznak readsb
 * „začiatok úseku" (readsb vie, či stroj pristál); medzera v pokrytí za letu (more, hory) nemá
 * let rozdeliť — delí sa až pri medzere nad 2 h.
 */
export const TRACE_LEG_GAP_S = 2 * 3600;
export const SEARCH_LIMIT_MAX = 200;
export const TRACK_LIMIT_MAX = 20_000;
/** Plný záznam (každý poll) sa drží toľkoto hodín; staršie sa preriedia. */
export const RAW_HOURS = 24;
/** Krok preriedenia starších fixov (s): zostane ~jeden fix za 2 minúty. */
export const THIN_STEP_S = 120;
/**
 * Verzia schémy (pravidlá v schemaAction): prastará 0/1 (REAL stĺpce) sa
 * zahodí; novšia ani staršia bez napísanej migrácie sa NIKDY nezahadzuje —
 * otvorenie zlyhá. Nové údaje pribúdajú cez ADDITIVE_COLUMNS, nie zvýšením verzie.
 */
export const SCHEMA_VERSION = 2;
/** Verzie pod touto (0/1: REAL stĺpce, dev cache spred 2026-09-07) sa smú zahodiť. */
export const LEGACY_DROP_BELOW = 2;

/**
 * Čo spraviť s databázou danej verzie. Pure. Archív (≥ LEGACY_DROP_BELOW) sa
 * NIKDY nezahadzuje: novšia verzia aj staršia bez napísanej migrácie = odmietnuť.
 * @returns {'ok'|'drop-legacy'|'refuse-newer'|'refuse-no-migration'}
 */
export function schemaAction(version, current = SCHEMA_VERSION) {
  if (version === current) return 'ok';
  if (version > current) return 'refuse-newer';
  if (version < LEGACY_DROP_BELOW) return 'drop-legacy';
  return 'refuse-no-migration';
}
/**
 * Stĺpce navyše k schéme verzie 2 (2026-09-30). Doplnia sa pri otvorení, ak
 * chýbajú; staré riadky v nich majú NULL.
 */
export const ADDITIVE_COLUMNS = Object.freeze({
  fixes: Object.freeze([
    ['geo_alt', 'INTEGER'], // m, geometrická (GNSS) výška
    ['pos_src', 'INTEGER'], // POS_SRC: 0 ADS-B, 1 ASTERIX, 2 MLAT, 3 FLARM, 4 TIS-B, 5 ADS-R, 6 ADS-C
    ['spi', 'INTEGER'],     // 1 = IDENT (special position indicator)
    ['x', 'TEXT'],          // JSON surových doplnkov readsb (READSB_EXTRA_FIELDS, jednotky readsb)
  ]),
  legs: Object.freeze([
    ['cat', 'INTEGER'],     // kategória vysielača, číslovanie OpenSky 0–20
    ['reg', 'TEXT'],        // registrácia (readsb r)
    ['ac_type', 'TEXT'],    // typový kód ICAO (readsb t)
    ['ac_desc', 'TEXT'],    // plný názov typu (readsb desc)
  ]),
});
/**
 * Zdroj polohy: 0–3 presne podľa OpenSky `position_source`, 4–6 rozšírenie
 * pre readsb `type` (adsb.lol). Bez polohy z daného typu = null.
 */
export const POS_SRC = Object.freeze({ ADSB: 0, ASTERIX: 1, MLAT: 2, FLARM: 3, TISB: 4, ADSR: 5, ADSC: 6 });
/**
 * Doplnky readsb, ktoré sa ukladajú ako JSON do `fixes.x` (hodnoty bez
 * prevodu, v jednotkách readsb: kt, ft, ft/min, °C, hPa). Zámerne CHÝBA
 * `ownOp` (majiteľ/prevádzkovateľ = osoba alebo firma) a prijímačové šumy
 * (rssi, messages, seen).
 */
export const READSB_EXTRA_FIELDS = Object.freeze([
  'ias', 'tas', 'mach', 'oat', 'tat', 'wd', 'ws',
  'track_rate', 'roll', 'mag_heading', 'true_heading', 'geom_rate',
  'nav_qnh', 'nav_altitude_mcp', 'nav_altitude_fms', 'nav_heading', 'nav_modes',
  'emergency', 'alert', 'nic', 'rc', 'nic_baro', 'nac_p', 'nac_v', 'sil', 'sil_type', 'gva', 'sda',
  'version', 'dbFlags', 'type',
]);
// readsb kategória vysielača (DO-260) → číslovanie OpenSky (to isté ako adsbLolFallback.js).
const OPENSKY_CATEGORY = Object.freeze({
  A0: 1, A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8,
  B0: 1, B1: 9, B2: 10, B3: 11, B4: 12, B6: 14, B7: 15,
  C0: 1, C1: 16, C2: 17, C3: 18, C4: 19, C5: 20,
});
const SCALE_DEG = 1e5;
const SCALE_TENTH = 10;
const FT_TO_M = 0.3048;
const KT_TO_MPS = 0.514444;
const FPM_TO_MPS = 0.00508;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fixes (
  icao24 TEXT NOT NULL,
  t INTEGER NOT NULL,
  lat INTEGER NOT NULL,   -- deg × 1e5
  lon INTEGER NOT NULL,   -- deg × 1e5
  alt INTEGER,            -- m
  gs INTEGER,             -- m/s × 10
  trk INTEGER,            -- deg × 10
  vr INTEGER,             -- m/s × 10
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

// null/undefined/'' → null (Number(null) je 0 — chýbajúca výška nie je hladina mora).
const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
/** Orezaný neprázdny text, inak null. */
const cleanText = (v) => {
  if (typeof v !== 'string') return null;
  const text = v.trim();
  return text || null;
};
const intInRange = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

/** readsb `type` (pôvod správy) → POS_SRC; typy bez vlastnej polohy = null. Pure. */
export function posSrcFromReadsbType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  if (t.startsWith('adsb_')) return POS_SRC.ADSB;
  if (t === 'mlat') return POS_SRC.MLAT;
  if (t.startsWith('tisb_')) return POS_SRC.TISB;
  if (t.startsWith('adsr_')) return POS_SRC.ADSR;
  if (t === 'adsc') return POS_SRC.ADSC;
  return null;
}

/** readsb kategória (A3, B6…) → číslovanie OpenSky; neznáma = null. Pure. */
export function openSkyCategoryFromReadsb(code) {
  const key = String(code ?? '').trim().toUpperCase();
  return Object.hasOwn(OPENSKY_CATEGORY, key) ? OPENSKY_CATEGORY[key] : null;
}

/** Vybrané doplnky readsb → JSON text (len prítomné hodnoty), inak null. Pure. */
export function readsbExtrasJson(ac) {
  if (!ac || typeof ac !== 'object') return null;
  const out = {};
  let any = false;
  for (const key of READSB_EXTRA_FIELDS) {
    const v = ac[key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' || typeof v === 'boolean')) {
      out[key] = v;
      any = true;
    } else if (Array.isArray(v) && v.every((item) => typeof item === 'string')) {
      out[key] = v;
      any = true;
    }
  }
  return any ? JSON.stringify(out) : null;
}

/**
 * OpenSky `states` riadok → fix. Pure. Null bez polohy.
 * Sloty [18], [19], [21] (typ, registrácia, názov typu) posiela len regionálna
 * náhrada adsb.lol (adsbLolFallback.js); slot [20] (prevádzkovateľ) sa neukladá.
 * @param {Array} row
 * @param {number} fallbackT epoch s odpovede
 */
export function fixFromOpenSkyRow(row, fallbackT) {
  if (!Array.isArray(row) || typeof row[0] !== 'string') return null;
  const lon = finite(row[5]);
  const lat = finite(row[6]);
  if (lat === null || lon === null) return null;
  const t = finite(row[3]) ?? finite(row[4]) ?? fallbackT;
  if (!Number.isFinite(t)) return null;
  return {
    icao24: row[0].trim().toLowerCase(),
    callsign: String(row[1] ?? '').trim().toUpperCase(),
    country: typeof row[2] === 'string' ? row[2] : null,
    t: Math.round(t),
    lat,
    lon,
    alt: finite(row[7]) ?? finite(row[13]),
    gs: finite(row[9]),
    trk: finite(row[10]),
    vr: finite(row[11]),
    squawk: row[14] ? String(row[14]).trim() : null,
    gnd: row[8] === true ? 1 : 0,
    geoAlt: finite(row[13]),
    posSrc: intInRange(row[16], 0, 3),
    spi: row[15] === true ? 1 : 0,
    cat: intInRange(row[17], 0, 20),
    acType: cleanText(row[18]),
    reg: cleanText(row[19]),
    acDesc: cleanText(row[21]),
    x: null,
  };
}

/**
 * adsb.lol /v2 `ac` záznam → fix (stopy → metre, kt → m/s, ft/min → m/s). Pure.
 * @param {object} ac
 * @param {number} nowS epoch s odpovede
 */
export function fixFromAdsbLolAircraft(ac, nowS) {
  if (!ac || typeof ac.hex !== 'string') return null;
  const lat = finite(ac.lat);
  const lon = finite(ac.lon);
  if (lat === null || lon === null) return null;
  const ground = ac.alt_baro === 'ground';
  const altFt = ground ? 0 : finite(ac.alt_baro) ?? finite(ac.alt_geom);
  const seen = finite(ac.seen_pos) ?? 0;
  const t = Math.round((Number.isFinite(nowS) ? nowS : Date.now() / 1000) - seen);
  const geoFt = finite(ac.alt_geom);
  return {
    icao24: ac.hex.trim().toLowerCase().replace(/^~/, ''),
    callsign: String(ac.flight ?? '').trim().toUpperCase(),
    country: null,
    t,
    lat,
    lon,
    alt: altFt === null ? null : altFt * FT_TO_M,
    gs: finite(ac.gs) === null ? null : finite(ac.gs) * KT_TO_MPS,
    trk: finite(ac.track),
    vr: finite(ac.baro_rate) === null ? null : finite(ac.baro_rate) * FPM_TO_MPS,
    squawk: ac.squawk ? String(ac.squawk).trim() : null,
    gnd: ground ? 1 : 0,
    geoAlt: geoFt === null ? null : geoFt * FT_TO_M,
    posSrc: posSrcFromReadsbType(ac.type),
    spi: ac.spi === 1 || ac.spi === true ? 1 : 0,
    cat: openSkyCategoryFromReadsb(ac.category),
    acType: cleanText(ac.t),
    reg: cleanText(ac.r),
    acDesc: cleanText(ac.desc),
    x: readsbExtrasJson(ac),
  };
}

/**
 * Rozdeľ chronologické body stopy na úseky (lety): nový úsek pri príznaku readsb „začiatok
 * úseku" (`newLeg`), medzere nad `gapS` alebo zmene volacieho znaku. Pure.
 * @returns {{start: number, end: number, callsign: string, firstT: number, lastT: number,
 *   maxAlt: number|null, maxGs: number|null, squawks: string[], cat: number|null}[]}
 */
export function splitLegs(points, gapS = LEG_GAP_S) {
  const legs = [];
  let cur = null;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const split = !cur
      || p.newLeg
      || p.t - points[i - 1].t > gapS
      || (p.callsign && cur.callsign && p.callsign !== cur.callsign);
    if (split) {
      cur = { start: i, end: i, callsign: p.callsign || '', firstT: p.t, lastT: p.t, maxAlt: null, maxGs: null, squawks: [], cat: null };
      legs.push(cur);
    }
    cur.end = i;
    cur.lastT = p.t;
    if (!cur.callsign && p.callsign) cur.callsign = p.callsign;
    if (p.alt !== null && p.alt !== undefined && (cur.maxAlt === null || p.alt > cur.maxAlt)) cur.maxAlt = p.alt;
    if (p.gs !== null && p.gs !== undefined && (cur.maxGs === null || p.gs > cur.maxGs)) cur.maxGs = p.gs;
    if (p.squawk && !cur.squawks.includes(p.squawk)) cur.squawks.push(p.squawk);
    if (p.cat !== null && p.cat !== undefined && (cur.cat === null || cur.cat <= 1)) cur.cat = p.cat;
  }
  return legs;
}

/** Normalizuj dopyt: hex (6 hex znakov), inak volací znak / prefix. Pure. */
export function normalizeSearchQuery(raw) {
  const q = String(raw ?? '').trim().toUpperCase();
  if (!q) return { text: '', hex: null };
  const hex = /^[0-9A-F]{6}$/.test(q) ? q.toLowerCase() : null;
  return { text: q.replace(/[%_]/g, ''), hex };
}

/**
 * Otvor (alebo vytvor) úložisko.
 * @param {string} dbPath cesta k súboru alebo ':memory:'
 * @param {object} [options]
 * @param {number} [options.retentionDays]
 * @param {() => number} [options.now] epoch ms (test seam)
 */
export function openFlightHistory(dbPath, { retentionDays = FLIGHT_HISTORY_DEFAULT_RETENTION_DAYS, rawHours = RAW_HOURS, now = Date.now } = {}) {
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    // Iné spojenie (skript, osirelé vlákno) môže krátko držať zámok zápisu — radšej počkať, než zahodiť snímok.
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  // Stará schéma (REAL stĺpce, verzia 0/1) sa zahodí — je to dev cache,
  // nie zdroj; nová sa naplní z ďalšieho pollu. NOVŠIA verzia sa nezahadzuje
  // nikdy (2026-09-30): archív má dnes mesiace dát a starší kód z inej vetvy
  // ho nesmie zmazať — otvorenie radšej zlyhá a história sa len nezapisuje.
  const version = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
  const action = schemaAction(version);
  if (action === 'refuse-newer' || action === 'refuse-no-migration') {
    db.close();
    throw new Error(action === 'refuse-newer'
      ? `flight history schema ${version} is newer than ${SCHEMA_VERSION} — refusing to open (nothing dropped)`
      : `flight history schema ${version} has no migration to ${SCHEMA_VERSION} — refusing to open (nothing dropped)`);
  }
  if (action === 'drop-legacy') {
    db.exec('DROP TABLE IF EXISTS fixes; DROP TABLE IF EXISTS legs; DROP TABLE IF EXISTS meta;');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  db.exec(SCHEMA);
  ensureAdditiveColumns(db);

  // Počty riadkov sa vedú prírastkovo v `meta` (2026-09-14): `SELECT COUNT(*)
  // FROM fixes` je pri 25 M fixoch plný prechod indexu (~40 s na D:) a
  // node:sqlite je synchrónne → každý GET /api/history/status zmrazil celý
  // dev server (aj /robots.txt), cez tunel z toho boli 502 a odozvy 80–100 s.
  // Jediný zapisovateľ je tento modul, preto sa počítadlá menia v tej istej
  // transakcii ako zápis alebo prerezávanie; plný COUNT beží len raz pri
  // prvom otvorení bez `meta` (migrácia) alebo na požiadanie cez recount().
  const metaGet = db.prepare('SELECT value FROM meta WHERE key = ?');
  const metaSet = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const metaAdd = db.prepare('UPDATE meta SET value = value + ? WHERE key = ?');
  const countFixesFull = db.prepare('SELECT COUNT(*) AS n FROM fixes');
  const countLegsFull = db.prepare('SELECT COUNT(*) AS n FROM legs');
  function recountRows() {
    const fixes = countFixesFull.get()?.n ?? 0;
    const legs = countLegsFull.get()?.n ?? 0;
    metaSet.run('fixes_count', fixes);
    metaSet.run('legs_count', legs);
    return { fixes, legs };
  }
  if (metaGet.get('fixes_count') === undefined || metaGet.get('legs_count') === undefined) recountRows();

  const insertFix = db.prepare(`INSERT OR IGNORE INTO fixes (icao24, t, lat, lon, alt, gs, trk, vr, squawk, gnd, src, geo_alt, pos_src, spi, x)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lastLeg = db.prepare(`SELECT id, callsign, last_t, first_t, fixes, max_alt, max_gs, squawks FROM legs
    WHERE icao24 = ? ORDER BY last_t DESC LIMIT 1`);
  const insertLeg = db.prepare(`INSERT INTO legs (icao24, callsign, country, first_t, last_t, fixes, max_alt, max_gs, squawks, src, cat, reg, ac_type, ac_desc)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Identita úseku: prvá známa registrácia/typ ostáva; kategória 0/1 („bez
  // informácie") sa prepíše prvou skutočnou.
  const updateLeg = db.prepare(`UPDATE legs SET last_t = MAX(last_t, ?), first_t = MIN(first_t, ?), fixes = fixes + 1,
    max_alt = MAX(COALESCE(max_alt, -1e9), COALESCE(?, -1e9)), max_gs = MAX(COALESCE(max_gs, -1), COALESCE(?, -1)),
    squawks = ?, callsign = CASE WHEN callsign = '' THEN ? ELSE callsign END,
    cat = CASE WHEN cat IS NULL OR cat <= 1 THEN COALESCE(?, cat) ELSE cat END,
    reg = COALESCE(reg, ?), ac_type = COALESCE(ac_type, ?), ac_desc = COALESCE(ac_desc, ?) WHERE id = ?`);
  // Import celých stôp (adsblolTrace.js, 2026-09-30): úsek sa napojí na existujúci úsek toho istého
  // stroja, ktorý sa s ním časovo prekrýva alebo naň nadväzuje (≤ LEG_GAP_S) a má zlučiteľný volací znak.
  const overlapLegs = db.prepare(`SELECT id, callsign, first_t, last_t, fixes, max_alt, max_gs, squawks, cat, reg, ac_type, ac_desc
    FROM legs WHERE icao24 = ? AND last_t >= ? AND first_t <= ? ORDER BY last_t DESC`);
  const setLeg = db.prepare(`UPDATE legs SET first_t = ?, last_t = ?, fixes = ?, max_alt = ?, max_gs = ?, squawks = ?,
    callsign = ?, cat = ?, reg = ?, ac_type = ?, ac_desc = ? WHERE id = ?`);
  const insertLegCounted = db.prepare(`INSERT INTO legs (icao24, callsign, country, first_t, last_t, fixes, max_alt, max_gs, squawks, src, cat, reg, ac_type, ac_desc)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const fixAt = db.prepare('SELECT t, lat, lon, alt, gnd FROM fixes WHERE icao24 = ? AND t = ?');
  const pruneFixes = db.prepare('DELETE FROM fixes WHERE t < ?');
  const pruneLegs = db.prepare('DELETE FROM legs WHERE last_t < ?');
  // Preriedenie: zo starších fixov ostanú tie, ktorých čas padne do prvej
  // tretiny každého 2-minútového okna (pri 30 s polloch ≈ jeden fix na okno).
  const thinFixes = db.prepare(`DELETE FROM fixes WHERE t < ? AND t >= ? AND (t % ${THIN_STEP_S}) >= ${Math.floor(THIN_STEP_S / 4)}`);
  const pageCount = () => { try { return db.prepare('PRAGMA page_count').get()?.page_count ?? 0; } catch { return 0; } };
  const pageSize = () => { try { return db.prepare('PRAGMA page_size').get()?.page_size ?? 0; } catch { return 0; } };
  // MIN/MAX cez index fixes_t sú O(log n) — SQLite ich optimalizuje len po
  // jednom agregáte na dopyt, preto dva dopyty.
  const oldestFix = db.prepare('SELECT MIN(t) AS v FROM fixes');
  const newestFix = db.prepare('SELECT MAX(t) AS v FROM fixes');
  const trackStmt = db.prepare(`SELECT t, lat, lon, alt, gs, trk, vr, squawk, gnd, geo_alt, pos_src, x FROM fixes
    WHERE icao24 = ? AND t >= ? AND t <= ? ORDER BY t ASC LIMIT ?`);
  const legById = db.prepare('SELECT * FROM legs WHERE id = ?');

  let lastSnapshotKey = null;
  let lastPruneMs = 0;

  /** Zapíš pole fixov jedného snímku v transakcii. Vracia počet nových. */
  function recordFixes(fixes, src) {
    if (!fixes.length) return 0;
    let inserted = 0;
    let legsInserted = 0;
    db.exec('BEGIN');
    try {
      for (const f of fixes) {
        const r = insertFix.run(
          f.icao24, f.t, Math.round(f.lat * SCALE_DEG), Math.round(f.lon * SCALE_DEG),
          f.alt === null ? null : Math.round(f.alt),
          f.gs === null ? null : Math.round(f.gs * SCALE_TENTH),
          f.trk === null ? null : Math.round(f.trk * SCALE_TENTH),
          f.vr === null ? null : Math.round(f.vr * SCALE_TENTH),
          f.squawk, f.gnd, src,
          f.geoAlt == null ? null : Math.round(f.geoAlt),
          f.posSrc ?? null, f.spi ? 1 : 0, f.x ?? null,
        );
        if (!r.changes) continue;
        inserted += 1;
        const leg = lastLeg.get(f.icao24);
        const sameLeg = leg
          && (leg.callsign === f.callsign || leg.callsign === '' || f.callsign === '')
          && Math.abs(f.t - leg.last_t) <= LEG_GAP_S;
        if (sameLeg) {
          let squawks = leg.squawks || '';
          if (f.squawk && !squawks.split(',').includes(f.squawk)) squawks = squawks ? `${squawks},${f.squawk}` : f.squawk;
          updateLeg.run(f.t, f.t, f.alt, f.gs, squawks, f.callsign,
            f.cat ?? null, f.reg ?? null, f.acType ?? null, f.acDesc ?? null, leg.id);
        } else {
          insertLeg.run(f.icao24, f.callsign, f.country, f.t, f.t, f.alt, f.gs, f.squawk || '', src,
            f.cat ?? null, f.reg ?? null, f.acType ?? null, f.acDesc ?? null);
          legsInserted += 1;
        }
      }
      if (inserted) metaAdd.run(inserted, 'fixes_count');
      if (legsInserted) metaAdd.run(legsInserted, 'legs_count');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    maybePrune();
    return inserted;
  }

  function maybePrune(force = false) {
    const nowMs = now();
    if (!force && nowMs - lastPruneMs < 60 * 60_000) return 0;
    lastPruneMs = nowMs;
    const nowS = Math.floor(nowMs / 1000);
    const cutoff = nowS - retentionDays * 86_400;
    // Jedna transakcia: mazanie aj oprava počítadiel spolu, aby pád medzi
    // nimi nenechal `meta` rozhodené.
    db.exec('BEGIN');
    try {
      const a = pruneFixes.run(cutoff).changes;
      const b = pruneLegs.run(cutoff).changes;
      // rawHours ≥ retencia = riedenie vypnuté (používateľ 2026-09-07: „veľmi
      // nezosekávaj dáta" — na prázdnom SSD sa drží plný záznam).
      const c = rawHours * 3600 >= retentionDays * 86_400 ? 0 : thinFixes.run(nowS - rawHours * 3600, cutoff).changes;
      if (a + c) metaAdd.run(-(a + c), 'fixes_count');
      if (b) metaAdd.run(-b, 'legs_count');
      db.exec('COMMIT');
      return a + b + c;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    /**
     * Zapíš telo odpovede OpenSky /states (JSON text alebo Buffer).
     * Ten istý snímok (`time`) druhýkrát = preskočiť.
     * @returns {number} počet nových fixov
     */
    recordOpenSkyBody(body, src = 'opensky') {
      let json;
      try { json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { return 0; }
      if (!json || !Array.isArray(json.states)) return 0;
      const t = finite(json.time) ?? Math.floor(now() / 1000);
      const key = `${src}:${t}:${json.states.length}`;
      if (key === lastSnapshotKey) return 0;
      lastSnapshotKey = key;
      // Regionálna náhrada (adsbLolFallback.js) píše do slotu [16] vždy 0 —
      // zdroj polohy tam nie je známy, nie „ADS-B".
      const trustPosSrc = src === 'opensky';
      const fixes = [];
      for (const row of json.states) {
        const f = fixFromOpenSkyRow(row, t);
        if (!f) continue;
        if (!trustPosSrc) f.posSrc = null;
        fixes.push(f);
      }
      return recordFixes(fixes, src);
    },

    /** Zapíš telo odpovede adsb.lol /v2 (`ac` pole). */
    recordAdsbLolBody(body, src = 'adsb.lol/mil') {
      let json;
      try { json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { return 0; }
      if (!json || !Array.isArray(json.ac)) return 0;
      const nowS = finite(json.now) !== null ? finite(json.now) / 1000 : Math.floor(now() / 1000);
      const fixes = [];
      for (const ac of json.ac) {
        const f = fixFromAdsbLolAircraft(ac, nowS);
        if (f) fixes.push(f);
      }
      return recordFixes(fixes, src);
    },

    /**
     * Zapíš celú stopu jedného stroja (adsblolTrace.traceToFlight) v jednej transakcii.
     * Lety sa rozdelia (splitLegs); let, ktorý už čiastočne zachytil živý záznam, sa predĺži —
     * nevznikne druhý. Opakovaný import tej istej stopy nič nepridá (fixy aj počty ostanú).
     * @returns {{inserted: number, legsInserted: number, legsExtended: number}}
     */
    importFlight(flight, src = 'adsb.lol/archive') {
      const icao24 = String(flight?.icao24 || '').toLowerCase();
      const result = { inserted: 0, legsInserted: 0, legsExtended: 0 };
      if (!/^[0-9a-f]{6}$/.test(icao24) || !Array.isArray(flight.points) || !flight.points.length) return result;
      const points = [...flight.points].sort((a, b) => a.t - b.t);
      const legs = splitLegs(points, TRACE_LEG_GAP_S);
      const reg = flight.reg ?? null;
      const acType = flight.acType ?? null;
      const acDesc = flight.acDesc ?? null;
      const createdIds = new Set();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const leg of legs) {
          // Vzlet, ktorý readsb označil ako nový úsek, sa napojí len na let, ktorý sa s ním naozaj
          // prekrýva (nie na predošlý let do 30 min — to by zlialo dva lety po krátkom obrate).
          const takeoff = points[leg.start].newLeg === true;
          let legInserted = 0;
          for (let i = leg.start; i <= leg.end; i += 1) {
            const f = points[i];
            const r = insertFix.run(
              icao24, f.t, Math.round(f.lat * SCALE_DEG), Math.round(f.lon * SCALE_DEG),
              f.alt == null ? null : Math.round(f.alt),
              f.gs == null ? null : Math.round(f.gs * SCALE_TENTH),
              f.trk == null ? null : Math.round(f.trk * SCALE_TENTH),
              f.vr == null ? null : Math.round(f.vr * SCALE_TENTH),
              f.squawk ?? null, f.gnd ? 1 : 0, src,
              f.geoAlt == null ? null : Math.round(f.geoAlt),
              f.posSrc ?? null, f.spi ? 1 : 0, f.x ?? null,
            );
            if (r.changes) legInserted += 1;
          }
          if (!legInserted) continue;
          result.inserted += legInserted;
          const match = overlapLegs.all(icao24, leg.firstT - LEG_GAP_S, leg.lastT + LEG_GAP_S)
            .find((e) => !createdIds.has(e.id)
              && (!takeoff || (e.last_t >= leg.firstT && e.first_t <= leg.lastT))
              && (e.callsign === leg.callsign || e.callsign === '' || leg.callsign === ''));
          const squawks = leg.squawks.join(',');
          if (match) {
            const oldAlt = match.max_alt !== null && match.max_alt > -1e8 ? match.max_alt : null;
            const oldGs = match.max_gs !== null && match.max_gs >= 0 ? match.max_gs : null;
            const maxOf = (a, b) => (a === null ? b : (b === null ? a : Math.max(a, b)));
            const mergedSquawks = [...new Set([...(match.squawks || '').split(','), ...leg.squawks].filter(Boolean))].join(',');
            setLeg.run(
              Math.min(match.first_t, leg.firstT), Math.max(match.last_t, leg.lastT), match.fixes + legInserted,
              maxOf(oldAlt, leg.maxAlt), maxOf(oldGs, leg.maxGs), mergedSquawks,
              match.callsign || leg.callsign,
              match.cat === null || match.cat <= 1 ? (leg.cat ?? match.cat) : match.cat,
              match.reg ?? reg, match.ac_type ?? acType, match.ac_desc ?? acDesc,
              match.id,
            );
            result.legsExtended += 1;
          } else {
            const created = insertLegCounted.run(icao24, leg.callsign, leg.firstT, leg.lastT, legInserted, leg.maxAlt, leg.maxGs, squawks, src,
              leg.cat, reg, acType, acDesc);
            createdIds.add(Number(created.lastInsertRowid));
            result.legsInserted += 1;
          }
        }
        if (result.inserted) metaAdd.run(result.inserted, 'fixes_count');
        if (result.legsInserted) metaAdd.run(result.legsInserted, 'legs_count');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return result;
    },

    /**
     * Lety jedného stroja, najnovšie prvé, s prvou a poslednou polohou (na odvodenie letísk).
     * @param {string} icao24
     * @param {{beforeS?: number, limit?: number}} [options] stránkovanie do minulosti: `beforeS` = lastT posledného
     */
    flightsOf(icao24, { beforeS = Number.MAX_SAFE_INTEGER, limit = 50 } = {}) {
      const hex = String(icao24 || '').trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex)) return [];
      const cap = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(limit) || 50));
      const end = (t) => {
        const r = fixAt.get(hex, t);
        return r ? { t: r.t, lat: r.lat / SCALE_DEG, lon: r.lon / SCALE_DEG, altM: r.alt, gnd: r.gnd === 1 } : null;
      };
      return db.prepare('SELECT * FROM legs WHERE icao24 = ? AND last_t < ? ORDER BY last_t DESC LIMIT ?')
        .all(hex, Math.floor(beforeS), cap)
        .map((row) => ({ ...legToJson(row), first: end(row.first_t), last: end(row.last_t) }));
    },

    /**
     * Vyhľadaj úseky podľa volacieho znaku (prefix) alebo hexu, najnovšie prvé.
     * @param {string} query
     * @param {{sinceS?: number, limit?: number}} [options]
     */
    search(query, { sinceS = 0, limit = 50 } = {}) {
      const { text, hex } = normalizeSearchQuery(query);
      const cap = Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.floor(limit) || 50));
      let rows;
      if (hex) {
        rows = db.prepare(`SELECT * FROM legs WHERE icao24 = ? AND last_t >= ? ORDER BY last_t DESC LIMIT ?`).all(hex, sinceS, cap);
      } else if (text) {
        rows = db.prepare(`SELECT * FROM legs WHERE callsign LIKE ? AND last_t >= ? ORDER BY last_t DESC LIMIT ?`).all(`${text}%`, sinceS, cap);
      } else {
        rows = db.prepare(`SELECT * FROM legs WHERE last_t >= ? AND fixes >= 3 ORDER BY last_t DESC LIMIT ?`).all(sinceS, cap);
      }
      return rows.map(legToJson);
    },

    /** Úsek podľa id. */
    leg(id) {
      const row = legById.get(Number(id));
      return row ? legToJson(row) : null;
    },

    /**
     * Fixy stroja v časovom okne, chronologicky, kompaktne
     * `[t, lat, lon, alt, gs, trk, vr, squawk, gnd, geoAlt, posSrc, extras]`
     * (posledné tri pribudli 2026-09-30 na konci — staré indexy platia ďalej;
     * extras = objekt doplnkov readsb alebo null).
     */
    track(icao24, { fromS = 0, toS = Number.MAX_SAFE_INTEGER, limit = 5000 } = {}) {
      const hex = String(icao24 || '').trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex)) return [];
      const cap = Math.max(1, Math.min(TRACK_LIMIT_MAX, Math.floor(limit) || 5000));
      const tenth = (v) => (v === null ? null : v / SCALE_TENTH);
      const extras = (text) => {
        if (!text) return null;
        try { return JSON.parse(text); } catch { return null; }
      };
      return trackStmt.all(hex, Math.floor(fromS), Math.floor(toS), cap)
        .map((r) => [r.t, r.lat / SCALE_DEG, r.lon / SCALE_DEG, r.alt, tenth(r.gs), tenth(r.trk), tenth(r.vr), r.squawk, r.gnd,
          r.geo_alt ?? null, r.pos_src ?? null, extras(r.x)]);
    },

    /** Stav úložiska — O(1): počty z `meta`, kraje cez index (žiadny COUNT(*)). */
    status() {
      return {
        fixes: metaGet.get('fixes_count')?.value ?? 0,
        legs: metaGet.get('legs_count')?.value ?? 0,
        oldestT: oldestFix.get()?.v ?? null,
        newestT: newestFix.get()?.v ?? null,
        retentionDays,
        rawHours,
        thinStepS: THIN_STEP_S,
        bytes: pageCount() * pageSize(),
        path: dbPath,
      };
    },

    prune() { return maybePrune(true); },
    /** Plný COUNT(*) oboch tabuliek a zápis do `meta` (pomalé; testy, jednorazová kontrola). */
    recount() { return recountRows(); },
    close() { db.close(); },
  };
}

/**
 * Doplň chýbajúce ADDITIVE_COLUMNS (ALTER TABLE ADD COLUMN je v SQLite len
 * zmena schémy — riadky sa neprepisujú, aj pri desiatkach GB je to okamih).
 * Jedna transakcia; user_version sa nemení.
 */
function ensureAdditiveColumns(db) {
  const missing = [];
  for (const [table, columns] of Object.entries(ADDITIVE_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of columns) {
      if (!have.has(name)) missing.push(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`);
    }
  }
  if (!missing.length) return;
  db.exec('BEGIN');
  try {
    for (const statement of missing) db.exec(statement);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function legToJson(row) {
  return {
    id: row.id,
    icao24: row.icao24,
    callsign: row.callsign,
    country: row.country,
    firstT: row.first_t,
    lastT: row.last_t,
    fixes: row.fixes,
    maxAltM: row.max_alt,
    maxGsMps: row.max_gs,
    squawks: row.squawks ? row.squawks.split(',').filter(Boolean) : [],
    src: row.src,
    category: row.cat ?? null,
    registration: row.reg ?? null,
    typeCode: row.ac_type ?? null,
    typeName: row.ac_desc ?? null,
  };
}
