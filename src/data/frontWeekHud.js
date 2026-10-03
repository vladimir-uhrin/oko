// src/data/frontWeekHud.js — popisy videa „Týždeň na fronte" v štýle OKO + Rybar (2026-10-03, vlastník:
// „video v štýle OKO + Rybar"; územie vo videu áno, zdroj sa volá okolive.sk („používaj zdroje okolive.sk, nie DeepState"), kritický voči agresorovi). Vrstva SVG nad záberom KARTY z OKO, kreslí ju
// prehliadač na stránke OKO (scripts/capture-front-week.mjs) — písma a logo ako na webe.
//   úvodná karta   háčik (najsilnejšie číslo týždňa) so zdrojom, značka OKO, okolive.sk,
//   počas videa    vľavo hore značka ako hlavička webu, vpravo hore titulok mapy ako u Rybara („TÝŽDEŇ NA FRONTE",
//                  rozsah dní, „mapa: stav k …") a pri smere náhľad Ukrajiny s okupovaným územím a výrezom záberu,
//                  dole karta: prehľad (strety, km² oboch strán, smery podľa útokov) alebo smer (útoky, trend,
//                  zmena územia, 14 dní po dňoch) a legenda farieb mapy,
//   koncová karta  logo, OKO, heslo, NAŽIVO okolive.sk.
// Zdroje sú na každej snímke: mapa frontu a výpočet zmeny okolive.sk (dáta vrstvy pochádzajú z mapy DeepState
// cez zrkadlo — výstupy ju z rozhodnutia vlastníka nemenujú, pôvod uvádza appka a DATA_SOURCES.md), strety
// podľa Generálneho štábu Ukrajiny (údaje jednej strany), podklad OpenStreetMap. Slovník je kritický voči
// agresorovi: „obsadené", „ruská okupácia", „ruské útoky", „oslobodené". Pure.

import { VIDEO_3D_FORMAT, VIDEO_BRAND, VIDEO_SVG } from './eventVideoHud.js';
import { UKRAINE_OUTLINE_BBOX, UKRAINE_OUTLINE_RINGS } from './ukraineOutline.js';
import { CHANGE_MIN_KM2, MAP_SOURCE, directionSk, rangeLabel } from './frontWeekNarration.js';
import { FRONT_WEEK_VIDEO } from './frontWeekVideo.js';
import { CONTACT_RU_KINDS } from './ukraineContactLine.js';

const { MONO, SANS, ACCENT, DIM, shadow, esc, f1, wordmark, logoAt, creditLine, liveDomain } = VIDEO_SVG;
const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
/** Riadok zdrojov v päte každej snímky. */
export const FRONT_WEEK_SOURCES = `mapa frontu a výpočet zmeny územia: ${MAP_SOURCE.site} · strety: Generálny štáb Ukrajiny cez armyinform.com.ua (údaje jednej strany) · © OpenStreetMap`;
/** Farby mapy (zhodné s KARTOU: KARTA_LEGEND_COLORS). */
export const FRONT_COLORS = Object.freeze({ occupied: '#8e2330', ua: '#2f6aa3', grey: '#f0922e', gained: '#ff6b78', lost: '#8fd3ff', bolt: '#fbbf24' });
const daySk = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.${NBSP}${m[1]}` : ''; };
const dayShort = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[3])}.${NBSP}${Number(m[2])}.` : ''; };

/**
 * Okupované územie pre náhľad Ukrajiny: vonkajšie prstence ruských druhov snímky, zriedené (najviac
 * `maxPoints` bodov na prstenec) a bez drobných plôch. Pure.
 * @returns {Array<Array<[number, number]>>}
 */
export function insetOccupiedRings(snapshot, { maxPoints = 90, minSpanDeg = 0.12 } = {}) {
  const out = [];
  for (const f of snapshot?.features || []) {
    if (f?.type !== 'Polygon' || !CONTACT_RU_KINDS.includes(f.kind)) continue;
    const ring = f.rings?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    let w = 180; let s = 90; let e = -180; let n = -90;
    for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    if (Math.max(e - w, n - s) < minSpanDeg) continue;
    const step = Math.max(1, Math.ceil(ring.length / maxPoints));
    const thin = ring.filter((_, i) => i % step === 0).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    out.push(thin);
  }
  return out;
}

