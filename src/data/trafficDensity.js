// src/data/trafficDensity.js
/**
 * @module trafficDensity
 * @description Agregovaná hustota letovej prevádzky pre pohľad na celý svet.
 *
 * Pri pohľade na glóbus je 12 000 jednotlivých kontaktov informačne prázdnych:
 * nikto ich nečíta jeden po druhom, a aj zmenšené na 9 px zaberajú pätinu
 * obrazovky. Zaujímavá je vtedy HUSTOTA — kde sa lieta a kde nie, atlantické
 * koridory, prázdno nad oceánmi a púšťami. Toto je ten istý nápad, aký už
 * v projekte používa vrstva požiarov FIRMS (agregované bunky pri oddialení,
 * jednotlivé detekcie pri priblížení).
 *
 * Modul je čistý: žiadny Cesium, žiadny DOM. Vrstvy mu podajú ploché záznamy,
 * on vráti bunky — takže sa dá odtestovať bez prehliadača a rovnaká logika
 * platí pre civilnú aj vojenskú flotilu.
 */

/**
 * Výška kamery (m), nad ktorou sa kreslí hustota namiesto jednotlivých strojov.
 *
 * Leží VYSOKO nad prahom najmenších ikon (950 km): medzi nimi je pásmo, kde sa
 * jednotlivé stroje ešte dajú rozoznať a sú užitočné. Hustota nastupuje až
 * tam, kde je v zábere kontinent a jednotlivé body splývajú do šumu.
 */
export const DENSITY_ENTER_ALT_M = 3_500_000;

/** Hranica pri klesaní — pásmo hysterézy, aby kamera na hranici neprepínala. */
export const DENSITY_EXIT_ALT_M = 2_800_000;

/**
 * Veľkosť bunky v stupňoch podľa výšky kamery.
 *
 * Hrubšia mriežka pri pohľade na pologuľu, jemnejšia pri kontinente — inak by
 * globálny pohľad ukázal tisíce buniek (rovnaký šum ako jednotlivé stroje) a
 * kontinentálny len pár štvorcov bez tvaru.
 */
export const DENSITY_GRID_BANDS = Object.freeze([
  Object.freeze({ minHeightM: 9_000_000, gridDegrees: 6 }),
  Object.freeze({ minHeightM: 5_500_000, gridDegrees: 4 }),
  Object.freeze({ minHeightM: 0, gridDegrees: 2.5 }),
]);

/** Strop počtu vykreslených buniek — ochrana proti scéne plnej škvŕn. */
export const DENSITY_MAX_CELLS = 900;

/**
 * Kreslí sa pri tejto výške hustota namiesto jednotlivých strojov?
 * @param {number} cameraHeightM Výška kamery nad elipsoidom.
 * @param {boolean} [wasActive=false] Odpoveď z predchádzajúceho vyhodnotenia.
 * @returns {boolean}
 */
export function densityModeActive(cameraHeightM, wasActive = false) {
  if (!Number.isFinite(cameraHeightM)) return false;
  return cameraHeightM >= (wasActive ? DENSITY_EXIT_ALT_M : DENSITY_ENTER_ALT_M);
}

/**
 * Veľkosť mriežky pre danú výšku.
 * @param {number} cameraHeightM
 * @returns {number} Stupne.
 */
export function densityGridDegrees(cameraHeightM) {
  const height = Number.isFinite(cameraHeightM) ? cameraHeightM : 0;
  for (const band of DENSITY_GRID_BANDS) {
    if (height >= band.minHeightM) return band.gridDegrees;
  }
  return DENSITY_GRID_BANDS[DENSITY_GRID_BANDS.length - 1].gridDegrees;
}

/**
 * Zoskupí kontakty do buniek mriežky.
 *
 * Bunka nesie počet a ŤAŽISKO kontaktov, nie stred štvorca — pri hrubej
 * mriežke by stred posúval škvrnu aj o stovky kilometrov od miesta, kde sa
 * reálne lieta, a koridory by sa rozpadli na pravidelnú šachovnicu.
 *
 * @param {Iterable<{lat: number, lon: number, military?: boolean}>} records
 * @param {number} gridDegrees Veľkosť bunky v stupňoch.
 * @param {{maxCells?: number}} [options]
 * @returns {Array<{lat: number, lon: number, count: number, military: number}>}
 *   Bunky zoradené od najhustejšej; `lat`/`lon` je ťažisko.
 */
export function aggregateTraffic(records, gridDegrees, { maxCells = DENSITY_MAX_CELLS } = {}) {
  const size = Number.isFinite(gridDegrees) && gridDegrees > 0 ? gridDegrees : 2.5;
  const cells = new Map();

  for (const record of records || []) {
    const lat = Number(record?.lat);
    const lon = Number(record?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const latCell = Math.floor(lat / size);
    const lonCell = Math.floor(lon / size);
    const key = `${latCell}:${lonCell}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { sumLat: 0, sumLon: 0, count: 0, military: 0 };
      cells.set(key, cell);
    }
    cell.sumLat += lat;
    cell.sumLon += lon;
    cell.count += 1;
    if (record?.military === true) cell.military += 1;
  }

  const out = [];
  for (const cell of cells.values()) {
    out.push({
      lat: cell.sumLat / cell.count,
      lon: cell.sumLon / cell.count,
      count: cell.count,
      military: cell.military,
    });
  }
  // Najhustejšie prvé: keď strop odreže chvost, padnú prázdne kúty, nie
  // koridory.
  out.sort((a, b) => b.count - a.count);
  return out.slice(0, Math.max(1, maxCells));
}

/**
 * Veľkosť značky bunky v pixeloch.
 *
 * LOGARITMICKY: bunka so 400 strojmi nie je stokrát dôležitejšia než bunka so
 * štyrmi, a lineárna mierka by z Frankfurtu spravila škvrnu cez pol Európy.
 * @param {number} count Počet kontaktov v bunke.
 * @param {number} [maxCount] Najväčší počet v scéne (normalizácia).
 * @returns {number} Priemer v px.
 */
export function densityMarkerPx(count, maxCount = 100) {
  const n = Math.max(1, Number(count) || 1);
  const top = Math.max(2, Number(maxCount) || 2);
  const ratio = Math.log(n + 1) / Math.log(top + 1);
  return 4 + Math.min(1, Math.max(0, ratio)) * 16; // 4–20 px
}

/**
 * Priehľadnosť značky — riedke bunky ustúpia, husté vyniknú.
 * @param {number} count
 * @param {number} [maxCount]
 * @returns {number} 0..1
 */
export function densityMarkerAlpha(count, maxCount = 100) {
  const n = Math.max(1, Number(count) || 1);
  const top = Math.max(2, Number(maxCount) || 2);
  const ratio = Math.log(n + 1) / Math.log(top + 1);
  return 0.28 + Math.min(1, Math.max(0, ratio)) * 0.55;
}
