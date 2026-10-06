// OKO — tiny static server for the production build behind the public tunnel
// (2026-09-14, user: „veľmi pomaly to načíta"). Serves ./dist on
// 127.0.0.1:4174 only; cloudflared routes `/api/*` to the dev server (4173)
// so the live feeds run in ONE process, and everything else here.
//
// Why not `vite preview`: half of the proxy plugins have no preview hook, and
// a second full server would double the AISStream / OpenSky / SQLite work.
// Why not the dev server: hundreds of unbundled modules over the tunnel.
//
// Behaviour: hashed assets under /assets/ are immutable for a year (Cloudflare
// caches them at the edge), index.html is always revalidated. Since 2026-09-30 the
// site is indexed: X-Robots-Tag noindex only on pages that do not belong in search
// results (robotsTagFor) and on non-content answers (404, 301, robots.txt), and
// /robots.txt points to the sitemap. No dependencies, no directory listing, no
// path traversal (resolved paths must stay inside dist).
//
// Cache (2026-09-28, meranie štartu — Cesium 3,5 MB a modely lietadiel 2,1 MB sa
// sťahovali každú návštevu znova, Cloudflare dával 4 h): URL s `?v=` (Cesium.js,
// widgets.css, preloaderFlow.js — verzia alebo odtlačok obsahu z index.html) je
// nemenná rok; /cesium/ (workery, textúry) a /models/ (GLB) 7 dní s ETag
// revalidáciou (304). Po upgrade Cesia dostane Cesium.js novú verziu v URL hneď,
// workery sa dorevalidujú do 7 dní — upgrade rob s vedomím, že týždeň môže mať
// vracajúci sa návštevník starý worker (nemenné 1 rok by bolo horšie).
//
// Presmerovanie hostiteľa (2026-09-28, doména okolive.sk): `--redirect
// www.okolive.sk=https://okolive.sk` (opakovateľné) pošle KAŽDÚ požiadavku na
// daného hostiteľa trvalo (301, cache 1 h, aby sa to dalo vrátiť) na pôvod
// s rovnakou cestou a query. Tunel smeruje presmerované hostiteľa celé sem
// (aj /api), cieľ je pevný z konfigurácie — z požiadavky ide len cesta.
//
// Usage: node scripts/oko-static-server.mjs [--port 4174] [--dir dist] [--redirect host=https://origin …]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(flag('--port', process.env.OKO_STATIC_PORT || 4174));
const DIR = path.resolve(process.cwd(), flag('--dir', 'dist'));
const HOST = '127.0.0.1';

/**
 * `host=origin` dvojice z `--redirect` → Map hostiteľ → pôvod (pure). Pôvod musí byť
 * presne https://hostiteľ (bez cesty); zlá dvojica sa preskočí s varovaním.
 * @param {string[]} argv
 * @returns {Map<string, string>}
 */
export function parseRedirects(argv) {
  const map = new Map();
  argv.forEach((arg, i) => {
    if (arg !== '--redirect' || !argv[i + 1]) return;
    const [host, origin] = String(argv[i + 1]).split('=');
    let ok = false;
    try { const u = new URL(origin); ok = u.protocol === 'https:' && u.origin === origin && /^[a-z0-9.-]+$/i.test(host || ''); } catch { ok = false; }
    if (ok) map.set(host.toLowerCase(), origin);
    else console.warn(`[oko-static] ignoring bad --redirect ${argv[i + 1]} (expected host=https://origin)`);
  });
  return map;
}

/**
 * Cieľ presmerovania pre hostiteľa požiadavky, inak null (pure): pevný pôvod + cesta
 * a query požiadavky; port v Host sa ignoruje.
 * @param {string|undefined} hostHeader
 * @param {string|undefined} url surové req.url
 * @param {Map<string, string>} redirects
 */
export function hostRedirect(hostHeader, url, redirects) {
  const host = String(hostHeader || '').toLowerCase().replace(/:\d+$/, '');
  const origin = redirects.get(host);
  if (!origin) return null;
  const rest = String(url || '/').split('#')[0];
  return origin + (rest.startsWith('/') ? rest : '/');
}

/**
 * Návšteva cez Cloudflare po http:// → trvalo na https:// s tou istou cestou a query, inak null
 * (pure). Zóna uhrin.digital nemá „Always Use HTTPS" a nová zóna môže mať predvolené čokoľvek;
 * po http Google kľúč (referrer https://…) aj bezpečný kontext prehliadača zlyhajú (2026-09-29,
 * presun na okolive.sk). Bez hlavičiek Cloudflare (priamy prístup na 127.0.0.1) nič.
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {string|undefined} url surové req.url
 */
