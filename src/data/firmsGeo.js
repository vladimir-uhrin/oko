/**
 * Geostacionárne detekcie požiarov FIRMS (zdroj GOES_NRT) — čisté funkcie (2026-10-06).
 *
 * Zdroj `GOES_NRT` v FIRMS nie sú len GOES: v jednom CSV sú GOES-18/19 (Amerika),
 * Himawari-9 (Ázia, Austrália) a Meteosat-9/10/12 (Európa, Afrika, Indický oceán) —
 * overené živo 2026-10-06 (Met12 nad Slovenskom). Snímajú každých 10–15 min, takže
 * jedno ohnisko sa v CSV opakuje desiatky ráz za deň (234 841 riadkov za deň vs.
 * ~40 000 VIIRS). Preto:
 *  - berie sa len posledné okno (3 h) — „čo horí práve teraz“;
 *  - opakované detekcie toho istého miesta sa zlúčia do jednej (mriežka 0,02°,
 *    posledný čas, najvyššie FRP, počet opakovaní);
 *  - detekcia do 4 km od VIIRS ohniska sa k nemu PRIPOJÍ ako potvrdenie
 *    (`geoSeenMs`, `geoSat`), inak ostane ako samostatné ohnisko s `geo: true`.
 * Rozlíšenie je hrubé (2–4 km), poloha je stred pixla; VIIRS (375 m) ho spresní.
 *
 * Kvírky CSV: Met12 (MTG) hlási confidence 0..1 a scan/track 0, ostatné 0..100;
 * `instrument` je prázdny; `satellite` nesie prípony (G19FRP).
 */
import { acquisitionMsUtc } from './firmsCsv.js';

/** Okno geostacionárnych detekcií (ms): staršie sú už vo VIIRS. */
export const GEO_WINDOW_MS = 3 * 3600_000;
/** Mriežka zlučovania opakovaných detekcií (°) ≈ 2 km. */
export const GEO_COLLAPSE_DEG = 0.02;
/** Do tejto vzdialenosti od VIIRS ohniska je geo detekcia jeho potvrdením (km). */
export const GEO_ATTACH_KM = 4;

/** Kód družice v CSV → celé meno (pure). */
export function geoSatelliteName(code) {
  const s = String(code || '').trim().toUpperCase().replace(/FRP$/, '');
  const m = /^(G|MET|HIM)(\d+)$/.exec(s);
  if (!m) return s;
  if (m[1] === 'G') return `GOES-${m[2]}`;
  if (m[1] === 'HIM') return `Himawari-${m[2]}`;
  return `Meteosat-${m[2]}`;
}

/** Spoľahlivosť 0..100 alebo 0..1 (Met12) → 0..1 (pure). */
export function geoConfidence01(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(1, n > 1 ? n / 100 : n);
}

/**
 * Zlúči surové riadky GOES_NRT (tvar firmsCsv.parseFirmsCsv) do jednej detekcie na miesto.
 * @param {Array<object>} records
 * @param {number} nowMs
 * @param {number} [windowMs]
 * @returns {Array<{lat:number, lon:number, frp:number, confidence:number, brightness:number,
 *   daynight:string, acqMs:number, acqDate:string, acqTime:string, satellite:string, repeats:number, geo:true}>}
 */
