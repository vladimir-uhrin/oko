// src/data/eventCard.js — obrázok udalosti pre FB a náhľad odkazu (Udalosti, etapa 2, 2026-09-30,
// vlastník: „aby som ich vedel pekne graficky postnúť na FB"). Čistý štýl mapy ako KARTA (odporúčané
// v návrhu: čitateľné na mobile, bez licenčných otáznikov): more z Natural Earth (voľné dielo),
// hranice 1:50m, stopa letu (plná = merania, čiarkovaná = bez údajov — nič sa nedopočítava),
// očíslované momenty, profil výšky, časová os, stav overenia a zdroje. Formáty: og 1200×630
// (náhľad odkazu), feed 1080×1350 (príspevok s obrázkom). Pure — SVG reťazec; na JPEG ho prevedie
// server (sharp). Mapové podklady dostane v parametroch (testy s malými tvarmi).

import { NETWORK_NAMES, eventWhat, flightLine, incidentWindow, isPublishable, keyMoments, networksWithData, outletName, verifiedSources } from './eventPost.js';
import { clockUtc, momentPhrase } from './eventTimeline.js';

export { incidentWindow };

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
 * Výrez mapy: stopa v okne udalosti + letiská trasy do ~700 km, s okrajom a pomerom plochy. `extra` =
 * miesta, ktoré musia byť vidieť vždy (pristátie zo správ). Pure.
 */
