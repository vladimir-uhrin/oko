// src/data/shipServer/shipIdIndex.js
/**
 * @module shipServer/shipIdIndex
 * @description Index preložených ID lodí z dlaždíc registra (shipId → MMSI) v jednom súbore.
 *
 * 2026-10-16: oko-api po každom štarte stálo 51–231 s (verejné /api 502, strážca ho raz zabil).
 * CPU profil štartu: 50 s v `readFileSync` zo slučky v supplements.js, ktorá synchrónne čítala
 * KAŽDÝ súbor `ship-<id>.json` v .gev-cache/vessel-info/mt — adresár so stovkami tisíc malých
 * súborov na disku D: (samotný výpis trvá vyše 2 min). Teraz sa pri štarte číta jeden riadkový
 * súbor `ship-ids.tsv` asynchrónne (parsovanie po dávkach s uvoľnením vlákna) a nové preklady sa
 * doň pripisujú. Starý adresár sa prejde JEDINÝ raz, asynchrónne na pozadí (opendir po dávkach,
 * súbory po niekoľkých naraz), a výsledok sa zapíše do indexu.
 *
 * Riadok: `shipId \t mmsi|- \t atMs` (posledný riadok pre ID vyhráva).
 */
import fs from 'node:fs';
import path from 'node:path';

export const SHIP_ID_INDEX_FILE = 'ship-ids.tsv';
/** Značka, že starý adresár mt/ už bol do indexu prenesený (stačí raz). */
export const SHIP_ID_MIGRATED_FILE = 'ship-ids.migrated';
/** Koľko riadkov sa sparsuje medzi uvoľneniami vlákna. */
export const SHIP_ID_PARSE_CHUNK = 20_000;
/** Pripísané riadky sa zapíšu najneskôr po tomto čase (jedným appendFile). */
export const SHIP_ID_FLUSH_MS = 5_000;
/** Súbežné čítania súborov pri jednorazovom prenose. */
export const SHIP_ID_MIGRATE_CONCURRENCY = 8;

const ID_RE = /^\d{1,12}$/;
const MMSI_RE = /^\d{9}$/;

/** Jeden riadok indexu (pure); null pri neplatnom ID. */
export function formatShipIdLine(shipId, mmsi, atMs) {
  const id = String(shipId ?? '');
  if (!ID_RE.test(id)) return null;
  const m = MMSI_RE.test(String(mmsi ?? '')) ? String(mmsi) : '-';
  const at = Number.isFinite(atMs) ? Math.round(atMs) : 0;
  return `${id}\t${m}\t${at}\n`;
}

/** Riadok → [shipId, mmsi|null] alebo null (pure). */
export function parseShipIdLine(line) {
  const parts = line.split('\t');
  if (parts.length < 2 || !ID_RE.test(parts[0])) return null;
  return [parts[0], MMSI_RE.test(parts[1]) ? parts[1] : null];
}

/** Záznam zo starého súboru ship-<id>.json → mmsi|null (pure). */
export function mmsiFromLegacyEntry(entry) {
  const m = entry?.mmsi || entry?.ship?.mmsi || null;
  return MMSI_RE.test(String(m ?? '')) ? String(m) : null;
}

const defaultYield = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Sparsuje text indexu do mapy po dávkach (medzi dávkami uvoľní vlákno). Posledný riadok vyhráva.
 * @returns {Promise<number>} počet platných riadkov
 */
export async function parseShipIdIndex(text, into, { chunk = SHIP_ID_PARSE_CHUNK, yieldFn = defaultYield } = {}) {
  let count = 0;
  let start = 0;
  let inChunk = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const parsed = parseShipIdLine(text.slice(start, end).replace(/\r$/, ''));
    if (parsed) { into.set(parsed[0], parsed[1]); count += 1; }
    start = end + 1;
    inChunk += 1;
    if (inChunk >= chunk) { inChunk = 0; await yieldFn(); }
  }
  return count;
}

/**
 * @param {object} o
 * @param {string} o.dir priečinok .gev-cache/vessel-info
 * @param {Map<string, string|null>} o.known mapa resolvera (plní sa priebežne)
 * @param {typeof fs.promises} [o.fsp]
 * @param {() => number} [o.now]
 * @param {{log?: Function, warn?: Function}} [o.log]
 */
