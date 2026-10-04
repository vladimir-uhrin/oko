// src/data/flightEstimate.js — odhadovaná poloha lietadla bez signálu (2026-10-04).
//
// Vlastník: „prepracovať hluché miesta cez oceány, kde nie je signál — približná poloha
// lietadla" + „aj všade, kde to chýba". Schválené E1 + E2, bez známeho cieľa najviac 2 hodiny.
//
// Pravidlá (žiadne vymýšľanie letov, ktoré skončili):
//  - odhad dostane len lietadlo, ktoré zmizlo VO VZDUCHU: nie na zemi, aspoň ESTIMATE_MIN_ALT_M
//    a ESTIMATE_MIN_SPEED_MPS, a nie pri cieli (pristávanie zmizne ako doteraz);
//  - so známym a overeným cieľom (routePlausible) letí po veľkej kružnici k cieľu poslednou
//    rýchlosťou; pri cieli odhad končí („pravdepodobne pristálo"), strop ESTIMATE_ROUTE_MAX_S;
//  - bez cieľa letí v poslednom smere najviac ESTIMATE_NO_ROUTE_MAX_S (2 h, rozhodnutie vlastníka);
//  - neistota rastie so vzdialenosťou od posledného fixu (kruh na mape, text na karte);
//  - odhad sa NIKDY neukladá do histórie letov (zapisuje sa len skutočný snímok OpenSky).
//
// Čisté funkcie + sledovač pre server (createEstimateTracker), testy bez Cesia.

import { greatCircleKm, routePlausible } from './routePlausible.js';

export const ESTIMATE_MIN_ALT_M = 3000;
export const ESTIMATE_MIN_SPEED_MPS = 90;
export const ESTIMATE_NO_ROUTE_MAX_S = 2 * 3600;
export const ESTIMATE_ROUTE_MAX_S = 14 * 3600;
/** Bližšie k cieľu = pristáva, nie odlietava do diery. */
export const ESTIMATE_LANDING_NEAR_KM = 60;
/** Posledných toľko km pred cieľom odhad klesá (len pre farbu a výšku na karte). */
export const ESTIMATE_DESCENT_KM = 200;
/** Lietadlo musí v snímkoch chýbať aspoň toľko, aby bolo „bez signálu". */
export const ESTIMATE_MISSING_AFTER_S = 120;
const EARTH_RADIUS_KM = 6371.0088;
const D2R = Math.PI / 180;

