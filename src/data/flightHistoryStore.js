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
 */
import { DatabaseSync } from 'node:sqlite';

export const FLIGHT_HISTORY_DEFAULT_RETENTION_DAYS = 7;
/** Medzera medzi fixmi, po ktorej sa začne nový úsek (s). */
export const LEG_GAP_S = 30 * 60;
export const SEARCH_LIMIT_MAX = 200;
export const TRACK_LIMIT_MAX = 20_000;
/** Plný záznam (každý poll) sa drží toľkoto hodín; staršie sa preriedia. */
export const RAW_HOURS = 24;
/** Krok preriedenia starších fixov (s): zostane ~jeden fix za 2 minúty. */
export const THIN_STEP_S = 120;
/** Verzia schémy — zmena rozloží dev cache nanovo (nie sú to zdrojové dáta). */
export const SCHEMA_VERSION = 2;
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
`;

// null/undefined/'' → null (Number(null) je 0 — chýbajúca výška nie je hladina mora).
const finite = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * OpenSky `states` riadok → fix. Pure. Null bez polohy.
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
  };
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
  }
  // Stará schéma (REAL stĺpce, verzia 0/1) sa zahodí — je to dev cache,
  // nie zdroj; nová sa naplní z ďalšieho pollu.
  const version = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
  if (version !== SCHEMA_VERSION) {
    db.exec('DROP TABLE IF EXISTS fixes; DROP TABLE IF EXISTS legs;');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  db.exec(SCHEMA);

  const insertFix = db.prepare(`INSERT OR IGNORE INTO fixes (icao24, t, lat, lon, alt, gs, trk, vr, squawk, gnd, src)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lastLeg = db.prepare(`SELECT id, callsign, last_t, first_t, fixes, max_alt, max_gs, squawks FROM legs
    WHERE icao24 = ? ORDER BY last_t DESC LIMIT 1`);
  const insertLeg = db.prepare(`INSERT INTO legs (icao24, callsign, country, first_t, last_t, fixes, max_alt, max_gs, squawks, src)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`);
  const updateLeg = db.prepare(`UPDATE legs SET last_t = MAX(last_t, ?), first_t = MIN(first_t, ?), fixes = fixes + 1,
    max_alt = MAX(COALESCE(max_alt, -1e9), COALESCE(?, -1e9)), max_gs = MAX(COALESCE(max_gs, -1), COALESCE(?, -1)),
    squawks = ?, callsign = CASE WHEN callsign = '' THEN ? ELSE callsign END WHERE id = ?`);
  const pruneFixes = db.prepare('DELETE FROM fixes WHERE t < ?');
  const pruneLegs = db.prepare('DELETE FROM legs WHERE last_t < ?');
  // Preriedenie: zo starších fixov ostanú tie, ktorých čas padne do prvej
  // tretiny každého 2-minútového okna (pri 30 s polloch ≈ jeden fix na okno).
  const thinFixes = db.prepare(`DELETE FROM fixes WHERE t < ? AND t >= ? AND (t % ${THIN_STEP_S}) >= ${Math.floor(THIN_STEP_S / 4)}`);
  const pageCount = () => { try { return db.prepare('PRAGMA page_count').get()?.page_count ?? 0; } catch { return 0; } };
  const pageSize = () => { try { return db.prepare('PRAGMA page_size').get()?.page_size ?? 0; } catch { return 0; } };
  const countFixes = db.prepare('SELECT COUNT(*) AS n, MIN(t) AS oldest, MAX(t) AS newest FROM fixes');
  const countLegs = db.prepare('SELECT COUNT(*) AS n FROM legs');
  const trackStmt = db.prepare(`SELECT t, lat, lon, alt, gs, trk, vr, squawk, gnd FROM fixes
    WHERE icao24 = ? AND t >= ? AND t <= ? ORDER BY t ASC LIMIT ?`);
  const legById = db.prepare('SELECT * FROM legs WHERE id = ?');

  let lastSnapshotKey = null;
  let lastPruneMs = 0;

  /** Zapíš pole fixov jedného snímku v transakcii. Vracia počet nových. */
  function recordFixes(fixes, src) {
    if (!fixes.length) return 0;
    let inserted = 0;
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
          updateLeg.run(f.t, f.t, f.alt, f.gs, squawks, f.callsign, leg.id);
        } else {
          insertLeg.run(f.icao24, f.callsign, f.country, f.t, f.t, f.alt, f.gs, f.squawk || '', src);
        }
      }
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
    const a = pruneFixes.run(cutoff).changes;
    const b = pruneLegs.run(cutoff).changes;
    // rawHours ≥ retencia = riedenie vypnuté (používateľ 2026-09-07: „veľmi
    // nezosekávaj dáta" — na prázdnom SSD sa drží plný záznam).
    const c = rawHours * 3600 >= retentionDays * 86_400 ? 0 : thinFixes.run(nowS - rawHours * 3600, cutoff).changes;
    return a + b + c;
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
      const fixes = [];
      for (const row of json.states) {
        const f = fixFromOpenSkyRow(row, t);
        if (f) fixes.push(f);
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
     * `[t, lat, lon, alt, gs, trk, vr, squawk, gnd]`.
     */
    track(icao24, { fromS = 0, toS = Number.MAX_SAFE_INTEGER, limit = 5000 } = {}) {
      const hex = String(icao24 || '').trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex)) return [];
      const cap = Math.max(1, Math.min(TRACK_LIMIT_MAX, Math.floor(limit) || 5000));
      const tenth = (v) => (v === null ? null : v / SCALE_TENTH);
      return trackStmt.all(hex, Math.floor(fromS), Math.floor(toS), cap)
        .map((r) => [r.t, r.lat / SCALE_DEG, r.lon / SCALE_DEG, r.alt, tenth(r.gs), tenth(r.trk), tenth(r.vr), r.squawk, r.gnd]);
    },

    status() {
      const f = countFixes.get();
      const l = countLegs.get();
      return {
        fixes: f?.n ?? 0,
        legs: l?.n ?? 0,
        oldestT: f?.oldest ?? null,
        newestT: f?.newest ?? null,
        retentionDays,
        rawHours,
        thinStepS: THIN_STEP_S,
        bytes: pageCount() * pageSize(),
        path: dbPath,
      };
    },

    prune() { return maybePrune(true); },
    close() { db.close(); },
  };
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
  };
}