export function cardBBox(track, route, aspect, extra = []) {
  const lats = track.map((p) => p[1]);
  const lons = track.map((p) => p[2]);
  let [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const near = (a) => a && Number.isFinite(a.lat) && Number.isFinite(a.lon)
    && a.lat > s - 6.3 && a.lat < n + 6.3 && a.lon > w - 8 && a.lon < e + 8;
  for (const a of [route?.origin, route?.destination]) {
    if (!near(a)) continue;
    s = Math.min(s, a.lat); n = Math.max(n, a.lat); w = Math.min(w, a.lon); e = Math.max(e, a.lon);
  }
  for (const a of extra) {
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
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

/** Riadok zoznamu momentov: čas, opis a sieť, ak moment videla len jedna. Pure. */
function momentItemText(m) {
  const nets = (m.seenBy || []).filter((id) => id === 'opensky' || id === 'adsblol');
  const only = nets.length === 1 ? ` (len ${nets[0] === 'adsblol' ? 'adsb.lol' : 'OpenSky'})` : '';
  return `${clockUtc(m.t).slice(0, 5)} ${momentPhrase(m, 'sk')}${only}`;
}

/** „+ N ďalší moment / ďalšie momenty / ďalších momentov" — momenty, ktoré sa nezmestili do zoznamu. Pure. */
export function moreMomentsSk(n) {
  if (n === 1) return '+ 1 ďalší moment';
  return `+ ${n} ${n >= 2 && n <= 4 ? 'ďalšie momenty' : 'ďalších momentov'}`;
}

/**
 * Rozloženie zoznamu momentov v paneli obrázka a videa tak, aby sa zmestil nad pätu so zdrojmi: najprv
 * menšie písmo (najmenej 80 % základného), až potom len prvé momenty a riadok „+ N ďalších". Miesto pre
 * médiá sa počíta vždy — vo videu pribudnú až v závere a zoznam pritom neskáče. Pure.
 * @param {{moments: object[], media?: string[], headY: number, width: number, baseSize: number, bottom: number}} opts
 *   headY = základňa riadku „Časy UTC", bottom = najnižšia povolená základňa textu
 * @returns {{size: number, items: Array<{lines: string[], y: number}>, more: number, moreY: number|null,
 *   media: string[], mediaY: number|null, last: number}}
 */
export function cardListLayout({ moments, media = [], headY, width, baseSize, bottom }) {
  const layout = (size, count) => {
    const chars = Math.floor((width - 40) / (size * 0.5));
    let y = headY + size * 1.5;
    let last = headY;
    const items = moments.slice(0, count).map((m) => {
      const lines = wrapText(momentItemText(m), chars).slice(0, 2);
      const item = { lines, y };
      last = y + (lines.length - 1) * size * 1.25;
      y += lines.length * size * 1.25 + size * 0.25;
      return item;
    });
    const more = moments.length - count;
    let moreY = null;
    if (more > 0) { moreY = y; last = y; y += size * 1.5; }
    const mediaLines = media.length ? wrapText(`Médiá: ${media.join(', ')}`, chars + 4).slice(0, 3) : [];
    let mediaY = null;
    if (mediaLines.length) { mediaY = y + size * 0.4; last = mediaY + (mediaLines.length - 1) * (size - 2) * 1.3; }
    return { size, items, more, moreY, media: mediaLines, mediaY, last };
  };
  const minSize = Math.round(baseSize * 0.8);
  for (let count = moments.length; count >= 0; count -= 1) {
    for (let size = baseSize; size >= minSize; size -= 1) {
      const l = layout(size, count);
      if (l.last <= bottom) return l;
    }
  }
  return layout(minSize, 0);
}

/**
 * Stav stopy v čase t (snímka videa): index úseku `i`, podiel `f` medzi bodmi i a i+1, či je úsek
 * diera bez údajov (`inGap`), pred začiatkom / po konci stopy. Pure.
 * @param {Array<[number, number, number, number|null]>} track
 * @param {number} t
 */
export function trackStateAt(track, t) {
  if (!Array.isArray(track) || !track.length || !Number.isFinite(t)) return null;
  const last = track.length - 1;
  if (t <= track[0][0]) return { i: 0, f: 0, inGap: false, before: t < track[0][0], after: false };
  if (t >= track[last][0]) return { i: last, f: 0, inGap: false, before: false, after: t > track[last][0] };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= t) lo = mid; else hi = mid;
  }
  const dt = track[hi][0] - track[lo][0];
  return { i: lo, f: dt > 0 ? (t - track[lo][0]) / dt : 0, inGap: dt >= CARD_GAP_S, before: false, after: false };
}

/**
 * Časový rozsah obrázka a videa udalosti (graf výšky aj prehrávanie): od prvého po posledné meranie
 * stopy v okne udalosti — video tak nezačína dierou pred oknom, keď lietadlo ešte nebolo vidieť. Keď
 * sú v okne menej než dve merania, celá stopa. [t0, t1] v sekundách. Pure.
 * @param {Array<[number, number, number, number|null]>} track
 * @param {[number, number]} window okno udalosti (incidentWindow)
 */
export function cardTimeRange(track, [winFrom, winTo]) {
  const pts = Array.isArray(track) ? track : [];
  const focus = pts.filter((p) => p[0] >= winFrom && p[0] <= winTo);
  const span = focus.length >= 2 ? focus : pts;
  return span.length ? [span[0][0], span[span.length - 1][0]] : [NaN, NaN];
}

/** Letiská trasy vo výreze mapy s polohou popisu (pri pravom okraji vľavo od bodu) a jeho obdĺžnikom. Pure. */
function airportLabels(route, bbox, P, map, k) {
  const out = [];
  for (const a of [route?.origin, route?.destination]) {
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || a.lat < bbox.s || a.lat > bbox.n || a.lon < bbox.w || a.lon > bbox.e) continue;
    const [x, y] = P(a.lon, a.lat);
    const label = `${a.iata || a.icao || ''} ${a.city || ''}`.trim();
    const width = label.length * 8.5 * k;
    const right = x > map.x + map.w - width - 20;
    const tx = right ? x - 8 : x + 8;
    out.push({ x, y, label, right, tx, box: { x0: right ? tx - width : tx, x1: right ? tx : tx + width, y0: y - 6 - 15 * k, y1: y + 4 * k } });
  }
  return out;
}

