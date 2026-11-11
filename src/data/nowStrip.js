// src/data/nowStrip.js — výber udalostí pre pás „Čo sa deje teraz" (2026-11-11, audit UI — krok 3).
//
// Prečo: návštevnosť k 2026-11-11 — 232 zo 414 ľudí odišlo do 30 s a iný deň sa vrátilo len 24. Stránka
// nehovorila, čo sa práve deje; pás dáva 3–5 aktuálnych udalostí so zdrojom a jedným ťuknutím na ne doletí.
//
// Tento modul je ČISTÝ (žiadny DOM, Cesium ani fetch): z odpovedí troch koncových bodov, ktoré server už
// cachuje, vyberie položky a zloží ich text. Verzia 1 má zámerne len tri druhy s vysokou spoľahlivosťou:
//   • quake     — /api/earthquakes/usgs: silné zemetrasenie vo svete za posledných 24 h,
//   • warning   — /api/weather-warnings: výstraha SHMÚ (jedna najzávažnejšia skupina),
//   • ukraine   — /api/ukraine/report: denné hlásenie Generálneho štábu Ukrajiny.
// Text tvrdí len to, čo zdroj: hlásenie GŠ je vždy označené ako oficiálne jednostranné hlásenie, príznak
// tsunami sa nikdy nepíše ako varovanie, čas výstrahy je „od najskoršieho začiatku", nie spoločný koniec.
// Odložené na verziu 2: otras pri Slovensku (EMSC), incidenty UKMTO, bodka „nové", smer frontu v titulku.

import { WARNING_LEVELS, isActiveAt, warningTimeLabel } from './weatherWarnings.js';

export const NOW_MAX_ITEMS = 5;
export const NOW_MAX_PER_KIND = 2;
const HOUR_MS = 3_600_000;
/** Okno otrasov: posledných 24 h (zhodné s predvoleným obdobím vrstvy Zemetrasenia). */
export const NOW_QUAKE_WINDOW_MS = 24 * HOUR_MS;
/** Hlásenie GŠ vychádza raz denne ráno; staršie než 30 h už nie je „teraz". */
export const NOW_REPORT_WINDOW_MS = 30 * HOUR_MS;
/** Výstraha ohlásená vopred sa ukáže, keď začne do 24 h. */
export const NOW_WARNING_AHEAD_MS = 24 * HOUR_MS;
/** 1. stupeň (žltá) je bežný — do pásu len keď platí aspoň v toľkých okresoch. */
export const NOW_WARNING_YELLOW_MIN_DISTRICTS = 20;
/** Po koľkých minútach bez obnovy je odpoveď zdroja zastaraná. */
export const NOW_STALE_AFTER_MIN = Object.freeze({ quake: 15, warning: 30, ukraine: 26 * 60 });

const PAGER_RANK = Object.freeze({ red: 3, orange: 2, yellow: 1 });
/**
 * Sila otrasu pre poradie: vyššie z úrovne PAGER a pásma magnitúdy. Čerstvý veľký otras ešte PAGER nemá —
 * bez tohto by M7,8 bez hodnotenia vypadol za dva otrasy M5 so žltou úrovňou.
 */
const quakeRank = (r) => Math.max(PAGER_RANK[r.alert] || 0, r.mag >= 7 ? 3 : r.mag >= 6.5 ? 2 : r.mag >= 6 ? 1 : 0);

/**
 * Stav odpovede zdroja. `fetchedAt` je epocha v ms (otrasy, hlásenie GŠ) alebo text ISO (výstrahy).
 * @returns {'live'|'stale'}
 */
export function feedState(fetchedAt, nowMs, staleAfterMin, staleFlag = false) {
  if (staleFlag === true) return 'stale';
  const at = typeof fetchedAt === 'number' ? fetchedAt : Date.parse(String(fetchedAt ?? ''));
  if (!Number.isFinite(at)) return 'stale';
  return nowMs - at > staleAfterMin * 60_000 ? 'stale' : 'live';
}

