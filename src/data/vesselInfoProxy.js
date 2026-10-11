// src/data/vesselInfoProxy.js
/**
 * @module vesselInfoProxy
 * @description Vite plugin: detail plavidla z registra a jeho fotka podľa MMSI
 * (2026-10-10, vlastník: „doplň aj fotky a na licenciu ser").
 *
 *   GET /api/vessel-info?mmsi=241190000  → JSON { mmsi, imo, name, typeDetail,
 *       yearBuilt, grossTonnage, deadweight, lengthM, beamM, country, photo }
 *   GET /api/vessel-info/photo?mmsi=…&size=1  → JPEG (1 = väčší, 0 = náhľad)
 *
 * AIS nenesie fotku ani podrobný typ („Chemical/Oil Products Tanker", rok
 * stavby, GT, DWT) — tie sú v registri verejného prehliadača lodí (zdroj je
 * zapísaný v DATA_SOURCES.md; v rozhraní sa nemenuje, pravidlo o konkurencii).
 * Jeho JSON nemá CORS, preto proxy; fotka ide tiež cez nás, aby prehliadač
 * nevolal cudziu doménu a obrázok sa kešoval na disku.
 *
 * Ochrana: kešovanie na disku (`.gev-cache/vessel-info/`, junction na D:) —
 * údaje 7 dní, prázdny výsledok 1 deň, fotka 30 dní; limiter na klienta a
 * celkový strop dopytov upstream za hodinu; súbežné dopyty na to isté MMSI
 * sa zlúčia. Bez kľúča, bez peňazí.
 */
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { MT_BASE, VF_TRACK, BROWSER_UA as TRACK_UA, curlGet, decodeVfTrack, parseMtGeneral, parseMtPort, parseMtPosition, parseMtSearch, parseMtSearchResults, parseMtTrack, parseMtVoyage } from './vesselTrackSources.js';

/** Posledná poloha a plavba z MarineTraffic — mení sa rýchlo. */
export const MT_LIVE_TTL_MS = 10 * 60 * 1000;
export const MT_ID_TTL_MS = 30 * 24 * 3600 * 1000;
export const MT_PORT_TTL_MS = 30 * 24 * 3600 * 1000;
export const TRACK_TTL_MS = 10 * 60 * 1000;
export const MT_HOURLY_MAX = 900;

/**
 * Posledný prístav z plavby MT v tvare info.voyage (registra). Odchod (ATD)
 * má prednosť; loď, ktorá do prístavu práve prišla (ATA bez ATD), ho má ako
 * „kde je" — vtedy departedAt null a arrivedAt nastavené. Pure.
 */
export function mtVoyageAsRegistry(voyage, depPort, arrPort) {
  const coords = (p) => (Number.isFinite(p?.lat) && Number.isFinite(p?.lon) ? { lat: p.lat, lon: p.lon } : {});
  // Príchod po odchode = loď je v cieľovom prístave (TURIEC: Freudenau 4. 7. → Bratislava 4. 7.).
  const arrivedLater = Number.isFinite(voyage?.arrivedAt) && (!Number.isFinite(voyage?.departedAt) || voyage.arrivedAt > voyage.departedAt);
  if (arrivedLater && arrPort?.name) {
    return { lastPort: arrPort.name, lastPortCountry: arrPort.country, departedAt: null, arrivedAt: voyage.arrivedAt, locode: arrPort.locode, ...coords(arrPort), source: 'mt' };
  }
  if (depPort?.name && Number.isFinite(voyage?.departedAt)) {
    return { lastPort: depPort.name, lastPortCountry: depPort.country, departedAt: voyage.departedAt, locode: depPort.locode, ...coords(depPort), source: 'mt' };
  }
  if (arrPort?.name && Number.isFinite(voyage?.arrivedAt)) {
    return { lastPort: arrPort.name, lastPortCountry: arrPort.country, departedAt: null, arrivedAt: voyage.arrivedAt, locode: arrPort.locode, ...coords(arrPort), source: 'mt' };
  }
  return null;
}

