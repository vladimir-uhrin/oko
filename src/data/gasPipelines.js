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
export const GAS_PIPELINES_API = '/api/gas/pipelines';
export const GAS_PIPELINES_META_API = '/api/gas/pipelines/meta';
export const GAS_PIPELINE_ATTRIBUTION = '© OpenStreetMap contributors · ODbL';
/** Jantár ako plyn v Energetike SR; plánované čiarkovane; odstavené stlmené. */
export const GAS_PIPELINE_COLORS = Object.freeze({
  operating: '#ffb14d',
  planned: '#ffd28a',
  disused: '#7a6a52',
  selected: '#ffffff',
});

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
  const d = Number(properties?.diameterMm);
  const width = Number.isFinite(d) && d >= 900 ? 2.8 : (Number.isFinite(d) && d >= 500 ? 2.0 : 1.4);
  return {
    width,
    alpha: status === 'disused' ? 0.4 : (status === 'planned' ? 0.7 : 0.85),
    dashed: status === 'planned',
    color: GAS_PIPELINE_COLORS[status],
    status,
  };
}

/** Meno pre kartu: name → name:en → ref → „plynovod (bez mena)“. */
export function pipelineTitle(properties = {}, translate = (k) => k) {
  const name = String(properties?.name || properties?.nameEn || properties?.ref || '').trim();
  return name || translate('gas.pipeline-unnamed');
}

const locale = (lang) => (lang === 'sk' ? 'sk-SK' : 'en-GB');

/**
 * Riadky karty: prevádzkovateľ, priemer, dĺžka úseku, stav, OSM id.
 * @param {object} properties
 * @param {(k: string, v?: object) => string} translate
 * @param {string} [lang]
 * @returns {string[]}
 */
export function pipelineDetails(properties = {}, translate = (k) => k, lang = 'sk') {
  const lines = [];
  if (properties?.operator) lines.push(String(properties.operator));
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