export function httpsUpgrade(headers, url) {
  const visitor = String(headers?.['cf-visitor'] || '');
  const proto = String(headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (!/"scheme"\s*:\s*"http"/.test(visitor) && proto !== 'http') return null;
  const host = String(headers?.host || '').toLowerCase().replace(/:\d+$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  const rest = String(url || '/').split('#')[0];
  return `https://${host}${rest.startsWith('/') ? rest : '/'}`;
}

const REDIRECTS = parseRedirects(args);
// robots.txt (2026-09-14, zdieľanie na siete): crawlery smú čítať stránky
// (koreň s predvolenými OG značkami, /s/<id> cez ingress tunela), /api/ nie.
// 2026-09-30 (vlastník: „podmienka noindex už neplatí"): koreň sa indexuje, robots.txt
// ukazuje na sitemap; noindex ostáva len na stránkach, ktoré do výsledkov nepatria
// (robotsTagFor), a na /s/<id> v <meta> (renderSharePage).
const ROBOTS_TXT = 'User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: https://okolive.sk/sitemap.xml\n';

/**
 * X-Robots-Tag pre súbor z buildu, alebo null (pure): účet a overovací súbor Search
 * Console do výsledkov nepatria; všetko ostatné sa indexuje podľa <meta> stránky.
 * Živý rámček `/?embed=1` (2026-10-06, src/embedMode.js) je tá istá appka bez ovládania
 * vložená na stránke odkazu alebo na cudzom webe — do výsledkov patrí koreň, nie rámček.
 * @param {string} pathname
 * @param {string} [search] query adresy (`?embed=1`)
 */
export function robotsTagFor(pathname, search = '') {
  if (pathname === '/account.html') return 'noindex, nofollow, noarchive';
  if (/^\/google[0-9a-f]{8,}\.html$/.test(pathname)) return 'noindex';
  if ((pathname === '/index.html' || pathname === '/' || pathname === '') && new URLSearchParams(String(search || '')).get('embed') === '1') return 'noindex';
  return null;
}
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.map': 'application/json',
  '.bin': 'application/octet-stream', '.terrain': 'application/vnd.quantized-mesh', '.czml': 'application/json', '.kml': 'application/vnd.google-earth.kml+xml',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pbf': 'application/x-protobuf', '.hdf': 'application/x-hdf',
};

/**
 * Cache-Control podľa cesty (pure): hashované assety a URL s `?v=` nemenné rok; HTML
 * vždy overiť; /cesium/ a /models/ 7 dní (ETag → 304); ostatné hodina.
 * @param {string} pathname dekódovaná cesta bez query
 * @param {string} ext prípona malými písmenami
 * @param {string} url surové req.url (kvôli query)
 */
export function cacheControlFor(pathname, ext, url) {
  if (ext === '.html') return 'no-cache';
  if (pathname.startsWith('/assets/') || /[?&]v=[^&]+/.test(url)) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/cesium/') || pathname.startsWith('/models/')) return 'public, max-age=604800';
  return 'public, max-age=3600';
}

function send(res, status, headers, body) {
  res.writeHead(status, { 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const redirect = hostRedirect(req.headers.host, req.url, REDIRECTS) || httpsUpgrade(req.headers, req.url);
  if (redirect) { send(res, 301, { Location: redirect, 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain; charset=utf-8' }, `Moved to ${redirect}`); return; }
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') { send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed'); return; }
  let pathname = '/';
  let search = '';
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    pathname = decodeURIComponent(parsed.pathname);
    search = parsed.search;
  } catch { send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad Request'); return; }
  if (pathname === '/robots.txt') { send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, ROBOTS_TXT); return; }
  if (pathname.startsWith('/api/')) { send(res, 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify({ error: 'api_not_routed', detail: 'cloudflared must route /api/* to the dev server' })); return; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // Obsahové stránky (2026-09-30, SEO): /sk/<téma>/ → index.html v priečinku.
  else if (pathname.endsWith('/')) pathname += 'index.html';
  const target = path.resolve(DIR, `.${pathname}`);
  if (!target.startsWith(DIR + path.sep) && target !== DIR) { send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden'); return; }
  fs.stat(target, (error, stat) => {
    if (!error && stat.isDirectory()) {
      // /sk/tema → /sk/tema/ (jedna kanonická adresa; relatívne odkazy v stránke sedia).
      const query = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
      send(res, 301, { Location: `${encodeURI(pathname)}/${query}`, 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/plain; charset=utf-8' }, 'Moved');
      return;
    }
    if (error || !stat.isFile()) {
      // Unknown path: the app is a single page; anything else is a 404 (no SPA
      // fallback needed — OKO has one route).
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'Not Found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      ETag: etag,
      'Cache-Control': cacheControlFor(pathname, ext, req.url || ''),
      ...(pathname === '/account.html' || pathname === '/admin.html' ? {
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'",
      } : {}),
    };
    if (req.headers['if-none-match'] === etag) { send(res, 304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }, ''); return; }
    const robotsTag = robotsTagFor(pathname, search);
    res.writeHead(200, { ...(robotsTag ? { 'X-Robots-Tag': robotsTag } : {}), ...headers });
    if (method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(target);
    stream.on('error', () => { try { res.destroy(); } catch { /* closed */ } });
    stream.pipe(res);
  });
});

// Origin za cloudflared drží nečinné keep-alive spojenie dlhšie než pool
// tunela (90 s), inak ho Node zatvorí presne keď naň prichádza nová požiadavka
// a Cloudflare vráti 502 (2026-09-14; to isté robí originKeepAlivePlugin
// vo vite.config.js pre dev server).
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.listen(PORT, HOST, () => {
  const moved = [...REDIRECTS].map(([host, origin]) => `${host} -> ${origin}`).join(', ');
  console.log(`[oko-static] serving ${DIR} on http://${HOST}:${PORT}/ (/api/* is the dev server's job)${moved ? `; 301 ${moved}` : ''}`);
});
