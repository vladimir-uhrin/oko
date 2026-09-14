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
// caches them at the edge), index.html is always revalidated, every response
// carries X-Robots-Tag noindex and /robots.txt disallows everything (same as
// the dev server's noIndexPlugin). No dependencies, no directory listing, no
// path traversal (resolved paths must stay inside dist).
//
// Usage: node scripts/oko-static-server.mjs [--port 4174] [--dir dist]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const PORT = Number(flag('--port', process.env.OKO_STATIC_PORT || 4174));
const DIR = path.resolve(process.cwd(), flag('--dir', 'dist'));
const HOST = '127.0.0.1';
// `Allow: /s/` (2026-09-14): stránky zdieľania s náhľadom (dev server cez
// ingress tunela) smú crawlery sietí čítať; zvyšok ostáva zakázaný.
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\nAllow: /s/\n';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.map': 'application/json',
  '.bin': 'application/octet-stream', '.terrain': 'application/vnd.quantized-mesh', '.czml': 'application/json', '.kml': 'application/vnd.google-earth.kml+xml',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pbf': 'application/x-protobuf', '.hdf': 'application/x-hdf',
};

function send(res, status, headers, body) {
  res.writeHead(status, { 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') { send(res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed'); return; }
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); } catch { send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad Request'); return; }
  if (pathname === '/robots.txt') { send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, ROBOTS_TXT); return; }
  if (pathname.startsWith('/api/')) { send(res, 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify({ error: 'api_not_routed', detail: 'cloudflared must route /api/* to the dev server' })); return; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const target = path.resolve(DIR, `.${pathname}`);
  if (!target.startsWith(DIR + path.sep) && target !== DIR) { send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden'); return; }
  fs.stat(target, (error, stat) => {
    if (error || !stat.isFile()) {
      // Unknown path: the app is a single page; anything else is a 404 (no SPA
      // fallback needed — OKO has one route).
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'Not Found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';
    const immutable = pathname.startsWith('/assets/');
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': type,
      'Content-Length': String(stat.size),
      ETag: etag,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : (ext === '.html' ? 'no-cache' : 'public, max-age=3600'),
    };
    if (req.headers['if-none-match'] === etag) { send(res, 304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }, ''); return; }
    res.writeHead(200, { 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...headers });
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
  console.log(`[oko-static] serving ${DIR} on http://${HOST}:${PORT}/ (noindex; /api/* is the dev server's job)`);
});
