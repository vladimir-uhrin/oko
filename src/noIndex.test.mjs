// src/noIndex.test.mjs
// Verejný tunel (2026-09-13, „SEO noindex"): tripwires, aby OKO nikdy nešlo do
// indexov — meta robots v index.html, hlavička X-Robots-Tag + robots.txt
// v prvom plugine dev/preview servera, hostiteľ tunela v allowedHosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html: meta robots noindex, nofollow, noarchive', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/);
});

test('vite.config.js: noIndexPlugin je prvý plugin, dáva X-Robots-Tag na každú odpoveď a /robots.txt zakazuje všetko; tunelová doména okolive.sk je povolený hostiteľ, bind ostáva localhost', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function noIndexPlugin\(\)/);
  assert.match(vite, /plugins: \[\n\s+noIndexPlugin\(\),/, 'prvý v zozname, aby hlavička sadla pred proxy odpoveďami');
  assert.match(vite, /res\.setHeader\('X-Robots-Tag', 'noindex, nofollow, noarchive'\)/);
  assert.match(vite, /const ROBOTS_TXT = 'User-agent: \*\\nDisallow: \/api\/\\nAllow: \/\\n';/, 'crawlery smú čítať stránky pre náhľady sietí, nie /api/; neindexovanie drží noindex meta + hlavička (2026-09-14)');
  assert.match(vite, /if \(!\/\^\\\/s\\\/\[A-Za-z0-9\]\{6,32\}\(\\\.jpg\)\?\$\/\.test\(pathname\)\) \{\n\s+res\.setHeader\('X-Robots-Tag'/, 'hlavička noindex všade okrem /s/<id>');
  assert.match(vite, /configurePreviewServer\(server\) \{ install\(server\.middlewares\); \},\n\s+\};\n\}\n\nfunction flightHistoryProxy/, 'platí pre dev aj preview server');
  assert.match(vite, /: \['localhost', '127\.0\.0\.1', '\.local', '\.okolive\.sk'\],/, 'allowedHosts len s tunelovou doménou navyše (okolive.sk od 2026-09-28; oko.uhrin.digital vyradená 2026-09-29)');
  assert.match(vite, /host: env\.HOST \|\| 'localhost',/, 'bind zostáva localhost — tunel forwarduje lokálne');
});

test('vite.config.js: origin za tunelom drží keep-alive 120 s (headersTimeout 125 s), aby cloudflared nedostával RST → 502 (2026-09-14)', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function originKeepAlivePlugin\(\)/);
  assert.match(vite, /httpServer\.keepAliveTimeout = 120_000;\n\s+httpServer\.headersTimeout = 125_000;/, 'headersTimeout > keepAliveTimeout, inak Node nový limit ignoruje');
  assert.match(vite, /noIndexPlugin\(\),\n\s+originKeepAlivePlugin\(\),/, 'registrovaný hneď za noindex pluginom');
});
