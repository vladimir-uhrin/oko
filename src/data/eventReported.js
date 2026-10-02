// src/data/eventReported.js — chýbajúce údaje udalosti zo správ (2026-10-01, vlastník: „ešte by si mohol
// vydolovať chýbajúce dáta… a bol by workflow pre video super"). Keď otvorené siete prijímačov (OpenSky,
// adsb.lol) nemajú dieru ani koniec letu (FZ1073: 9 min bez údajov, koniec vo výške 15 025 ft), doplnia sa
// FAKTY, ktoré uvádzajú dôveryhodné médiá — vždy s presným citátom a odkazom, nikdy ako dopočítaná trasa
// („podľa správ" ako bod, nie čiara; zásada z plánu Udalostí 09-30):
//   landing  pristátie na letisku (poloha z OurAirports) v čase zo správy — značka na mieste letiska,
//   descent  pokles výšky v diere podľa údajov, ktoré médiá citujú (napr. Flightradar24) — poznámka k diere.
// Platí len zdroj zo zoznamu dôveryhodných médií (trusted-news.json); dve rôzne médiá = potvrdené, jedno
// = pri texte vždy jeho meno. Pure.

import { trustedDomainOf } from './eventNews.js';

export const REPORTED_KINDS = Object.freeze(['landing', 'descent']);
/** Najviac faktov na udalosť a zdrojov na fakt; dĺžka citátu (presné slová článku, nie prerozprávanie). */
export const REPORTED_LIMITS = Object.freeze({ facts: 8, sources: 4, quoteMin: 10, quoteMax: 600, viaMax: 60 });
/** Fakt musí sedieť k udalosti: od 3 h pred prvým spúšťačom po 12 h po poslednom bode. */
const BEFORE_S = 3 * 3600;
const AFTER_S = 12 * 3600;
/** Pokles zo správ patrí k diere, keď jeho koniec leží v diere alebo do 90 s pred ňou. */
const GAP_SLACK_S = 90;

