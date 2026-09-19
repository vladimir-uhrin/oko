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
export function pipelineStyle(properties = {}) {
  const status = pipelineStatus(properties);
  const kind = pipelineKind(properties);
  const d = Number(properties?.diameterMm);
  // Šírka znamená priemer rovnako pri oboch látkach — dve protirečivé pravidlá
  // by sa používateľ učiť nemal. Trieda dáva zmysel až od opravy čítania palcov
  // v scripts/lib/pipelineTags.mjs; predtým padlo do 1,4 px takmer všetko.
  const width = Number.isFinite(d) && d >= 900 ? 2.8 : (Number.isFinite(d) && d >= 500 ? 2.0 : 1.4);
  return {
    width,
    // disused zdvihnuté 0,40 → 0,45: pri 0,40 malo nad nočným oceánom kontrast
    // 1,55, teda na hranici neviditeľnosti.
    alpha: status === 'disused' ? 0.45 : (status === 'planned' ? 0.7 : 0.85),
    dashed: status === 'planned',
    color: COLORS_BY_KIND[kind][status],
    kind,
    status,
  };
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