/** Projekcia náhľadu (ekvirektangulárna, x stlačené o cos strednej šírky) do obdĺžnika. Pure. */
function insetProjection(box, pad = 8) {
  const [W0, S0, E0, N0] = UKRAINE_OUTLINE_BBOX;
  const kx = Math.cos((((S0 + N0) / 2) * Math.PI) / 180);
  const geoW = (E0 - W0) * kx; const geoH = N0 - S0;
  const sc = Math.min((box.w - pad * 2) / geoW, (box.h - pad * 2) / geoH);
  const ox = box.x + pad + (box.w - pad * 2 - geoW * sc) / 2;
  const oy = box.y + pad + (box.h - pad * 2 - geoH * sc) / 2;
  return (lon, lat) => ({ x: ox + (lon - W0) * kx * sc, y: oy + (N0 - lat) * sc });
}
const ringPath = (project, ring) => `${ring.map(([lon, lat], i) => { const p = project(lon, lat); return `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`; }).join('')}Z`;

/**
 * Popisy „kde sa front pohol": smery, v ktorých sa územie zmenilo aspoň o CHANGE_MIN_KM2 (každá strana
 * zvlášť), s bodom na zmenenom území; od najväčšej zmeny. Pure.
 * @returns {Array<{id: string, sceneId: string, side: 'ru'|'ua', km2: number, lon: number, lat: number}>}
 */
export function changeCallouts(model, { max = 5 } = {}) {
  const out = [];
  if (!model?.change?.weekly) return out;
  for (const d of model?.directions || []) {
    if ((d.ruKm2 ?? 0) >= CHANGE_MIN_KM2 && d.ruAt) out.push({ id: `${d.id}:ru`, sceneId: d.id, side: 'ru', km2: d.ruKm2, lon: d.ruAt.lon, lat: d.ruAt.lat });
    if ((d.uaKm2 ?? 0) >= CHANGE_MIN_KM2 && d.uaAt) out.push({ id: `${d.id}:ua`, sceneId: d.id, side: 'ua', km2: d.uaKm2, lon: d.uaAt.lon, lat: d.uaAt.lat });
  }
  return out.sort((a, b) => b.km2 - a.km2 || a.id.localeCompare(b.id)).slice(0, max);
}

/**
 * Výšky popiskov v stĺpci pri okraji: každý čo najbližšie k svojmu bodu, s rozstupom aspoň `gap`, celý
 * stĺpec v medziach `min`…`max`. Poradie vstupu sa zachová. Pure.
 */
export function stackLabels(ys, { gap = 62, min = 250, max = 880 } = {}) {
  const order = (ys || []).map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  if (!order.length) return [];
  const pos = [];
  for (const o of order) pos.push(pos.length ? Math.max(o.y, pos[pos.length - 1] + gap) : o.y);
  // Rozostup posunul spodné popisky nadol — celý stĺpec späť o priemer, nech sú čiary k bodom krátke.
  const shift = order.reduce((s, o, k) => s + (pos[k] - o.y), 0) / order.length;
  let out = pos.map((p) => p - shift);
  const over = Math.max(0, out[out.length - 1] - max);
  out = out.map((p) => p - over);
  const under = Math.max(0, min - out[0]);
  out = out.map((p) => p + under);
  const res = new Array(order.length);
  order.forEach((o, k) => { res[o.i] = out[k]; });
  return res;
}

const fade01 = (x) => Math.min(1, Math.max(0, x));
/**
 * Spodná hranica popiskov na mape (px): pod ňou je pás titulkov (eventCaptions: spodok titulku 940 px,
 * dva riadky siahajú po ~816 px) a karta — popisok by sa pod titulkom stratil.
 */
export const LABEL_FLOOR_Y = 812;

/** Trend smeru slovom a farbou. Pure. */
export function trendLabel(d) {
  if (!d || d.trend === null || d.trend === undefined || !Number.isFinite(d.changePct)) return { text: 'bez porovnania', color: DIM, arrow: '' };
  if (d.trend === 'flat') return { text: 'približne ako minulý týždeň', color: DIM, arrow: '▬' };
  const sign = d.changePct > 0 ? '+' : '−';
  return { text: `${sign}${Math.abs(d.changePct)}${NBSP}% oproti minulému týždňu`, color: d.trend === 'up' ? '#ffb020' : '#7dd3fc', arrow: d.trend === 'up' ? '▲' : '▼' };
}

