// src/data/eventCard.js — obrázok udalosti pre FB a náhľad odkazu (Udalosti, etapa 2, 2026-09-30,
// vlastník: „aby som ich vedel pekne graficky postnúť na FB"). Čistý štýl mapy ako KARTA (odporúčané
// v návrhu: čitateľné na mobile, bez licenčných otáznikov): more z Natural Earth (voľné dielo),
// hranice 1:50m, stopa letu (plná = merania, čiarkovaná = bez údajov — nič sa nedopočítava),
// očíslované momenty, profil výšky, časová os, stav overenia a zdroje. Formáty: og 1200×630
// (náhľad odkazu), feed 1080×1350 (príspevok s obrázkom). Pure — SVG reťazec; na JPEG ho prevedie
// server (sharp). Mapové podklady dostane v parametroch (testy s malými tvarmi).

import { eventWhat, flightLine, keyMoments, outletName } from './eventPost.js';
import { clockUtc, momentPhrase } from './eventTimeline.js';

export const CARD_FORMATS = Object.freeze({ og: { w: 1200, h: 630 }, feed: { w: 1080, h: 1350 } });
/** Diera v stope, ktorá sa kreslí čiarkovane (rovnako ako na časovej osi). */
export const CARD_GAP_S = 300;
const COLORS = Object.freeze({
  bg: '#07131f', land: '#243442', sea: '#0a1622', border: '#5b7488', track: '#39d0ff', gap: '#8aa4b4',
  marker: '#ffb020', markerText: '#1a1204', text: '#e7f3f9', muted: '#8fa6b4', ok: '#4ade80', warn: '#fbbf24', panel: '#0c1c2a',
});
const FONT = "'Segoe UI', 'Noto Sans', Arial, sans-serif";

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Zjednodušená stopa pre obrázok a verejný pohľad: spojené body oboch sietí, najviac `max` bodov,
 * body na krajoch dier (≥ 5 min) sa zachovajú. [[t, lat, lon, altFt|null]]. Pure.
 */
export function simplifyTrack(points, max = 400) {
  const pts = [...(points || [])].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).sort((a, b) => a.t - b.t);
  if (!pts.length) return [];
  const keep = new Set([0, pts.length - 1]);
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i].t - pts[i - 1].t >= CARD_GAP_S) { keep.add(i - 1); keep.add(i); }
  }
  const step = Math.max(1, Math.ceil(pts.length / Math.max(1, max - keep.size)));
  for (let i = 0; i < pts.length; i += step) keep.add(i);
  return [...keep].sort((a, b) => a - b).map((i) => {
    const p = pts[i];
    return [p.t, Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4, p.alt == null || p.gnd ? (p.gnd ? 0 : null) : Math.round(p.alt / 0.3048)];
  });
}

/**
 * Okno udalosti v čase: od 20 min pred prvým spúšťačom po posledný kľúčový moment + 20 min.
 * Mapa aj profil výšky sa zamerajú naň (cesta z letiska odletu len vbehne od okraja). Pure.
 */
export function incidentWindow(event, moments = keyMoments(event)) {
  const from = (event.firstT ?? 0) - 20 * 60;
  const lastMoment = Math.max(event.lastT ?? event.firstT ?? 0, ...moments.map((m) => m.endT ?? m.t));
  return [from, lastMoment + 20 * 60];
}

