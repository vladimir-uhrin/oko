// src/data/runwayWind.js
/**
 * @module runwayWind
 * @description Ktorá dráha je pri aktuálnom vetre v prevádzke (2026-09-05,
 * karta letiska). Čisté funkcie nad dráhami zo sidecaru a vetrom z METAR.
 *
 * Lietadlá vzlietajú a pristávajú PROTI vetru, takže „aktívna" je tá strana
 * dráhy, ktorá má najväčšiu čelnú zložku. Počíta sa pre každý koniec zvlášť
 * (04 a 22 sú tá istá dráha, ale opačné smery).
 *
 * POCTIVOSŤ (pravidlo 2): je to ODHAD z vetra, nie hlásenie riadenia. Skutočnú
 * dráhu určuje ATC a mení ju hluk, obsadenosť, prístrojové priblíženie či
 * preferencia letiska. Karta to hovorí slovom „odhad z vetra".
 *
 * Smery: METAR `wdir` aj OurAirports `*_heading_degT` sú v stupňoch PRAVÝCH
 * (true), takže sa porovnávajú priamo. Keď dráha hlavičku nemá (v CSV chýba
 * ~10 % koncov), odvodí sa z označenia: 04 → 040°, 22 → 220°, 09L → 090°.
 */

/** Bočný vietor nad týmto limitom karta zvýrazní ako silný (kt). */
export const STRONG_CROSSWIND_KT = 15;
/** Pod týmto vetrom je smer bezvýznamný — dráhu neurčujeme (kt). */
export const CALM_WIND_KT = 3;

function finite(value) {
  // POZOR: `Number(null)` je 0 a prejde cez Number.isFinite — bez tejto gardy
  // sa chýbajúca hlavička dráhy tvárila ako smer 000° a chýbajúci vietor ako
  // bezvetrie z pravého boku (nájdené testom 2026-09-05).
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Uhol do <0, 360). Pure. */
export function normalizeDeg(deg) {
  const n = finite(deg);
  if (n === null) return null;
  return ((n % 360) + 360) % 360;
}

/**
 * Hlavička konca dráhy z označenia: '04' → 40, '22L' → 220, '36' → 360→0. Pure.
 * @param {string} ident
 * @returns {number|null}
 */
export function headingFromIdent(ident) {
  const m = /^(\d{1,2})/.exec(String(ident ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 36) return null;
  return normalizeDeg(n * 10);
}

/**
 * Konce jednej dráhy so smermi. Sidecar tuple:
 * `[le, he, lengthFt, widthFt, surface, lighted, closed, leHdgT, heHdgT]`.
 * Pure.
 * @param {Array} rwy
 * @returns {Array<{ident: string, headingDeg: number, lengthFt: number|null}>}
 */
export function runwayEnds(rwy) {
  if (!Array.isArray(rwy)) return [];
  const [le, he, lengthFt, , , , , leHdg, heHdg] = rwy;
  const ends = [];
  for (const [ident, heading] of [[le, leHdg], [he, heHdg]]) {
    const text = String(ident ?? '').trim();
    if (!text) continue;
    const headingDeg = normalizeDeg(heading) ?? headingFromIdent(text);
    if (headingDeg === null) continue;
    ends.push({ ident: text, headingDeg, lengthFt: finite(lengthFt) });
  }
  return ends;
}

/**
 * Čelná a bočná zložka vetra pre daný smer dráhy. Pure.
 * Kladný `headKt` = protivietor (žiaduci), záporný = zadný vietor.
 * @param {number} runwayHeadingDeg
 * @param {number} windDirDeg odkiaľ fúka (METAR konvencia)
 * @param {number} windKt
 * @returns {?{headKt: number, crossKt: number, crossSide: 'L'|'R'|''}}
 */
export function windComponents(runwayHeadingDeg, windDirDeg, windKt) {
  const heading = normalizeDeg(runwayHeadingDeg);
  const dir = normalizeDeg(windDirDeg);
  const speed = finite(windKt);
  if (heading === null || dir === null || speed === null || speed < 0) return null;
  const angleDeg = ((dir - heading + 540) % 360) - 180; // −180..180, kladné = sprava
  const rad = angleDeg * Math.PI / 180;
  const headKt = speed * Math.cos(rad);
  const signedCross = speed * Math.sin(rad);
  return {
    headKt: Math.round(headKt * 10) / 10,
    crossKt: Math.round(Math.abs(signedCross) * 10) / 10,
    crossSide: Math.abs(signedCross) < 0.05 ? '' : (signedCross > 0 ? 'R' : 'L'),
  };
}

/**
 * Odhad aktívnej dráhy: koniec s najväčším protivetrom (pri zhode dlhšia
 * dráha). Pure.
 * @param {Array<Array>} runways dráhy zo sidecaru
 * @param {?{dirDeg: number|null, speedKt: number|null, variable?: boolean}} wind
 * @returns {?{ident: string, headingDeg: number, headKt: number, crossKt: number, crossSide: string, tailwind: boolean, strongCross: boolean, calm: boolean, variable: boolean}}
 */
export function activeRunwayFromWind(runways, wind) {
  const list = Array.isArray(runways) ? runways : [];
  const speed = finite(wind?.speedKt);
  const dir = normalizeDeg(wind?.dirDeg);
  const ends = list.flatMap((rwy) => runwayEnds(rwy));
  if (!ends.length) return null;
  // Bezvetrie alebo premenlivý smer: dráhu neurčujeme, ale povieme prečo.
  if (speed === null || dir === null || speed < CALM_WIND_KT) {
    return {
      ident: '', headingDeg: 0, headKt: 0, crossKt: 0, crossSide: '',
      tailwind: false, strongCross: false,
      calm: speed !== null && speed < CALM_WIND_KT,
      variable: dir === null && speed !== null,
    };
  }
  let best = null;
  for (const end of ends) {
    const components = windComponents(end.headingDeg, dir, speed);
    if (!components) continue;
    const candidate = { ...end, ...components };
    if (!best
      || candidate.headKt > best.headKt + 0.05
      || (Math.abs(candidate.headKt - best.headKt) <= 0.05 && (candidate.lengthFt || 0) > (best.lengthFt || 0))) {
      best = candidate;
    }
  }
  if (!best) return null;
  return {
    ident: best.ident,
    headingDeg: best.headingDeg,
    headKt: best.headKt,
    crossKt: best.crossKt,
    crossSide: best.crossSide,
    tailwind: best.headKt < 0,
    strongCross: best.crossKt >= STRONG_CROSSWIND_KT,
    calm: false,
    variable: false,
  };
}

/**
 * Text pre kartu: `RWY 22 · protivietor 12 kt · bočný 5 kt Ľ`. Pure.
 * @param {?object} active výstup activeRunwayFromWind
 * @param {(key: string, vars?: object) => string} translate
 * @returns {string}
 */
export function activeRunwayLabel(active, translate) {
  if (!active) return '';
  const t = typeof translate === 'function' ? translate : (k) => k;
  if (active.calm) return t('airport.runway-calm');
  if (active.variable) return t('airport.runway-variable');
  if (!active.ident) return '';
  const parts = [`RWY ${active.ident}`];
  const head = Math.round(Math.abs(active.headKt));
  parts.push(active.tailwind
    ? t('airport.tailwind', { kt: head })
    : t('airport.headwind', { kt: head }));
  if (active.crossKt >= 1) {
    const side = active.crossSide === 'L' ? t('airport.side-left') : t('airport.side-right');
    parts.push(t('airport.crosswind', { kt: Math.round(active.crossKt), side }));
  }
  return parts.join(' · ');
}