/** Cieľový prístav z plavby MT (keď je to ETA, nie príchod) — meno, LOCODE, poloha. Pure. */
export function mtDestinationPort(voyage, arrPort) {
  if (!Number.isFinite(voyage?.arrivalEtaMs) || !arrPort?.name || !Number.isFinite(arrPort.lat)) return null;
  return { name: arrPort.name, locode: arrPort.locode, country: arrPort.country, lat: arrPort.lat, lon: arrPort.lon, etaMs: voyage.arrivalEtaMs };
}

/** Rovnaký prístav? (register „Newport News" vs MT „NEWPORT NEWS"). Pure. */
function samePortName(a, b) {
  const k = (v) => String(v || '').toUpperCase().replace(/[^A-Z]/g, '');
  const x = k(a); const y = k(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}

/**
 * Plavba pre klienta: register (čerstvejší text) doplnený o súradnice a LOCODE
 * z MT, keď ide o ten istý prístav; bez registra plavba MT. Pure.
 */
export function mergeVoyage(registry, mt) {
  if (!registry?.lastPort) return mt || null;
  if (mt?.lastPort && samePortName(registry.lastPort, mt.lastPort) && Number.isFinite(mt.lat)) {
    return { ...registry, locode: registry.locode || mt.locode || null, lat: mt.lat, lon: mt.lon };
  }
  return registry;
}

export const VESSEL_INFO_UPSTREAM = 'https://www.vesselfinder.com/api/pub/click/';
export const VESSEL_PHOTO_UPSTREAM = 'https://static.vesselfinder.net/ship-photo/';
export const VESSEL_DETAILS_UPSTREAM = 'https://www.vesselfinder.com/vessels/details/';
/** Posledný prístav a odchod sa menia s plavbou — kratšia cache než register. */
export const VESSEL_VOYAGE_TTL_MS = 6 * 3600 * 1000;
export const VESSEL_DETAILS_MAX_BYTES = 2 * 1024 * 1024;
export const VESSEL_INFO_TTL_MS = 7 * 24 * 3600 * 1000;
export const VESSEL_INFO_EMPTY_TTL_MS = 24 * 3600 * 1000;
export const VESSEL_PHOTO_TTL_MS = 30 * 24 * 3600 * 1000;
export const VESSEL_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
/** Celkový strop dopytov upstream za hodinu (cache hity sa nerátajú). */
export const VESSEL_UPSTREAM_HOURLY_MAX = 600;
const UPSTREAM_TIMEOUT_MS = 15_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Platné MMSI (9 číslic, nie samé nuly) alebo null. Pure. */
export function parseMmsi(value) {
  const mmsi = String(value ?? '').trim();
  return /^\d{9}$/.test(mmsi) && !/^0+$/.test(mmsi) ? mmsi : null;
}

/** Identifikátor fotky (`IMO-MMSI-hash`) — len bezpečné znaky, inak null. Pure. */
export function parsePhotoId(value) {
  const id = String(value ?? '').trim();
  return /^[0-9]{1,9}-[0-9]{9}-[0-9a-f]{16,64}$/.test(id) ? id : null;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text && !/^(unknown|other type$)/i.test(text) ? text : null;
}

/**
 * Odpoveď registra → náš tvar. Prázdny záznam (imo 0, „unknown type", bez
 * fotky) dáva `empty: true` — loď v registri nie je, kešuje sa kratšie. Pure.
 * @param {string} mmsi
 * @param {object|null} json
 */
export function normalizeVesselInfo(mmsi, json) {
  const imo = positive(json?.imo);
  const photoId = parsePhotoId(json?.pic);
  const name = cleanText(json?.name);
  const out = {
    mmsi,
    imo: imo ? String(imo) : null,
    name: name && name !== mmsi ? name : null,
    typeDetail: cleanText(json?.type),
    yearBuilt: positive(json?.y),
    grossTonnage: positive(json?.gt),
    deadweight: positive(json?.dw),
    lengthM: positive(json?.al),
    beamM: positive(json?.aw),
    country: cleanText(json?.country),
    // Cieľ a ETA z registra — AISHub ich nenesie (2026-10-10, súčasná plavba).
    destination: cleanText(json?.dest),
    etaMs: positive(json?.etaTS) ? positive(json.etaTS) * 1000 : null,
    photoId,
  };
  out.empty = !out.imo && !out.typeDetail && !photoId && !out.yearBuilt;
  return out;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * „Sep 22, 20:32" (UTC, bez roka) → epoch ms. Rok sa doplní tak, aby čas
 * nebol v budúcnosti (odchod je minulosť; na prelome roka „Dec 30" v januári
 * patrí do minulého roka). Pure.
 * @param {string} text
 * @param {number} nowMs
 * @returns {number|null}
 */
export function parseDepartureUtc(text, nowMs) {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(?:(\d{4})\s+)?(\d{1,2}):(\d{2})/.exec(String(text || ''));
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (month === undefined) return null;
  const now = new Date(nowMs);
  let year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  let ms = Date.UTC(year, month, Number(m[2]), Number(m[4]), Number(m[5]));
  if (!m[3] && ms > nowMs + 24 * 3600 * 1000) { year -= 1; ms = Date.UTC(year, month, Number(m[2]), Number(m[4]), Number(m[5])); }
  return Number.isFinite(ms) ? ms : null;
}

function htmlText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/(\| ?)+/g, '|');
}

