// src/data/vrsRoutes.js
// Trasy letov podľa volacieho znaku z Virtual Radar Server standing-data (2026-10-12).
//
// Prečo: odhady polôh bez signálu (flightEstimate.js) sú s cieľom 2× presnejšie (60–120 min bez
// signálu: medián 111 km s cieľom vs. 202 km len v poslednom smere — /api/flights/estimated/accuracy),
// no cieľ sa dohľadával len cez adsbdb, a ten smie pozadie volať 2× za minútu (adsbdbGuard — adsbdb
// nás 2026-10-05 blokoval). Výsledok 2026-10-12: cieľ malo 60 z 2 389 odhadov, rada stála na 3 000.
//
// Zdroj: github.com/vradarserver/standing-data (CC0-1.0, denné výpisy SDM databázy Virtual Radar
// Servera — tú istú databázu trás používa adsb.lol). Celý repozitár ako tar.gz má ~6 MB; stiahne sa
// raz za deň (ETag), uloží na disk a trasy sa hľadajú lokálne — žiadny dopyt navonok na lietadlo.
//   routes/schema-01/<A>/<ICAO>-all.csv   Callsign,Code,Number,AirlineCode,AirportCodes (WSSS-ZBAD, aj s medzipristátím A-B-C)
//   airports/schema-01/<A>/<AB>.csv       Code,Name,ICAO,IATA,Location,CountryISO2,Latitude,Longitude,AltitudeFeet

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';

export const VRS_ROUTES_URL = 'https://codeload.github.com/vradarserver/standing-data/tar.gz/refs/heads/main';
export const VRS_REFRESH_MS = 24 * 3600 * 1000;
export const VRS_SOURCE = 'vradarserver/standing-data';
export const VRS_ATTRIBUTION = 'Trasy: Virtual Radar Server standing-data (CC0)';
const CALLSIGN_RE = /^[A-Z]{3}[0-9][0-9A-Z]{0,4}$/;
/**
 * Úseky, ktoré polohe sedia „rovnako dobre" (obchádzka do toľkých km od najlepšieho), rozhodne kurz
 * (2026-10-15, pickLeg). 2026-10-16 zúžené z 50 km: pri 50 km kurz prehadzoval bežné trasy A-B-C okolo
 * medzipristátia — lietadlo pred pristátím v Charlotte s kurzom od letiska (po vetre, vektorovanie) dostalo
 * CLT → FRA namiesto LAX → CLT (skutočná databáza: 19 % polôh v kruhu 10–60 km okolo medzipristátia
 * zmenilo úsek). Okružná trasa A-B-A potrebuje len zhodu, tú má bit po bite (pozri VRS_LEG_TERMINAL_KM).
 */
export const VRS_LEG_TIE_KM = 5;
/**
 * V okolí letiska, kde sa dva susedné úseky stretávajú (priblíženie, vyčkávanie, odlet — ako
 * ESTIMATE_LANDING_NEAR_KM v odhadoch), kurz medzi nimi nerozhoduje: lietadlo tam manévruje a kurz
 * o úseku nič nehovorí (2026-10-16). Výnimka: obrátený úsek (A→B a B→A) — tam poloha nerozlíši nič
 * a kurz je jediná informácia (spätný test na skutočnej databáze: s výnimkou pre koncovú oblasť aj pri
 * obrátenom úseku by správny úsek okružných trás klesol z 99,7 % na 89,2 % — odlety z obratiska).
 */
export const VRS_LEG_TERMINAL_KM = 60;

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;
function gcKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Počiatočný azimut z bodu 1 do bodu 2, 0–360°. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Prejdi súbory v tar archíve (ustar, aj s pax hlavičkami GitHubu). Pure nad bufferom.
 * @param {Buffer} buf rozbalený tar
 * @param {(name: string, data: Buffer) => void} onFile
 */
export function walkTar(buf, onFile) {
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8) || 0;
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = paxPath || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const dataStart = offset + 512;
    const data = buf.subarray(dataStart, dataStart + size);
    if (type === 'x') {
      const m = /\d+ path=([^\n]+)\n/.exec(data.toString('utf8'));
      paxPath = m ? m[1] : null;
    } else {
      if (type === '0' || type === '') onFile(name, data);
      if (type !== 'g') paxPath = null;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
}

