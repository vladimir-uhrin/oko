// src/data/aisSupplementFeeds.js
/**
 * @module aisSupplementFeeds
 * @description Doplnkové zdroje polôh lodí k AISStream (2026-10-11, vlastník: „všetky tri"
 * po preverení zdrojov). Všetko sa zlúči do toho istého úložiska živých lodí na serveri
 * (podľa MMSI, novšia poloha vyhráva), takže karta, register, sledovanie aj história lodí
 * fungujú bez ďalšej práce v prehliadači. Každý riadok nesie `feed` — karta poctivo ukáže
 * pôvod (pravidlo 2) a vek polohy.
 *
 *  • OpenSeaFeed (CC BY 4.0) — celosvetová snímka komunitných prijímačov, raz za 3 min.
 *  • Open Waters AIS / aiscast (MIT; dáta AISHub, aisstream, dobrovoľníci) — okná ~10°×10°
 *    pri pobreží po jednom, s osobným tokenom (AISCAST_TOKEN) širšie.
 *  • Oceán (oneskorené) — dlaždice verejnej mapy registra lodí pri malom priblížení: jediný
 *    bezplatný zdroj polôh na otvorenom oceáne (typicky 20–60 min staré). Dlaždica nemá MMSI,
 *    preto sa interné ID registra postupne preloží na MMSI (stránka „general", cache 30 dní)
 *    s vlastným stropom požiadaviek. Podmienky registra sťahovanie zakazujú — zapísané
 *    v DATA_SOURCES.md (vlastník 2026-10-03: zákaz zdroja nie je prekážka, zapísať poctivo).
 *
 * Čisté parsery a zlúčenie sú testované; slučky dostávajú fetch/curl zvonka.
 */

/** Poloha staršia než toto (ms) sa zo zdrojov navyše neberie — úložisko drží lode 6 h. */
export const SUPPLEMENT_MAX_AGE_MS = 6 * 3600_000;
/** Novšia poloha prepíše staršiu až od tohto rozdielu (s) — inak by sa zdroje prekrikovali. */
export const SUPPLEMENT_MIN_ADVANCE_SEC = 20;

const MMSI_RE = /^\d{9}$/;
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/@+$/g, '').trim();
  return s || null;
};
const validPos = (lat, lon) => lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) && lat !== 91 && lon !== 181;
const NAV_TEXT = {
  'under way using engine': 0, 'at anchor': 1, 'not under command': 2, 'restricted manoeuvrability': 3, 'restricted maneuverability': 3,
  'constrained by her draught': 4, moored: 5, aground: 6, 'engaged in fishing': 7, 'under way sailing': 8,
};

/**
 * Riadok vo formáte úložiska AISStream (vite.config.js `_aisStreamVessels`). Pure.
 * @param {object} p
 */
function makeRow(p) {
  const epoch = Math.floor(p.epochSec);
  return {
    lat: p.lat,
    lon: p.lon,
    name: p.name || `MMSI ${p.mmsi}`,
    mmsi: p.mmsi,
    imo: p.imo ? String(p.imo) : null,
    type: p.type !== null && p.type !== undefined ? String(p.type) : null,
    destination: p.destination || null,
    call_sign: p.callSign || null,
    length_m: p.lengthM ?? null,
    beam_m: p.beamM ?? null,
    draught_m: p.draughtM ?? null,
    eta: p.eta || null,
    nav_status: p.navStatus ?? null,
    rate_of_turn: null,
    ais_class: null,
    pos_estimated: false,
    speed: p.speed ?? null,
    course: p.course ?? null,
    heading: p.heading ?? null,
    last_position_UTC: new Date(epoch * 1000).toISOString(),
    last_position_epoch: epoch,
    feed: p.feed,
  };
}

/** OpenSeaFeed /v1/snapshot → riadky. Pure. */
export function parseOpenSeaFeedSnapshot(json) {
  const out = [];
  for (const v of Array.isArray(json?.vessels) ? json.vessels : []) {
    const mmsi = String(v?.mmsi ?? '');
    const lat = num(v?.lat);
    const lon = num(v?.lon);
    const ts = num(v?.ts);
    if (!MMSI_RE.test(mmsi) || !validPos(lat, lon) || ts === null) continue;
    out.push(makeRow({
      mmsi, lat, lon, epochSec: ts / 1000, feed: 'openseafeed',
      name: str(v.name), type: num(v.type), destination: str(v.dest), callSign: str(v.callsign),
      lengthM: num(v.len), beamM: num(v.beam), draughtM: num(v.draught), navStatus: num(v.nav),
      speed: num(v.sog), course: num(v.cog), heading: num(v.hdg) === 511 ? null : num(v.hdg),
    }));
  }
  return out;
}