const pad = (v) => String(v).padStart(2, '0');
const hhmm = (tS) => { const d = new Date(tS * 1000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const group = (n, lang) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');

/** Čas zo vstupu: sekundy UTC alebo ISO reťazec s pásmom → celé sekundy, inak null. Pure. */
function timeOf(v) {
  if (Number.isFinite(v)) return Math.floor(v);
  if (typeof v !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(v.trim())) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
const textOf = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Zdroje faktu: len https odkazy na dôveryhodné médiá s citátom; jedno médium raz. Pure.
 * @returns {{sources: Array<{domain: string, url: string, quote: string, time: boolean}>, error: string|null}}
 */
function sourcesOf(list, trusted) {
  if (!Array.isArray(list) || !list.length) return { sources: [], error: 'no_sources' };
  const out = [];
  for (const s of list.slice(0, REPORTED_LIMITS.sources)) {
    let host;
    try {
      const u = new URL(String(s?.url || ''));
      if (u.protocol !== 'https:') return { sources: [], error: 'bad_source_url' };
      host = u.hostname;
    } catch { return { sources: [], error: 'bad_source_url' }; }
    const domain = trustedDomainOf(host, trusted);
    if (!domain) return { sources: [], error: 'untrusted_source' };
    const quote = textOf(s?.quote, REPORTED_LIMITS.quoteMax + 1);
    if (quote.length < REPORTED_LIMITS.quoteMin || quote.length > REPORTED_LIMITS.quoteMax) return { sources: [], error: 'bad_quote' };
    if (out.some((o) => o.domain === domain)) continue;
    out.push({ domain, url: String(s.url), quote, time: s?.time === true });
  }
  return { sources: out, error: null };
}

/**
 * Overí a doplní fakty zo správ pre udalosť. Letisko pristátia sa hľadá v indexe OurAirports podľa kódu
 * (ICAO/IATA). Celý vstup zlyhá pri prvej chybe — nič sa neuloží napoly. Pure.
 * @param {unknown} input `{facts: [...]}` z API
 * @param {{event: object, trusted: string[], airportIndex: Map<string, object>}} ctx
 * @returns {{facts: object[]|null, error: string|null, index?: number}}
 */
export function normalizeReportedFacts(input, { event, trusted, airportIndex }) {
  const list = Array.isArray(input?.facts) ? input.facts : null;
  if (!list) return { facts: null, error: 'no_facts' };
  if (list.length > REPORTED_LIMITS.facts) return { facts: null, error: 'too_many_facts' };
  const lo = (event?.firstT ?? 0) - BEFORE_S;
  const hi = Math.max(event?.lastT ?? 0, event?.window?.toT ?? 0) + AFTER_S;
  const facts = [];
  for (let index = 0; index < list.length; index += 1) {
    const f = list[index] || {};
    const fail = (error) => ({ facts: null, error, index });
    if (!REPORTED_KINDS.includes(f.kind)) return fail('bad_kind');
    const t = timeOf(f.t);
    if (t === null || t < lo || t > hi) return fail('bad_time');
    const { sources, error } = sourcesOf(f.sources, trusted || []);
    if (error) return fail(error);
    const via = f.via && typeof f.via === 'object'
      ? { sk: textOf(f.via.sk, REPORTED_LIMITS.viaMax) || null, en: textOf(f.via.en, REPORTED_LIMITS.viaMax) || null }
      : null;
    const domains = [...new Set(sources.map((s) => s.domain))];
    const base = { kind: f.kind, t, via, sources, domains, status: domains.length >= 2 ? 'confirmed' : 'single' };
    if (f.kind === 'landing') {
      const code = String(f.airport || '').trim().toUpperCase();
      const a = /^[A-Z0-9]{3,4}$/.test(code) && airportIndex instanceof Map ? airportIndex.get(code) : null;
      if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return fail('unknown_airport');
      if (!sources.some((s) => s.time)) return fail('no_time_source');
      facts.push({
        ...base,
        emergency: f.emergency === true,
        airport: { icao: a.icao ?? null, iata: a.iata ?? null, name: a.name || '', city: a.municipality || '', country: a.country ?? null, lat: a.lat, lon: a.lon, elevFt: a.elevFt ?? null },
        timeDomains: sources.filter((s) => s.time).map((s) => s.domain),
      });
    } else {
      const fromT = timeOf(f.fromT);
      const fromFt = Number(f.fromFt);
      const toFt = Number(f.toFt);
      if (fromT === null || fromT >= t || t - fromT > 15 * 60) return fail('bad_time');
      if (!(fromFt > 0 && fromFt <= 60000 && toFt >= 0 && toFt < fromFt)) return fail('bad_altitude');
      facts.push({
        ...base,
        fromT,
        fromFt,
        toFt,
        fromNearly: f.fromNearly === true,
        toBelow: f.toBelow === true,
      });
    }
  }
  facts.sort((a, b) => a.t - b.t);
  return { facts, error: null };
}

/** Uložené fakty udalosti (zle uložené sa preskočia). Pure. */
export function reportedFacts(event) {
  return (Array.isArray(event?.reported) ? event.reported : []).filter((f) => f && REPORTED_KINDS.includes(f.kind)
    && Number.isFinite(f.t) && Array.isArray(f.domains) && f.domains.length);
}

/**
 * Pristátia zo správ ako momenty časovej osi (značka na letisku, bez čiary k stope). `seenBy` je prázdne —
 * nevidela ich žiadna sieť; `reportedBy` = médiá. Pure.
 */
export function reportedLandingMoments(event) {
  return reportedFacts(event).filter((f) => f.kind === 'landing' && f.airport).map((f) => ({
    kind: 'reported-landing',
    t: f.t,
    lat: f.airport.lat,
    lon: f.airport.lon,
    alt: null,
    elevFt: f.airport.elevFt ?? null,
    seenBy: [],
    reportedBy: f.domains,
    reported: f,
  }));
}

/** Poklesy zo správ k diere [fromT, toT] (koniec poklesu v diere alebo tesne pred ňou). Pure. */
export function reportedForGap(event, gap) {
  if (!gap || !Number.isFinite(gap.fromT) || !Number.isFinite(gap.toT)) return [];
  return reportedFacts(event).filter((f) => f.kind === 'descent' && f.t >= gap.fromT - GAP_SLACK_S && f.t <= gap.toT);
}

/**
 * Konkurenčné služby sledovania letov sa vo výstupoch OKO nemenujú (vlastník 10-02: „to tam nespomínaj,
 * vždy spomínaj môj portál") — fakt ostáva „podľa správ" s menami médií a odkazmi; kto meral, je len
 * v uloženom citáte (audit).
 */
export const HIDDEN_VIA = /flight\s*-?\s*radar|flightaware|ads-?b\s*-?\s*exchange|radarbox|plane\s*finder/i;

/** Kto meral (napr. „letisko Tabuk") na zobrazenie, alebo null (nič, konkurenčná služba). Pure. */
export function publicVia(f, lang = 'sk') {
  const v = f?.via?.[lang === 'en' ? 'en' : 'sk'] || f?.via?.sk || null;
  return v && !HIDDEN_VIA.test(v) ? v : null;
}

/**
 * „podľa správ pod 17 000 ft už o 05:22" — poznámka k diere; s menami médií „(Al Jazeera, Arab News)";
 * so zobraziteľným zdrojom merania „(údaje … podľa Al Jazeera, Arab News)". Pure.
 * @param {string} [outlets] mená médií (text príspevku)
 */
export function descentNote(f, lang = 'sk', outlets = '') {
  const en = lang === 'en';
  const via = publicVia(f, lang);
  let data = '';
  if (via) data = en ? ` (${via} data${outlets ? ` via ${outlets}` : ''})` : ` (údaje ${via}${outlets ? ` podľa ${outlets}` : ''})`;
  else if (outlets) data = ` (${outlets})`;
  return `${en ? 'per reports' : 'podľa správ'} ${descentCore(f, lang)}${data}`;
}

/** Jadro poznámky o poklese: „pod 17 000 ft už o 05:22" / „below 17,000 ft by 05:22". Pure. */
export function descentCore(f, lang = 'sk') {
  const en = lang === 'en';
  const alt = `${f.toBelow ? (en ? 'below ' : 'pod ') : ''}${group(f.toFt, lang)} ft`;
  return en ? `${alt} by ${hhmm(f.t)}` : `${alt} už o ${hhmm(f.t)}`;
}

/** „núdzové pristátie na letisku Tabuk (TUU)" — bez „podľa správ" (to pridá popis momentu). Pure. */
export function landingPhrase(f, lang = 'sk') {
  const en = lang === 'en';
  const a = f.airport || {};
  const code = a.iata || a.icao || '';
  const place = `${a.city || a.name || code}${code && (a.city || a.name) ? ` (${code})` : ''}`;
  if (en) return `${f.emergency ? 'emergency landing' : 'landing'} at ${place}`;
  return `${f.emergency ? 'núdzové pristátie' : 'pristátie'} na letisku ${place}`;
}