/**
 * Silné otrasy za 24 h. Úroveň A: M ≥ 6 alebo PAGER žltá/oranžová/červená (najviac 2). Ak nič, úroveň B:
 * jeden najsilnejší s M ≥ 5 (pri zhode magnitúdy najnovší). Holý príznak tsunami pri slabom otrase úroveň A
 * nezakladá (naživo 2026-11-11: M4,7 s príznakom by predbehol päť otrasov M5,1).
 */
export function pickQuakes(payload, nowMs) {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const state = feedState(payload?.fetchedAt, nowMs, NOW_STALE_AFTER_MIN.quake, payload?.stale);
  const recent = records.filter((r) => r && Number.isFinite(r.mag) && Number.isFinite(r.lat) && Number.isFinite(r.lon)
    && Number.isFinite(r.time) && nowMs - r.time >= 0 && nowMs - r.time <= NOW_QUAKE_WINDOW_MS)
    // Zaokrúhlené raz: výber, poradie aj titulok vidia to isté číslo (5,95 sa píše „M6,0" a aj sa tak triedi).
    .map((r) => ({ ...r, mag: Math.round(r.mag * 10) / 10 }));
  const byStrength = (a, b) => quakeRank(b) - quakeRank(a) || b.mag - a.mag || b.time - a.time;
  const tierA = recent.filter((r) => r.mag >= 6 || PAGER_RANK[r.alert]).sort(byStrength).slice(0, NOW_MAX_PER_KIND);
  const chosen = tierA.length ? tierA : recent.filter((r) => r.mag >= 5).sort(byStrength).slice(0, 1);
  return chosen.map((r) => ({
    id: `quake:${r.id || r.sourceId}`,
    kind: 'quake',
    // Otras s PAGER alebo M ≥ 6 patrí navrch (89 / 93 / 97, pod výstrahou 3. stupňa = 100); bežný M5 pod výstrahu aj hlásenie.
    priority: quakeRank(r) ? 85 + quakeRank(r) * 4 : 40,
    timeMs: r.time,
    state,
    mag: r.mag,
    place: typeof r.place === 'string' && r.place.trim() ? r.place.trim() : null,
    lat: r.lat,
    lon: r.lon,
    alert: PAGER_RANK[r.alert] ? r.alert : null,
    tsunami: r.tsunami === true,
    reviewed: r.status === 'reviewed',
    sourceLabel: 'USGS',
    sourceUrl: typeof r.url === 'string' && /^https:\/\//.test(r.url) ? r.url : null,
    focus: { type: 'quake', id: r.id || `USGS:${r.sourceId}`, lat: r.lat, lon: r.lon, mag: r.mag },
  }));
}

/**
 * Jedna najzávažnejšia skupina výstrah (stupeň + druh javu). Počet okresov = zjednotenie kódov okresov
 * (jeden záznam môže mať viac kódov). 3. stupeň vždy; 2. stupeň keď platí alebo začne do 24 h; 1. stupeň
 * len keď platí aspoň v NOW_WARNING_YELLOW_MIN_DISTRICTS okresoch.
 */