/**
 * Roh mapy pre hodiny videa — vľavo alebo vpravo hore, ten, kde zakryjú menej stopy, letísk s popismi
 * a značiek momentov (pri zhode vľavo). Počíta sa z celej udalosti, nie zo snímky: hodiny počas videa
 * neskáču. Vracia ľavý horný bod obdĺžnika hodín. Pure.
 * @param {{pts: number[][], marks: Array<{x: number, y: number}|null>, airports: Array<{box: {x0: number, y0: number, x1: number, y1: number}}>,
 *   map: {x: number, y: number, w: number, h: number}, box: {w: number, h: number}, pad?: number}} opts
 */
export function clockCorner({ pts = [], marks = [], airports = [], map, box, pad = 12 }) {
  const corners = [map.x + 18, map.x + map.w - 18 - box.w].map((x) => ({ x, y: map.y + 18 }));
  const covered = (c) => {
    const [x0, y0, x1, y1] = [c.x - pad, c.y - pad, c.x + box.w + pad, c.y + box.h + pad];
    const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    let n = pts.length === 1 && inside(pts[0][0], pts[0][1]) ? 1 : 0;
    // Stopa po kúskoch ~8 px (aj dlhý rovný úsek bez bodov v rohu sa započíta).
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
      for (let s = 0; s <= steps; s += 1) if (inside(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps)) n += 1;
    }
    for (const m of marks) if (m && inside(m.x, m.y)) n += 20;
    for (const a of airports) if (a.box.x1 >= x0 && a.box.x0 <= x1 && a.box.y1 >= y0 && a.box.y0 <= y1) n += 20;
    return n;
  };
  const [left, right] = corners.map(covered);
  return right < left ? corners[1] : corners[0];
}

/**
 * Polohy očíslovaných značiek momentov na mape; značka, ktorá by prekryla predošlú, sa odsunie po
 * kružnici. Pre všetky momenty naraz — vo videu sa tak značky neposúvajú, keď pribudne ďalšia. Pure.
 */
function placeMomentMarkers(moments, P, k) {
  const placed = [];
  return moments.map((m) => {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lon)) return null;
    let [x, y] = P(m.lon, m.lat);
    const [ox, oy] = [x, y];
    for (let step = 1; step <= 12 && placed.some(([px, py]) => Math.hypot(px - x, py - y) < 27 * k); step += 1) {
      const a = (step * 2 * Math.PI) / 6;
      const r = 27 * k * Math.ceil(step / 6);
      x = ox + r * Math.cos(a);
      y = oy + r * Math.sin(a);
    }
    placed.push([x, y]);
    return { x, y, ox, oy };
  });
}

/**
 * SVG obrázka udalosti — a zároveň snímky videa (2026-10-01, vlastník: „sprav ale tak, aby sme rovnaký
 * vzorec použili aj v budúcnosti"): obrázok aj video kreslí tento kód; záver videu (`showAll`) ukáže to
 * isté čo obrázok (všetky momenty, médiá, zdroje) a navyše hodiny a lietadlo na poslednej polohe.
 * @param {object} event uložená udalosť (s `track` zo simplifyTrack)
 * @param {{format?: 'og'|'feed', marine?: Array<{polygons:number[][][]}>, borders?: number[][][],
 *   layers?: 'all'|'base'|'overlay', frame?: {t: number, current?: number|null, pop?: number|null, showAll?: boolean}|null}} opts
 *   `layers`: base = pozadie, pevnina, more, hranice (pre video raz); overlay = všetko ostatné na priehľadnom
 *   pozadí (každý snímok); `frame`: snímka v čase t — stopa preletená po t, lietadlo, momenty do t (aktuálny
 *   zvýraznený, `pop` 0–1 = nástup), hodiny; bez `frame` statický obrázok so všetkým.
 */
