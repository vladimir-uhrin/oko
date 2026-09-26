// src/data/ukraineEventsClient.js
/**
 * @module ukraineEventsClient
 * @description Klientský sklad udalostí modulu UKRAJINA (etapa 3, 2026-09-19):
 * načíta okno z `/api/ukraine/events` po kusoch ≤ 31 dní (limit proxy), zloží
 * jednotný model (VIINA + GeoConfirmed + správy + médiá cez čisté funkcie
 * ukraineEvents.js/ukraineMedia.js) a pre dlhé rozsahy berie súhrn po dňoch
 * z `/summary`. Bez DOM a Cesia — testovateľné v Node.
 */
import { classifyIncident, locateIncident } from './gulfIncidents.js';
import { filterSanctionedNews } from './sanctionedMedia.js';
import { UKRAINE_GAZETTEER } from './ukraineIncidents.js';
import { UKRAINE_EVENTS_API, attachMedia, attachNews, dayKey, eventsInWindow, fetchUkraineEvents, fireToEvent, newsItemToEvent } from './ukraineEvents.js';
import { mediaToAlert, mediaToEvent } from './ukraineMedia.js';

export const CHUNK_DAYS = 31;
const D = 86_400_000;

/** Rozsah ms → denné kusy ≤ 31 dní (`from`/`to` = YYYY-MM-DD). Pure. */
export function chunkRanges(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const out = [];
  let a = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate());
  const last = Date.UTC(new Date(endMs).getUTCFullYear(), new Date(endMs).getUTCMonth(), new Date(endMs).getUTCDate());
  while (a <= last) {
    const b = Math.min(last, a + (CHUNK_DAYS - 1) * D);
    out.push({ from: dayKey(a), to: dayKey(b) });
    a = b + D;
  }
  return out;
}

const enClassify = (text) => classifyIncident(text, { region: 'ukraine' });
const enLocate = (text) => locateIncident(text, UKRAINE_GAZETTEER);

/**
 * Zlož udalosti okna z odpovedí proxy: VIINA/GeoConfirmed sú hotové, správy a
 * médiá sa prevedú a pripoja (deň + miesto). Sankčný blocklist ešte raz na
 * klientovi. Pure.
 * @param {Array<{events?:any[], news?:any[], media?:any[]}>} payloads
 * @param {{startMs:number,endMs:number}} window
 */
export function assembleEvents(payloads, { startMs, endMs }) {
  const base = []; const newsEvents = []; const mediaEvents = [];
  const seen = new Set();
  for (const p of payloads || []) {
    for (const e of p?.events || []) { if (e?.id && !seen.has(e.id)) { seen.add(e.id); base.push(e); } }
    const news = filterSanctionedNews(Array.isArray(p?.news) ? p.news : []).items;
    for (const it of news) { const ev = newsItemToEvent(it); if (ev && !seen.has(ev.id)) { seen.add(ev.id); newsEvents.push(ev); } }
    for (const it of p?.media || []) {
      const ev = mediaToEvent(it, { classifyEn: enClassify, locateEn: enLocate });
      if (ev && !seen.has(ev.id)) { seen.add(ev.id); mediaEvents.push(ev); }
    }
  }
  const merged = attachMedia(attachNews(base, newsEvents), mediaEvents);
  // Vojnové požiare ako body `hotspot` (bez karty) — pripájajú sa až po zlúčení,
  // aby správy a médiá nešli na požiar namiesto na sídlo.
  const fires = [];
  for (const p of payloads || []) for (const it of p?.fires || []) { const ev = fireToEvent(it); if (ev && !seen.has(ev.id)) { seen.add(ev.id); fires.push(ev); } }
  return eventsInWindow([...merged, ...fires], startMs, endMs);
}

/**
 * Poplachy Vzdušných síl okna (samostatný prúd, nie udalosti — tie sa pri
 * zlučovaní pripájajú k iným), od najstaršieho. Pure.
 */
