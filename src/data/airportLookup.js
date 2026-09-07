// src/data/airportLookup.js
/**
 * @module airportLookup
 * @description Vyhľadanie letiska podľa kódu (ICAO alebo IATA) MIMO vrstvy
 * letísk — pre kokpit (2026-09-07: METAR cieľa a priblíženie), ktorý
 * potrebuje polohu, nadmorskú výšku a dráhy cieľového letiska aj keď
 * vrstva letísk nie je zapnutá.
 *
 * Index sa stavia lenivo pri prvom dopyte z tých istých bundlovaných
 * súborov, ktoré používa vrstva (`airports.geojsonl` ≈ 1,7 MB,
 * `airport-details.json` ≈ 1,6 MB; OurAirports, public domain) — jedno
 * načítanie za sedenie, žiadna sieť mimo localhost. adsbdb dáva do trasy
 * IATA kód (`BTS`), METAR chce ICAO (`LZIB`) — preto index podľa oboch.
 */
import { AIRPORT_DETAILS_FILE } from './airportsData.js';

const AIRPORTS_URL = new URL('./local_data/airports/airports.geojsonl', import.meta.url).href;
const DETAILS_URL = new URL(`./local_data/airports/${AIRPORT_DETAILS_FILE}`, import.meta.url).href;

/** @type {Promise<Map<string, object>>|null} */
let _indexPromise = null;
/** @type {Promise<object>|null} */
let _detailsPromise = null;

/**
 * Postav index kód → záznam z textu GeoJSONL. Pure.
 * @param {string} text
 * @returns {Map<string, {ident: string, icao: string|null, iata: string|null, name: string, municipality: string, country: string|null, lat: number, lon: number, elevFt: number|null}>}
 */
export function parseAirportIndex(text) {
  const index = new Map();
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let feature;
    try { feature = JSON.parse(trimmed); } catch { continue; }
    const p = feature?.properties || {};
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue;
    const record = {
      ident: String(p.ident || feature.id || '').toUpperCase(),
      icao: /^[A-Z0-9]{4}$/.test(String(p.icao || '')) ? String(p.icao).toUpperCase() : null,
      iata: /^[A-Z0-9]{3}$/.test(String(p.iata || '')) ? String(p.iata).toUpperCase() : null,
      name: String(p.name || ''),
      municipality: String(p.municipality || ''),
      country: p.country ?? null,
      lat: coords[1],
      lon: coords[0],
      elevFt: Number.isFinite(p.elevFt) ? p.elevFt : null,
    };
    // ICAO má prednosť: pri zhode IATA s cudzím ICAO (zriedkavé) vyhrá ICAO.
    if (record.icao && !index.has(record.icao)) index.set(record.icao, record);
    if (record.iata && !index.has(record.iata)) index.set(record.iata, record);
    if (record.ident && !index.has(record.ident)) index.set(record.ident, record);
  }
  return index;
}

function loadIndex(fetcher) {
  if (!_indexPromise) {
    _indexPromise = Promise.resolve(fetcher(AIRPORTS_URL))
      .then((r) => (r?.ok ? r.text() : Promise.reject(new Error(`airports HTTP ${r?.status}`))))
      .then(parseAirportIndex)
      .catch((error) => { _indexPromise = null; throw error; });
  }
  return _indexPromise;
}

function loadDetails(fetcher) {
  if (!_detailsPromise) {
    _detailsPromise = Promise.resolve(fetcher(DETAILS_URL))
      .then((r) => (r?.ok ? r.json() : Promise.reject(new Error(`airport details HTTP ${r?.status}`))))
      .then((json) => (json && typeof json.airports === 'object' ? json.airports : {}))
      .catch(() => ({})); // dráhy sú doplnok — bez sidecaru ostane záznam bez `rwy`
  }
  return _detailsPromise;
}

/**
 * Nájdi letisko podľa ICAO/IATA/ident. Vracia záznam s `rwy` zo sidecaru
 * (pole dráh ako v karte letiska) alebo null.
 * @param {string} code
 * @param {object} [options]
 * @param {typeof fetch} [options.fetcher]
 * @returns {Promise<object|null>}
 */
export async function lookupAirport(code, { fetcher = globalThis.fetch } = {}) {
  const key = String(code || '').trim().toUpperCase();
  if (!key || typeof fetcher !== 'function') return null;
  const [index, details] = await Promise.all([loadIndex(fetcher), loadDetails(fetcher)]);
  const record = index.get(key);
  if (!record) return null;
  const sidecar = details?.[record.ident] || (record.icao ? details?.[record.icao] : null) || null;
  return { ...record, rwy: Array.isArray(sidecar?.rwy) ? sidecar.rwy : [] };
}

/** Zahoď lenivé indexy (testy). */
export function _resetAirportLookupForTest() {
  _indexPromise = null;
  _detailsPromise = null;
}
