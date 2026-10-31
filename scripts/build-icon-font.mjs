#!/usr/bin/env node
// scripts/build-icon-font.mjs — stiahne výrez písma Material Symbols Outlined len s ikonami, ktoré appka
// používa (2026-10-31). Spustiť po pridaní novej ikony do HTML/JS:
//   node scripts/build-icon-font.mjs
// Test scripts/lib/iconFont.test.mjs padne, kým zoznam vo výreze nesedí s kódom. Potrebuje sieť:
// Google Fonts (css2 s icon_names=, písmo Apache 2.0) a zoznam názvov ikon z google/material-design-icons
// na GitHube — Google neznámy názov potichu vynechá, preto sa preklepy chytajú tu, pred stiahnutím.
// Výstup: public/fonts/material-symbols-subset.woff2 (jednotky KB) a .json (zoznam ikon, sha256, osi).
// Zber názvov, odtlačok a Vite plugin (?v= v index.html a style.css) sú v scripts/lib/iconFont.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ICON_CODEPOINTS_URL,
  ICON_FONT_AXES,
  ICON_FONT_FAMILY,
  ICON_FONT_FILE,
  ICON_FONT_MANIFEST,
  collectIconNames,
  fontFingerprint,
  fontUrlFromCss,
  googleSubsetCssUrl,
  parseCodepoints,
} from './lib/iconFont.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Bez prehliadačového User-Agent vráti css2 staršie formáty; Chrome dostane woff2. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
/** Výrez má mať jednotky KB; viac znamená, že do zoznamu prišlo niečo, čo tam nepatrí. */
const MAX_BYTES = 64 * 1024;

async function fetchResponse(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function main() {
  const { names, sources } = collectIconNames(ROOT);
  if (!names.length) throw new Error('V kóde sa nenašla žiadna ikona Material Symbols.');

  const known = parseCodepoints(await (await fetchResponse(ICON_CODEPOINTS_URL)).text());
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length) {
    throw new Error(`Neznáme názvy ikon (preklep?): ${unknown.map((name) => `${name} (${sources[name].join(', ')})`).join('; ')}`);
  }

  const cssUrl = googleSubsetCssUrl(names, ICON_FONT_AXES);
  const css = await (await fetchResponse(cssUrl, { 'User-Agent': BROWSER_UA })).text();
  const fontUrl = fontUrlFromCss(css);
  if (!fontUrl) throw new Error(`css2 nevrátil woff2:\n${css.slice(0, 400)}`);
  const bytes = Buffer.from(await (await fetchResponse(fontUrl, { 'User-Agent': BROWSER_UA })).arrayBuffer());
  if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') throw new Error('Stiahnutý súbor nie je woff2.');
  if (bytes.length > MAX_BYTES) throw new Error(`Výrez má ${bytes.length} B, strop je ${MAX_BYTES} B — skontroluj zoznam ikon.`);

  const fontPath = path.join(ROOT, 'public', ICON_FONT_FILE);
  fs.mkdirSync(path.dirname(fontPath), { recursive: true });
  fs.writeFileSync(fontPath, bytes);
  const manifest = {
    family: ICON_FONT_FAMILY,
    license: 'Apache License 2.0, Google — https://github.com/google/material-design-icons',
    axes: ICON_FONT_AXES,
    built: new Date().toISOString().slice(0, 10),
    source: cssUrl,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fingerprint: fontFingerprint(bytes),
    icons: names,
  };
  fs.writeFileSync(path.join(ROOT, 'public', ICON_FONT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Výrez ${ICON_FONT_FILE}: ${names.length} ikon, ${bytes.length} B, odtlačok ${manifest.fingerprint}`);
  for (const name of names) console.log(`  ${name.padEnd(24)} ${sources[name].join(', ')}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
