// src/data/snapshotCells.js
/**
 * @module snapshotCells
 * @description Bunky 5° × 5° pre veľké statické snímky čiar (2026-11-07):
 * elektrická sieť ≥ 220 kV (231 k úsekov) a od celosvetového rozšírenia aj
 * plynovody a ropovody sa nenačítavajú naraz. Build rozdelí snímok na bunky
 * podľa stredu úseku (každý úsek v práve jednej bunke → id sa nezdvoja),
 * server bunky len streamuje, prehliadač berie bunky vo výhľade od stredu
 * obrazovky, kým nedosiahne strop úsekov, a vzdialené uvoľňuje.
 *
 * Pôvodne žili v powerGrid.js (2026-11-06); powerGrid ich ďalej vyváža pod
 * pôvodnými menami. Modul je čistý — importuje ho build, vite.config.js aj klient.
 */

export const CELL_DEG = 5;
/**
 * Strop úsekov v pamäti vrstvy. Merané 2026-11-06 po GC: ~20 kB na čiaru (10 428
 * vedení nad SR = +216 MB, plynovody 21 339 = +427 MB) → 16 000 ≈ 330 MB; dotyk 6 000.
 */
export const CELL_MAX_RESIDENT = Object.freeze({ desktop: 16_000, touch: 6_000 });

/** Strop podľa zariadenia: hrubý ukazovateľ (prst) = telefón/tablet → menší strop. */
export function defaultMaxResident() {
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
  return touch ? CELL_MAX_RESIDENT.touch : CELL_MAX_RESIDENT.desktop;
}

/** URL bunky: `<base><id>?v=<dátum snímku>` (nový build = nová URL, bez tvrdého reloadu). */
export function cellUrlFor(base) {
  return (id, snapshot) => `${base}${encodeURIComponent(id)}${snapshot ? `?v=${encodeURIComponent(String(snapshot))}` : ''}`;
}

/** Stredný bod úseku (kotva bunky) — ten istý ako kotva karty (pipelineMidpoint). */
function midpointOf(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const mid = coordinates[Math.floor(coordinates.length / 2)];
  return Number.isFinite(mid?.[0]) && Number.isFinite(mid?.[1]) ? { lon: mid[0], lat: mid[1] } : null;
}

/** Id bunky z bodu: „45_15" = južný a západný okraj v stupňoch. */
export function cellId(lon, lat, deg = CELL_DEG) {
  const s = Math.floor(lat / deg) * deg;
  const w = Math.floor(lon / deg) * deg;
  return `${s}_${w}`;
}

/** Bbox bunky [S, W, N, E] z id. */
export function cellBbox(id, deg = CELL_DEG) {
  const [s, w] = String(id).split('_').map(Number);
  return [s, w, s + deg, w + deg];
}

/**
 * Index buniek zo snímku a riadky geojsonl po bunkách.
 * @param {Array<{feature: object, line: string}>} rows prvky s pôvodným riadkom súboru
 * @param {{deg?: number, kinds?: string[], kindOf?: (properties: object) => string}} [o]
 *   `kinds` = druhy pre súčty v legende (poradie čipov), `kindOf` = druh prvku
 */
export function buildCellIndex(rows, { deg = CELL_DEG, kinds = [], kindOf = () => null } = {}) {
  const cells = new Map();
  for (const { feature, line } of rows) {
    const mid = midpointOf(feature?.geometry?.coordinates);
    if (!mid) continue;
    const id = cellId(mid.lon, mid.lat, deg);
    if (!cells.has(id)) cells.set(id, { id, bbox: cellBbox(id, deg), count: 0, lengthKm: 0, kinds: Object.fromEntries(kinds.map((k) => [k, 0])), lines: [] });
    const cell = cells.get(id);
    cell.count += 1;
    cell.lengthKm += Number(feature.properties?.lengthKm) || 0;
    const kind = kindOf(feature.properties || {});
    if (kind !== null && kind !== undefined && Object.hasOwn(cell.kinds, kind)) cell.kinds[kind] += 1;
    cell.lines.push(line);
  }
  const list = [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
  const totals = Object.fromEntries(kinds.map((k) => [k, list.reduce((n, c) => n + c.kinds[k], 0)]));
  return {
    index: { cellDeg: deg, totals, features: list.reduce((n, c) => n + c.count, 0), cells: list.map(({ lines, lengthKm, ...c }) => ({ ...c, lengthKm: Math.round(lengthKm) })) },
    linesByCell: new Map(list.map((c) => [c.id, c.lines])),
  };
}

/** Uhlová vzdialenosť stredu bunky od bodu (stupne, približne; na triedenie stačí). */
function cellDistance(cell, lon, lat) {
  const [s, w, n, e] = cell.bbox;
  const clat = (s + n) / 2;
  const clon = (w + e) / 2;
  const dlon = Math.abs(((clon - lon + 540) % 360) - 180) * Math.cos(((clat + lat) / 2) * Math.PI / 180);
  return Math.hypot(dlon, clat - lat);
}

/** Pretína bunka obdĺžnik výhľadu (stupne; výhľad cez 180° poludník = dva kusy)? */
function cellInView(cell, view) {
  const [s, w, n, e] = cell.bbox;
  if (n < view.south || s > view.north) return false;
  if (view.west <= view.east) return e >= view.west && w <= view.east;
  return e >= view.west || w <= view.east;
}

/**
 * Ktoré bunky majú byť v pamäti: bunky vo výhľade (s okrajom), od stredu
 * obrazovky, kým súčet úsekov neprekročí strop. Prázdny výhľad (kamera
 * mimo Zeme) = bunky najbližšie k stredu.
 * @param {Array<{id: string, bbox: number[], count: number}>} cells
 * @param {{west: number, south: number, east: number, north: number, lon: number, lat: number}|null} view stupne
 * @param {{maxResident?: number, marginDeg?: number}} [o]
 * @returns {string[]}
 */
export function selectCells(cells, view, { maxResident = 16_000, marginDeg = 1 } = {}) {
  if (!Array.isArray(cells) || !view || !Number.isFinite(view.lon) || !Number.isFinite(view.lat)) return [];
  const box = Number.isFinite(view.west) ? { west: view.west - marginDeg, east: view.east + marginDeg, south: view.south - marginDeg, north: view.north + marginDeg } : null;
  const candidates = cells.filter((c) => c.count > 0 && (!box || cellInView(c, box)));
  candidates.sort((a, b) => cellDistance(a, view.lon, view.lat) - cellDistance(b, view.lon, view.lat));
  const out = [];
  let total = 0;
  for (const c of candidates) {
    // Súvislý kruh od stredu: prvá bunka, ktorá sa nezmestí, výber končí. Preskakovanie
    // by strop zaplnilo menšími vzdialenými bunkami a husté jadro výhľadu by chýbalo
    // (2026-11-06 na snímke z 2 500 km: Nemecko v strede prázdne, Balkán plný).
    if (total + c.count > maxResident) { if (!out.length) out.push(c.id); break; }
    out.push(c.id);
    total += c.count;
  }
  return out;
}