function csvRows(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const head = (lines.shift() || '').split(',');
  const rows = [];
  for (const line of lines) {
    if (!line) continue;
    // Názvy letísk môžu mať čiarky v úvodzovkách.
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; }
      else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const row = {};
    head.forEach((h, i) => { row[h.trim()] = (cells[i] ?? '').trim(); });
    rows.push(row);
  }
  return rows;
}

/**
 * Z rozbaleného tar archívu postav databázu: callsign → kódy letísk, kód → letisko. Pure.
 * @returns {{ routes: Map<string,string>, airports: Map<string,object> }}
 */
export function buildVrsDb(tarBuf) {
  const routes = new Map();
  const airports = new Map();
  walkTar(tarBuf, (name, data) => {
    if (!name.endsWith('.csv')) return;
    if (/\/routes\/schema-01\//.test(name)) {
      for (const row of csvRows(data.toString('utf8'))) {
        const cs = String(row.Callsign || '').toUpperCase();
        const codes = String(row.AirportCodes || '').toUpperCase();
        if (cs && /^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/.test(codes)) routes.set(cs, codes);
      }
    } else if (/\/airports\/schema-01\//.test(name)) {
      for (const row of csvRows(data.toString('utf8'))) {
        const lat = Number(row.Latitude);
        const lon = Number(row.Longitude);
        const code = String(row.Code || row.ICAO || '').toUpperCase();
        if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        airports.set(code, {
          code: row.IATA || row.ICAO || code,
          icao: /^[A-Z0-9]{4}$/.test(row.ICAO || '') ? row.ICAO.toUpperCase() : (/^[A-Z0-9]{4}$/.test(code) ? code : null),
          name: row.Location || row.Name || '',
          lat,
          lon,
          country: /^[A-Z]{2}$/.test(row.CountryISO2 || '') ? row.CountryISO2 : null,
        });
      }
    }
  });
  return { routes, airports };
}

/**
 * Úsek trasy, na ktorom lietadlo je (pri medzipristátí A-B-C): najmenšia obchádzka
 * |A→poloha| + |poloha→B| − |A→B|. Bez polohy prvý úsek. Pure.
 *
 * Kurz (2026-10-15): pri okružnej trase A-B-A majú oba úseky bit po bite rovnakú obchádzku a vyhrával
 * vždy prvý — lietadlo na spiatočnom úseku dostalo cieľ za chvostom (VRS: ~7 500 takých znakov, napr.
 * AAL1305 KORD-CYVR-KORD; odhad potom letel bez cieľa a po hodine zmizol, karta ukázala obrátenú trasu).
 * Z úsekov, ktoré polohe sedia rovnako dobre (legsTie), má prednosť ten, ktorého cieľ je pred lietadlom
 * (azimut k cieľu do 90° od kurzu). Kurz rozhoduje len medzi takými úsekmi — vzdialený úsek „pred nosom"
 * polohu neprebije. Bez kurzu ostáva doterajšie správanie.
 * @param {object[]} stops pole letísk v poradí
 * @param {{lat:number, lon:number, trkDeg?:number|null}|null} at poloha a kurz lietadla (fix odhadu má trkDeg)
 */
export function pickLeg(stops, at) {
  if (stops.length < 2) return null;
  if (stops.length === 2 || !at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) return [stops[0], stops[1]];
  const detours = [];
  let best = 0;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    detours.push(gcKm(a.lat, a.lon, at.lat, at.lon) + gcKm(at.lat, at.lon, b.lat, b.lon) - gcKm(a.lat, a.lon, b.lat, b.lon));
    if (detours[i] < detours[best]) best = i;
  }
  const trk = Number(at.trkDeg);
  if (at.trkDeg == null || !Number.isFinite(trk)) return [stops[best], stops[best + 1]];
  let ahead = -1;
  for (let i = 0; i < detours.length; i += 1) {
    if (i !== best && !legsTie(stops, detours, best, i, at)) continue;
    const b = stops[i + 1];
    const off = Math.abs(((bearingDeg(at.lat, at.lon, b.lat, b.lon) - trk) % 360 + 540) % 360 - 180);
    if (off < 90 && (ahead < 0 || detours[i] < detours[ahead])) ahead = i;
  }
  const pick = ahead >= 0 ? ahead : best;
  return [stops[pick], stops[pick + 1]];
}

