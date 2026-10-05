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
import { buildEstimatePath, natTrackFor, pointAlongPath } from './flightPath.js';
import { effectiveGroundSpeed } from './windAloft.js';

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



/** Neistota (km) po preletenej vzdialenosti bez signálu (pure): 5 km + 8 %. */
export function uncertaintyKm(distanceKm) {
  return 5 + 0.08 * Math.max(0, distanceKm);
}

/** Pásma času bez signálu pre meranie presnosti (min). */
export const ACCURACY_BUCKETS_MIN = Object.freeze([30, 60, 120, 240, Infinity]);
/** Najmenej meraní v pásme, aby sa kalibrácia použila namiesto modelu. */
export const CALIBRATION_MIN_SAMPLES = 20;

/**
 * Neistota s kalibráciou (pure): keď server nameral dosť návratov signálu v danom pásme času,
 * kruh = 80. percentil skutočnej chyby; inak model 5 km + 8 %. Nikdy menej než model pri malej
 * vzdialenosti (5 km).
 * @param {{maxMin:number, n:number, p80Km:number}[]|null} calibration
 */
export function calibratedUncertaintyKm(elapsedS, distanceKm, calibration = null) {
  const model = uncertaintyKm(distanceKm);
  if (!Array.isArray(calibration)) return model;
  const min = elapsedS / 60;
  const bucket = calibration.find((c) => min < (c.maxMin ?? Infinity));
  if (!bucket || !(bucket.n >= CALIBRATION_MIN_SAMPLES) || !Number.isFinite(bucket.p80Km)) return model;
  return Math.max(5, bucket.p80Km);
}

/**
 * Odhad polohy v čase nowMs (pure). Letí po trase odhadu (flightPath.js): trať NAT, ak ju server
 * priradil (model.path), inak po kružnici k overenému cieľu, inak v poslednom smere. Rýchlosť
 * podľa vetra vo výške letu (model.gsEffMps), inak posledná nameraná.
 * @param {object|null} [model] { path, toDestination, nat, gsEffMps } zo servera
 * @param {object[]|null} [calibration] namerané chyby (calibratedUncertaintyKm)
 * @returns {{lat:number, lon:number, altM:number, trackDeg:number, gsMps:number, elapsedS:number,
 *   distanceKm:number, uncertaintyKm:number, method:'nat'|'route'|'track', ended:boolean, reason:string|null,
 *   destination:object|null, remainingKm:number|null, nat:string|null, wind:boolean}}
 */
export function estimatePosition(fix, route, nowMs, model = null, calibration = null) {
  const elapsedS = Math.max(0, (nowMs - fix.tMs) / 1000);
  const wind = Number.isFinite(model?.gsEffMps);
  const gs = wind ? model.gsEffMps : fix.gsMps;
  const flownKm = (gs * elapsedS) / 1000;
  const dest = usableDestination(fix, route);
  const path = Array.isArray(model?.path) && model.path.length >= 2
    ? { points: model.path, toDestination: Boolean(dest) && model.toDestination !== false, nat: model.nat ?? null }
    : buildEstimatePath(fix, dest, null);
  const at = pointAlongPath(path.points, flownKm);
  const unc = calibratedUncertaintyKm(elapsedS, flownKm, calibration);
  if (path.toDestination && dest) {
    const remainingKm = at.remainingKm;
    const ended = remainingKm <= 0 || elapsedS > ESTIMATE_ROUTE_MAX_S;
    const altM = remainingKm < ESTIMATE_DESCENT_KM ? fix.altM * (remainingKm / ESTIMATE_DESCENT_KM) : fix.altM;
    return {
      lat: at.lat, lon: at.lon, altM, trackDeg: at.trackDeg, gsMps: gs, elapsedS, distanceKm: flownKm,
      uncertaintyKm: unc, method: path.nat ? 'nat' : 'route', ended, reason: ended ? 'arrived' : null,
      destination: dest, remainingKm, nat: path.nat, wind,
    };
  }
  const ended = elapsedS > ESTIMATE_NO_ROUTE_MAX_S;
  return {
    lat: at.lat, lon: at.lon, altM: fix.altM, trackDeg: at.trackDeg, gsMps: gs, elapsedS, distanceKm: flownKm,
    uncertaintyKm: unc, method: path.nat ? 'nat' : 'track', ended, reason: ended ? 'expired' : null,
    destination: null, remainingKm: null, nat: path.nat, wind,
  };
}

/**
 * Model odhadu pre lietadlo (pure, pre server): trať NAT, trasa, rýchlosť podľa vetra.
 * @param {(altitudeM:number) => ((lat:number, lon:number) => {u:number, v:number}|null)|null} [windSamplerFor]
 */
