// src/data/frontDayMotion.js — grafika denného videa v2 (2026-10-10, vlastník: „videá, ktoré generuje systém, sú
// slabučké"). Verzia 1 bola prezentácia: 8 s statická karta, tabuľky textu nad mapou, malé titulky v rámčeku, päta
// so zdrojmi na každej snímke. v2 = grafika ako samostatná priehľadná vrstva nad čistým obrazom (mapa bez kariet,
// akčný záber na celú obrazovku):
//   háčik      2–3 obrovské riadky, nábeh po riadkoch od prvej snímky (nie karta)
//   číslo      jedno veľké číslo na záber (strety, útoky smeru, km², oblasti, obete) s nábehom a dopočítaním
//   titulky    po 1–3 slovách, veľké, v strede dole, čísla zvýraznené (pozeranie bez zvuku)
//   strih      krátky záblesk; zvukové efekty k nim dá linka (motionEvents)
//   záver      krátka koncová karta s okolive.sk a zdrojmi (zdroje už nie na každej snímke)
// Bezpečná zóna Reels: obsah medzi y 230 a 1580, vpravo dole tlačidlá aplikácie. Pure.

import { VIDEO_BRAND, VIDEO_SVG } from './eventVideoHud.js';
import { MAP_SOURCE, directionSk } from './frontWeekNarration.js';
import { FRONT_DAY_FORMAT } from './frontDayVideo.js';

const { MONO, SANS, ACCENT, esc, f1, wordmark, logoAt, creditLine } = VIDEO_SVG;
const NBSP = ' ';
const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;

export const MOTION = Object.freeze({
  brandY: 236,
  statTop: 330,
  captionY: 1300,
  captionPx: 74,
  creditY: 1558,
  red: '#ff4d5e',
  yellow: '#ffd23f',
  popS: 0.22,
  countS: 0.55,
  flashS: 0.11,
});

