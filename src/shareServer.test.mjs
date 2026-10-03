// src/shareServer.test.mjs
// Tripwires zdieľania s náhľadom (2026-09-14): plugin je zaregistrovaný,
// obsluhuje POST /api/share a GET /s/<id>(.jpg), tunel smeruje /s/ na dev
// server, oba robots.txt povoľujú /s/, ingress publikačného skriptu sedí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('vite.config.js: sharePlugin za keep-alive pluginom, routes /api/share (POST, limit na IP) a /s/<id>(.jpg), úložisko v .gev-cache/share', () => {
  const vite = read('../vite.config.js');
  assert.match(vite, /function sharePlugin\(\)/);
  // 2026-10-01: API pluginy sú v podmienke roly (scripts/lib/serverRole.mjs) — poradie ostáva.
  assert.match(vite, /originKeepAlivePlugin\(\),\n[\s\S]{0,400}?sharePlugin\(\), flightHistoryProxy\(\),/, 'poradie pluginov');
  assert.match(vite, /middlewares\.use\('\/api\/share', async \(req, res\) => \{\n\s+if \(req\.method !== 'POST'\)/);
  assert.match(vite, /makeRateLimiter\(\{ windowMs: 3600_000, max: 30, globalMax: 300 \}\)/, 'limit 30/h na IP, 300/h celkovo');
  assert.match(vite, /limiter\(clientKeyFromRequest\(req\)\)/, 'kľúč cez CF-Connecting-IP (tunel), nie socket');
  assert.match(vite, /readRequestBodyCapped\(req, SHARE_BODY_MAX_BYTES\)/);
  assert.match(vite, /validateSharePayload\(body\)/);
  assert.match(vite, /middlewares\.use\('\/s', \(req, res, next\) => \{/);
  assert.match(vite, /\/\^\\\/\(\[A-Za-z0-9\]\{6,32\}\)\(\\\.jpg\)\?\$\//, 'id + voliteľná prípona .jpg');
  assert.match(vite, /'public, max-age=31536000, immutable'/, 'obrázok je nemenný');
  assert.match(vite, /createShareStore\(\{ dir: path\.join\(process\.cwd\(\), '\.gev-cache', 'share'\) \}\)/);
});

test('tunel: /s/ ide na dev server; robots.txt (statický aj dev server) púšťa crawlery na stránky, nie na /api/; koreň má predvolené OG značky', () => {
  const publish = read('../scripts/oko-publish.ps1');
  assert.match(publish, /path: \^\/\(api\|s\)\(\/\.\*\)\?\$/, 'ingress: api aj s na dev server');
  const staticServer = read('../scripts/oko-static-server.mjs');
  assert.match(staticServer, /const ROBOTS_TXT = 'User-agent: \*\\nDisallow: \/api\/\\nAllow: \/\\n\\nSitemap: https:\/\/okolive\.sk\/sitemap\.xml\\n';/);
  const html = read('../index.html');
  assert.match(html, /<meta property="og:image" content="https:\/\/okolive\.sk\/share-default\.jpg" \/>/, 'koreň má predvolený OG obrázok (dlhý odkaz / koreň zdieľaný priamo); hlavná adresa od 2026-09-29 okolive.sk');
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large" \/>/, 'koreň sa od 2026-09-30 indexuje; snímky /s/ majú noindex vo vlastnom <meta>');
});