export function buildEventCardSvg(event, { format = 'og', marine = [], borders = [], layers = 'all', frame = null } = {}) {
  const { w: W, h: H } = CARD_FORMATS[format] || CARD_FORMATS.og;
  const feed = format === 'feed';
  const drawBase = layers !== 'overlay';
  const drawOver = layers !== 'base';
  const map = feed ? { x: 0, y: 0, w: W, h: 760 } : { x: 0, y: 0, w: 720, h: H };
  const chart = feed ? { x: 40, y: 640, w: W - 80, h: 100 } : { x: 30, y: H - 118, w: map.w - 60, h: 88 };
  const track = Array.isArray(event.track) ? event.track : [];
  const k = feed ? 1.4 : 1; // popisy a značky mapy na výške 1350 px väčšie
  const tNow = frame && Number.isFinite(frame.t) ? frame.t : null;
  const shown = (m) => tNow === null || m.t <= tNow + 1e-6;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  if (drawBase) out.push(`<rect width="${W}" height="${H}" fill="${COLORS.bg}"/>`);
  out.push(`<defs><clipPath id="m"><rect x="${map.x}" y="${map.y}" width="${map.w}" height="${map.h}"/></clipPath></defs>`);
  const moments = keyMoments(event);
  const [winFrom, winTo] = incidentWindow(event, moments);
  const focus = track.filter((p) => p[0] >= winFrom && p[0] <= winTo);
  if (track.length) {
    // Obsah mapy sa zmestí nad profil výšky (ten prekrýva spodok mapy); podklad ide ďalej pod neho.
    const fit = { x: map.x, y: map.y, w: map.w, h: chart.y - 30 - map.y };
    // Pristátie zo správ musí byť na mape (značka „podľa správ" na letisku, bez čiary k stope).
    const bbox = cardBBox(focus.length >= 2 ? focus : track, event.route, fit.w / fit.h, moments.filter((m) => m.reported));
    const P = projector(bbox, fit);
    if (drawBase) {
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
      out.push('</g>');
    }
    if (drawOver) {
      out.push('<g clip-path="url(#m)">');
      // Stopa: merania plnou, diery čiarkovane (bez dopočítania trasy). Vo videu celá stopa bledo
      // a preletená časť po aktuálny čas naplno.
      const pts = track.map((p) => P(p[2], p[1]));
      const st = tNow === null ? null : trackStateAt(track, tNow);
      const seg = (a, b) => `M${fmt1(a[0])} ${fmt1(a[1])}L${fmt1(b[0])} ${fmt1(b[1])}`;
      let solid = '';
      let gaps = '';
      let ghostSolid = '';
      let ghostGaps = '';
      for (let i = 1; i < track.length; i += 1) {
        const gap = track[i][0] - track[i - 1][0] >= CARD_GAP_S;
        const flown = !st || st.after || i <= st.i;
        const s = seg(pts[i - 1], pts[i]);
        if (flown) { if (gap) gaps += s; else solid += s; }
        else if (gap) ghostGaps += s; else ghostSolid += s;
      }
      // Koniec údajov: čas na poslednom meraní stopy alebo po ňom.
      const ended = !!st && st.i === track.length - 1;
      let plane = null;
      if (st) {
        const a = pts[st.i];
        const b = pts[Math.min(st.i + 1, pts.length - 1)];
        // Diera bez údajov: lietadlo ostáva na poslednej známej polohe (trasa sa nedomýšľa).
        if (!st.after && !st.before && !st.inGap && st.i + 1 < pts.length) {
          const x = a[0] + (b[0] - a[0]) * st.f;
          const y = a[1] + (b[1] - a[1]) * st.f;
          solid += seg(a, [x, y]);
          plane = { x, y, deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, dim: false };
        } else {
          const prev = pts[Math.max(0, st.i - 1)];
          const base = st.before ? pts[0] : a;
          const dir = st.before ? [pts[0], pts[1] || pts[0]] : [prev, a];
          plane = { x: base[0], y: base[1], deg: (Math.atan2(dir[1][1] - dir[0][1], dir[1][0] - dir[0][0]) * 180) / Math.PI, dim: st.inGap || st.after || ended };
        }
      }
      if (ghostGaps) out.push(`<path d="${ghostGaps}" fill="none" stroke="${COLORS.gap}" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="7 6" stroke-linecap="round"/>`);
      if (ghostSolid) out.push(`<path d="${ghostSolid}" fill="none" stroke="${COLORS.track}" stroke-opacity="0.15" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`);
      if (gaps) out.push(`<path d="${gaps}" fill="none" stroke="${COLORS.gap}" stroke-width="2" stroke-dasharray="7 6" stroke-linecap="round"/>`);
      if (solid) out.push(`<path d="${solid}" fill="none" stroke="${COLORS.track}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>`);
      // Letiská trasy (plán letu z adsbdb) — štvorček a kód.
      const airports = airportLabels(event.route, bbox, P, map, k);
      for (const a of airports) {
        out.push(`<rect x="${fmt1(a.x - 4 * k)}" y="${fmt1(a.y - 4 * k)}" width="${8 * k}" height="${8 * k}" fill="${COLORS.text}"/>`);
        out.push(`<text x="${fmt1(a.tx)}" y="${fmt1(a.y - 6)}" font-size="${fmt1(15 * k)}" text-anchor="${a.right ? 'end' : 'start'}" fill="${COLORS.text}">${esc(a.label)}</text>`);
      }
      // Očíslované momenty (vo videu len tie, ktoré už nastali; aktuálny pri nástupe pulzuje). Lietadlo
      // v pohybe ide nad staršie značky (počas letu nezmizne), ale pod značku, na ktorej práve stojí
      // (zastavenie na momente); bledé (diera, koniec údajov) a v závere pod všetky — číslo je vidieť.
      const marks = placeMomentMarkers(moments, P, k);
      const above = (i) => !frame || frame.showAll || !!plane?.dim || (frame.current === i && Number.isFinite(frame.pop));
      const drawMarks = (top) => moments.forEach((m, i) => {
        const mk = marks[i];
        if (!mk || !shown(m) || above(i) !== top) return;
        const popping = frame && frame.current === i && Number.isFinite(frame.pop);
        const scale = popping ? 1 + 0.45 * Math.sin(Math.PI * frame.pop) : 1;
        if (mk.x !== mk.ox || mk.y !== mk.oy) out.push(`<line x1="${fmt1(mk.ox)}" y1="${fmt1(mk.oy)}" x2="${fmt1(mk.x)}" y2="${fmt1(mk.y)}" stroke="${COLORS.marker}" stroke-width="1.5"/>`);
        if (popping) out.push(`<circle cx="${fmt1(mk.x)}" cy="${fmt1(mk.y)}" r="${fmt1(13 * k * (1 + 1.4 * frame.pop))}" fill="none" stroke="${COLORS.marker}" stroke-width="3" stroke-opacity="${fmt1(Math.max(0, 1 - frame.pop))}"/>`);
        if (m.reported) {
          // Zo správ: prázdny krúžok s číslom (nevideli ho siete) — odlíšené od meraní.
          out.push(`<circle cx="${fmt1(mk.x)}" cy="${fmt1(mk.y)}" r="${fmt1(13 * k * scale)}" fill="${COLORS.bg}" fill-opacity="0.85" stroke="${COLORS.marker}" stroke-width="2.5" stroke-dasharray="4 3"/>`);
          out.push(`<text x="${fmt1(mk.x)}" y="${fmt1(mk.y + 5 * k * scale)}" font-size="${fmt1(14 * k * scale)}" font-weight="700" text-anchor="middle" fill="${COLORS.marker}">${i + 1}</text>`);
          return;
        }
        out.push(`<circle cx="${fmt1(mk.x)}" cy="${fmt1(mk.y)}" r="${fmt1(13 * k * scale)}" fill="${COLORS.marker}" stroke="${COLORS.bg}" stroke-width="2"/>`);
        out.push(`<text x="${fmt1(mk.x)}" y="${fmt1(mk.y + 5 * k * scale)}" font-size="${fmt1(14 * k * scale)}" font-weight="700" text-anchor="middle" fill="${COLORS.markerText}">${i + 1}</text>`);
      });
      drawMarks(false);
      // Lietadlo (len vo videu): šípka v smere letu; v diere a po konci údajov bledá na poslednej polohe.
      if (plane) {
        out.push(`<g transform="translate(${fmt1(plane.x)} ${fmt1(plane.y)}) rotate(${fmt1(plane.deg)})" opacity="${plane.dim ? '0.55' : '1'}">`);
        out.push(`<circle r="${fmt1(15 * k)}" fill="${COLORS.track}" fill-opacity="0.28"/>`);
        out.push(`<path d="M${fmt1(13 * k)} 0L${fmt1(-8 * k)} ${fmt1(7 * k)}L${fmt1(-4 * k)} 0L${fmt1(-8 * k)} ${fmt1(-7 * k)}Z" fill="#ffffff" stroke="${COLORS.bg}" stroke-width="1.5"/>`);
        out.push('</g>');
      }
      drawMarks(true);
      out.push('</g>');
      // Hodiny (len vo videu): čas UTC a stav údajov, v hornom rohu mapy, ktorý zakryje menej.
      if (tNow !== null) {
        const clockSize = feed ? 46 : 30;
        const status = st?.inGap ? 'bez údajov' : (st?.after || ended ? 'koniec údajov' : '');
        const box = { w: clockSize * 7.1, h: clockSize * 1.95 };
        const c = clockCorner({ pts, marks, airports, map, box });
        out.push(`<rect x="${fmt1(c.x)}" y="${fmt1(c.y)}" width="${fmt1(box.w)}" height="${fmt1(status ? box.h : clockSize * 1.45)}" rx="10" fill="${COLORS.bg}" fill-opacity="0.78"/>`);
        out.push(`<text x="${fmt1(c.x + 16)}" y="${fmt1(c.y + clockSize * 1.08)}" font-size="${clockSize}" font-weight="700" fill="${COLORS.text}">${clockUtc(tNow)} UTC</text>`);
        if (status) out.push(`<text x="${fmt1(c.x + 16)}" y="${fmt1(c.y + clockSize * 1.7)}" font-size="${fmt1(clockSize * 0.5)}" fill="${COLORS.warn}">${esc(status)}</text>`);
      }
      // Profil výšky (ft) v okne udalosti; vo videu preletená časť naplno a kurzor v aktuálnom čase.
      const alts = (focus.length >= 2 ? focus : track).filter((p) => p[3] != null);
      if (alts.length >= 2) {
        const [t0, t1] = cardTimeRange(track, [winFrom, winTo]);
        const maxFt = Math.max(1000, ...alts.map((p) => p[3]));
        const X = (t) => chart.x + ((t - t0) / Math.max(1, t1 - t0)) * chart.w;
        const Y = (ft) => chart.y + chart.h - (ft / maxFt) * chart.h;
        out.push(`<rect x="${chart.x - 10}" y="${chart.y - 22}" width="${chart.w + 20}" height="${chart.h + 32}" rx="8" fill="${COLORS.bg}" fill-opacity="0.82"/>`);
        out.push(`<text x="${chart.x}" y="${chart.y - 7}" font-size="${fmt1(13 * k)}" fill="${COLORS.muted}">Výška (ft) · ${clockUtc(t0).slice(0, 5)}–${clockUtc(t1).slice(0, 5)} UTC</text>`);
        const profile = (pts) => {
          let d = '';
          for (let i = 0; i < pts.length; i += 1) {
            const gap = i > 0 && pts[i][0] - pts[i - 1][0] >= CARD_GAP_S;
            d += `${!i || gap ? 'M' : 'L'}${fmt1(X(pts[i][0]))} ${fmt1(Y(pts[i][3]))}`;
          }
          return d;
        };
        if (tNow === null) {
          out.push(`<path d="${profile(alts)}" fill="none" stroke="${COLORS.track}" stroke-width="2"/>`);
        } else {
          out.push(`<path d="${profile(alts)}" fill="none" stroke="${COLORS.track}" stroke-opacity="0.25" stroke-width="2"/>`);
          const flownAlts = alts.filter((p) => p[0] <= tNow);
          if (flownAlts.length >= 2) out.push(`<path d="${profile(flownAlts)}" fill="none" stroke="${COLORS.track}" stroke-width="2"/>`);
          if (tNow >= t0 && tNow <= t1) out.push(`<line x1="${fmt1(X(tNow))}" y1="${chart.y - 4}" x2="${fmt1(X(tNow))}" y2="${chart.y + chart.h}" stroke="${COLORS.text}" stroke-width="1.5"/>`);
        }
        // Čísla momentov v grafe: blízke v čase idú pod seba (inak „1" a „2" splynú do „12"), pri pravom
        // okraji vľavo od čiary. Riadky sa určia zo všetkých momentov — vo videu čísla neskáču.
        const rowEnds = [];
        const maxRows = Math.max(1, Math.floor((chart.h - 4) / (13 * k)));
        const labels = moments.map((m, i) => {
          if (m.t < t0 || m.t > t1) return null;
          const x = X(m.t);
          const width = (String(i + 1).length * 7.5 + 2) * k;
          const left = x + 3 + width > chart.x + chart.w + 6;
          const x0 = left ? x - 3 - width : x + 3;
          let row = 0;
          while (row < maxRows - 1 && row < rowEnds.length && x0 < rowEnds[row]) row += 1;
          rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, x0 + width);
          return { x, left, row };
        });
        moments.forEach((m, i) => {
          const l = labels[i];
          if (!l || !shown(m)) return;
          out.push(`<line x1="${fmt1(l.x)}" y1="${chart.y}" x2="${fmt1(l.x)}" y2="${chart.y + chart.h}" stroke="${COLORS.marker}" stroke-width="1" stroke-dasharray="3 3"/>`);
          out.push(`<text x="${fmt1(l.left ? l.x - 3 : l.x + 3)}" y="${fmt1(chart.y + 12 * k + l.row * 13 * k)}" font-size="${fmt1(12 * k)}" font-weight="700"${l.left ? ' text-anchor="end"' : ''} fill="${COLORS.marker}">${i + 1}</text>`);
        });
      }
    }
  }
  if (!drawOver) {
    out.push('</svg>');
    return out.join('');
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
  const verified = isPublishable(event);
  const media = verified ? verifiedSources(event).length : 0;
  const badge = verified ? `OVERENÉ: 2 siete prijímačov + ${media} ${media >= 5 ? 'médií' : 'médiá'}` : 'NÁHĽAD — ešte neoverené';
  out.push(`<rect x="${panel.x}" y="${y - (feed ? 26 : 20)}" width="${Math.min(panel.w, badge.length * (feed ? 13.5 : 10.4) + 24)}" height="${feed ? 38 : 30}" rx="6" fill="${verified ? COLORS.ok : COLORS.warn}" fill-opacity="0.16" stroke="${verified ? COLORS.ok : COLORS.warn}"/>`);
  out.push(`<text x="${panel.x + 12}" y="${y}" font-size="${feed ? 22 : 16}" font-weight="700" fill="${verified ? COLORS.ok : COLORS.warn}">${esc(badge)}</text>`);
  y += feed ? 56 : 42;
  // Zdroje v dvoch riadkoch (s plánom letu z adsbdb by jeden riadok presiahol stĺpec textu).
  const feet = [
    `údaje OpenSky Network, adsb.lol (ODbL)${event.route ? ' · plán letu adsbdb' : ''}`,
    'okolive.sk · mapa Natural Earth',
  ];
  const footSize = feed ? 20 : 13;
  const footY = (i) => H - (feed ? 36 : 22) - (feet.length - 1 - i) * (feed ? 28 : 18);
  const list = cardListLayout({
    moments,
    media: verified ? [...new Set(verifiedSources(event).map((t) => outletName(t.domain)))] : [],
    headY: y,
    width: panel.w,
    baseSize: feed ? 25 : 17,
    bottom: footY(0) - footSize - (feed ? 10 : 6),
  });
  const itemSize = list.size;
  out.push(`<text x="${panel.x}" y="${fmt1(y)}" font-size="${itemSize - 2}" fill="${COLORS.muted}">Časy UTC · ${esc(networksWithData(event).map((id) => NETWORK_NAMES[id]).join(' + ') || '—')}</text>`);
  // Zoznam momentov: vo videu len tie, ktoré už nastali (miesto ostatných ostáva — zoznam neskáče),
  // aktuálny zvýraznený.
  list.items.forEach(({ lines, y: iy }, i) => {
    const visible = shown(moments[i]);
    const current = frame && frame.current === i && visible;
    if (current) out.push(`<rect x="${panel.x - 10}" y="${fmt1(iy - itemSize * 1.05)}" width="${panel.w + 20}" height="${fmt1(lines.length * itemSize * 1.25 + itemSize * 0.35)}" rx="8" fill="${COLORS.marker}" fill-opacity="0.16"/>`);
    if (!visible) return;
    const fromNews = Boolean(moments[i].reported);
    out.push(fromNews
      ? `<circle cx="${panel.x + 11}" cy="${fmt1(iy - itemSize * 0.34)}" r="${fmt1(itemSize * 0.58)}" fill="none" stroke="${COLORS.marker}" stroke-width="2" stroke-dasharray="3 2"/>`
      : `<circle cx="${panel.x + 11}" cy="${fmt1(iy - itemSize * 0.34)}" r="${fmt1(itemSize * 0.58)}" fill="${COLORS.marker}"/>`);
    out.push(`<text x="${panel.x + 11}" y="${fmt1(iy)}" font-size="${fmt1(itemSize * 0.78)}" font-weight="700" text-anchor="middle" fill="${fromNews ? COLORS.marker : COLORS.markerText}">${i + 1}</text>`);
    lines.forEach((l, j) => {
      out.push(`<text x="${panel.x + 32}" y="${fmt1(iy + j * itemSize * 1.25)}" font-size="${itemSize}"${current ? ' font-weight="700"' : ''} fill="${COLORS.text}">${esc(l)}</text>`);
    });
  });
  // Momenty, ktoré sa do zoznamu nezmestili (na mape a v grafe ostávajú očíslované).
  if (list.more > 0 && shown(moments[list.items.length])) {
    out.push(`<text x="${panel.x + 32}" y="${fmt1(list.moreY)}" font-size="${itemSize}" fill="${COLORS.muted}">${esc(moreMomentsSk(list.more))}</text>`);
  }
  if (list.media.length && (!frame || frame.showAll)) {
    list.media.forEach((l, j) => {
      out.push(`<text x="${panel.x}" y="${fmt1(list.mediaY + j * (itemSize - 2) * 1.3)}" font-size="${itemSize - 2}" fill="${COLORS.muted}">${esc(l)}</text>`);
    });
  }
  feet.forEach((line, i) => {
    out.push(`<text x="${panel.x}" y="${footY(i)}" font-size="${footSize}" fill="${COLORS.muted}">${esc(line)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}
