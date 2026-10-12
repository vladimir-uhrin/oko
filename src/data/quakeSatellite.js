// Satelit pred a po zemetrasení (2026-10-10, vlastník: bod 8): Copernicus Sentinel-2 L2A cez Sentinel Hub
// v Copernicus Data Space (OAuth klient „OKO“, CDSE_CLIENT_ID/SECRET, bezplatná kvóta). Mesto s najsilnejšími
// otrasmi (PAGER), výrez ~7 km, prirodzené farby; „pred" = najmenej zamračená snímka 60 dní pred otrasom,
// „po" = najmenej zamračená po otrase. Bez snímky „po" (Sentinel-2 letí nad miestom raz za ~5 dní) sa záber
// vynechá — inak by video ukazovalo len staré mesto. Licencia: Copernicus Sentinel data, voľné použitie s
// uvedením zdroja („contains modified Copernicus Sentinel data [rok]"). Pure.

export const SAT_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';
export const SAT_CATALOG_URL = 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search';
export const SAT_TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
export const SAT = Object.freeze({ halfDeg: 0.032, beforeDays: 60, maxCloud: 60, size: 1024 });

/** Mesto na porovnanie: najväčšie s intenzitou VII,5+, inak najsilnejšie otrasené od 5 000 obyvateľov. Pure. */
export function satelliteTown(cities) {
  const list = (cities || []).filter((c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lon) && Number.isFinite(c?.mmi));
  const strong = list.filter((c) => c.mmi >= 7.5 && c.pop >= 5000).sort((a, b) => b.pop - a.pop)[0];
  return strong || list.filter((c) => c.pop >= 5000).sort((a, b) => b.mmi - a.mmi)[0] || null;
}

/** Výrez okolo mesta [západ, juh, východ, sever]. Pure. */
export function satelliteBbox(town, half = SAT.halfDeg) {
  const k = 1 / Math.cos((town.lat * Math.PI) / 180);
  return [town.lon - half * k, town.lat - half, town.lon + half * k, town.lat + half];
}

/** Dopyt katalógu: snímky Sentinel-2 L2A nad výrezom v okne. Pure. */
export function catalogBody(bbox, fromIso, toIso) {
  return { bbox, datetime: `${fromIso}/${toIso}`, collections: ['sentinel-2-l2a'], limit: 50, fields: { include: ['properties.datetime', 'properties.eo:cloud_cover'] } };
}

/** Najmenej zamračená snímka z výsledku katalógu (do maxCloud %), alebo null. Pure. */
export function clearestScene(catalog, { maxCloud = SAT.maxCloud } = {}) {
  return (catalog?.features || []).map((f) => ({ at: f.properties?.datetime, cloud: Number(f.properties?.['eo:cloud_cover']) }))
    .filter((s) => s.at && Number.isFinite(s.cloud) && s.cloud <= maxCloud).sort((a, b) => a.cloud - b.cloud)[0] || null;
}

/** Prirodzené farby so zosvetlením (L2A odraz ×2,8), PNG. */
export const TRUE_COLOR_EVALSCRIPT = `//VERSION=3
function setup() { return { input: ["B02", "B03", "B04", "dataMask"], output: { bands: 4 } }; }
function evaluatePixel(s) { const g = 2.8; return [Math.min(1, s.B04 * g), Math.min(1, s.B03 * g), Math.min(1, s.B02 * g), s.dataMask]; }`;

/** Telo dopytu Process API: snímka v jednom dni (deň vybranej scény). Pure. */
export function processBody(bbox, dayIso, { size = SAT.size } = {}) {
  const from = `${dayIso.slice(0, 10)}T00:00:00Z`; const to = `${dayIso.slice(0, 10)}T23:59:59Z`;
  return {
    input: { bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' } },
      data: [{ type: 'sentinel-2-l2a', dataFilter: { timeRange: { from, to }, mosaickingOrder: 'leastCC' } }] },
    output: { width: size, height: size, responses: [{ identifier: 'default', format: { type: 'image/png' } }] },
    evalscript: TRUE_COLOR_EVALSCRIPT,
  };
}

/** „5. 10." z dátumu scény. Pure. */
export const satDay = (iso) => { const d = new Date(iso); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`; };
