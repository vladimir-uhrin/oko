// src/shareCover.test.mjs — obrázok zdieľania samotnej domény okolive.sk (2026-09-29, vlastník:
// „kvalitný cover image pre zdieľanie samotnej domény", vybraný návrh B9). Tripwires: rozmer a veľkosť
// (WhatsApp nad 300 kB náhľad neukáže), značky Open Graph / X v index.html, texty a atribúcia
// Google · Cesium ion v skladacom skripte, záber pozadia nikdy v slučke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Rozmer JPEG zo značky SOF (baseline aj progressive). */
function jpegSize(bytes) {
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8, 'JPEG');
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  throw new Error('SOF not found');
}

test('public/share-default.jpg: 1200×630, menej ako 300 kB (WhatsApp)', () => {
  const bytes = readFileSync(new URL('../public/share-default.jpg', import.meta.url));
  assert.deepEqual(jpegSize(bytes), { width: 1200, height: 630 });
  assert.ok(bytes.length < 300_000, `${bytes.length} B`);
  assert.ok(bytes.length > 60_000, 'skutočný záber, nie prázdna grafika');
});

test('index.html: titulok, popis s témami, popis obrázka a jazyk pre Open Graph aj X', () => {
  const html = read('../index.html');
  assert.match(html, /<meta property="og:locale" content="sk_SK" \/>/);
  assert.match(html, /<meta property="og:title" content="OKO — lietadlá, lode a konflikty naživo v 3D" \/>/);
  assert.match(html, /<meta property="og:description" content="Sledovanie lietadiel a lodí, Ukrajina, Blízky východ, plyn, satelity a kamery na živom 3D glóbuse\. Čoskoro aj satelitné snímky parciel\." \/>/,
    '„čoskoro" je len v popise, nie na obrázku — služba ešte nie je');
  assert.match(html, /<meta property="og:image:alt" content="[^"]{20,}" \/>/);
  assert.match(html, /<meta name="twitter:title" content="OKO — lietadlá, lode a konflikty naživo v 3D" \/>/);
  assert.match(html, /<meta name="twitter:image:alt" content="[^"]{20,}" \/>/);
  assert.match(html, /<meta name="robots" content="index, follow, max-image-preview:large" \/>/, 'od 2026-09-30 sa koreň indexuje (vlastník: „podmienka noindex už neplatí")');
});

test('skladanie obrázka: krátky titulok, témy, doména, autor a atribúcia Google · Cesium ion', () => {
  const src = read('../scripts/build-share-default-image.mjs');
  assert.match(src, /const HEADLINE = 'Lietadlá, lode a konflikty naživo v 3D';/);
  assert.match(src, /const TOPICS = 'Ukrajina · Blízky východ · plyn · satelity · kamery';/);
  assert.match(src, /const DOMAIN = 'okolive\.sk';/);
  assert.match(src, /const AUTHOR = 'UHRIN VLADIMÍR';/);
  assert.match(src, /const ATTRIBUTION = '© Google · Cesium ion';/, 'podmienky Map Tiles: atribúcia aj na zdieľanom obrázku');
  assert.match(src, /\$\{ATTRIBUTION\}<\/text>/, 'atribúcia sa naozaj kreslí');
  assert.doesNotMatch(src, /ČOSKORO|čoskoro'/, 'nehotová služba nie je na obrázku');
});

test('záber pozadia: bez UI, bez masky, bez nočného osvetlenia, ručne a nie v slučke', () => {
  const src = read('../scripts/capture-share-background.mjs');
  assert.match(src, /&sc=0&/, 'bez masky ďalekohľadu (tmavé rohy)');
  assert.match(src, /globe\.enableLighting = false;/);
  assert.match(src, /el\.style\.setProperty\('visibility', 'hidden', 'important'\)/, 'panely a HUD mimo záberu');
  assert.match(src, /nikdy v slučke/);
  assert.doesNotMatch(src, /setInterval|while \(true\)/);
});
