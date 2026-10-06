// src/data/fireHistoryStore.js — história požiarov FIRMS na disku (2026-10-06).
//
// Vlastník: „ak je možné, ukladať históriu požiarov na disk, mám dosť priestoru“. Denné súbory
// <dir>/YYYY-MM-DD.ndjson (deň = deň detekcie UTC), riadok = štíhla detekcia (to isté, čo ide
// klientovi), bez duplicít (kľúč poloha + čas + družica). VIIRS ~140 000 detekcií/deň ≈ 15 MB;
// ostáva čitateľné a dá sa ďalej spracovať (jq, pandas). Čistý Node (fs), bez Vite — testovateľné.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { acquisitionMsUtc } from './firmsCsv.js';
import { fastKm, fireHistoryDay, fireHistoryDays, fireHistoryKey } from './fireNews.js';

/** Najviac dní, ktoré sa pri dopyte čítajú späť. */
export const FIRE_HISTORY_MAX_DAYS = 60;

/** Štíhly riadok detekcie (polia, ktoré číta klient). Pure. */
export function slimFire(f) {
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const r2 = (v) => Math.round(v * 100) / 100;
  const row = { lat: r4(f.lat), lon: r4(f.lon), frp: r2(f.frp), confidence: f.confidence, brightness: Math.round(f.brightness || 0), daynight: f.daynight, acqDate: f.acqDate, acqTime: f.acqTime, satellite: f.satellite };
  if (f.scan > 0 && f.scan < 10) { row.scan = r2(f.scan); row.track = r2(f.track); }
  if (f.geo) { row.geo = true; row.repeats = f.repeats; }
  if (f.geoSeenMs > 0) { row.geoSeenMs = f.geoSeenMs; row.geoSat = f.geoSat; }
  return row;
}

/**
 * @param {{dir: string, now?: () => number}} opts
 */
export function createFireHistoryStore({ dir, now = () => Date.now() }) {
  /** @type {Map<string, Set<string>>} deň → kľúče zapísaných detekcií (pamäť: posledné 3 dni). */
  const keys = new Map();
  let queue = Promise.resolve();
  const file = (day) => path.join(dir, `${day}.ndjson`);

  async function keysFor(day) {
    if (keys.has(day)) return keys.get(day);
    const set = new Set();
    try {
      for (const line of (await fsp.readFile(file(day), 'utf8')).split('\n')) {
        if (!line) continue;
        try { set.add(fireHistoryKey(JSON.parse(line))); } catch { /* poškodený riadok */ }
      }
    } catch { /* súbor ešte nie je */ }
    keys.set(day, set);
    for (const k of [...keys.keys()].sort().slice(0, -3)) keys.delete(k);
    return set;
  }

  /** Zapíše nové detekcie (zápisy idú za sebou, nikdy súbežne). @returns {Promise<number>} počet zapísaných */
  function append(fires) {
    const run = queue.then(async () => {
      const byDay = new Map();
      for (const f of Array.isArray(fires) ? fires : []) {
        const day = fireHistoryDay(f);
        if (!day || !Number.isFinite(f?.lat) || !Number.isFinite(f?.lon)) continue;
        const set = await keysFor(day);
        const k = fireHistoryKey(f);
        if (set.has(k)) continue;
        set.add(k);
        let lines = byDay.get(day);
        if (!lines) { lines = []; byDay.set(day, lines); }
        lines.push(JSON.stringify(slimFire(f)));
      }
      if (!byDay.size) return 0;
      await fsp.mkdir(dir, { recursive: true });
      let written = 0;
      for (const [day, lines] of byDay) {
        await fsp.appendFile(file(day), lines.join('\n') + '\n', 'utf8');
        written += lines.length;
      }
      return written;
    });
    queue = run.catch(() => 0);
    return run;
  }

  /** Je adresár prázdny (prvý štart → naplniť z API)? */
  async function isEmpty() {
    try { return !(await fsp.readdir(dir)).some((n) => n.endsWith('.ndjson')); } catch { return true; }
  }

  /** Detekcie v okruhu (km) za posledných N dní, najnovšie prvé (najviac `limit`). */
  async function around(lat, lon, km, days, limit = 5000) {
    const out = [];
    for (const day of fireHistoryDays(now(), Math.min(FIRE_HISTORY_MAX_DAYS, Math.max(1, days)))) {
      let text;
      try { text = await fsp.readFile(file(day), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line) continue;
        let f;
        try { f = JSON.parse(line); } catch { continue; }
        if (Math.abs(f.lat - lat) > km / 100 || Math.abs(f.lon - lon) > km / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))) continue;
        if (fastKm(lat, lon, f.lat, f.lon) > km) continue;
        f.acqMs = acquisitionMsUtc(f.acqDate, f.acqTime);
        out.push(f);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    out.sort((a, b) => b.acqMs - a.acqMs);
    return out;
  }

  return { append, isEmpty, around, dir };
}