export function buildEstimateModel(fix, route, { natTracks = [], windSamplerFor = null, nowMs = Date.now() } = {}) {
  const dest = usableDestination(fix, route);
  const nat = natTrackFor(fix, dest, natTracks, nowMs);
  const path = buildEstimatePath(fix, dest, nat);
  const sampler = windSamplerFor ? windSamplerFor(fix.altM) : null;
  const w = sampler ? effectiveGroundSpeed(fix, path.points, sampler) : null;
  const round = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });
  return {
    // Trasu posielame len pri trati (inak si ju klient postaví sám z fixu a cieľa — menšia odpoveď).
    path: nat ? path.points.map(round) : null,
    toDestination: path.toDestination,
    nat: path.nat,
    gsEffMps: w ? Math.round(w.gsEffMps * 10) / 10 : null,
    windAheadMps: w ? Math.round(w.windAheadMps * 10) / 10 : null,
    builtAtMs: nowMs,
    hadWind: Boolean(sampler),
  };
}

/**
 * Štatistika presnosti (pure): pre pásma času bez signálu medián a 80. percentil chyby odhadu
 * a toho istého pre jednoduchý odhad (bez vetra a tratí) — nech je vidno, čo vylepšenie prinieslo.
 * @param {{elapsedMin:number, errorKm:number, baselineKm:number, method:string}[]} samples
 */
export function accuracyStats(samples) {
  const q = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] * 10) / 10;
  };
  let lo = 0;
  return ACCURACY_BUCKETS_MIN.map((maxMin) => {
    const inBucket = samples.filter((x) => x.elapsedMin >= lo && x.elapsedMin < maxMin);
    const row = {
      minMin: lo,
      maxMin,
      n: inBucket.length,
      medianKm: q(inBucket.map((x) => x.errorKm), 0.5),
      p80Km: q(inBucket.map((x) => x.errorKm), 0.8),
      baselineMedianKm: q(inBucket.map((x) => x.baselineKm), 0.5),
      byMethod: Object.fromEntries(['nat', 'route', 'track'].map((m) => {
        const xs = inBucket.filter((x) => x.method === m).map((x) => x.errorKm);
        return [m, { n: xs.length, medianKm: q(xs, 0.5) }];
      })),
    };
    lo = maxMin;
    return row;
  });
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
export function createEstimateTracker({
  lookupRoute = null, now = () => Date.now(), maxEntries = 6000, lookupGapMs = 3000, maxQueue = 3000, cacheHitMs = 50,
  natTracks = () => [], windSamplerFor = null, onAccuracy = null, modelMaxAgeMs = 30 * 60_000,
} = {}) {
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
        const back = estimates.get(fix.hex);
        if (back) {
          estimates.delete(fix.hex); // signál je späť
          // Presnosť (2026-10-05): kde sme lietadlo odhadovali v čase nového fixu vs. kde naozaj je.
          if (onAccuracy && fix.tMs - back.fix.tMs > 60_000 && !fix.onGround) {
            try {
              const est = estimatePosition(back.fix, back.route, fix.tMs, back.model);
              const base = estimatePosition(back.fix, back.route, fix.tMs, null);
              onAccuracy({
                t: Math.round(fix.tMs / 1000),
                hex: fix.hex,
                elapsedMin: Math.round((fix.tMs - back.fix.tMs) / 6000) / 10,
                errorKm: Math.round(greatCircleKm(est.lat, est.lon, fix.lat, fix.lon) * 10) / 10,
                baselineKm: Math.round(greatCircleKm(base.lat, base.lon, fix.lat, fix.lon) * 10) / 10,
                method: est.method,
                wind: est.wind,
              });
            } catch { /* meranie je doplnok */ }
          }
        }
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
      const tracks = natTracks() || [];
      for (const [hex, entry] of estimates) {
        // Model (trať, vietor) sa prepočíta, keď príde cieľ, vietor alebo po modelMaxAgeMs.
        const routeKey = entry.route?.destination?.code || '';
        const m = entry.model;
        if (!m || m.routeKey !== routeKey || nowMs - m.builtAtMs > modelMaxAgeMs || (!m.hadWind && windSamplerFor)) {
          entry.model = { ...buildEstimateModel(entry.fix, entry.route, { natTracks: tracks, windSamplerFor, nowMs }), routeKey };
        }
        const est = estimatePosition(entry.fix, entry.route, nowMs, entry.model);
        if (est.ended) {
          estimates.delete(hex);
          continue;
        }
        const r = entry.route;
        const { routeKey: _k, builtAtMs: _b, hadWind: _w, ...model } = entry.model;
        out.push({
          ...entry.fix,
          route: r && est.destination
            ? { origin: pickAirport(r.origin), destination: pickAirport(r.destination), airline: r.airline ?? null, callsignIata: r.callsignIata ?? null }
            : null,
          model,
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
