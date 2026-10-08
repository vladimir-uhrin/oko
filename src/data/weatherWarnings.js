// src/data/weatherWarnings.js
// Výstrahy SHMÚ po okresoch (2026-10-08, sekcia POČASIE, „ako Windy"). Čisté pomôcky bez DOM a Cesia:
// normalizácia JSON MeteoAlarmu (feeds-slovakia — SHMÚ ho plní tými istými CAP výstrahami, ktoré
// vydáva na shmu.sk; vlastný adresár CAP na opendata.shmu.sk sa od 9. 9. 2026 neplní), stupne
// a farby, najhorší stupeň okresu, časy v miestnom čase.
//
// MeteoAlarm awareness_level: 2 = žltá (SHMÚ 1. stupeň), 3 = oranžová (2. stupeň), 4 = červená
// (3. stupeň); 1 = zelená = bez výstrahy (vynechá sa).

import { districtCodesForArea } from './skDistricts.js';

export const WARNINGS_URL = '/api/weather-warnings';
export const METEOALARM_SK_URL = 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-slovakia';
export const WARNING_LEVELS = Object.freeze({
  2: Object.freeze({ degree: 1, color: '#ffd200', key: 'yellow' }),
  3: Object.freeze({ degree: 2, color: '#ff8a00', key: 'orange' }),
  4: Object.freeze({ degree: 3, color: '#e8212b', key: 'red' }),
});
/** MeteoAlarm awareness_type → kľúč textu (i18n `warn.type.<key>`). */
export const WARNING_TYPES = Object.freeze({
  1: 'wind', 2: 'snow', 3: 'thunder', 4: 'fog', 5: 'heat', 6: 'cold', 7: 'coastal', 8: 'fire',
  9: 'avalanche', 10: 'rain', 12: 'flood', 13: 'rainflood',
});

/** „2; yellow; Moderate" → 2; nečíselné → 0. Pure. */
export function awarenessNumber(value) {
  const n = Number.parseInt(String(value || '').split(';')[0], 10);
  return Number.isFinite(n) ? n : 0;
}

const param = (info, name) => (Array.isArray(info?.parameter) ? info.parameter.find((p) => p?.valueName === name)?.value : undefined);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const iso = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/**
 * JSON MeteoAlarmu → zoznam výstrah s kódmi okresov. Vynechá zelené, bez okresu a tie, čo už
 * skončili (`expires` ≤ nowMs). Slovenský text z info `sk`, anglický do *En polí. Pure.
 */
export function normalizeMeteoalarm(json, nowMs = Date.now()) {
  const out = [];
  for (const w of Array.isArray(json?.warnings) ? json.warnings : []) {
    const alert = w?.alert;
    const infos = Array.isArray(alert?.info) ? alert.info : [];
    const sk = infos.find((i) => String(i?.language || '').toLowerCase().startsWith('sk')) || infos[0];
    if (!sk) continue;
    const en = infos.find((i) => String(i?.language || '').toLowerCase().startsWith('en')) || null;
    const level = awarenessNumber(param(sk, 'awareness_level'));
    if (!WARNING_LEVELS[level]) continue;
    const expires = iso(sk.expires);
    if (expires && Date.parse(expires) <= nowMs) continue;
    const codes = new Set();
    const areas = [];
    for (const a of Array.isArray(sk.area) ? sk.area : []) {
      const emma = (Array.isArray(a?.geocode) ? a.geocode : []).find((g) => g?.valueName === 'EMMA_ID')?.value;
      for (const c of districtCodesForArea(emma, a?.areaDesc)) codes.add(c);
      if (a?.areaDesc) areas.push(String(a.areaDesc));
    }
    if (!codes.size) continue;
    const typeNo = awarenessNumber(param(sk, 'awareness_type'));
    out.push({
      id: String(alert.identifier || w.uuid || out.length),
      level,
      type: WARNING_TYPES[typeNo] || 'other',
      event: text(sk.event),
      headline: text(sk.headline),
      description: text(sk.description),
      instruction: text(sk.instruction),
      eventEn: text(en?.event),
      headlineEn: text(en?.headline),
      descriptionEn: text(en?.description),
      instructionEn: text(en?.instruction),
      onset: iso(sk.onset) || iso(sk.effective),
      expires,
      sent: iso(alert.sent) || iso(sk.effective),
      web: text(sk.web),
      areas,
      codes: [...codes].sort(),
    });
  }
  return out.sort((a, b) => b.level - a.level || String(a.onset).localeCompare(String(b.onset)));
}

/** Platí výstraha v čase `nowMs` (začala a neskončila)? Pure. */
export function isActiveAt(warning, nowMs = Date.now()) {
  const on = Date.parse(warning?.onset || '');
  const off = Date.parse(warning?.expires || '');
  return (!Number.isFinite(on) || on <= nowMs) && (!Number.isFinite(off) || nowMs < off);
}

/**
 * Okres → { level, active, warnings[] }: najvyšší stupeň zo všetkých výstrah okresu; `active` = aspoň
 * jedna výstraha toho najvyššieho stupňa už platí (inak je len ohlásená dopredu). Pure.
 */
export function districtStates(warnings, nowMs = Date.now()) {
  const map = new Map();
  for (const w of Array.isArray(warnings) ? warnings : []) {
    for (const code of w.codes || []) {
      if (!map.has(code)) map.set(code, { level: 0, active: false, warnings: [] });
      const s = map.get(code);
      s.warnings.push(w);
      const act = isActiveAt(w, nowMs);
      if (w.level > s.level) { s.level = w.level; s.active = act; } else if (w.level === s.level && act) s.active = true;
    }
  }
  return map;
}

const DAY_SK = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Čas výstrahy v slovenskom čase („št 23:00"). Pure (Intl). */
export function warningTimeLabel(isoText, lang = 'sk') {
  const t = Date.parse(isoText || '');
  if (!Number.isFinite(t)) return '—';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava', weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const day = (lang === 'en' ? DAY_EN : DAY_SK)[wd] ?? parts.weekday;
  const d = Number(parts.day);
  const m = Number(parts.month);
  return lang === 'en' ? `${day} ${d}/${m} ${parts.hour}:${parts.minute}` : `${day} ${d}. ${m}. ${parts.hour}:${parts.minute}`;
}
