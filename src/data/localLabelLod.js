// src/data/localLabelLod.js
/**
 * @module localLabelLod
 * @description Koľko textu dostane bodová infraštruktúrna vrstva podľa
 * priblíženia (2026-09-05, používateľ nad strednou Európou zo 700 km: „no to
 * je dosť neprehľadné").
 *
 * Namerané: karty letísk sa kreslili rovnako plné (názov + kódy + typ + výška)
 * pre KAŽDÉ letisko až do vzdialenosti 14 000 km. Riedila ich len kolízna
 * mriežka 140 px, takže pri pohľade na kontinent zostalo ~25 trojriadkových
 * kariet cez pol obrazovky a mapa pod nimi zmizla.
 *
 * Riešenie je rovnaké ako pri lietadlách (`airIconLod.js`): stupne podľa VÝŠKY
 * KAMERY s hysterézou. Dve osi naraz:
 *   • KTORÉ objekty dostanú text — cez ich vlastnú dôležitosť (letiská aj
 *     prístavy zhodne 300 veľké / 150 stredné / 60 malé),
 *   • KOĽKO textu — od bodu bez popisu cez kód a jednoriadkovú kartu po plnú.
 *
 * PREČO VÝŠKA KAMERY a nie počet kariet na obrazovke: prah podľa počtu je
 * dátovo závislý (nad Alpami inak než nad Baltom) a jediné pribudnuté letisko
 * by preklopilo celú scénu. Výška je stabilná a používateľ ju sám ovláda.
 *
 * PREČO HYSTERÉZA: bez nej kamera postávajúca na hranici prepína text tam a
 * späť pri každom drobnom pohybe — presne to, kvôli čomu má stupne aj
 * `airIconLod`.
 */

/** Stupne od najbližšieho po najvzdialenejší. */
export const LOCAL_LABEL_TIERS = Object.freeze(['full', 'compact', 'code', 'hidden']);

/**
 * Prahy výšky kamery (m). `enter` platí pri STÚPANÍ (kedy sa stupeň zapne),
 * `exit` pri KLESANÍ (kedy ustúpi). Medzi nimi platí predchádzajúca odpoveď.
 */
export const LOCAL_LABEL_THRESHOLDS = Object.freeze({
  hidden: Object.freeze({ enter: 1_500_000, exit: 1_300_000 }),
  code: Object.freeze({ enter: 300_000, exit: 260_000 }),
  compact: Object.freeze({ enter: 90_000, exit: 75_000 }),
});

/**
 * Minimálna dôležitosť objektu, aby v danom stupni vôbec dostal text.
 * Škála je zhodná pre letiská aj prístavy: 300 veľké, 150 stredné, 60 malé.
 */
export const LOCAL_LABEL_MIN_IMPORTANCE = Object.freeze({
  full: 0,
  compact: 150,
  code: 300,
  hidden: Number.POSITIVE_INFINITY,
});

/**
 * Stupeň popisu pre danú výšku kamery. Hysterézny — volajúci vracia
 * predchádzajúcu odpoveď. Nefinitná výška (ešte niet viewera) číta ako 'full':
 * radšej pár plných kariet než scéna bez identity.
 * @param {number} cameraHeightM Výška kamery nad elipsoidom (m).
 * @param {string} [previousTier='full']
 * @returns {'full'|'compact'|'code'|'hidden'}
 */
export function localLabelTier(cameraHeightM, previousTier = 'full') {
  if (!Number.isFinite(cameraHeightM)) return 'full';
  const previous = LOCAL_LABEL_TIERS.includes(previousTier) ? previousTier : 'full';
  const from = (tier) => LOCAL_LABEL_TIERS.indexOf(previous) >= LOCAL_LABEL_TIERS.indexOf(tier);

  const hiddenLimit = previous === 'hidden'
    ? LOCAL_LABEL_THRESHOLDS.hidden.exit
    : LOCAL_LABEL_THRESHOLDS.hidden.enter;
  if (cameraHeightM >= hiddenLimit) return 'hidden';

  // Zostup zhora pokračuje cez susedný stupeň — preskočiť rovno na 'full' by
  // vrátilo ten istý skok, kvôli ktorému stupne vznikli.
  const codeLimit = from('code')
    ? LOCAL_LABEL_THRESHOLDS.code.exit
    : LOCAL_LABEL_THRESHOLDS.code.enter;
  if (cameraHeightM >= codeLimit) return 'code';

  const compactLimit = from('compact')
    ? LOCAL_LABEL_THRESHOLDS.compact.exit
    : LOCAL_LABEL_THRESHOLDS.compact.enter;
  if (cameraHeightM >= compactLimit) return 'compact';

  return 'full';
}

/**
 * Dostane objekt s touto dôležitosťou v tomto stupni text? Pure.
 * @param {string} tier
 * @param {number} importance
 * @returns {boolean}
 */
export function labelVisibleInTier(tier, importance) {
  const min = LOCAL_LABEL_MIN_IMPORTANCE[tier];
  if (min === undefined) return true;
  return Number(importance) >= min;
}

// ── Geometria: samotný bod a jeho stopka ──────────────────────────────────
// Skrátiť text nestačilo (nález 2026-09-05 pri pohľade na svet): 6 889 bodov
// s 10 px krúžkom a 3,5 px stopkou zaplnilo celý glóbus spleťou krúžkov a
// čiar aj bez jediného popisu. Bod je LACNEJŠÍ než karta, takže sa filtruje
// miernejšie — ale filtruje sa.

/** Minimálna dôležitosť, aby sa v danom stupni kreslil samotný bod. */
export const LOCAL_POINT_MIN_IMPORTANCE = Object.freeze({
  full: 0,
  compact: 0,
  code: 150,
  hidden: 300,
});

/** Veľkosť bodu a hrúbka obrysu podľa stupňa (px). */
export const LOCAL_POINT_STYLE = Object.freeze({
  full: Object.freeze({ pixelSize: 10, outlineWidth: 2 }),
  compact: Object.freeze({ pixelSize: 8, outlineWidth: 2 }),
  code: Object.freeze({ pixelSize: 6, outlineWidth: 1 }),
  hidden: Object.freeze({ pixelSize: 4, outlineWidth: 0 }),
});

/**
 * Kreslí sa v tomto stupni bod objektu s touto dôležitosťou? Pure.
 * @param {string} tier
 * @param {number} importance
 * @returns {boolean}
 */
export function pointVisibleInTier(tier, importance) {
  const min = LOCAL_POINT_MIN_IMPORTANCE[tier];
  if (min === undefined) return true;
  return Number(importance) >= min;
}

/** Štýl bodu pre stupeň (neznámy stupeň = plný). Pure. */
export function pointStyleForTier(tier) {
  return LOCAL_POINT_STYLE[tier] || LOCAL_POINT_STYLE.full;
}

/**
 * Kreslí sa stopka? Stopka existuje preto, aby sa značka nezabárala do
 * terénu zblízka — vo výške je to len čiara cez pol glóbusu. Pure.
 * @param {string} tier
 * @returns {boolean}
 */
export function stemVisibleInTier(tier) {
  return tier === 'full';
}