/** Open Waters AIS (aiscast) /v1/vessels GeoJSON → riadky. Pure. */
export function parseAiscastVessels(json) {
  const out = [];
  for (const f of Array.isArray(json?.features) ? json.features : []) {
    const p = f?.properties || {};
    const mmsi = String(p.mmsi ?? f?.id ?? '');
    const [lon, lat] = (f?.geometry?.coordinates || []).map(num);
    const seen = Date.parse(p.seen || '');
    if (p.kind && p.kind !== 'vessel') continue;
    if (!MMSI_RE.test(mmsi) || !validPos(lat, lon) || !Number.isFinite(seen)) continue;
    out.push(makeRow({
      mmsi, lat, lon, epochSec: seen / 1000, feed: 'aiscast',
      name: str(p.name), imo: num(p.imo), type: num(p.type), destination: str(p.destination), callSign: str(p.callsign),
      lengthM: num(p.length), beamM: num(p.beam), draughtM: num(p.draught), eta: str(p.eta), navStatus: num(p.nav_status),
      speed: num(p.sog), course: num(p.cog), heading: num(p.heading) === 511 ? null : num(p.heading),
    }));
  }
  return out;
}

/**
 * Dlaždica mapy registra → riadky bez MMSI (kľúč shipId). SPEED je v desatinách uzla,
 * ELAPSED v minútach od poslednej polohy. Pure.
 */
export function parseMtTileRows(json, nowMs = Date.now()) {
  const rows = json?.data?.rows;
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const shipId = str(r?.SHIP_ID);
    const lat = num(r?.LAT);
    const lon = num(r?.LON);
    const elapsed = num(r?.ELAPSED);
    if (!shipId || !/^\d+$/.test(shipId) || !validPos(lat, lon) || elapsed === null || elapsed < 0) continue;
    const speed = num(r.SPEED);
    out.push({
      shipId,
      lat, lon,
      epochSec: Math.floor(nowMs / 1000 - elapsed * 60),
      speed: speed === null ? null : speed / 10,
      course: num(r.COURSE),
      heading: num(r.HEADING) === 511 ? null : num(r.HEADING),
      name: str(r.SHIPNAME),
      destination: str(r.DESTINATION),
      lengthM: num(r.LENGTH),
      beamM: num(r.WIDTH),
    });
  }
  return out;
}

/** Riadok z dlaždice + známe MMSI → riadok úložiska. Pure. */
export function mtTileRowToVessel(t, mmsi) {
  return makeRow({
    mmsi, lat: t.lat, lon: t.lon, epochSec: t.epochSec, feed: 'ocean',
    name: t.name, destination: t.destination, lengthM: t.lengthM, beamM: t.beamM,
    speed: t.speed, course: t.course, heading: t.heading,
  });
}

/**
 * Zlúčenie do úložiska: prijme, keď loď nemá alebo má staršiu polohu (o ≥ 20 s), a poloha
 * nie je staršia ako 6 h. Statické polia (rozmery, IMO, cieľ…) z existujúceho riadku
 * zostanú, keď ich zdroj navyše nemá. Pure.
 * @returns {object|null} nový riadok alebo null (ponechať existujúci)
 */
export function mergeSupplementRow(existing, row, nowMs = Date.now()) {
  if (!row) return null;
  if (nowMs - row.last_position_epoch * 1000 > SUPPLEMENT_MAX_AGE_MS) return null;
  if (row.last_position_epoch * 1000 > nowMs + 120_000) return null; // poloha z budúcnosti
  const prevEpoch = Number(existing?.last_position_epoch);
  if (existing && Number.isFinite(prevEpoch) && row.last_position_epoch < prevEpoch + SUPPLEMENT_MIN_ADVANCE_SEC) return null;
  if (!existing) return { ...row, _updatedAt: row.last_position_epoch * 1000 };
  const merged = { ...existing };
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && v !== undefined && !(k === 'name' && /^MMSI /.test(v))) merged[k] = v;
  }
  // Navigačný stav a ROT sú z inej správy — nový zdroj ich nemá, starý stav by klamal.
  if (row.nav_status === null) merged.nav_status = existing.nav_status ?? null;
  merged.rate_of_turn = null;
  merged.ais_class = existing.ais_class ?? null;
  merged._updatedAt = row.last_position_epoch * 1000;
  return merged;
}

/**
 * Dlaždice (MT z:4 = webová mriežka z3, 8×8) nad oceánmi: riadky 1–5 (≈ 79° S … 66° J).
 * @returns {Array<{x:number, y:number}>}
 */
export function oceanTiles() {
  const out = [];
  for (let y = 1; y <= 5; y += 1) for (let x = 0; x < 8; x += 1) out.push({ x, y });
  return out;
}

