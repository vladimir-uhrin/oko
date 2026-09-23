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
 * O koľko sa stlmí výplň zastaranej snímky — na mape aj vo vzorke legendy.
 * Značka ZASTARANÉ v legende nestačí: mapa 40 dní stará sa kreslila rovnako
 * sýto ako včerajšia a oko číta farbu, nie legendu. Polovica je ešte čitateľná
 * (tvar zón ostáva), ale na prvý pohľad sa líši od čerstvej. Jedna hodnota pre
 * mapu, legendu osi aj legendu KARTY, aby nikdy nesedeli každá inak.
 */
export const STALE_DIM = 0.5;

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

/**
 * Referenčný čas pre vek snímky: koniec PREZERANÉHO dňa, no nikdy budúcnosť.
 *
 * V LIVE je prezeraný deň dnešok, takže vyjde „teraz" a nič sa nemení. Pri
 * prehrávaní histórie je to koniec dňa kurzora — kým sa vek počítal od „teraz",
 * snímka z roku 2022 pri pohľade na rok 2022 svietila „pred 1 000 dňami ·
 * ZASTARANÉ", hoci voči dňu, na ktorý sa človek pozerá, bola čerstvá.
 *
 * `requestedDay` je deň, pre ktorý server snímku vydal (`requestedAt`
 * v odpovedi /api/ukraine/events/control a …/deepstate). Bez neho = „teraz".
 * Pure.
 */
export function viewedRefMs(requestedDay, nowMs) {
  if (!Number.isFinite(nowMs)) return nowMs;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(requestedDay || ''));
  if (!m) return nowMs;
  const dayEnd = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  return Math.min(nowMs, dayEnd);
}

/**
 * Hlásenie GŠ vychádza denne (~05:11 UTC). Dva dni bez neho znamenajú, že stojí
 * zdroj alebo náš archivár — ArmyInform za 60 dní vynechal štyri dni, nikdy dva
 * po sebe.
 */
export const REPORT_STALE_DAYS = 2;

/**
 * Udalosti okna (správy, médiá, GeoConfirmed, VIINA) pribúdajú každú štvrťhodinu;
 * dva dni bez jedinej novej znamenajú, že stoja zdroje, nie že je ticho na fronte.
 */
export const EVENTS_STALE_DAYS = 2;

/**
 * Riadok „čerstvosť zdrojov" (A4, 2026-09-23): jeden záznam na zdroj, ktorý mapa
 * práve kreslí. Dátumy boli rozhádzané na štyroch miestach (legenda kontroly,
 * legenda DeepState, počítadlo GŠ, nikde pri udalostiach) a nikto ich neporovnal.
 *
 * Každý zdroj má vlastný prah, lebo každý žije iným tempom — Wikipédia 14 dní,
 * DeepState 4, hlásenie aj udalosti 2. Vek sa ráta voči `refMs` z viewedRefMs,
 * teda voči PREZERANÉMU dňu, rovnako ako značka veku a stlmenie mapy.
 * Zdroj bez dátumu (vypnutá vrstva, prázdne okno) sa vynechá — nič sa nedomýšľa.
 * Pure.
 *
 * @param {object} o
 * @param {string|null} [o.controlAt] revízia Wikipédie, ak je kontrola zapnutá
 * @param {string|number|null} [o.deepstateAt] snímka DeepState, ak je dostupný a zapnutý
 * @param {string|null} [o.reportAt] `reportedAt` hlásenia pre prezeraný deň
 * @param {number|null} [o.newestEventMs] najnovšia udalosť okna (≤ refMs)
 * @param {number} o.refMs
 * @returns {Array<{id: 'control'|'deepstate'|'report'|'events', at: string|number, ageDays: number, stale: boolean}>}
 */
export function freshnessRow({ controlAt = null, deepstateAt = null, reportAt = null, newestEventMs = null, refMs } = {}) {
  const out = [];
  const add = (id, at, staleDays) => {
    if (at == null || at === '') return;
    const f = freshnessOf(at, refMs, staleDays);
    if (f.ageDays === null) return;
    out.push({ id, at, ...f });
  };
  add('control', controlAt, CONTROL_STALE_DAYS);
  add('deepstate', deepstateAt, DEEPSTATE_STALE_DAYS);
  add('report', reportAt, REPORT_STALE_DAYS);
  add('events', Number.isFinite(newestEventMs) ? newestEventMs : null, EVENTS_STALE_DAYS);
  return out;
}