/** Posledný fix z riadku OpenSky (pure); null bez polohy. */
export function fixFromState(state, snapshotSec) {
  if (!Array.isArray(state)) return null;
  const lon = Number(state[5]);
  const lat = Number(state[6]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tSec = Number.isFinite(Number(state[3])) && Number(state[3]) > 0 ? Number(state[3]) : Number(snapshotSec);
  const alt = Number.isFinite(Number(state[13])) ? Number(state[13]) : (Number.isFinite(Number(state[7])) ? Number(state[7]) : null);
  return {
    hex: String(state[0] || '').trim().toLowerCase(),
    cs: typeof state[1] === 'string' ? state[1].trim().toUpperCase() : '',
    tMs: Math.round(tSec * 1000),
    lat,
    lon,
    altM: alt,
    gsMps: Number.isFinite(Number(state[9])) ? Number(state[9]) : null,
    trkDeg: Number.isFinite(Number(state[10])) ? Number(state[10]) : null,
    vrMps: Number.isFinite(Number(state[11])) ? Number(state[11]) : null,
    onGround: state[8] === true,
    category: Number.isFinite(Number(state[17])) ? Number(state[17]) : null,
    country: typeof state[2] === 'string' ? state[2] : '',
  };
}

/** Smie lietadlo dostať odhad? (pure) */
export function qualifiesForEstimate(fix) {
  return Boolean(fix)
    && !fix.onGround
    && Number.isFinite(fix.altM) && fix.altM >= ESTIMATE_MIN_ALT_M
    && Number.isFinite(fix.gsMps) && fix.gsMps >= ESTIMATE_MIN_SPEED_MPS
    && Number.isFinite(fix.trkDeg);
}

/** Cieľ použiteľný pre odhad: súradnice, overená trasa a nie tesne pri cieli (pure). */
export function usableDestination(fix, route) {
  const d = route?.destination;
  if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return null;
  const plausible = routePlausible({
    latDeg: fix.lat, lonDeg: fix.lon, altitudeM: fix.altM, verticalRateMps: fix.vrMps, trackDeg: fix.trkDeg,
    onGround: false, origin: route.origin, destination: d,
  });
  return plausible ? d : null;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

/** Bod vo vzdialenosti `km` v smere `brgDeg` (veľká kružnica). */
function destinationPoint(lat, lon, brgDeg, km) {
  const d = km / EARTH_RADIUS_KM;
  const b = brgDeg * D2R;
  const p1 = lat * D2R;
  const l1 = lon * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / D2R, lon: ((((l2 / D2R) + 540) % 360) - 180) };
}

/** Neistota (km) po preletenej vzdialenosti bez signálu (pure): 5 km + 8 %. */
export function uncertaintyKm(distanceKm) {
  return 5 + 0.08 * Math.max(0, distanceKm);
}

/**
 * Odhad polohy v čase nowMs (pure).
 * @returns {{lat:number, lon:number, altM:number, trackDeg:number, gsMps:number, elapsedS:number,
 *   distanceKm:number, uncertaintyKm:number, method:'route'|'track', ended:boolean, reason:string|null,
 *   destination:object|null, remainingKm:number|null}}
 */
export function estimatePosition(fix, route, nowMs) {
  const elapsedS = Math.max(0, (nowMs - fix.tMs) / 1000);
  const gs = fix.gsMps;
  const flownKm = (gs * elapsedS) / 1000;
  const dest = usableDestination(fix, route);
  if (dest) {
    const totalKm = greatCircleKm(fix.lat, fix.lon, dest.lat, dest.lon);
    const remainingKm = Math.max(0, totalKm - flownKm);
    const ended = remainingKm <= 0 || elapsedS > ESTIMATE_ROUTE_MAX_S;
    const brg = bearingDeg(fix.lat, fix.lon, dest.lat, dest.lon);
    // Po veľkej kružnici k cieľu: posun o preletenú vzdialenosť pozdĺž počiatočného kurzu by sa
    // od kružnice odchyľoval — preto interpolácia medzi fixom a cieľom.
    const f = totalKm > 0 ? Math.min(1, flownKm / totalKm) : 1;
    const p = greatCircleInterpolate(fix.lat, fix.lon, dest.lat, dest.lon, f);
    const altM = remainingKm < ESTIMATE_DESCENT_KM ? fix.altM * (remainingKm / ESTIMATE_DESCENT_KM) : fix.altM;
    const track = f < 1 ? bearingDeg(p.lat, p.lon, dest.lat, dest.lon) : brg;
    return {
      lat: p.lat, lon: p.lon, altM, trackDeg: track, gsMps: gs, elapsedS, distanceKm: flownKm,
      uncertaintyKm: uncertaintyKm(flownKm), method: 'route', ended, reason: ended ? 'arrived' : null,
      destination: dest, remainingKm,
    };
  }
  const ended = elapsedS > ESTIMATE_NO_ROUTE_MAX_S;
  const p = destinationPoint(fix.lat, fix.lon, fix.trkDeg, flownKm);
  return {
    lat: p.lat, lon: p.lon, altM: fix.altM, trackDeg: fix.trkDeg, gsMps: gs, elapsedS, distanceKm: flownKm,
    uncertaintyKm: uncertaintyKm(flownKm), method: 'track', ended, reason: ended ? 'expired' : null,
    destination: null, remainingKm: null,
  };
}

function greatCircleInterpolate(lat1, lon1, lat2, lon2, f) {
  const p1 = lat1 * D2R;
  const l1 = lon1 * D2R;
  const p2 = lat2 * D2R;
  const l2 = lon2 * D2R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return { lat: lat1, lon: lon1 };
  const a = Math.sin((1 - f) * d) / Math.sin(d);
  const b = Math.sin(f * d) / Math.sin(d);
  const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
  const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
  const z = a * Math.sin(p1) + b * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / D2R, lon: Math.atan2(y, x) / D2R };
}

/** Je lietadlo pri cieli (pristáva)? (pure) */
export function nearDestination(fix, route) {
  const d = route?.destination;
  if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) return false;
  return greatCircleKm(fix.lat, fix.lon, d.lat, d.lon) < ESTIMATE_LANDING_NEAR_KM;
}

/** Volací znak dopravcu, pre ktorý má zmysel hľadať trasu (rovnaké pravidlo ako klient). */
export const ROUTE_CALLSIGN_RE = /^[A-Z]{3}\d[A-Z0-9]{0,4}$/;

/**
 * Sledovač pre server: z každého svetového snímku OpenSky si pamätá posledný fix každého lietadla;
 * kto zmizne vo vzduchu, ide do zoznamu odhadov (kým sa nevráti alebo odhad neskončí).
 * Trasa sa dohľadá cez lookupRoute(callsign) (adsbdb cache servera), radom, šetrne.
 * @param {{lookupRoute?: (cs: string) => Promise<object|null>, now?: () => number, maxEntries?: number}} [options]
 */
