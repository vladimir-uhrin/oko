// OKO — predvolený obrázok pre náhľad odkazu (2026-09-14, zdieľanie na siete).
// Keď niekto zdieľa koreňovú adresu alebo dlhý odkaz s hashom (siete hash
// nevidia), Facebook / X / LinkedIn / WhatsApp si vezmú tento obrázok z Open Graph
// značiek v index.html; presná snímka pohľadu ide cez krátke odkazy /s/<id>.
//
// 2026-09-29 (vlastník: „kvalitný cover image pre zdieľanie samotnej domény", vybraný
// návrh B9): skutočný záber OKO z obežnej dráhy — Európa so živými lietadlami a loďami
// (scripts/capture-share-background.mjs) — a nad ním logo, krátky titulok, jeden riadok
// tém, NAŽIVO + doména, autor a atribúcia Google · Cesium ion (podmienky Map Tiles chcú
// atribúciu aj na zdieľanom obrázku). Na obrázku je len to, čo sa prečíta aj zmenšené
// vo feede (~480 px); zoznam tém, angličtina a „čoskoro" sú v og:description.
//
// Výstup: public/share-default.jpg, 1200×630 (odporúčaný rozmer OG), JPEG pod 300 kB
// (WhatsApp väčší náhľad neukáže).
// Spustenie: node scripts/build-share-default-image.mjs [--background <png 2400×1260>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const background = path.resolve(flag('--background', path.join(root, '.gev-cache', 'share-cover', 'bg-orbit.png')));
if (!fs.existsSync(background)) {
  console.error(`[share-default] chýba pozadie ${background} — najprv: node scripts/capture-share-background.mjs`);
  process.exit(1);
}

const WIDTH = 1200;
const HEIGHT = 630;
const FONT = 'Segoe UI, Arial, sans-serif';
const CYAN = '#39d0ff';
const HEADLINE = 'Lietadlá, lode a konflikty naživo v 3D';
const TOPICS = 'Ukrajina · Blízky východ · plyn · satelity · kamery';
const DOMAIN = 'okolive.sk';
const AUTHOR = 'UHRIN VLADIMÍR';
const ATTRIBUTION = '© Google · Cesium ion';

// Výrez 1800×945 zo záberu 2400×1260 je stále zmenšenie 1,5× (ostré): Zem väčšia, horizont
// vyššie, nad ním miesto pre text. Mierne zosvetlenie — Európa zo záberu je tmavá.
const meta = await sharp(background).metadata();
const scale = meta.width / 2400;
const base = await sharp(background)
  .extract({ left: Math.round(300 * scale), top: Math.round(315 * scale), width: Math.round(1800 * scale), height: Math.round(945 * scale) })
  .resize(WIDTH, HEIGHT)
  .modulate({ brightness: 1.25, saturation: 1.12 })
  .linear(1.06, -7.68)
  .toBuffer();

const logo = await sharp(path.join(root, 'public', 'logo.svg'))
  .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
const pillX = WIDTH / 2 - 150;
const pillY = 262;
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs><radialGradient id="r" cx="0.5" cy="0.26" r="0.5">
    <stop offset="0" stop-color="#000" stop-opacity="0.6"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#r)"/>
  <text x="${WIDTH / 2 + 52}" y="118" text-anchor="middle" font-family="${FONT}" font-size="92" font-weight="700" letter-spacing="12" fill="#eef8fc">OK<tspan fill="${CYAN}">O</tspan></text>
  <text x="${WIDTH / 2}" y="172" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="600" fill="#f2fbff">${HEADLINE}</text>
  <text x="${WIDTH / 2}" y="214" text-anchor="middle" font-family="${FONT}" font-size="27" fill="#bfeeff">${TOPICS}</text>
  <rect x="${pillX}" y="${pillY - 19}" width="112" height="28" rx="14" fill="rgba(255,46,46,0.14)" stroke="rgba(255,90,90,0.75)" stroke-width="1.2"/>
  <circle cx="${pillX + 18}" cy="${pillY - 5}" r="5.5" fill="#ff3b3b"/>
  <text x="${pillX + 32}" y="${pillY + 1}" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="2.5" fill="#ffd9d9">NAŽIVO</text>
  <text x="${WIDTH / 2 - 16}" y="${pillY + 1}" font-family="${FONT}" font-size="30" font-weight="600" letter-spacing="3" fill="${CYAN}">${DOMAIN}</text>
  <line x1="${WIDTH / 2 - 150}" y1="294" x2="${WIDTH / 2 - 112}" y2="294" stroke="rgba(57,208,255,0.55)" stroke-width="1"/>
  <text x="${WIDTH / 2 - 100}" y="299" font-family="${FONT}" font-size="14" letter-spacing="2.2" fill="rgba(223,243,251,0.72)">VYTVORIL <tspan fill="${CYAN}" font-weight="600">${AUTHOR}</tspan></text>
  <text x="${WIDTH - 22}" y="${HEIGHT - 20}" text-anchor="end" font-family="${FONT}" font-size="15" fill="rgba(223,243,251,0.82)" stroke="rgba(0,0,0,0.55)" stroke-width="3" paint-order="stroke">${ATTRIBUTION}</text>
</svg>`);

const out = path.join(root, 'public', 'share-default.jpg');
await sharp(base)
  .composite([{ input: overlay }, { input: logo, left: Math.round(WIDTH / 2 - 176), top: 34 }])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(out);
const stat = await sharp(out).metadata();
console.log(`[share-default] ${out}: ${stat.width}×${stat.height}, ${fs.statSync(out).size} bytes`);