/**
 * Posledný prístav a čas odchodu zo stránky lode v registri:
 * `Last Port|Saint Petersburg, Russia|ATD: Sep 22, 20:32 UTC`. Pure.
 * @param {string} html
 * @param {number} nowMs
 * @returns {{lastPort: string, lastPortCountry: string|null, departedAt: number|null}|null}
 */
export function parseVesselVoyageHtml(html, nowMs) {
  const text = htmlText(html);
  const m = /\|\s*Last Port\s*\|\s*([^|]{2,80}?)\s*\|\s*(?:ATD:\s*([^|]{4,40}))?/.exec(text);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw || raw === '-' || /^n\/?a$/i.test(raw)) return null;
  const comma = raw.lastIndexOf(',');
  const lastPort = (comma > 0 ? raw.slice(0, comma) : raw).trim();
  const lastPortCountry = comma > 0 ? raw.slice(comma + 1).trim() || null : null;
  return { lastPort, lastPortCountry, departedAt: parseDepartureUtc(m[2], nowMs) };
}

export const GFW_API = 'https://gateway.api.globalfishingwatch.org/v3';
/** História prístavov sa mení s plavbou, GFW ju dopĺňa s ~3-dňovým oneskorením. */
export const PORT_CALLS_TTL_MS = 12 * 3600 * 1000;
export const PORT_CALLS_LOOKBACK_DAYS = 120;
/** Strop dopytov na GFW za deň (2 na loď); GFW dovoľuje 50 000. */
export const PORT_CALLS_DAILY_MAX = 600;

/**
 * Identity lode v GFW pre MMSI (jedna loď = viac záznamov podľa obdobia). Pure.
 * @param {object} json odpoveď /v3/vessels/search
 * @param {string} mmsi
 * @returns {string[]}
 */
export function gfwVesselIdsForMmsi(json, mmsi) {
  const ids = new Set();
  for (const entry of Array.isArray(json?.entries) ? json.entries : []) {
    for (const info of Array.isArray(entry?.selfReportedInfo) ? entry.selfReportedInfo : []) {
      if (String(info?.ssvid) === String(mmsi) && info.id) ids.add(String(info.id));
    }
  }
  return [...ids].slice(0, 5);
}

function titleCase(text) {
  return String(text || '').toLowerCase().replace(/(^|[\s-])([a-zà-ž])/g, (m, a, b) => a + b.toUpperCase());
}

/**
 * Návštevy prístavov z GFW → chronologický zoznam, susedné návštevy toho istého
 * prístavu (kotvisko → prístav) zlúčené. Pure.
 * @param {object} json odpoveď /v3/events (public-global-port-visits-events)
 * @returns {Array<{name: string|null, flag: string|null, lat: number, lon: number, arrival: number|null, departure: number|null}>}
 */
