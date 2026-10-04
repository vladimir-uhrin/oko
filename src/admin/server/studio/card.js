// OKO Štúdio (2026-10-03) — obrázok príspevku 1080×1350 (4:5, FB aj IG feed).
// SVG s vlastnou mapkou (hranice štátov Natural Earth, public domain) → JPEG cez sharp.
// Žiadny mapový podklad tretej strany, žiadne náklady, žiadna kvóta.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const CARD = Object.freeze({ width: 1080, height: 1350 });
const MAP = { x: 60, y: 560, w: 960, h: 560 };
export const FONT = "'DejaVu Sans', 'Segoe UI', Arial, sans-serif";
export const MONO = "'DejaVu Sans Mono', Consolas, monospace";

let borders = null;
let land = null;
export function loadLand() {
  if (land) return land;
  const file = fileURLToPath(new URL('../../../data/local_data/natural_earth/land.json', import.meta.url));
  land = JSON.parse(readFileSync(file, 'utf8')).rings;
  return land;
}
export function loadBorders() {
  if (borders) return borders;
  const file = fileURLToPath(new URL('../../../data/local_data/boundaries/boundaries.geojsonl', import.meta.url));
  borders = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).geometry.coordinates);
  return borders;
}

export const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/** Výrez mapy: daný `view` (bbox), okolie bodu, alebo celý svet pre viac bodov. */
export function mapView(card) {
  if (card.view && ['west', 'east', 'south', 'north'].every(k => Number.isFinite(card.view[k]))) return { ...card.view };
  if (card.point) {
    const spanLon = 56; const spanLat = spanLon * MAP.h / MAP.w;
    const lat = Math.max(-90 + spanLat / 2, Math.min(90 - spanLat / 2, card.point.lat));
    return { west: card.point.lon - spanLon / 2, east: card.point.lon + spanLon / 2, south: lat - spanLat / 2, north: lat + spanLat / 2 };
  }
  return { west: -180, east: 180, south: -62, north: 84 };
}

function project(view, lon, lat) {
  let x = lon;
  if (x < view.west - 180) x += 360; else if (x > view.east + 180) x -= 360;
  return [MAP.x + ((x - view.west) / (view.east - view.west)) * MAP.w, MAP.y + ((view.north - lat) / (view.north - view.south)) * MAP.h];
}

