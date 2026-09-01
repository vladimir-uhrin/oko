/**
 * SK terén (OKO Fáza 1b) — zdieľané čisté helpery pre merge terén-proxy
 * a klienta.
 *
 * Dizajn: Cesium má JEDEN terrainProvider naraz a globe stacky už majú
 * celosvetový keyless terén (Re:Earth, ELIPSOIDNÉ výšky — výškový kontrakt
 * v docs/CURRENT-STATE.md §1a). SK terén preto NIE JE náhradný provider
 * (ten by sploštil svet — CLAUDE.md: OKO nie je SK-only), ale merge proxy
 * `/api/sk-terrain`: layer.json preberá od Re:Earth (plná globálna
 * availability do z14), dlaždica sa servíruje lokálna (DMR 3.5 → quantized
 * mesh, prevedené na elipsoidné výšky), ak existuje, inak passthrough na
 * Re:Earth. Lokálne dlaždice sa pri builde orezávajú na VNÚTRO dátového
 * footprintu SR — hraničné dlaždice ostávajú Re:Earth, takže na hraniciach
 * nikdy nevznikne útes na 0 m z nodata výplne.
 *
 * Server (vite.config.js skTerrainProxy) aj klient (mapStackController)
 * importujú odtiaľto — jedna definícia cesty, jedna validácia.
 */

/** Merge endpoint servírovaný dev proxy. */
export const SK_TERRAIN_URL = '/api/sk-terrain';
/** Upstream keyless svet — rovnaká báza ako REEARTH_TERRAIN_URL v controlleri. */
export const SK_TERRAIN_UPSTREAM_URL = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
/** Atribúcia mergnutého terénu (CC BY 4.0 — DATA_SOURCES.md). */
export const SK_TERRAIN_CREDIT = 'Terén SR: DMR 3.5 © ÚGKK SR (CC BY 4.0) · svet: Re:Earth';

/**
 * Prísny parser cesty dlaždice `/{z}/{x}/{y}.terrain` (relatívne k basei
 * proxy). Vracia čísla, nikdy reťazce — cesta k súboru sa skladá z nich,
 * takže traversal (`..`, absolútne cesty, query smetie) neprejde.
 * @param {string} pathname
 * @returns {{z: number, x: number, y: number}|null}
 */
export function parseTerrainTilePath(pathname) {
  const m = /^\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.terrain$/.exec(String(pathname || ''));
  if (!m) return null;
  const z = Number(m[1]);
  const x = Number(m[2]);
  const y = Number(m[3]);
  // Geodetický TMS: 2^(z+1) stĺpcov × 2^z riadkov; z nad 22 je nezmysel.
  if (z > 22 || x >= 2 ** (z + 1) || y >= 2 ** z) return null;
  return { z, x, y };
}

/**
 * Bbox geodetickej TMS dlaždice v stupňoch (y rastie od JUHU — schéma `tms`,
 * ktorú používa Re:Earth aj ctb-tile).
 * @param {number} z @param {number} x @param {number} y
 * @returns {{west: number, south: number, east: number, north: number}}
 */
export function geodeticTileBbox(z, x, y) {
  const tileDeg = 180 / 2 ** z;
  const west = -180 + x * tileDeg;
  const south = -90 + y * tileDeg;
  return { west, south, east: west + tileDeg, north: south + tileDeg };
}

/**
 * Test „dlaždica leží celá vo vnútri dátového footprintu" nad hrubou
 * binárnou maskou platnosti (Byte raster: >=128 = dáta). Maska je
 * axis-aligned WGS84 výrez warpnutého rastra; `marginPx` eroduje okraj,
 * aby dlaždica dotýkajúca sa hranice dát nikdy neprešla (tam patrí
 * Re:Earth). Vzorkuje mriežku bodov — pri maske ~300 m/px a dlaždiciach
 * z10+ je 5×5 mriežka spoľahlivo hustejšia než hranica SR.
 * @param {object} input
 * @param {Uint8Array} input.mask — riadky od SEVERU (poradie GDAL rastra)
 * @param {number} input.width @param {number} input.height
 * @param {{west:number, south:number, east:number, north:number}} input.maskBbox
 * @param {{west:number, south:number, east:number, north:number}} input.tileBbox
 * @param {number} [input.marginPx]
 * @param {number} [input.samples]
 * @returns {boolean}
 */
export function maskCoversTile({ mask, width, height, maskBbox, tileBbox, marginPx = 2, samples = 5 }) {
  const lonPerPx = (maskBbox.east - maskBbox.west) / width;
  const latPerPx = (maskBbox.north - maskBbox.south) / height;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const lon = tileBbox.west + ((tileBbox.east - tileBbox.west) * i) / (samples - 1);
      const lat = tileBbox.south + ((tileBbox.north - tileBbox.south) * j) / (samples - 1);
      const px = Math.round((lon - maskBbox.west) / lonPerPx);
      const py = Math.round((maskBbox.north - lat) / latPerPx); // riadok 0 = sever
      for (let dy = -marginPx; dy <= marginPx; dy++) {
        for (let dx = -marginPx; dx <= marginPx; dx++) {
          const sx = px + dx;
          const sy = py + dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) return false;
          if (mask[sy * width + sx] < 128) return false;
        }
      }
    }
  }
  return true;
}

/**
 * Zlúči zoznam dlaždíc jednej úrovne do TMS availability obdĺžnikov
 * ({startX, startY, endX, endY}) — najprv behy po riadkoch (súvislé X),
 * potom zvislé zlúčenie riadkov s identickými behmi. PRESNÉ pokrytie je
 * povinné: availability je pre Cesium prísľub „dlaždica existuje" a 404 na
 * sľúbenej dlaždici je chyba renderovania, nie mäkký fallback — preto sa
 * nesmie použiť bounding box cez odrezané (prune) okraje.
 * @param {Array<{x: number, y: number}>} tiles
 * @returns {Array<{startX: number, startY: number, endX: number, endY: number}>}
 */
