// src/data/shipHistoryStore.js
/**
 * @module shipHistoryStore
 * @description História lodí na disku (2026-10-11, bod 7 zo zoznamu vylepšení: „história lodí
 * ako história letov — polohy na disk dlhšie než 8 h, prehrať trasu v paneli").
 *
 * Živé AIS (AISStream) drží v pamäti len ~8 h stopy (240 vzoriek). Toto úložisko zapisuje
 * zriedené polohy každej lode do súborov, kým ich niekto nezmaže:
 *
 *   <dir>/<YYYY-MM>/<posledné 2 číslice MMSI>/<MMSI>.bin
 *
 * Záznam 16 B (little-endian): UInt32 čas (s) · Float32 šírka · Float32 dĺžka ·
 * UInt16 rýchlosť ×10 (kn) · UInt16 kurz ×10 (°); 0xFFFF = neznáme.
 * Zriedenie: plávajúca loď najviac raz za 10 min a po ≥ 500 m, stojaca raz za 6 h
 * (~2 M bodov/deň pri celom svete ≈ 30 MB/deň). Mesačné priečinky = lacné mazanie
 * starých mesiacov (SHIP_HISTORY_MONTHS, predvolene 24).
 *
 * Čistý Node (fs), bez Vite — testovateľné. Zápis ide dávkovo (flush), nikdy súbežne.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

export const SHIP_HISTORY_RECORD_BYTES = 16;
export const SHIP_HISTORY_MIN_GAP_SEC = 600;
export const SHIP_HISTORY_MIN_MOVE_M = 500;
export const SHIP_HISTORY_STATIONARY_GAP_SEC = 6 * 3600;
export const SHIP_HISTORY_MAX_DAYS = 366;
export const SHIP_HISTORY_DEFAULT_MONTHS = 24;
const NONE = 0xffff;
const MMSI_RE = /^\d{9}$/;

/** „2026-10" z času v sekundách (UTC). Pure. */
export function shipHistoryMonth(epochSec) {
  const d = new Date(epochSec * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mesiace pokrývajúce interval [from, to] (s), vzostupne. Pure. */
export function shipHistoryMonths(fromSec, toSec) {
  const out = [];
  const d = new Date(Date.UTC(new Date(fromSec * 1000).getUTCFullYear(), new Date(fromSec * 1000).getUTCMonth(), 1));
  const end = shipHistoryMonth(toSec);
  for (let i = 0; i < 400; i += 1) {
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push(key);
    if (key === end) break;
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const metersBetween = (lat1, lon1, lat2, lon2) => {
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
};

/**
 * Zapísať túto polohu? Prvá áno; potom po ≥ 10 min a ≥ 500 m, alebo po 6 h aj bez pohybu. Pure.
 * @param {{lat:number, lon:number, t:number}|null} prev posledná zapísaná
 * @param {{lat:number, lon:number, t:number}} next
 */
export function shouldRecordShipSample(prev, next, {
  minGapSec = SHIP_HISTORY_MIN_GAP_SEC, minMoveM = SHIP_HISTORY_MIN_MOVE_M, stationaryGapSec = SHIP_HISTORY_STATIONARY_GAP_SEC,
} = {}) {
  if (!prev) return true;
  const gap = next.t - prev.t;
  if (gap < minGapSec) return false;
  if (gap >= stationaryGapSec) return true;
  return metersBetween(prev.lat, prev.lon, next.lat, next.lon) >= minMoveM;
}

/** Vzorky → Buffer (16 B na záznam). Pure. */
export function encodeShipSamples(samples) {
  const buf = Buffer.alloc(samples.length * SHIP_HISTORY_RECORD_BYTES);
  samples.forEach((s, i) => {
    const o = i * SHIP_HISTORY_RECORD_BYTES;
    buf.writeUInt32LE(Math.max(0, Math.floor(s.t)) >>> 0, o);
    buf.writeFloatLE(s.lat, o + 4);
    buf.writeFloatLE(s.lon, o + 8);
    buf.writeUInt16LE(Number.isFinite(s.sog) && s.sog >= 0 && s.sog < 6000 ? Math.round(s.sog * 10) : NONE, o + 12);
    buf.writeUInt16LE(Number.isFinite(s.cog) && s.cog >= 0 && s.cog < 360 ? Math.round(s.cog * 10) : NONE, o + 14);
  });
  return buf;
}

/** Buffer → vzorky (neúplný chvost súboru sa ignoruje). Pure. */
export function decodeShipSamples(buf) {
  const out = [];
  const n = Math.floor(buf.length / SHIP_HISTORY_RECORD_BYTES);
  for (let i = 0; i < n; i += 1) {
    const o = i * SHIP_HISTORY_RECORD_BYTES;
    const sog = buf.readUInt16LE(o + 12);
    const cog = buf.readUInt16LE(o + 14);
    out.push({
      t: buf.readUInt32LE(o),
      lat: Math.round(buf.readFloatLE(o + 4) * 1e5) / 1e5,
      lon: Math.round(buf.readFloatLE(o + 8) * 1e5) / 1e5,
      sog: sog === NONE ? null : sog / 10,
      cog: cog === NONE ? null : cog / 10,
    });
  }
  return out;
}

/** Najviac `max` bodov rovnomerne v čase, prvý a posledný ostanú. Pure. */
export function thinShipSamples(samples, max = 3000) {
  if (samples.length <= max) return samples;
  const step = (samples.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(samples[Math.round(i * step)]);
  return out;
}

/**
 * @param {object} o
 * @param {string} o.dir koreň (napr. D:\oko-history\ships)
 * @param {() => number} [o.now] ms
 * @param {number} [o.months] koľko mesiacov držať
 * @param {() => boolean} [o.diskOk] poistka voľného miesta
 */
export function createShipHistoryStore({ dir, now = () => Date.now(), months = SHIP_HISTORY_DEFAULT_MONTHS, diskOk = () => true, log = () => {} }) {
  /** mmsi → posledná zapísaná (alebo čakajúca) poloha */
  const last = new Map();
  /** mmsi → vzorky čakajúce na zápis */
  let pending = new Map();
  let queue = Promise.resolve();
  let written = 0;
  const fileFor = (mmsi, month) => path.join(dir, month, mmsi.slice(-2), `${mmsi}.bin`);

  /** Nová poloha z AIS (volá sa pri každej zriedenej vzorke živej stopy). */
  function record(mmsi, lat, lon, epochSec, sog = null, cog = null) {
    const id = String(mmsi ?? '');
    if (!MMSI_RE.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(epochSec)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return false;
    const sample = { t: Math.floor(epochSec), lat, lon, sog, cog };
    if (!shouldRecordShipSample(last.get(id) || null, sample)) return false;
    last.set(id, sample);
    const list = pending.get(id);
    if (list) list.push(sample); else pending.set(id, [sample]);
    return true;
  }

  /** Zapíše čakajúce vzorky (append do súboru lode a mesiaca). @returns {Promise<number>} */
  function flush() {
    const batch = pending;
    pending = new Map();
    const job = queue.then(async () => {
      if (!batch.size) return 0;
      if (!diskOk()) { log(`[ship-history] málo miesta — ${batch.size} lodí nezapísaných`); return 0; }
      let count = 0;
      const entries = [...batch.entries()];
      const worker = async () => {
        for (let item = entries.pop(); item; item = entries.pop()) {
          const [mmsi, samples] = item;
          const byMonth = new Map();
          for (const s of samples) {
            const m = shipHistoryMonth(s.t);
            if (!byMonth.has(m)) byMonth.set(m, []);
            byMonth.get(m).push(s);
          }
          for (const [month, list] of byMonth) {
            const file = fileFor(mmsi, month);
            try {
              await fsp.mkdir(path.dirname(file), { recursive: true });
              await fsp.appendFile(file, encodeShipSamples(list));
              count += list.length;
            } catch (error) { log(`[ship-history] zápis ${mmsi} zlyhal: ${error?.message || error}`); }
          }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      written += count;
      return count;
    });
    queue = job.catch(() => 0);
    return job;
  }

  /**
   * História lode za interval (s) — disk + ešte nezapísané, zoradené, bez duplicít.
   * @returns {Promise<Array<{t:number, lat:number, lon:number, sog:number|null, cog:number|null}>>}
   */
  async function read(mmsi, fromSec, toSec) {
    const id = String(mmsi ?? '');
    if (!MMSI_RE.test(id)) return [];
    const out = [];
    for (const month of shipHistoryMonths(fromSec, toSec)) {
      try { out.push(...decodeShipSamples(await fsp.readFile(fileFor(id, month)))); } catch { /* mesiac bez záznamu */ }
    }
    for (const s of pending.get(id) || []) out.push({ t: s.t, lat: s.lat, lon: s.lon, sog: Number.isFinite(s.sog) ? s.sog : null, cog: Number.isFinite(s.cog) ? s.cog : null });
    const seen = new Set();
    return out
      .filter((s) => s.t >= fromSec && s.t <= toSec)
      .sort((a, b) => a.t - b.t)
      .filter((s) => (seen.has(s.t) ? false : (seen.add(s.t), true)));
  }

  /** Zmaže mesiace staršie než `months`. @returns {Promise<string[]>} zmazané mesiace */
  async function prune() {
    const d = new Date(now());
    const keepFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (months - 1), 1));
    const cutoff = shipHistoryMonth(keepFrom.getTime() / 1000);
    const removed = [];
    let names = [];
    try { names = await fsp.readdir(dir); } catch { return removed; }
    for (const name of names) {
      if (/^\d{4}-\d{2}$/.test(name) && name < cutoff) {
        try { await fsp.rm(path.join(dir, name), { recursive: true, force: true }); removed.push(name); } catch { /* */ }
      }
    }
    return removed;
  }

  return {
    record,
    flush,
    read,
    prune,
    stats: () => ({ tracked: last.size, pending: [...pending.values()].reduce((s, l) => s + l.length, 0), written }),
  };
}
