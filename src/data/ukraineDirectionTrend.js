// src/data/ukraineDirectionTrend.js — karta smeru frontu (modul UKRAJINA, B5,
// 2026-09-23): trend útokov a najčastejšie sídla z archívu hlásení GŠ ZSU.
//
// Vstup je odpoveď `/api/ukraine/events/directions` (`days: {deň: {total,
// reportedAt, directions: [{gs, attacks, text, shared}]}}`). Deň bez hlásenia
// v nej CHÝBA — tu ostáva dierou (`missing`), nikdy nie nulou: nula by tvrdila
// „ticho", chýbajúce hlásenie netvrdí nič. Počty sú tvrdenia jednej strany
// (GŠ ZSU), nie overené údaje; karta to musí povedať nahlas.
//
// Pure: bez DOM, bez Cesia, bez siete; smer a sídla sa skladajú tými istými
// funkciami ako značky na mape (reportByScene, directionPlaces).

import { dayKey, dayToMs } from './ukraineEvents.js';
import { reportByScene } from './ukraineReport.js';
import { directionPlaces, placeKey } from './ukraineReportPlaces.js';

const DAY = 86_400_000;

/** Koľko dní ukazuje stĺpcový graf karty. */
export const TREND_DAYS = 30;
/** Posledných N dní sa porovnáva so zvyškom okna. */
export const TREND_RECENT_DAYS = 7;
/** Okno pre „najčastejšie sídla". */
export const PLACES_DAYS = 14;
/** Pod týmto rozdielom priemerov (útoky/deň) je trend „drží sa", nech je pomer akýkoľvek. */
export const TREND_MIN_DIFF = 1.5;
/** Relatívna zmena, od ktorej je trend „rastie"/„klesá". */
export const TREND_MIN_REL = 0.2;

/**
 * Rozsah dní [from, to] končiaci dňom `refDay` (vrátane). Pure.
 * @returns {{from: string, to: string}|null}
 */
export function trendRange(refDay, days = TREND_DAYS) {
  const end = dayToMs(refDay);
  if (end === null || !(days > 0)) return null;
  return { from: dayKey(end - (days - 1) * DAY), to: dayKey(end) };
}

/**
 * Popoludňajšie priebežné hlásenie („станом на 16:00") nesie počty za pol dňa —
 * v archíve je tak 7 dní medzi 25. 7. a 3. 8. 2026. V grafe sa ukáže, ale do priemerov nejde.
 * Značka bez hodiny (dátum vydania pri posune) sa berie ako ranné hlásenie. Pure.
 */
export const PARTIAL_REPORT_HOUR = 12;
export function isPartialReport(rep) {
  const m = /^(\d{1,2}):\d{2}\s/.exec(String(rep?.reportedAtText || ''));
  return Boolean(m) && Number(m[1]) >= PARTIAL_REPORT_HOUR;
}

/** Deň hlásenia pre kartu: čas „станом на" (UTC deň), inak dnešok. Pure. */
export function reportRefDay(report, nowMs = Date.now()) {
  const t = Date.parse(report?.reportedAt || '');
  return dayKey(Number.isFinite(t) ? t : nowMs);
}

/**
 * Rad hodnôt pre smer po dňoch rozsahu. Prehľad celého frontu (`overview`)
 * berie celkový počet bojových stretov (`total`), smer súčet svojich GŠ smerov.
 * @param {Record<string, any>} days
 * @param {{id: string, overview?: boolean}} scene
 * @param {(gs: string) => ({id: string}|null)} sceneFor
 * @param {{from: string, to: string}} range
 * @returns {Array<{day: string, attacks: number|null, missing: boolean, unknown: boolean, unmentioned: boolean, partial: boolean}>}
 */