export function pickWarning(payload, nowMs) {
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
  const state = feedState(payload?.fetchedAt, nowMs, NOW_STALE_AFTER_MIN.warning, payload?.stale);
  const groups = new Map();
  for (const w of warnings) {
    if (!w || !WARNING_LEVELS[w.level] || typeof w.type !== 'string') continue;
    const off = Date.parse(w.expires || '');
    if (Number.isFinite(off) && off <= nowMs) continue; // už skončila
    const key = `${w.level}|${w.type}`;
    let g = groups.get(key);
    if (!g) { g = { level: w.level, type: w.type, all: new Set(), activeCodes: new Set(), onset: Infinity, web: null }; groups.set(key, g); }
    const codes = Array.isArray(w.codes) && w.codes.length ? w.codes : [w.id];
    const active = isActiveAt(w, nowMs);
    for (const code of codes) { g.all.add(String(code)); if (active) g.activeCodes.add(String(code)); }
    const on = Date.parse(w.onset || '');
    if (!active && Number.isFinite(on)) g.onset = Math.min(g.onset, on);
    if (!g.web && typeof w.web === 'string' && /^https?:\/\//.test(w.web)) g.web = w.web;
  }
  const eligible = [...groups.values()].filter((g) => {
    const active = g.activeCodes.size > 0;
    if (g.level === 4) return true;
    if (g.level === 3) return active || g.onset - nowMs <= NOW_WARNING_AHEAD_MS;
    return active && g.activeCodes.size >= NOW_WARNING_YELLOW_MIN_DISTRICTS;
  });
  eligible.sort((a, b) => b.level - a.level
    || Number(b.activeCodes.size > 0) - Number(a.activeCodes.size > 0)
    || b.all.size - a.all.size
    || a.onset - b.onset);
  const g = eligible[0];
  if (!g) return [];
  const active = g.activeCodes.size > 0;
  return [{
    id: `warning:${g.level}:${g.type}`,
    kind: 'warning',
    priority: g.level === 4 ? 100 : g.level === 3 ? 80 : 50,
    timeMs: active ? nowMs : g.onset,
    state: state === 'stale' ? 'stale' : active ? 'live' : 'announced',
    degree: WARNING_LEVELS[g.level].degree,
    type: g.type,
    // Platí → počet okresov, kde platí práve teraz; ohlásená → všetky okresy skupiny.
    districts: active ? g.activeCodes.size : g.all.size,
    active,
    onsetMs: Number.isFinite(g.onset) ? g.onset : null,
    sourceLabel: 'SHMÚ',
    sourceUrl: g.web ? g.web.replace(/^http:\/\//, 'https://') : null,
    focus: { type: 'warnings' },
  }];
}

/** Je to ranné denné hlásenie? Pečiatka 08:00; bez pečiatky titulok „за добу" alebo vydanie 04–07 UTC. Pure. */
export function isDailyReport(payload) {
  const stamp = String(payload?.sourceStampText || payload?.reportedAtText || '').trim();
  if (stamp) return /^0?8[:.]00/.test(stamp);
  if (/за добу|минулої доби/i.test(String(payload?.title || ''))) return true;
  const hour = Number.isFinite(payload?.publishedAt) ? new Date(payload.publishedAt).getUTCHours() : NaN;
  return hour >= 4 && hour <= 7;
}

/** Denné hlásenie GŠ: počet bojových stretov. Vždy stav „claim" (oficiálne jednostranné hlásenie). */
export function pickUkraineReport(payload, nowMs) {
  if (!payload || payload.ok !== true || !Number.isFinite(payload.total) || payload.total <= 0) return [];
  const reportedAt = Date.parse(payload.reportedAt || '');
  if (!Number.isFinite(reportedAt) || nowMs - reportedAt > NOW_REPORT_WINDOW_MS || nowMs - reportedAt < -HOUR_MS) return [];
  // Titulok hovorí „za deň" — to platí len pre ranné hlásenie (08:00). Server vie vrátiť aj popoludňajšie
  // priebežné (16:00, 22:00), ktoré počíta strety od rána; to sa do pásu nedostane.
  if (!isDailyReport(payload)) return [];
  return [{
    id: `ukraine:${payload.reportedAt}`,
    kind: 'ukraine',
    priority: 60,
    timeMs: reportedAt,
    state: feedState(payload.fetchedAt, nowMs, NOW_STALE_AFTER_MIN.ukraine, payload.stale) === 'stale' ? 'stale' : 'claim',
    total: payload.total,
    sourceLabel: 'ArmyInform',
    sourceUrl: typeof payload.url === 'string' && /^https:\/\//.test(payload.url) ? payload.url : null,
    focus: { type: 'ukraine' },
  }];
}

/**
 * Výsledný zoznam: podľa priority, potom novšie skôr; najviac NOW_MAX_PER_KIND na druh a NOW_MAX_ITEMS spolu.
 * @param {{ quakes?: object, warnings?: object, ukraine?: object }} feeds odpovede koncových bodov (chýbajúca = bez položiek)
 */
export function buildNowItems(feeds, nowMs) {
  const all = [
    ...pickQuakes(feeds?.quakes, nowMs),
    ...pickWarning(feeds?.warnings, nowMs),
    ...pickUkraineReport(feeds?.ukraine, nowMs),
  ];
  all.sort((a, b) => b.priority - a.priority || b.timeMs - a.timeMs);
  const perKind = new Map();
  const out = [];
  for (const item of all) {
    const n = perKind.get(item.kind) || 0;
    if (n >= NOW_MAX_PER_KIND) continue;
    perKind.set(item.kind, n + 1);
    out.push(item);
    if (out.length >= NOW_MAX_ITEMS) break;
  }
  return out;
}

/** „pred 12 min" / „pred 3 h" / „pred 2 d" — kľúč prekladu a číslo. Pure. */
export function agoParts(timeMs, nowMs) {
  const diff = Math.max(0, nowMs - timeMs);
  if (diff < HOUR_MS) return { key: 'now.ago.min', n: Math.max(1, Math.round(diff / 60_000)) };
  if (diff < 48 * HOUR_MS) return { key: 'now.ago.h', n: Math.round(diff / HOUR_MS) };
  return { key: 'now.ago.d', n: Math.round(diff / (24 * HOUR_MS)) };
}

/** Slovenský tvar počtu: 1 okres, 2–4 okresy, 5+ okresov (EN má tie isté tri kľúče). */
export function districtsKey(n) {
  return n === 1 ? 'now.districts.one' : n >= 2 && n <= 4 ? 'now.districts.few' : 'now.districts.many';
}

/**
 * Text položky. Pure — preklad dodá volajúci.
 * @param {object} item položka z buildNowItems
 * @param {(key: string, vars?: object) => string} t
 * @param {{ lang?: string, nowMs: number }} o
 * @returns {{ title: string, meta: string, chips: string[] }}
 */
export function nowItemText(item, t, { lang = 'sk', nowMs }) {
  const chips = [];
  if (item.state === 'stale') chips.push(t('now.chip.stale'));
  const mag = (m) => (lang === 'sk' ? m.toFixed(1).replace('.', ',') : m.toFixed(1));
  if (item.kind === 'quake') {
    const ago = agoParts(item.timeMs, nowMs);
    if (item.alert) chips.push(t('now.chip.pager', { level: t(`now.pager.${item.alert}`) }));
    if (item.tsunami) chips.push(t('quake.tsunami'));
    if (!item.reviewed) chips.push(t('now.chip.automatic'));
    const place = item.place || `${item.lat.toFixed(1)}°, ${item.lon.toFixed(1)}°`;
    return { title: t('now.quake.title', { mag: mag(item.mag), place }), meta: `${item.sourceLabel} · ${t(ago.key, { n: ago.n })}`, chips };
  }
  if (item.kind === 'warning') {
    const count = t(districtsKey(item.districts), { n: item.districts });
    const when = item.active ? t('warn.active') : item.onsetMs ? t('now.warning.from', { when: warningTimeLabel(new Date(item.onsetMs).toISOString(), lang) }) : t('warn.upcoming');
    return { title: t('now.warning.title', { degree: item.degree, type: t(`warn.type.${item.type}`), count }), meta: `${item.sourceLabel} · ${when}`, chips };
  }
  const ago = agoParts(item.timeMs, nowMs);
  chips.push(t('now.chip.claim'));
  return { title: t('now.ukraine.title', { total: item.total }), meta: `${item.sourceLabel} · ${t(ago.key, { n: ago.n })}`, chips };
}