const sameStop = (a, b) => a === b || (a.lat === b.lat && a.lon === b.lon);

/**
 * Smie kurz rozhodnúť medzi najlepším úsekom `best` a úsekom `i` (2026-10-16)? Áno pre obrátený úsek
 * (A→B a B→A: obchádzka bit po bite rovnaká, poloha nerozlíši nič — aj pri obratisku). Inak len keď sa
 * obchádzky líšia najviac o VRS_LEG_TIE_KM a lietadlo nie je v okolí letiska, kde sa susedné úseky
 * stretávajú (VRS_LEG_TERMINAL_KM) — bežná trasa A-B-C pri medzipristátí ostáva podľa polohy.
 */
function legsTie(stops, detours, best, i, at) {
  if (sameStop(stops[i], stops[best + 1]) && sameStop(stops[i + 1], stops[best])) return true;
  if (detours[i] > detours[best] + VRS_LEG_TIE_KM) return false;
  if (Math.abs(i - best) !== 1) return true;
  const shared = stops[Math.max(i, best)];
  return gcKm(at.lat, at.lon, shared.lat, shared.lon) >= VRS_LEG_TERMINAL_KM;
}

/**
 * Trasa v tvare ako parseRoute z adsbdb (origin/destination s code, icao, name, lat, lon, country). Pure.
 * @param {{routes: {get: Function}, airports: {get: Function}}} db Map z buildVrsDb alebo zbalená (unpackVrsDb)
 * @param {string} callsign
 * @param {{lat:number, lon:number, trkDeg?:number|null}|null} [at] poloha a kurz lietadla (výber úseku)
 */
export function vrsRouteFor(db, callsign, at = null) {
  const cs = String(callsign || '').trim().toUpperCase();
  if (!db || !CALLSIGN_RE.test(cs)) return null;
  const codes = db.routes.get(cs);
  if (!codes) return null;
  const stops = codes.split('-').map((c) => db.airports.get(c)).filter(Boolean);
  if (stops.length !== codes.split('-').length) return null; // neznáme letisko = radšej nič
  const leg = pickLeg(stops, at);
  if (!leg || leg[0] === leg[1]) return null;
  return {
    airline: null,
    airlineIcao: cs.slice(0, 3),
    airlineIata: null,
    callsignIata: null,
    origin: { ...leg[0] },
    destination: { ...leg[1] },
    source: 'vrs',
  };
}

/**
 * Poloha a kurz lietadla z `?lat=&lon=&trk=` (/api/adsbdb/route) na výber úseku letu. Pure.
 * Chýbajúci alebo prázdny parameter nie je 0 (2026-10-15): Number(null) === 0 a dopyt bez polohy
 * (starší klient, iný volajúci) vyberal úsek podľa bodu 0,0 v Guinejskom zálive — pri ~14 tis. trasách
 * s medzipristátím iný než prvý (AAL704D KLAX-KCLT-EDDF nad Kaliforniou dostal KCLT→EDDF).
 * @param {URLSearchParams} q
 * @returns {{lat:number, lon:number, trkDeg:number|null}|null} null = bez polohy (prvý úsek)
 */
export function routeHintFromQuery(q) {
  const num = (name) => {
    const raw = q?.get?.(name);
    return raw == null || String(raw).trim() === '' ? NaN : Number(raw);
  };
  const lat = num('lat');
  const lon = num('lon');
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const trk = num('trk');
  return { lat, lon, trkDeg: Number.isFinite(trk) ? ((trk % 360) + 360) % 360 : null };
}

/**
 * Odpoveď /api/adsbdb/route, keď trasu pozná VRS (má prednosť od 2026-10-14). Pure.
 * adsbdb dopĺňa dopravcu a IATA číslo letu. Keď je adsbdb práve zablokovaný alebo nedostupný
 * (`limited`), odpoveď je NEÚPLNÁ (`partial: true`, 2026-10-15) — klient trasu ukáže, ale o dopravcu
 * a číslo letu sa spýta znova neskôr. Predtým takú odpoveď uložil ako konečnú a karta do konca
 * relácie ostala bez dopravcu aj IATA čísla, hoci adsbdb sa o minútu spamätal.
 * @param {{origin: object, destination: object}} vrs trasa z vrsRouteFor
 * @param {object|null} adsbdb parseRoute z adsbdb (null = adsbdb znak nepozná)
 * @param {{limited?: boolean}} [o]
 */
