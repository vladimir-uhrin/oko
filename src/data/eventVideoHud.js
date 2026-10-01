// src/data/eventVideoHud.js — popisy 3D videa udalosti v štýle OKO (2026-10-01, vlastník: „chýba tam
// moje logo", „v OKO style", „potrebujem propagovať doménu aj moje meno ako na webe"). Vrstva SVG nad
// záberom z OKO; kreslí ju prehliadač na stránke OKO (scripts/capture-event-video.mjs), takže písma sú
// tie isté ako na webe (JetBrains Mono, Inter) a logo je public/logo.svg. Reč webu: nápis OK + azúrové
// O, okolive.sk, podpis „— VYTVORIL UHRIN VLADIMÍR" s tenkou azúrovou linkou, heslo webu.
//   otvorenie     Zem z obežnej dráhy: logo, OKO, heslo, podpis, čo sa stalo a ktorý let, NAŽIVO okolive.sk,
//   počas videa   vľavo hore značka ako hlavička webu (logo, OKO, okolive.sk, podpis), vpravo hore hodiny
//                 UTC a dátum a stavové štítky (BEZ ÚDAJOV / KONIEC ÚDAJOV / SPOMALENÉ), dole karta letu
//                 (čo sa stalo, let, overenie, výška, aktuálny moment, profil výšky s čiarkovanou dierou),
//                 pri diere veľký nápis „9 MIN BEZ ÚDAJOV / kleslo o 12 925 ft",
//   záver         súhrn všetkých momentov, overenie, médiá, „Celá rekonštrukcia: okolive.sk",
//   koncová karta logo, OKO, heslo okolive.sk, NAŽIVO okolive.sk, podpis.
// Zdroje (© Google · Cesium ion, OpenSky, adsb.lol ODbL, adsbdb) sú na každej snímke. Pure.

import { CARD_GAP_S } from './eventCard.js';
import { eventWhat, flightLine, isPublishable, outletName, verifiedSources } from './eventPost.js';
import { clockUtc, momentPhrase } from './eventTimeline.js';

