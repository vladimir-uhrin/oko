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

/**
 * Horizontový cull buniek.
 *
 * Bunky sa kreslia bez hĺbkového testu — rovnako ako kontakty, lebo glóbus
 * môže byť skrytý (Google 3D) a odvrátená strana potom nemá hĺbku. Bez cullu
 * by bunka z odvrátenej strany Zeme presvitala cez glóbus ako krúžok nalepený
 * na jeho okraji (nález 2026-09-04: 163 z 284 buniek severoamerickej
 * premávky svietilo na limbe pri pohľade na Európu). Rozhoduje TEN ISTÝ
 * occluder, ktorým flotila skrýva stroje za obzorom.
 *
 * Čisté: kolekcia je čokoľvek s `length`/`get(i)`, bod má `position`/`show`.
 * Bez occludera (ešte niet kamery) sa nič neskrýva.
 *
 * @param {{length: number, get: function(number): ({position: object, show: boolean}|undefined)}|null} points
 * @param {?{isPointVisible: function(object): boolean}} occluder
 * @returns {number} Počet viditeľných buniek.
 */
export function cullDensityCells(points, occluder, camera = null, paint = null) {
  if (!points || !Number.isFinite(points.length) || typeof points.get !== 'function') return 0;
  const limb = camera && Number.isFinite(camera.heightM) && Number.isFinite(camera.latDeg)
    && Number.isFinite(camera.lonDeg);
  const horizon = limb ? horizonAngleRad(camera.heightM) : 0;
  let visible = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points.get(i);
    if (!point) continue;
    let show = !occluder || !point.position || occluder.isPointVisible(point.position) === true;
    // Limbový taper: bunka tesne PRED obzorom je síce viditeľná, ale
    // projekcia ju stlačí do pásu na okraji glóbusu (nález 2026-09-04:
    // východné pobrežie USA na 60,6° pri obzore 63,5° = oblúk krúžkov na
    // limbe). Faktor klesá k nule ešte pred obzorom, rovnako ako limbový
    // taper flotily.
    const cell = point.id;
    if (limb && cell && Number.isFinite(cell.lat) && Number.isFinite(cell.lon)) {
      const factor = limbFactor(
        centralAngleRad(camera.latDeg, camera.lonDeg, cell.lat, cell.lon), horizon,
      );
      if (factor <= 0) show = false;
      if (typeof paint === 'function' && Math.abs((cell.limbFactor ?? -1) - factor) > 0.02) {
        cell.limbFactor = factor;
        paint(point, factor);
      }
    }
    if (point.show !== show) point.show = show;
    if (show) visible += 1;
  }
  return visible;
}

/** Stredný polomer Zeme (m) — na uhlové výpočty pri obzore stačí guľa. */
const EARTH_RADIUS_M = 6_371_000;

/** Podiel obzorového uhla, od ktorého bunka začína slabnúť. */
export const DENSITY_LIMB_FADE_START = 0.72;
/** Podiel obzorového uhla, pri ktorom bunka zhasne — ešte PRED obzorom. */
export const DENSITY_LIMB_FADE_END = 0.92;

/**
 * Uhol (rad) od nadiru po obzor pre kameru v danej výške nad guľou.
 * @param {number} cameraHeightM
 * @returns {number} 0 pri nefinitnej alebo nulovej výške.
 */
export function horizonAngleRad(cameraHeightM) {
  const h = Number(cameraHeightM);
  if (!(h > 0)) return 0;
  return Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + h));
}

/**
 * Stredový uhol (rad) medzi dvoma bodmi na guli (haversine).
 * @returns {number}
 */
export function centralAngleRad(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const toRad = Math.PI / 180;
  const dLat = (lat2Deg - lat1Deg) * toRad;
  const dLon = (lon2Deg - lon1Deg) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1Deg * toRad) * Math.cos(lat2Deg * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))));
}

/**
 * Limbový faktor 0..1: 1 v strede záberu, lineárne k 0 medzi
 * DENSITY_LIMB_FADE_START a DENSITY_LIMB_FADE_END obzorového uhla.
 * @param {number} centralAngle Uhol bunky od nadiru (rad).
 * @param {number} horizonAngle Uhol obzoru (rad); 0 = bez taperu.
 * @returns {number}
 */
export function limbFactor(centralAngle, horizonAngle) {
  if (!(horizonAngle > 0) || !Number.isFinite(centralAngle)) return 1;
  const ratio = centralAngle / horizonAngle;
  if (ratio <= DENSITY_LIMB_FADE_START) return 1;
  if (ratio >= DENSITY_LIMB_FADE_END) return 0;
  return 1 - (ratio - DENSITY_LIMB_FADE_START) / (DENSITY_LIMB_FADE_END - DENSITY_LIMB_FADE_START);
}
