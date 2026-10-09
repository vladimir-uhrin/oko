// scripts/lib/meteoBakeFreshness.mjs
// Či treba rez GFS upiecť znova (2026-10-09). Predtým sa každý uložený rez preskočil („276 preskočených") a
// predpoveď sa novým behom modelu NIKDY neobnovila — krok na 10. 10. bol z behu zo 6. 10., na 11. 10. z 8. 10.
// Teraz: rez sa prepečie, keď je k dispozícii novší beh. Základné polia hneď, výškové hladiny vetra (6 polí ×
// 25 krokov) až keď zaostávajú o viac než `levelLagH` hodín — šetrnosť k demo serveru THREDDS.

export const LEVEL_LAG_H = 12;

/**
 * @param {{run?: string|null}|null} meta uložený .json rezu (null = rez nie je)
 * @param {string|null} newestRunIso najnovší beh zistený v tomto pečení (null = nevieme → nič nenútiť)
 * @param {{isLevel?: boolean, levelLagH?: number}} [opts]
 * @returns {boolean} true = upiecť znova
 */
export function needsRebake(meta, newestRunIso, { isLevel = false, levelLagH = LEVEL_LAG_H } = {}) {
  if (!meta) return true;
  const newest = Date.parse(newestRunIso || '');
  if (!Number.isFinite(newest)) return false; // bez známeho najnovšieho behu nechaj cache tak, ako bola
  const run = Date.parse(meta.run || '');
  if (!Number.isFinite(run)) return true; // rez bez behu — nevieme, aký je starý
  const lagH = (newest - run) / 3_600_000;
  return isLevel ? lagH > levelLagH : lagH > 0;
}

/** Koľko hodín dozadu sa uložené kroky nechávajú (os aj meteogram ukazujú len od „teraz“ dopredu). */
export const KEEP_PAST_H = 48;

/**
 * Súbory rezov na zmazanie (2026-10-09: cache od 8. 9. narástla na 2,4 GB, ~80 MB denne, nič sa nemazalo):
 * `2026-10-07T150000Z.png` / `.json` s časom kroku starším než keepH hodín. Iné súbory nechá. Pure.
 * @param {string[]} names mená súborov v priečinku poľa
 */
export function slicesToPrune(names, nowMs, keepH = KEEP_PAST_H) {
  const limit = nowMs - keepH * 3_600_000;
  return (names || []).filter((name) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z\.(png|json)$/.exec(name);
    if (!m) return false;
    const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
    return Number.isFinite(t) && t < limit;
  });
}
