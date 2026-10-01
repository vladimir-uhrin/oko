// src/data/eventVideoHud.js — popisy 3D videa udalosti v štýle OKO (2026-10-01, vlastník: „chýba tam
// moje logo", „v OKO style"). Vrstva SVG nad záberom z OKO, rovnaký štýl ako obrázok okolive.sk
// (scripts/build-share-default-image.mjs): nápis OK + azúrové O vedľa loga, okolive.sk, hodiny UTC
// a dátum, stavové štítky (BEZ ÚDAJOV / KONIEC ÚDAJOV / SPOMALENÉ), karta letu dole (čo sa stalo,
// let, overenie, výška, aktuálny moment, profil výšky s čiarkovanou dierou) a v závere súhrn všetkých
// momentov a médií. Zdroje (© Google · Cesium ion, OpenSky, adsb.lol ODbL, adsbdb) sú na každej snímke.
// Logo (public/logo.svg) pridá skladanie obrazu na pozíciu VIDEO_LOGO. Pure.

import { CARD_GAP_S } from './eventCard.js';
import { eventWhat, flightLine, isPublishable, outletName, verifiedSources } from './eventPost.js';
import { clockUtc, momentPhrase } from './eventTimeline.js';

export const VIDEO_3D_FORMAT = Object.freeze({ w: 1080, h: 1350 });
export const VIDEO_LOGO = Object.freeze({ left: 32, top: 30, size: 88 });
const FONT = "'Segoe UI', Arial, sans-serif";
const CYAN = '#39d0ff';
const AMBER = '#fbbf24';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f1 = (v) => (Math.round(v * 10) / 10).toString();
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
 * SVG popisov jednej snímky.
 * @param {object} event
 * @param {object} scene eventVideoScene(...)
 * @param {object} fs scene.frame(n)
 * @param {Record<string, {x: number, y: number}>} anchors poloha stredu diery na obrazovke (`gap<i>`)
 */