/** Okná ~10°×10° pri hlavných pobrežiach a trasách (pre aiscast bez tokenu). */
export const AISCAST_WINDOWS = Object.freeze([
  // [minLat, minLon, maxLat, maxLon]
  [48, -10, 58, 0], [50, 0, 58, 10], [53, 10, 60, 20], [56, 18, 66, 28], [36, -10, 46, 0], [36, 0, 45, 10],
  [36, 10, 45, 20], [30, 20, 40, 30], [40, 26, 47, 36], [28, 30, 32, 35], [12, 38, 22, 45], [22, 48, 30, 58],
  [0, 95, 8, 106], [18, 110, 26, 122], [28, 118, 38, 128], [30, 128, 38, 140], [34, 136, 42, 146], [-40, 140, -30, 154],
  [36, -78, 42, -68], [28, -82, 36, -74], [24, -98, 31, -88], [32, -124, 40, -116], [44, -128, 50, -120], [6, -84, 12, -76],
  [-26, -50, -20, -40], [-36, 15, -28, 32], [0, 0, 8, 10], [58, 0, 66, 10], [66, 10, 72, 30],
]);

/**
 * Prekladač ID registra → MMSI s frontou a stropom. `resolveOne(shipId)` vracia
 * {mmsi, name}|null (zvonka: curl + parseMtGeneral, cache na disku).
 */
export function createShipIdResolver({ resolveOne, maxQueue = 6000 }) {
  const known = new Map(); // shipId → mmsi|null
  const urgent = new Set(); // čerstvé polohy (do 1 h) idú prvé
  const queue = new Set();
  const size = () => urgent.size + queue.size;
  return {
    known,
    get(shipId) { return known.get(shipId); },
    /** Zaradí ID; `urgent` (čerstvá poloha) predbehne zvyšok fronty. */
    want(shipId, { urgent: isUrgent = false } = {}) {
      if (known.has(shipId) || urgent.has(shipId)) return;
      if (isUrgent) { queue.delete(shipId); if (size() < maxQueue) urgent.add(shipId); return; }
      if (queue.has(shipId) || size() >= maxQueue) return;
      queue.add(shipId);
    },
    /** MMSI zistené bez siete (zhoda mena a polohy s inou loďou v úložisku). */
    learn(shipId, mmsi) { known.set(shipId, mmsi); urgent.delete(shipId); queue.delete(shipId); },
    /** Spracuj jedno ID z fronty. @returns {Promise<boolean>} niečo spracované */
    async step() {
      const from = urgent.size ? urgent : queue;
      const next = from.values().next();
      if (next.done) return false;
      const shipId = next.value;
      from.delete(shipId);
      try {
        const r = await resolveOne(shipId);
        known.set(shipId, r?.mmsi && MMSI_RE.test(r.mmsi) ? r.mmsi : null);
      } catch { /* sieť: skúsi sa pri ďalšej dlaždici */ }
      return true;
    },
    pending: size,
  };
}

const normName = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Index mien lodí v úložisku (meno → riadky). Mená kratšie ako 4 znaky a „MMSI …" sa vynechajú. Pure. */
export function buildNameIndex(rows) {
  const index = new Map();
  for (const r of rows) {
    const key = normName(r?.name);
    if (key.length < 4 || key.startsWith('MMSI')) continue;
    const list = index.get(key);
    if (list) list.push(r); else index.set(key, [r]);
  }
  return index;
}

/**
 * MMSI pre riadok z dlaždice bez siete: rovnaké meno a poloha do `maxKm` (loď sa za hodinu
 * posunie najviac ~40 km). Viac kandidátov s rôznym MMSI = nejednoznačné → null. Pure.
 */
export function matchTileRowByName(t, index, maxKm = 60) {
  const list = index.get(normName(t?.name));
  if (!list) return null;
  const toRad = Math.PI / 180;
  const found = new Set();
  for (const r of list) {
    const dLat = (r.lat - t.lat) * toRad;
    const dLon = (r.lon - t.lon) * toRad * Math.cos(((r.lat + t.lat) / 2) * toRad);
    if (Math.hypot(dLat, dLon) * 6371 <= maxKm && MMSI_RE.test(String(r.mmsi))) found.add(String(r.mmsi));
  }
  return found.size === 1 ? [...found][0] : null;
}

/** Čitateľný pôvod polohy do karty. Pure. */
export function feedLabel(feed) {
  if (feed === 'openseafeed') return 'OpenSeaFeed (CC BY 4.0)';
  if (feed === 'aiscast') return 'Open Waters AIS';
  if (feed === 'ocean') return 'oceán · oneskorené';
  if (feed === 'dma') return 'Danish Maritime Authority';
  return 'AISStream';
}
