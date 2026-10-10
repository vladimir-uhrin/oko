// src/data/vesselTimeZone.js
/**
 * @module vesselTimeZone
 * @description Časové pásmo IANA z polohy lode pre riadok „Miestny čas"
 * (2026-10-10). Námorné pásmo z dĺžky v prístave klame (Rotterdam ukazoval
 * UTC namiesto letného SELČ), preto @photostructure/tz-lookup (CC0, hranice
 * pásiem z timezone-boundary-builder; na mori vracia Etc/GMT±N = námorné
 * pásmo). Knižnica sa načíta lenivo až pri prvej lodi — kým nie je, karta
 * použije námorné pásmo a o chvíľu sa prekreslí.
 */

let lookup = null;
let loading = null;
const cache = new Map();
const CACHE_MAX = 2000;

function load() {
  if (lookup || loading) return;
  loading = import('@photostructure/tz-lookup')
    .then((mod) => { lookup = mod.default || mod; })
    .catch(() => { /* bez knižnice ostáva námorné pásmo */ })
    .finally(() => { loading = null; });
}

/**
 * Pásmo pre polohu (bunka 0,05°), alebo null kým knižnica nie je načítaná.
 * @param {number} lat
 * @param {number} lon
 * @returns {string|null}
 */
export function vesselTimeZone(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!lookup) { load(); return null; }
  const key = `${Math.round(lat * 20)}:${Math.round(lon * 20)}`;
  if (cache.has(key)) return cache.get(key);
  let zone = null;
  try { zone = lookup(lat, lon) || null; } catch { zone = null; }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, zone);
  return zone;
}

/** Test seam: načítaj knižnicu hneď. */
export async function _loadVesselTimeZoneForTest() {
  load();
  await loading;
}