/** Výrez mapy: stopa v okne udalosti + letiská trasy do ~700 km, s okrajom a pomerom plochy. Pure. */
export function cardBBox(track, route, aspect) {
  const lats = track.map((p) => p[1]);
  const lons = track.map((p) => p[2]);
  let [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const near = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lon)
    && a.lat > s - 6.3 && a.lat < n + 6.3 && a.lon > w - 8 && a.lon < e + 8;
  for (const a of [route?.origin, route?.destination]) {
    if (!near(a)) continue;
    s = Math.min(s, a.lat); n = Math.max(n, a.lat); w = Math.min(w, a.lon); e = Math.max(e, a.lon);
  }
  const midLat = (s + n) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  let spanX = Math.max(0.5, (e - w) * kx);
  let spanY = Math.max(0.5, n - s);
  spanX *= 1.25; spanY *= 1.25; // okraj
  if (spanX / spanY < aspect) spanX = spanY * aspect; else spanY = spanX / aspect;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  return { w: cx - spanX / kx / 2, e: cx + spanX / kx / 2, s: cy - spanY / 2, n: cy + spanY / 2, kx };
}

/** Projekcia do obdĺžnika mapy (ekvidistantná s kosínusom stredu). Pure. */
export function projector(bbox, rect) {
  const sx = rect.w / ((bbox.e - bbox.w) * bbox.kx);
  const sy = rect.h / (bbox.n - bbox.s);
  return (lon, lat) => [rect.x + (lon - bbox.w) * bbox.kx * sx, rect.y + (bbox.n - lat) * sy];
}

/** Orezanie polygónu obdĺžnikom (Sutherland–Hodgman) v súradniciach obrázka. Pure. */
export function clipRing(ring, x0, y0, x1, y1) {
  let out = ring;
  const edges = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= y0, (a, b) => { const t = (y0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y0]; }],
    [(p) => p[1] <= y1, (a, b) => { const t = (y1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), y1]; }],
  ];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i += 1) {
      const cur = src[i];
      const prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cut(prev, cur));
      }
    }
  }
  return out;
}

const pathOf = (pts, close) => {
  let d = '';
  let last = null;
  for (const p of pts) {
    if (last && Math.abs(p[0] - last[0]) < 0.8 && Math.abs(p[1] - last[1]) < 0.8) continue;
    d += `${d ? 'L' : 'M'}${fmt1(p[0])} ${fmt1(p[1])}`;
    last = p;
  }
  return d && close ? `${d}Z` : d;
};

/** Zalomenie textu podľa odhadu šírky znaku. Pure. */
export function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