export function collapseGeoDetections(records, nowMs, windowMs = GEO_WINDOW_MS) {
  const cells = new Map();
  if (!Array.isArray(records)) return [];
  // Okno sa počíta od NAJNOVŠEJ dostupnej detekcie, nie od „teraz“: FIRMS dodáva GOES_NRT
  // s oneskorením ~3,5 h (zmerané 2026-10-06) — okno od „teraz“ by zdroj vyprázdnilo.
  const times = new Map();
  let newest = -Infinity;
  for (const r of records) {
    const key = `${r.acqDate}:${r.acqTime}`;
    let ms = times.get(key);
    if (ms === undefined) { ms = acquisitionMsUtc(r.acqDate, r.acqTime); times.set(key, ms); }
    if (Number.isFinite(ms) && ms <= nowMs + 2 * 3600_000 && ms > newest) newest = ms;
  }
  if (!Number.isFinite(newest)) return [];
  const oldest = newest - windowMs;
  for (const r of records) {
    const acqMs = times.get(`${r.acqDate}:${r.acqTime}`);
    if (!Number.isFinite(acqMs) || acqMs < oldest || acqMs - nowMs > 2 * 3600_000) continue;
    const key = `${Math.round(r.lat / GEO_COLLAPSE_DEG)}:${Math.round(r.lon / GEO_COLLAPSE_DEG)}`;
    const frp = Number.isFinite(r.frp) ? r.frp : 0;
    const existing = cells.get(key);
    if (!existing) {
      cells.set(key, {
        lat: r.lat, lon: r.lon, frp, confidence: geoConfidence01(r.confidence), brightness: r.brightness || 0,
        daynight: r.daynight || '', acqMs, acqDate: r.acqDate, acqTime: r.acqTime, satellite: r.satellite || '',
        repeats: 1, geo: true,
      });
      continue;
    }
    existing.repeats += 1;
    existing.frp = Math.max(existing.frp, frp);
    existing.confidence = Math.max(existing.confidence, geoConfidence01(r.confidence));
    if (acqMs > existing.acqMs) {
      Object.assign(existing, { lat: r.lat, lon: r.lon, acqMs, acqDate: r.acqDate, acqTime: r.acqTime, satellite: r.satellite || existing.satellite, daynight: r.daynight || existing.daynight });
    }
  }
  return [...cells.values()];
}

/** Rýchla vzdialenosť v km (ekvirektangulárne — na 4 km stačí). */
function fastKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * 111.32;
  const dLon = (lon2 - lon1) * 111.32 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Pripojí geo detekcie k najbližším VIIRS/MODIS ohniskám (do GEO_ATTACH_KM) ako potvrdenie
 * (`geoSeenMs`, `geoSat`, `geoFrp`); nepriradené pridá ako samostatné ohniská. Vstupné
 * ohniská sa upravujú na mieste (ide o riadky, ktoré proxy aj tak serializuje).
 * @param {Array<object>} fires VIIRS/MODIS riadky (firmsCsv shape; acqDate/acqTime)
 * @param {Array<object>} geo výsledok collapseGeoDetections
 * @returns {{attached: number, standalone: number, fires: Array<object>}}
 */
export function mergeGeoIntoFires(fires, geo) {
  const cell = GEO_ATTACH_KM / 111.32 * 1.5;
  const index = new Map();
  for (const f of fires) {
    const key = `${Math.floor(f.lat / cell)}:${Math.floor(f.lon / cell)}`;
    let list = index.get(key);
    if (!list) { list = []; index.set(key, list); }
    list.push(f);
  }
  let attached = 0;
  const standalone = [];
  for (const g of geo) {
    const ci = Math.floor(g.lat / cell);
    const cj = Math.floor(g.lon / cell);
    let best = null;
    let bestKm = GEO_ATTACH_KM;
    for (let i = ci - 1; i <= ci + 1; i += 1) {
      for (let j = cj - 1; j <= cj + 1; j += 1) {
        const list = index.get(`${i}:${j}`);
        if (!list) continue;
        for (const f of list) {
          const km = fastKm(g.lat, g.lon, f.lat, f.lon);
          if (km < bestKm) { bestKm = km; best = f; }
        }
      }
    }
    if (best) {
      if (!(best.geoSeenMs > g.acqMs)) {
        best.geoSeenMs = g.acqMs;
        best.geoSat = g.satellite;
        best.geoFrp = g.frp;
      }
      attached += 1;
    } else {
      standalone.push(g);
    }
  }
  return { attached, standalone: standalone.length, fires: fires.concat(standalone) };
}
