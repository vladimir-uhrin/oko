// src/data/gasPipelines.js
/**
 * @module gasPipelines
 * @description Plynovody EÚ + bývalého ZSSR (modul PLYN, etapa 5,
 * 2026-09-13): čisté pomocné funkcie nad snímkom OSM tranzitných plynovodov,
 * ktorý stavia `scripts/build-gas-pipelines.mjs` do `.gev-cache/gas/` a
 * servíruje proxy `/api/gas/pipelines` (geojsonl) a `/api/gas/pipelines/meta`
 * (provenance). Parsovanie, štýl podľa priemeru a stavu, texty karty.
 * Licencia dát: ODbL 1.0, © OpenStreetMap contributors. Modul je čistý
 * (bez Cesia, i18n a DOM) — testuje sa v Node.
 */
import { latinizeForDisplay } from './latinize.js';

export const GAS_PIPELINES_API = '/api/gas/pipelines';
export const GAS_PIPELINES_META_API = '/api/gas/pipelines/meta';
export const GAS_PIPELINE_ATTRIBUTION = '© OpenStreetMap contributors · ODbL';
/** Jantár ako plyn v Energetike SR; plánované čiarkovane; odstavené stlmené. */
export const OIL_PIPELINES_API = '/api/oil/pipelines';
export const OIL_PIPELINES_META_API = '/api/oil/pipelines/meta';

export const GAS_PIPELINE_COLORS = Object.freeze({
  operating: '#ffb14d',
  planned: '#ffd28a',
  disused: '#7a6a52',
  selected: '#ffffff',
});

/**
 * Ropa má vlastnú paletu (2026-09-19, etapa 2). Jantár nešiel použiť ani
 * v odtieni: v scéne úžiny je jantárová už plynová magistrála, trup tankera
 * (#ffb347) aj pin scény (#ffb547) — merané CIEDE2000 1,5 a 2,3 od plynového
 * #ffb14d, teda prakticky tá istá farba. Práve pri rope by to zavádzalo.
 * Orchidea je 48,9 dE od plynu, 36,2 od červeného plotu hraníc (#f0574d, ktorý
 * je zapnutý v každej scéne úžiny) a 41,9 od tyrkysových lodných koridorov;
 * pod deuteranopiou drží 50,6 od plotu a 53,4 od plynu, čo zelené a limetkové
 * kandidátky neprežijú. Fialová #a78bde je obsadená — to je reč lietadiel.
 *
 * Farba však NIE JE jediný kanál: karta hovorí látku aj slovom, lebo žiadny
 * odtieň nezvládne naraz odstup od jantára, červenej a tyrkysovej pri
 * červeno-zelenej farbosleposti.
 */
export const OIL_PIPELINE_COLORS = Object.freeze({
  operating: '#eab2ff',
  planned: '#f3d1ff',
  disused: '#87768d',
  selected: '#ffffff',
});

const OIL_SUBSTANCE_RE = /^(oil|crude_oil|petroleum)$/i;

/**
 * Látka úseku podľa tagu `substance`, ktorý snímok nesie. Neznáme = plyn,
 * lebo plynová vrstva je staršia a jej snímok má substance vyplnenú vždy.
 * @param {object} properties
 * @returns {'oil'|'gas'}
 */
export function pipelineKind(properties = {}) {
  return OIL_SUBSTANCE_RE.test(String(properties?.substance || '')) ? 'oil' : 'gas';
}

const COLORS_BY_KIND = Object.freeze({ gas: GAS_PIPELINE_COLORS, oil: OIL_PIPELINE_COLORS });

/**
 * Jeden Feature na riadok; poškodené riadky sa zahodia, nie sú fatálne.
 * @param {string} text
 * @returns {Array<object>} LineString features s ≥ 2 bodmi
 */
export function parsePipelinesGeojsonl(text) {
  const features = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const feature = JSON.parse(trimmed);
      if (feature?.geometry?.type !== 'LineString') continue;
      if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) continue;
      features.push(feature);
    } catch { /* poškodený riadok */ }
  }
  return features;
}

/** Stav z vlastností snímku (build ho odvodí z OSM tagov disused/construction/proposed). */
export function pipelineStatus(properties = {}) {
  const s = String(properties?.status || 'operating');
  return s === 'planned' || s === 'disused' ? s : 'operating';
}

