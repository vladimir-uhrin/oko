// src/staticServer.test.mjs
// Statický server pre produkčný build za verejným tunelom (2026-09-14):
// spustí scripts/oko-static-server.mjs nad dočasným „dist", overí index
// (no-cache; od 2026-09-30 indexovateľný), účet noindex, nemenné assety
// (immutable + ETag/304), robots.txt so sitemap, 404, zákaz path traversal,
// /api → 502 (patrí dev serveru), HEAD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

const SCRIPT = new URL('../scripts/oko-static-server.mjs', import.meta.url);

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(url); if (r.status) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

test('oko-static-server: index no-cache a indexovateľný, účet noindex, assets immutable + ETag/304, robots + sitemap, 404, traversal, /api = 502, HEAD', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'oko-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OKO</title><script type="module" src="/assets/index-abc.js"></script>');
  writeFileSync(path.join(dist, 'account.html'), '<!doctype html><title>Účet</title>');
  writeFileSync(path.join(dist, 'google5f66f1e4a10096a1.html'), 'google-site-verification: google5f66f1e4a10096a1.html');
  writeFileSync(path.join(dist, 'sitemap.xml'), '<?xml version="1.0"?><urlset/>');
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log("oko")');
  writeFileSync(path.join(dist, 'logo.svg'), '<svg></svg>');
  mkdirSync(path.join(dist, 'cesium', 'Workers'), { recursive: true });
  writeFileSync(path.join(dist, 'cesium', 'Cesium.js'), 'window.Cesium = {}');
  writeFileSync(path.join(dist, 'cesium', 'Workers', 'w.js'), 'self.onmessage = () => {}');
  mkdirSync(path.join(dist, 'models'));
  writeFileSync(path.join(dist, 'models', 'c172.glb'), 'glTF');
  const port = await freePort();
  const child = spawn(process.execPath, [SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--port', String(port), '--dir', dist], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/robots.txt`);
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(index.headers.get('cache-control'), 'no-cache', 'index sa vždy overuje — nový build musí byť vidieť hneď');
    assert.equal(index.headers.get('x-robots-tag'), null, 'od 2026-09-30 sa koreň indexuje (rozhoduje <meta> stránky)');
    assert.match(await index.text(), /assets\/index-abc\.js/);
    assert.equal((await fetch(base + '/account.html')).headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', 'účet do výsledkov nepatrí');
    const verification = await fetch(base + '/google5f66f1e4a10096a1.html');
    assert.equal(verification.status, 200);
    assert.equal(verification.headers.get('x-robots-tag'), 'noindex', 'overovací súbor Search Console do výsledkov nepatrí');
    const sitemap = await fetch(base + '/sitemap.xml');
    assert.equal(sitemap.headers.get('content-type'), 'application/xml');
    assert.equal(sitemap.headers.get('x-robots-tag'), null);
    const asset = await fetch(base + '/assets/index-abc.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'hashované assety sú nemenné → Cloudflare ich drží na hrane');
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    const etag = asset.headers.get('etag');
    assert.ok(etag);
    const notModified = await fetch(base + '/assets/index-abc.js', { headers: { 'if-none-match': etag } });
    assert.equal(notModified.status, 304);
    const svg = await fetch(base + '/logo.svg');
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.equal(svg.headers.get('cache-control'), 'public, max-age=3600');
    // 2026-09-28 (štart): Cesium a modely sa sťahovali každú návštevu (Cloudflare 4 h).
    const cesiumVersioned = await fetch(base + '/cesium/Cesium.js?v=1.138.0');
    assert.equal(cesiumVersioned.status, 200);
    assert.equal(cesiumVersioned.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'URL s verziou je nemenná rok');
    assert.equal((await fetch(base + '/cesium/Workers/w.js')).headers.get('cache-control'), 'public, max-age=604800', 'workery bez verzie 7 dní + ETag');
    const glb = await fetch(base + '/models/c172.glb');
    assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(glb.headers.get('cache-control'), 'public, max-age=604800', 'modely lietadiel 7 dní');
    assert.equal((await fetch(base + '/index.html?v=9')).headers.get('cache-control'), 'no-cache', 'HTML sa overuje vždy, aj s query');
    const robots = await fetch(base + '/robots.txt');
    assert.equal(await robots.text(), 'User-agent: *\nDisallow: /api/\nAllow: /\n\nSitemap: https://okolive.sk/sitemap.xml\n', 'crawlery smú čítať stránky, nie /api/; od 2026-09-30 robots ukazuje na sitemap');
    assert.match(robots.headers.get('x-robots-tag'), /noindex/, 'sonda publikovania (oko-publish.ps1) čaká noindex na robots.txt');
    assert.equal((await fetch(base + '/nope.js')).status, 404);
    assert.equal((await fetch(base + '/assets/..%2F..%2Fpackage.json')).status, 403, 'zakódovaný traversal nevedie von z dist (Forbidden)');
    const api = await fetch(base + '/api/gas/status');
    assert.equal(api.status, 502);
    assert.equal((await api.json()).error, 'api_not_routed', '/api patrí dev serveru cez ingress cloudflared');
    const head = await fetch(base + '/assets/index-abc.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(readFileSync(path.join(dist, 'assets', 'index-abc.js')).length));
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally {
    child.kill();
  }
});

test('oko-static-server: keep-alive dlhšie než pool cloudflared (120 s), headersTimeout väčší (2026-09-14)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /server\.keepAliveTimeout = 120_000;\n\s*server\.headersTimeout = 125_000;/);
});

// Doména okolive.sk (2026-09-28): www → holá doména, trvalo (301), s cestou a query;
// zlá dvojica `--redirect` sa preskočí, iný hostiteľ dostane build ako doteraz.
function getWithHost(port, host, pathAndQuery, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathAndQuery, method: 'GET', headers: { ...extraHeaders, host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('oko-static-server: --redirect presmeruje celého hostiteľa (aj /api) na pevný pôvod s cestou a query', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'oko-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OKO</title>');
  const port = await freePort();
  const child = spawn(process.execPath, [SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--port', String(port), '--dir', dist,
    '--redirect', 'www.okolive.test=https://okolive.test', '--redirect', 'evil.test=https://okolive.test/phish', '--redirect', 'bad'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/robots.txt`);
    const moved = await getWithHost(port, 'www.okolive.test', '/?mideast=gaza#x');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.location, 'https://okolive.test/?mideast=gaza', 'cesta a query idú ďalej (fragment prehliadač neposiela)');
    assert.equal(moved.headers['cache-control'], 'public, max-age=3600', 'trvalé, ale vrátiteľné do hodiny');
    assert.equal((await getWithHost(port, 'WWW.OKOLIVE.TEST:443', '/api/situation-news?region=iran')).headers.location, 'https://okolive.test/api/situation-news?region=iran', 'veľkosť písmen a port v Host nerozhodujú, /api tiež');
    assert.equal((await getWithHost(port, 'www.okolive.test', '//evil.example/x')).headers.location, 'https://okolive.test//evil.example/x', 'cieľ je vždy pevný pôvod — z požiadavky len cesta');
    const plain = await getWithHost(port, 'okolive.test', '/');
    assert.equal(plain.status, 200, 'holá doména dostane build');
    assert.equal((await getWithHost(port, 'evil.test', '/')).status, 200, 'pôvod s cestou sa neprijme — žiadne presmerovanie');
  } finally {
    child.kill();
  }
});

// Presun na okolive.sk (2026-09-29, „chcel by som dnes premigrovať na druhú doménu" → „nič nebolo zdieľané
// ani publikované ani indexované"): jediná adresa je okolive.sk, stará oko.uhrin.digital sa nepublikuje vôbec
// (tunel na ňu odpovie 404), www presmeruje na holú doménu. Publikovanie presmerovanie zverejní až vtedy, keď
// cieľ naozaj obsluhuje tento build — sonda v oko-publish.ps1 číta /robots.txt cieľa. Obe strany sú tu.
test('presun domény: www vedie na okolive.sk, http na https; robots.txt hlavnej adresy spĺňa sondu publikovania', async () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'oko-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OKO</title>');
  const port = await freePort();
  const child = spawn(process.execPath, [SCRIPT.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--port', String(port), '--dir', dist,
    '--redirect', 'www.okolive.sk=https://okolive.sk'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/robots.txt`);
    const www = await getWithHost(port, 'www.okolive.sk', '/s/Ab12cd34EF');
    assert.equal(www.status, 301);
    assert.equal(www.headers.location, 'https://okolive.sk/s/Ab12cd34EF', 'www → holá doména s cestou');
    assert.equal((await getWithHost(port, 'www.okolive.sk', '/?front=lyman&win=7d')).headers.location, 'https://okolive.sk/?front=lyman&win=7d');
    // To, čo sonda publikovania vyžaduje od živého cieľa (200 + noindex + vlastné telo).
    const robots = await fetch(`${base}/robots.txt`, { headers: { host: 'okolive.sk' } });
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get('x-robots-tag'), /noindex/);
    assert.match(await robots.text(), /Disallow: \/api\//);
    // Návšteva po http:// cez Cloudflare → https (Google kľúč a bezpečný kontext chcú https).
    const viaHttp = await getWithHost(port, 'okolive.sk', '/?front=lyman', { 'cf-visitor': '{"scheme":"http"}' });
    assert.equal(viaHttp.status, 301);
    assert.equal(viaHttp.headers.location, 'https://okolive.sk/?front=lyman');
    assert.equal((await getWithHost(port, 'okolive.sk', '/robots.txt', { 'x-forwarded-proto': 'http' })).headers.location, 'https://okolive.sk/robots.txt');
    assert.equal((await getWithHost(port, 'www.okolive.sk', '/s/Ab12cd34EF', { 'cf-visitor': '{"scheme":"http"}' })).headers.location, 'https://okolive.sk/s/Ab12cd34EF', 'http://www ide rovno na https holej domény');
    assert.equal((await getWithHost(port, 'okolive.sk', '/', { 'cf-visitor': '{"scheme":"https"}', 'x-forwarded-proto': 'https' })).status, 200, 'https ostáva');
    assert.equal((await getWithHost(port, `127.0.0.1:${port}`, '/')).status, 200, 'priamy lokálny prístup bez hlavičiek Cloudflare sa nepresmeruje');
    assert.equal((await getWithHost(port, 'evil', '/', { 'cf-visitor': '{"scheme":"http"}' })).status, 200, 'hostiteľ bez domény sa nepresmeruje');
  } finally {
    child.kill();
  }
  const publish = readFileSync(new URL('../scripts/oko-publish.ps1', import.meta.url), 'utf8');
  assert.match(publish, /\[string\[\]\]\$Hostnames = @\('okolive\.sk'\),/, 'jediná adresa');
  assert.match(publish, /\[string\[\]\]\$Redirects = @\('www\.okolive\.sk=https:\/\/okolive\.sk'\),/, 'www → okolive.sk');
  assert.doesNotMatch(publish, /\$(Hostnames|Redirects) = @\([^)]*uhrin/, 'stará adresa sa nepublikuje (vlastník: nič nebolo zdieľané ani indexované)');
  const probe = publish.indexOf('Invoke-WebRequest -Uri "$target/robots.txt"');
  assert.ok(probe > 0, 'sonda cieľa presmerovania');
  assert.ok(probe < publish.indexOf('$redirectArgs ='), 'sonda beží pred registráciou statického servera aj pred prepisom ingressu');
  assert.match(publish, /-MaximumRedirection 0 -ErrorAction Stop/, 'presmerovaný alebo nedostupný cieľ nie je živý');
  assert.match(publish, /\$live = \(\$probe\.StatusCode -eq 200\) -and \(\[string\]\$robotsTag -match 'noindex'\) -and \(\[string\]\$probe\.Content -match 'Disallow: \/api\/'\)/);
  assert.match(publish, /if \(\$Hostnames -notcontains \$redirectHost\) \{ \$Hostnames \+= \$redirectHost \}/, 'neživý cieľ → zdroj obsluhuje appku ďalej');
  assert.match(publish, /\$Redirects = \$liveRedirects/);
});