export function vrsRouteAnswer(vrs, adsbdb, { limited = false } = {}) {
  const extra = !limited && adsbdb ? adsbdb : {};
  const out = { found: true, ...extra, origin: vrs.origin, destination: vrs.destination, routeSource: 'vrs' };
  if (limited) out.partial = true;
  return out;
}

/**
 * Odpoveď /api/adsbdb/route, keď trasu VRS nedal (2026-10-16). Pure.
 * Kým sa databáza VRS po štarte služby ešte načítava (`vrsPending`, vo vlákne ~5–10 s, pri vyťaženom
 * štarte dlhšie), je odpoveď len z adsbdb NEÚPLNÁ: VRS má prednosť (cieľ v 92 % vs. 80 %) a vie vybrať
 * úsek letu s medzipristátím. Predtým (synchrónne načítanie pred listen) také okno nebolo; bez značky by
 * karta otvorená hneď po vydaní uložila trasu len z adsbdb (alebo „nenájdené") ako konečnú do konca relácie.
 * @param {object|null} adsbdb parseRoute z adsbdb (null = adsbdb znak nepozná)
 * @param {{vrsPending?: boolean}} [o]
 */
export function adsbdbRouteAnswer(adsbdb, { vrsPending = false } = {}) {
  const out = adsbdb ? { found: true, ...adsbdb } : { found: false };
  if (vrsPending) out.partial = true;
  return out;
}

const AIRPORT_CODE_RE = /^[A-Z0-9]{4}$/;
const ROUTE_KEY_BYTES = 8; // CALLSIGN_RE: najviac 8 znakov ASCII
const AIRPORT_KEY_BYTES = 4; // trasa odkazuje len na 4-znakové kódy

/** Index kľúča v zoradenom poli kľúčov pevnej šírky (doplnené nulami), inak -1. Bez alokácie. */
function findPackedKey(keys, width, key) {
  if (key.length > width) return -1;
  let lo = 0;
  let hi = keys.length / width - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    let cmp = 0;
    for (let j = 0; j < width && cmp === 0; j += 1) cmp = (j < key.length ? key.charCodeAt(j) : 0) - keys[mid * width + j];
    if (cmp === 0) return mid;
    if (cmp < 0) hi = mid - 1; else lo = mid + 1;
  }
  return -1;
}

function packKeys(sortedKeys, width) {
  const out = new Uint8Array(sortedKeys.length * width);
  sortedKeys.forEach((k, i) => { for (let j = 0; j < k.length; j += 1) out[i * width + j] = k.charCodeAt(j); });
  return out;
}

function packTexts(texts) {
  const parts = texts.map((t) => Buffer.from(t, 'utf8'));
  const offsets = new Uint32Array(parts.length + 1);
  let total = 0;
  parts.forEach((p, i) => { offsets[i] = total; total += p.length; });
  offsets[parts.length] = total;
  const blob = new Uint8Array(total);
  parts.forEach((p, i) => blob.set(p, offsets[i]));
  return { offsets, blob };
}

/**
 * Databáza z buildVrsDb zbalená do typovaných polí (2026-10-15) — tie sa z vlákna PRENESÚ bez kopírovania.
 * Prečo nie Map: prevzatie Map so 620 tis. trasami (structured clone) stálo hlavné vlákno 2–4 s, rovnako
 * ako samotné spracovanie. Zbalené: zoradené kľúče pevnej šírky (binárne hľadanie) + text s posunmi,
 * ~15 MB mimo haldy namiesto ~73 MB v halde. Len kľúče, ktoré sa dajú hľadať (CALLSIGN_RE, 4-znakové letiská).
 * @param {{routes: Map<string,string>, airports: Map<string,object>}} db
 */