/**
 * Šírka čiary podľa priemeru (DN ≥ 900 mm = chrbtica), priehľadnosť podľa stavu.
 * @param {{diameterMm?: number|null, status?: string}} properties
 * @returns {{width: number, alpha: number, dashed: boolean, color: string, status: string}}
 */
/**
 * Triedy šírok v px (etapa 4, MERANÉ 2026-09-19 na fotoreáli so zapnutým
 * sharpenom): doostrenie prepáli vnútro čiary až do ~2 px od okraja, takže
 * pri 1,4–3 px zostane z orchidey #eab2ff biela 255,190,255 a farba ako kanál
 * zanikne. Od 4 px (2 px jadro) odtieň prežije (namerané 212,164,228), tmavý
 * obrys 1 px dá kontrast nad svetlým terénom a pohltí halo doostrenia. Šírka
 * naďalej znamená priemer: chrbtica DN ≥ 900 najhrubšia; pahýle do 2 km bez
 * priemeru najtenšie a navyše miznú z diaľky (pipelineDisplayCondition).
 */
export const PIPELINE_WIDTHS = Object.freeze({ trunk: 6, main: 5, minor: 4, stub: 3 });
/** Tmavý obrys pod farbou látky — spoločný pre plyn aj ropu. */
export const PIPELINE_OUTLINE = Object.freeze({ width: 1, color: '#0b0f14', alpha: 0.7 });
/** Zvýraznenie výberu: biela, širšia o 3 px, tmavší obrys. */
export const PIPELINE_SELECTED = Object.freeze({ extraWidth: 3, color: '#ffffff', alpha: 0.95, outline: Object.freeze({ width: 1.5, color: '#0b0f14', alpha: 0.9 }) });

/** Trieda šírky z priemeru a dĺžky úseku. */
export function pipelineWidthClass(properties = {}) {
  const d = Number(properties?.diameterMm);
  const km = Number(properties?.lengthKm);
  if (Number.isFinite(d) && d >= 900) return 'trunk';
  if (Number.isFinite(d) && d >= 500) return 'main';
  if (Number.isFinite(km) && km > 0 && km < 2) return 'stub';
  return 'minor';
}

/**
 * Podmienka zobrazenia podľa dĺžky úseku (etapa 4): 52,8 % úsekov sú dvojbodové
 * pahýle a 42,3 % je kratších než 1 km — z diaľky sa zlievajú do šumu a nič
 * nehovoria. Krátke úseky preto miznú skôr než dlhé; úsek od 20 km je vidieť
 * vždy, lebo z takých sú zložené magistrály. Neznáma dĺžka = nikdy neskrývať.
 * @param {number|null|undefined} lengthKm
 * @returns {[number, number]|null} [near, far] v metroch alebo null
 */
export function pipelineDisplayCondition(lengthKm) {
  const km = Number(lengthKm);
  if (!Number.isFinite(km) || km <= 0) return null;
  if (km < 1) return [0, 300_000];
  if (km < 5) return [0, 1_200_000];
  if (km < 20) return [0, 4_000_000];
  return null;
}

export function pipelineStyle(properties = {}) {
  const status = pipelineStatus(properties);
  const kind = pipelineKind(properties);
  // Šírka znamená priemer rovnako pri oboch látkach — dve protirečivé pravidlá
  // by sa používateľ učiť nemal. Trieda dáva zmysel až od opravy čítania palcov
  // v scripts/lib/pipelineTags.mjs; predtým padlo do najtenšej takmer všetko.
  const widthClass = pipelineWidthClass(properties);
  const dashed = status === 'planned';
  return {
    width: PIPELINE_WIDTHS[widthClass],
    widthClass,
    // disused zdvihnuté 0,40 → 0,45: pri 0,40 malo nad nočným oceánom kontrast
    // 1,55, teda na hranici neviditeľnosti.
    alpha: status === 'disused' ? 0.45 : (status === 'planned' ? 0.7 : 0.85),
    dashed,
    color: COLORS_BY_KIND[kind][status],
    // Čiarkovanie a obrys sú dva materiály, ktoré sa v Cesiu nespoja — plánované
    // majú namiesto obrysu tmavú medzeru medzi čiarkami.
    outline: dashed ? null : PIPELINE_OUTLINE,
    gapColor: dashed ? PIPELINE_OUTLINE.color : null,
    displayCondition: pipelineDisplayCondition(properties?.lengthKm),
    kind,
    status,
  };
}