/** Čísla sa s jednotkou a nasledujúcim slovom nerozdelia („13 km²", „218 bojových"). Pure. */
const bindNumbers = (s) => String(s).replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`).replace(/(\d+(?:[.,]\d+)?) (km²|km|h|min|ľudí|detí|oblastí|stretov)(?![\p{L}])/gu, `$1${NBSP}$2`);

/**
 * Titulky po skupinách 1–3 slov (najviac `maxChars` znakov), koniec vety skupinu vždy uzavrie. Pure.
 * @returns {string[]}
 */
export function wordGroups(text, { maxWords = 3, maxChars = 18 } = {}) {
  const words = bindNumbers(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur.join(' ')); cur = []; };
  for (const w of words) {
    const next = cur.length ? `${cur.join(' ')} ${w}` : w;
    if (cur.length && (cur.length >= maxWords || next.length > maxChars)) flush();
    cur.push(w);
    if (/[.!?…:]$/.test(w)) flush();
  }
  flush();
  return out;
}

/**
 * Časy skupín slov: reč vety (speechStart–speechEnd) sa rozdelí podľa počtu znakov, koniec vety o chvíľu
 * dlhšie. Vety úvodnej karty a záveru sa netitulkujú (háčik a koncová karta ich nesú veľkým písmom). Pure.
 * @returns {Array<{from: number, to: number, text: string, line: string}>}
 */
export function wordCues(lines, placement, { skipShots = ['opening', 'closing'] } = {}) {
  const byId = Object.fromEntries((placement || []).map((p) => [p.id, p]));
  const cues = [];
  for (const line of lines || []) {
    const p = byId[line.id];
    if (!p || skipShots.includes(line.shot)) continue;
    const groups = wordGroups(line.caption);
    const weight = (g) => g.length + (/[.!?…,:]$/.test(g) ? 4 : 0) + 2;
    const total = groups.reduce((a, g) => a + weight(g), 0);
    const span = Math.max(0.3, p.speechEnd - p.speechStart);
    let t = p.speechStart;
    groups.forEach((g) => {
      const d = (span * weight(g)) / total;
      cues.push({ from: t, to: t + d, text: g, line: line.id });
      t += d;
    });
  }
  return cues.map((c, i) => ({ ...c, to: Math.min(c.to + 0.18, cues[i + 1] && cues[i + 1].line === c.line ? cues[i + 1].from : c.to + 0.35) }));
}

/**
 * Veľké číslo záberu podľa vety, ktorá práve znie (id vety z frontDayNarration). Null = bez čísla. Pure.
 * @returns {{kicker: string, value?: number, prefix?: string, suffix?: string, title?: string, unit?: string, sub?: string[], color?: string}|null}
 */
export function shotStat(model, lineId, shot = {}) {
  const m = model || {};
  if (lineId === 'clashes' && Number.isFinite(m.report?.total)) {
    const avg = m.avg7;
    const cmp = Number.isFinite(avg) && Math.abs(m.report.total - avg) >= Math.max(5, avg * 0.07)
      ? `${m.report.total > avg ? '▲ viac' : '▼ menej'} ako týždenný priemer (${group(avg)})` : null;
    return { kicker: 'CELÝ FRONT · 24 HODÍN', value: m.report.total, unit: 'BOJOVÝCH STRETOV', sub: [cmp, 'Generálny štáb Ukrajiny · údaje jednej strany'].filter(Boolean), color: '#ffffff' };
  }
  if (lineId === 'top') {
    const d = (m.directions || []).find((x) => x.id === shot.sceneId) || (m.directions || [])[0];
    if (!d) return null;
    return { kicker: directionSk(d.id).title.toUpperCase(), value: d.attacks, unit: plural(d.attacks, 'RUSKÝ ÚTOK', 'RUSKÉ ÚTOKY', 'RUSKÝCH ÚTOKOV'), sub: ['za 24 hodín · Generálny štáb Ukrajiny'], color: MOTION.red };
  }
  if (lineId === 'change' && m.change) {
    const ru = (m.change.ruKm2 ?? 0) >= (m.change.uaKm2 ?? 0);
    const km = Math.round(ru ? m.change.ruKm2 : m.change.uaKm2);
    const d = (m.change.directions || []).find((x) => (ru ? x.ruKm2 : x.uaKm2) >= 1);
    return { kicker: d ? directionSk(d.id).title.toUpperCase() : 'MAPA FRONTU', value: km, prefix: '+', suffix: `${NBSP}km²`,
      unit: ru ? 'OBSADIL RUSKÝ AGRESOR' : 'OSLOBODILA UKRAJINA', sub: [`${(m.change.spanDays ?? 1) > 1 ? `za ${m.change.spanDays} dni` : 'za deň'} · mapa ${MAP_SOURCE.site}`], color: ru ? MOTION.red : '#5fb3ff' };
  }
  if (lineId === 'air' && m.air?.count) {
    const kinds = { drones: 'drony', missiles: 'rakety', bombs: 'riadené bomby' };
    return { kicker: 'NOC · VZDUŠNÉ SILY UKRAJINY', value: m.air.count, unit: `${plural(m.air.count, 'OBLASŤ', 'OBLASTI', 'OBLASTÍ')} POD HROZBOU`,
      sub: [(m.air.kinds || []).map((k) => kinds[k]).filter(Boolean).join(' · ') || 'vzdušný útok', 'hlásená hrozba, nie potvrdené zásahy'], color: MOTION.red };
  }
  if (lineId === 'strikes') {
    const labels = { kamikazeDrones: ['DRON-KAMIKADZE', 'DRONY-KAMIKADZE', 'DRONOV-KAMIKADZE'], guidedBombs: ['RIADENÁ BOMBA', 'RIADENÉ BOMBY', 'RIADENÝCH BÔMB'], airStrikes: ['LETECKÝ ÚDER', 'LETECKÉ ÚDERY', 'LETECKÝCH ÚDEROV'], missileStrikes: ['RAKETOVÝ ÚDER', 'RAKETOVÉ ÚDERY', 'RAKETOVÝCH ÚDEROV'] };
    const top = Object.entries(labels).map(([k, f]) => ({ n: m.strikes?.[k], f })).filter((s) => Number.isFinite(s.n) && s.n > 0).sort((a, b) => b.n - a.n);
    if (!top.length) return null;
    return { kicker: 'RUSKÉ ÚDERY · 24 HODÍN', value: top[0].n, unit: plural(top[0].n, ...top[0].f), sub: [top[1] ? `${group(top[1].n)} ${plural(top[1].n, ...top[1].f).toLowerCase()}` : null, 'Generálny štáb Ukrajiny · údaje jednej strany'].filter(Boolean), color: MOTION.red };
  }
  if (lineId === 'strike' && m.casualties?.total?.killed) {
    const k = m.casualties.total.killed;
    const rows = (m.casualties.places || []).slice(0, 2).map((p) => `${p.sk} · ${p.killed ? `${group(p.killed)} ${plural(p.killed, 'mŕtvy', 'mŕtvi', 'mŕtvych')}` : ''}${p.children ? `, ${group(p.children)} ${plural(p.children, 'dieťa', 'deti', 'detí')}` : ''}${p.injured && !p.killed ? `${group(p.injured)} ${plural(p.injured, 'zranený', 'zranení', 'zranených')}` : ''}`);
    return { kicker: 'RUSKÝ ÚTOK · OBETE', value: k, unit: plural(k, 'MŔTVY', 'MŔTVI', 'MŔTVYCH'), sub: ['najmenej · čísla od dvoch médií', ...rows], color: MOTION.red };
  }
  const spot = shot.kind === 'spot' ? m.spots?.[shot.sceneId] : null;
  if (spot) return { kicker: String(spot.tag || '').toUpperCase(), title: spot.title || '', sub: (spot.rows || []).slice(0, 3), color: '#ffffff' };
  return null;
}

/** Zvukové efekty k obrazu: šum pri každom strihu, úder pri háčiku a pri nábehu čísla. Pure. */
export function motionEvents(shots, placement) {
  const out = [{ t: 0.04, kind: 'impact' }];
  (shots || []).forEach((s, i) => {
    if (i > 0) out.push({ t: Math.max(0, s.start - 0.18), kind: 'whoosh' });
    if (s.kind === 'closing') out.push({ t: s.start + 0.05, kind: 'impact' });
  });
  for (const p of placement || []) if (['clashes', 'top', 'change', 'air', 'strikes', 'strike'].includes(p.id)) out.push({ t: p.start + 0.1, kind: 'pop' });
  return out.sort((a, b) => a.t - b.t);
}

const outline = (w = 10) => `paint-order="stroke" stroke="#000" stroke-opacity="0.82" stroke-width="${w}" stroke-linejoin="round"`;
/** Veľkosť písma riadku háčika, aby sa zmestil na šírku (Inter 900 veľkými ≈ 0,64 em na znak). Pure. */
export const hookSize = (text, max = 132) => Math.max(56, Math.min(max, Math.floor(980 / (String(text).length * 0.64))));

/**
 * SVG grafiky v čase `t` (priehľadné, 1080×1920).
 * @param {{t: number, shots: Array, lines: Array, placement: Array, cues: Array, model: object, hook: object|null, logoMarkup?: object|null}} p
 */
export function buildMotionSvg({ t, shots, lines, placement, cues, model, hook, logoMarkup = null }) {
  const { w: W, h: H } = FRONT_DAY_FORMAT;
  const logo = logoAt(logoMarkup);
  let i = (shots || []).findIndex((s) => t < s.start + s.dur);
  if (i < 0) i = shots.length - 1;
  const shot = shots[i];
  const local = t - shot.start;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`];
  out.push('<defs><linearGradient id="mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.78"/><stop offset="0.7" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>'
    + '<linearGradient id="mb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></linearGradient></defs>');

  // ── koncová karta ──
  if (shot.kind === 'closing') {
    const a = easeOut(local / 0.25);
    out.push(`<g opacity="${f1(a)}"><rect width="${W}" height="${H}" fill="#03080e" fill-opacity="0.88"/>`);
    out.push(logo(W / 2 - 75, 470, 150));
    out.push(wordmark(W / 2 + 8, 740, 104, 'middle'));
    out.push(`<text x="${W / 2}" y="850" text-anchor="middle" font-size="44" font-weight="800" fill="#ffffff" letter-spacing="2">${esc(model?.endLine ? model.endLine.toUpperCase() : 'MAPA FRONTU NAŽIVO')}</text>`);
    out.push(`<text x="${W / 2}" y="975" text-anchor="middle" font-family="${MONO}" font-size="96" font-weight="700" fill="${ACCENT}">${esc(VIDEO_BRAND.domain)}</text>`);
    out.push(creditLine(W / 2, 1060, 20, 'middle'));
    const src = model?.sources || [`Strety a údery: Generálny štáb Ukrajiny (údaje jednej strany)`, `Mapa a výpočet zmeny: ${MAP_SOURCE.site} · © OpenStreetMap`, 'Zábery: ArmyInform, Ministerstvo obrany Ukrajiny (CC BY 4.0)'];
    // Hudba s licenciou CC BY musí mať autora aj vo videu (model.musicCredit z knižnice skladieb).
    [...src.slice(0, 3), ...(model?.musicCredit ? [model.musicCredit] : [])].forEach((s, k) => out.push(`<text x="${W / 2}" y="${1380 + k * 34}" text-anchor="middle" font-size="22" fill="rgba(223,243,251,0.8)">${esc(s)}</text>`));
    out.push('</g></svg>');
    return out.join('');
  }

  out.push(`<rect width="${W}" height="820" fill="url(#mt)"/><rect y="${H - 760}" width="${W}" height="760" fill="url(#mb)"/>`);
  // Malá značka vľavo hore (nie lišta).
  out.push(logo(36, MOTION.brandY, 50));
  out.push(wordmark(96, MOTION.brandY + 38, 34));

  if (shot.kind === 'opening' && hook) {
    // ── háčik: riadky naskakujú od prvej snímky ──
    const tag = hook.tag || '';
    const rows = (hook.lines || []).slice(0, 3);
    const accent = new Set(String(hook.accent || '').split(/ +/).filter(Boolean));
    const top = 820 - (rows.length - 1) * 70;
    const ta = easeOut(local / 0.2);
    out.push(`<text x="${W / 2}" y="${top - 70}" text-anchor="middle" font-family="${MONO}" font-size="30" font-weight="700" letter-spacing="6" fill="${ACCENT}" opacity="${f1(ta)}" ${outline(6)}>${esc(tag)}</text>`);
    let y = top;
    rows.forEach((r, k) => {
      const px = hookSize(r);
      const e = easeOut((local - 0.05 - k * 0.16) / MOTION.popS);
      const s = 1 + 0.22 * (1 - e);
      const words = r.split(' ').map((w) => (accent.has(w) ? `<tspan fill="${MOTION.red}">${esc(w)}</tspan>` : esc(w))).join(' ');
      out.push(`<g opacity="${f1(e)}" transform="translate(${W / 2} ${f1(y)}) scale(${s.toFixed(3)}) translate(${-W / 2} ${f1(-y)})"><text x="${W / 2}" y="${f1(y)}" text-anchor="middle" font-size="${px}" font-weight="900" fill="#ffffff" ${outline(14)}>${words}</text></g>`);
      y += px * 1.08;
    });
    if (hook.sub) {
      const e = easeOut((local - 0.15 - rows.length * 0.16) / MOTION.popS);
      out.push(`<text x="${W / 2}" y="${f1(y + 20)}" text-anchor="middle" font-size="40" font-weight="700" fill="#f2fbff" opacity="${f1(e)}" ${outline(8)}>${esc(hook.sub)}</text>`);
    }
  } else if (shot.kind === 'clip') {
    out.push(`<text x="48" y="${MOTION.statTop + 30}" font-family="${MONO}" font-size="26" font-weight="700" letter-spacing="4" fill="${MOTION.yellow}" ${outline(6)}>ZÁBERY · ARMYINFORM</text>`);
    out.push(`<text x="48" y="${MOTION.creditY}" font-size="22" fill="rgba(240,248,255,0.85)" ${outline(5)}>Ministerstvo obrany Ukrajiny · CC BY 4.0</text>`);
  } else {
    // ── veľké číslo záberu ──
    const active = [...(placement || [])].filter((p) => p.shot === shot.id && p.start <= t + 1e-6).pop() || (placement || []).find((p) => p.shot === shot.id);
    const stat = active ? shotStat(model, active.id, shot) : null;
    if (stat) {
      const since = t - Math.max(shot.start, active.start);
      const e = easeOut(since / MOTION.popS);
      const dy = 26 * (1 - e);
      const y0 = MOTION.statTop;
      out.push(`<g opacity="${f1(e)}" transform="translate(0 ${f1(dy)})">`);
      out.push(`<text x="48" y="${y0 + 30}" font-family="${MONO}" font-size="28" font-weight="700" letter-spacing="4" fill="${ACCENT}" ${outline(6)}>${esc(stat.kicker)}</text>`);
      let y = y0 + 40;
      if (Number.isFinite(stat.value)) {
        const v = Math.round(stat.value * easeOut(since / MOTION.countS));
        y += 190;
        out.push(`<text x="40" y="${y}" font-size="200" font-weight="900" fill="${stat.color || '#ffffff'}" ${outline(16)}>${esc(`${stat.prefix || ''}${group(v)}${stat.suffix || ''}`)}</text>`);
      } else if (stat.title) {
        y += 96;
        out.push(`<text x="48" y="${y}" font-size="${stat.title.length > 22 ? 64 : 82}" font-weight="900" fill="#ffffff" ${outline(12)}>${esc(stat.title)}</text>`);
      }
      if (stat.unit) { y += 70; out.push(`<text x="48" y="${y}" font-size="56" font-weight="900" fill="#ffffff" ${outline(10)}>${esc(stat.unit)}</text>`); }
      (stat.sub || []).forEach((s, k) => { y += k ? 40 : 54; out.push(`<text x="48" y="${y}" font-size="${k ? 28 : 32}" font-weight="${k ? 500 : 700}" fill="${k ? 'rgba(232,240,246,0.9)' : '#f2fbff'}" ${outline(6)}>${esc(s)}</text>`); });
      out.push('</g>');
    }
  }

  // ── titulky po slovách ──
  const cue = (cues || []).find((c) => t >= c.from && t < c.to);
  if (cue && shot.kind !== 'opening') {
    const e = easeOut((t - cue.from) / 0.1);
    const s = 1 + 0.1 * (1 - e);
    const y = MOTION.captionY;
    const words = cue.text.split(' ').map((w) => (/\d/.test(w) ? `<tspan fill="${MOTION.yellow}">${esc(w)}</tspan>` : esc(w))).join(' ');
    out.push(`<g transform="translate(${W / 2} ${y}) scale(${s.toFixed(3)}) translate(${-W / 2} ${-y})"><text x="${W / 2}" y="${y}" text-anchor="middle" font-size="${MOTION.captionPx}" font-weight="900" fill="#ffffff" ${outline(14)}>${words}</text></g>`);
  }

  // ── záblesk pri strihu ──
  if (i > 0 && local < MOTION.flashS) out.push(`<rect width="${W}" height="${H}" fill="#ffffff" opacity="${f1(0.26 * (1 - local / MOTION.flashS))}"/>`);
  out.push('</svg>');
  return out.join('');
}