export function buildEventVideoHudSvg(event, scene, fs, anchors = {}) {
  const { w: W, h: H } = VIDEO_3D_FORMAT;
  const { s, plane, vt } = fs;
  const moments = scene.moments;
  const verified = isPublishable(event);
  const media = verified ? [...new Set(verifiedSources(event).map((t) => outletName(t.domain)))] : [];
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="${FONT}">`];
  out.push(`<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></linearGradient></defs>`);
  out.push(`<rect width="${W}" height="200" fill="url(#top)"/><rect y="${H - 440}" width="${W}" height="440" fill="url(#bot)"/>`);
  out.push(`<text x="132" y="86" font-size="62" font-weight="700" letter-spacing="8" fill="#eef8fc" ${shadow}>OK<tspan fill="${CYAN}">O</tspan></text>`);
  out.push(`<text x="134" y="120" font-size="22" font-weight="600" letter-spacing="3" fill="${CYAN}" ${shadow}>okolive.sk</text>`);
  out.push(`<text x="${W - 36}" y="78" text-anchor="end" font-size="50" font-weight="700" fill="#f2fbff" ${shadow}>${clockUtc(s.t)} UTC</text>`);
  out.push(`<text x="${W - 36}" y="112" text-anchor="end" font-size="22" letter-spacing="2" fill="rgba(223,243,251,0.85)" ${shadow}>${dateSk(s.t)}</text>`);
  const pill = (text, color, fill) => {
    const w = text.length * 12.5 + 40;
    out.push(`<rect x="${f1(W - 36 - w)}" y="128" width="${f1(w)}" height="34" rx="17" fill="${fill}" stroke="${color}"/>`);
    out.push(`<text x="${f1(W - 36 - w / 2)}" y="151" text-anchor="middle" font-size="17" font-weight="700" letter-spacing="2" fill="${color}">${text}</text>`);
  };
  if (plane.gap) pill('BEZ ÚDAJOV', '#fde68a', 'rgba(251,191,36,0.16)');
  else if (plane.ended && !s.showAll) pill('KONIEC ÚDAJOV', '#fde68a', 'rgba(251,191,36,0.16)');
  else if (s.phase === 'spotlight') pill('SPOMALENÉ', '#bfeeff', 'rgba(57,208,255,0.14)');
  // Nápis pri diere: od začiatku diery do 2,5 s po nej, potom dozneje.
  scene.gaps.forEach((g, i) => {
    const a = anchors[`gap${i}`];
    const gp = g.piece;
    if (!a || !gp || s.showAll) return;
    const end = gp.start + gp.dur + 2.5;
    const alpha = vt < gp.start ? 0 : (vt < end ? 1 : Math.max(0, 1 - (vt - end) / 0.6));
    if (alpha <= 0) return;
    const text = gapLabel(g);
    const w = text.length * 11.4 + 30;
    const x = Math.min(W - w - 20, Math.max(20, a.x - w / 2));
    const y = Math.min(940, Math.max(200, a.y - 46));
    out.push(`<g opacity="${f1(alpha)}"><rect x="${f1(x)}" y="${f1(y - 25)}" width="${f1(w)}" height="38" rx="8" fill="rgba(7,19,31,0.86)" stroke="rgba(251,191,36,0.85)"/>`);
    out.push(`<text x="${f1(x + 15)}" y="${f1(y + 2)}" font-size="21" font-weight="600" fill="#fde68a">${esc(text)}</text></g>`);
  });
  if (!s.showAll) {
    const y0 = 960;
    out.push(`<rect x="24" y="${y0}" width="${W - 48}" height="${H - y0 - 52}" rx="16" fill="rgba(5,14,22,0.84)" stroke="rgba(57,208,255,0.38)"/>`);
    out.push(`<text x="52" y="${y0 + 40}" font-size="20" font-weight="700" letter-spacing="3" fill="${CYAN}">${esc(eventWhat(event).toUpperCase())}</text>`);
    out.push(verified
      ? `<text x="${W - 52}" y="${y0 + 40}" text-anchor="end" font-size="17" font-weight="700" letter-spacing="1.5" fill="#4ade80">✓ OVERENÉ: 2 SIETE + ${media.length} ${media.length >= 5 ? 'MÉDIÍ' : 'MÉDIÁ'}</text>`
      : `<text x="${W - 52}" y="${y0 + 40}" text-anchor="end" font-size="17" font-weight="700" letter-spacing="1.5" fill="${AMBER}">NÁHĽAD — EŠTE NEOVERENÉ</text>`);
    out.push(`<text x="52" y="${y0 + 80}" font-size="30" font-weight="700" fill="#f2fbff">${esc(flightLine(event))}</text>`);
    const ft = readoutFt(fs, moments);
    out.push(`<text x="52" y="${y0 + 128}" font-size="15" font-weight="700" letter-spacing="2.5" fill="rgba(223,243,251,0.7)">VÝŠKA</text>`);
    out.push(`<text x="52" y="${y0 + 178}" font-size="54" font-weight="700" fill="${plane.gap ? '#8fa6b4' : '#f2fbff'}">${ft == null ? '—' : `${groupFt(Math.round(ft / 25) * 25)} ft`}</text>`);
    const cur = s.current !== null && s.current !== undefined ? moments[s.current] : null;
    if (cur) {
      const cx = 400;
      out.push(`<circle cx="${cx}" cy="${y0 + 141}" r="18" fill="#ffb020"/><text x="${cx}" y="${y0 + 148}" text-anchor="middle" font-size="20" font-weight="700" fill="#1a1204">${s.current + 1}</text>`);
      wrap(keepNumbers(`${clockUtc(cur.t).slice(0, 5)} ${momentPhrase(cur, 'sk')}`), 40).slice(0, 2)
        .forEach((l, j) => out.push(`<text x="${cx + 32}" y="${y0 + 150 + j * 33}" font-size="26" font-weight="${j ? 400 : 600}" fill="#f2fbff">${esc(l)}</text>`));
    }
    // Profil výšky (bočný pohľad celej udalosti): diera čiarkovane, os s najvyššou výškou a nulou.
    const alts = event.track.filter((p) => p[0] >= scene.t0 && p[0] <= scene.t1 && p[3] != null);
    const maxFt = Math.max(1000, ...alts.map((p) => p[3]));
    const top = Math.ceil(maxFt / 1000) * 1000;
    const c = { x: 140, y: y0 + 222, w: W - 192, h: 82 };
    const X = (t) => c.x + ((t - scene.t0) / Math.max(1, scene.t1 - scene.t0)) * c.w;
    const Y = (f) => c.y + c.h - (f / top) * c.h;
    out.push(`<text x="${c.x - 12}" y="${f1(Y(top) + 6)}" text-anchor="end" font-size="16" fill="rgba(223,243,251,0.65)">${groupFt(top)} ft</text>`);
    out.push(`<text x="${c.x - 12}" y="${f1(Y(0) + 2)}" text-anchor="end" font-size="16" fill="rgba(223,243,251,0.65)">0</text>`);
    out.push(`<line x1="${c.x}" y1="${f1(Y(0))}" x2="${c.x + c.w}" y2="${f1(Y(0))}" stroke="rgba(223,243,251,0.2)"/>`);
    const prof = (pp) => {
      let d = '';
      for (let i = 0; i < pp.length; i += 1) {
        const gap = i > 0 && pp[i][0] - pp[i - 1][0] >= CARD_GAP_S;
        d += `${!i || gap ? 'M' : 'L'}${f1(X(pp[i][0]))} ${f1(Y(pp[i][3]))}`;
      }
      return d;
    };
    out.push(`<path d="${prof(alts)}" fill="none" stroke="${CYAN}" stroke-opacity="0.22" stroke-width="2.5"/>`);
    const flown = alts.filter((p) => p[0] <= s.t);
    if (flown.length >= 2) out.push(`<path d="${prof(flown)}" fill="none" stroke="${CYAN}" stroke-width="3"/>`);
    scene.gaps.forEach((g, i) => {
      if (!fs.gapsShown[i]) return;
      out.push(`<line x1="${f1(X(g.a[0]))}" y1="${f1(Y(g.a[3] ?? 0))}" x2="${f1(X(g.b[0]))}" y2="${f1(Y(g.b[3] ?? 0))}" stroke="${AMBER}" stroke-width="2.4" stroke-dasharray="7 6"/>`);
    });
    out.push(`<line x1="${f1(X(s.t))}" y1="${c.y - 6}" x2="${f1(X(s.t))}" y2="${c.y + c.h + 2}" stroke="#f2fbff" stroke-width="1.6"/>`);
    out.push(`<circle cx="${f1(X(s.t))}" cy="${f1(Y(plane.altFt ?? 0))}" r="6" fill="#f2fbff" stroke="${CYAN}" stroke-width="2"/>`);
  } else {
    const y0 = 660;
    out.push(`<rect x="24" y="${y0}" width="${W - 48}" height="${H - y0 - 52}" rx="16" fill="rgba(5,14,22,0.88)" stroke="rgba(57,208,255,0.38)"/>`);
    out.push(`<text x="52" y="${y0 + 46}" font-size="20" font-weight="700" letter-spacing="3" fill="${CYAN}">${esc(eventWhat(event).toUpperCase())}</text>`);
    out.push(`<text x="52" y="${y0 + 90}" font-size="32" font-weight="700" fill="#f2fbff">${esc(flightLine(event))}</text>`);
    out.push(`<text x="52" y="${y0 + 126}" font-size="22" fill="rgba(223,243,251,0.75)">${esc([dateSk(event.firstT), event.reg, event.typeCode].filter(Boolean).join(' · '))} · časy UTC</text>`);
    // Súhrn momentov: pri veľa momentoch menšie písmo, potom „+ N ďalších" (nikdy cez pätu).
    const n = moments.length;
    const room = H - 150 - (y0 + 182);
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
      out.push(`<text x="96" y="${f1(y)}" font-size="${size}" fill="rgba(223,243,251,0.75)">+ ${more} ${more === 1 ? 'ďalší moment' : (more <= 4 ? 'ďalšie momenty' : 'ďalších momentov')}</text>`);
      y += step;
    }
    if (verified) {
      out.push(`<text x="52" y="${f1(y + 18)}" font-size="21" font-weight="700" fill="#4ade80">✓ Overené dvomi nezávislými sieťami prijímačov</text>`);
      out.push(`<text x="52" y="${f1(y + 52)}" font-size="21" fill="rgba(223,243,251,0.85)">Médiá: ${esc(media.join(', '))}</text>`);
    }
    out.push(`<text x="52" y="${H - 84}" font-size="24" font-weight="600" letter-spacing="2" fill="${CYAN}">Celá rekonštrukcia: okolive.sk</text>`);
  }
  out.push(`<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-size="16" fill="rgba(223,243,251,0.82)" ${shadow}>© Google · Cesium ion · údaje OpenSky Network, adsb.lol (ODbL)${event.route ? ' · plán letu adsbdb' : ''}</text>`);
  out.push('</svg>');
  return out.join('');
}
