// src/data/airIconLod.js
/**
 * @module airIconLod
 * @description Ako veľká je ikona vzdušného kontaktu podľa priblíženia.
 *
 * Namerané 2026-09-03 pri pohľade na Európu z 2 600 km: 2 437 kontaktov na
 * obrazovke, každý ako 22 px silueta → ikony zaberali 158 % plochy obrazovky
 * a prekrývali sa navzájom aj mapu. FlightRadar24 pri rovnakom priblížení
 * kreslí drobné značky (~8 % plochy), a práve preto tam vidno VZOR prevádzky.
 *
 * Od 2026-09-04 sú stupne TRI, nie dva — jeden skok z 20 px na 9 px bol na
 * hranici priveľmi cítiť. Stredný stupeň ten prechod rozloží.
 *
 * PREČO VÝŠKA KAMERY a nie veľkosť ikony na obrazovke: `scaleByDistance` je
 * takmer plochá krivka (NearFarScalar(1000, 3.0, 8e6, 0.5)) — ikona má ~29 px
 * na 400 km a ~22 px na 2 600 km. Veľkosť teda nediskriminuje; problém nie je,
 * že sú ikony malé, ale že sú veľké a je ich 2 437.
 *
 * PREČO NIE vzdialenosť kontaktu (ako `STROBE_MAX_DIST_M`): pri pohľade zhora
 * by vznikol kruh veľkých ikon okolo nadiru a malé za ním — a ten kruh by pri
 * posune kamery plával po scéne. Pri strobe je taká hranica neviditeľná, pri
 * VEĽKOSTI ikony by vyzerala ako chyba.
 *
 * PREČO NIE počet kontaktov na obrazovke: bol by dátovo závislý (nad
 * Atlantikom veľké, nad Európou malé pri tom istom priblížení) a jediný
 * prilietavajúci stroj by preklopil celú flotilu.
 */

/** Strop 3D modelov flotily (`MODEL_ALT_CEIL_M` v oboch leteckých vrstvách),
 *  duplikovaný sem LEN preto, aby sa vzťah nižšie dal odtestovať. */
export const FLEET_MODEL_ALT_CEIL_M = 800_000;

/** Stupne od najbližšieho po najvzdialenejší. */
export const AIR_ICON_TIERS = Object.freeze(['full', 'medium', 'micro']);

/**
 * Prahy výšky kamery (m). Každý stupeň má vlastné pásmo hysterézy: `enter` je
 * hranica pri stúpaní, `exit` pri klesaní. Vnútri pásma platí predchádzajúca
 * odpoveď, takže kamera postávajúca na hranici neprepína veľkosť tam a späť.
 *
 * `micro.exit` je ZÁMERNE presne `FLEET_MODEL_ALT_CEIL_M`: 3D modely žijú len
 * POD 800 km, najmenšie ikony len NAD ním, takže nikdy nenastane stav „model
 * vlastní vizuál, ale jeho záložný billboard je bod bez identity".
 */
export const AIR_ICON_THRESHOLDS = Object.freeze({
  micro: Object.freeze({ enter: 950_000, exit: FLEET_MODEL_ALT_CEIL_M }),
  medium: Object.freeze({ enter: 300_000, exit: 250_000 }),
});

/**
 * Stupeň ikony pre danú výšku kamery.
 *
 * Hysterézne: volajúci vracia predchádzajúci stupeň a ten vyberá, ktorý prah
 * platí. Nefinitná výška (ešte niet viewera) číta ako 'full' — bezpečnejší
 * default: pár veľkých ikon je lepších než scéna plná drobcov bez identity.
 *
 * @param {number} cameraHeightM Výška kamery nad elipsoidom v metroch.
 * @param {string} [previousTier='full'] Stupeň z predchádzajúceho vyhodnotenia.
 * @returns {'full'|'medium'|'micro'}
 */
export function airIconTier(cameraHeightM, previousTier = 'full') {
  if (!Number.isFinite(cameraHeightM)) return 'full';
  const previous = AIR_ICON_TIERS.includes(previousTier) ? previousTier : 'full';

  const microLimit = previous === 'micro'
    ? AIR_ICON_THRESHOLDS.micro.exit
    : AIR_ICON_THRESHOLDS.micro.enter;
  if (cameraHeightM >= microLimit) return 'micro';

  // Zostup z 'micro' pokračuje cez 'medium' — preskočiť rovno na 'full' by
  // vrátilo ten istý skok, kvôli ktorému stredný stupeň vznikol.
  const mediumLimit = previous === 'full'
    ? AIR_ICON_THRESHOLDS.medium.enter
    : AIR_ICON_THRESHOLDS.medium.exit;
  if (cameraHeightM >= mediumLimit) return 'medium';

  return 'full';
}

/**
 * Kreslí sa flotila pri tejto výške ako zmenšená ikona?
 *
 * Ponechané pre volajúcich, ktorých zaujíma len „menšia než bežná" —
 * `airIconTier` je autoritatívny.
 * @param {number} cameraHeightM
 * @param {boolean} [wasActive=false]
 * @returns {boolean}
 */
export function airDotLodActive(cameraHeightM, wasActive = false) {
  return airIconTier(cameraHeightM, wasActive ? 'micro' : 'full') === 'micro';
}

/** Prah, nad ktorým sa kreslí najmenšia ikona (spätná kompatibilita). */
export const AIR_DOT_ENTER_ALT_M = AIR_ICON_THRESHOLDS.micro.enter;
/** Prah, pod ktorý musí kamera klesnúť, aby najmenšia ikona ustúpila. */
export const AIR_DOT_EXIT_ALT_M = AIR_ICON_THRESHOLDS.micro.exit;