export function createEstimateTracker({ lookupRoute = null, now = () => Date.now(), maxEntries = 6000, lookupGapMs = 3000, maxQueue = 3000, cacheHitMs = 50 } = {}) {
  const last = new Map(); // hex → fix (videné v poslednom snímku)
  const estimates = new Map(); // hex → { fix, route, routeState }
  let lastSnapshotSec = 0;
  let lastCount = 0;
  let skipped = 0;
  const queue = [];
  let pumping = false;

  async function pump() {
    if (pumping || !lookupRoute) return;
    pumping = true;
    try {
      while (queue.length) {
        const hex = queue.shift();
        const entry = estimates.get(hex);
        if (!entry || entry.routeState !== 'queued') continue;
        const started = Date.now();
        try {
          entry.route = await lookupRoute(entry.fix.cs);
        } catch {
          entry.route = null;
        }
        entry.routeState = 'done';
        if (entry.route && nearDestination(entry.fix, entry.route)) estimates.delete(hex); // pristáva
        // Šetrné tempo len pre skutočný dopyt na adsbdb; odpoveď z cache servera (rýchla) nečaká.
        if (Date.now() - started >= cacheHitMs) await new Promise((r) => setTimeout(r, lookupGapMs));
      }
    } finally {
      pumping = false;
    }
  }

  return {
    /** Spracuj svetový snímok OpenSky (objekt { time, states }). Vráti počet nových odhadov. */
    ingest(body) {
      const states = Array.isArray(body?.states) ? body.states : null;
      const snapSec = Number(body?.time);
      if (!states || !Number.isFinite(snapSec) || snapSec <= lastSnapshotSec) return 0;
      // Výpadok zdroja / regionálna záloha: polovičný snímok by „zmizol" pol sveta.
      const partial = lastCount > 0 && states.length < lastCount * 0.6;
      lastSnapshotSec = snapSec;
      const present = new Set();
      for (const state of states) {
        const fix = fixFromState(state, snapSec);
        if (!fix || !fix.hex) continue;
        present.add(fix.hex);
        last.set(fix.hex, fix);
        estimates.delete(fix.hex); // signál je späť
      }
      if (partial) {
        skipped += 1;
        return 0;
      }
      lastCount = states.length;
      let added = 0;
      for (const [hex, fix] of last) {
        if (present.has(hex)) continue;
        const missingS = snapSec - fix.tMs / 1000;
        if (missingS < ESTIMATE_MISSING_AFTER_S) continue;
        last.delete(hex);
        if (!qualifiesForEstimate(fix) || estimates.size >= maxEntries) continue;
        // Šetrne k adsbdb (bezplatné API): najviac maxQueue čakajúcich; ostatné letia podľa smeru.
        const wantsRoute = Boolean(lookupRoute) && ROUTE_CALLSIGN_RE.test(fix.cs) && queue.length < maxQueue;
        estimates.set(hex, { fix, route: null, routeState: wantsRoute ? 'queued' : 'none' });
        if (wantsRoute) queue.push(hex);
        added += 1;
      }
      if (queue.length) void pump();
      return added;
    },

    /**
     * Naplň odhady zo záznamu histórie (posledné polohy letov) — po štarte servera, PRED prvým
     * snímkom: kto je v snímku živý, ten pri ingest() vypadne. Vráti počet pridaných.
     */
    seed(fixes, nowMs = now()) {
      let added = 0;
      for (const fix of Array.isArray(fixes) ? fixes : []) {
        if (!fix?.hex || estimates.has(fix.hex) || last.has(fix.hex) || estimates.size >= maxEntries) continue;
        if (!qualifiesForEstimate(fix)) continue;
        // Bez cieľa by aj tak skončil: neplniť, čo je staršie než strop letu bez cieľa a nedá sa dohľadať.
        const wantsRoute = Boolean(lookupRoute) && ROUTE_CALLSIGN_RE.test(fix.cs) && queue.length < maxQueue;
        if (!wantsRoute && nowMs - fix.tMs > ESTIMATE_NO_ROUTE_MAX_S * 1000) continue;
        estimates.set(fix.hex, { fix, route: null, routeState: wantsRoute ? 'queued' : 'none' });
        if (wantsRoute) queue.push(fix.hex);
        added += 1;
      }
      if (queue.length) void pump();
      return added;
    },

    /** Aktuálne odhady (skončené vyradí). Pre API: posledný fix + cieľ, polohu počíta klient. */
    list(nowMs = now()) {
      const out = [];
      for (const [hex, entry] of estimates) {
        const est = estimatePosition(entry.fix, entry.route, nowMs);
        if (est.ended) {
          estimates.delete(hex);
          continue;
        }
        const r = entry.route;
        out.push({
          ...entry.fix,
          route: r && est.method === 'route'
            ? { origin: pickAirport(r.origin), destination: pickAirport(r.destination), airline: r.airline ?? null, callsignIata: r.callsignIata ?? null }
            : null,
        });
      }
      return out;
    },

    status() {
      return { tracked: last.size, estimated: estimates.size, queue: queue.length, lastSnapshotSec, skippedPartial: skipped };
    },
  };
}

function pickAirport(a) {
  if (!a) return null;
  return { code: a.code || '', icao: a.icao || null, name: a.name || '', lat: a.lat ?? null, lon: a.lon ?? null, country: a.country ?? null };
}
