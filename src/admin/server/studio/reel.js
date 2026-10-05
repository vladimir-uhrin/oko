// OKO Štúdio — Fáza 2: reels 1080×1920 (9:16), 12 s, H.264 + AAC (2026-10-03).
//
// Bez prehliadača a bez Google: vlastná mapa z Natural Earth (public domain)
// sa animuje snímku po snímke (priblíženie k udalosti, pulzujúci bod, odpočítanie
// čísla), sharp skladá snímky a ffmpeg (systémový, zadarmo) z nich spraví MP4.
// Zvuk: tichý ambient generovaný ffmpeg (bez licencie), voliteľne hudba z vlastného
// priečinka (CC0) a slovenský hlas cez Piper TTS — oboje len ak sú nastavené.
// Bezpečné zóny reels: dôležitý obsah medzi y ≈ 220 a 1580 (hore/dole UI aplikácie).

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FONT, MONO, escapeXml, loadBorders, loadLand, stamp, wrap } from './card.js';

export const REEL = Object.freeze({ width: 1080, height: 1920, fps: 30, seconds: 12 });
const MAP = { x: 0, y: 640, w: 1080, h: 800 };
// Háčik (vlastník 2026-10-04: „prvé 3 sekundy musia upútať diváka, väčšina má vypnutý zvuk"): od prvej snímky
// celé číslo + veta háčika (žiadne odpočítavanie od nuly), mapa priblížená priamo na mieste udalosti; po HOOK_END
// sa kamera odtiahne na celý výrez (úder → odhalenie) a nastúpia veľké titulky po frázach.
export const HOOK_END = 2.8; // s
const HOOK_SWAP = 0.15; // s — háčik zmizne, až potom nastúpi hlavička
/** Pás háčika (snímky 0–3 s) pre admin: 4 × 270×480 s medzerou. */
export const HOOK_SHEET = Object.freeze({ w: 270, h: 480, gap: 8 });
const ZOOM_OUT_FROM = 2.6; const ZOOM_OUT_TO = 4.4; // s

const clamp01 = v => Math.max(0, Math.min(1, v));
/** Výrez karty (bbox), ak ho šablóna dala — rovnaké pravidlo ako statická karta (card.js mapView). */
const viewBox = card => (card?.view && ['west', 'east', 'south', 'north'].every(k => Number.isFinite(card.view[k]))
  && card.view.east > card.view.west && card.view.north > card.view.south ? card.view : null);
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const fade = (t, from, len = 0.6) => clamp01((t - from) / len);

// ── mapa ──────────────────────────────────────────────────────────────────
/** Výrez mapy v čase t: lon/lat stred + rozpätie v stupňoch dĺžky. */
/**
 * Miesto, na ktoré reel „udrie" v prvých sekundách: bod udalosti, inak prvý (najdôležitejší) bod karty.
 * Pri prehľade s mnohými bodmi (vzdušný útok, 24 h zemetrasení) null — ukáže sa celok naraz.
 */
export function reelFocus(card) {
  if (card?.focus === false) return null; // šablóna chce celok (napr. hlásenie GŠ: všetky smery naraz)
  if (card?.point && Number.isFinite(card.point.lat) && Number.isFinite(card.point.lon)) return card.point;
  const points = (card?.points || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!points.length || points.length > 4) return null;
  return points.find(p => p.label) || points[0];
}

const lerp = (a, b, k) => a + (b - a) * k;
const logLerp = (a, b, k) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);
const clampLat = (lat, span, aspect) => Math.max(-60 + span * aspect / 2, Math.min(80 - span * aspect / 2, lat));

export function reelView(card, t) {
  const aspect = MAP.h / MAP.w;
  const focus = reelFocus(card);
  const out = ease(clamp01((t - ZOOM_OUT_FROM) / (ZOOM_OUT_TO - ZOOM_OUT_FROM)));
  const push = 1 - 0.07 * clamp01(t / ZOOM_OUT_FROM); // jemný nájazd počas háčika — obraz nikdy nestojí
  // Výrez (Ukrajina: celá krajina / front): úder na miesto zmeny, potom odhalenie celého výrezu.
  const box = viewBox(card);
  if (box) {
    const lon = (box.west + box.east) / 2; const lat = (box.south + box.north) / 2;
    const fit = Math.max(box.east - box.west, (box.north - box.south) / aspect) * 1.04;
    if (!focus) {
      const span = fit * logLerp(1.22, 1, ease(clamp01(t / ZOOM_OUT_TO)));
      // Počas háčika je horná časť mapy pod vetou háčika — obsah posunúť nižšie (stred výrezu severnejšie).
      const shift = span * aspect * 0.16 * (1 - out);
      return { lon, lat: clampLat(lat + shift, span, aspect), span };
    }
    const tight = Math.min(fit * 0.34, 6) * push;
    const span = logLerp(tight, fit, out);
    return { lon: lerp(focus.lon, lon, out), lat: clampLat(lerp(focus.lat, lat, out), span, aspect), span };
  }
  if (focus) {
    // Bod (zemetrasenie, štart): zblízka, potom okolie so štátmi.
    const span = logLerp(10 * push, 26, out);
    return { lon: focus.lon, lat: clampLat(focus.lat, span, aspect), span };
  }
  // Prehľad bez výrezu: pomalý posun cez svet.
  const span = 210;
  return { lon: -40 + 150 * (t / REEL.seconds), lat: 12, span };
}

function projector(view, w = MAP.w, h = MAP.h) {
  // Výška v stupňoch je vždy daná oknom mapy (MAP), aby panoráma a snímka mali rovnakú mierku.
  const spanLat = view.span * h / w;
  const west = view.lon - view.span / 2; const north = view.lat + spanLat / 2;
  return (lon, lat) => {
    let x = lon;
    while (x < west - 180) x += 360;
    while (x > west + 540) x -= 360;
    return [((x - west) / view.span) * w, ((north - lat) / spanLat) * h];
  };
}

