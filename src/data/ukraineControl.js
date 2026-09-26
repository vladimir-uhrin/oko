// src/data/ukraineControl.js
/**
 * @module ukraineControl
 * @description Územná kontrola modulu UKRAJINA — PROVIZÓRIUM (etapa 4C, 2026-09-19;
 * plán docs/drafts/ukrajina-plan.md kap. 2.1): body kontroly sídiel z Wikipédie,
 * `Module:Russo-Ukrainian war overview map` (mestá) + `Module:Russo-Ukrainian war
 * detailed map` (obce a infraštruktúra) — Lua tabuľky `{ lat, long, mark, marksize,
 * label, link }`, ikona = stav (legenda v /doc modulu: modrá bodka = Ukrajina,
 * červená = Rusko a spojenci, sivá = bez kontroly, animovaný gif = kontestované,
 * oblúk = obliehané z jednej strany, 3×3/4×4 bodky = vidiecka prítomnosť; lietadlo,
 * kotva, elektráreň, základňa… = infraštruktúra s farbou strany).
 *
 * Od 2026-09-26 (etapa 2 modulu BLÍZKY VÝCHOD) je tento súbor TENKÝ OBAL nad spoločným
 * jadrom `wikiControl.js`: Ukrajina je jedna konfigurácia (`UKRAINE_CONTROL_CONFIG`),
 * každý doterajší export drží meno, signatúru aj predvolené hodnoty (testy Ukrajiny bez
 * zmeny). Nové moduly (Izrael–Palestína, Jemen, Sýria, Libanon) volajú jadro priamo.
 *
 * ZÁMERNÉ ODCHÝLKY od pôvodného parsera (výstup nie je bajt po bajte rovnaký na vstupoch,
 * ktoré pôvodné testy Ukrajiny nepokrývali; všetky sú opravy a sú pripnuté testom
 * „Ukrajina cez obal: zámerné odchýlky…" v wikiControl.test.mjs):
 *  1. Zakomentované značky Lua (`-- { lat = … }`, `--[[ … ]]`) sa ZAHODIA — pôvodný parser
 *     ich počítal ako živé sídla (`stripLuaComments` beží pred hľadaním záznamov).
 *  2. Značka s `marksize` ≥ 40 (`OVERLAY_MARKSIZE`) je obrázok podkladu → `skipped`,
 *     nie bod — pôvodný parser poznal len cestný prekryv podľa mena.
 *  3. Popisy: `&nbsp;`/`&amp;` sa dekódujú, HTML značky (`<small>…</small>`) sa odstránia
 *     a biele znaky zlúčia — pôvodné mená ich niesli doslovne (4 mená s `&nbsp;` v archíve).
 *  4. Ikona infraštruktúry so známym tvarom, no BEZ farby strany (`Fighter-jet-black-icon.svg`)
 *     dáva `markStatus` = null (neznáma, počítaná v jadre) — pôvodne `{ side: null, kind }`;
 *     z bodov vypadla v oboch prípadoch.
 *  5. `controlRaster` s LEN spornými/zmiešanými sídlami (bez ua/ru) dáva bunkám za polomerom
 *     sporného `none` — pôvodne 'ua' (artefakt porovnania Infinity < Infinity). Skutočný
 *     modul má vždy obe strany; pri nich je raster bit po bite zhodný s hrubou silou.
 * Kontinuita archívu: prvý tik po nasadení prepočíta tú istú revíziu novým kódom, takže
 * počet bodov sa môže zmeniť bez úpravy na Wikipédii (revisionAt ostáva) — poctivo tu.
 *
 * Licencia CC BY-SA 4.0: odvodený súbor bodov a raster zón sú Adapted Material —
 * vydávajú sa pod CC BY-SA s odkazom na revíziu (DATA_SOURCES.md). Wikipédia mapu
 * skladá z textových správ („copying from maps is strictly prohibited"), takže
 * nie je derivátom ISW/DeepState. Poctivosť: dobrovoľnícka mapa, aktualizovaná
 * nepravidelne — v UI vždy dátum revízie a slovo „podľa Wikipédie". NIE JE to
 * oficiálna línia frontu.
 *
 * Raster zón (`controlRaster`) je ODVODENÝ: bunka mriežky dostane stranu podľa
 * najbližšieho sídla (RU výplň tlmená, UA bez výplne ako u Rybara), pás, kde sú
 * obe strany blízko alebo sídlo kontestované, = šrafovaná zóna bojov. Čistý modul.
 */
import {
  UKRAINE_CONTROL_CONFIG, UKRAINE_DEFAULT_MK, UKRAINE_MARKSIZE_POP,
  parseMkTable as wikiParseMkTable, plainLabel as wikiPlainLabel,
  wikiControlCodes, wikiControlColours, wikiControlPoints, wikiControlRaster, wikiControlSummary, wikiMarkStatus, wikiParseLuaMarks, wikiSideText,
} from './wikiControl.js';

export { UKRAINE_CONTROL_CONFIG };