export function packVrsDb({ routes, airports }) {
  const rKeys = [...routes.keys()].filter((k) => CALLSIGN_RE.test(k)).sort();
  const r = packTexts(rKeys.map((k) => routes.get(k)));
  const aKeys = [...airports.keys()].filter((k) => AIRPORT_CODE_RE.test(k)).sort();
  const latLon = new Float64Array(aKeys.length * 2);
  const a = packTexts(aKeys.map((k, i) => {
    const ap = airports.get(k);
    latLon[i * 2] = ap.lat;
    latLon[i * 2 + 1] = ap.lon;
    return [ap.code, ap.icao || '', ap.name, ap.country || ''].map((s) => String(s ?? '').replace(/\t/g, ' ')).join('\t');
  }));
  return {
    routeKeys: packKeys(rKeys, ROUTE_KEY_BYTES), routeOffsets: r.offsets, routeCodes: r.blob,
    airportKeys: packKeys(aKeys, AIRPORT_KEY_BYTES), airportLatLon: latLon, airportOffsets: a.offsets, airportText: a.blob,
  };
}

/** Polia zbalenej databázy na prenos (transferList). */
export function packedVrsBuffers(packed) {
  return Object.values(packed).map((arr) => arr.buffer);
}

/**
 * Zbalená databáza s rozhraním ako Map (get, size) pre vrsRouteFor. Nič sa nestavia vopred —
 * letisko sa rozbalí pri prvom hľadaní a ďalej je ten istý objekt (ako z Map).
 */
export function unpackVrsDb(packed) {
  const { routeKeys, routeOffsets, routeCodes, airportKeys, airportLatLon, airportOffsets, airportText } = packed;
  const codes = Buffer.from(routeCodes.buffer, routeCodes.byteOffset, routeCodes.byteLength);
  const text = Buffer.from(airportText.buffer, airportText.byteOffset, airportText.byteLength);
  const airportCache = new Map();
  return {
    routes: {
      size: routeOffsets.length - 1,
      get(cs) {
        const i = findPackedKey(routeKeys, ROUTE_KEY_BYTES, String(cs));
        return i < 0 ? undefined : codes.toString('latin1', routeOffsets[i], routeOffsets[i + 1]);
      },
    },
    airports: {
      size: airportOffsets.length - 1,
      get(code) {
        const key = String(code);
        const cached = airportCache.get(key);
        if (cached) return cached;
        const i = findPackedKey(airportKeys, AIRPORT_KEY_BYTES, key);
        if (i < 0) return undefined;
        const [c, icao, name, country] = text.toString('utf8', airportOffsets[i], airportOffsets[i + 1]).split('\t');
        const airport = { code: c, icao: icao || null, name, lat: airportLatLon[i * 2], lon: airportLatLon[i * 2 + 1], country: country || null };
        airportCache.set(key, airport);
        return airport;
      },
    },
  };
}

/**
 * Rozbalenie a spracovanie archívu (gunzip + buildVrsDb) vo vlákne Workera (2026-10-15).
 * Prečo: ~26 MB tar so 620 tis. trasami sa v hlavnom vlákne spracúval ~3 s a denná obnova tak
 * zastavila celé verejné API (log služby: „vlákno blokované 1 269–2 353 ms" hneď po „stiahnuté").
 * Vlákno vráti zbalenú databázu (packVrsDb) prenosom bez kopírovania — hlavné vlákno nič nestavia.
 *
 * Výsledok ide cez vlastný MessageChannel (2026-10-16): časový limit meria hodiny hlavného vlákna, a keď
 * hlavné vlákno viselo dlhšie než limit (služba po štarte 2026-10-16: blok 231 s), prošlý časovač príde
 * na rad skôr než správa vlákna (fáza časovačov ide pred fázou poll) — hotová databáza by sa zahodila.
 * Pred zamietnutím sa preto hotová správa vyberie z portu synchrónne (receiveMessageOnPort). Rovnako pri
 * 'exit': skončenie vlákna môže prísť skôr než správa z vlastného portu.
 * @param {Uint8Array} gz tar.gz (kopíruje sa — volajúci ho ešte zapisuje na disk)
 * @param {{timeoutMs?: number}} [o]
 * @returns {Promise<ReturnType<typeof unpackVrsDb>>} chyba dát má code 'VRS_PARSE', časový limit 'VRS_TIMEOUT'
 */
