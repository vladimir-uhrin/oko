// src/data/ukraineFreshness.js
/**
 * @module ukraineFreshness
 * @description Vek zdrojov modulu UKRAJINA a jeho priznanie v UI.
 *
 * Dôvod (2026-09-21): legenda kontroly uvádzala dátum revízie Wikipédie, ale
 * 39 dní stará línia frontu vyzerala na mape presne tak dôveryhodne ako včerajšia
 * — dátum bez veku nikto neprepočítava. Wikipédia svoj `Module:Russo-Ukrainian war
 * detailed map` medzi 13. 8. a 21. 9. 2026 neupravila ani raz (prehľadový modul
 * dokonca od 3. 5.), takže mapa ticho starla. Pravidlo projektu je, že stav dát
 * musí byť vidieť; tento modul z toho robí merateľnú vec.
 *
 * Prah je vlastnosťou ZDROJA, nie univerzálna konštanta — preto ho volajúci
 * odovzdáva a nie je tu jedno číslo pre všetko. Tvar `{ ageDays, stale }` je
 * zámerne ten istý, aký už používajú `gasPrices.js` a `gasFlows.js`.
 *
 * Čistý modul: žiadny DOM, žiadne Cesium, čas vždy zvonka.
 */

const DAY_MS = 86_400_000;

/**
 * Po tomto veku revízie je línia frontu z Wikipédie vecne neistá. Dva týždne,
 * lebo je to dobrovoľnícka mapa aktualizovaná nepravidelne — kratší prah by
 * svietil aj pri bežnej pauze, dlhší by prepásol presne ten prípad, ktorý toto
 * spôsobil (päť týždňov bez editu).
 */
export const CONTROL_STALE_DAYS = 14;

/**
 * DeepState zobrazujeme so zámerným oneskorením 2–3 dni (vlastné rozhodnutie,
 * nie vlastnosť zdroja). Štvrtý deň už teda znamená, že stojí buď zdroj, alebo
 * náš denný archivár.
 */
export const DEEPSTATE_STALE_DAYS = 4;

/**
 * Vek v celých dňoch nadol, alebo `null`, keď dátum chýba či je nečitateľný.
 * Budúci dátum dá 0, nie záporné číslo — „o dva dni čerstvé" nie je stav, ktorý
 * by sa dal zobraziť, a zdroje s posunutým pásmom by inak hlásili −1. Pure.
 */
export function ageDays(isoAt, nowMs) {
  if (isoAt == null || isoAt === '' || !Number.isFinite(nowMs)) return null;
  // Snímky nosia `at` raz ako ISO reťazec (kontrola, DeepState z API), inde ako
  // epochu v ms — obe sú legitímne a `Date.parse(1790019350270)` by dalo NaN.
  const at = typeof isoAt === 'number' ? isoAt : Date.parse(isoAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((nowMs - at) / DAY_MS));
}

/**
 * `{ ageDays, stale }` pre jeden zdroj. `stale` je `true` až NAD prahom, aby sa
 * prah dal čítať ako „toľko dní je ešte v poriadku". Neznámy dátum nie je
 * zastaraný — je neznámy, a to hlási volajúci inou hláškou. Pure.
 */
export function freshnessOf(isoAt, nowMs, staleDays) {
  const days = ageDays(isoAt, nowMs);
  if (days === null) return { ageDays: null, stale: false };
  return { ageDays: days, stale: Number.isFinite(staleDays) && days > staleDays };
}

/**
 * i18n kľúč pre počet dní. Slovenčina má pri „pred …" dva tvary (1 dňom,
 * 2+ dňami) a nula sa nepočíta vôbec („dnes"), takže bežné `{n} days` by
 * vyrobilo „pred 1 dňami". Pure.
 */
export function ageTextKey(days) {
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return 'ukraine.age.today';
  return days === 1 ? 'ukraine.age.one' : 'ukraine.age.many';
}

/**
 * Hotový text veku („dnes" / „pred 39 dňami"), alebo `''` keď dátum chýba.
 * `translate` sa volá s kľúčom a `{ n }`. Pure.
 */
export function ageText(days, translate) {
  const key = ageTextKey(days);
  if (!key) return '';
  return translate(key, { n: days });
}