export function normalizePortCalls(json) {
  const calls = [];
  for (const e of Array.isArray(json?.entries) ? json.entries : []) {
    const anchor = e?.port_visit?.endAnchorage || e?.port_visit?.startAnchorage || null;
    const lat = Number(e?.position?.lat ?? anchor?.lat);
    const lon = Number(e?.position?.lon ?? anchor?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Kotvisko býva bez mena („USA-1152") — vezmi prvé skutočné meno z konca, začiatku alebo stredu návštevy.
    const pv = e?.port_visit || {};
    const rawName = [pv.endAnchorage, pv.startAnchorage, pv.intermediateAnchorage]
      .map((a) => a?.name).find((n) => n && !/^[A-Z]{3}-\d+$/.test(n)) || null;
    calls.push({
      name: rawName ? titleCase(rawName) : null,
      flag: anchor?.flag ? String(anchor.flag) : null,
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      arrival: Date.parse(e.start) || null,
      departure: Date.parse(e.end) || null,
    });
  }
  calls.sort((a, b) => (a.arrival || 0) - (b.arrival || 0));
  const merged = [];
  for (const c of calls) {
    const prev = merged[merged.length - 1];
    const samePlace = prev && ((prev.name && prev.name === c.name) || (!c.name && Math.abs(prev.lat - c.lat) < 0.5 && Math.abs(prev.lon - c.lon) < 0.5));
    if (samePlace && Number.isFinite(c.arrival) && Number.isFinite(prev.departure) && c.arrival - prev.departure < 3 * 86400_000) {
      prev.departure = c.departure ?? prev.departure;
      if (!prev.name && c.name) prev.name = c.name;
      continue;
    }
    merged.push({ ...c });
  }
  return merged.slice(-15);
}

/** Verejný tvar pre klienta: identifikátor fotky sa nahradí našou URL. Pure. */
export function publicVesselInfo(info, voyage = null, portCalls = null) {
  if (!info) return null;
  const { photoId, empty, ...rest } = info;
  return {
    ...rest,
    portCalls: Array.isArray(portCalls) && portCalls.length ? portCalls : null,
    voyage: voyage && voyage.lastPort ? voyage : null,
    photo: photoId ? { src: `/api/vessel-info/photo?mmsi=${info.mmsi}&size=1`, thumb: `/api/vessel-info/photo?mmsi=${info.mmsi}&size=0` } : null,
  };
}

/** Kľúč klienta: za tunelom CF-Connecting-IP, inak socket. */
function clientKey(req) {
  const cf = req?.headers?.['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req?.socket?.remoteAddress || 'local';
}

function windowLimiter({ windowMs, max, now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let arr = hits.get(key);
    if (!arr) { arr = []; hits.set(key, arr); }
    while (arr.length && t - arr[0] > windowMs) arr.shift();
    if (arr.length >= max) return false;
    arr.push(t);
    return true;
  };
}

/**
 * @param {object} [o]
 * @param {string} [o.root] koreň projektu (cache pod `.gev-cache/vessel-info`)
 * @param {Function} [o.fetchImpl]
 * @param {Function} [o.now]
 * @param {Function} [o.log]
 */
export function vesselInfoProxy({ root = process.cwd(), fetchImpl = (...a) => fetch(...a), now = Date.now, log = (m) => console.log(m), gfwToken = () => process.env.GFW_API_TOKEN, mtGet = curlGet } = {}) {
  const dir = path.join(root, '.gev-cache', 'vessel-info');
  const gfwDaily = windowLimiter({ windowMs: 24 * 3600_000, max: PORT_CALLS_DAILY_MAX, now });
  const perClient = windowLimiter({ windowMs: 60_000, max: 90, now });
  const upstreamBudget = windowLimiter({ windowMs: 3600_000, max: VESSEL_UPSTREAM_HOURLY_MAX, now });
  const inflight = new Map();
  const infoFile = (mmsi) => path.join(dir, `${mmsi}.json`);
  const photoFile = (mmsi, size) => path.join(dir, 'photo', `${mmsi}-${size}.jpg`);
  const voyageFile = (mmsi) => path.join(dir, 'voyage', `${mmsi}.json`);

  /**
   * Posledný prístav + čas odchodu (stránka lode podľa IMO). Nikdy nezhodí
   * odpoveď — bez plavby ide register ďalej. Prázdny výsledok sa kešuje tiež.
   */
  async function loadVoyage(info) {
    if (!info?.imo) return null;
    const file = voyageFile(info.mmsi);
    try {
      const entry = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (Number.isFinite(entry?.at) && now() - entry.at < VESSEL_VOYAGE_TTL_MS) return entry.voyage;
    } catch { /* nie je v cache */ }
    const job = inflight.get(`v:${info.mmsi}`);
    if (job) return job;
    const run = (async () => {
      try {
        if (!upstreamBudget('all')) return null;
        const res = await fetchImpl(`${VESSEL_DETAILS_UPSTREAM}${info.imo}`, {
          headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const html = await res.text();
        const voyage = html.length <= VESSEL_DETAILS_MAX_BYTES ? parseVesselVoyageHtml(html, now()) : null;
        await writeAtomic(file, JSON.stringify({ at: now(), voyage }));
        return voyage;
      } catch (error) {
        log(`[vessel-info] voyage ${info.mmsi} failed: ${error?.message || error}`);
        return null;
      }
    })().finally(() => inflight.delete(`v:${info.mmsi}`));
    inflight.set(`v:${info.mmsi}`, run);
    return run;
  }

  async function writeAtomic(file, data) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
  }

  async function readInfoCache(mmsi) {
    try {
      const entry = JSON.parse(await fsp.readFile(infoFile(mmsi), 'utf8'));
      // Záznam starší než pole cieľa (2026-10-10) sa načíta znova.
      if (entry?.info && !('destination' in entry.info)) return null;
      const ttl = entry?.info?.empty ? VESSEL_INFO_EMPTY_TTL_MS : VESSEL_INFO_TTL_MS;
      return Number.isFinite(entry?.at) && now() - entry.at < ttl ? entry.info : null;
    } catch { return null; }
  }

  /** Detail z cache alebo upstream; `{ info }` alebo `{ error, status }`. */
  function loadInfo(mmsi, key) {
    const job = inflight.get(`i:${mmsi}`);
    if (job) return job;
    const run = (async () => {
      const cached = await readInfoCache(mmsi);
      if (cached) return { info: cached, source: 'cache' };
      if (!perClient(key)) return { status: 429, error: 'rate_limited' };
      if (!upstreamBudget('all')) return { status: 503, error: 'budget' };
      const res = await fetchImpl(`${VESSEL_INFO_UPSTREAM}${mmsi}`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) return { status: 502, error: `upstream ${res.status}` };
      const info = normalizeVesselInfo(mmsi, await res.json());
      await writeAtomic(infoFile(mmsi), JSON.stringify({ at: now(), info }));
      return { info, source: 'upstream' };
    })().finally(() => inflight.delete(`i:${mmsi}`));
    inflight.set(`i:${mmsi}`, run);
    return run;
  }

  /**
   * Prístavy za posledné mesiace z Global Fishing Watch (návštevy prístavov):
   * odkiaľ loď ide aj pre lode, ktoré register nepozná, a história plavby.
   * Bez tokenu alebo pri chybe null — register ide ďalej.
   */
  async function loadPortCalls(mmsi) {
    const token = String(gfwToken?.() || '').trim();
    if (!token) return null;
    const file = path.join(dir, 'ports', `${mmsi}.json`);
    try {
      const entry = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (Number.isFinite(entry?.at) && now() - entry.at < PORT_CALLS_TTL_MS) return entry.calls;
    } catch { /* nie je v cache */ }
    const job = inflight.get(`g:${mmsi}`);
    if (job) return job;
    const run = (async () => {
      try {
        if (!gfwDaily('all')) return null;
        const headers = { Authorization: `Bearer ${token}` };
        const search = await fetchImpl(`${GFW_API}/vessels/search?query=${mmsi}&datasets[0]=public-global-vessel-identity:latest&limit=5`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (!search.ok) return null;
        const ids = gfwVesselIdsForMmsi(await search.json(), mmsi);
        let calls = [];
        if (ids.length && gfwDaily('all')) {
          const end = new Date(now() + 86400_000).toISOString().slice(0, 10);
          const start = new Date(now() - PORT_CALLS_LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
          const q = new URLSearchParams({ 'datasets[0]': 'public-global-port-visits-events:latest', 'start-date': start, 'end-date': end, limit: '40', offset: '0' });
          ids.forEach((id, i) => q.set(`vessels[${i}]`, id));
          const events = await fetchImpl(`${GFW_API}/events?${q}`, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
          if (!events.ok) return null;
          calls = normalizePortCalls(await events.json());
        }
        await writeAtomic(file, JSON.stringify({ at: now(), calls }));
        return calls;
      } catch (error) {
        log(`[vessel-info] port calls ${mmsi} failed: ${error?.message || error}`);
        return null;
      }
    })().finally(() => inflight.delete(`g:${mmsi}`));
    inflight.set(`g:${mmsi}`, run);
    return run;
  }

  const mtHourly = windowLimiter({ windowMs: 3600_000, max: MT_HOURLY_MAX, now });
  const mtDir = path.join(dir, 'mt');
  async function readFresh(file, ttl) {
    try {
      const entry = JSON.parse(await fsp.readFile(file, 'utf8'));
      return Number.isFinite(entry?.at) && now() - entry.at < ttl ? entry : null;
    } catch { return null; }
  }
  async function mtJson(pathPart) {
    if (!mtHourly('mt')) throw new Error('mt budget');
    return JSON.parse(await mtGet(MT_BASE + pathPart));
  }
  function dedupe(keyName, fn) {
    const job = inflight.get(keyName);
    if (job) return job;
    const run = fn().finally(() => inflight.delete(keyName));
    inflight.set(keyName, run);
    return run;
  }
  async function mtShipId(mmsi) {
    const file = path.join(mtDir, mmsi + '.id.json');
    const cached = await readFresh(file, MT_ID_TTL_MS);
    if (cached && (cached.shipId || now() - cached.at < 24 * 3600_000)) return cached.shipId;
    const shipId = parseMtSearch(await mtJson('/en/search/searchAsset?what=vessel&term=' + mmsi), mmsi);
    await writeAtomic(file, JSON.stringify({ at: now(), shipId }));
    return shipId;
  }
  async function mtPort(portId) {
    if (!portId) return null;
    const file = path.join(mtDir, 'port-' + String(portId).replace(/\D/g, '') + '.json');
    const cached = await readFresh(file, MT_PORT_TTL_MS);
    if (cached) return cached.port;
    const port = parseMtPort(await mtJson('/en/ports/' + encodeURIComponent(portId) + '/general'));
    await writeAtomic(file, JSON.stringify({ at: now(), port }));
    return port;
  }
  /**
   * Posledná poloha (aj „Roaming" na otvorenom oceáne) a plavba z MT. Nikdy
   * nezhodí odpoveď — pri chybe null a ostatné zdroje idú ďalej.
   */
  function loadMtLive(mmsi) {
    return dedupe('mt:' + mmsi, async () => {
      const file = path.join(mtDir, mmsi + '.live.json');
      const cached = await readFresh(file, MT_LIVE_TTL_MS);
      if (cached) return cached.live;
      try {
        const shipId = await mtShipId(mmsi);
        let live = null;
        if (shipId) {
          const [position, voyage] = await Promise.all([
            mtJson('/en/vessels/' + shipId + '/position').then(parseMtPosition).catch(() => null),
            mtJson('/en/vessels/' + shipId + '/voyage').then(parseMtVoyage).catch(() => null),
          ]);
          const [depPort, arrPort] = await Promise.all([
            mtPort(voyage?.departurePortId).catch(() => null),
            mtPort(voyage?.arrivalPortId).catch(() => null),
          ]);
          live = {
            shipId,
            position,
            voyage: mtVoyageAsRegistry(voyage, depPort, arrPort),
            destinationPort: mtDestinationPort(voyage, arrPort),
            routeProgress: voyage?.routeProgress ?? null,
            destination: voyage?.destination || null,
            etaMs: voyage?.etaMs || null,
          };
        }
        await writeAtomic(file, JSON.stringify({ at: now(), live }));
        return live;
      } catch (error) {
        log('[vessel-info] mt ' + mmsi + ' failed: ' + (error?.message || error));
        return null;
      }
    });
  }
  /** Trasa ~24 h: MT (aj „Roaming" body), záloha VF (pozemné). */
  function loadTrack(mmsi) {
    return dedupe('tr:' + mmsi, async () => {
      const file = path.join(mtDir, mmsi + '.track.json');
      const cached = await readFresh(file, TRACK_TTL_MS);
      if (cached) return cached.track;
      let track = { points: [], source: null };
      try {
        const live = await loadMtLive(mmsi);
        if (live?.shipId) {
          const pts = parseMtTrack(await mtJson('/map/gettrackjson/shipid:' + live.shipId));
          if (pts.length >= 2) track = { points: pts, source: 'mt' };
        }
      } catch (error) { log('[vessel-info] mt track ' + mmsi + ' failed: ' + (error?.message || error)); }
      if (!track.points.length && upstreamBudget('all')) {
        try {
          const res = await fetchImpl(VF_TRACK + mmsi, { headers: { 'User-Agent': TRACK_UA }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
          if (res.ok) {
            const pts = decodeVfTrack(Buffer.from(await res.arrayBuffer()));
            if (pts.length >= 2) track = { points: pts, source: 'vf' };
          }
        } catch (error) { log('[vessel-info] vf track ' + mmsi + ' failed: ' + (error?.message || error)); }
      }
      await writeAtomic(file, JSON.stringify({ at: now(), track }));
      return track;
    });
  }

  async function loadPhoto(mmsi, size, key) {
    const file = photoFile(mmsi, size);
    try {
      const stat = await fsp.stat(file);
      if (now() - stat.mtimeMs < VESSEL_PHOTO_TTL_MS) return { buf: await fsp.readFile(file), source: 'cache' };
    } catch { /* nie je v cache */ }
    const { info, status, error } = await loadInfo(mmsi, key);
    if (!info) return { status, error };
    if (!info.photoId) return { status: 404, error: 'no_photo' };
    const job = inflight.get(`p:${mmsi}:${size}`);
    if (job) return job;
    const run = (async () => {
      if (!upstreamBudget('all')) return { status: 503, error: 'budget' };
      const res = await fetchImpl(`${VESSEL_PHOTO_UPSTREAM}${info.photoId}/${size}`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'image/jpeg,image/*' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (res.status === 404) return { status: 404, error: 'no_photo' };
      if (!res.ok) return { status: 502, error: `upstream ${res.status}` };
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > VESSEL_PHOTO_MAX_BYTES || (type && !type.startsWith('image/'))) return { status: 502, error: 'bad_photo' };
      await writeAtomic(file, buf);
      return { buf, source: 'upstream' };
    })().finally(() => inflight.delete(`p:${mmsi}:${size}`));
    inflight.set(`p:${mmsi}:${size}`, run);
    return run;
  }

  const sendJson = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(JSON.stringify(body));
  };

  /** Hľadanie lode podľa mena / IMO / MMSI kdekoľvek (2026-10-11, bod 3). */
  function searchShips(q) {
    const term = String(q || '').trim().slice(0, 40);
    return dedupe('s:' + term.toLowerCase(), async () => {
      const file = path.join(mtDir, 'search', encodeURIComponent(term.toLowerCase()).slice(0, 80) + '.json');
      const cached = await readFresh(file, 3600_000);
      if (cached) return cached.results;
      const results = parseMtSearchResults(await mtJson('/en/search/searchAsset?what=vessel&term=' + encodeURIComponent(term)));
      await writeAtomic(file, JSON.stringify({ at: now(), results }));
      return results;
    });
  }
  /** Loď z výsledku hľadania: MMSI, meno a posledná poloha (aj „Roaming"). */
  function shipById(shipId) {
    return dedupe('ship:' + shipId, async () => {
      const file = path.join(mtDir, 'ship-' + shipId + '.json');
      const cached = await readFresh(file, MT_LIVE_TTL_MS);
      // Ten istý súbor zapisuje aj preklad lodí z oceánu ({mmsi, name} bez polohy) — ten tu nestačí.
      if (cached?.ship) return cached.ship;
      const [general, position] = await Promise.all([
        mtJson('/en/vessels/' + shipId + '/general').then(parseMtGeneral).catch(() => null),
        mtJson('/en/vessels/' + shipId + '/position').then(parseMtPosition).catch(() => null),
      ]);
      const ship = { shipId, ...(general || {}), position };
      // mmsi navrchu: preklad lodí z oceánu (vite.config.js) číta `mmsi` z toho istého súboru.
      await writeAtomic(file, JSON.stringify({ at: now(), mmsi: ship.mmsi || null, name: ship.name || null, ship }));
      return ship;
    });
  }

  async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: 'method_not_allowed' }); return; }
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/search' || url.pathname === '/ship') {
      const key = clientKey(req);
      if (!perClient(key)) { sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': '30' }); return; }
      try {
        if (url.pathname === '/search') {
          const q = String(url.searchParams.get('q') || '').trim();
          if (q.length < 3) { sendJson(res, 400, { error: 'short_query' }); return; }
          sendJson(res, 200, { query: q, results: await searchShips(q) }, { 'Cache-Control': 'public, max-age=600' });
          return;
        }
        const shipId = String(url.searchParams.get('shipId') || '');
        if (!/^\d{1,10}$/.test(shipId)) { sendJson(res, 400, { error: 'bad_ship' }); return; }
        sendJson(res, 200, await shipById(shipId), { 'Cache-Control': 'public, max-age=300' });
      } catch (error) {
        log('[vessel-info] search failed: ' + (error?.message || error));
        sendJson(res, 502, { error: 'upstream_failed' });
      }
      return;
    }
    const mmsi = parseMmsi(url.searchParams.get('mmsi'));
    if (!mmsi) { sendJson(res, 400, { error: 'bad_mmsi' }); return; }
    const key = clientKey(req);
    try {
      if (url.pathname === '/photo') {
        const size = url.searchParams.get('size') === '0' ? 0 : 1;
        const out = await loadPhoto(mmsi, size, key);
        if (out.buf) {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(out.buf.length),
            'Cache-Control': 'public, max-age=604800',
            'X-OKO-Source': out.source,
          });
          res.end(out.buf);
          return;
        }
        sendJson(res, out.status || 502, { error: out.error || 'upstream' }, out.status === 404 ? { 'Cache-Control': 'public, max-age=86400' } : {});
        return;
      }
      if (url.pathname === '/track') {
        if (!perClient(key)) { sendJson(res, 429, { error: 'rate_limited' }, { 'Retry-After': '30' }); return; }
        const track = await loadTrack(mmsi);
        sendJson(res, 200, { mmsi, points: track.points, source: track.source ? 'register' : null }, { 'Cache-Control': 'public, max-age=300' });
        return;
      }
      if (url.pathname !== '/' && url.pathname !== '') { sendJson(res, 404, { error: 'not_found' }); return; }
      const out = await loadInfo(mmsi, key);
      if (!out.info) { sendJson(res, out.status || 502, { error: out.error || 'upstream' }, out.status === 429 ? { 'Retry-After': '30' } : {}); return; }
      const [voyage, portCalls, mt] = await Promise.all([loadVoyage(out.info), loadPortCalls(mmsi), loadMtLive(mmsi)]);
      const body = publicVesselInfo(out.info, mergeVoyage(voyage, mt?.voyage || null), portCalls);
      // Cieľ s polohou a priebeh po námornej trase z MT (2026-10-11) — lišta priebehu aj tam,
      // kde náš zoznam prístavov text cieľa nepozná.
      body.destinationPort = mt?.destinationPort || null;
      body.routeProgress = Number.isFinite(mt?.routeProgress) ? mt.routeProgress : null;
      // Posledná poloha (aj z prijímača na inej lodi na otvorenom mori) a cieľ, keď ho register nemá.
      body.lastPosition = mt?.position || null;
      if (!body.destination && mt?.destination) { body.destination = mt.destination; body.etaMs = body.etaMs || mt.etaMs || null; }
      sendJson(res, 200, body, { 'Cache-Control': 'public, max-age=300', 'X-OKO-Source': out.source });
    } catch (error) {
      log(`[vessel-info] ${mmsi} failed: ${error?.message || error}`);
      sendJson(res, 502, { error: 'upstream_failed' });
    }
  }

  function install(server) { server.middlewares.use('/api/vessel-info', handler); }
  return {
    name: 'oko-vessel-info',
    configureServer(server) { install(server); },
    configurePreviewServer(server) { install(server); },
    _handler: handler,
    _dir: dir,
  };
}