/** Skratky `mk` z prehľadového modulu (záloha, keď ich revízia nemá). */
export const DEFAULT_MK = UKRAINE_DEFAULT_MK;
export const WIKI_OVERVIEW_TITLE = UKRAINE_CONTROL_CONFIG.titles[0].title;
export const WIKI_DETAILED_TITLE = UKRAINE_CONTROL_CONFIG.titles[1].title;
export const WIKI_ATTRIBUTION = UKRAINE_CONTROL_CONFIG.attribution;
/** Veľkosť značky → trieda populácie (komentár v module). */
export const MARKSIZE_POP = UKRAINE_MARKSIZE_POP;

/** Tabuľka skratiek `mk = { key = "file" }` z Lua zdroja (alebo záloha). Pure. */
export function parseMkTable(src) {
  return wikiParseMkTable(src, DEFAULT_MK);
}

/** `[[Lyman, Ukraine|Lyman]]` → „Lyman"; `[[Bakhmut]]` → „Bakhmut"; bez odkazu = text. Pure. */
export function plainLabel(label) {
  return wikiPlainLabel(label);
}

/**
 * Ikona → { side: 'ua'|'ru'|'none'|'contested'|'mixed', kind, pressure? } alebo null
 * (neznáma ikona bez farby, cestný podklad, aj známy tvar infraštruktúry bez farby strany —
 * odchýlka 4 v hlavičke). `pressure` = strana, ktorá obliehanú/tlačenú lokalitu tlačí
 * (oblúk jej farby). Pure.
 */
export function markStatus(icon) {
  const status = wikiMarkStatus(icon, UKRAINE_CONTROL_CONFIG);
  return status && !status.skip ? status : null;
}

/**
 * Lua zdroj modulu → záznamy `{ lat, lon, icon, side, kind, pressure, size, pop,
 * name, link }` (bez podkladovej cestnej mapy, bez značiek bez strany, bez zakomentovaných
 * značiek a bez obrázkov s marksize ≥ 40 — odchýlky 1–3 v hlavičke). Pure.
 * @param {string} src Lua text
 * @param {Record<string,string>} [mk] tabuľka skratiek (predvolene z toho istého zdroja)
 */
export function parseLuaMarks(src, mk = null) {
  return wikiParseLuaMarks(src, UKRAINE_CONTROL_CONFIG, { mk }).points;
}

/**
 * Prehľadový + podrobný modul → jeden zoznam (podrobný modul si prehľadový
 * `require`-uje, sám nesie ďalšie obce a infraštruktúru; skratky `mk` berie
 * z prehľadového). Duplicitné súradnice (na 3 desatinné) vyhrá podrobný. Pure.
 */
export function controlPointsFromModules(overviewSrc, detailedSrc) {
  const sources = [{ id: 'overview', src: overviewSrc || '' }, { id: 'detailed', src: detailedSrc || '' }];
  return wikiControlPoints(sources, UKRAINE_CONTROL_CONFIG, { mk: parseMkTable(overviewSrc || '') }).points;
}

/** Počty bodov podľa strany a druhu (pre panel a legendu). Pure. */
export function controlSummary(points) {
  return wikiControlSummary(points, UKRAINE_CONTROL_CONFIG);
}

/** Predvolený rámec rastra: Ukrajina s Krymom a pohraničím RU (Kursk/Belgorod). */
export const CONTROL_RASTER_BBOX = UKRAINE_CONTROL_CONFIG.bbox;
export const CONTROL_CODE = wikiControlCodes(UKRAINE_CONTROL_CONFIG);

/**
 * Odvodený raster zón: každá bunka podľa najbližšieho sídla (settlement/rural,
 * kontestované rátajú pre obe strany); pás `bandKm`, kde je druhá strana rovnako
 * blízko alebo najbližšie sídlo je kontestované, = zóna bojov; ďalej než `maxKm`
 * od akéhokoľvek bodu = bez údaja. Vzdialenosti v km s kosínusom šírky. Vstup len so
 * spornými sídlami dáva `none`, nie 'ua' (odchýlka 5 v hlavičke). Pure.
 * @returns {{width:number,height:number,cellDeg:number,bbox:object,cells:Uint8Array,counts:{ua:number,ru:number,contested:number,none:number}}}
 */
export function controlRaster(points, { bbox = CONTROL_RASTER_BBOX, cellDeg = 0.05, maxKm = 35, bandKm = 7, contestedKm = bandKm } = {}) {
  return wikiControlRaster(points, UKRAINE_CONTROL_CONFIG, { bbox, cellDeg, maxKm, bandKm, contestedKm });
}

/** Farby strán (monochromatický štýl OKO; RU tehlová tlmená, UA modrá, kontestované jantár). */
export const CONTROL_COLORS = wikiControlColours(UKRAINE_CONTROL_CONFIG);

/**
 * Text stavu pre kartu/legendu (i18n kľúče `ukraine.ctl.*`). Pure.
 */
export function controlSideText(side, translate = (k) => k) {
  return wikiSideText(side, UKRAINE_CONTROL_CONFIG, translate);
}