function ringPath(project, ring, view, w = MAP.w, h = MAP.h) {
  const pad = 30;
  const xs = []; let inside = false;
  for (const [lon, lat] of ring) {
    const p = project(lon, lat);
    if (p[0] > -w * 0.5 - pad && p[0] < w * 1.5 + pad && p[1] > -h * 0.5 && p[1] < h * 1.5) inside = true;
    xs.push(p);
  }
  if (!inside || view.span <= 0) return '';
  return xs.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
}

/** SVG mapy (bez značiek) pre daný výrez. */
export function mapLayerSvg(view, w = MAP.w, h = MAP.h) {
  const project = projector(view, w, h);
  const land = loadLand().map(ring => ringPath(project, ring, view, w, h)).filter(Boolean).map(d => d + 'Z').join('');
  const borders = loadBorders().map(line => ringPath(project, line, view, w, h)).filter(Boolean).join('');
  const grid = [];
  const step = view.span > 90 ? 30 : view.span > 40 ? 15 : 5;
  const spanLat = view.span * h / w;
  for (let lon = Math.ceil((view.lon - view.span / 2) / step) * step; lon <= view.lon + view.span / 2; lon += step) {
    const [x] = project(lon, 0); grid.push(`M${x.toFixed(1)},0V${h}`);
  }
  for (let lat = Math.ceil((view.lat - spanLat / 2) / step) * step; lat <= view.lat + spanLat / 2; lat += step) {
    const [, y] = project(view.lon, lat); grid.push(`M0,${y.toFixed(1)}H${w}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#061019"/>
  <path d="${grid.join('')}" stroke="#12283a" stroke-width="1.5" fill="none"/>
  <path d="${land}" fill="#14283a" stroke="#3f6c86" stroke-width="2" stroke-linejoin="round"/>
  <path d="${borders}" stroke="#2d5168" stroke-width="1.5" fill="none" stroke-dasharray="6 4"/>
</svg>`;
}

// ── vrstvy snímky ──────────────────────────────────────────────────────────
function backgroundSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL.width}" height="${REEL.height}">
  <defs><radialGradient id="g" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#10364a"/><stop offset="1" stop-color="#070d14"/></radialGradient>
  <linearGradient id="fadeTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient>
  <linearGradient id="fadeBottom" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}

