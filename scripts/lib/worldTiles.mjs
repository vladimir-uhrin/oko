// scripts/lib/worldTiles.mjs
//
// Celosvetové dlaždice snímkov čiar (2026-11-07, vlastník: „…všetko na vrchol
// vylepšenia" → „pokračuj"). Pôvodné okno plynovodov, ropovodov aj elektrickej
// siete bolo 0–75° s. š. × −12…180° v. d.: chýbala celá Amerika, Island, Kanárske
// ostrovy, západ Senegalu, Afrika južne od rovníka, Jáva, Austrália aj Nový
// Zéland. Tieto dlaždice okno dopĺňajú na celý svet (−56…75°, −172…180°).
//
// PRAVIDLÁ:
//  - pripájajú sa NA KONIEC zoznamu dlaždíc buildu — prípona '#N' pri ceste cez
//    hranicu dlaždíc sa prideľuje v poradí dlaždíc, predradenie by zmenilo id
//    existujúcich úsekov;
//  - nové dlaždice sa so starým oknom ani navzájom neprekrývajú, len zdieľajú
//    okraj (clipToBbox má inkluzívne hranice);
//  - husté Spojené štáty a juh Kanady sú jemnejšie: celé pásmo 34–50° × −108…−76°
//    má 27 454 vedení ≥ 220 kV (sonda `out count`, 2026-11-07), plyn 24–34° ×
//    −108…−76° 7 617 ciest.
//
// Modul je čistý — testuje sa v Node (scripts/lib/worldTiles.test.mjs).

/** Mriežka dlaždíc [S, W, N, E] po `dLat` × `dLon`. */
export function grid(S, N, W, E, dLat, dLon) {
  const out = [];
  for (let s = S; s < N; s += dLat) {
    for (let w = W; w < E; w += dLon) out.push([s, w, Math.min(N, s + dLat), Math.min(E, w + dLon)]);
  }
  return out;
}

/** Sever Ameriky pre elektrinu (Aljaška, Kanada, Grónsko, Island) — široké pásy. */
const NORTH_FINE = Object.freeze([[56, -172, 75, -128], [56, -128, 75, -64], [56, -64, 75, -12]]);
/**
 * Sever Ameriky pre plyn a ropu: Alberta (ropné piesky, zberné siete importované z AER)
 * je najhustejšie zmapovaný kus potrubí na svete — 2026-11-07 dlaždica 40–56° × −128…−96°
 * padla trikrát na 504 Gateway Timeout. Okolie Alberty preto po 8° × 16°.
 */
const NORTH_COARSE = Object.freeze([[56, -172, 75, -128], ...grid(56, 64, -128, -96, 8, 16), [64, -128, 75, -96], [56, -96, 75, -64], [56, -64, 75, -12]]);

/** Okraj Ameriky mimo hustého jadra a severu: široké pásy. */
const AMERICAS_EDGE = Object.freeze([
  // Tichý oceán a Atlantik vedľa jadra (Azory, Kanárske ostrovy, Madeira, Newfoundland)
  [24, -172, 56, -128], [24, -64, 56, -12],
  // Havaj, Mexiko, Stredná Amerika, Karibik, západ Senegalu a Guiney, Kapverdy
  [0, -172, 24, -128], [0, -128, 24, -96], [0, -96, 24, -64], [0, -64, 24, -12],
  // Južná Amerika
  [-56, -84, 0, -64], [-56, -64, 0, -44], [-56, -44, 0, -28],
]);

/** Južná pologuľa vo východnom okne (Afrika, Indický oceán, Indonézia, Austrália, NZ). */
const SOUTH_EAST = Object.freeze([
  [-50, -12, 0, 20], [-50, 20, 0, 52], [-50, 52, 0, 84], [-50, 84, 0, 116], [-50, 116, 0, 148], [-50, 148, 0, 180],
]);

/**
 * Plyn a ropa: juh USA po 16° × 32° (24–40° × −128…−64° prešlo: 2 976 a 7 439 ciest),
 * pás 40–56° (Alberta, Dakoty, Pensylvánia) po 8° × 16°.
 */
export const WORLD_TILES_COARSE = Object.freeze([
  ...grid(24, 40, -128, -64, 16, 32),
  ...grid(40, 56, -128, -64, 8, 16),
  ...NORTH_COARSE,
  ...AMERICAS_EDGE,
  ...SOUTH_EAST,
].map((t) => Object.freeze(t)));

/** Elektrina: jadro USA a Kanady po 8° × 16° (~27 k vedení na 16° × 32° → ~7 k na dlaždicu). */
export const WORLD_TILES_FINE = Object.freeze([
  ...grid(24, 56, -128, -64, 8, 16),
  ...NORTH_FINE,
  ...AMERICAS_EDGE,
  ...SOUTH_EAST,
].map((t) => Object.freeze(t)));

/** Pôvodné okno (0–75° × −12…180°) — nové dlaždice doňho nesmú zasahovať. */
export const ORIGINAL_WINDOW = Object.freeze([0, -12, 75, 180]);