/**
 * Plot (etapa 5, viditeľnosť II): priesvitná stena vo farbe látky stojaca na
 * chrbtici, viditeľná len v strednom pásme vzdialenosti kamery — z bočného
 * pohľadu je rúra stuha nad terénom, nie čiarka za hrebeňom. Odlíšenie od
 * červeného plotu hraníc (18 667 m, pásmo 300–1 300 km) je vo výške (tretina)
 * aj v odtieni; pásma sa prekrývajú zámerne. Výška je nad ELIPSOIDOM ako pri
 * hraniciach: 7 km vytŕča nad Zagros aj Iránsku plošinu, v nížine je to
 * stuha 7 km. Len prevádzkované chrbtice a hlavné vetvy (DN ≥ 500) — plot na
 * pahýľoch by bol šum, plánované rúry ešte nestoja.
 */
export const PIPELINE_FENCE = Object.freeze({ heightM: 7000, near: 200_000, far: 1_100_000, alpha: 0.18, topAlpha: 0.75 });
export function pipelineFenceSpec(properties = {}) {
  const style = pipelineStyle(properties);
  if (style.status !== 'operating') return null;
  if (style.widthClass !== 'trunk' && style.widthClass !== 'main') return null;
  return { heightM: PIPELINE_FENCE.heightM, near: PIPELINE_FENCE.near, far: PIPELINE_FENCE.far, color: style.color, alpha: PIPELINE_FENCE.alpha, topAlpha: PIPELINE_FENCE.topAlpha, kind: style.kind };
}

/**
 * Duch (etapa 5): zblízka sa pozemná čiara stráca za hrebeňmi. Pre ohraničenú
 * kohortu úsekov pri kamere sa zistí elipsoidná výška terénu na každom vrchole
 * (spoločný resolver `terrainHeights.js` → proxy `/api/terrain/heights`,
 * Re:Earth, disk cache; raz na úsek, cache) a nakreslí sa statická čiara
 * s `depthFailMaterial` — vidno ju LEN tam, kde ju terén zakrýva. Pevná výška
 * nad elipsoidom by nad Zagrosom bola 1–3 km pod zemou, preto vzorkovanie.
 * PREČO NIE `scene.sampleHeightMostDetailed` (2026-09-19, skúsené): núti načítať
 * najdetailnejšie 3D dlaždice pre každý bod v okruhu 250 km — tisíce požiadaviek
 * na fotoreálne dlaždice (kvóta) a v pane sa to nikdy nedokončilo. A nie
 * `Cesium.sampleTerrain(viewer.terrainProvider)`: na fotoreáli je provider
 * plochý EllipsoidTerrainProvider (glóbus skrytý), výšky by boli 0.
 * Pásmo sa s plotom prekrýva (200–250 km), aby netreba bolo hysterézny automat.
 */
export const PIPELINE_GHOST = Object.freeze({ maxDistanceM: 250_000, cap: 60, maxVertices: 600, retryMs: 300_000, liftM: 3, widthDelta: 1, alpha: 0.55, dashLength: 10 });

/**
 * Kohorta pre ducha: úseky (okrem pahýľov) so stredom do `maxDistanceM` od
 * kamery, najbližšie prvé, najviac `cap` úsekov a `maxVertices` vrcholov.
 * Čistá funkcia nad {x,y,z} — bez Cesia, testuje sa v Node.
 * @param {Array<{id: string, mid: {x: number, y: number, z: number}, points: number, widthClass: string}>} records
 * @param {{x: number, y: number, z: number}} camera
 * @param {{maxDistanceM?: number, cap?: number, maxVertices?: number}} [o]
 * @returns {string[]} id úsekov
 */
export function selectGhostCohort(records, camera, { maxDistanceM = PIPELINE_GHOST.maxDistanceM, cap = PIPELINE_GHOST.cap, maxVertices = PIPELINE_GHOST.maxVertices } = {}) {
  if (!camera || !Array.isArray(records)) return [];
  const near = [];
  for (const r of records) {
    if (!r?.mid || r.widthClass === 'stub') continue;
    const d = Math.hypot(r.mid.x - camera.x, r.mid.y - camera.y, r.mid.z - camera.z);
    if (d <= maxDistanceM) near.push({ id: r.id, d, points: Number(r.points) || 2 });
  }
  near.sort((a, b) => a.d - b.d);
  const out = [];
  let vertices = 0;
  for (const r of near) {
    if (out.length >= cap || vertices + r.points > maxVertices) break;
    out.push(r.id);
    vertices += r.points;
  }
  return out;
}

