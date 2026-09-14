// OKO — predvolený obrázok pre náhľad odkazu (2026-09-14, zdieľanie na siete).
// Keď niekto zdieľa koreňovú adresu alebo dlhý odkaz s hashom (siete hash
// nevidia), Facebook / X / LinkedIn si vezmú tento obrázok z Open Graph značiek
// v index.html; presná snímka pohľadu ide cez krátke odkazy /s/<id>.
// Výstup: public/share-default.jpg, 1200×630 (odporúčaný rozmer OG), JPEG 85.
// Spustenie: node scripts/build-share-default-image.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 1200;
const HEIGHT = 630;

const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <radialGradient id="g" cx="30%" cy="45%" r="80%">
      <stop offset="0" stop-color="#10283a"/>
      <stop offset="0.55" stop-color="#08141f"/>
      <stop offset="1" stop-color="#040a10"/>
    </radialGradient>
    <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(57,208,255,0.07)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#g)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grid)"/>
  <circle cx="960" cy="330" r="230" fill="none" stroke="rgba(57,208,255,0.18)" stroke-width="2"/>
  <circle cx="960" cy="330" r="150" fill="none" stroke="rgba(57,208,255,0.12)" stroke-width="1.5"/>
  <line x1="700" y1="330" x2="1220" y2="330" stroke="rgba(57,208,255,0.10)" stroke-width="1"/>
  <line x1="960" y1="70" x2="960" y2="590" stroke="rgba(57,208,255,0.10)" stroke-width="1"/>
  <text x="330" y="292" font-family="Segoe UI, Arial, sans-serif" font-size="128" font-weight="700" letter-spacing="14" fill="#e6f6fc">OK<tspan fill="#39d0ff">O</tspan></text>
  <text x="334" y="352" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="rgba(223,243,251,0.88)">Živý 3D glóbus · lietadlá, lode, plyn, satelity</text>
  <text x="334" y="404" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="rgba(223,243,251,0.88)">Live 3D globe · aircraft, ships, gas, satellites</text>
  <text x="334" y="470" font-family="Segoe UI, Arial, sans-serif" font-size="26" letter-spacing="4" fill="#39d0ff">oko.uhrin.digital</text>
</svg>`);

const logo = await sharp(path.join(root, 'public', 'logo.svg')).resize(200, 200, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

const out = path.join(root, 'public', 'share-default.jpg');
await sharp(background)
  .composite([{ input: logo, left: 92, top: 215 }])
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(out);
const stat = await sharp(out).metadata();
console.log(`[share-default] ${out}: ${stat.width}×${stat.height}, ${stat.size ?? '?'} bytes`);