export function tileRangesForLevel(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) return [];
  const rows = new Map();
  for (const t of tiles) {
    const x = Number(t?.x);
    const y = Number(t?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) continue;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }
  /** riadok → zoradené behy [startX, endX] */
  const runsByRow = new Map();
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    const runs = [];
    let start = xs[0];
    let prev = xs[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] === prev) continue; // duplicit
      if (xs[i] === prev + 1) { prev = xs[i]; continue; }
      runs.push([start, prev]);
      start = xs[i];
      prev = xs[i];
    }
    runs.push([start, prev]);
    runsByRow.set(y, runs);
  }
  // Zvislé zlúčenie: susedné riadky s identickou sadou behov → jeden obdĺžnik.
  const ys = [...runsByRow.keys()].sort((a, b) => a - b);
  const ranges = [];
  let bandStart = ys[0];
  let bandRuns = runsByRow.get(ys[0]);
  const sameRuns = (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1]);
  const flushBand = (endY) => {
    for (const [x0, x1] of bandRuns) {
      ranges.push({ startX: x0, startY: bandStart, endX: x1, endY: endY });
    }
  };
  for (let i = 1; i < ys.length; i++) {
    const y = ys[i];
    const runs = runsByRow.get(y);
    if (y === ys[i - 1] + 1 && sameRuns(runs, bandRuns)) continue;
    flushBand(ys[i - 1]);
    bandStart = y;
    bandRuns = runs;
  }
  flushBand(ys[ys.length - 1]);
  return ranges;
}

/**
 * Zlúči availability overlay lokálneho buildu do upstream layer.json.
 *
 * PREČO: Re:Earth hlási maxzoom 14 — bez rozšírenia by si Cesium dlaždice
 * z15+ NIKDY nevypýtal a jemnejší lokálny build by bol neviditeľný. Úrovne
 * ≤ upstream maxzoom sa NEDOTÝKAJÚ (tam platí plná globálna availability
 * a lokálna dlaždica vyhráva na proxy); úrovne nad ňou nesú PRESNÉ rozsahy
 * lokálnych dlaždíc — mimo nich Cesium ostáva na hrubšej úrovni, čo je
 * správne (svet nemá z15+ zdroj).
 *
 * Fail-open: nevalidný overlay vráti upstream nezmenený — degradácia na
 * dnešné správanie, nikdy pokazený layer.json.
 * @param {object} upstreamLayerJson - Parsovaný upstream layer.json.
 * @param {?{available: Object<string, Array>, maxzoom?: number}} overlay
 * @returns {object} Nový objekt layer.json (vstup sa nemení).
 */
export function mergeTerrainAvailability(upstreamLayerJson, overlay) {
  if (!upstreamLayerJson || typeof upstreamLayerJson !== 'object') return upstreamLayerJson;
  const upstreamAvailable = Array.isArray(upstreamLayerJson.available)
    ? upstreamLayerJson.available
    : null;
  if (!upstreamAvailable) return upstreamLayerJson;
  const upstreamMax = upstreamAvailable.length - 1;
  // Len úrovne NAD upstream maxom — nižšie sú už plne pokryté a nedotýkame
  // sa ich. Keď po filtri nič neostane, vraciame upstream referenčne
  // nezmenený (žiadny falošný „merge").
  const overlayLevels = overlay && typeof overlay.available === 'object' && overlay.available !== null
    ? Object.keys(overlay.available)
      .map((k) => Number(k))
      .filter((z) => Number.isInteger(z) && z > upstreamMax
        && Array.isArray(overlay.available[z]) && overlay.available[z].length > 0)
    : [];
  if (overlayLevels.length === 0) return upstreamLayerJson;

  const merged = upstreamAvailable.map((ranges) => ranges);
  let maxLevel = upstreamMax;
  for (const z of overlayLevels.sort((a, b) => a - b)) {
    while (merged.length < z) merged.push([]); // medziúroveň bez dlaždíc = prázdna
    merged[z] = overlay.available[z];
    maxLevel = Math.max(maxLevel, z);
  }
  return {
    ...upstreamLayerJson,
    available: merged,
    maxzoom: Math.max(Number(upstreamLayerJson.maxzoom) || upstreamMax, maxLevel),
  };
}

/**
 * Rozhodne URL keyless terénu pre klienta: lokálny merge endpoint, ak jeho
 * layer.json odpovedá (dev server s proxy), inak priamy Re:Earth (produkčný
 * build bez middleware — správanie ako doteraz). Nikdy nehádže.
 * @param {object} [input]
 * @param {Function} [input.fetchImpl]
 * @param {string} [input.localUrl]
 * @param {string} [input.upstreamUrl]
 * @param {number} [input.timeoutMs]
 * @returns {Promise<{url: string, merged: boolean}>}
 */
export async function resolveKeylessTerrainUrl({
  fetchImpl = (...args) => fetch(...args),
  localUrl = SK_TERRAIN_URL,
  upstreamUrl = SK_TERRAIN_UPSTREAM_URL,
  timeoutMs = 4000,
} = {}) {
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
    const response = await fetchImpl(`${localUrl}/layer.json`, { signal });
    if (response?.ok) return { url: localUrl, merged: true };
  } catch { /* žiadna proxy — produkčný build alebo mŕtvy dev server */ }
  return { url: upstreamUrl, merged: false };
}