/**
 * Skupina = celá trasa (etapa 6): úsek je fragment cesty OSM, klik naň by inak
 * vybral 900 m pahýľ. Kľúč je id relácie route=pipeline, keď existuje; inak
 * meno + prevádzkovateľ. Všeobecné mená („лупинг" = slučka, „Нефтепровод" =
 * ropovod, „gas pipeline") nič nespájajú, len by vybrali stovky nesúvisiacich
 * kusov naprieč krajinou — tie skupinu netvoria.
 */
const GENERIC_PIPELINE_NAME_RE = /^(лупинг|лупінг|нефтепровод|нафтопровід|газопровод|газопровід|магистральный газопровод|магістральний газопровід|pipeline|gas pipeline|oil pipeline|gasleitung|erdgasleitung|ölleitung|gazociąg|ropociąg|plynovod|ropovod|خط لوله گاز|خط لوله نفت|输气管道|输油管道|天然气管道|管道)$/i;
/** Najviac úsekov v jednej mennej skupine — nad tým je meno prakticky všeobecné. */
export const PIPELINE_GROUP_MAX = 120;
export function pipelineGroupKey(properties = {}) {
  const relation = Number(properties?.relation);
  if (Number.isFinite(relation) && relation > 0) return `rel:${relation}`;
  const name = String(properties?.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (name.length < 4 || GENERIC_PIPELINE_NAME_RE.test(name)) return null;
  const operator = String(properties?.operator || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `name:${name}|${operator}`;
}

/**
 * Súhrn skupiny pre kartu: počet úsekov a súčet km.
 * @param {Array<{properties?: object}>} features
 * @returns {{count: number, lengthKm: number}}
 */
export function pipelineGroupSummary(features) {
  const list = Array.isArray(features) ? features : [];
  return { count: list.length, lengthKm: Math.round(list.reduce((s, f) => s + (Number(f?.properties?.lengthKm) || 0), 0)) };
}

/** Štýl zvýraznenia vybraného úseku — odvodený od základného, vždy viditeľný. */
export function pipelineSelectedStyle(properties = {}) {
  const base = pipelineStyle(properties);
  return { ...base, width: base.width + PIPELINE_SELECTED.extraWidth, color: PIPELINE_SELECTED.color, alpha: PIPELINE_SELECTED.alpha, dashed: false, outline: PIPELINE_SELECTED.outline, gapColor: null, displayCondition: null };
}

/**
 * Zobrazované meno (etapa 3b, používateľ: „niektoré názvy sú v azbuke"):
 * name:sk → name:en → int_name → prepis cyriliky → name → ref. `original`
 * nesie pôvodný zápis, keď sa od zobrazeného líši (karta ho ukáže pod menom
 * — s mapou a OSM sa porovnáva originál, nie náš prepis). Arabské, perzské
 * a čínske mená sa neprepisujú: bez `name:en` ostáva originál.
 * @param {object} properties
 * @returns {{text: string, original: string|null}}
 */
export function pipelineDisplayName(properties = {}) {
  const pick = (v) => String(v || '').trim();
  const name = pick(properties?.name);
  for (const alt of [pick(properties?.nameSk), pick(properties?.nameEn), pick(properties?.intName)]) {
    if (alt) return { text: alt, original: name && name !== alt ? name : null };
  }
  if (name) return latinizeForDisplay(name, { lang: properties?.nameLang || null });
  return { text: pick(properties?.ref), original: null };
}

/** Prevádzkovateľ v latinke (+ originál, keď bol v cyrilike). */
export function pipelineOperator(properties = {}) {
  return latinizeForDisplay(properties?.operator, { lang: properties?.nameLang || null });
}

/** OSM `location` potrubia → i18n kľúč; neznáma hodnota ostáva doslovne. */
const LOCATION_VALUES = new Set(['underground', 'overground', 'surface', 'overhead', 'underwater']);
export function pipelineLocationText(properties = {}, translate = (k) => k) {
  const raw = String(properties?.location || '').trim().toLowerCase();
  if (!raw) return '';
  return LOCATION_VALUES.has(raw) ? translate(`gas.pipeline-location-${raw}`) : raw;
}

/** Meno pre kartu: name:sk → name:en → int_name → prepis → name → ref → „plynovod (bez mena)“. */
export function pipelineTitle(properties = {}, translate = (k) => k) {
  return pipelineDisplayName(properties).text || translate(pipelineKind(properties) === 'oil' ? 'gas.pipeline-unnamed-oil' : 'gas.pipeline-unnamed');
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/**
 * Trasa z tagov `from` → `to` (nesú ich relácie route=pipeline; členské úseky
 * ich dedia v builde). Jeden koniec bez druhého ostáva „?" — polovičná trasa
 * je stále informácia, ale nesmie vyzerať ako celá.
 * @param {object} properties
 * @returns {string|null}
 */
export function pipelineRoute(properties = {}) {
  // Konce trasy sú miesta z OSM — v cyrilike sa prepíšu ako meno (3b).
  const lang = properties?.nameLang || null;
  const from = latinizeForDisplay(properties?.from, { lang }).text;
  const to = latinizeForDisplay(properties?.to, { lang }).text;
  if (!from && !to) return null;
  return `${from || '?'} → ${to || '?'}`;
}

/**
 * Riadky karty: prevádzkovateľ, priemer, dĺžka úseku, stav, OSM id.
 * @param {object} properties
 * @param {(k: string, v?: object) => string} translate
 * @param {string} [lang]
 * @returns {string[]}
 */
export function pipelineDetails(properties = {}, translate = (k) => k, lang = 'sk', { regionName = (iso) => iso } = {}) {
  const lines = [];
  // Látka ako PRVÝ riadok, a schválne pri OBOCH vrstvách. Bez nej dá pomenovaný
  // ropovod a pomenovaný plynovod textovo nerozlíšiteľnú kartu a jediným
  // rozdielom ostane farba — čo pri červeno-zelenej farbosleposti nestačí.
  // Keby hlavičku dostala len ropa, používateľ by sa naučil „karta bez
  // hlavičky = plyn", čo je presne to implicitné pravidlo, ktorému sa vyhýbame.
  lines.push(translate('gas.pipeline-kind-' + pipelineKind(properties)));
  // Surový dôkaz z OSM: prečo je úsek zaradený ako ropa, a zároveň vidno, že
  // substance=fuel (rafinované produkty) sme z ropnej vrstvy vylúčili.
  if (properties?.substance) lines.push('substance=' + properties.substance + ' (OSM)');
  if (properties?.operator) lines.push(pipelineOperator(properties).text);
  // Krajiny úseku (etapa 3b, dopočítané v builde z Natural Earth) — v poradí pozdĺž úseku.
  const countries = Array.isArray(properties?.countries) ? properties.countries.filter(Boolean) : [];
  if (countries.length) lines.push(translate('gas.pipeline-countries') + ': ' + countries.map((iso) => regionName(iso) || iso).join(' · '));
  // „Kam tečie" (etapa 3): `from`/`to` z relácie route=pipeline, keď ich OSM má.
  const route = pipelineRoute(properties);
  if (route) lines.push(translate('gas.pipeline-route') + ': ' + route);
  const location = pipelineLocationText(properties, translate);
  if (location) lines.push(translate('gas.pipeline-location') + ': ' + location);
  const d = Number(properties?.diameterMm);
  const km = Number(properties?.lengthKm);
  const dims = [];
  if (Number.isFinite(d) && d > 0) dims.push(translate('gas.pipeline-diameter', { mm: new Intl.NumberFormat(locale(lang)).format(Math.round(d)) }));
  if (Number.isFinite(km) && km > 0) dims.push(translate('gas.pipeline-length', { km: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) }));
  if (dims.length) lines.push(dims.join(' · '));
  lines.push(translate(`gas.pipeline-status-${pipelineStatus(properties)}`));
  if (properties?.osm) lines.push(`OSM way ${properties.osm}`);
  return lines;
}

/**
 * Riadky `[popis, hodnota]` pre hover kartu (etapa 3): len to, čo úsek naozaj
 * má — prevádzkovateľ, priemer, dĺžka úseku, trasa, kapacita a tlak z OSM,
 * stav. Látka a OSM id sú v karte zvlášť (hlavička, odkaz), preto tu nie sú.
 * @param {object} properties
 * @param {(k: string, v?: object) => string} translate
 * @param {string} [lang]
 * @returns {Array<[string, string]>}
 */
export function pipelineDetailsRows(properties = {}, translate = (k) => k, lang = 'sk') {
  const rows = [];
  if (properties?.operator) rows.push([translate('gas.pipeline-operator'), pipelineOperator(properties).text]);
  const d = Number(properties?.diameterMm);
  if (Number.isFinite(d) && d > 0) rows.push([translate('gas.pipeline-diameter-label'), translate('gas.pipeline-diameter', { mm: new Intl.NumberFormat(locale(lang)).format(Math.round(d)) })]);
  const km = Number(properties?.lengthKm);
  if (Number.isFinite(km) && km > 0) rows.push([translate('gas.pipeline-segment'), translate('gas.pipeline-length', { km: new Intl.NumberFormat(locale(lang), { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km) })]);
  const route = pipelineRoute(properties);
  if (route) rows.push([translate('gas.pipeline-route'), route]);
  if (properties?.capacity) rows.push([translate('gas.pipeline-capacity'), String(properties.capacity)]);
  // OSM `pressure` je podľa wiki v baroch a mapuje sa väčšinou ako holé číslo
  // („95"); holému číslu sa jednotka dopíše, čokoľvek iné ostáva doslovne.
  if (properties?.pressure) {
    const raw = String(properties.pressure).trim();
    rows.push([translate('gas.pipeline-pressure'), /^\d+([.,]\d+)?$/.test(raw) ? `${raw} bar` : raw]);
  }
  const location = pipelineLocationText(properties, translate);
  if (location) rows.push([translate('gas.pipeline-location'), location]);
  rows.push([translate('gas.pipeline-status-label'), translate(`gas.pipeline-status-${pipelineStatus(properties)}`)]);
  return rows;
}

/**
 * Stredný bod úseku (kotva karty po kliknutí).
 * @param {number[][]} coordinates [lon, lat][]
 * @returns {{lon: number, lat: number}|null}
 */
export function pipelineMidpoint(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const mid = coordinates[Math.floor(coordinates.length / 2)];
  return Number.isFinite(mid?.[0]) && Number.isFinite(mid?.[1]) ? { lon: mid[0], lat: mid[1] } : null;
}

/**
 * Popis zdroja z meta súboru snímku (pre chip vrstvy a kredit).
 * @param {{snapshot?: string, features?: number, lengthKm?: number}|null} meta
 * @param {(k: string, v?: object) => string} translate
 * @param {string} [lang]
 */
export function pipelineSourceLabel(meta, translate = (k) => k, lang = 'sk') {
  const parts = [GAS_PIPELINE_ATTRIBUTION];
  if (meta?.snapshot) parts.push(translate('gas.pipeline-snapshot', { date: String(meta.snapshot).slice(0, 10) }));
  if (Number.isFinite(Number(meta?.lengthKm))) parts.push(`${new Intl.NumberFormat(locale(lang)).format(Math.round(Number(meta.lengthKm)))} km`);
  return parts.join(' · ');
}

/**
 * Stiahni meta (malé, bez cache) a potom snímok (geojsonl, ~6 MB) pod URL
 * verziovanou dátumom snímku — prehliadač si ho drží deň (max-age + ETag
 * z proxy) a nový build sa prejaví hneď, bez tvrdého reloadu. 404
 * no_snapshot = build ešte nebežal.
 * @param {{fetcher?: typeof fetch, url?: string, metaUrl?: string}} [o]
 * @returns {Promise<{features: object[], meta: object|null}>}
 */
export async function fetchGasPipelines({ fetcher = (...a) => fetch(...a), url = GAS_PIPELINES_API, metaUrl = GAS_PIPELINES_META_API } = {}) {
  let meta = null;
  try {
    const m = await fetcher(metaUrl, { cache: 'no-store' });
    if (m.ok) meta = await m.json();
  } catch { /* meta je voliteľné */ }
  const versioned = meta?.snapshot ? `${url}?v=${encodeURIComponent(String(meta.snapshot))}` : url;
  const response = await fetcher(versioned);
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`);
    err.status = response.status;
    err.code = json?.error ?? null;
    throw err;
  }
  return { features: parsePipelinesGeojsonl(await response.text()), meta };
}