const dateSk = (tS) => { const d = new Date(tS * 1000); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`; };

/**
 * SVG obrázka udalosti.
 * @param {object} event uložená udalosť (s `track` zo simplifyTrack)
 * @param {{format?: 'og'|'feed', marine?: Array<{polygons:number[][][]}>, borders?: number[][][]}} opts
 */
export function buildEventCardSvg(event, { format = 'og', marine = [], borders = [] } = {}) {
  const { w: W, h: H } = CARD_FORMATS[format] || CARD_FORMATS.og;
  const feed = format === 'feed';
  const map = feed ? { x: 0, y: 0, w: W, h: 760 } : { x: 0, y: 0, w: 720, h: H };
  const chart = feed ? { x: 40, y: 640, w: W - 80, h: 100 } : { x: 30, y: H - 118, w: map.w - 60, h: 88 };
  const track = Array.isArray(event.track) ? event.track : [];
  const k = feed ? 1.4 : 1; // popisy a značky mapy na výške 1350 px väčšie
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  out.push(`<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`);
  out.push(`<defs><clipPath id="m"><rect x="${map.x}" y="${map.y}" width="${map.w}" height="${map.h}"/></clipPath></defs>`);
  const moments = keyMoments(event);
  const [winFrom, winTo] = incidentWindow(event, moments);
  const focus = track.filter((p) => p[0] >= winFrom && p[0] <= winTo);
  if (track.length) {
    // Obsah mapy sa zmestí nad profil výšky (ten prekrýva spodok mapy); podklad ide ďalej pod neho.
    const fit = { x: map.x, y: map.y, w: map.w, h: chart.y - 30 - map.y };
    const bbox = cardBBox(focus.length >= 2 ? focus : track, event.route, fit.w / fit.h);
    const P = projector(bbox, fit);
    out.push(`<g clip-path="url(#m)"><rect x="${map.x}" y="${map.y}" width="${map.w}" height="${map.h}" fill="${COLORS.land}"/>`);
    // More: polygóny Natural Earth, ktoré zasahujú do výrezu, orezané na výrez.
    let sea = '';
    for (const f of marine) {
      for (const ring of f.polygons || []) {
        let inBox = false;
        for (const [lon, lat] of ring) { if (lon >= bbox.w - 5 && lon <= bbox.e + 5 && lat >= bbox.s - 5 && lat <= bbox.n + 5) { inBox = true; break; } }
        if (!inBox) continue;
        const clipped = clipRing(ring.map(([lon, lat]) => P(lon, lat)), map.x - 2, map.y - 2, map.x + map.w + 2, map.y + map.h + 2);
        if (clipped.length >= 3) sea += pathOf(clipped, true);
      }
    }
    if (sea) out.push(`<path d="${sea}" fill="${COLORS.sea}" fill-rule="evenodd"/>`);
    let lines = '';
    for (const line of borders) {
      if (!line.some(([lon, lat]) => lon >= bbox.w && lon <= bbox.e && lat >= bbox.s && lat <= bbox.n)) continue;
      lines += pathOf(line.map(([lon, lat]) => P(lon, lat)), false);
    }
    if (lines) out.push(`<path d="${lines}" fill="none" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="4 3"/>`);
    // Stopa: merania plnou, diery čiarkovane (bez dopočítania trasy).
    const pts = track.map((p) => P(p[2], p[1]));
    let solid = '';
    let gaps = '';
    for (let i = 1; i < track.length; i += 1) {
      const seg = `M${fmt1(pts[i - 1][0])} ${fmt1(pts[i - 1][1])}L${fmt1(pts[i][0])} ${fmt1(pts[i][1])}`;
      if (track[i][0] - track[i - 1][0] >= CARD_GAP_S) gaps += seg; else solid += seg;
    }
    if (gaps) out.push(`<path d="${gaps}" fill="none" stroke="${COLORS.gap}" stroke-width="2" stroke-dasharray="7 6" stroke-linecap="round"/>`);
    if (solid) out.push(`<path d="${solid}" fill="none" stroke="${COLORS.track}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`);
    // Letiská trasy (plán letu z adsbdb) — štvorček a kód.
    for (const a of [event.route?.origin, event.route?.destination]) {
      if (!a || !Number.isFinite(a.lat) || a.lat < bbox.s || a.lat > bbox.n || a.lon < bbox.w || a.lon > bbox.e) continue;
      const [x, y] = P(a.lon, a.lat);
      const label = `${a.iata || a.icao || ''} ${a.city || ''}`.trim();
      const right = x > map.x + map.w - label.length * 8.5 * k - 20; // pri pravom okraji popis vľavo od bodu
      out.push(`<rect x="${fmt1(x - 4 * k)}" y="${fmt1(y - 4 * k)}" width="${8 * k}" height="${8 * k}" fill="${COLORS.text}"/>`);
      out.push(`<text x="${fmt1(right ? x - 8 : x + 8)}" y="${fmt1(y - 6)}" font-size="${15 * k}" text-anchor="${right ? 'end' : 'start'}" fill="${COLORS.text}">${esc(label)}</text>`);
    }
    // Očíslované momenty; značka, ktorá by prekryla predošlú, sa odsunie po kružnici.
    const placed = [];
    moments.forEach((m, i) => {
      if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) return;
      let [x, y] = P(m.lon, m.lat);
      const [ox, oy] = [x, y];
      for (let step = 1; step <= 12 && placed.some(([px, py]) => Math.hypot(px - x, py - y) < 27 * k); step += 1) {
        const a = (step * 2 * Math.PI) / 6;
        const r = 27 * k * Math.ceil(step / 6);
        x = ox + r * Math.cos(a);
        y = oy + r * Math.sin(a);
      }
      placed.push([x, y]);
      if (x !== ox || y !== oy) out.push(`<line x1="${fmt1(ox)}" y1="${fmt1(oy)}" x2="${fmt1(x)}" y2="${fmt1(y)}" stroke="${COLORS.marker}" stroke-width="1.5"/>`);
      out.push(`<circle cx="${fmt1(x)}" cy="${fmt1(y)}" r="${13 * k}" fill="${COLORS.marker}" stroke="${COLORS.bg}" stroke-width="2"/>`);
      out.push(`<text x="${fmt1(x)}" y="${fmt1(y + 5 * k)}" font-size="${14 * k}" font-weight="700" text-anchor="middle" fill="${COLORS.markerText}">${i + 1}</text>`);
    });
    out.push('</g>');
    // Profil výšky (ft) v okne udalosti.
    const alts = (focus.length >= 2 ? focus : track).filter((p) => p[3] != null);
    if (alts.length >= 2) {
      const t0 = focus.length >= 2 ? Math.max(winFrom, focus[0][0]) : track[0][0];
      const t1 = focus.length >= 2 ? Math.min(winTo, focus[focus.length - 1][0]) : track[track.length - 1][0];
      const maxFt = Math.max(1000, ...alts.map((p) => p[3]));
      const X = (t) => chart.x + ((t - t0) / Math.max(1, t1 - t0)) * chart.w;
      const Y = (ft) => chart.y + chart.h - (ft / maxFt) * chart.h;
      out.push(`<rect x="${chart.x - 10}" y="${chart.y - 22}" width="${chart.w + 20}" height="${chart.h + 32}" rx="8" fill="${COLORS.bg}" fill-opacity="0.82"/>`);
      out.push(`<text x="${chart.x}" y="${chart.y - 7}" font-size="${13 * k}" fill="${COLORS.muted}">Výška (ft) · ${clockUtc(t0).slice(0, 5)}–${clockUtc(t1).slice(0, 5)} UTC</text>`);
      let line = '';
      for (let i = 0; i < alts.length; i += 1) {
        const gap = i > 0 && alts[i][0] - alts[i - 1][0] >= CARD_GAP_S;
        line += `${!i || gap ? 'M' : 'L'}${fmt1(X(alts[i][0]))} ${fmt1(Y(alts[i][3]))}`;
      }
      out.push(`<path d="${line}" fill="none" stroke="${COLORS.track}" stroke-width="2"/>`);
      moments.forEach((m, i) => {
        if (m.t < t0 || m.t > t1) return;
        const x = X(m.t);
        out.push(`<line x1="${fmt1(x)}" y1="${chart.y}" x2="${fmt1(x)}" y2="${chart.y + chart.h}" stroke="${COLORS.marker}" stroke-width="1" stroke-dasharray="3 3"/>`);
        out.push(`<text x="${fmt1(x + 3)}" y="${chart.y + 12 * k}" font-size="${12 * k}" font-weight="700" fill="${COLORS.marker}">${i + 1}</text>`);
      });
    }
  }
  // Textový panel.
  const panel = feed ? { x: 48, y: 800, w: W - 96 } : { x: 752, y: 44, w: W - 752 - 36 };
  const titleSize = feed ? 40 : 30;
  const maxChars = Math.floor(panel.w / (titleSize * 0.53));
  let y = panel.y;
  for (const l of wrapText(eventWhat(event), maxChars).slice(0, 3)) {
    out.push(`<text x="${panel.x}" y="${y}" font-size="${titleSize}" font-weight="700" fill="${COLORS.text}">${esc(l)}</text>`);
    y += titleSize * 1.18;
  }
  const lineSize = feed ? 28 : 18;
  for (const l of wrapText(flightLine(event), Math.floor(panel.w / (lineSize * 0.52))).slice(0, 2)) {
    out.push(`<text x="${panel.x}" y="${y + 2}" font-size="${lineSize}" font-weight="600" fill="${COLORS.track}">${esc(l)}</text>`);
    y += lineSize * 1.3;
  }
  const sub = [dateSk(event.firstT), event.reg, event.typeCode].filter(Boolean).join(' · ');
  out.push(`<text x="${panel.x}" y="${y + 4}" font-size="${feed ? 24 : 18}" fill="${COLORS.muted}">${esc(sub)}</text>`);
  y += feed ? 50 : 38;
  const verified = event.status === 'confirmed' && event.news?.status === 'verified';
  const media = verified ? event.news.trusted.length : 0;
  const badge = verified ? `OVERENÉ: 2 siete prijímačov + ${media} ${media >= 5 ? 'médií' : 'médiá'}` : 'NÁHĽAD — ešte neoverené';
  out.push(`<rect x="${panel.x}" y="${y - (feed ? 26 : 20)}" width="${Math.min(panel.w, badge.length * (feed ? 13.5 : 10.4) + 24)}" height="${feed ? 38 : 30}" rx="6" fill="${verified ? COLORS.ok : COLORS.warn}" fill-opacity="0.16" stroke="${verified ? COLORS.ok : COLORS.warn}"/>`);
  out.push(`<text x="${panel.x + 12}" y="${y}" font-size="${feed ? 22 : 16}" font-weight="700" fill="${verified ? COLORS.ok : COLORS.warn}">${esc(badge)}</text>`);
  y += feed ? 56 : 42;
  const itemSize = feed ? 25 : 17;
  const itemChars = Math.floor((panel.w - 40) / (itemSize * 0.5));
  out.push(`<text x="${panel.x}" y="${y}" font-size="${itemSize - 2}" fill="${COLORS.muted}">Časy UTC · ${esc('OpenSky + adsb.lol')}</text>`);
  y += itemSize * 1.5;
  moments.forEach((m, i) => {
    const nets = (m.seenBy || []).filter((id) => id === 'opensky' || id === 'adsblol');
    const only = nets.length === 1 ? ` (len ${nets[0] === 'adsblol' ? 'adsb.lol' : 'OpenSky'})` : '';
    const lines = wrapText(`${clockUtc(m.t).slice(0, 5)} ${momentPhrase(m, 'sk')}${only}`, itemChars);
    out.push(`<circle cx="${panel.x + 11}" cy="${y - itemSize * 0.34}" r="${itemSize * 0.58}" fill="${COLORS.marker}"/>`);
    out.push(`<text x="${panel.x + 11}" y="${y}" font-size="${itemSize * 0.78}" font-weight="700" text-anchor="middle" fill="${COLORS.markerText}">${i + 1}</text>`);
    for (const l of lines.slice(0, 2)) {
      out.push(`<text x="${panel.x + 32}" y="${y}" font-size="${itemSize}" fill="${COLORS.text}">${esc(l)}</text>`);
      y += itemSize * 1.25;
    }
    y += itemSize * 0.25;
  });
  if (verified) {
    const names = [...new Set(event.news.trusted.map((t) => outletName(t.domain)))];
    y += itemSize * 0.4;
    for (const l of wrapText(`Médiá: ${names.join(', ')}`, itemChars + 4).slice(0, 3)) {
      out.push(`<text x="${panel.x}" y="${y}" font-size="${itemSize - 2}" fill="${COLORS.muted}">${esc(l)}</text>`);
      y += (itemSize - 2) * 1.3;
    }
  }
  const foot = 'okolive.sk · údaje OpenSky Network, adsb.lol (ODbL) · mapa Natural Earth';
  out.push(`<text x="${feed ? panel.x : panel.x}" y="${H - (feed ? 36 : 22)}" font-size="${feed ? 20 : 13}" fill="${COLORS.muted}">${esc(foot)}</text>`);
  out.push('</svg>');
  return out.join('');
}