export function directionSeries(days, scene, sceneFor, range) {
  const start = dayToMs(range?.from); const end = dayToMs(range?.to);
  if (start === null || end === null || end < start || !scene?.id) return [];
  const out = [];
  for (let t = start; t <= end; t += DAY) {
    const day = dayKey(t);
    const rep = days?.[day];
    if (!rep) { out.push({ day, attacks: null, missing: true, unknown: false, unmentioned: false, partial: false }); continue; }
    const partial = isPartialReport(rep);
    if (scene.overview) {
      const total = Number.isFinite(rep.total) ? rep.total : null;
      out.push({ day, attacks: total, missing: false, unknown: total === null, unmentioned: false, partial });
      continue;
    }
    const entry = reportByScene(rep, sceneFor).get(scene.id);
    // Hlásenie je, ale smer v ňom nie je: GŠ ho v ten deň nespomenul. To NIE JE
    // nula — Severoslobožanský smer chýba v 52 z 57 archivovaných dní a parser
    // môže odsek prehliadnuť; nula by tvrdila ticho, ktoré nikto nehlásil.
    if (!entry) { out.push({ day, attacks: null, missing: false, unknown: false, unmentioned: true, partial }); continue; }
    out.push({ day, attacks: entry.attacks, missing: false, unknown: entry.unknown && entry.attacks === null, unmentioned: false, partial });
  }
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Čísla karty: dnešok (posledný deň radu), priemer posledných 7 dní vs. zvyšku
 * okna, maximum a smer trendu. Trend len pri dosť dňoch s údajom (≥ 4 z posledných
 * 7 a ≥ 7 v zvyšku) — inak null a karta trend nekreslí. Pure.
 */
export function trendStats(series, { recentDays = TREND_RECENT_DAYS } = {}) {
  const rows = Array.isArray(series) ? series : [];
  // Čiastkové (popoludňajšie) hlásenie by priemer stiahlo dole — do čísel nejde.
  const known = (xs) => xs.filter((p) => Number.isFinite(p?.attacks) && !p.partial).map((p) => p.attacks);
  const last = rows.at(-1) || null;
  const recent = known(rows.slice(-recentDays));
  const earlier = known(rows.slice(0, Math.max(0, rows.length - recentDays)));
  const all = known(rows);
  const avgRecent = mean(recent);
  const avgEarlier = mean(earlier);
  let trend = null;
  if (recent.length >= 4 && earlier.length >= 7) {
    const diff = avgRecent - avgEarlier;
    const rel = avgEarlier > 0 ? Math.abs(diff) / avgEarlier : (avgRecent > 0 ? Infinity : 0);
    trend = Math.abs(diff) < TREND_MIN_DIFF || rel < TREND_MIN_REL ? 'flat' : (diff > 0 ? 'up' : 'down');
  }
  return {
    refDay: last?.day || null,
    today: last && Number.isFinite(last.attacks) ? last.attacks : null,
    todayPartial: Boolean(last?.partial),
    todayMissing: Boolean(last?.missing),
    todayUnmentioned: Boolean(last?.unmentioned),
    avgRecent,
    avgEarlier,
    max: all.length ? Math.max(...all) : null,
    trend,
    daysWithData: all.length,
    days: rows.length,
  };
}

/**
 * Najčastejšie sídla smeru za posledných `span` dní rozsahu: v koľkých dňoch
 * ich hlásenie spomenulo (nie koľkokrát — jeden odsek vymenúva sídlo raz za deň).
 * Kľúč = meno + poloha (66 Novoseliviek je 66 sídiel). Pure.
 * @returns {Array<{name: string, en: string|null, cls: string|null, lat: number, lon: number, days: number, mentions: number, lastDay: string}>}
 */
export function directionTopPlaces(days, scene, sceneFor, index, range, { span = PLACES_DAYS, limit = 6 } = {}) {
  if (!scene?.id || scene.overview || !(index instanceof Map) || !index.size) return [];
  const end = dayToMs(range?.to);
  if (end === null) return [];
  const byKey = new Map();
  for (let i = span - 1; i >= 0; i -= 1) {
    const day = dayKey(end - i * DAY);
    const rep = days?.[day];
    if (!rep) continue;
    const entry = reportByScene(rep, sceneFor).get(scene.id);
    if (!entry?.texts?.length) continue;
    for (const p of directionPlaces(entry.texts, index, scene.center || null).places) {
      const key = `${placeKey(p.name)}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      const rec = byKey.get(key) || { name: p.name, en: p.en || null, cls: p.cls || null, lat: p.lat, lon: p.lon, days: 0, mentions: 0, lastDay: day };
      rec.days += 1;
      rec.mentions += p.mentions;
      rec.lastDay = day;
      byKey.set(key, rec);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.days - a.days) || (b.lastDay < a.lastDay ? -1 : b.lastDay > a.lastDay ? 1 : 0) || (b.mentions - a.mentions) || a.name.localeCompare(b.name, 'uk'))
    .slice(0, limit);
}
