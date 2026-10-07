// src/data/frontDayHud.js — popisy denného videa „Deň na fronte" (2026-10-05) v štýle OKO, natívne 9:16.
// Rovnaká reč ako Týždeň na fronte a video udalostí (eventVideoHud VIDEO_SVG: písma JetBrains Mono a Inter,
// azúrová OKO, značka OK+O, logo, „NAŽIVO okolive.sk", podpis), ale podľa Mety: háčik od prvej snímky bez
// veľkého loga, dôležité veci v bezpečnej zóne Reels (y 220–1580; vpravo dole tlačidlá aplikácie), titulky
// pre pozeranie bez zvuku vpáli linka (pás nad pätou). Kritický slovník voči agresorovi, údaje GŠ ako
// údaje jednej strany, hrozba z neba ako hlásená hrozba, zdroj mapy okolive.sk. Pure.
//   úvodná karta   háčik dňa (štítok, 2 riadky, doplnok), malá značka hore, „Ukrajina · dátum"
//   počas videa    malá hlavička (značka vľavo, DEŇ NA FRONTE · dátum vpravo), karta pod ňou podľa záberu
//                  (celý front / smer / noc a údery), na mape popisy zmeny za deň a body ohrozených oblastí
//   koncová karta  logo, OKO, „Denný prehľad frontu každé ráno", NAŽIVO okolive.sk, podpis
//   päta           zdroje na každej snímke

import { VIDEO_BRAND, VIDEO_SVG } from './eventVideoHud.js';
import { MAP_SOURCE, directionSk } from './frontWeekNarration.js';
import { FRONT_COLORS } from './frontWeekHud.js';
import { FRONT_DAY_FORMAT, FRONT_DAY_VIDEO } from './frontDayVideo.js';
import { UKRAINE_OUTLINE_BBOX, UKRAINE_OUTLINE_RINGS } from './ukraineOutline.js';
import { FRONT_SCENES } from '../ukraineFrontScenes.js';