export const VIDEO_3D_FORMAT = Object.freeze({ w: 1080, h: 1350 });
/** Značka a autor — rovnaké ako na webe (index.html: podpis, heslo) a na obrázku okolive.sk. */
export const VIDEO_BRAND = Object.freeze({
  domain: 'okolive.sk',
  author: 'UHRIN VLADIMÍR',
  credit: 'VYTVORIL',
  tagline: 'ŽIADNE MIESTO NEOSTANE BOKOM',
  claim: 'Lietadlá, lode a konflikty naživo v 3D',
  logoHref: '/logo.svg',
});
const MONO = "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace";
const SANS = "'Inter', 'Segoe UI', Arial, sans-serif";
const ACCENT = '#00d4ff';
const TEXT = '#e8eaed';
const DIM = 'rgba(232,234,237,0.62)';
const AMBER = '#fbbf24';
const FADE_S = 0.6;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const NBSP = ' ';
/** Číslo s medzerou tisícov (nezalomiteľnou). Pure. */
export const groupFt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
/** Čísla a jednotky sa nezalomia („21 319 ft/min"). Pure. */
export const keepNumbers = (s) => String(s).replace(/(\d) (?=\d)/g, `$1${NBSP}`).replace(/ (ft\/min|ft|min|°)/g, `${NBSP}$1`);
const dateSk = (tS) => { const d = new Date(tS * 1000); return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`; };
const shadow = 'stroke="rgba(0,0,0,0.6)" stroke-width="4" paint-order="stroke"';
const wrap = (text, max) => {
  const out = [];
  let line = '';
  for (const wd of String(text).split(' ')) {
    if (line && `${line} ${wd}`.length > max) { out.push(line); line = wd; } else line = line ? `${line} ${wd}` : wd;
  }
  if (line) out.push(line);
  return out;
};

/** Nápis pri diere: „9 min bez údajov · kleslo o 12 925 ft" (zmena výšky od 1 000 ft). Pure. */
export function gapLabel(g) {
  const min = Math.round((g.toT - g.fromT) / 60);
  const what = Math.abs(g.dFt) >= 1000 ? ` · ${g.dFt < 0 ? 'kleslo' : 'stúplo'} o ${groupFt(Math.abs(g.dFt))} ft` : '';
  return `${min} min bez údajov${what}`;
}

/** Výška na karte: pri zastavení na momente jeho hodnota (zhodná s textom), inak posledné meranie (ft). Pure. */
export function readoutFt(fs, moments) {
  const cur = fs.s.current !== null && fs.s.current !== undefined ? moments[fs.s.current] : null;
  if (fs.s.phase === 'moment' && cur && Number.isFinite(cur.alt)) return cur.alt / 0.3048;
  return fs.plane.measuredFt ?? null;
}

/**
 * Viditeľnosť častí snímky (0–1): otvorenie, bežné popisy (značka, hodiny, karta), súhrn, koncová
 * karta. Prechody sa prelínajú (FADE_S). Pure.
 */
export function hudLayers(scene, fs) {
  const vt = fs.vt;
  const op = scene.opening;
  const ec = scene.endCard;
  const opEnd = op ? op.start + op.dur : -Infinity;
  // Po sebe, nie cez seba: najprv dozneje jedno, potom nastúpi druhé (inak sa texty na chvíľu prekryjú).
  const half = FADE_S * 0.75;
  const opening = op && vt < opEnd ? clamp01((opEnd - half / 4 - vt) / half) : 0;
  const arriving = op ? clamp01((vt - (opEnd - half / 4)) / half) : 1;
  const leaving = ec && vt >= ec.start ? clamp01(1 - (vt - ec.start) / half) : 1;
  const endCard = ec && vt >= ec.start ? clamp01((vt - ec.start - half) / half) : 0;
  const summary = fs.s.showAll ? leaving : 0;
  return { opening, endCard, main: Math.min(arriving, leaving), card: fs.s.showAll ? 0 : Math.min(arriving, leaving), summary };
}

/**
 * Logo (public/logo.svg) ako vložené SVG bez tried a štýlov — kreslí sa hneď s ostatnými popismi
 * (obrázok cez href by sa mohol na snímke oneskoriť) a jeho triedy nezasiahnu stránku. Pure.
 * @param {string} svgText obsah public/logo.svg
 * @returns {{viewBox: string, body: string}|null}
 */
export function inlineLogoMarkup(svgText) {
  const text = String(svgText || '');
  const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1];
  if (!viewBox) return null;
  const rules = new Map();
  const css = /<style[^>]*>([\s\S]*?)<\/style>/.exec(text)?.[1] || '';
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).join(';');
    for (const sel of m[1].split(',').map((x) => x.trim()).filter((x) => x.startsWith('.'))) {
      rules.set(sel.slice(1), [rules.get(sel.slice(1)), decls].filter(Boolean).join(';'));
    }
  }
  const body = text
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<defs>[\s\S]*?<\/defs>/g, '')
    .replace(/\s(?:id|role|aria-[a-z]+)="[^"]*"/g, '')
    .replace(/class="([^"]+)"/g, (_, cls) => `style="${cls.split(/\s+/).map((c) => rules.get(c) || '').filter(Boolean).join(';')}"`)
    .trim();
  return { viewBox, body };
}

/** Podpis ako na webe: tenká azúrová linka, „VYTVORIL" tlmene, meno azúrovo (mono, preriedené). */
function creditLine(x, y, size, anchor = 'start') {
  const words = `${VIDEO_BRAND.credit} ${VIDEO_BRAND.author}`;
  const textW = words.length * size * 0.6 + (words.length - 1) * 3;
  const ruleW = size * 2.2;
  const start = anchor === 'middle' ? x - (ruleW + 12 + textW) / 2 : x;
  const id = `rule${Math.round(x)}${Math.round(y)}`;
  return `<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${ACCENT}" stop-opacity="0"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0.75"/></linearGradient></defs>`
    + `<rect x="${f1(start)}" y="${f1(y - size * 0.38)}" width="${f1(ruleW)}" height="1.5" fill="url(#${id})"/>`
    + `<text x="${f1(start + ruleW + 12)}" y="${f1(y)}" font-family="${MONO}" font-size="${size}" letter-spacing="3" fill="${DIM}" ${shadow}>${VIDEO_BRAND.credit} <tspan fill="${ACCENT}" font-weight="500">${esc(VIDEO_BRAND.author)}</tspan></text>`;
}
/** Nápis OKO ako na webe (OK + tenké azúrové O). */
const wordmark = (x, y, size, anchor = 'start') => `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" font-family="${MONO}" font-size="${size}" font-weight="600" letter-spacing="${f1(size * 0.14)}" fill="${TEXT}" ${shadow}>OK<tspan fill="${ACCENT}" font-weight="300">O</tspan></text>`;
/** Logo: vložené SVG (inlineLogoMarkup), inak odkaz na public/logo.svg. */
const logoAt = (markup) => (x, y, size) => (markup
  ? `<svg x="${f1(x)}" y="${f1(y)}" width="${size}" height="${size}" viewBox="${markup.viewBox}">${markup.body}</svg>`
  : `<image href="${VIDEO_BRAND.logoHref}" x="${f1(x)}" y="${f1(y)}" width="${size}" height="${size}"/>`);
/** „● NAŽIVO okolive.sk" ako na obrázku okolive.sk. */
function liveDomain(cx, y, size) {
  const pillW = size * 3.4;
  const domW = VIDEO_BRAND.domain.length * size * 0.66;
  const x0 = cx - (pillW + 18 + domW) / 2;
  return `<rect x="${f1(x0)}" y="${f1(y - size * 0.82)}" width="${f1(pillW)}" height="${f1(size * 1.1)}" rx="${f1(size * 0.55)}" fill="rgba(255,46,46,0.14)" stroke="rgba(255,90,90,0.8)" stroke-width="1.4"/>`
    + `<circle cx="${f1(x0 + size * 0.62)}" cy="${f1(y - size * 0.27)}" r="${f1(size * 0.2)}" fill="#ff3b3b"/>`
    + `<text x="${f1(x0 + size * 1.05)}" y="${f1(y)}" font-family="${MONO}" font-size="${f1(size * 0.52)}" font-weight="700" letter-spacing="2.5" fill="#ffd9d9">NAŽIVO</text>`
    + `<text x="${f1(x0 + pillW + 18)}" y="${f1(y + size * 0.06)}" font-family="${MONO}" font-size="${size}" font-weight="600" letter-spacing="${f1(size * 0.1)}" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`;
}

/**
 * SVG popisov jednej snímky.
 * @param {object} event
 * @param {object} scene eventVideoScene(...)
 * @param {object} fs scene.frame(n)
 * @param {Record<string, {x: number, y: number}>} anchors poloha stredu diery na obrazovke (`gap<i>`)
 * @param {{logoMarkup?: {viewBox: string, body: string}|null}} [opts] logo vložené do SVG (inlineLogoMarkup)
 */
export function buildEventVideoHudSvg(event, scene, fs, anchors = {}, { logoMarkup = null } = {}) {
  const logo = logoAt(logoMarkup);
  const { w: W, h: H } = VIDEO_3D_FORMAT;
  const { s, plane, vt } = fs;
  const moments = scene.moments;
  const layers = hudLayers(scene, fs);
  const verified = isPublishable(event);
  const media = verified ? [...new Set(verifiedSources(event).map((t) => outletName(t.domain)))] : [];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`];
  out.push(`<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.68"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient>`
    + `<linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.82"/><stop offset="0.62" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>`);
  out.push(`<rect width="${W}" height="236" fill="url(#top)"/><rect y="${H - 440}" width="${W}" height="440" fill="url(#bot)"/>`);

  // ── otvorenie: značka a čo sa stalo ────────────────────────────
  if (layers.opening > 0) {
    // Zem z obežnej dráhy je svetlá — stmavenie a panel, nech sa značka aj názov udalosti dajú prečítať.
    out.push(`<g opacity="${f1(layers.opening)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.38"/><rect width="${W}" height="${H * 0.78}" fill="url(#card)"/>`);
    out.push(logo(W / 2 - 75, 92, 150));
    out.push(wordmark(W / 2 + 8, 368, 112, 'middle'));
    out.push(`<text x="${W / 2}" y="${416}" text-anchor="middle" font-family="${MONO}" font-size="19" letter-spacing="6" fill="rgba(232,234,237,0.8)" ${shadow}>${VIDEO_BRAND.tagline}</text>`);
    out.push(creditLine(W / 2, 462, 17, 'middle'));
    const lines = wrap(flightLine(event), 46).slice(0, 2);
    const panelH = 172 + lines.length * 46;
    out.push(`<rect x="70" y="512" width="${W - 140}" height="${panelH}" rx="16" fill="rgba(5,14,22,0.8)" stroke="rgba(0,212,255,0.38)"/>`);
    out.push(`<text x="${W / 2}" y="566" text-anchor="middle" font-family="${MONO}" font-size="25" font-weight="700" letter-spacing="5" fill="${ACCENT}">${esc(eventWhat(event).toUpperCase())}</text>`);
    lines.forEach((l, j) => out.push(`<text x="${W / 2}" y="${618 + j * 46}" text-anchor="middle" font-size="38" font-weight="700" fill="#f2fbff">${esc(l)}</text>`));
    out.push(`<text x="${W / 2}" y="${618 + lines.length * 46 + 14}" text-anchor="middle" font-size="25" fill="rgba(232,234,237,0.8)">${esc([dateSk(event.firstT), event.reg, event.typeCode].filter(Boolean).join(' · '))}</text>`);
    // Doména bez „NAŽIVO" — pri historickej udalosti by pôsobilo ako živý prenos.
    out.push(`<text x="${W / 2}" y="${H - 104}" text-anchor="middle" font-family="${MONO}" font-size="46" font-weight="600" letter-spacing="5" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
    out.push('</g>');
  }

  // ── počas videa: značka ako hlavička webu, hodiny, štítky ────────
  if (layers.main > 0) {
    out.push(`<g opacity="${f1(layers.main)}">`);
    // Tmavý podklad značky — na svetlej púšti by sa okolive.sk a podpis stratili.
    out.push(`<rect x="14" y="12" width="376" height="156" rx="14" fill="rgba(5,14,22,0.58)"/>`);
    out.push(logo(28, 24, 92));
    out.push(wordmark(132, 82, 56));
    out.push(`<text x="134" y="114" font-family="${MONO}" font-size="21" font-weight="500" letter-spacing="3" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
    out.push(creditLine(34, 148, 14));
    out.push(`<text x="${W - 36}" y="76" text-anchor="end" font-family="${MONO}" font-size="46" font-weight="700" fill="#f2fbff" ${shadow}>${clockUtc(s.t)} UTC</text>`);
    out.push(`<text x="${W - 36}" y="108" text-anchor="end" font-family="${MONO}" font-size="19" letter-spacing="2" fill="${DIM}" ${shadow}>${dateSk(s.t)}</text>`);
    const pill = (text, color, fill) => {
      const w = text.length * 11.5 + 40;
      out.push(`<rect x="${f1(W - 36 - w)}" y="124" width="${f1(w)}" height="34" rx="17" fill="${fill}" stroke="${color}"/>`);
      out.push(`<text x="${f1(W - 36 - w / 2)}" y="147" text-anchor="middle" font-family="${MONO}" font-size="16" font-weight="700" letter-spacing="2" fill="${color}">${text}</text>`);
    };
    if (plane.gap) pill('BEZ ÚDAJOV', '#fde68a', 'rgba(251,191,36,0.16)');
    else if (plane.ended && !s.showAll) pill('KONIEC ÚDAJOV', '#fde68a', 'rgba(251,191,36,0.16)');
    else if (s.phase === 'spotlight') pill('SPOMALENÉ', '#bfeeff', 'rgba(0,212,255,0.14)');
    out.push('</g>');
  }

  // ── nápis pri diere: od začiatku diery do 2,5 s po nej, potom dozneje ──
  scene.gaps.forEach((g, i) => {
    const a = anchors[`gap${i}`];
    const gp = g.piece;
    if (!a || !gp || s.showAll) return;
    const end = gp.start + gp.dur + 2.5;
    const alpha = Math.min(layers.main, vt < gp.start ? 0 : (vt < end ? 1 : Math.max(0, 1 - (vt - end) / FADE_S)));
    if (alpha <= 0) return;
    const [head, drop] = gapLabel(g).split(' · ');
    const w = Math.max(head.length * 14 + 40, drop ? drop.length * 15.5 + 40 : 0);
    const h = drop ? 84 : 46;
    const x = Math.min(W - w - 20, Math.max(20, a.x - w / 2));
    const y = Math.min(930 - h, Math.max(200, a.y - h - 24));
    out.push(`<g opacity="${f1(alpha)}"><rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="10" fill="rgba(7,19,31,0.88)" stroke="rgba(251,191,36,0.9)" stroke-width="1.5"/>`);
    out.push(`<text x="${f1(x + 20)}" y="${f1(y + 31)}" font-family="${MONO}" font-size="20" font-weight="700" letter-spacing="2" fill="#fde68a">${esc(head.toUpperCase())}</text>`);
    if (drop) out.push(`<text x="${f1(x + 20)}" y="${f1(y + 68)}" font-size="28" font-weight="700" fill="#f2fbff">${esc(drop)}</text>`);
    out.push('</g>');
  });

  // ── karta letu dole ──────────────────────────────────────────────
  if (layers.card > 0) {
    const y0 = 960;
    out.push(`<g opacity="${f1(layers.card)}">`);
    out.push(`<rect x="24" y="${y0}" width="${W - 48}" height="${H - y0 - 52}" rx="16" fill="rgba(5,14,22,0.84)" stroke="rgba(0,212,255,0.38)"/>`);
    out.push(`<text x="52" y="${y0 + 40}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="${ACCENT}">${esc(eventWhat(event).toUpperCase())}</text>`);
    out.push(verified
      ? `<text x="${W - 52}" y="${y0 + 40}" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="1.5" fill="#4ade80">✓ OVERENÉ: 2 SIETE + ${media.length} ${media.length >= 5 ? 'MÉDIÍ' : 'MÉDIÁ'}</text>`
      : `<text x="${W - 52}" y="${y0 + 40}" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="1.5" fill="${AMBER}">NÁHĽAD — EŠTE NEOVERENÉ</text>`);
    out.push(`<text x="52" y="${y0 + 80}" font-size="30" font-weight="700" fill="#f2fbff">${esc(flightLine(event))}</text>`);
    const ft = readoutFt(fs, moments);
    out.push(`<text x="52" y="${y0 + 126}" font-family="${MONO}" font-size="14" font-weight="700" letter-spacing="3" fill="${DIM}">VÝŠKA</text>`);
    out.push(`<text x="52" y="${y0 + 176}" font-family="${MONO}" font-size="50" font-weight="700" fill="${plane.gap ? '#8fa6b4' : '#f2fbff'}">${ft == null ? '—' : `${groupFt(Math.round(ft / 25) * 25)} ft`}</text>`);
    const cur = s.current !== null && s.current !== undefined ? moments[s.current] : null;
    if (cur) {
      const cx = 420;
      out.push(`<circle cx="${cx}" cy="${y0 + 141}" r="18" fill="#ffb020"/><text x="${cx}" y="${y0 + 148}" text-anchor="middle" font-size="20" font-weight="700" fill="#1a1204">${s.current + 1}</text>`);
      wrap(keepNumbers(`${clockUtc(cur.t).slice(0, 5)} ${momentPhrase(cur, 'sk')}`), 38).slice(0, 2)
        .forEach((l, j) => out.push(`<text x="${cx + 32}" y="${y0 + 150 + j * 33}" font-size="25" font-weight="${j ? 400 : 600}" fill="#f2fbff">${esc(l)}</text>`));
    }
    // Profil výšky (bočný pohľad celej udalosti): diera čiarkovane, os s najvyššou výškou a nulou.
    const alts = event.track.filter((p) => p[0] >= scene.t0 && p[0] <= scene.t1 && p[3] != null);
    const maxFt = Math.max(1000, ...alts.map((p) => p[3]));
    const top = Math.ceil(maxFt / 1000) * 1000;
    const c = { x: 150, y: y0 + 222, w: W - 202, h: 82 };
    const X = (t) => c.x + ((t - scene.t0) / Math.max(1, scene.t1 - scene.t0)) * c.w;
    const Y = (f) => c.y + c.h - (f / top) * c.h;
    out.push(`<text x="${c.x - 12}" y="${f1(Y(top) + 6)}" text-anchor="end" font-family="${MONO}" font-size="14" fill="${DIM}">${groupFt(top)} ft</text>`);
    out.push(`<text x="${c.x - 12}" y="${f1(Y(0) + 2)}" text-anchor="end" font-family="${MONO}" font-size="14" fill="${DIM}">0</text>`);
    out.push(`<line x1="${c.x}" y1="${f1(Y(0))}" x2="${c.x + c.w}" y2="${f1(Y(0))}" stroke="rgba(223,243,251,0.2)"/>`);
    const prof = (pp) => {
      let d = '';
      for (let i = 0; i < pp.length; i += 1) {
        const gap = i > 0 && pp[i][0] - pp[i - 1][0] >= CARD_GAP_S;
        d += `${!i || gap ? 'M' : 'L'}${f1(X(pp[i][0]))} ${f1(Y(pp[i][3]))}`;
      }
      return d;
    };
    out.push(`<path d="${prof(alts)}" fill="none" stroke="${ACCENT}" stroke-opacity="0.22" stroke-width="2.5"/>`);
    const flown = alts.filter((p) => p[0] <= s.t);
    if (flown.length >= 2) out.push(`<path d="${prof(flown)}" fill="none" stroke="${ACCENT}" stroke-width="3"/>`);
    scene.gaps.forEach((g, i) => {
      if (!fs.gapsShown[i]) return;
      out.push(`<line x1="${f1(X(g.a[0]))}" y1="${f1(Y(g.a[3] ?? 0))}" x2="${f1(X(g.b[0]))}" y2="${f1(Y(g.b[3] ?? 0))}" stroke="${AMBER}" stroke-width="2.4" stroke-dasharray="7 6"/>`);
    });
    out.push(`<line x1="${f1(X(s.t))}" y1="${c.y - 6}" x2="${f1(X(s.t))}" y2="${c.y + c.h + 2}" stroke="#f2fbff" stroke-width="1.6"/>`);
    out.push(`<circle cx="${f1(X(s.t))}" cy="${f1(Y(plane.altFt ?? 0))}" r="6" fill="#f2fbff" stroke="${ACCENT}" stroke-width="2"/>`);
    out.push('</g>');
  }

  // ── záver: súhrn všetkých momentov ────────────────────────────────
  if (layers.summary > 0) {
    const y0 = 660;
    out.push(`<g opacity="${f1(layers.summary)}">`);
    out.push(`<rect x="24" y="${y0}" width="${W - 48}" height="${H - y0 - 52}" rx="16" fill="rgba(5,14,22,0.88)" stroke="rgba(0,212,255,0.38)"/>`);
    out.push(`<text x="52" y="${y0 + 46}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="${ACCENT}">${esc(eventWhat(event).toUpperCase())}</text>`);
    out.push(`<text x="52" y="${y0 + 90}" font-size="32" font-weight="700" fill="#f2fbff">${esc(flightLine(event))}</text>`);
    out.push(`<text x="52" y="${y0 + 126}" font-size="22" fill="${DIM}">${esc([dateSk(event.firstT), event.reg, event.typeCode].filter(Boolean).join(' · '))} · časy UTC</text>`);
    // Pri veľa momentoch menšie písmo, potom „+ N ďalších" (nikdy cez podpis a zdroje).
    const n = moments.length;
    const room = H - 160 - (y0 + 182);
    const step = Math.max(30, Math.min(44, room / Math.max(1, n + (verified ? 2 : 0))));
    const size = Math.round(Math.min(25, step * 0.57));
    const fit = Math.max(0, Math.floor((room - (verified ? step * 2 : 0)) / step));
    let y = y0 + 182;
    moments.slice(0, n > fit ? fit - 1 : n).forEach((m, i) => {
      out.push(`<circle cx="66" cy="${f1(y - 8)}" r="${f1(size * 0.64)}" fill="#ffb020"/><text x="66" y="${f1(y - 1)}" text-anchor="middle" font-size="${Math.round(size * 0.76)}" font-weight="700" fill="#1a1204">${i + 1}</text>`);
      out.push(`<text x="96" y="${f1(y)}" font-size="${size}" fill="#f2fbff">${esc(keepNumbers(`${clockUtc(m.t).slice(0, 5)} ${momentPhrase(m, 'sk')}`))}</text>`);
      y += step;
    });
    if (n > fit) {
      const more = n - (fit - 1);
      out.push(`<text x="96" y="${f1(y)}" font-size="${size}" fill="${DIM}">+ ${more} ${more === 1 ? 'ďalší moment' : (more <= 4 ? 'ďalšie momenty' : 'ďalších momentov')}</text>`);
      y += step;
    }
    if (verified) {
      out.push(`<text x="52" y="${f1(y + 18)}" font-size="21" font-weight="700" fill="#4ade80">✓ Overené dvomi nezávislými sieťami prijímačov</text>`);
      out.push(`<text x="52" y="${f1(y + 52)}" font-size="21" fill="rgba(223,243,251,0.85)">Médiá: ${esc(media.join(', '))}</text>`);
    }
    out.push(`<text x="52" y="${H - 110}" font-family="${MONO}" font-size="23" font-weight="600" letter-spacing="2" fill="${ACCENT}">Celá rekonštrukcia: ${VIDEO_BRAND.domain}</text>`);
    out.push(creditLine(52, H - 76, 15));
    out.push('</g>');
  }

  // ── koncová karta: doména a autor ────────────────────────────────
  if (layers.endCard > 0) {
    out.push(`<g opacity="${f1(layers.endCard)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.5"/><rect width="${W}" height="${H * 0.82}" fill="url(#card)"/>`);
    out.push(logo(W / 2 - 90, 120, 180));
    out.push(wordmark(W / 2 + 9, 430, 124, 'middle'));
    out.push(`<text x="${W / 2}" y="${500}" text-anchor="middle" font-size="36" font-weight="600" fill="#f2fbff" ${shadow}>${esc(VIDEO_BRAND.claim)}</text>`);
    out.push(`<text x="${W / 2}" y="${548}" text-anchor="middle" font-family="${MONO}" font-size="18" letter-spacing="6" fill="rgba(232,234,237,0.8)" ${shadow}>${VIDEO_BRAND.tagline}</text>`);
    out.push(liveDomain(W / 2, 668, 52));
    out.push(creditLine(W / 2, 748, 20, 'middle'));
    out.push('</g>');
  }

  out.push(`<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-size="16" fill="rgba(223,243,251,0.82)" ${shadow}>© Google · Cesium ion · údaje OpenSky Network, adsb.lol (ODbL)${event.route ? ' · plán letu adsbdb' : ''}</text>`);
  out.push('</svg>');
  return out.join('');
}
