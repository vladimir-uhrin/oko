// src/data/aishubVesselsCore.js
// Čisté pomôcky pre AISHub (oneskorený druhý zdroj lodí cez aiscast /
// openwaters.io), 2026-09-15. Zdieľa ich proxy vo vite.config.js aj klient
// src/data/aishubVessels.js — parser bboxu so stropom plochy, preklad na
// poradie, aké chce aiscast, a normalizácia jedného GeoJSON feature na riadok
// v tvare, aký kreslí vrstva živých lodí (mmsi, lat, lon, sog, cog, type, …).
//
// Poradie bboxu: appka interne používa `west,south,east,north` (ako
// gfwViewBbox); aiscast `/v1/vessels?bbox=` chce `south,west,north,east`
// (lat,lon) — overené naživo 2026-09-15. Preto proxy prijme prvé a preloží
// na druhé.

/** Strop plochy dopytu (štvorcové stupne). aiscast anonym odmieta > ~100 sq°
 *  („400 bbox not allowed for this key"); držíme sa pod ním. */
export const AISHUB_MAX_AREA_SQ_DEG = 90;

/** aiscast čítanie je bez tokenu; poctivá identita klienta pri dopyte. */
export const AISHUB_USER_AGENT = 'OKO/1.0 (+https://okolive.sk; non-commercial)';

/**
 * `"w,s,e,n"` → `{west,south,east,north}` alebo `null`. Pure.
 * @param {string|null|undefined} raw
 * @returns {{west:number,south:number,east:number,north:number}|null}
 */
export function parseAishubBbox(raw) {
  const parts = String(raw ?? '').split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [west, south, east, north] = parts;
  return { west, south, east, north };
}

/**
 * Prečo je bbox neplatný (rozsah, poradie, priveľká plocha), alebo `null` keď
 * je v poriadku. Pure.
 * @param {{west:number,south:number,east:number,north:number}|null} bbox
 * @param {number} [maxAreaSqDeg]
 * @returns {string|null}
 */
export function aishubBboxError(bbox, maxAreaSqDeg = AISHUB_MAX_AREA_SQ_DEG) {
  if (!bbox) return 'bbox needs four numbers: west,south,east,north';
  const { west, south, east, north } = bbox;
  if (west < -180 || east > 180 || south < -90 || north > 90) return 'bbox out of range';
  if (!(west < east) || !(south < north)) return 'bbox must be west<east and south<north';
  const area = (east - west) * (north - south);
  if (area > maxAreaSqDeg) return `bbox area ${area.toFixed(1)} sq° exceeds the ${maxAreaSqDeg} sq° limit — zoom in`;
  return null;
}

/**
 * `{west,south,east,north}` → reťazec `south,west,north,east` pre aiscast. Pure.
 * @param {{west:number,south:number,east:number,north:number}} bbox
 * @returns {string}
 */
export function aishubUpstreamBbox(bbox) {
  return `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * GeoJSON feature z `/v1/vessels` → riadok vrstvy, alebo `null` bez MMSI /
 * platnej polohy. `observedAt` je epocha ms z ISO `seen`. Pure.
 *
 * Polia (namerané 2026-09-15): geometry.coordinates `[lon,lat]`; properties
 * `mmsi, sog, cog, heading, nav_status, seen, source, station` a keď bol
 * videný statický záznam aj `name, ship_type|type, callsign, destination`.
 * @param {object} feature
 * @returns {object|null}
 */
export function normalizeAishubFeature(feature) {
  const p = feature?.properties;
  if (!p) return null;
  const mmsi = String(p.mmsi ?? '').trim();
  if (!/^\d{7,9}$/.test(mmsi)) return null;
  const coords = feature?.geometry?.coordinates;
  const lon = num(Array.isArray(coords) ? coords[0] : p.lon ?? p.longitude);
  const lat = num(Array.isArray(coords) ? coords[1] : p.lat ?? p.latitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const seenMs = (() => { const t = Date.parse(String(p.seen ?? p.timestamp ?? '')); return Number.isFinite(t) ? t : null; })();
  const rawType = p.ship_type ?? p.type ?? p.shiptype;
  return {
    mmsi,
    lat,
    lon,
    sog: num(p.sog),
    cog: num(p.cog),
    heading: num(p.heading),
    navStatus: num(p.nav_status),
    name: String(p.name ?? '').trim() || null,
    // Typ držíme ako reťazec (číselný AIS kód alebo textová trieda) — vrstva ho
    // podáva do vesselTypeCss/normalizeVesselType rovnako ako pri živých lodiach.
    type: rawType === null || rawType === undefined || rawType === '' ? null : String(rawType),
    callsign: String(p.callsign ?? '').trim() || null,
    destination: String(p.destination ?? '').trim() || null,
    source: String(p.source ?? p.station ?? 'aishub').trim().toLowerCase(),
    observedAt: seenMs,
  };
}

/**
 * Normalizuj celú kolekciu `/v1/vessels` na riadky + atribúciu po zdrojoch. Pure.
 * @param {object} json GeoJSON FeatureCollection
 * @returns {{ rows: object[], attribution: Record<string,string>, counts: Record<string,number> }}
 */
export function normalizeAishubCollection(json) {
  const features = Array.isArray(json?.features) ? json.features : [];
  const rows = [];
  const counts = {};
  for (const feature of features) {
    const row = normalizeAishubFeature(feature);
    if (!row) continue;
    rows.push(row);
    counts[row.source] = (counts[row.source] || 0) + 1;
  }
  const attribution = json && typeof json.attribution === 'object' && json.attribution ? json.attribution : {};
  return { rows, attribution, counts };
}