const { MONO, SANS, ACCENT, DIM, shadow, esc, f1, wordmark, logoAt, creditLine, liveDomain } = VIDEO_SVG;
const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const fade01 = (x) => Math.min(1, Math.max(0, x));
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const daySk = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.${NBSP}${m[1]}` : ''; };

/** Zdroje v päte každej snímky (video sa šíri aj bez textu príspevku). */
export const FRONT_DAY_SOURCES = [
  `mapa frontu a výpočet zmeny územia: ${MAP_SOURCE.site} · © OpenStreetMap`,
  'strety a údery: Generálny štáb Ukrajiny cez armyinform.com.ua (údaje jednej strany) · hrozba: Vzdušné sily ZSU',
];
/** Bezpečná zóna Reels: hore hlavička aplikácie, dole popis a tlačidlá. */
export const DAY_SAFE = Object.freeze({ top: 222, bottom: 1580, right: 150 });
/** Spodok titulkov (linka ich vpáli) — popisy na mape sa nesmú dostať pod ne. */
export const DAY_CAPTION_BOTTOM = 1500;
export const DAY_LABEL_FLOOR_Y = 1330;

const KIND_NOM = { missiles: 'rakety', drones: 'drony', bombs: 'riadené bomby' };
const STRIKE_LABEL = {
  guidedBombs: ['riadená letecká bomba', 'riadené letecké bomby', 'riadených leteckých bômb'],
  kamikazeDrones: ['dron-kamikadze', 'drony-kamikadze', 'dronov-kamikadze'],
  airStrikes: ['letecký úder', 'letecké údery', 'leteckých úderov'],
  missileStrikes: ['raketový úder', 'raketové údery', 'raketových úderov'],
};

/** Najviac toľko miest útoku na karte aj na mape. */
export const HIT_MAX = 3;

/**
 * Rozmiestnenie štítkov miest útoku bez prekrytia (výška 44 px): poradie = dôležitosť; každý skúsi vpravo, vľavo,
 * potom posun hore/dole o 54 px; štítok nezakryje ani značku iného miesta. Pure.
 * @param {Array<{x: number, y: number, w: number}>} items
 * @returns {Array<{x: number, y: number, w: number}>} ľavý horný roh štítku
 */
export function placeHitLabels(items, { minX = 0, maxX = 1080, h = 44, gap = 30 } = {}) {
  const placed = [];
  const hit = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 6 && b.y < a.y + a.h + 6;
  const marks = items.map((m) => ({ x: m.x - 24, y: m.y - 24, w: 48, h: 48 }));
  return items.map((m, k) => {
    const tries = [];
    for (const dy of [0, -54, 54, -108, 108]) {
      tries.push({ x: m.x + gap, y: m.y - h / 2 + dy }, { x: m.x - gap - m.w, y: m.y - h / 2 + dy });
    }
    const ok = tries.map((t) => ({ ...t, w: m.w, h })).filter((t) => t.x >= minX && t.x + t.w <= maxX);
    const best = ok.find((t) => !placed.some((p) => hit(t, p)) && !marks.some((mk, j) => j !== k && hit(t, mk))) || ok[0] || { x: m.x + gap, y: m.y - h / 2, w: m.w, h };
    placed.push(best);
    return { x: best.x, y: best.y, w: m.w };
  });
}

/** Riadok miesta útoku na karte: „20 mŕtvych, z toho 5 detí" / „2 mŕtvi · 47 zranených". Pure. */
export function hitSummary(p) {
  const parts = [];
  if (p?.killed) parts.push(`${group(p.killed)} ${plural(p.killed, 'mŕtvy', 'mŕtvi', 'mŕtvych')}${p.children ? `, z toho ${group(p.children)} ${plural(p.children, 'dieťa', 'deti', 'detí')}` : ''}`);
  if (p?.injured) parts.push(`${group(p.injured)} zranených`);
  return parts.join(' · ');
}

/**
 * Body na mape, ktoré nahrávanie premieta na obrazovku: zmena územia za deň po smeroch (`chg:<smer>:ru|ua`)
 * a ohrozené oblasti (`air:<i>`). Pure.
 */
export function dayAnchorPoints(model) {
  const out = {};
  for (const d of model?.change?.directions || []) {
    if ((d.ruKm2 ?? 0) >= 1 && d.ruAt) out[`chg:${d.id}:ru`] = { lon: d.ruAt.lon, lat: d.ruAt.lat };
    if ((d.uaKm2 ?? 0) >= 1 && d.uaAt) out[`chg:${d.id}:ua`] = { lon: d.uaAt.lon, lat: d.uaAt.lat };
  }
  (model?.air?.points || []).forEach((p, i) => { if (Number.isFinite(p?.lon) && Number.isFinite(p?.lat)) out[`air:${i}`] = { lon: p.lon, lat: p.lat }; });
  (model?.pins || []).forEach((p, i) => { if (Number.isFinite(p?.lon) && Number.isFinite(p?.lat)) out[`pin:${i}`] = { lon: p.lon, lat: p.lat }; });
  (model?.route?.points || []).forEach((p, i) => { out[`route:${i}`] = { lon: p.lon, lat: p.lat }; });
  // Miesta ruského útoku s obeťami (`hit:<i>`, poradie ako model.casualties.places).
  (model?.casualties?.places || []).slice(0, HIT_MAX).forEach((p, i) => { if (Number.isFinite(p?.lon) && Number.isFinite(p?.lat)) out[`hit:${i}`] = { lon: p.lon, lat: p.lat }; });
  return out;
}

/** Veta háčika so zvýraznením čísla (accent) — tspany po slovách. */
/** Veľkosť písma riadku háčika, aby sa zmestil do karty (~920 px; Inter 800 ≈ 0,66 em na znak veľkými). Pure. */
export function hookLineSize(text) {
  return Math.max(44, Math.min(78, Math.floor(920 / (String(text).length * 0.66))));
}
/** Šírka bubliny zmeny územia podľa popisu (17 px písmo ≈ 9,4 px na znak). Pure. */
export function calloutWidth(sub) {
  return Math.max(250, Math.round(String(sub).length * 9.4) + 36);
}
/** Tmavý pás pod riadkami zdrojov. */
const sourcesBand = () => `<rect x="0" y="1582" width="1080" height="58" fill="rgba(3,8,14,0.62)"/>`;

function accentLine(text, accent, color = '#ff6b78') {
  const a = new Set(String(accent || '').split(/ +/).filter(Boolean));
  return String(text).split(' ').map((w) => (a.has(w) ? `<tspan fill="${color}">${esc(w)}</tspan>` : esc(w))).join(' ');
}

/**
 * SVG popisov jednej snímky.
 * @param {object} model model dňa (frontDayData)
 * @param {object} fs plan.at(frame)
 * @param {{logoMarkup?: object|null, hook?: {tag, lines, accent, sub}|null, story?: string, mapDay?: string|null,
 *   anchors?: Record<string, {x: number, y: number}>|null}} [opts]
 */
export function buildFrontDayHudSvg(model, fs, { logoMarkup = null, hook = null, story = 'clashes', mapDay = null, anchors = null } = {}) {
  const logo = logoAt(logoMarkup);
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const { layers } = fs;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`];
  out.push('<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.78"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + '<linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient></defs>');
  out.push(`<rect width="${W}" height="640" fill="url(#top)"/><rect y="${H - 520}" width="${W}" height="520" fill="url(#bot)"/>`);
  const dateText = daySk(model.day);

  // ── úvodná karta: háčik od prvej snímky, logo len malé ──
  if (layers.opening > 0 && hook) {
    out.push(`<g opacity="${f1(layers.opening)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.42"/>`);
    out.push(logo(W / 2 - 128, DAY_SAFE.top + 8, 56));
    out.push(wordmark(W / 2 - 58, DAY_SAFE.top + 52, 40));
    out.push(creditLine(W / 2, DAY_SAFE.top + 92, 15, 'middle'));
    const lineH = 92;
    const top = 600;
    const panelH = 104 + hook.lines.length * lineH + (hook.sub ? 64 : 0) + 20;
    out.push(`<rect x="36" y="${top}" width="${W - 72}" height="${panelH}" rx="22" fill="rgba(5,14,22,0.9)" stroke="rgba(255,90,90,0.8)" stroke-width="2.5"/>`);
    out.push(`<text x="${W / 2}" y="${top + 60}" text-anchor="middle" font-family="${MONO}" font-size="28" font-weight="700" letter-spacing="6" fill="#ff8a8a">${esc(hook.tag)}</text>`);
    hook.lines.forEach((l, j) => out.push(`<text x="${W / 2}" y="${top + 150 + j * lineH}" text-anchor="middle" font-size="${hookLineSize(l)}" font-weight="800" fill="#ffffff" ${shadow}>${accentLine(l, hook.accent)}</text>`));
    if (hook.sub) out.push(`<text x="${W / 2}" y="${top + 150 + (hook.lines.length - 1) * lineH + 72}" text-anchor="middle" font-size="36" font-weight="600" fill="#f2fbff">${esc(hook.sub)}</text>`);
    const pill = `${model.placeLabel || 'Ukrajina'} · ${dateText}`;
    const pw = pill.length * 15.5 + 48;
    out.push(`<rect x="${f1(W / 2 - pw / 2)}" y="${top + panelH + 26}" width="${f1(pw)}" height="52" rx="26" fill="rgba(5,14,22,0.84)"/>`);
    out.push(`<text x="${W / 2}" y="${top + panelH + 62}" text-anchor="middle" font-size="29" font-weight="600" fill="rgba(232,234,237,0.92)">${esc(pill)}</text>`);
    out.push('</g>');
  }

  // ── počas videa ──
  if (layers.main > 0) {
    out.push(`<g opacity="${f1(layers.main)}">`);
    // Malá hlavička: značka vľavo, DEŇ NA FRONTE · dátum vpravo.
    const hy = DAY_SAFE.top + 8;
    out.push(`<rect x="24" y="${hy}" width="${W - 48}" height="104" rx="16" fill="rgba(5,14,22,0.66)"/>`);
    out.push(logo(40, hy + 14, 76));
    out.push(wordmark(128, hy + 62, 44));
    out.push(`<text x="130" y="${hy + 90}" font-family="${MONO}" font-size="17" font-weight="500" letter-spacing="2.5" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
    out.push(`<text x="${W - 46}" y="${hy + 42}" text-anchor="end" font-family="${MONO}" font-size="22" font-weight="700" letter-spacing="4" fill="${ACCENT}" ${shadow}>${esc(model.header || 'DEŇ NA FRONTE')}</text>`);
    out.push(`<text x="${W - 46}" y="${hy + 80}" text-anchor="end" font-size="34" font-weight="700" fill="#f2fbff" ${shadow}>${esc(dateText)}</text>`);
    if (mapDay) out.push(`<text x="${W - 46}" y="${hy + 100}" text-anchor="end" font-family="${MONO}" font-size="14" letter-spacing="1" fill="${DIM}">mapa: stav k ${esc(daySk(mapDay))}</text>`);

    // Karta pod hlavičkou podľa záberu.
    const y0 = hy + 122;
    const kind = fs.shot.kind;
    const card = (h, body) => { out.push(`<g opacity="${f1(fs.cardAlpha)}"><rect x="24" y="${y0}" width="${W - 48}" height="${h}" rx="16" fill="rgba(5,14,22,0.88)" stroke="rgba(0,212,255,0.38)"/>${body}</g>`); };
    const c = model.change;
    if (kind === 'overview') {
      const avg = Number.isFinite(model.avg7) ? model.avg7 : null;
      const down = avg !== null && model.report.total < avg;
      let body = `<text x="52" y="${y0 + 40}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="${ACCENT}">CELÝ FRONT · ZA 24 HODÍN</text>`
        + `<text x="52" y="${y0 + 112}" font-family="${MONO}" font-size="68" font-weight="700" fill="#f2fbff">${group(model.report.total)}</text>`
        + `<text x="52" y="${y0 + 144}" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="2.5" fill="${DIM}">BOJOVÝCH STRETOV</text>`;
      if (avg !== null) body += `<text x="300" y="${y0 + 106}" font-size="24" font-weight="600" fill="${down ? '#7dd3fc' : '#ffb020'}">${down ? '▼' : '▲'} týždenný priemer ${group(avg)}</text>`;
      if (c && c.ruKm2 >= 1) {
        body += `<text x="${W - 52}" y="${y0 + 112}" text-anchor="end" font-family="${MONO}" font-size="46" font-weight="700" fill="${FRONT_COLORS.gained}">+${group(c.ruKm2)}${NBSP}km²</text>`
          + `<text x="${W - 52}" y="${y0 + 144}" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="2" fill="${DIM}">OBSADIL RUSKÝ AGRESOR</text>`;
      }
      card(170, body);
    } else if (kind === 'dir') {
      const d = (model.directions || []).find((x) => x.id === fs.shot.sceneId);
      const ch = c?.directions?.find((x) => x.id === fs.shot.sceneId);
      let body = `<text x="52" y="${y0 + 56}" font-size="40" font-weight="800" fill="#ffffff">${esc(directionSk(fs.shot.sceneId).title)}</text>`;
      if (d) {
        body += `<text x="52" y="${y0 + 130}" font-family="${MONO}" font-size="64" font-weight="700" fill="#f2fbff">${group(d.attacks)}</text>`
          + `<text x="${52 + String(group(d.attacks)).length * 40 + 18}" y="${y0 + 122}" font-size="26" font-weight="600" fill="#f2fbff">${plural(d.attacks, 'ruský útok', 'ruské útoky', 'ruských útokov')} za 24 h</text>`;
      }
      if (ch && (ch.ruKm2 >= 1 || ch.uaKm2 >= 1)) {
        const ruMain = ch.ruKm2 >= ch.uaKm2;
        body += `<text x="${W - 52}" y="${y0 + 64}" text-anchor="end" font-family="${MONO}" font-size="40" font-weight="700" fill="${ruMain ? FRONT_COLORS.gained : FRONT_COLORS.lost}">+${group(ruMain ? ch.ruKm2 : ch.uaKm2)}${NBSP}km²</text>`
          + `<text x="${W - 52}" y="${y0 + 94}" text-anchor="end" font-size="20" fill="${DIM}">${ruMain ? 'ruská okupácia sa rozšírila' : 'Ukrajina oslobodila'}</text>`;
      }
      card(158, body);
    } else if (kind === 'air') {
      const air = model.air;
      let body = `<text x="52" y="${y0 + 40}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="#ff8a8a">NOČNÁ HROZBA Z NEBA</text>`;
      if (air?.count) {
        body += `<text x="52" y="${y0 + 112}" font-family="${MONO}" font-size="68" font-weight="700" fill="#f2fbff">${group(air.count)}</text>`
          + `<text x="${52 + String(air.count).length * 42 + 18}" y="${y0 + 102}" font-size="28" font-weight="700" fill="#f2fbff">${plural(air.count, 'oblasť', 'oblasti', 'oblastí')} Ukrajiny</text>`
          + `<text x="${52 + String(air.count).length * 42 + 18}" y="${y0 + 134}" font-size="21" fill="${DIM}">${esc((air.kinds || []).map((k) => KIND_NOM[k]).filter(Boolean).join(' · ') || 'vzdušný útok')} · hlásená hrozba, nie potvrdené zásahy</text>`;
      }
      const strikes = Object.entries(STRIKE_LABEL).map(([k, f]) => ({ n: model.strikes?.[k], f })).filter((s) => Number.isFinite(s.n) && s.n > 0).sort((a, b) => b.n - a.n).slice(0, 2);
      strikes.forEach((s, i) => {
        body += `<text x="52" y="${y0 + 186 + i * 38}" font-family="${MONO}" font-size="28" font-weight="700" fill="#ffb020">${group(s.n)}</text>`
          + `<text x="${52 + String(group(s.n)).length * 18 + 16}" y="${y0 + 186 + i * 38}" font-size="23" fill="#f2fbff">${esc(plural(s.n, ...s.f))} (ruské údery, hlásenie GŠ)</text>`;
      });
      card(strikes.length ? 170 + strikes.length * 38 : 158, body);
    } else if (kind === 'spot') {
      // Vlastné miesto zo scenára (napr. tanker pri Soči): štítok, veľké číslo alebo titulok, riadky.
      const spot = model.spots?.[fs.shot.sceneId] || {};
      let body = `<text x="52" y="${y0 + 40}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="${spot.tagColor || '#ff8a8a'}">${esc(spot.tag || '')}</text>`;
      body += `<text x="52" y="${y0 + 100}" font-size="${spot.title && spot.title.length > 26 ? 38 : 46}" font-weight="800" fill="#ffffff">${accentLine(spot.title || '', spot.accent || '')}</text>`;
      const rows = (spot.rows || []).slice(0, 4);
      rows.forEach((r, i) => { body += `<text x="52" y="${y0 + 150 + i * 38}" font-size="25" fill="${i === 0 ? '#f2fbff' : '#d6e7ef'}">${esc(r)}</text>`; });
      card(rows.length ? 132 + rows.length * 38 : 124, body);
    } else if (kind === 'strike') {
      const cas = model.casualties;
      const killed = cas?.total?.killed;
      let body = `<text x="52" y="${y0 + 40}" font-family="${MONO}" font-size="19" font-weight="700" letter-spacing="3" fill="#ff8a8a">RUSKÝ ÚTOK · OBETE</text>`;
      if (killed) {
        body += `<text x="52" y="${y0 + 112}" font-family="${MONO}" font-size="68" font-weight="700" fill="#ff6b78">${group(killed)}</text>`
          + `<text x="${52 + String(group(killed)).length * 42 + 18}" y="${y0 + 102}" font-size="28" font-weight="700" fill="#f2fbff">${plural(killed, 'mŕtvy', 'mŕtvi', 'mŕtvych')}${cas.total.injured ? ` · ${group(cas.total.injured)} zranených` : ''}</text>`
          + `<text x="${52 + String(group(killed)).length * 42 + 18}" y="${y0 + 134}" font-size="21" fill="${DIM}">najmenej · čísla potvrdené aspoň dvoma médiami</text>`;
      }
      const rows = (cas?.places || []).slice(0, HIT_MAX);
      rows.forEach((p, i) => {
        body += `<text x="52" y="${y0 + 190 + i * 40}" font-size="26" font-weight="800" fill="#f2fbff">${esc(p.sk)}</text>`
          + `<text x="${52 + Math.round(p.sk.length * 15.5) + 18}" y="${y0 + 190 + i * 40}" font-size="24" fill="#ffb4b4">${esc(hitSummary(p))}</text>`;
      });
      card(rows.length ? 172 + rows.length * 40 : 158, body);
    }

    // Na mape: zmena územia za deň (kruh + číslo) v prehľade a pri smere.
    const wave = (phase = 0) => Math.sin((fs.localS * Math.PI * 2) / 1.5 + phase);
    if (anchors && (kind === 'dir' || kind === 'overview')) {
      const appear = fade01((fs.localS - (kind === 'dir' ? FRONT_DAY_VIDEO.flyS - 0.1 : 0.4)) / 0.35);
      const items = Object.entries(anchors).filter(([id]) => id.startsWith('chg:'))
        .map(([id, p]) => { const [, sceneId, side] = id.split(':'); const ch = c?.directions?.find((x) => x.id === sceneId); return { sceneId, side, p, km2: side === 'ru' ? ch?.ruKm2 : ch?.uaKm2 }; })
        .filter((x) => x.p && x.km2 >= 1 && x.p.x > 30 && x.p.x < W - 30 && x.p.y > y0 + 200 && x.p.y < DAY_LABEL_FLOOR_Y);
      if (appear > 0) for (const it of items) {
        const color = it.side === 'ru' ? FRONT_COLORS.gained : FRONT_COLORS.lost;
        const r = 30 + 4 * wave();
        const sub = it.side === 'ru' ? `obsadené za deň · ${directionSk(it.sceneId).name}` : `oslobodené za deň · ${directionSk(it.sceneId).name}`;
        const bw = calloutWidth(sub); const bh = 70;
        const right = it.p.x + 46 + bw <= W - DAY_SAFE.right / 2;
        const bx = right ? it.p.x + 46 : it.p.x - 46 - bw;
        const by = Math.min(DAY_LABEL_FLOOR_Y - bh, Math.max(y0 + 200, it.p.y - bh / 2));
        out.push(`<g opacity="${f1(appear)}"><circle cx="${f1(it.p.x)}" cy="${f1(it.p.y)}" r="${f1(r)}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="7"/><circle cx="${f1(it.p.x)}" cy="${f1(it.p.y)}" r="${f1(r)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="3.4"/>`);
        out.push(`<rect x="${f1(bx)}" y="${f1(by)}" width="${bw}" height="${bh}" rx="12" fill="rgba(5,14,22,0.93)" stroke="${color}" stroke-width="2"/>`);
        out.push(`<text x="${f1(bx + 16)}" y="${f1(by + 34)}" font-family="${MONO}" font-size="31" font-weight="700" fill="${color}">+${group(it.km2)}${NBSP}km²</text>`);
        out.push(`<text x="${f1(bx + 16)}" y="${f1(by + 58)}" font-size="17" fill="rgba(232,234,237,0.9)">${esc(sub)}</text></g>`);
      }
    }
    // Ohrozené oblasti: pulzujúce body (pri hrozbe z neba a v úvodnej karte o nej).
    // Miesta útoku: biely kruh so zameriavačom + meno a počet obetí (pod kartou, nad titulkami).
    if (anchors && kind === 'strike') {
      const hits = model.casualties?.places || [];
      const pts = Object.entries(anchors).filter(([id]) => id.startsWith('hit:'))
        .map(([id, p]) => ({ i: Number(id.slice(4)), p })).filter(({ i, p }) => p && hits[i] && p.y >= y0 + 330 && p.y <= DAY_LABEL_FLOOR_Y)
        .map(({ i, p }) => ({ i, p, label: `${hits[i].sk}${hits[i].killed ? ` · ${group(hits[i].killed)} ${plural(hits[i].killed, 'mŕtvy', 'mŕtvi', 'mŕtvych')}` : ''}` }));
      // Štítky bez prekrytia (Kyjev a Pryluky sú 130 km od seba — pri celej Ukrajine takmer na jednom mieste).
      const boxes = placeHitLabels(pts.map(({ p, label }) => ({ x: p.x, y: p.y, w: Math.round(label.length * 12.5) + 28 })), { minX: 24, maxX: W - 24 });
      pts.forEach(({ i, p, label }, k) => {
        const a = fade01((fs.localS - 0.4 - i * 0.25) / 0.3);
        if (a <= 0) return;
        const r = 16 + 5 * wave(i * 0.9); const b = boxes[k];
        out.push(`<g opacity="${f1(a)}"><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r + 12)}" fill="#ff3b3b" fill-opacity="0.2"/>`
          + `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r)}" fill="none" stroke="#ffffff" stroke-width="3"/><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="6" fill="#ff3b3b" stroke="#ffffff" stroke-width="2"/>`
          + (Math.abs(b.y + 22 - p.y) > 4 ? `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${f1(b.x < p.x ? b.x + b.w : b.x)}" y2="${f1(b.y + 22)}" stroke="#ff6b78" stroke-width="2"/>` : '')
          + `<rect x="${f1(b.x)}" y="${f1(b.y)}" width="${b.w}" height="44" rx="10" fill="rgba(5,14,22,0.92)" stroke="#ff6b78" stroke-width="2"/>`
          + `<text x="${f1(b.x + 14)}" y="${f1(b.y + 30)}" font-size="22" font-weight="700" fill="#f2fbff">${esc(label)}</text></g>`);
      });
    }
    // Body scenára (`pin:<i>`) — len v záberoch, ktoré ich vymenujú (model.pins[i].shots).
    if (anchors && kind === 'spot') {
      const pins = model.pins || [];
      const vis = Object.entries(anchors).filter(([id]) => id.startsWith('pin:')).map(([id, p]) => ({ i: Number(id.slice(4)), p }))
        .filter(({ i, p }) => p && pins[i] && (!pins[i].shots || pins[i].shots.includes(fs.shot.sceneId)) && p.y >= y0 + 300 && p.y <= DAY_LABEL_FLOOR_Y);
      const boxes = placeHitLabels(vis.map(({ i, p }) => ({ x: p.x, y: p.y, w: Math.round(String(pins[i].label).length * 12.5) + 28 })), { minX: 24, maxX: W - 24 });
      vis.forEach(({ i, p }, k) => {
        const pin = pins[i]; const b = boxes[k];
        const a = fade01((fs.localS - 0.4 - k * 0.2) / 0.3);
        if (a <= 0) return;
        const color = pin.color || '#ff3b3b';
        const r = (pin.kind === 'fire' ? 10 : 14) + 4 * wave(k * 0.8);
        out.push(`<g opacity="${f1(a)}"><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r + 12)}" fill="${color}" fill-opacity="0.22"/>`
          + `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(pin.kind === 'fire' ? 7 : 6)}" fill="${color}" stroke="#ffffff" stroke-width="2"/>`
          + (pin.label ? `<rect x="${f1(b.x)}" y="${f1(b.y)}" width="${b.w}" height="44" rx="10" fill="rgba(5,14,22,0.92)" stroke="${color}" stroke-width="2"/>`
            + `<text x="${f1(b.x + 14)}" y="${f1(b.y + 30)}" font-size="22" font-weight="700" fill="#f2fbff">${esc(pin.label)}</text>` : '') + '</g>');
      });
      // Čiara trasy (napr. Novorossijsk → Bospor) — body `route:<i>`.
      const route = Object.entries(anchors).filter(([id]) => id.startsWith('route:')).sort((x, y) => Number(x[0].slice(6)) - Number(y[0].slice(6))).map(([, p]) => p).filter(Boolean);
      if (route.length >= 2 && (model.route?.shots || []).includes(fs.shot.sceneId)) {
        const prog = fade01((fs.localS - 0.3) / 1.6);
        const pts = route.slice(0, Math.max(2, Math.ceil(route.length * prog)));
        out.push(`<polyline points="${pts.map((q) => `${f1(q.x)},${f1(q.y)}`).join(' ')}" fill="none" stroke="#ffb020" stroke-width="4" stroke-dasharray="14 10" opacity="${f1(Math.min(1, prog * 2))}"/>`);
      }
    }
    if (anchors && kind === 'air') {
      Object.entries(anchors).filter(([id]) => id.startsWith('air:')).forEach(([, p], i) => {
        const a = fade01((fs.localS - 0.3 - i * 0.05) / 0.25);
        if (!p || a <= 0) return;
        const r = 13 + 4 * wave(i * 0.7);
        out.push(`<g opacity="${f1(a)}"><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r + 10)}" fill="#ff3b3b" fill-opacity="0.18"/><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r * 0.6)}" fill="#ff3b3b" stroke="#2a0606" stroke-width="2"/></g>`);
      });
    }
    out.push('</g>');
  }

  // ── koncová karta ──
  if (layers.endCard > 0) {
    out.push(`<g opacity="${f1(layers.endCard)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.6"/>`);
    out.push(logo(W / 2 - 90, 420, 180));
    out.push(wordmark(W / 2 + 9, 730, 124, 'middle'));
    out.push(`<text x="${W / 2}" y="806" text-anchor="middle" font-size="40" font-weight="700" fill="#f2fbff" ${shadow}>${esc(model.endLine || 'Denný prehľad frontu každé ráno')}</text>`);
    out.push(`<text x="${W / 2}" y="856" text-anchor="middle" font-family="${MONO}" font-size="19" letter-spacing="6" fill="rgba(232,234,237,0.8)" ${shadow}>${VIDEO_BRAND.tagline}</text>`);
    out.push(liveDomain(W / 2, 990, 56));
    out.push(creditLine(W / 2, 1070, 20, 'middle'));
    out.push('</g>');
  }

  // Zdroje na každej snímke (na tmavom páse — inak sa bijú s popismi miest na mape).
  out.push(sourcesBand());
  (model.sources || FRONT_DAY_SOURCES).forEach((line, i) => out.push(`<text x="${W / 2}" y="${1606 + i * 22}" text-anchor="middle" font-size="15" fill="rgba(223,243,251,0.82)" ${shadow}>${esc(line)}</text>`));
  out.push('</svg>');
  return out.join('');
}