export function assembleAlerts(payloads, { startMs, endMs }) {
  const out = []; const seen = new Set();
  for (const p of payloads || []) {
    for (const it of p?.media || []) {
      const a = mediaToAlert(it);
      if (!a || seen.has(a.id) || a.t < startMs || a.t > endMs) continue;
      seen.add(a.id); out.push(a);
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Snímka územnej kontroly platná pre deň (Wikipedia, CC BY-SA) z proxy. */
export async function fetchUkraineControl(day, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/control?at=${encodeURIComponent(day)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  return json;
}
/** Statické škody (`adm3` = hromady ETH Zürich, `unosat` = body UNOSAT) z proxy. */
export async function fetchUkraineDamage(name, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/damage/${name === 'unosat' ? 'unosat' : 'adm3'}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  return json;
}
/** Snímka DeepState platná pre deň (náš denný archív) z proxy. */
export async function fetchUkraineDeepState(day, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/deepstate?at=${encodeURIComponent(day)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  // Telo chyby ide s ňou: 404 z mirroru (`source: 'mirror'`) má iný text než 404 z archívu.
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; err.body = json; throw err; }
  return json;
}

/** Médiá okna (na pás fotiek/videí): všetky médiá udalostí + samostatné, od najnovšieho. Pure. */
/**
 * Nesie položka naozaj obrázok alebo video? Telegramové kanály sú z väčšiny
 * TEXT: za 22. 9. 2026 bolo v okne 292 položiek, z toho 196 textových hlásení
 * bez prílohy (typicky „Повітряні сили ЗСУ" o dronoch). Pás sa volá FOTKY
 * A VIDEÁ, takže sa kreslili ako prázdne dlaždice a ešte sa aj počítali.
 *
 * Video bez náhľadu je stále video — prílohy ArmyInformu (`provider: 'file'`)
 * náhľad nemajú, ale prehrať sa dajú, takže v páse ostávajú so značkou ▶.
 * Pure.
 */
export function hasVisualMedia(m) {
  if (!m) return false;
  if (m.kind === 'video' || Number(m.videos) > 0) return true;
  return Boolean(m.thumb) || (Array.isArray(m.photos) && m.photos.length > 0);
}

export function mediaInWindow(events) {
  const out = []; const seen = new Set();
  for (const e of events || []) {
    for (const m of e.media || []) {
      const key = m.url || m.thumb;
      if (!key || !hasVisualMedia(m) || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...m, t: e.t, eventId: e.id, place: e.place || null, type: e.type, severity: e.severity, level: e.level });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}

/** Súhrn po dňoch z proxy. */
export async function fetchUkraineSummary(from, to, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  return json;
}

/** Odseky smerov z hlásení GŠ po dňoch (karta smeru, ≤ 92 dní). */
export async function fetchUkraineDirections(from, to, { fetcher = (...a) => fetch(...a), base = UKRAINE_EVENTS_API } = {}) {
  const response = await fetcher(`${base}/directions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: 'no-store' });
  const json = await response.json().catch(() => null);
  if (!response.ok) { const err = new Error(json?.error ? String(json.error) : `HTTP ${response.status}`); err.status = response.status; throw err; }
  return json;
}

/**
 * Sklad: kusy sa cachujú (dnešný kus 60 s, minulé kusy 30 min — archivár ich
 * ešte dopĺňa obrázkami), súhrny 10 min. `load` skladá model okna.
 */
export function createUkraineEventStore({ fetchEvents = fetchUkraineEvents, fetchSummary = fetchUkraineSummary, fetchControl = fetchUkraineControl, fetchDeepState = fetchUkraineDeepState, fetchDirections = fetchUkraineDirections, now = Date.now, chunkTtlMs = 60_000, pastTtlMs = 30 * 60_000, summaryTtlMs = 10 * 60_000, controlTtlMs = 15 * 60_000, maxChunks = 40 } = {}) {
  const chunks = new Map(); // `${from}:${to}` -> { at, payload, promise }
  const summaries = new Map();
  const controls = new Map(); // deň -> { at, payload } (snímka platná pre deň)
  const deepstates = new Map();
  const directionRanges = new Map(); // `${from}:${to}` -> { at, payload, promise }
  const evict = (map, max) => { while (map.size > max) map.delete(map.keys().next().value); };

  function chunkFor(range) {
    const key = `${range.from}:${range.to}`;
    const hit = chunks.get(key);
    const includesToday = range.to >= dayKey(now());
    const ttl = includesToday ? chunkTtlMs : pastTtlMs;
    if (hit?.payload && now() - hit.at < ttl) return Promise.resolve(hit.payload);
    if (hit?.promise) return hit.promise;
    const promise = Promise.resolve(fetchEvents(range.from, range.to))
      .then((payload) => { chunks.set(key, { at: now(), payload }); evict(chunks, maxChunks); return payload; })
      .catch((error) => { chunks.delete(key); if (hit?.payload) return hit.payload; throw error; });
    chunks.set(key, { ...(hit || {}), promise });
    return promise;
  }

  /**
   * @returns {Promise<{events:any[], reports:Record<string,any>, coverage:object, errors:string[], chunks:number}>}
   */
  async function load(startMs, endMs) {
    const ranges = chunkRanges(startMs, endMs);
    const payloads = []; const errors = [];
    for (const r of ranges) {
      try { payloads.push(await chunkFor(r)); } catch (error) { errors.push(`${r.from}..${r.to}: ${error?.message || error}`); }
    }
    const reports = {}; const coverage = { geoconfirmed: [], news: [], media: [], reports: [], viina: {} };
    for (const p of payloads) {
      Object.assign(reports, p?.reports || {});
      for (const k of ['geoconfirmed', 'news', 'media', 'reports']) coverage[k].push(...(p?.coverage?.[k] || []));
      Object.assign(coverage.viina, p?.coverage?.viina || {});
    }
    return { events: assembleEvents(payloads, { startMs, endMs }), alerts: assembleAlerts(payloads, { startMs, endMs }), reports, coverage, errors, chunks: payloads.length, fetchedAt: now() };
  }

  async function summary(startMs, endMs) {
    const from = dayKey(startMs); const to = dayKey(endMs);
    const key = `${from}:${to}`;
    const hit = summaries.get(key);
    if (hit && now() - hit.at < summaryTtlMs) return hit.payload;
    const payload = await fetchSummary(from, to);
    summaries.set(key, { at: now(), payload });
    evict(summaries, 12);
    return payload;
  }

  /**
   * Odseky smerov pre rozsah dní (karta smeru). Súbežné žiadosti o ten istý
   * rozsah zdieľajú jeden dopyt; zlyhanie sa necachuje (ďalší pokus ide na server).
   */
  function directions(from, to) {
    const key = `${from}:${to}`;
    const hit = directionRanges.get(key);
    if (hit?.payload && now() - hit.at < summaryTtlMs) return Promise.resolve(hit.payload);
    if (hit?.promise) return hit.promise;
    const promise = Promise.resolve(fetchDirections(from, to))
      .then((payload) => { directionRanges.set(key, { at: now(), payload }); evict(directionRanges, 12); return payload; })
      .catch((error) => { directionRanges.delete(key); throw error; });
    directionRanges.set(key, { promise });
    return promise;
  }

  /** Snímka kontroly pre deň (ms alebo YYYY-MM-DD); rovnaká snímka pre viac dní sa v cache zdieľa podľa jej dňa. */
  async function control(dayOrMs) {
    const day = typeof dayOrMs === 'string' ? dayOrMs : dayKey(dayOrMs);
    const hit = controls.get(day);
    if (hit && now() - hit.at < controlTtlMs) return hit.payload;
    const payload = await fetchControl(day);
    controls.set(day, { at: now(), payload });
    if (payload?.day && payload.day !== day) controls.set(payload.day, { at: now(), payload });
    evict(controls, 24);
    return payload;
  }

  /** Snímka DeepState pre deň (rovnaká cache logika ako kontrola). */
  async function deepstate(dayOrMs) {
    const day = typeof dayOrMs === 'string' ? dayOrMs : dayKey(dayOrMs);
    const hit = deepstates.get(day);
    if (hit && now() - hit.at < controlTtlMs) return hit.payload;
    const payload = await fetchDeepState(day);
    deepstates.set(day, { at: now(), payload });
    // Pod vlastným dňom s requestedAt toho dňa — inak by vek meral od cudzieho dňa.
    if (payload?.day && payload.day !== day) deepstates.set(payload.day, { at: now(), payload: { ...payload, requestedAt: payload.day } });
    evict(deepstates, 24);
    return payload;
  }

  /** Hlásenie GŠ pre deň kurzora (najbližší predchádzajúci deň s hlásením do 3 dní). */
  function reportForDay(reports, ms) {
    for (let back = 0; back <= 3; back += 1) {
      const r = reports?.[dayKey(ms - back * D)];
      if (r) return r;
    }
    return null;
  }

  return { load, summary, directions, control, deepstate, reportForDay, chunkRanges, _chunks: chunks };
}
