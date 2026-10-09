// scripts/lib/skTerrainUpstreamCache.mjs
// Strop diskovej cache upstream terénu (2026-10-09). Od 79da7cb idú dlaždice Re:Earth pre CELÝ svet cez
// /api/sk-terrain a ukladajú sa write-through do .gev-cache/sk-terrain-upstream (junction na D:) — predtým
// tadiaľ šli len dev/keyless režimy, teraz každý návštevník, a bez akéhokoľvek stropu. Tu: výber súborov na
// zmazanie podľa veku a celkovej veľkosti (LRU podľa mtime — proxy pri zásahu dlaždicu „dotkne“, takže mtime je
// čas posledného použitia, nie len zápisu) a asynchrónne upratanie priečinka, ktoré nikdy neblokuje požiadavku.

import fsp from 'node:fs/promises';
import path from 'node:path';

/** Predvolený strop celkovej veľkosti (MB) — ~50 000 dlaždíc po ~40 kB. */
export const DEFAULT_MAX_MB = 2048;
/** Predvolený vek: dlaždica nepoužitá dlhšie než toľko dní sa zmaže aj pod stropom veľkosti. */
export const DEFAULT_MAX_DAYS = 30;

/** Meno dlaždice v cache: `${z}-${x}-${y}.terrain` (vite.config.js upstreamCachePath). Iné súbory sa nechajú. */
const TILE_NAME = /^\d{1,2}-\d{1,7}-\d{1,7}\.terrain$/;

/**
 * Limity z .env (čítať LENIVO — loadEnv kopíruje do process.env až v config hooku Vite):
 *   SK_TERRAIN_UPSTREAM_CACHE_MAX_MB=2048    strop celkovej veľkosti cache
 *   SK_TERRAIN_UPSTREAM_CACHE_MAX_DAYS=30    dlaždica nepoužitá dlhšie sa zmaže
 * Nečíselná alebo nekladná hodnota = predvolená. Pure.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{maxBytes: number, maxAgeMs: number}}
 */
export function upstreamCacheLimits(env = process.env) {
  const mb = Number(env?.SK_TERRAIN_UPSTREAM_CACHE_MAX_MB);
  const days = Number(env?.SK_TERRAIN_UPSTREAM_CACHE_MAX_DAYS);
  return {
    maxBytes: Math.round((mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024),
    maxAgeMs: Math.round((days > 0 ? days : DEFAULT_MAX_DAYS) * 86_400_000),
  };
}

/**
 * Dlaždice na zmazanie. Pure. Najprv všetko s mtime starším než maxAgeMs; potom, kým súčet ZVYŠKU presahuje
 * maxBytes, najdlhšie nepoužité (najmenšie mtime). Súbory s iným menom než dlaždica sa nikdy nevyberú.
 * Výsledok je zoradený od najstaršej (zhodný mtime → podľa mena, aby bol výber deterministický).
 * @param {{name: string, size: number, mtimeMs: number}[]} entries
 * @param {number} nowMs
 * @param {{maxBytes: number, maxAgeMs: number}} limits
 * @returns {{name: string, size: number, mtimeMs: number}[]}
 */
export function tilesToPrune(entries, nowMs, { maxBytes, maxAgeMs }) {
  const tiles = (entries || [])
    .filter((e) => e && TILE_NAME.test(String(e.name)))
    .map((e) => ({
      name: String(e.name),
      size: Number.isFinite(e.size) && e.size > 0 ? e.size : 0,
      mtimeMs: Number.isFinite(e.mtimeMs) ? e.mtimeMs : 0, // neznámy čas = najstaršia
    }))
    .sort((a, b) => (a.mtimeMs - b.mtimeMs) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const ageLimit = nowMs - maxAgeMs;
  let total = 0;
  for (const tile of tiles) total += tile.size;
  const out = [];
  // Zoradené od najstaršej: expirované sú prefix, za nimi LRU výber — prvá dlaždica, ktorá nie je
  // expirovaná a pri ktorej už súčet nepresahuje strop, ukončí výber (všetky ďalšie sú novšie).
  for (const tile of tiles) {
    const expired = tile.mtimeMs < ageLimit;
    if (!expired && total <= maxBytes) break;
    out.push(tile);
    total -= tile.size;
  }
  return out;
}

/** Súčet veľkostí. */
const sumBytes = (list) => list.reduce((s, e) => s + e.size, 0);

/**
 * Upratanie priečinka cache: readdir + stat (v dávkach), zmazanie podľa tilesToPrune. Chyby jednotlivých
 * súborov sa ignorujú (dlaždica sa môže práve zapisovať alebo už zmizla — EBUSY/ENOENT nie sú chyby stropu).
 * Chýbajúci priečinok = nič na upratanie. `dryRun` len spočíta.
 * @param {string} dir
 * @param {{nowMs?: number, limits?: {maxBytes: number, maxAgeMs: number}, dryRun?: boolean}} [opts]
 * @returns {Promise<{scanned: number, totalBytes: number, deleted: number, deletedBytes: number, kept: number, keptBytes: number, dryRun: boolean}>}
 */
export async function pruneUpstreamCache(dir, { nowMs = Date.now(), limits = upstreamCacheLimits(), dryRun = false } = {}) {
  const names = await fsp.readdir(dir).catch((err) => {
    if (err?.code === 'ENOENT') return [];
    throw err;
  });
  const tileNames = names.filter((name) => TILE_NAME.test(name));
  /** @type {{name: string, size: number, mtimeMs: number}[]} */
  const entries = [];
  const BATCH = 64;
  for (let i = 0; i < tileNames.length; i += BATCH) {
    const batch = tileNames.slice(i, i + BATCH);
    const stats = await Promise.all(batch.map((name) => fsp.stat(path.join(dir, name)).catch(() => null)));
    for (let j = 0; j < batch.length; j += 1) {
      const st = stats[j];
      if (st?.isFile()) entries.push({ name: batch[j], size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  const victims = tilesToPrune(entries, nowMs, limits);
  let deleted = 0;
  let deletedBytes = 0;
  if (dryRun) {
    deleted = victims.length;
    deletedBytes = sumBytes(victims);
  } else {
    for (let i = 0; i < victims.length; i += BATCH) {
      const batch = victims.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((v) => fsp.unlink(path.join(dir, v.name)).then(() => true, () => false)));
      for (let j = 0; j < batch.length; j += 1) {
        if (results[j]) { deleted += 1; deletedBytes += batch[j].size; }
      }
    }
  }
  const totalBytes = sumBytes(entries);
  return {
    scanned: entries.length,
    totalBytes,
    deleted,
    deletedBytes,
    kept: entries.length - deleted,
    keptBytes: totalBytes - deletedBytes,
    dryRun,
  };
}

/** `45.2 MB` pre logy a CLI. */
export function formatMb(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`;
}