/**
 * SVG popisov jednej snímky.
 * @param {object} model frontWeekModel(...)
 * @param {object} fs plan.at(frame)
 * @param {{logoMarkup?: object|null, hook?: {tag: string, lines: string[], sub: string|null, source: string}|null,
 *   occupied?: Array, viewRect?: number[]|null, mapDay?: string|null,
 *   anchors?: Record<string, {x: number, y: number}>|null}} [opts] `anchors`: poloha bodov changeCallouts na obrazovke
 */
export function buildFrontWeekHudSvg(model, fs, { logoMarkup = null, hook = null, occupied = [], viewRect = null, mapDay = null, anchors = null } = {}) {
  const logo = logoAt(logoMarkup);
  const { w: W, h: H } = VIDEO_3D_FORMAT;
  const { layers } = fs;
  const range = rangeLabel(model.week.from, model.week.to);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`];
  out.push('<defs><linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.72"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + '<linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.66"/></linearGradient>'
    + '<linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.84"/><stop offset="0.62" stop-color="#000" stop-opacity="0.4"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(240,146,46,0.22)"/><line x1="0" y1="0" x2="0" y2="7" stroke="${FRONT_COLORS.grey}" stroke-width="3"/></pattern></defs>`);
  out.push(`<rect width="${W}" height="236" fill="url(#top)"/><rect y="${H - 460}" width="${W}" height="460" fill="url(#bot)"/>`);

  // ── úvodná karta s háčikom ──
  if (layers.opening > 0 && hook) {
    out.push(`<g opacity="${f1(layers.opening)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.5"/><rect width="${W}" height="${H * 0.82}" fill="url(#card)"/>`);
    out.push(logo(W / 2 - 52, 58, 104));
    out.push(wordmark(W / 2 + 6, 232, 72, 'middle'));
    out.push(creditLine(W / 2, 276, 15, 'middle'));
    const top = 326;
    const lineH = 70;
    const panelH = 92 + hook.lines.length * lineH + (hook.sub ? 54 : 0) + 46;
    out.push(`<rect x="44" y="${top}" width="${W - 88}" height="${panelH}" rx="18" fill="rgba(5,14,22,0.9)" stroke="rgba(255,90,90,0.75)" stroke-width="2"/>`);
    out.push(`<text x="${W / 2}" y="${top + 52}" text-anchor="middle" font-family="${MONO}" font-size="23" font-weight="700" letter-spacing="5" fill="#ff8a8a">${esc(hook.tag)}</text>`);
    hook.lines.forEach((l, j) => out.push(`<text x="${W / 2}" y="${top + 122 + j * lineH}" text-anchor="middle" font-size="${j === hook.lines.length - 1 && hook.lines.length > 1 ? 64 : 54}" font-weight="700" fill="#ffffff" ${shadow}>${esc(l)}</text>`));
    let y = top + 122 + (hook.lines.length - 1) * lineH + 58;
    if (hook.sub) { out.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="33" font-weight="600" fill="#f2fbff">${esc(hook.sub)}</text>`); y += 46; }
    out.push(`<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="21" fill="${DIM}">${esc(hook.source)}</text>`);
    const rangeText = `Ukrajina · ${range}`;
    const rw = rangeText.length * 14.2 + 44;
    out.push(`<rect x="${f1(W / 2 - rw / 2)}" y="${top + panelH + 20}" width="${f1(rw)}" height="46" rx="23" fill="rgba(5,14,22,0.82)"/>`);
    out.push(`<text x="${W / 2}" y="${top + panelH + 52}" text-anchor="middle" font-size="27" font-weight="600" fill="rgba(232,234,237,0.92)">${esc(rangeText)}</text>`);
    out.push(`<text x="${W / 2}" y="${H - 104}" text-anchor="middle" font-family="${MONO}" font-size="46" font-weight="600" letter-spacing="5" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
    out.push('</g>');
  }

  // ── počas videa: značka, titulok mapy, náhľad, karta ──
  if (layers.main > 0) {
    out.push(`<g opacity="${f1(layers.main)}">`);
    out.push('<rect x="14" y="12" width="376" height="156" rx="14" fill="rgba(5,14,22,0.62)"/>');
    out.push(logo(28, 24, 92));
    out.push(wordmark(132, 82, 56));
    out.push(`<text x="134" y="114" font-family="${MONO}" font-size="21" font-weight="500" letter-spacing="3" fill="${ACCENT}" ${shadow}>${VIDEO_BRAND.domain}</text>`);
    out.push(creditLine(34, 148, 14));
    // Titulok mapy vpravo hore (u Rybara vľavo hore — tam je značka).
    const tw = Math.max(330, range.length * 19 + 44);
    out.push(`<rect x="${W - 22 - tw}" y="12" width="${tw}" height="${mapDay ? 132 : 104}" rx="14" fill="rgba(5,14,22,0.62)"/>`);
    out.push(`<text x="${W - 40}" y="52" text-anchor="end" font-family="${MONO}" font-size="22" font-weight="700" letter-spacing="4" fill="${ACCENT}" ${shadow}>TÝŽDEŇ NA FRONTE</text>`);
    out.push(`<text x="${W - 40}" y="94" text-anchor="end" font-size="33" font-weight="700" fill="#f2fbff" ${shadow}>${esc(range)}</text>`);
    if (mapDay) out.push(`<text x="${W - 40}" y="124" text-anchor="end" font-family="${MONO}" font-size="15" letter-spacing="1.5" fill="${DIM}" ${shadow}>mapa: stav k ${esc(daySk(mapDay))}</text>`);

    // Náhľad Ukrajiny s okupovaným územím a výrezom záberu — len pri smere (v prehľade je mapa sama).
    if (fs.shot.kind === 'dir') {
      const box = { x: W - 22 - 232, y: 156, w: 232, h: 168 };
      const project = insetProjection(box);
      out.push(`<g opacity="${f1(fs.cardAlpha)}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="rgba(5,14,22,0.86)" stroke="rgba(255,255,255,0.28)"/>`);
      for (const ring of UKRAINE_OUTLINE_RINGS) out.push(`<path d="${ringPath(project, ring)}" fill="${FRONT_COLORS.ua}" fill-opacity="0.75" stroke="rgba(255,255,255,0.55)" stroke-width="1"/>`);
      for (const ring of occupied) out.push(`<path d="${ringPath(project, ring)}" fill="${FRONT_COLORS.occupied}" stroke="#3d0a0e" stroke-width="0.6"/>`);
      if (Array.isArray(viewRect) && viewRect.length === 4) {
        const a = project(viewRect[0], viewRect[3]); const b = project(viewRect[2], viewRect[1]);
        const rw = Math.max(8, b.x - a.x); const rh = Math.max(8, b.y - a.y);
        const rx = Math.max(box.x + 2, a.x); const ry = Math.max(box.y + 2, a.y);
        const rw2 = Math.min(rw, box.w - 4); const rh2 = Math.min(rh, box.h - 4);
        // Výrez smeru je v náhľade drobný — kruh okolo neho ho robí viditeľným.
        out.push(`<circle cx="${f1(rx + rw2 / 2)}" cy="${f1(ry + rh2 / 2)}" r="${f1(Math.max(rw2, rh2) / 2 + 9)}" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="1.6"/>`);
        out.push(`<rect x="${f1(rx)}" y="${f1(ry)}" width="${f1(rw2)}" height="${f1(rh2)}" fill="rgba(255,255,255,0.2)" stroke="#ffffff" stroke-width="2.2"/>`);
      }
      out.push('</g>');
    }

    // ── kde sa front pohol: popisy zmeny územia priamo na mape ──
    const callouts = anchors ? changeCallouts(model) : [];
    const wave = (phase = 0) => Math.sin((fs.localS * Math.PI * 2) / 1.6 + phase);
    if (fs.shot.kind === 'overview' && callouts.length) {
      // Prehľad: popisky v stĺpci pri okraji s čiarou k miestu (smery ležia pri sebe — pri bodoch by sa prekryli).
      const placed = callouts.map((c, order) => ({ ...c, order, p: anchors[c.id] }))
        .filter((c) => c.p && c.p.x > 0 && c.p.x < W && c.p.y > 180 && c.p.y < 930);
      if (placed.length) {
        const bw = 292; const bh = 54;
        const right = Math.max(...placed.map((c) => c.p.x)) < W - 24 - bw - 40;
        const bx = right ? W - 24 - bw : 24;
        const ys = stackLabels(placed.map((c) => c.p.y), { gap: bh + 8, min: 262, max: LABEL_FLOOR_Y - bh / 2 });
        placed.forEach((c, k) => {
          const a = fade01((fs.localS - 0.6 - c.order * 0.5) / 0.35);
          if (a <= 0) return;
          const color = c.side === 'ru' ? FRONT_COLORS.gained : FRONT_COLORS.lost;
          const cy = ys[k]; const ex = right ? bx : bx + bw; const mx = right ? ex - 26 : ex + 26;
          const line = `M${f1(c.p.x)} ${f1(c.p.y)}L${f1(mx)} ${f1(cy)}L${f1(ex)} ${f1(cy)}`;
          out.push(`<g opacity="${f1(a)}">`);
          // Tmavý podklad o kúsok väčší než popisok: v medzerách stĺpca nepresvitajú útržky názvov miest z mapy.
          out.push(`<rect x="${bx - 5}" y="${f1(cy - bh / 2 - 5)}" width="${bw + 10}" height="${bh + 10}" rx="12" fill="rgba(5,14,22,0.86)"/>`);
          out.push(`<path d="${line}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="4.4"/><path d="${line}" fill="none" stroke="#ffffff" stroke-opacity="0.92" stroke-width="1.8"/>`);
          out.push(`<circle cx="${f1(c.p.x)}" cy="${f1(c.p.y)}" r="${f1(9 + 2.5 * wave(c.order))}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="2.4"/><circle cx="${f1(c.p.x)}" cy="${f1(c.p.y)}" r="3" fill="#ffffff"/>`);
          out.push(`<rect x="${bx}" y="${f1(cy - bh / 2)}" width="${bw}" height="${bh}" rx="9" fill="rgba(5,14,22,0.93)" stroke="${color}" stroke-width="1.6"/>`);
          out.push(`<text x="${bx + 14}" y="${f1(cy - 7)}" font-size="14" font-weight="700" letter-spacing="1.2" fill="rgba(232,234,237,0.88)">${esc(directionSk(c.sceneId).title)}</text>`);
          out.push(`<text x="${bx + 14}" y="${f1(cy + 18)}" font-family="${MONO}" font-size="22" font-weight="700" fill="${color}">+${group(c.km2)}${NBSP}km²</text>`);
          out.push(`<text x="${bx + bw - 14}" y="${f1(cy + 17)}" text-anchor="end" font-size="14" fill="${DIM}">${c.side === 'ru' ? 'Rusko obsadilo' : 'Ukrajina oslobodila'}</text>`);
          out.push('</g>');
        });
      }
    } else if (fs.shot.kind === 'dir' && callouts.length) {
      // Smer: kruh na zmenenom území a číslo vedľa neho (nabehne, keď kamera doletí). Popis dostane každá
      // zmena v zábere — pri susednom smere s jeho menom, aby nebola v rozpore s kartou („línia bez zmeny").
      const a = fade01((fs.localS - (FRONT_WEEK_VIDEO.flyS - 0.2)) / 0.4);
      const bw = 236; const bh = 62; const off = 48;
      const taken = [{ x: W - 22 - 232 - 8, y: 148, w: 248, h: 184 }]; // náhľad Ukrajiny vpravo hore
      const hits = (b) => taken.some((t) => b.x < t.x + t.w && b.x + bw > t.x && b.y < t.y + t.h && b.y + bh > t.y);
      const own = (c) => c.sceneId === fs.shot.sceneId;
      const inView = a > 0 ? callouts
        .filter((c) => { const p = anchors[c.id]; return p && p.x >= 40 && p.x <= W - 40 && p.y >= 190 && p.y <= 920; })
        .sort((x, y) => Number(own(y)) - Number(own(x))) : [];
      for (const c of inView) {
        const p = anchors[c.id];
        const color = c.side === 'ru' ? FRONT_COLORS.gained : FRONT_COLORS.lost;
        const r = (own(c) ? 30 : 24) + 4 * wave();
        const yMid = Math.min(LABEL_FLOOR_Y - bh, Math.max(190, p.y - bh / 2));
        // Vpravo od kruhu, inak vľavo, pod ním, nad ním — prvé miesto, ktoré nič neprekryje.
        const spots = [
          { x: p.x + off, y: yMid }, { x: p.x - off - bw, y: yMid },
          { x: p.x - bw / 2, y: p.y + off }, { x: p.x - bw / 2, y: p.y - off - bh },
        ].filter((s) => s.x >= 16 && s.x + bw <= W - 16 && s.y >= 190 && s.y + bh <= LABEL_FLOOR_Y);
        const spot = spots.find((s) => !hits(s)) || spots[0];
        out.push(`<g opacity="${f1(a)}">`);
        out.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r)}" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="6.5"/><circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(r)}" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-width="3"/>`);
        if (spot) {
          taken.push({ x: spot.x, y: spot.y, w: bw, h: bh });
          const sub = own(c) ? (c.side === 'ru' ? 'obsadené za týždeň' : 'oslobodené za týždeň') : directionSk(c.sceneId).name;
          out.push(`<rect x="${f1(spot.x)}" y="${f1(spot.y)}" width="${bw}" height="${bh}" rx="10" fill="rgba(5,14,22,0.93)" stroke="${color}" stroke-width="1.8"/>`);
          out.push(`<text x="${f1(spot.x + 14)}" y="${f1(spot.y + 30)}" font-family="${MONO}" font-size="27" font-weight="700" fill="${color}">+${group(c.km2)}${NBSP}km²</text>`);
          out.push(`<text x="${f1(spot.x + 14)}" y="${f1(spot.y + 51)}" font-size="14.5" fill="rgba(232,234,237,0.88)">${esc(sub)}</text>`);
        }
        out.push('</g>');
      }
    }

    // ── karta dole ──
    const y0 = 956;
    const cardH = H - y0 - 52;
    out.push(`<rect x="24" y="${y0}" width="${W - 48}" height="${cardH}" rx="16" fill="rgba(5,14,22,0.88)" stroke="rgba(0,212,255,0.38)"/>`);
    const total = model.total;
    if (fs.card === 'overview') {
      out.push(`<g opacity="${f1(fs.cardAlpha)}">`);
      out.push(`<text x="52" y="${y0 + 38}" font-family="${MONO}" font-size="18" font-weight="700" letter-spacing="3" fill="${ACCENT}">CELÝ FRONT · 7 DNÍ</text>`);
      out.push(`<text x="52" y="${y0 + 100}" font-family="${MONO}" font-size="56" font-weight="700" fill="#f2fbff">${group(total.week)}</text>`);
      out.push(`<text x="52" y="${y0 + 128}" font-family="${MONO}" font-size="14" font-weight="700" letter-spacing="2.5" fill="${DIM}">BOJOVÝCH STRETOV</text>`);
      if (Number.isFinite(total.changePct)) out.push(`<text x="262" y="${y0 + 96}" font-size="21" font-weight="600" fill="${total.changePct > 0 ? '#ffb020' : '#7dd3fc'}">${total.changePct > 0 ? '▲ +' : '▼ −'}${Math.abs(total.changePct)}${NBSP}%</text>`);
      if (model.change?.weekly) {
        out.push(`<text x="470" y="${y0 + 100}" font-family="${MONO}" font-size="42" font-weight="700" fill="${FRONT_COLORS.gained}">+${group(model.change.ruKm2)}${NBSP}km²</text>`);
        out.push(`<text x="470" y="${y0 + 128}" font-family="${MONO}" font-size="14" font-weight="700" letter-spacing="2.5" fill="${DIM}">RUSKO OBSADILO</text>`);
        out.push(`<text x="770" y="${y0 + 100}" font-family="${MONO}" font-size="42" font-weight="700" fill="${FRONT_COLORS.lost}">+${group(model.change.uaKm2)}${NBSP}km²</text>`);
        out.push(`<text x="770" y="${y0 + 128}" font-family="${MONO}" font-size="14" font-weight="700" letter-spacing="2.5" fill="${DIM}">UKRAJINA OSLOBODILA</text>`);
      }
      // Smery podľa útokov (najviac 5 riadkov).
      const rows = model.directions.filter((d) => d.week > 0).slice(0, 5);
      const max = Math.max(1, ...rows.map((d) => d.week));
      rows.forEach((d, i) => {
        const y = y0 + 168 + i * 26;
        const bx = 330; const bw = W - 52 - 70 - bx;
        out.push(`<text x="52" y="${y}" font-size="19" font-weight="600" fill="#f2fbff">${esc(directionSk(d.id).title)}</text>`);
        out.push(`<rect x="${bx}" y="${y - 15}" width="${bw}" height="16" rx="3" fill="rgba(255,255,255,0.07)"/>`);
        out.push(`<rect x="${bx}" y="${y - 15}" width="${f1(Math.max(4, (bw * d.week) / max))}" height="16" rx="3" fill="${ACCENT}" fill-opacity="${i === 0 ? 0.95 : 0.6}"/>`);
        out.push(`<text x="${W - 52}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="19" font-weight="700" fill="#f2fbff">${group(d.week)}</text>`);
      });
      out.push('</g>');
    } else if (fs.card) {
      const d = model.directions.find((x) => x.id === fs.card);
      if (d) {
        const sk = directionSk(d.id);
        const tr = trendLabel(d);
        out.push(`<g opacity="${f1(fs.cardAlpha)}">`);
        out.push(`<text x="52" y="${y0 + 50}" font-size="36" font-weight="700" fill="#ffffff">${esc(sk.title)}</text>`);
        out.push(`<text x="${W - 52}" y="${y0 + 44}" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" letter-spacing="2" fill="${ACCENT}">7 DNÍ</text>`);
        out.push(`<text x="52" y="${y0 + 122}" font-family="${MONO}" font-size="60" font-weight="700" fill="#f2fbff">${group(d.week)}</text>`);
        const nx = 52 + String(group(d.week)).length * 37 + 16;
        out.push(`<text x="${nx}" y="${y0 + 100}" font-size="23" font-weight="600" fill="#f2fbff">ruských útokov za týždeň</text>`);
        out.push(`<text x="${nx}" y="${y0 + 128}" font-size="18" fill="${tr.color}">${tr.arrow ? `${tr.arrow} ` : ''}${esc(tr.text)}</text>`);
        // Zmena územia v smere (od 1 km², inak „línia bez zmeny").
        const weekly = Boolean(model.change?.weekly);
        const ru = weekly ? (d.ruKm2 ?? 0) : 0; const ua = weekly ? (d.uaKm2 ?? 0) : 0;
        const tx = W - 52;
        if (ru >= 1 || ua >= 1) {
          const ruMain = ru >= ua;
          out.push(`<text x="${tx}" y="${y0 + 108}" text-anchor="end" font-family="${MONO}" font-size="42" font-weight="700" fill="${ruMain ? FRONT_COLORS.gained : FRONT_COLORS.lost}">${ruMain ? 'RU' : 'UA'} +${group(ruMain ? ru : ua)}${NBSP}km²</text>`);
          out.push(`<text x="${tx}" y="${y0 + 134}" text-anchor="end" font-size="17" fill="${DIM}">${ruMain ? 'ruská okupácia sa rozšírila' : 'Ukrajina oslobodila'}</text>`);
        } else if (weekly) {
          out.push(`<text x="${tx}" y="${y0 + 108}" text-anchor="end" font-size="24" font-weight="600" fill="${DIM}">línia bez zmeny</text>`);
        }
        // 14 dní po dňoch: minulý týždeň tlmene, tento jasne; deň bez údaja = bodka.
        const c = { x: 52, y: y0 + 160, w: W - 104, h: 96 };
        const vals = d.series.map((p) => p.value);
        const max = Math.max(1, ...vals.filter(Number.isFinite));
        const step = c.w / Math.max(1, vals.length);
        vals.forEach((v, i) => {
          const x = c.x + i * step + 3;
          const bw = step - 6;
          if (!Number.isFinite(v)) { out.push(`<circle cx="${f1(x + bw / 2)}" cy="${c.y + c.h - 4}" r="3" fill="rgba(255,255,255,0.3)"/>`); return; }
          const h = Math.max(3, (c.h * v) / max);
          out.push(`<rect x="${f1(x)}" y="${f1(c.y + c.h - h)}" width="${f1(bw)}" height="${f1(h)}" rx="3" fill="${i >= vals.length - 7 ? ACCENT : 'rgba(255,255,255,0.28)'}"/>`);
        });
        out.push(`<line x1="${f1(c.x + (vals.length - 7) * step)}" y1="${c.y - 4}" x2="${f1(c.x + (vals.length - 7) * step)}" y2="${c.y + c.h + 4}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="4 4"/>`);
        out.push(`<text x="${c.x}" y="${c.y + c.h + 20}" font-family="${MONO}" font-size="13" fill="${DIM}">${esc(dayShort(model.prev.from))}</text>`);
        out.push(`<text x="${f1(c.x + (vals.length - 7) * step + 6)}" y="${c.y + c.h + 20}" font-family="${MONO}" font-size="13" fill="${DIM}">${esc(dayShort(model.week.from))}</text>`);
        out.push(`<text x="${c.x + c.w}" y="${c.y + c.h + 20}" text-anchor="end" font-family="${MONO}" font-size="13" fill="${DIM}">${esc(dayShort(model.week.to))} · útoky po dňoch</text>`);
        out.push('</g>');
      }
    }
    // Legenda farieb mapy (spoločná).
    const ly = y0 + cardH - 16;
    const items = [
      { sw: `<rect x="0" y="-12" width="18" height="14" rx="2" fill="${FRONT_COLORS.occupied}" stroke="#3d0a0e"/>`, text: 'okupované' },
      { sw: '<rect x="0" y="-12" width="18" height="14" rx="2" fill="url(#hatch)"/>', text: 'sivá zóna' },
      { sw: `<rect x="0" y="-12" width="18" height="14" rx="2" fill="${FRONT_COLORS.gained}"/>`, text: 'obsadené za týždeň' },
      { sw: `<rect x="0" y="-12" width="18" height="14" rx="2" fill="${FRONT_COLORS.lost}"/>`, text: 'oslobodené za týždeň' },
      { sw: `<path d="M10 -14 L3 -4 L8 -4 L5 4 L15 -7 L9 -7 Z" fill="${FRONT_COLORS.bolt}"/>`, text: 'ruský útok (hlásenie)' },
    ];
    let lx = 52;
    for (const it of items) {
      out.push(`<g transform="translate(${f1(lx)} ${ly})">${it.sw}<text x="25" y="0" font-size="15" fill="rgba(232,234,237,0.85)">${esc(it.text)}</text></g>`);
      lx += 25 + it.text.length * 7.9 + 22;
    }
    out.push('</g>');
  }

  // ── koncová karta ──
  if (layers.endCard > 0) {
    out.push(`<g opacity="${f1(layers.endCard)}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.55"/><rect width="${W}" height="${H * 0.82}" fill="url(#card)"/>`);
    out.push(logo(W / 2 - 90, 120, 180));
    out.push(wordmark(W / 2 + 9, 430, 124, 'middle'));
    out.push(`<text x="${W / 2}" y="500" text-anchor="middle" font-size="36" font-weight="600" fill="#f2fbff" ${shadow}>${esc(VIDEO_BRAND.claim)}</text>`);
    out.push(`<text x="${W / 2}" y="548" text-anchor="middle" font-family="${MONO}" font-size="18" letter-spacing="6" fill="rgba(232,234,237,0.8)" ${shadow}>${VIDEO_BRAND.tagline}</text>`);
    out.push(liveDomain(W / 2, 668, 52));
    out.push(creditLine(W / 2, 748, 20, 'middle'));
    out.push('</g>');
  }

  // Zdroje na každej snímke (video sa šíri aj bez textu príspevku): hlásenia GŠ vydáva ArmyInform, ktorý pri
  // prevzatí žiada uviesť zdroj; mapa frontu a výpočet zmeny z dvoch jej snímok nesú meno portálu.
  out.push(`<text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-size="14" fill="rgba(223,243,251,0.82)" ${shadow}>${esc(FRONT_WEEK_SOURCES)}</text>`);
  out.push('</svg>');
  return out.join('');
}