/** Okno videa akčného záberu v snímke 9:16 (16:9 video na šírku, zvislé sa zmestí na výšku). */
export const CLIP_BOX = Object.freeze({ x: 0, y: 600, w: 1080, h: 640 });

/**
 * Rám akčného záberu (priehľadné SVG nad videom): hlavička ako počas videa, nad videom „ZÁBERY · MINISTERSTVO
 * OBRANY UKRAJINY" a slovenský popis (z nadpisu zdroja), pod videom mapka Ukrajiny s miestom (smer) a zdroj
 * ArmyInform (CC BY 4.0 žiada uvedenie), päta so zdrojmi. Vlastný rám, popis a miesto = pridaná hodnota
 * (Meta: prevzatý klip bez nej má nižší dosah). Pure.
 * @param {{captionSk: string, direction?: string|null, sensitive?: boolean}} clip
 */
export function buildClipOverlaySvg(clip, { logoMarkup = null, day = null } = {}) {
  const logo = logoAt(logoMarkup);
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`];
  const hy = DAY_SAFE.top + 8;
  out.push(`<rect x="24" y="${hy}" width="${W - 48}" height="104" rx="16" fill="rgba(5,14,22,0.72)"/>`);
  out.push(logo(40, hy + 14, 76));
  out.push(wordmark(128, hy + 62, 44));
  out.push(`<text x="130" y="${hy + 90}" font-family="${MONO}" font-size="17" font-weight="500" letter-spacing="2.5" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
  out.push(`<text x="${W - 46}" y="${hy + 42}" text-anchor="end" font-family="${MONO}" font-size="22" font-weight="700" letter-spacing="4" fill="${ACCENT}" ${shadow}>DEŇ NA FRONTE</text>`);
  if (day) out.push(`<text x="${W - 46}" y="${hy + 80}" text-anchor="end" font-size="34" font-weight="700" fill="#f2fbff" ${shadow}>${esc(daySk(day))}</text>`);
  // Nad videom: kto záber zverejnil a čo ukazuje.
  const where = clip.direction ? directionSk(clip.direction) : null;
  // Štítok a popis medzi hlavičkou (spodok y ≈ 334) a oknom videa: popis do 3 riadkov, nič sa neoreže.
  const caption = `${clip.captionSk}${where ? ` ${where.at}` : ''}`;
  const words = caption.split(' '); const rows = ['']; for (const w of words) { const next = rows[rows.length - 1] ? `${rows[rows.length - 1]} ${w}` : w; if (next.length > 32 && rows[rows.length - 1]) rows.push(w); else rows[rows.length - 1] = next; }
  const rowH = 50; const capSize = rows.length > 2 ? 40 : 44;
  const firstRow = CLIP_BOX.y - 28 - (rows.length - 1) * rowH;
  out.push(`<text x="48" y="${firstRow - 56}" font-family="${MONO}" font-size="21" font-weight="700" letter-spacing="3" fill="#ffb020" ${shadow}>ZÁBERY · MINISTERSTVO OBRANY UKRAJINY</text>`);
  rows.slice(0, 3).forEach((r, i) => out.push(`<text x="48" y="${firstRow + i * rowH}" font-size="${capSize}" font-weight="800" fill="#ffffff" ${shadow}>${esc(r)}</text>`));
  out.push(`<rect x="${CLIP_BOX.x}" y="${CLIP_BOX.y}" width="${CLIP_BOX.w}" height="${CLIP_BOX.h}" fill="none" stroke="rgba(0,212,255,0.55)" stroke-width="3"/>`);
  // Pod videom: mapka Ukrajiny s miestom a zdroj.
  const box = { x: 40, y: CLIP_BOX.y + CLIP_BOX.h + 26, w: 250, h: 180 };
  const [W0, S0, E0, N0] = UKRAINE_OUTLINE_BBOX;
  const kx = Math.cos((((S0 + N0) / 2) * Math.PI) / 180);
  const sc = Math.min((box.w - 16) / ((E0 - W0) * kx), (box.h - 16) / (N0 - S0));
  const ox = box.x + 8 + (box.w - 16 - (E0 - W0) * kx * sc) / 2; const oy = box.y + 8 + (box.h - 16 - (N0 - S0) * sc) / 2;
  const project = (lon, lat) => ({ x: ox + (lon - W0) * kx * sc, y: oy + (N0 - lat) * sc });
  out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="rgba(5,14,22,0.86)" stroke="rgba(255,255,255,0.28)"/>`);
  for (const ring of UKRAINE_OUTLINE_RINGS) out.push(`<path d="${ring.map(([lon, lat], i) => { const p = project(lon, lat); return `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`; }).join('')}Z" fill="${FRONT_COLORS.ua}" fill-opacity="0.75" stroke="rgba(255,255,255,0.55)" stroke-width="1"/>`);
  const scene = clip.direction ? FRONT_SCENES.find((s) => s.id === clip.direction) : null;
  if (scene?.center) {
    const p = project(scene.center.lon ?? scene.center[0], scene.center.lat ?? scene.center[1]);
    out.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="15" fill="#ff3b3b" fill-opacity="0.25" stroke="#ff3b3b" stroke-width="2.5"/><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="5" fill="#ffffff"/>`);
  }
  out.push(`<text x="${box.x + box.w + 26}" y="${box.y + 52}" font-size="30" font-weight="700" fill="#f2fbff" ${shadow}>${esc(where ? where.name : 'Ukrajina')}</text>`);
  out.push(`<text x="${box.x + box.w + 26}" y="${box.y + 92}" font-size="21" fill="rgba(232,234,237,0.88)" ${shadow}>Zdroj: ArmyInform (Ministerstvo obrany</text>`);
  out.push(`<text x="${box.x + box.w + 26}" y="${box.y + 120}" font-size="21" fill="rgba(232,234,237,0.88)" ${shadow}>Ukrajiny) · CC BY 4.0</text>`);
  FRONT_DAY_SOURCES.forEach((line, i) => out.push(`<text x="${W / 2}" y="${1606 + i * 22}" text-anchor="middle" font-size="15" fill="rgba(223,243,251,0.82)" ${shadow}>${esc(line)}</text>`));
  out.push('</svg>');
  return out.join('');
}

/** Štýl titulkov denného videa (eventCaptions CAPTION_STYLE pre 9:16): väčšie písmo, nad pätou so zdrojmi. */
export const DAY_CAPTION_STYLE = Object.freeze({ fontPx: 46, maxChars: 40, bottomPx: DAY_CAPTION_BOTTOM, outroBottomPx: DAY_CAPTION_BOTTOM, fadeS: 0.12, tailS: 0.15, minS: 0.8, splitMinPauseS: 0.12 });
