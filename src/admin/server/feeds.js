// Admin panel OKO (2026-10-03) — register dátových zdrojov pre admin.
//
// Mapuje URL proxy na feed (štatistiky, vypínače, náklady). Kód proxy vo
// vite.config.js sa nemení: všetko sa deje v middleware pred nimi.
//
// `status`  — existujúci /status alebo /health endpoint (stav + história)
// `sample`  — či ho smie pravidelne vzorkovať plánovač; FIRMS /status a plyn
//             volajú upstream, preto len na požiadanie z panelu
// `paid`    — každá požiadavka = platené volanie (OpenAI, Google) → počítadlo
//             nákladov a admin môže nastaviť denný strop
// `quota`   — feed s kvótou providera; náklad sa číta z jeho /status
// `toggle`  — admin ho smie vypnúť (systémové cesty nie)

export const FEEDS = Object.freeze([
  { id: 'openai-voice', label: 'OpenAI hlas (Realtime)', prefixes: ['/api/realtime/token'], paid: { unit: 'relácií' }, toggle: true },
  { id: 'openai-summary', label: 'OpenAI súhrn scény', prefixes: ['/api/openai'], paid: { unit: 'súhrnov' }, toggle: true },
  { id: 'google-places', label: 'Google Places', prefixes: ['/api/google'], paid: { unit: 'dopytov' }, toggle: true },
  { id: 'tomtom', label: 'TomTom doprava', prefixes: ['/api/tomtom'], status: '/api/tomtom/status', sample: true, quota: true, toggle: true },
  { id: 'gfw', label: 'Global Fishing Watch', prefixes: ['/api/gfw'], status: '/api/gfw/status', sample: true, quota: true, toggle: true },
  { id: 'firms', label: 'NASA FIRMS požiare', prefixes: ['/api/firms'], status: '/api/firms/status', toggle: true },
  { id: 'opensky', label: 'OpenSky lietadlá', prefixes: ['/api/opensky', '/api/opensky-track'], toggle: true },
  { id: 'adsb', label: 'ADS-B (adsb.lol, adsbdb)', prefixes: ['/api/adsblol', '/api/adsbdb'], toggle: true },
  { id: 'history', label: 'Archív letov', prefixes: ['/api/history'], status: '/api/history/status', sample: true, toggle: true },
  { id: 'acars', label: 'ACARS', prefixes: ['/api/acars'], status: '/api/acars/status', sample: true, toggle: true },
  { id: 'ais', label: 'Lode (AIS)', prefixes: ['/api/ais-live', '/api/aiscast'], toggle: true },
  { id: 'satellites', label: 'Satelity (CelesTrak)', prefixes: ['/api/celestrak'], toggle: true },
  { id: 'launches', label: 'Štarty rakiet', prefixes: ['/api/launches'], toggle: true },
  { id: 'earthquakes', label: 'Zemetrasenia', prefixes: ['/api/earthquakes'], toggle: true },
  { id: 'meteo', label: 'Meteo, METAR, počasie', prefixes: ['/api/meteo', '/api/metar', '/api/weather-effects'], status: '/api/meteo/status', sample: true, toggle: true },
  { id: 'shmu', label: 'SHMÚ radar', prefixes: ['/api/shmu'], toggle: true },
  { id: 'terrain', label: 'Terén a reliéf', prefixes: ['/api/sk-terrain', '/api/terrain', '/api/relief'], status: '/api/sk-terrain/status', sample: true, toggle: true },
  { id: 'cctv', label: 'CCTV kamery', prefixes: ['/api/cctv'], status: '/api/cctv/health', sample: true, toggle: true },
  { id: 'gas', label: 'Plyn (ACER / GIE)', prefixes: ['/api/gas'], status: '/api/gas/status', toggle: true },
  { id: 'oil', label: 'Ropa', prefixes: ['/api/oil'], toggle: true },
  { id: 'conflicts', label: 'Konflikty a situácia', prefixes: ['/api/ukraine', '/api/mideast', '/api/military-installations', '/api/situation-news', '/api/regional-brief'], toggle: true },
  { id: 'osm', label: 'OSM Overpass a trasy', prefixes: ['/api/overpass', '/api/route'], toggle: true },
  { id: 'radio', label: 'Rádiá', prefixes: ['/api/radio'], toggle: true },
  { id: 'youtube', label: 'YouTube live', prefixes: ['/api/youtube-live'], toggle: true },
  { id: 'bikeshare', label: 'Zdieľané bicykle', prefixes: ['/api/gbfs'], toggle: true },
  { id: 'translate', label: 'Preklad', prefixes: ['/api/translate'], toggle: true },
  { id: 'media', label: 'Obrázky a logá', prefixes: ['/api/img', '/api/link-image', '/api/logo'], toggle: true },
  // Systémové cesty: len štatistika, vypnúť ich z panelu nejde.
  { id: 'share', label: 'Zdieľanie', prefixes: ['/api/share', '/s'] },
  { id: 'accounts', label: 'Účty', prefixes: ['/api/auth', '/api/account'] },
  { id: 'admin', label: 'Admin', prefixes: ['/api/admin'] },
  { id: 'telemetry', label: 'Telemetria a oznam', prefixes: ['/api/telemetry', '/api/notice'] },
  { id: 'debug', label: 'Realtime debug log', prefixes: ['/api/realtime/debug-log'] },
]);

const BY_ID = new Map(FEEDS.map(feed => [feed.id, feed]));
// Najdlhší prefix vyhráva (/api/realtime/debug-log pred /api/realtime/...).
const PREFIXES = FEEDS.flatMap(feed => feed.prefixes.map(prefix => [prefix, feed])).sort((a, b) => b[0].length - a[0].length);

export const feedById = id => BY_ID.get(id) || null;

/** Feed pre cestu po segmentoch (`/api/gas` sedí na `/api/gas/x`, nie `/api/gasx`). */
export function feedForPath(pathname) {
  for (const [prefix, feed] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return feed;
  }
  return null;
}

/**
 * Kľúč štatistiky: id feedu, inak pevná skupina. Nikdy surová cesta — inak by
 * náhodné URL od botov nafúkli tabuľku.
 */
export function routeKey(pathname) {
  const feed = feedForPath(pathname);
  if (feed) return feed.id;
  if (pathname === '/api' || pathname.startsWith('/api/')) return 'api-other';
  return null;
}

/** Status/health endpoint feedu sa nikdy neblokuje — admin musí vidieť stav aj vypnutého. */
export const isStatusPath = pathname => /\/(status|health)$/.test(pathname);