/** Popredie: texty, značky, prechody. */
export function overlaySvg(card, t, { seconds = REEL.seconds, site = 'okolive.sk', captions = [] } = {}) {
  const view = reelView(card, t);
  const project = projector(view);
  const parts = [];
  // prechod mapy do pozadia hore a dole
  parts.push(`<rect x="0" y="${MAP.y}" width="${MAP.w}" height="90" fill="url(#ft)"/><rect x="0" y="${MAP.y + MAP.h - 120}" width="${MAP.w}" height="120" fill="url(#fb)"/>`);
  // značky
  const pulse = (x, y, phase, base = 14) => {
    const out = [];
    for (let k = 0; k < 2; k++) {
      const p = ((t * 0.7 + phase + k * 0.5) % 1);
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(base + p * 90).toFixed(1)}" fill="none" stroke="#ff5a3c" stroke-width="${(4 * (1 - p)).toFixed(2)}" stroke-opacity="${(0.8 * (1 - p)).toFixed(2)}"/>`);
    }
    out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${base}" fill="#ff5a3c" stroke="#0a0f16" stroke-width="4"/>`);
    return out.join('');
  };
  // Háčik: miesto udalosti pulzuje od prvej snímky.
  if (card.point) {
    const [x, y] = project(card.point.lon, card.point.lat);
    parts.push(`<g transform="translate(${MAP.x},${MAP.y})">${pulse(x, y, 0, 18)}</g>`);
  }
  const boxed = Boolean(viewBox(card));
  const focus = reelFocus(card);
  // Plochy (okupované územie z mapy frontu) — od prvej snímky, pod bodmi.
  for (const poly of card.polygons || []) {
    const d = (poly.rings || []).filter(ring => ring?.length >= 3)
      .map(ring => ring.map(([lon, lat], i) => { const [x, y] = project(lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z').join('');
    if (d) parts.push(`<g transform="translate(${MAP.x},${MAP.y})"><path d="${d}" fill="${escapeXml(poly.fill || '#ff5a3c')}" fill-opacity="${Number(poly.opacity ?? 0.35)}" stroke="${escapeXml(poly.stroke || poly.fill || '#ff5a3c')}" stroke-width="2.5" fill-rule="evenodd" stroke-linejoin="round"/></g>`);
  }
  const placed = []; // obdĺžniky popisov, aby sa neprekrývali (ako na karte)
  const count = (card.points || []).length;
  (card.points || []).forEach((p, i) => {
    // Bod háčika je tam od prvej snímky; ostatné pri odhalení (výrez), pri prehľade rýchlo za sebou.
    // Prehľad (bez bodu háčika): všetky body hneď na prvej snímke — háčik potrebuje celok.
    const appear = p === focus || !focus ? 0 : boxed ? ZOOM_OUT_TO - 0.6 + i * 0.3 : 0.15 + i * Math.min(0.12, 2.4 / Math.max(1, count));
    if (t < appear) return;
    const [x, y] = project(p.lon, p.lat);
    if (x < -40 || x > MAP.w + 40) return;
    // `r` = priamy polomer (Ukrajina, škálovaný z karty 960 px na reel 1080 px), inak magnitúda zemetrasenia.
    const r = Number.isFinite(p.r) ? Math.max(6, Math.min(44, p.r * 1.1)) : Math.max(6, Math.min(18, (p.size - 3.5) * 5));
    const color = escapeXml(p.color || '#ff5a3c');
    const mark = p === focus || (i < 3 && !Number.isFinite(p.r)) ? pulse(x, y, i * 0.3, Math.max(r, p === focus ? 16 : r))
      : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" fill-opacity="0.8" stroke="#0a0f16" stroke-width="2.5"/>`;
    let label = '';
    if (p.label) {
      const w = String(p.label).length * 19 + 8; const h = 36;
      const right = x + r + 10 + w <= MAP.w - 8;
      const lx = right ? x + r + 10 : x - r - 10 - w;
      let ly = y - h / 2;
      for (const dy of [0, 40, -40, 80, -80, 120, -120]) {
        const b = { x: lx, y: y - h / 2 + dy, w, h };
        if (!placed.some(o => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h)) { ly = b.y; break; }
      }
      placed.push({ x: lx, y: ly, w, h });
      const leader = Math.abs(ly + h / 2 - y) > 4
        ? `<path d="M${(right ? x + r : x - r).toFixed(1)},${y.toFixed(1)}L${(right ? lx : lx + w).toFixed(1)},${(ly + h / 2).toFixed(1)}" stroke="#a9c2d2" stroke-width="2"/>` : '';
      label = `${leader}<text x="${lx.toFixed(1)}" y="${(ly + h / 2 + 11).toFixed(1)}" font-family="${FONT}" font-size="32" font-weight="600" fill="#e8f1f7" stroke="#061019" stroke-width="6" paint-order="stroke">${escapeXml(p.label)}</text>`;
    }
    parts.push(`<g transform="translate(${MAP.x},${MAP.y})" opacity="${(appear ? fade(t, appear, 0.3) : 1).toFixed(2)}">${mark}${label}</g>`);
  });
  // hlavička — od prvej snímky
  parts.push(`<g font-family="${FONT}">
    <circle cx="96" cy="250" r="24" fill="none" stroke="#00d4ff" stroke-width="5"/><circle cx="96" cy="250" r="9" fill="#00d4ff"/>
    <text x="136" y="263" font-family="${MONO}" font-size="38" font-weight="700" letter-spacing="9" fill="#e8f1f7">OKO</text>
    <text x="1010" y="262" text-anchor="end" font-family="${MONO}" font-size="28" letter-spacing="5" fill="#00d4ff">${escapeXml(card.kicker)}</text></g>`);
  // HÁČIK (0 – HOOK_END): celá veta s číslom od prvej snímky, kľúčové slová farebne, krátky „úder" (zväčšenie 108 → 100 %).
  // Prechod za sebou, nie naraz (dva texty cez seba sú nečitateľné): háčik zmizne, až potom nastúpi hlavička.
  const hookOut = fade(t, HOOK_END, HOOK_SWAP);
  if (hookOut < 1) {
    const hook = reelHook(card);
    const pop = 1 + 0.08 * (1 - ease(clamp01(t / 0.3)));
    const rows = wrapWords(hook.text, 17, 3);
    const accent = new Set(String(hook.accent || '').split(/ +/).filter(Boolean));
    parts.push(`<g opacity="${(1 - hookOut).toFixed(2)}">
    <rect x="0" y="290" width="${REEL.width}" height="${rows.length * 100 + 170}" fill="url(#hs)"/>
    <text x="72" y="342" font-family="${MONO}" font-size="28" letter-spacing="1" fill="#9fdcef">${escapeXml(hookBadge(card))}</text>
    <g transform="translate(70 ${440}) scale(${pop.toFixed(3)})">${rows.map((row, i) => `<text x="0" y="${i * 100}" font-family="${FONT}" font-size="88" font-weight="800" fill="#ffffff" stroke="#061019" stroke-width="10" paint-order="stroke">${
      row.split(' ').map(word => `<tspan${accent.has(word) ? ' fill="#ff7a5c"' : ''}>${escapeXml(word)}</tspan>`).join(' ')}</text>`).join('')}</g></g>`);
  }
  // Po háčiku: číslo a nadpis v hlavičke (bez odpočítavania — číslo je vždy celé).
  const headIn = fade(t, HOOK_END + HOOK_SWAP, 0.25);
  if (headIn > 0) {
    const bigSize = String(card.big).length > 8 ? 110 : 170;
    parts.push(`<text x="70" y="${330 + bigSize * 0.8}" font-family="${FONT}" font-size="${bigSize}" font-weight="700" fill="#ff7a5c" opacity="${headIn.toFixed(2)}">${escapeXml(card.big)}</text>`);
    const headline = wrap(card.headline, 24, 2);
    const headY = 395 + bigSize * 0.8;
    headline.forEach((line, i) => parts.push(`<text x="70" y="${headY + i * 64}" font-family="${FONT}" font-size="58" font-weight="600" fill="#e8f1f7" opacity="${headIn.toFixed(2)}">${escapeXml(line)}</text>`));
  }
  // riadky pod mapou (bezpečná zóna)
  const lines = (card.lines || []).flatMap(line => wrap(line, 40, 2)).slice(0, 3);
  lines.forEach((line, i) => parts.push(`<text x="70" y="${MAP.y + MAP.h + 20 + i * 46}" font-family="${FONT}" font-size="36" fill="#cfe0ea" opacity="${fade(t, HOOK_END + 0.2 + i * 0.2, 0.3).toFixed(2)}">${escapeXml(line)}</text>`));
  const footY = MAP.y + MAP.h + 20 + lines.length * 46 + 26;
  parts.push(`<text x="70" y="${footY}" font-family="${FONT}" font-size="26" fill="#7f99aa" opacity="${fade(t, HOOK_END + 0.4, 0.3).toFixed(2)}">Zdroj: ${escapeXml(card.source)} · ${escapeXml(stamp(card.at))} · mapa: Natural Earth</text>`);
  // Titulky pre vypnutý zvuk: po háčiku, po krátkych frázach veľkým písmom, čísla farebne.
  const caption = t >= HOOK_END ? captions.find(c => t >= c.from && t < c.to) : null;
  if (caption) {
    const chunk = captionChunkAt(caption, t);
    const rows = wrapWords(chunk.text, 20, 2);
    const boxH = 40 + rows.length * 74;
    // Nad spodným okrajom mapy (riadky pod mapou ostanú čitateľné), stred mapy so značkou voľný.
    const y = MAP.y + MAP.h - 30 - boxH;
    const op = Math.min(fade(t, Math.max(caption.from, HOOK_END), 0.15), fade(caption.to, t, 0.15)).toFixed(2);
    parts.push(`<g opacity="${op}"><rect x="50" y="${y}" width="980" height="${boxH}" rx="18" fill="#070d14" fill-opacity="0.82"/>`
      + rows.map((row, i) => `<text x="540" y="${y + 74 + i * 74}" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="800" fill="#ffffff">${
        row.split(' ').map(word => `<tspan${/\d/.test(word) ? ' fill="#ffd23c"' : ''}>${escapeXml(word)}</tspan>`).join(' ')}</text>`).join('')
      + '</g>');
  }
  // výzva na konci
  const cta = fade(t, seconds - 3.2, 0.7);
  parts.push(`<g opacity="${cta.toFixed(2)}"><rect x="70" y="${footY + 34}" width="${Math.min(940, 60 + site.length * 24 + 240)}" height="64" rx="32" fill="#00d4ff1f" stroke="#00d4ff88" stroke-width="2"/>
    <text x="100" y="${footY + 77}" font-family="${MONO}" font-size="30" fill="#bff2ff">Naživo na ${escapeXml(site)}</text></g>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL.width}" height="${REEL.height}">
  <defs><linearGradient id="ft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2433"/><stop offset="1" stop-color="#0b2433" stop-opacity="0"/></linearGradient>
  <linearGradient id="fb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#070d14"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient>
  <linearGradient id="hs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070d14" stop-opacity="0.92"/><stop offset="0.7" stop-color="#070d14" stop-opacity="0.75"/><stop offset="1" stop-color="#070d14" stop-opacity="0"/></linearGradient></defs>
  ${parts.join('\n  ')}</svg>`;
}

// ── zvuk ───────────────────────────────────────────────────────────────────
/** Dĺžka WAV v sekundách z hlavičky (PCM). */
export function wavSeconds(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0;
  let offset = 12; let byteRate = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4); const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') return byteRate ? Math.min(size, buffer.length - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}

/**
 * Zalomenie len na obyčajných medzerách — pevná medzera drží čísla pokope („1 186 km²" sa nerozdelí
 * na dva riadky, zvýrazní sa celé). Inak ako card.js wrap. Pure.
 */
export function wrapWords(text, maxChars, maxLines) {
  const words = String(text || '').split(/ +/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/ *[^ ]*$/, '') + '…'; }
  return lines;
}

/**
 * Veta háčika: z karty šablóny (`hook: { text, accent }` — najsilnejší overený fakt, max ~6 slov),
 * inak číslo + nadpis. `accent` = slová, ktoré sa zvýraznia farebne. Pure.
 */
export function reelHook(card) {
  const text = keepNumbersTogether(String(card?.hook?.text || [card?.big, card?.headline].filter(Boolean).join(' ')).replace(/[ \t\r\n]+/g, ' ').trim());
  return { text, accent: keepNumbersTogether(String(card?.hook?.accent ?? card?.big ?? '').trim()) };
}

/** Horný riadok háčika: čas stavu · zdroj, verzálkami, najviac ~44 znakov (dlhší zdroj sa skráti o celé zdroje za „·" či „,"). Pure. */
export function hookBadge(card) {
  const source = String(card?.source || '');
  const parts = source.split(/( · |, )/).filter(Boolean); // [zdroj, oddeľovač, zdroj, …]
  let badge = '';
  while (parts.length) {
    badge = `${stamp(card.at)} · ${parts.join('')}`.toUpperCase();
    if (badge.length <= 44 || parts.length === 1) break;
    parts.splice(-2, 2); // posledný zdroj aj s oddeľovačom
  }
  return badge.length > 44 ? `${badge.slice(0, 43).trimEnd()}…` : badge || stamp(card.at);
}

/**
 * Číslo drží pokope: skupiny tisícok („1 186") a číslo s jednotkou („8,3 km²") sa spoja pevnou medzerou,
 * aby ich zalomenie ani delenie titulkov nerozdelilo (šablóny dávajú obyčajnú medzeru). Pure.
 */
export function keepNumbersTogether(text) {
  return String(text || '')
    .replace(/(\d) (?=\d{3}(?!\d))/g, (_, digit) => `${digit} `)
    .replace(/(\d\.) (?=\d)/g, (_, part) => `${part} `) // dátum „2. 10. 2026"
    .replace(/(\d) (?=(?:km²|km|%|°C)(?![\p{L}\d]))/gu, (_, digit) => `${digit} `);
}

/**
 * Fráza titulku v čase t: veta sa delí na kúsky do 4 slov / ~24 znakov, čas úmerne dĺžke —
 * na mobile bez zvuku sa číta fráza naraz, nie dlhý riadok. Pure.
 */
export function captionChunks(text) {
  const words = keepNumbersTogether(text).split(/ +/).filter(Boolean);
  const chunks = []; let current = [];
  for (const word of words) {
    if (current.length && (current.length >= 4 || [...current, word].join(' ').length > 24)) { chunks.push(current.join(' ')); current = []; }
    current.push(word);
  }
  if (current.length) chunks.push(current.join(' '));
  return chunks;
}
function captionChunkAt(caption, t) {
  const chunks = captionChunks(caption.text);
  if (chunks.length <= 1) return { text: chunks[0] || '', index: 0 };
  const total = chunks.reduce((sum, chunk) => sum + chunk.length + 4, 0);
  const at = clamp01((t - caption.from) / Math.max(0.01, caption.to - caption.from)) * total;
  let acc = 0;
  for (const [index, chunk] of chunks.entries()) { acc += chunk.length + 4; if (at < acc) return { text: chunk, index }; }
  return { text: chunks.at(-1), index: chunks.length - 1 };
}

// Staršie návrhy ešte nesú emoji — do hlasu ani titulkov nepatria.
const cleanSpoken = text => text.replace(/[#\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/[ \t\r\n]+/g, ' ').trim().slice(0, 300);
/** Prvá veta textu príspevku (bez nadpisu). */
function firstSentence(item) {
  const sentence = String(item.text || '').split('\n').map(s => s.trim()).filter(Boolean)[1] || '';
  return sentence.split(/(?<=\.)\s/)[0] || '';
}
/** Krátky text na nahovorenie (titulok + prvá veta). */
export function narration(item) {
  return cleanSpoken(`${item.title}. ${firstSentence(item)}`);
}
/** Titulky bez hlasu: len prvá veta — nadpis už povedal háčik, opakovať ho je strata času. */
export function silentCaptionText(item) {
  return cleanSpoken(firstSentence(item)) || narration(item);
}

/**
 * Titulky z narácie: vety rozložené v čase úmerne dĺžke textu v okne [start, start + length]
 * (s hlasom = dĺžka nahrávky, bez hlasu = trvanie reelu bez úvodu a výzvy). Pure.
 */
export function captionsFor(item, { start = 1.2, length = 8 } = {}) {
  const text = typeof item === 'string' ? item : narration(item);
  // Dlhé vety sa delia po slovách na kúsky do ~90 znakov (3 riadky titulku), nič sa neoreže.
  const sentences = text.split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean).flatMap(sentence => {
    if (sentence.length <= 90) return [sentence];
    const parts = []; let part = '';
    for (const word of sentence.split(/\s+/)) {
      if (part && (part + ' ' + word).length > 90) { parts.push(part); part = word; } else part = part ? `${part} ${word}` : word;
    }
    if (part) parts.push(part);
    return parts;
  });
  if (!sentences.length || length <= 0) return [];
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;
  let at = start;
  return sentences.map(sentence => {
    const span = Math.max(1.2, length * sentence.length / total);
    const row = { from: Number(at.toFixed(2)), to: Number((at + span).toFixed(2)), text: sentence };
    at += span;
    return row;
  });
}

/** Dĺžka videa v sekundách (ffprobe; bez neho z výpisu ffmpeg -i). null = nezistené. */
export async function probeSeconds(file, { env = process.env } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = env.FFPROBE_PATH || (env.FFMPEG_PATH ? path.join(path.dirname(env.FFMPEG_PATH), path.basename(env.FFMPEG_PATH).replace(/ffmpeg/i, 'ffprobe')) : 'ffprobe');
  const capture = (bin, args) => new Promise(resolve => {
    let out = '';
    let child;
    try { child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return resolve(null); }
    child.on('error', () => resolve(null));
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out = (out + chunk).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
  const probed = await capture(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const direct = Number(String(probed || '').trim());
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 100) / 100;
  const dump = await capture(ffmpeg, ['-hide_banner', '-i', file]);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(dump || ''));
  return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 100) / 100 : null;
}

async function run(bin, args, { input = null, timeoutMs = 120_000 } = {}) {
  const child = spawn(bin, args, { stdio: [input === null ? 'ignore' : 'pipe', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  if (input !== null) child.stdin.end(input);
  const [code] = await once(child, 'close').finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(`${path.basename(bin)} skončil s kódom ${code}: ${stderr.split('\n').filter(Boolean).slice(-2).join(' | ')}`);
}

/**
 * Reel 9:16 z hotového videa iného pomeru (4:5 z Udalostí / Týždňa na fronte): rozmazané pozadie
 * z toho istého záberu, obraz v strede v plnej šírke, zvuk a dĺžka bez zmeny. Žiadny nový render.
 */
// ── importované video (Udalosti, Týždeň na fronte) v ráme reelu ─────────────
/**
 * Rám pre importované video 4:5 (2026-10-04, háčik): video 960×1200 v bezpečnej zóne reelu (y 400–1600 —
 * horných ~220 px a spodok prekrýva rozhranie Instagramu/Facebooku, titulky videa sa tak neschovajú),
 * nad ním 0–2,8 s veta háčika, potom titulok; pod ním zdroj a výzva. Pozadie = rozmazané video.
 */
export const PAD = Object.freeze({ x: 60, y: 400, w: 960, h: 1200 });

/** Veta háčika v ráme: najväčšie písmo, pri ktorom sa zmestí na 2 riadky bez skrátenia. Pure. */
function padHookRows(text) {
  for (const size of [64, 56, 48, 42]) {
    // 0,64 em na znak: tučné verzálky (DejaVu Sans Bold) sú širšie než bežný text.
    const rows = wrapWords(text, Math.floor(PAD.w / (size * 0.64)), 2);
    if (!rows.at(-1)?.endsWith('…') || size === 42) return { size, rows };
  }
  return { size: 42, rows: [] };
}

/**
 * SVG vrstvy rámu (1080×1920, priehľadné): 'hook' (0 – HOOK_END), 'title' (potom), 'bottom' (stále). Pure.
 * card: { hook?: {text, accent}, kicker?, headline?, source?, at? }, title = nadpis návrhu (záloha).
 */
export function padOverlaySvg(card, layer, { title = '', site = 'okolive.sk' } = {}) {
  const parts = [];
  const top = PAD.y;
  if (layer === 'hook') {
    const hook = reelHook({ ...card, big: card?.big || '', headline: card?.headline || title });
    const accent = new Set(String(hook.accent || '').split(/ +/).filter(Boolean));
    const { size, rows } = padHookRows(hook.text);
    parts.push(`<rect x="0" y="200" width="${REEL.width}" height="${top - 200}" fill="#070d14" fill-opacity="0.55"/>`);
    parts.push(`<text x="${PAD.x}" y="242" font-family="${MONO}" font-size="26" letter-spacing="1" fill="#9fdcef">${escapeXml(hookBadge({ at: card?.at ?? Date.now(), source: card?.source || 'OKO' }))}</text>`);
    rows.forEach((row, i) => parts.push(`<text x="${PAD.x}" y="${top - 22 - (rows.length - 1 - i) * (size + 8)}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="#ffffff" stroke="#061019" stroke-width="8" paint-order="stroke">${
      row.split(' ').map(word => `<tspan${accent.has(word) ? ' fill="#ff7a5c"' : ''}>${escapeXml(word)}</tspan>`).join(' ')}</text>`));
  } else if (layer === 'title') {
    const headline = wrapWords(keepNumbersTogether(card?.headline || title), 38, 2);
    parts.push(`<rect x="0" y="200" width="${REEL.width}" height="${top - 200}" fill="#070d14" fill-opacity="0.45"/>`,
      `<circle cx="${PAD.x + 14}" cy="245" r="14" fill="none" stroke="#00d4ff" stroke-width="4"/><circle cx="${PAD.x + 14}" cy="245" r="5" fill="#00d4ff"/>`,
      `<text x="${PAD.x + 40}" y="255" font-family="${MONO}" font-size="28" font-weight="700" letter-spacing="6" fill="#e8f1f7">OKO</text>`,
      `<text x="${PAD.x + PAD.w}" y="255" text-anchor="end" font-family="${MONO}" font-size="24" letter-spacing="3" fill="#00d4ff">${escapeXml(card?.kicker || '')}</text>`);
    headline.forEach((row, i) => parts.push(`<text x="${PAD.x}" y="${top - 30 - (headline.length - 1 - i) * 52}" font-family="${FONT}" font-size="44" font-weight="700" fill="#e8f1f7" stroke="#061019" stroke-width="6" paint-order="stroke">${escapeXml(row)}</text>`));
  } else {
    const bottom = PAD.y + PAD.h;
    parts.push(`<text x="${PAD.x}" y="${bottom + 48}" font-family="${FONT}" font-size="26" fill="#a9c2d2" stroke="#061019" stroke-width="5" paint-order="stroke">Zdroj: ${escapeXml(card?.source || 'OKO')}</text>`,
      `<rect x="${PAD.x}" y="${bottom + 72}" width="${Math.min(PAD.w, 60 + site.length * 24 + 240)}" height="60" rx="30" fill="#070d14" fill-opacity="0.7" stroke="#00d4ff88" stroke-width="2"/>`,
      `<text x="${PAD.x + 30}" y="${bottom + 112}" font-family="${MONO}" font-size="28" fill="#bff2ff">Naživo na ${escapeXml(site)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL.width}" height="${REEL.height}">${parts.join('')}</svg>`;
}

/**
 * Importované video → reel 9:16. S kartou: rám s háčikom, titulkom a zdrojom (padOverlaySvg); bez karty
 * (staršie volania) ako predtým: video na celú šírku nad rozmazaným pozadím. Vracia { bytes, seconds }.
 */
export async function padToReel(inFile, outFile, { env = process.env, card = null, title = '', site = 'okolive.sk', hookSheet = null } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  // Video už vyrobené na 9:16 so svojím rámom a háčikom (Deň na fronte): bez doplnenia, len kópia a pás háčika.
  if (card?.vertical) {
    await copyFile(inFile, outFile);
    if (hookSheet) await videoHookSheet(outFile, hookSheet, { env });
    return { bytes: (await stat(outFile)).size, seconds: await probeSeconds(outFile, { env }) };
  }
  const background = `[0:v]split=2[bg][fg];[bg]scale=${REEL.width}:${REEL.height}:force_original_aspect_ratio=increase,crop=${REEL.width}:${REEL.height},gblur=sigma=30,eq=brightness=${card ? -0.2 : -0.12}[bgb];`;
  const encode = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-g', String(REEL.fps * 2), '-r', String(REEL.fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', outFile];
  if (!card) {
    const filter = `${background}[fg]scale=${REEL.width}:-2:force_original_aspect_ratio=decrease[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuv420p[v]`;
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', ...encode], { timeoutMs: 10 * 60_000 });
  } else {
    const work = await mkdtemp(path.join(tmpdir(), 'oko-pad-'));
    try {
      const layers = {};
      for (const layer of ['hook', 'title', 'bottom']) {
        layers[layer] = path.join(work, `${layer}.png`);
        await sharp(Buffer.from(padOverlaySvg(card, layer, { title, site }))).png().toFile(layers[layer]);
      }
      const filter = `${background}[fg]scale=${PAD.w}:${PAD.h}:force_original_aspect_ratio=decrease[fgs];`
        + `[bgb][fgs]overlay=${PAD.x}+(${PAD.w}-w)/2:${PAD.y}+(${PAD.h}-h)/2[base];`
        + `[base][1:v]overlay=0:0:enable='lt(t,${HOOK_END})'[h];[h][2:v]overlay=0:0:enable='gte(t,${HOOK_END})'[t];[t][3:v]overlay=0:0,format=yuv420p[v]`;
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inFile, '-i', layers.hook, '-i', layers.title, '-i', layers.bottom,
        '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', ...encode], { timeoutMs: 10 * 60_000 });
    } finally { await rm(work, { recursive: true, force: true }); }
  }
  if (hookSheet) await videoHookSheet(outFile, hookSheet, { env });
  return { bytes: (await stat(outFile)).size, seconds: await probeSeconds(outFile, { env }) };
}

/** Pás háčika z hotového videa (snímky 0, 1, 2, 3 s) — pre importované reely. */
export async function videoHookSheet(videoFile, outFile, { env = process.env } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const work = await mkdtemp(path.join(tmpdir(), 'oko-hook-'));
  try {
    const frames = [];
    for (const at of [0, 1, 2, 3]) {
      const file = path.join(work, `${at}.png`);
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', videoFile, '-frames:v', '1', '-vf', `scale=${HOOK_SHEET.w}:${HOOK_SHEET.h}`, file], { timeoutMs: 60_000 });
      try { frames.push(await readFile(file)); } catch { /* video kratšie než `at` */ }
    }
    if (!frames.length) return false;
    await sharp({ create: { width: HOOK_SHEET.w * frames.length + HOOK_SHEET.gap * (frames.length - 1), height: HOOK_SHEET.h, channels: 3, background: '#070d14' } })
      .composite(frames.map((input, i) => ({ input, left: i * (HOOK_SHEET.w + HOOK_SHEET.gap), top: 0 }))).jpeg({ quality: 82 }).toFile(outFile);
    return true;
  } finally { await rm(work, { recursive: true, force: true }); }
}

/** Prvá snímka videa ako JPEG (obrázok príspevku k importovanému videu). */
export async function posterFrame(inFile, { env = process.env, at = 1 } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const work = await mkdtemp(path.join(tmpdir(), 'oko-poster-'));
  try {
    const out = path.join(work, 'poster.jpg');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', inFile, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60_000 });
    return await readFile(out);
  } finally { await rm(work, { recursive: true, force: true }); }
}

/** Je ffmpeg dostupný? (cesta z FFMPEG_PATH alebo PATH) */
export async function ffmpegAvailable(bin = process.env.FFMPEG_PATH || 'ffmpeg') {
  try { await run(bin, ['-hide_banner', '-version'], { timeoutMs: 10_000 }); return true; } catch { return false; }
}

async function pickMusic(dir, seed) {
  if (!dir) return null;
  try {
    const files = (await readdir(dir)).filter(name => /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)).sort();
    if (!files.length) return null;
    let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return path.join(dir, files[h % files.length]);
  } catch { return null; }
}

/**
 * Vyrenderuje reel do `outFile`. Vracia { seconds, audio, voice }.
 * @param {object} item { card, title, text } z šablóny
 * @param {object} options { audio: 'ambient'|'music'|'none', voice: boolean, env, site, onProgress }
 */
export async function renderReel(item, outFile, { audio = 'ambient', voice = false, env = process.env, site = 'okolive.sk', onProgress = () => {},
  seconds: baseSeconds = REEL.seconds, fps = REEL.fps, voiceProvider = null, captions: wantCaptions = true, hookSheet = null } = {}) {
  const ffmpeg = env.FFMPEG_PATH || 'ffmpeg';
  const work = await mkdtemp(path.join(tmpdir(), 'oko-reel-'));
  try {
    // 1) hlas (voliteľný) určí dĺžku
    let voiceFile = null; let seconds = baseSeconds;
    if (voice && voiceProvider) {
      // Hlas vlastníka (ai-translators cez pamäť nahrávok Udalostí); null = poskytovateľ nedostupný → bez hlasu.
      const wav = await voiceProvider(narration(item));
      if (wav) { voiceFile = path.join(work, 'voice.wav'); await writeFile(voiceFile, await readFile(wav)); }
    } else if (voice && env.PIPER_PATH && env.PIPER_MODEL) {
      voiceFile = path.join(work, 'voice.wav');
      await run(env.PIPER_PATH, ['--model', env.PIPER_MODEL, '--output_file', voiceFile], { input: narration(item), timeoutMs: 60_000 });
    }
    let speech = 0;
    if (voiceFile) {
      speech = wavSeconds(await readFile(voiceFile));
      seconds = Math.min(30, Math.max(baseSeconds, Math.ceil(speech + 3)));
    }
    // Titulky: s hlasom kopírujú nahrávku (začína po 1,2 s), bez hlasu vyplnia čas medzi úvodom a výzvou.
    // Bez hlasu začnú titulky až po háčiku (počas neho je veta háčika na obrazovke).
    const captions = !wantCaptions ? [] : speech ? captionsFor(item, { start: 1.2, length: speech })
      : captionsFor(silentCaptionText(item), { start: HOOK_END + HOOK_SWAP, length: Math.max(3, seconds - HOOK_END - 3.2) });
    // 2) snímky → ffmpeg stdin (raw RGB)
    const frames = seconds * fps;
    const background = await sharp(Buffer.from(backgroundSvg())).png().toBuffer();
    const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
      '-s', `${REEL.width}x${REEL.height}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-g', String(fps * 2), '-flags', '+cgop', '-movflags', '+faststart', path.join(work, 'video.mp4')],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let encoderError = '';
    encoder.stderr.on('data', chunk => { encoderError = (encoderError + chunk).slice(-4000); });
    const encoderDone = once(encoder, 'close');
    let staticMap = null; let lastMapKey = '';
    const hookFrames = [];
    // Posun bez priblíženia (prehľad): mapa sa vyrenderuje raz ako panoráma a len sa oreže.
    let panorama = null;
    const first = reelView(item.card, 0); const last = reelView(item.card, seconds);
    if (!item.card.point && first.span === last.span) {
      const ppd = MAP.w / first.span;
      const west = Math.min(first.lon, last.lon) - first.span / 2;
      const spanAll = Math.abs(last.lon - first.lon) + first.span;
      const width = Math.ceil(spanAll * ppd) + 2;
      panorama = { west, ppd, width, image: await sharp(Buffer.from(mapLayerSvg({ lon: west + spanAll / 2, lat: first.lat, span: spanAll }, width, MAP.h))).png().toBuffer() };
    }
    for (let f = 0; f < frames; f++) {
      const t = f / fps;
      const view = reelView(item.card, t);
      if (panorama) {
        const left = Math.max(0, Math.min(panorama.width - MAP.w, Math.round((view.lon - view.span / 2 - panorama.west) * panorama.ppd)));
        if (String(left) !== lastMapKey) {
          staticMap = await sharp(panorama.image).extract({ left, top: 0, width: MAP.w, height: MAP.h }).png({ compressionLevel: 1 }).toBuffer();
          lastMapKey = String(left);
        }
      } else {
        const key = `${view.lon.toFixed(3)}|${view.lat.toFixed(3)}|${view.span.toFixed(3)}`;
        if (key !== lastMapKey) { staticMap = await sharp(Buffer.from(mapLayerSvg(view))).png({ compressionLevel: 1 }).toBuffer(); lastMapKey = key; }
      }
      const frame = await sharp(background).composite([{ input: staticMap, left: MAP.x, top: MAP.y },
        { input: Buffer.from(overlaySvg(item.card, t, { seconds, site, captions })), left: 0, top: 0 }]).removeAlpha().raw().toBuffer();
      // Pás háčika: snímky 0, 1, 2, 3 s — v admine pred schválením (čo divák uvidí ako prvé).
      if (hookSheet && f % fps === 0 && f / fps <= 3) {
        hookFrames.push(await sharp(frame, { raw: { width: REEL.width, height: REEL.height, channels: 3 } }).resize(HOOK_SHEET.w, HOOK_SHEET.h).png().toBuffer());
      }
      if (!encoder.stdin.write(frame)) await once(encoder.stdin, 'drain');
      if (f % fps === 0) onProgress(f / frames);
    }
    encoder.stdin.end();
    const [code] = await encoderDone;
    if (code !== 0) throw new Error(`ffmpeg (video): ${encoderError.trim().split('\n').slice(-2).join(' | ')}`);
    // 3) zvuk
    const inputs = ['-i', path.join(work, 'video.mp4')];
    const filters = [];
    let mixInputs = 0;
    const fadeOut = Math.max(0, seconds - 2);
    if (audio === 'ambient' || (audio === 'music' && !(await pickMusic(env.STUDIO_MUSIC_DIR, item.title)))) {
      inputs.push('-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=110:sample_rate=48000',
        '-f', 'lavfi', '-t', String(seconds), '-i', 'sine=frequency=164.81:sample_rate=48000',
        '-f', 'lavfi', '-t', String(seconds), '-i', 'anoisesrc=color=brown:amplitude=0.6:sample_rate=48000');
      filters.push(`[1:a]volume=0.10,tremolo=f=0.15:d=0.5[a1]`, `[2:a]volume=0.06,tremolo=f=0.11:d=0.6[a2]`,
        `[3:a]lowpass=f=400,volume=0.05[a3]`, `[a1][a2][a3]amix=inputs=3:normalize=0,afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2[bed]`);
      mixInputs = 4;
    } else if (audio === 'music') {
      inputs.push('-stream_loop', '-1', '-i', await pickMusic(env.STUDIO_MUSIC_DIR, item.title));
      filters.push(`[1:a]atrim=0:${seconds},aresample=48000,volume=0.5,afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=2[bed]`);
      mixInputs = 2;
    }
    if (voiceFile) {
      inputs.push('-i', voiceFile);
      const v = mixInputs || 1;
      filters.push(`[${v}:a]aresample=48000,adelay=1200|1200,volume=1.4[voice]`);
      filters.push(mixInputs ? `[bed]volume=0.45[bedlow];[bedlow][voice]amix=inputs=2:normalize=0:duration=first[aout]` : `[voice]apad=whole_dur=${seconds}[aout]`);
    } else if (mixInputs) filters.push('[bed]anull[aout]');
    const out = path.join(work, 'final.mp4');
    if (filters.length) {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
        '-shortest', '-movflags', '+faststart', out]);
    } else {
      // Bez zvuku: tichá stopa (niektoré platformy video bez zvuku odmietnu).
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(work, 'video.mp4'), '-f', 'lavfi', '-t', String(seconds),
        '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', out]);
    }
    await writeFile(outFile, await readFile(out));
    if (hookSheet && hookFrames.length) {
      await sharp({ create: { width: HOOK_SHEET.w * hookFrames.length + HOOK_SHEET.gap * (hookFrames.length - 1), height: HOOK_SHEET.h, channels: 3, background: '#070d14' } })
        .composite(hookFrames.map((input, i) => ({ input, left: i * (HOOK_SHEET.w + HOOK_SHEET.gap), top: 0 }))).jpeg({ quality: 82 }).toFile(hookSheet);
    }
    onProgress(1);
    return { seconds, audio: filters.length ? (audio === 'music' && mixInputs === 2 ? 'music' : mixInputs ? 'ambient' : 'none') : 'none',
      voice: Boolean(voiceFile), captions: captions.length, bytes: (await stat(outFile)).size };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