export function createShipIdIndex({ dir, known, fsp = fs.promises, now = Date.now, log = console,
  setTimeoutImpl = setTimeout, yieldFn = defaultYield, concurrency = SHIP_ID_MIGRATE_CONCURRENCY }) {
  const indexFile = path.join(dir, SHIP_ID_INDEX_FILE);
  const migratedFile = path.join(dir, SHIP_ID_MIGRATED_FILE);
  const legacyDir = path.join(dir, 'mt');
  let pending = '';
  let flushTimer = null;
  let flushing = Promise.resolve();
  let stopped = false;

  function flush() {
    flushTimer = null;
    if (!pending) return flushing;
    const chunk = pending;
    pending = '';
    flushing = flushing
      .then(() => fsp.mkdir(dir, { recursive: true }))
      .then(() => fsp.appendFile(indexFile, chunk))
      .catch((error) => log.warn?.(`[ship-ids] zápis indexu zlyhal: ${error?.message || error}`));
    return flushing;
  }

  /** Pripíše preklad do indexu (zapíše sa dávkou do SHIP_ID_FLUSH_MS). */
  function append(shipId, mmsi, atMs = now()) {
    const line = formatShipIdLine(shipId, mmsi, atMs);
    if (!line) return;
    pending += line;
    if (!flushTimer && !stopped) {
      flushTimer = setTimeoutImpl(flush, SHIP_ID_FLUSH_MS);
      flushTimer?.unref?.();
    }
  }

  /** Jednorazový prenos starého adresára mt/ (asynchrónne, po dávkach). */
  async function migrateLegacy() {
    let dirHandle;
    try { dirHandle = await fsp.opendir(legacyDir, { bufferSize: 256 }); } catch { return 0; }
    let moved = 0;
    let lines = '';
    const inFlight = new Set();
    const readOne = async (name, id) => {
      try {
        const mmsi = mmsiFromLegacyEntry(JSON.parse(await fsp.readFile(path.join(legacyDir, name), 'utf8')));
        if (!known.has(id)) known.set(id, mmsi);
        const line = formatShipIdLine(id, mmsi, 0);
        if (line) { lines += line; moved += 1; }
      } catch { /* poškodený súbor preskoč */ }
    };
    for await (const entry of dirHandle) {
      if (stopped) break;
      const m = /^ship-(\d+)\.json$/.exec(entry.name);
      if (!m) continue;
      const p = readOne(entry.name, m[1]).finally(() => inFlight.delete(p));
      inFlight.add(p);
      if (inFlight.size >= concurrency) await Promise.race(inFlight);
      if (lines.length > 256_000) { const out = lines; lines = ''; await fsp.appendFile(indexFile, out); }
    }
    await Promise.all(inFlight);
    if (lines) await fsp.appendFile(indexFile, lines);
    if (!stopped) await fsp.writeFile(migratedFile, String(now()));
    return moved;
  }

  /**
   * Načíta index do `known` a, ak ešte nebol, spustí na pozadí prenos starého adresára.
   * Nikdy neblokuje vlákno dlhšie než jednu dávku parsovania.
   */
  async function load() {
    const t0 = now();
    let text = '';
    try { text = await fsp.readFile(indexFile, 'utf8'); } catch { /* ešte nie je */ }
    // Index sa číta do dočasnej mapy, aby čerstvé preklady z bežiacej slučky nezmazal starší riadok.
    const fromFile = new Map();
    const count = text ? await parseShipIdIndex(text, fromFile, { yieldFn }) : 0;
    for (const [id, mmsi] of fromFile) if (!known.has(id)) known.set(id, mmsi);
    let migrated = true;
    try { await fsp.access(migratedFile); } catch { migrated = false; }
    log.log?.(`[ship-ids] index: ${count} prekladov za ${now() - t0} ms${migrated ? '' : ' — prenášam starý adresár na pozadí'}`);
    if (!migrated) {
      await fsp.mkdir(dir, { recursive: true }).catch(() => {});
      const t1 = now();
      const moved = await migrateLegacy().catch((error) => { log.warn?.(`[ship-ids] prenos zlyhal: ${error?.message || error}`); return -1; });
      if (moved >= 0) log.log?.(`[ship-ids] prenesených ${moved} prekladov zo starého adresára za ${Math.round((now() - t1) / 1000)} s`);
    }
    return count;
  }

  return {
    load,
    append,
    flush,
    indexFile,
    stop() { stopped = true; if (flushTimer) clearTimeout(flushTimer); return flush(); },
  };
}
