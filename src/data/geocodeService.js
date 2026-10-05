// src/data/geocodeService.js
/**
 * @module geocodeService
 * @description GET /api/geocode?q=&lat=&lon= — bezplatné hľadanie miesta cez OpenStreetMap Nominatim
 * (2026-10-05). Google Geocoding API nie je v projekte zapnuté (REQUEST_DENIED), takže lupa „miesto",
 * riadok palety „Hľadať na mape" aj hlas „choď do Košíc" nenašli nič. Nominatim: ODbL, bez kľúča,
 * pravidlá použitia = najviac 1 dopyt za sekundu, identifikujúci User-Agent, výsledky cachovať —
 * preto ide cez server so spoločnou frontou (tú istú používa reverzné geokódovanie kokpitu) a cache 24 h.
 * Odpoveď má tvar výsledku Google Geocoding, aby searchAndFlyTo rámovalo miesto rovnako.
 */
export const GEOCODE_PATH = '/api/geocode';
const UPSTREAM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'OKO-okolive.sk/1.0 (+https://okolive.sk)';

/** Typ výsledku Nominatimu → typy v štýle Google (pre geocodeNavigationMode). Pure. */
export function googleTypesFor(hit) {
  const cls = String(hit?.class || hit?.category || '');
  const type = String(hit?.type || '');
  const address = String(hit?.addresstype || '');
  if (address === 'country' || type === 'country') return ['country', 'political'];
  if (address === 'state' || type === 'state' || address === 'region') return ['administrative_area_level_1', 'political'];
  if (address === 'county' || type === 'county') return ['administrative_area_level_2', 'political'];
  if (['city', 'town', 'village', 'municipality', 'hamlet'].includes(address) || ['city', 'town', 'village', 'hamlet'].includes(type)) return ['locality', 'political'];
  if (['suburb', 'quarter', 'neighbourhood', 'city_district', 'borough'].includes(address) || ['suburb', 'quarter', 'neighbourhood'].includes(type)) return ['sublocality', 'political'];
  if (cls === 'highway') return ['route'];
  if (cls === 'aeroway' && type === 'aerodrome') return ['airport', 'establishment'];
  if (cls === 'natural' || cls === 'waterway' || ['peak', 'mountain_range', 'water', 'bay', 'strait', 'sea'].includes(type)) return ['natural_feature'];
  if (cls === 'leisure' && type === 'park') return ['park'];
  if (cls === 'boundary') return ['administrative_area_level_2', 'political'];
  return ['establishment', 'point_of_interest'];
}

/** Jeden výsledok Nominatimu → výsledok v tvare Google Geocoding (null pri zlom). Pure. */
export function toGoogleResult(hit) {
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const box = Array.isArray(hit?.boundingbox) ? hit.boundingbox.map(Number) : [];
  const viewport = box.length === 4 && box.every(Number.isFinite)
    ? { southwest: { lat: box[0], lng: box[2] }, northeast: { lat: box[1], lng: box[3] } }
    : null;
  return {
    formatted_address: String(hit?.display_name || '').split(',').slice(0, 3).join(',').trim() || null,
    geometry: { location: { lat, lng }, ...(viewport ? { viewport } : {}) },
    types: googleTypesFor(hit),
    source: 'nominatim',
  };
}

/**
 * Tvary slovenského miestneho mena v páde → odhady 1. pádu („Košíc" → „Košice", „Bratislavu" →
 * „Bratislava", „Žiliny" → „Žilina"). Prvý je vždy pôvodný tvar. Pure.
 */
export function nominativeGuesses(query) {
  const q = String(query ?? '').trim();
  const out = [q];
  const add = value => { if (value && value !== q && !out.includes(value)) out.push(value); };
  if (/\d/.test(q) || q.includes(' ')) return out.filter(Boolean);
  add(q.replace(/íc$/u, 'ice').replace(/ic$/u, 'ice'));
  add(q.replace(/u$/u, 'a'));
  add(q.replace(/y$/u, 'a'));
  add(q.replace(/(ou|e|i)$/u, 'a'));
  return out.filter(Boolean).slice(0, 3);
}

/**
 * @param {object} [o]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {(task: () => Promise<any>) => Promise<any>} [o.schedule] spoločná fronta Nominatimu (≥ 1,1 s odstup)
 */
export function createGeocodeService({ fetchImpl = globalThis.fetch, schedule = task => task(), now = Date.now,
  cacheMs = 24 * 3600_000, perIpPerMin = 20 } = {}) {
  const cache = new Map(); // kľúč → { at, result }
  const limiter = new Map();

  async function lookup(query, { lat = null, lon = null, lang = 'sk' } = {}) {
    const q = String(query ?? '').trim().slice(0, 120);
    if (q.length < 2) return null;
    const key = `${lang}|${q.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < cacheMs) return hit.result;
    const result = await schedule(async () => {
      const params = new URLSearchParams({ q, format: 'jsonv2', limit: '1', addressdetails: '0', 'accept-language': `${lang},en` });
      // Mierne zvýhodniť okolie kamery (viewbox bez bounded = len preferencia, nie filter).
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        params.set('viewbox', [lon - 5, lat + 5, lon + 5, lat - 5].map(v => v.toFixed(3)).join(','));
      }
      const res = await fetchImpl(`${UPSTREAM}?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw Object.assign(new Error(`nominatim ${res.status}`), { status: res.status });
      const list = await res.json();
      return Array.isArray(list) && list.length ? toGoogleResult(list[0]) : null;
    });
    cache.set(key, { at: now(), result });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return result;
  }

  function allow(ip) {
    const minute = Math.floor(now() / 60_000);
    const entry = limiter.get(ip);
    if (!entry || entry.minute !== minute) { if (limiter.size > 5000) limiter.clear(); limiter.set(ip, { minute, n: 1 }); return true; }
    return ++entry.n <= perIpPerMin;
  }

  async function middleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== GEOCODE_PATH) return next();
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    const q = String(url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 120) return send(400, { error: 'invalid_query' });
    const ip = String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown');
    if (!allow(ip)) return send(429, { error: 'rate_limited' });
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'sk';
    try {
      const result = await lookup(q, { lat: Math.abs(lat) <= 90 ? lat : null, lon: Math.abs(lon) <= 180 ? lon : null, lang });
      return send(200, { status: result ? 'OK' : 'ZERO_RESULTS', results: result ? [result] : [], source: 'nominatim' });
    } catch (error) {
      return send(502, { status: 'UNAVAILABLE', results: [], error: error?.status === 429 ? 'upstream_rate_limited' : 'upstream' });
    }
  }

  return { lookup, middleware, _cacheForTest: cache };
}
