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

test('vite.config.js: noIndexPlugin je prvý plugin, dáva X-Robots-Tag na každú odpoveď a /robots.txt zakazuje všetko; tunel oko.uhrin.digital je povolený hostiteľ, bind ostáva localhost', () => {
  const vite = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(vite, /function noIndexPlugin\(\)/);
  assert.match(vite, /plugins: \[\n\s+noIndexPlugin\(\),/, 'prvý v zozname, aby hlavička sadla pred proxy odpoveďami');
  assert.match(vite, /res\.setHeader\('X-Robots-Tag', 'noindex, nofollow, noarchive'\)/);
  assert.match(vite, /const ROBOTS_TXT = 'User-agent: \*\\nDisallow: \/\\n';/);
  assert.match(vite, /configurePreviewServer\(server\) \{ install\(server\.middlewares\); \},\n\s+\};\n\}\n\nfunction flightHistoryProxy/, 'platí pre dev aj preview server');
  assert.match(vite, /: \['localhost', '127\.0\.0\.1', '\.local', '\.uhrin\.digital'\],/, 'allowedHosts len s tunelovou doménou navyše');
  assert.match(vite, /host: env\.HOST \|\| 'localhost',/, 'bind zostáva localhost — tunel forwarduje lokálne');
});
