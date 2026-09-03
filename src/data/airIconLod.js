// src/data/airIconLod.js
/**
 * @module airIconLod
 * @description Kedy sa vzdušné kontakty kreslia ako BODKA namiesto siluety.
 *
 * Namerané 2026-09-03 pri pohľade na Európu z 2 600 km: 2 437 kontaktov na
 * obrazovke, každý ako 22 px silueta → ikony zaberajú 158 % plochy obrazovky,
 * prekrývajú sa navzájom aj mapu pod sebou. Vzniká kŕdeľ, v ktorom sa nedá
 * nič prečítať. FlightRadar24 pri rovnakom priblížení kreslí ~5 px body (8 %
 * plochy), a práve preto tam vidno VZOR prevádzky — koridory, hustotu,
 * prázdno nad oceánmi. Máme tie isté dáta, len ich prekresľujeme.
 *
 * PREČO VÝŠKA KAMERY a nie veľkosť ikony na obrazovke: `scaleByDistance` je
 * takmer plochá krivka (NearFarScalar(1000, 3.0, 8e6, 0.5)) — ikona má ~29 px
 * na 400 km a ~22 px na 2 600 km. Veľkosť teda nediskriminuje; problém nie je,
 * že sú ikony malé, ale že sú veľké a je ich 2 437.
 *
 * PREČO NIE vzdialenosť kontaktu (ako `STROBE_MAX_DIST_M`): pri pohľade zhora
 * by vznikol kruh siluet okolo nadiru a bodky za ním — a ten kruh by pri
 * posune kamery plával po scéne. Pri strobe je taká hranica neviditeľná, pri
 * TVARE ikony by vyzerala ako chyba.
 *
 * PREČO NIE počet kontaktov na obrazovke: bol by dátovo závislý (nad
 * Atlantikom siluety, nad Európou bodky pri tom istom priblížení) a jediný
 * prilietavajúci stroj by preklopil celú flotilu.
 *
 * Výška kamery je to, čo robí aj FR24 (zoom level), je globálna (jedno
 * vyhodnotenie za tik, nula per-kontakt pamäte) a projekt ju už takto používa
 * (`MODEL_ALT_CEIL_M`, `trackedModelZoomActive`).
 */

/** Strop 3D modelov flotily (`MODEL_ALT_CEIL_M` v oboch leteckých vrstvách),
 *  duplikovaný sem LEN preto, aby sa vzťah nižšie dal odtestovať. Vlastná
 *  konštanta vrstiev sa nemení a ostáva jediným zdrojom pre ich správanie. */
export const FLEET_MODEL_ALT_CEIL_M = 800_000;

/**
 * Výška kamery (m), nad ktorou sa flotila kreslí ako bodky.
 *
 * Nad ~950 km je v zábere celý kontinent — vtedy už silueta nenesie žiadnu
 * informáciu navyše (typ stroja sa pri 22 px aj tak nedá rozoznať), zaberá
 * len miesto a prekrýva susedov.
 */
export const AIR_DOT_ENTER_ALT_M = 950_000;

/**
 * Výška, pod ktorú musí kamera klesnúť, aby sa bodky vrátili na siluety.
 *
 * ZÁMERNE presne `FLEET_MODEL_ALT_CEIL_M`: 3D modely žijú len POD 800 km,
 * bodky len NAD 800 km, takže nikdy nemôže nastať stav „model vlastní vizuál,
 * ale jeho záložný billboard je bodka". Vzniká jednoznačný rebrík
 * model → silueta → bodka, ktorý sa dá overiť jedným assertom.
 */
export const AIR_DOT_EXIT_ALT_M = FLEET_MODEL_ALT_CEIL_M;

/**
 * Kreslí sa flotila pri tejto výške kamery ako bodky?
 *
 * Hysterézne: volajúci vracia predchádzajúcu odpoveď a tá vyberá, ktorý prah
 * platí. Vnútri pásma [exit, enter) je odpoveď „to, čo už bolo", takže kamera
 * postávajúca na hranici neprepína tam a späť (rovnaký idióm ako
 * `trackedModelZoomActive`).
 *
 * Nefinitná výška (ešte niet viewera, kamera nie je umiestnená) číta ako
 * „nevieme" → siluety, čo je bezpečnejší default: radšej pár veľkých ikon než
 * scéna plná bodiek bez identity.
 *
 * @param {number} cameraHeightM Výška kamery nad elipsoidom v metroch.
 * @param {boolean} [wasActive=false] Odpoveď z predchádzajúceho vyhodnotenia.
 * @returns {boolean} True, keď má flotila kresliť bodky.
 */
export function airDotLodActive(cameraHeightM, wasActive = false) {
  if (!Number.isFinite(cameraHeightM)) return false;
  return cameraHeightM >= (wasActive ? AIR_DOT_EXIT_ALT_M : AIR_DOT_ENTER_ALT_M);
}