export function parseVrsArchiveInWorker(gz, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    let worker;
    try {
      worker = new Worker(new URL('./vrsRoutesWorker.js', import.meta.url), { workerData: { gz, port: port2 }, transferList: [port2] });
    } catch (error) { port1.close(); reject(error); return; }
    let done = false;
    let timer = null;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); port1.close(); void worker.terminate(); fn(value); };
    const onResult = (msg) => {
      if (msg?.ok) { finish(resolve, unpackVrsDb(msg.packed)); return; }
      // Chyba dát (poškodený archív), nie vlákna — v hlavnom vlákne by dopadla rovnako.
      finish(reject, Object.assign(new Error(msg?.error || 'vlákno VRS zlyhalo'), { code: 'VRS_PARSE' }));
    };
    /** Hotová správa, ktorá ešte čaká vo fronte portu (hlavné vlákno ju zatiaľ nestihlo prevziať). */
    const takeQueued = () => {
      const queued = receiveMessageOnPort(port1);
      if (queued) onResult(queued.message);
      return Boolean(queued);
    };
    timer = setTimeout(() => {
      if (takeQueued()) return;
      finish(reject, Object.assign(new Error('vlákno VRS: časový limit'), { code: 'VRS_TIMEOUT' }));
    }, timeoutMs);
    timer.unref?.();
    port1.once('message', onResult);
    worker.once('error', (error) => { if (!takeQueued()) finish(reject, error); });
    worker.once('exit', (code) => { if (!takeQueued()) finish(reject, new Error(`vlákno VRS skončilo (${code})`)); });
  });
}

/** Spracovanie v tomto vlákne — záloha, keď sa vlákno nedá spustiť (aj testy). */
export function parseVrsArchive(gz) {
  return buildVrsDb(zlib.gunzipSync(gz));
}

/**
 * Databáza trás so sťahovaním raz denne a kópiou na disku.
 * @param {object} [o]
 * @param {typeof fetch} [o.fetchImpl]
 * @param {string|null} [o.cacheFile] kam uložiť tar.gz (+ .json s ETagom)
 * @param {() => number} [o.now]
 * @param {(msg: string) => void} [o.log]
 * @param {() => void} [o.onLoaded] po načítaní / obnovení databázy
 * @param {(gz: Uint8Array) => Promise<{routes: {get: Function, size: number}, airports: {get: Function, size: number}}>} [o.parse] spracovanie archívu
 *   (predvolene vo vlákne Workera, 2026-10-15)
 */
