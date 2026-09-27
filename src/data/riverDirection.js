// src/data/riverDirection.js
/**
 * @module riverDirection
 * @description Smer rieky pri lodi — pre stojace lode bez headingu (2026-09-27, siluety lodí,
 * vlastník: „začni a poctivo"). Stojaca loď bez headingu má COG len šum, takže sa ukazovala
 * náhodne natočená; riečne lode sa vyväzujú prídou PROTI PRÚDU (Vikingy v Bratislave hlásia
 * 268–273°, Dunaj tam tečie na východ). Os Dunaja z OSM (scripts/build-danube-centerline.mjs,
 * src/data/local_data/rivers/danube.json) je kreslená po prúde, takže úsek nesie smer toku.
 *
 * Index sa načíta lenivo (fetch statického súboru, ~107 KB) pri prvej otázke; kým nie je, otázka
 * vráti null (loď ostane pri doterajšom smere) a po načítaní sa zavolajú poslucháči (vrstvy lodí
 * si prepočítajú natočenie).
 */

/** Najväčšia vzdialenosť lode od osi rieky (m), pri ktorej sa ešte berie smer rieky. */
export const RIVER_SNAP_M = 700;
/** Veľkosť bunky mriežky indexu (°). */
const CELL_DEG = 0.05;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

const cellKey = (cx, cy) => `${cx}:${cy}`;

/**
 * Mriežkový index úsekov rieky. Pure.
 * @param {Array<Array<[number, number]>>} lines čiary [lon, lat] v smere toku
 * @returns {{cells: Map<string, Array<number[]>>, segments: number}}
 */
export function buildRiverIndex(lines) {
  const cells = new Map();
  let segments = 0;
  for (const line of lines || []) {
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      if (![ax, ay, bx, by].every(Number.isFinite) || (ax === bx && ay === by)) continue;
      const seg = [ax, ay, bx, by];
      segments += 1;
      const x0 = Math.floor(Math.min(ax, bx) / CELL_DEG); const x1 = Math.floor(Math.max(ax, bx) / CELL_DEG);
      const y0 = Math.floor(Math.min(ay, by) / CELL_DEG); const y1 = Math.floor(Math.max(ay, by) / CELL_DEG);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          const list = cells.get(key);
          if (list) list.push(seg); else cells.set(key, [seg]);
        }
      }
    }
  }
  return { cells, segments };
}

/**
 * Najbližší úsek rieky k bodu a jeho smer PO PRÚDE. Pure.
 * @returns {{downstreamDeg: number, distanceM: number}|null}
 */
export function nearestRiverSegment(index, lat, lon, maxM = RIVER_SNAP_M) {
  if (!index?.cells || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const kx = Math.cos(lat * Math.PI / 180) * M_PER_DEG_LON_EQ;
  const ky = M_PER_DEG_LAT;
  const cx = Math.floor(lon / CELL_DEG); const cy = Math.floor(lat / CELL_DEG);
  let best = null;
  const seen = new Set();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const seg of index.cells.get(cellKey(cx + dx, cy + dy)) || []) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        // lokálne metre okolo lode
        const ax = (seg[0] - lon) * kx; const ay = (seg[1] - lat) * ky;
        const bx = (seg[2] - lon) * kx; const by = (seg[3] - lat) * ky;
        const vx = bx - ax; const vy = by - ay;
        const len2 = vx * vx + vy * vy;
        if (!(len2 > 0)) continue;
        const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2));
        const d = Math.hypot(ax + t * vx, ay + t * vy);
        if (d <= maxM && (!best || d < best.distanceM)) {
          const deg = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
          best = { downstreamDeg: deg, distanceM: d };
        }
      }
    }
  }
  return best;
}

/** Smer PROTI PRÚDU (kam sa stavia príď vyviazanej riečnej lode), alebo null. Pure. */
export function upstreamBearingFrom(index, lat, lon, maxM = RIVER_SNAP_M) {
  const seg = nearestRiverSegment(index, lat, lon, maxM);
  return seg ? (seg.downstreamDeg + 180) % 360 : null;
}

// ── Lenivé načítanie a cache ────────────────────────────────────────────────────────────────
let _index = null;
let _loading = null;
const _listeners = new Set();
const _cache = new Map();
const CACHE_MAX = 5000;

/**
 * Načítaj os Dunaja (raz). Vrstvy volajú pri zapnutí; `onReady` sa zavolá po načítaní.
 * @param {{fetchImpl?: Function, url?: string|URL}} [o]
 * @returns {Promise<boolean>}
 */
export function loadRiverIndex({ fetchImpl = globalThis.fetch, url = null } = {}) {
  if (_index) return Promise.resolve(true);
  if (_loading) return _loading;
  if (typeof fetchImpl !== 'function') return Promise.resolve(false);
  const src = url || new URL('./local_data/rivers/danube.json', import.meta.url);
  _loading = Promise.resolve()
    .then(() => fetchImpl(String(src)))
    .then((res) => (res?.ok === false ? null : res?.json?.()))
    .then((data) => {
      if (!data?.lines) return false;
      _index = buildRiverIndex(data.lines);
      _cache.clear();
      for (const cb of _listeners) { try { cb(); } catch { /* poslucháč nesmie zhodiť ostatné */ } }
      return true;
    })
    .catch(() => false)
    .finally(() => { if (!_index) _loading = null; });
  return _loading;
}

/** Zavolá `cb`, keď je index načítaný (hneď, ak už je). Vráti odhlásenie. */
export function onRiverIndexReady(cb) {
  if (typeof cb !== 'function') return () => {};
  if (_index) { try { cb(); } catch { /* */ } }
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * Smer proti prúdu pri polohe lode (s cache ~11 m); null, kým index nie je alebo loď nie je pri rieke.
 * @returns {number|null}
 */
export function riverUpstreamBearing(lat, lon) {
  if (!_index || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `${Math.round(lat * 1e4)}:${Math.round(lon * 1e4)}`;
  if (_cache.has(key)) return _cache.get(key);
  const value = upstreamBearingFrom(_index, lat, lon);
  if (_cache.size >= CACHE_MAX) _cache.clear();
  _cache.set(key, value);
  return value;
}

/** Len pre testy: nastav / zruš index priamo. */
export function _setRiverIndexForTest(lines) {
  _index = lines ? buildRiverIndex(lines) : null;
  _loading = null;
  _cache.clear();
}