function mapSvg(card) {
  const view = mapView(card);
  const paths = [];
  for (const line of loadBorders()) {
    if (!line.some(([lon, lat]) => lon >= view.west - 2 && lon <= view.east + 2 && lat >= view.south - 2 && lat <= view.north + 2)) continue;
    paths.push(line.map(([lon, lat], i) => { const [x, y] = project(view, lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(''));
  }
  const fills = [];
  for (const ring of loadLand()) {
    if (!ring.some(([lon, lat]) => lon >= view.west - 20 && lon <= view.east + 20 && lat >= view.south - 20 && lat <= view.north + 20)) continue;
    fills.push(ring.map(([lon, lat], i) => { const [x, y] = project(view, lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z');
  }
  const grid = [];
  const span = view.east - view.west;
  const step = span <= 30 ? 5 : card.point || span <= 90 ? 10 : 30;
  for (let lon = Math.ceil(view.west / step) * step; lon <= view.east; lon += step) { const [x] = project(view, lon, 0); grid.push(`M${x.toFixed(1)},${MAP.y}V${MAP.y + MAP.h}`); }
  for (let lat = Math.ceil(view.south / step) * step; lat <= view.north; lat += step) { const [, y] = project(view, view.west, lat); grid.push(`M${MAP.x},${y.toFixed(1)}H${MAP.x + MAP.w}`); }
  // Plochy (Ukrajina 2026-10-04: okupované územie z mapy frontu) — pod bodmi.
  const areas = [];
  for (const poly of card.polygons || []) {
    const d = (poly.rings || []).filter(ring => ring?.length >= 3)
      .map(ring => ring.map(([lon, lat], i) => { const [x, y] = project(view, lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z').join('');
    if (d) areas.push(`<path d="${d}" fill="${escapeXml(poly.fill || '#ff5a3c')}" fill-opacity="${Number(poly.opacity ?? 0.35)}" stroke="${escapeXml(poly.stroke || poly.fill || '#ff5a3c')}" stroke-width="2" fill-rule="evenodd" stroke-linejoin="round"/>`);
  }
  const marks = [];
  if (card.point) {
    const [x, y] = project(view, card.point.lon, card.point.lat);
    marks.push(`<circle cx="${x}" cy="${y}" r="70" fill="#ff5a3c" fill-opacity="0.10"/>`,
      `<circle cx="${x}" cy="${y}" r="42" fill="none" stroke="#ff5a3c" stroke-opacity="0.45" stroke-width="3"/>`,
      `<circle cx="${x}" cy="${y}" r="13" fill="#ff5a3c" stroke="#0a0f16" stroke-width="4"/>`);
  }
  const labels = [];
  const placed = []; // obdĺžniky popisov, aby sa neprekrývali
  for (const p of card.points || []) {
    const [x, y] = project(view, p.lon, p.lat);
    // `r` = priamy polomer (Ukrajina), inak magnitúda zemetrasenia (`size`).
    const r = Number.isFinite(p.r) ? Math.max(4, Math.min(40, p.r)) : Math.max(5, Math.min(20, (p.size - 3.5) * 5));
    marks.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${escapeXml(p.color || '#ff5a3c')}" fill-opacity="0.75" stroke="#0a0f16" stroke-width="2"/>`);
    if (!p.label) continue;
    const w = String(p.label).length * 16 + 8; const h = 30;
    const right = x + r + 8 + w <= MAP.x + MAP.w - 6;
    const lx = right ? x + r + 8 : x - r - 8 - w;
    let ly = y - h / 2;
    for (const dy of [0, 34, -34, 68, -68, 102, -102]) {
      const box = { x: lx, y: y - h / 2 + dy, w, h };
      if (!placed.some(b => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) { ly = box.y; break; }
    }
    placed.push({ x: lx, y: ly, w, h });
    if (Math.abs(ly + h / 2 - y) > 4) labels.push(`<path d="M${(right ? x + r : x - r).toFixed(1)},${y.toFixed(1)}L${(right ? lx : lx + w).toFixed(1)},${(ly + h / 2).toFixed(1)}" stroke="#a9c2d2" stroke-width="1.5"/>`);
    labels.push(`<text x="${lx.toFixed(1)}" y="${(ly + h / 2 + 9).toFixed(1)}" font-family="${FONT}" font-size="26" font-weight="600" fill="#e8f1f7" stroke="#061019" stroke-width="5" paint-order="stroke">${escapeXml(p.label)}</text>`);
  }
  marks.push(...labels);
  return `<clipPath id="map"><rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="24"/></clipPath>
  <rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="24" fill="#061019"/>
  <g clip-path="url(#map)">
    <path d="${grid.join('')}" stroke="#12283a" stroke-width="1.5" fill="none"/>
    <path d="${fills.join('')}" fill="#14283a" stroke="#3f6c86" stroke-width="2" stroke-linejoin="round"/>
    <path d="${paths.join('')}" stroke="#2d5168" stroke-width="1.5" fill="none" stroke-dasharray="6 4" stroke-linejoin="round"/>
    ${areas.join('\n    ')}
    ${marks.join('\n    ')}
  </g>
  <rect x="${MAP.x}" y="${MAP.y}" width="${MAP.w}" height="${MAP.h}" rx="24" fill="none" stroke="#1d3a4d" stroke-width="2"/>`;
}

/** Zalomí text na riadky podľa približnej šírky znaku. */
export function wrap(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars && line) { lines.push(line); line = word; } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}

export const stamp = at => new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));

export function cardSvg(card) {
  const headline = wrap(card.headline, 26, 2);
  const lines = (card.lines || []).flatMap(line => wrap(line, 46, 2)).slice(0, 4);
  const bigSize = String(card.big).length > 8 ? 96 : 150;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <defs><radialGradient id="glow" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="#10364a"/><stop offset="1" stop-color="#070d14"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g font-family="${FONT}">
    <circle cx="86" cy="96" r="22" fill="none" stroke="#00d4ff" stroke-width="5"/><circle cx="86" cy="96" r="8" fill="#00d4ff"/>
    <text x="124" y="108" font-family="${MONO}" font-size="34" font-weight="700" letter-spacing="8" fill="#e8f1f7">OKO</text>
    <text x="1020" y="106" text-anchor="end" font-family="${MONO}" font-size="24" letter-spacing="4" fill="#00d4ff">${escapeXml(card.kicker)}</text>
    <text x="60" y="${190 + bigSize * 0.8}" font-size="${bigSize}" font-weight="700" fill="#ff7a5c">${escapeXml(card.big)}</text>
    ${headline.map((line, i) => `<text x="60" y="${250 + bigSize * 0.8 + i * 62}" font-size="54" font-weight="600" fill="#e8f1f7">${escapeXml(line)}</text>`).join('\n    ')}
    ${lines.map((line, i) => `<text x="60" y="${264 + bigSize * 0.8 + headline.length * 62 + i * 40}" font-size="30" fill="#a9c2d2">${escapeXml(line)}</text>`).join('\n    ')}
  </g>
  ${mapSvg(card)}
  <g font-family="${FONT}" font-size="24" fill="#7f99aa">
    <text x="60" y="1190">Zdroj: ${escapeXml(card.source)} · stav k ${escapeXml(stamp(card.at))}</text>
    <text x="60" y="1228">${escapeXml(card.mapCredit || 'Mapa: Natural Earth')} · OKO — živá mapa sveta</text>
    <text x="1020" y="1290" text-anchor="end" font-family="${MONO}" font-size="30" fill="#00d4ff">${escapeXml(card.site || 'okolive.sk')}</text>
  </g>
</svg>`;
}

/** JPEG (progresívny, ~150 kB) pre FB aj IG. */
export async function renderCard(card) {
  return sharp(Buffer.from(cardSvg(card))).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
}

/**
 * Fotka z cudzieho zdroja (Ukrajina 2026-10-04: oficiálne kanály UA, CC BY 4.0) v ráme OKO 1080×1350:
 * fotka celá (bez orezania) na tmavom pozadí, hore značka a nadpis, dole zdroj a čas. JPEG.
 * @param {Buffer} photo
 * @param {{kicker:string, headline:string, source:string, at:number, site?:string, index?:number, count?:number}} meta
 */
export async function renderPhotoCard(photo, meta) {
  const box = { x: 40, y: 260, w: 1000, h: 880 };
  const fitted = await sharp(photo, { failOn: 'none' }).rotate().resize(box.w, box.h, { fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const left = box.x + Math.round((box.w - fitted.info.width) / 2);
  const top = box.y + Math.round((box.h - fitted.info.height) / 2);
  const headline = wrap(meta.headline, 34, 2);
  const counter = meta.count > 1 ? `${(meta.index ?? 0) + 1}/${meta.count}` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <defs><radialGradient id="glow" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="#10364a"/><stop offset="1" stop-color="#070d14"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <g font-family="${FONT}">
    <circle cx="86" cy="96" r="22" fill="none" stroke="#00d4ff" stroke-width="5"/><circle cx="86" cy="96" r="8" fill="#00d4ff"/>
    <text x="124" y="108" font-family="${MONO}" font-size="34" font-weight="700" letter-spacing="8" fill="#e8f1f7">OKO</text>
    <text x="1020" y="106" text-anchor="end" font-family="${MONO}" font-size="24" letter-spacing="4" fill="#00d4ff">${escapeXml(meta.kicker)}</text>
    ${headline.map((line, i) => `<text x="60" y="${178 + i * 50}" font-size="42" font-weight="600" fill="#e8f1f7">${escapeXml(line)}</text>`).join('\n    ')}
  </g>
  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="18" fill="#061019"/>
  <g font-family="${FONT}" font-size="24" fill="#7f99aa">
    <text x="60" y="1200">Zdroj: ${escapeXml(meta.source)} · ${escapeXml(stamp(meta.at))}</text>
    <text x="1020" y="1290" text-anchor="end" font-family="${MONO}" font-size="30" fill="#00d4ff">${escapeXml(meta.site || 'okolive.sk')}</text>
    ${counter ? `<text x="60" y="1290" font-family="${MONO}" font-size="30" fill="#7f99aa">${counter}</text>` : ''}
  </g>
</svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: fitted.data, left, top }]).jpeg({ quality: 88, progressive: true, mozjpeg: true }).toBuffer();
}