export function createVrsRouteDb({ fetchImpl = globalThis.fetch, cacheFile = null, now = () => Date.now(), log = () => {}, onLoaded = () => {}, parse = parseVrsArchiveInWorker } = {}) {
  let db = null;
  let loadedAt = 0;
  let etag = null;
  let lastError = null;
  let lastCheckAt = 0;
  let timer = null;
  let lookups = 0;
  let hits = 0;
  let starting = false;

  /**
   * @param {Uint8Array} gz
   * @param {boolean} mainThreadFallback smie sa pri zlyhaní vlákna archív spracovať v hlavnom vlákne?
   */
  async function parseGz(gz, mainThreadFallback) {
    try {
      return await parse(gz);
    } catch (error) {
      // Záloha v hlavnom vlákne NIE (2026-10-16): pri chybe dát (dopadla by rovnako), pri časovom limite
      // (vlákno je pomalé, lebo stroj je vyťažený — ~3 s v hlavnom vlákne by API zastavili ešte dlhšie)
      // a pri štarte služby (hlavné vlákno je vtedy najvyťaženejšie: 2026-10-16 ready po 209 s, blok 231 s).
      if (parse === parseVrsArchive || !mainThreadFallback || error?.code === 'VRS_PARSE' || error?.code === 'VRS_TIMEOUT') throw error;
      // Vlákno sa nedalo spustiť alebo spadlo: radšej raz za deň ~3 s v hlavnom vlákne než odhady bez cieľa.
      log(`[vrs-routes] vlákno zlyhalo (${error?.message || error}), spracúvam v hlavnom vlákne`);
      return parseVrsArchive(gz);
    }
  }

  async function load(gz, source, { mainThreadFallback = false } = {}) {
    const next = await parseGz(gz, mainThreadFallback);
    if (next.routes.size < 1000 || next.airports.size < 1000) throw new Error(`malá databáza (${next.routes.size} trás, ${next.airports.size} letísk)`);
    db = next;
    loadedAt = now();
    log(`[vrs-routes] ${source}: ${db.routes.size} trás, ${db.airports.size} letísk`);
    try { onLoaded(); } catch { /* volajúci */ }
  }

  async function loadFromDisk() {
    if (!cacheFile) return false;
    try {
      const gz = await fs.promises.readFile(cacheFile);
      const meta = JSON.parse(await fs.promises.readFile(`${cacheFile}.json`, 'utf8'));
      etag = meta.etag || null;
      await load(gz, 'disk');
      loadedAt = Number(meta.at) || loadedAt;
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`[vrs-routes] kópia z disku sa nenačítala: ${error?.message || error}`);
      return false;
    }
  }

  /**
   * @param {{mainThreadFallback?: boolean}} [o] záloha v hlavnom vlákne pri zlyhaní vlákna (pri štarte nie)
   */
  async function refresh({ mainThreadFallback = true } = {}) {
    lastCheckAt = now();
    try {
      const headers = etag && db ? { 'If-None-Match': etag } : {};
      const res = await fetchImpl(VRS_ROUTES_URL, { headers, signal: AbortSignal.timeout(60_000) });
      if (res.status === 304) { loadedAt = now(); lastError = null; return 'unchanged'; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gz = Buffer.from(await res.arrayBuffer());
      await load(gz, 'stiahnuté', { mainThreadFallback });
      etag = res.headers?.get?.('etag') || null;
      lastError = null;
      if (cacheFile) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          const tmp = `${cacheFile}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, gz);
          fs.renameSync(tmp, cacheFile);
          fs.writeFileSync(`${cacheFile}.json`, JSON.stringify({ at: loadedAt, etag }));
        } catch (error) { log(`[vrs-routes] zápis na disk zlyhal: ${error.message}`); }
      }
      return 'updated';
    } catch (error) {
      lastError = String(error?.message || error);
      log(`[vrs-routes] obnova zlyhala: ${lastError}`);
      return 'error';
    }
  }

  return {
    lookup(callsign, at = null) {
      if (!db) return null;
      lookups += 1;
      const route = vrsRouteFor(db, callsign, at);
      if (route) hits += 1;
      return route;
    },
    ready: () => Boolean(db),
    /**
     * Databáza sa práve prvý raz načítava (2026-10-16): odpoveď bez VRS je dočasná. Kým je to tak,
     * /api/adsbdb/route označí odpoveď len z adsbdb ako neúplnú (adsbdbRouteAnswer) a karta sa spýta znova.
     * Keď prvé načítanie zlyhá, pending je false — VRS nie je, odpovede adsbdb sú konečné ako predtým.
     */
    pending: () => !db && starting,
    refresh,
    start() {
      timer = setInterval(() => { if (now() - loadedAt > VRS_REFRESH_MS) void refresh(); }, 3600 * 1000);
      timer.unref?.();
      starting = true;
      // Kópia z disku sa spracúva tiež vo vlákne (2026-10-15) — štart servera na ňu nečaká. Kým nie je
      // hotová, lookup vráti null (adsbdb ostáva záloha, odhady dostanú cieľ cez onLoaded). Pri štarte
      // ani pri zlyhaní vlákna nič v hlavnom vlákne (2026-10-16) — skúsi to hodinový časovač.
      return loadFromDisk().then((fromDisk) => {
        if (!timer) return null; // medzitým stop()
        return !fromDisk || now() - loadedAt > VRS_REFRESH_MS ? refresh({ mainThreadFallback: false }) : null;
      }).finally(() => { starting = false; });
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    status: () => ({
      ready: Boolean(db), pending: !db && starting, routes: db?.routes.size || 0, airports: db?.airports.size || 0,
      loadedAt, lastCheckAt, lastError, lookups, hits,
    }),
    _setDbForTest(next) { db = next; },
  };
}
