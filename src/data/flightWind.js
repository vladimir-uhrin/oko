// src/data/flightWind.js
/**
 * @module flightWind
 * @description Vietor v letovej hladine pre kartu lietadla — spojenie meteo
 * vrstvy s leteckou. Čisté výpočty bez DOM a Cesia, aby sa dali testovať:
 * výber najbližšej tlakovej hladiny k výške letu, zložka vetra v smere letu
 * (protivietor/zadný vietor) a bočná zložka.
 *
 * POCTIVOSŤ: je to MODEL (predpoveď GFS), nie meranie z lietadla. Karta to
 * musí povedať a bez načítanej meteo vrstvy nesmie nič vymýšľať.
 */

import { WIND_LEVELS } from './meteoField.js';

/**
 * Výška štandardnej atmosféry pre tlakové hladiny, ktoré OKO kreslí (m MSL).
 * Zaokrúhlené z ISA; slúžia len na VÝBER najbližšej hladiny, nie na výpočet.
 */
export const LEVEL_ALTITUDE_M = Object.freeze({
  wind: 10,
  wind850: 1457,
  wind700: 3012,
  wind500: 5574,
  wind250: 10363,
});

/** Hladina najbližšia k výške letu. Pure. */
export function levelForAltitude(altitudeM) {
  const h = Number(altitudeM);
  if (!Number.isFinite(h)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const level of WIND_LEVELS) {
    const alt = LEVEL_ALTITUDE_M[level.id];
    if (!Number.isFinite(alt)) continue;
    const d = Math.abs(alt - h);
    if (d < bestDiff) { bestDiff = d; best = level; }
  }
  return best;
}

/**
 * Rozklad vetra voči smeru letu. Pure.
 *
 * `u` je zložka na východ, `v` na sever (konvencia GFS). `trackDeg` je kurz nad
 * zemou v stupňoch od severu v smere hodinových ručičiek.
 *
 * @returns {{speedMps: number, fromDeg: number, headMps: number, crossMps: number}}
 *   `headMps` > 0 = ZADNÝ vietor (tlačí), < 0 = protivietor.
 *   `crossMps` > 0 = vietor PRICHÁDZA sprava (ako to číta pilot), < 0 zľava.
 *
 * POZOR NA ZNAMIENKO: `u * ay - v * ax` je zložka vetra smerom DOPRAVA od
 * lietadla, čo je OPAK toho, odkiaľ vietor prichádza. Overené na živom lete
 * (UAE69, kurz 282°, vietor z 348°): zdroj je 66° napravo od nosa, teda
 * „sprava", hoci tá zložka vychádza záporná. Preto je vzorec otočený.
 */
export function windRelativeToTrack(u, v, trackDeg) {
  const speedMps = Math.hypot(u, v);
  // Meteorologická konvencia: smer, ODKIAĽ vietor fúka.
  const fromDeg = (Math.atan2(-u, -v) * 180) / Math.PI;
  const from = (fromDeg + 360) % 360;
  if (!Number.isFinite(trackDeg)) return { speedMps, fromDeg: from, headMps: NaN, crossMps: NaN };
  const rad = (Number(trackDeg) * Math.PI) / 180;
  // Jednotkový vektor letu: na východ sin(kurz), na sever cos(kurz).
  const ax = Math.sin(rad);
  const ay = Math.cos(rad);
  return {
    speedMps,
    fromDeg: from,
    headMps: u * ax + v * ay,      // priemet vetra do smeru letu
    crossMps: v * ax - u * ay,     // > 0 = prichádza sprava (viď poznámku vyššie)
  };
}

/** Letová hladina (FL) z výšky v metroch, zaokrúhlená na desiatky. Pure. */
export function flightLevelOf(altitudeM) {
  const ft = Number(altitudeM) / 0.3048;
  if (!Number.isFinite(ft)) return null;
  return Math.round(ft / 1000) * 10;
}
