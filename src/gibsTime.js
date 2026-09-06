/**
 * Deň snímky pre denné mozaiky NASA GIBS: VČERA v UTC.
 *
 * Denná mozaika sa spracúva s odstupom, takže „dnes" je ešte deravé a diery
 * by vyzerali ako chyba mapy. Zdieľa ho podklad `gibs-truecolor`
 * (mapStackController.js) aj prekryvné vrstvy (data/gibsOverlays.js) —
 * jeden zdroj pravdy o dni, nech dve vrstvy neukazujú dva rôzne dni. Pure.
 */

/**
 * @param {number} [nowMs]
 * @returns {string} deň vo formáte YYYY-MM-DD
 */
export function gibsImageryDay(nowMs = Date.now()) {
  return gibsImageryDayOffset(1, nowMs);
}

/**
 * Deň `daysBack` dní pred dneškom (UTC). 1 = včera. Prekryvné vrstvy ním
 * ustupujú, keď včerajšia mozaika ešte nie je (HTTP 400 mimo rozsahu vrstvy).
 * @param {number} daysBack
 * @param {number} [nowMs]
 * @returns {string}
 */
export function gibsImageryDayOffset(daysBack, nowMs = Date.now()) {
  const back = Number.isFinite(daysBack) ? Math.max(0, Math.floor(daysBack)) : 1;
  return new Date(nowMs - back * 86_400_000).toISOString().slice(0, 10);
}
