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
//  - bez cieľa letí v poslednom smere najviac ESTIMATE_NO_ROUTE_MAX_S (1 h; pôvodne 2 h, skrátené 2026-10-12);
//  - neistota rastie so vzdialenosťou od posledného fixu (kruh na mape, text na karte);
//  - odhad sa NIKDY neukladá do histórie letov (zapisuje sa len skutočný snímok OpenSky).
//
// Čisté funkcie + sledovač pre server (createEstimateTracker), testy bez Cesia.

import { greatCircleKm, routePlausible } from './routePlausible.js';
import { buildEstimatePath, destinationPoint, natTrackFor, nearestOnTrack, pointAlongPath } from './flightPath.js';
import { effectiveGroundSpeed } from './windAloft.js';

export const ESTIMATE_MIN_ALT_M = 3000;
export const ESTIMATE_MIN_SPEED_MPS = 90;
/**
 * Strop odhadu bez cieľa. 2026-10-12 z 2 h na 1 h (vlastník: „začni čo považuješ za zmysluplné" po návrhu):
 * merania návratov signálu (20 000 za 7 dní) — len v poslednom smere 30–60 min medián 59 km, 80 % do 155 km;
 * 60–120 min medián 202 km, 80 % do 655 km. Taký odhad už o polohe nič nehovorí. S cieľom (VRS, adsbdb)
 * alebo s ukotvením z HFDL lietadlo letí ďalej — HFDL čas bez signálu nuluje.
 */
export const ESTIMATE_NO_ROUTE_MAX_S = 1 * 3600;
/**
 * Bez cieľa a pri strate signálu klesalo (2026-10-05, vlastník: lietadlá nad pevninou mimo dosahu):
 * pravdepodobne pristáva na letisku bez pokrytia — odhad najviac 20 min, nie 2 h (žiadne duchy).
 */
export const ESTIMATE_DESCENDING_NO_ROUTE_MAX_S = 20 * 60;
/** Klesanie aspoň toľko (m/s, ≈ 800 ft/min) = pristávanie, nie vyrovnanie letu. */
export const ESTIMATE_DESCENDING_VR_MPS = -4;
export const ESTIMATE_ROUTE_MAX_S = 14 * 3600;
/** Bližšie k cieľu = pristáva, nie odlietava do diery. */
export const ESTIMATE_LANDING_NEAR_KM = 60;
/** Posledných toľko km pred cieľom odhad klesá (len pre farbu a výšku na karte). */
export const ESTIMATE_DESCENT_KM = 200;
/** Lietadlo musí v snímkoch chýbať aspoň toľko, aby bolo „bez signálu". */
export const ESTIMATE_MISSING_AFTER_S = 120;

/**
 * Číslo z poľa stavu OpenSky alebo null (2026-10-16): Number(null) je 0, takže chýbajúci kurz
 * (true_track null) dával kurz 0° — odhad by letel na sever a trasa VRS sa vyberala podľa severu;
 * chýbajúca poloha by bola (0, 0).
 */
function stateNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Posledný fix z riadku OpenSky (pure); null bez polohy. */
export function fixFromState(state, snapshotSec) {
  if (!Array.isArray(state)) return null;
  const lon = stateNum(state[5]);
  const lat = stateNum(state[6]);
  if (lat === null || lon === null) return null;
  const tSec = stateNum(state[3]) > 0 ? stateNum(state[3]) : Number(snapshotSec);
  const alt = stateNum(state[13]) ?? stateNum(state[7]);
  return {
    hex: String(state[0] || '').trim().toLowerCase(),
    cs: typeof state[1] === 'string' ? state[1].trim().toUpperCase() : '',
    tMs: Math.round(tSec * 1000),
    lat,
    lon,
    altM: alt,
    gsMps: stateNum(state[9]),
    trkDeg: stateNum(state[10]),
    vrMps: stateNum(state[11]),
    onGround: state[8] === true,
    category: stateNum(state[17]),
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

/** Za toľko sekúnd vietor na trase plne nahradí vietor pri poslednom fixe. */
export const WIND_RAMP_S = 45 * 60;
/**
 * Prechod z posledného kurzu na trasu k cieľu (spätný test na 756 letoch z Histórie, 2026-10-05,
 * output/qa-estimates/backtest.mjs — medián chyby v km pri +10/+30/+60/+120 min: len kurz
 * 2/23/80/196, priamo k cieľu 26/70/94/155, tento prechod 2/23/72/141): prvých 45 min drží
 * posledný kurz, do 150. minúty plynule prejde na trasu.
 */
export const ROUTE_BLEND_START_S = 45 * 60;
export const ROUTE_BLEND_END_S = 150 * 60;

/**
 * Trasa predchádzajúceho letu s rovnakým volacím znakom (2026-10-14, flightHistoryStore.previousRoute):
 * spätný test na 1 488 letoch (output/qa-estimates/backtest-history.mjs) — medián chyby pri +60/+90/+180 min
 * 51/71/116 km namiesto 81/115/158 km; najlepší prechod z posledného kurzu na túto trasu je 15.–45. minúta.
 * Trasa platí, len keď lietadlo dnes letí pri nej (HISTORY_PATH_MAX_OFFSET_KM).
 */
export const HISTORY_BLEND_START_S = 15 * 60;
export const HISTORY_BLEND_END_S = 45 * 60;
export const HISTORY_PATH_MAX_OFFSET_KM = 120;
/** Predchádzajúci let hľadáme najviac toľko dní dozadu. */
export const HISTORY_PATH_LOOKBACK_S = 8 * 86400;

/**
 * Trasa odhadu z bodov predchádzajúceho letu (pure): od miesta najbližšieho k fixu ďalej, na konci cieľ.
 * Null, keď lietadlo dnes letí inde (ďalej než HISTORY_PATH_MAX_OFFSET_KM) alebo zvyšok trasy chýba.
 * @param {{lat:number, lon:number}} fix
 * @param {{lat:number, lon:number}} dest
 * @param {{lat:number, lon:number}[]} points
 * @returns {{lat:number, lon:number}[]|null}
 */
export function historyPathFrom(fix, dest, points) {
  if (!fix || !dest || !Array.isArray(points) || points.length < 2) return null;
  const near = nearestOnTrack({ lat: fix.lat, lon: fix.lon }, points);
  if (!near || !(near.distKm <= HISTORY_PATH_MAX_OFFSET_KM)) return null;
  const rest = points.slice(near.index + 1).map((p) => ({ lat: p.lat, lon: p.lon }));
  const out = [{ lat: fix.lat, lon: fix.lon }, ...rest];
  const last = out[out.length - 1];
  if (greatCircleKm(last.lat, last.lon, dest.lat, dest.lon) > 1) out.push({ lat: dest.lat, lon: dest.lon });
  return out.length >= 2 ? out : null;
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
export function calibratedUncertaintyKm(elapsedS, distanceKm, calibration = null, method = null) {
  const model = uncertaintyKm(distanceKm);
  if (!Array.isArray(calibration)) return model;
  const min = elapsedS / 60;
  const bucket = calibration.find((c) => min < (c.maxMin ?? Infinity));
  // Podľa spôsobu odhadu (2026-10-12): s cieľom/traťou je chyba 2× menšia než len v poslednom smere —
  // spoločný 80. percentil (takmer celý z odhadov bez cieľa) dával odhadom s cieľom zbytočne veľký kruh.
  const own = method && bucket?.byMethod?.[method];
  if (own && own.n >= CALIBRATION_MIN_SAMPLES && Number.isFinite(own.p80Km)) return Math.max(5, own.p80Km);
  // Trasa predchádzajúceho letu (2026-10-14): kým nemá vlastné merania, platí kruh odhadu s cieľom.
  const routeOwn = method === 'history' ? bucket?.byMethod?.route : null;
  if (routeOwn && routeOwn.n >= CALIBRATION_MIN_SAMPLES && Number.isFinite(routeOwn.p80Km)) return Math.max(5, routeOwn.p80Km);
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
  // Vietor nabieha postupne (2026-10-05, merania 0–30 min: odhad s vetrom 17,5 km vs. 13,1 km bez):
  // hneď po strate signálu fúka to isté ako pri poslednom fixe, iný vietor príde až s cestou.
  const windDelta = wind ? model.gsEffMps - fix.gsMps : 0;
  const ramp = Math.min(elapsedS, WIND_RAMP_S);
  const flownKm = (fix.gsMps * elapsedS + windDelta * ((ramp * ramp) / (2 * WIND_RAMP_S) + Math.max(0, elapsedS - WIND_RAMP_S))) / 1000;
  const gs = fix.gsMps + windDelta * (ramp / WIND_RAMP_S);
  const dest = usableDestination(fix, route);
  const path = Array.isArray(model?.path) && model.path.length >= 2
    ? { points: model.path, toDestination: Boolean(dest) && model.toDestination !== false, nat: model.nat ?? null }
    : buildEstimatePath(fix, dest, null);
  // Trasa predchádzajúceho letu (pathKind 'history') — kratší prechod, zrovná sa skôr.
  const history = model?.pathKind === 'history' && path.toDestination && !path.nat;
  const blendStart = history ? HISTORY_BLEND_START_S : ROUTE_BLEND_START_S;
  const blendEnd = history ? HISTORY_BLEND_END_S : ROUTE_BLEND_END_S;
  let at = pointAlongPath(path.points, flownKm);
  // Smer k cieľu nabieha postupne (ROUTE_BLEND_*): lietadlo letí po letovej ceste, nie hneď
  // priamo na cieľ.
  if ((path.toDestination || path.nat) && elapsedS < blendEnd && Number.isFinite(fix.trkDeg)) {
    const straight = destinationPoint(fix.lat, fix.lon, fix.trkDeg, flownKm);
    const w = Math.max(0, (elapsedS - blendStart) / (blendEnd - blendStart));
    at = { ...at, lat: straight.lat + (at.lat - straight.lat) * w, lon: straight.lon + (at.lon - straight.lon) * w, trackDeg: w < 0.5 ? fix.trkDeg : at.trackDeg };
  }
  const method = path.toDestination && dest ? (path.nat ? 'nat' : history ? 'history' : 'route') : (path.nat ? 'nat' : 'track');
  const unc = calibratedUncertaintyKm(elapsedS, flownKm, calibration, method);
  if (path.toDestination && dest) {
    const remainingKm = at.remainingKm;
    const ended = remainingKm <= 0 || elapsedS > ESTIMATE_ROUTE_MAX_S;
    const altM = remainingKm < ESTIMATE_DESCENT_KM ? fix.altM * (remainingKm / ESTIMATE_DESCENT_KM) : fix.altM;
    return {
      lat: at.lat, lon: at.lon, altM, trackDeg: at.trackDeg, gsMps: gs, elapsedS, distanceKm: flownKm,
      uncertaintyKm: unc, method, ended, reason: ended ? 'arrived' : null,
      destination: dest, remainingKm, nat: path.nat, wind, historyRoute: history,
    };
  }
  const descending = Number.isFinite(fix.vrMps) && fix.vrMps <= ESTIMATE_DESCENDING_VR_MPS;
  const ended = elapsedS > (descending ? ESTIMATE_DESCENDING_NO_ROUTE_MAX_S : ESTIMATE_NO_ROUTE_MAX_S);
  return {
    lat: at.lat, lon: at.lon, altM: fix.altM, trackDeg: at.trackDeg, gsMps: gs, elapsedS, distanceKm: flownKm,
    uncertaintyKm: unc, method: path.nat ? 'nat' : 'track', ended, reason: ended ? 'expired' : null,
    destination: null, remainingKm: null, nat: path.nat, wind, historyRoute: false,
  };
}

/**
 * Model odhadu pre lietadlo (pure, pre server): trať NAT, trasa, rýchlosť podľa vetra.
 * @param {(altitudeM:number) => ((lat:number, lon:number) => {u:number, v:number}|null)|null} [windSamplerFor]
 */
export function buildEstimateModel(fix, route, { natTracks = [], windSamplerFor = null, nowMs = Date.now(), historyPoints = null } = {}) {
  const dest = usableDestination(fix, route);
  const nat = natTrackFor(fix, dest, natTracks, nowMs);
  // Trať NAT má prednosť (platí v ten deň); inak trasa predchádzajúceho letu, ak lietadlo letí pri nej.
  const histPath = !nat && dest ? historyPathFrom(fix, dest, historyPoints) : null;
  const path = histPath ? { points: histPath, toDestination: true, nat: null } : buildEstimatePath(fix, dest, nat);
  const sampler = windSamplerFor ? windSamplerFor(fix.altM) : null;
  const w = sampler ? effectiveGroundSpeed(fix, path.points, sampler) : null;
  const round = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lon: Math.round(p.lon * 1000) / 1000 });
  return {
    // Trasu posielame len pri trati (inak si ju klient postaví sám z fixu a cieľa — menšia odpoveď).
    path: nat || histPath ? path.points.map(round) : null,
    pathKind: nat ? 'nat' : histPath ? 'history' : null,
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
      byMethod: Object.fromEntries(['nat', 'route', 'history', 'track'].map((m) => {
        const xs = inBucket.filter((x) => x.method === m).map((x) => x.errorKm);
        return [m, { n: xs.length, medianKm: q(xs, 0.5), p80Km: q(xs, 0.8) }];
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
 * Skutočná poloha z iného zdroja (HFDL/ADS-C, src/data/hfdlPositions.js, 2026-10-11) smie preukotviť
 * odhad, len ak ju lietadlo mohlo stihnúť: priemerná rýchlosť od posledného fixu najviac toľko (m/s,
 * ≈ 1 300 km/h — prúdové lietadlo s chvostovým vetrom) + rezerva na nepresnosť polohy.
 */
export const EXTERNAL_FIX_MAX_MPS = 360;
export const EXTERNAL_FIX_SLACK_KM = 30;
/** Kurz a rýchlosť z dvoch polôh len pri dosť dlhom úseku (kratší úsek = šum polohy). */
export const EXTERNAL_FIX_DERIVE_MIN_S = 4 * 60;
export const EXTERNAL_FIX_DERIVE_MIN_KM = 40;

/** Počiatočný kurz z bodu 1 do bodu 2 (°, pure). */
export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/**
 * Nový ukotvený fix z predošlého fixu a skutočnej polohy z iného zdroja (pure). Výška ostáva (HFDL ju
 * nenesie; ADS-C áno), kurz a rýchlosť sa odvodia z úseku medzi polohami, ak je dosť dlhý a rýchlosť
 * je prúdová; inak ostanú posledné namerané. Vráti null, ak poloha nie je fyzikálne možná.
 * @param {object} prev fix (formát fixFromState)
 * @param {{tMs:number, lat:number, lon:number, altM?:number|null, kind?:string}} ext
 */
export function anchorFromExternalFix(prev, ext) {
  const dtS = (ext.tMs - prev.tMs) / 1000;
  if (!(dtS > 0)) return null;
  const km = greatCircleKm(prev.lat, prev.lon, ext.lat, ext.lon);
  if (km > (EXTERNAL_FIX_MAX_MPS * dtS) / 1000 + EXTERNAL_FIX_SLACK_KM) return null;
  let trkDeg = prev.trkDeg;
  let gsMps = prev.gsMps;
  if (dtS >= EXTERNAL_FIX_DERIVE_MIN_S && km >= EXTERNAL_FIX_DERIVE_MIN_KM) {
    const derived = (km * 1000) / dtS;
    if (derived >= ESTIMATE_MIN_SPEED_MPS && derived <= EXTERNAL_FIX_MAX_MPS) {
      // Kurz v CIELI úseku (veľká kružnica sa stáča): smer z novej polohy späť, otočený o 180°.
      trkDeg = (bearingDegrees(ext.lat, ext.lon, prev.lat, prev.lon) + 180) % 360;
      gsMps = derived;
    }
  }
  return {
    ...prev,
    tMs: ext.tMs,
    lat: ext.lat,
    lon: ext.lon,
    altM: Number.isFinite(ext.altM) ? ext.altM : prev.altM,
    trkDeg,
    gsMps,
    // Klesanie z ADS-B pred stratou signálu po hodine nad oceánom už neplatí.
    vrMps: 0,
    via: ext.kind === 'adsc' ? 'adsc' : 'hfdl',
  };
}

/** Poloha z iného zdroja preukotví odhad, len keď je novšia než ukotvenie aspoň o toľko (ms). */
export const EXTERNAL_FIX_MIN_NEWER_MS = 30_000;

/**
 * Fix z konca letu v Histórii + novšie polohy z HFDL/ADS-C (2026-10-15, flightHistoryStore
 * lastAirborneFixes `external`) → ukotvenie, aké mal odhad pred reštartom servera (pure). Tie isté
 * pravidlá ako applyExternalFixes (po čase, len novšie, anchorFromExternalFix), ale bez merania
 * presnosti a bez zápisu do Histórie — tie polohy už boli raz použité a zapísané. Vráti kópiu bez `external`.
 */
export function anchorThroughExternalFixes(fix) {
  const { external, ...base } = fix;
  let cur = base;
  const sorted = (Array.isArray(external) ? external : []).filter((e) => e && Number.isFinite(e.tMs)).sort((a, b) => a.tMs - b.tMs);
  for (const ext of sorted) {
    if (ext.tMs <= cur.tMs + EXTERNAL_FIX_MIN_NEWER_MS) continue;
    cur = anchorFromExternalFix(cur, ext) || cur;
  }
  return cur;
}

/**
 * Sledovač pre server: z každého svetového snímku OpenSky si pamätá posledný fix každého lietadla;
 * kto zmizne vo vzduchu, ide do zoznamu odhadov (kým sa nevráti alebo odhad neskončí).
 * Trasa sa dohľadá cez lookupRoute(callsign) (adsbdb cache servera), radom, šetrne.
 * @param {{lookupRoute?: (cs: string) => Promise<object|null>, now?: () => number, maxEntries?: number}} [options]
 */
export function createEstimateTracker({
  lookupRoute = null, localRoute = null, historyRoute = null, historyGapMs = 20, now = () => Date.now(), maxEntries = 6000, lookupGapMs = 250, limitedWaitMs = 30_000, maxQueue = 3000,
  natTracks = () => [], windSamplerFor = null, onAccuracy = null, modelMaxAgeMs = 30 * 60_000,
} = {}) {
  const last = new Map(); // hex → fix (videné v poslednom snímku)
  const estimates = new Map(); // hex → { fix, route, routeState }
  let lastSnapshotSec = 0;
  let lastCount = 0;
  let skipped = 0;
  let externalApplied = 0;
  const queue = [];
  let pumping = false;

  /**
   * Trasa predchádzajúceho letu z Histórie (2026-10-14, historyRoute → flightHistoryStore.previousRoute):
   * raz na odhad s cieľom, po jednom (dopyt ide do vlákna Histórie), výsledok platí aj po preukotvení z HFDL.
   */
  const histQueue = [];
  let histPumping = false;
  let histApplied = 0;
  async function pumpHistory() {
    if (histPumping || !historyRoute) return;
    histPumping = true;
    try {
      while (histQueue.length) {
        const hex = histQueue.shift();
        const entry = estimates.get(hex);
        const dest = entry?.route?.destination;
        if (!entry || entry.histState !== 'queued' || !dest) continue;
        let points = null;
        try { points = await historyRoute(entry.fix.cs, entry.fix, dest); } catch { points = null; }
        if (estimates.get(hex) !== entry) continue;
        entry.histState = 'done';
        if (Array.isArray(points) && points.length >= 2) {
          entry.histPoints = points;
          entry.model = null; // model sa postaví s trasou predchádzajúceho letu
          histApplied += 1;
        }
        if (historyGapMs > 0) await new Promise((r) => setTimeout(r, historyGapMs));
      }
    } finally {
      histPumping = false;
    }
  }
  function wantHistory(hex, entry) {
    if (!historyRoute || entry.histState || !entry.route?.destination || !entry.fix?.cs) return;
    entry.histState = 'queued';
    histQueue.push(hex);
    void pumpHistory();
  }

  /**
   * Trasa z lokálnej databázy (2026-10-12, vrsRoutes.js — VRS standing-data, bez dopytu navonok):
   * nový odhad dostane cieľ hneď a do rady pre adsbdb ide len to, čo lokálna databáza nepozná.
   */
  function localRouteFor(fix) {
    if (!localRoute || !fix?.cs) return null;
    try { return localRoute(fix.cs, fix) || null; } catch { return null; }
  }

  /** Vlož nový odhad: lokálna trasa, inak rada pre adsbdb (ak je miesto), inak bez cieľa. */
  function admit(hex, fix) {
    const local = localRouteFor(fix);
    if (local?.destination) {
      if (nearDestination(fix, local)) return false; // pristáva
      estimates.set(hex, { fix, route: local, routeState: 'done' });
      return true;
    }
    const wantsRoute = Boolean(lookupRoute) && ROUTE_CALLSIGN_RE.test(fix.cs) && queue.length < maxQueue;
    estimates.set(hex, { fix, route: null, routeState: wantsRoute ? 'queued' : 'none' });
    if (wantsRoute) queue.push(hex);
    return true;
  }

  async function pump() {
    if (pumping || !lookupRoute) return;
    pumping = true;
    try {
      while (queue.length) {
        const hex = queue.shift();
        const entry = estimates.get(hex);
        if (!entry || entry.routeState !== 'queued') continue;
        // Tempo voči adsbdb stráži lookupRoute (adsbdbGuard: pauza po 429, prídel pre pozadie).
        // 2026-10-05: pôvodná skratka „rýchla odpoveď = cache" brala za cache aj rýchle odmietnutia —
        // dopyty sa hrnuli bez prestávky, adsbdb nás blokoval a karty lietadiel ostali bez trasy a ETA.
        // Odložené dohľadanie ({ limited: true }) preto NIE JE „cieľ neexistuje": lietadlo ostáva
        // vo fronte a skúsi sa neskôr.
        let result = null;
        try {
          result = await lookupRoute(entry.fix.cs);
        } catch {
          result = null;
        }
        if (result && result.limited === true) {
          queue.push(hex);
          await new Promise((r) => setTimeout(r, limitedWaitMs));
          continue;
        }
        entry.route = result;
        entry.routeState = 'done';
        if (entry.route && nearDestination(entry.fix, entry.route)) estimates.delete(hex); // pristáva
        await new Promise((r) => setTimeout(r, lookupGapMs));
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
          // Len ten istý let v cestovnej výške (2026-10-05, prvých 9 581 meraní): lietadlo, ktoré
          // medzitým pristálo a znova odletelo (iný volací znak, nízko po štarte), nie je „návrat
          // signálu" — také merania dávali chyby stoviek až tisícov km a skresľovali kalibráciu.
          const sameFlight = !back.fix.cs || !fix.cs || back.fix.cs === fix.cs;
          const cruising = Number.isFinite(fix.altM) && fix.altM >= ESTIMATE_MIN_ALT_M;
          if (onAccuracy && fix.tMs - back.fix.tMs > 60_000 && !fix.onGround && sameFlight && cruising) {
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
        if (admit(hex, fix)) added += 1;
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
      for (const raw of Array.isArray(fixes) ? fixes : []) {
        // Let v Histórii končí polohami z HFDL bez kurzu a rýchlosti (2026-10-15): odhad sa ukotví
        // v poslednej z nich ako pred reštartom (anchorThroughExternalFixes), nie v staršom fixe ADS-B.
        const fix = Array.isArray(raw?.external) ? anchorThroughExternalFixes(raw) : raw;
        if (!fix?.hex || estimates.has(fix.hex) || last.has(fix.hex) || estimates.size >= maxEntries) continue;
        if (!qualifiesForEstimate(fix)) continue;
        // Plnenie zo zoznamu iného servera (QA, ESTIMATES_SEED_URL) nesie aj cieľ — netreba ho dohľadávať.
        if (fix.route?.destination) {
          const { route, model: _m, ...rest } = fix;
          estimates.set(fix.hex, { fix: rest, route, routeState: 'done' });
          added += 1;
          continue;
        }
        // Bez cieľa by aj tak skončil: neplniť, čo je staršie než strop letu bez cieľa a nedá sa dohľadať.
        const hasLocal = Boolean(localRouteFor(fix)?.destination);
        const wantsRoute = Boolean(lookupRoute) && ROUTE_CALLSIGN_RE.test(fix.cs) && queue.length < maxQueue;
        if (!hasLocal && !wantsRoute && nowMs - fix.tMs > ESTIMATE_NO_ROUTE_MAX_S * 1000) continue;
        if (admit(fix.hex, fix)) added += 1;
      }
      if (queue.length) void pump();
      return added;
    },

    /**
     * Lokálna databáza trás sa práve načítala (po štarte servera ju sťahuje až po prvom plnení):
     * doplň cieľ odhadom, ktoré ho nemajú. Vráti počet doplnených.
     */
    applyLocalRoutes() {
      let applied = 0;
      for (const [hex, entry] of estimates) {
        if (entry.route?.destination) continue;
        const local = localRouteFor(entry.fix);
        if (!local?.destination) continue;
        if (nearDestination(entry.fix, local)) { estimates.delete(hex); continue; }
        entry.route = local;
        entry.routeState = 'done';
        entry.model = null; // model (trasa, vietor) sa prepočíta s cieľom
        applied += 1;
      }
      return applied;
    },

    /**
     * Skutočné polohy z HFDL/ADS-C (hfdlPositions.js, 2026-10-11) → preukotvenie odhadov. Lietadlo sa
     * hľadá podľa hexu, inak podľa volacieho znaku (2/3 záznamov HFDL hex nemá). Novší fix než posledný
     * a fyzikálne možný (anchorFromExternalFix) nahradí ukotvenie; meranie presnosti zapíše, kde sme
     * lietadlo v tom čase odhadovali (via: 'hfdl'). Živé lietadlá (ADS-B v snímku) sa nemenia.
     * @param {{hex:string, cs:string, tMs:number, lat:number, lon:number, altM?:number|null, kind?:string}[]} fixes
     * @returns {{applied: object[], stale: number, rejected: number, unmatched: number}}
     *   applied = { hex, cs, fix } pre zápis do Histórie
     */
    applyExternalFixes(fixes, nowMs = now()) {
      const byCs = new Map();
      for (const [hex, entry] of estimates) if (entry.fix.cs) byCs.set(entry.fix.cs, hex);
      const result = { applied: [], stale: 0, rejected: 0, unmatched: 0 };
      const sorted = [...(Array.isArray(fixes) ? fixes : [])].sort((a, b) => a.tMs - b.tMs);
      for (const ext of sorted) {
        if (!ext || !Number.isFinite(ext.tMs) || ext.tMs > nowMs + 120_000) continue;
        const hex = (ext.hex && estimates.has(ext.hex)) ? ext.hex : (ext.cs ? byCs.get(ext.cs) : null);
        const entry = hex ? estimates.get(hex) : null;
        if (!entry) { result.unmatched += 1; continue; }
        // Iné lietadlo s rovnakým volacím znakom (hex v správe nesedí) — nepárovať.
        if (ext.hex && ext.hex !== hex) { result.unmatched += 1; continue; }
        if (ext.tMs <= entry.fix.tMs + EXTERNAL_FIX_MIN_NEWER_MS) { result.stale += 1; continue; }
        const anchored = anchorFromExternalFix(entry.fix, ext);
        if (!anchored) { result.rejected += 1; continue; }
        if (onAccuracy) {
          try {
            const est = estimatePosition(entry.fix, entry.route, ext.tMs, entry.model);
            const base = estimatePosition(entry.fix, entry.route, ext.tMs, null);
            onAccuracy({
              t: Math.round(ext.tMs / 1000),
              hex,
              elapsedMin: Math.round((ext.tMs - entry.fix.tMs) / 6000) / 10,
              errorKm: Math.round(greatCircleKm(est.lat, est.lon, ext.lat, ext.lon) * 10) / 10,
              baselineKm: Math.round(greatCircleKm(base.lat, base.lon, ext.lat, ext.lon) * 10) / 10,
              method: est.method,
              wind: est.wind,
              via: anchored.via,
            });
          } catch { /* meranie je doplnok */ }
        }
        entry.fix = anchored;
        entry.model = null; // trasa a vietor z novej polohy
        externalApplied += 1;
        result.applied.push({ hex, cs: entry.fix.cs, fix: anchored });
      }
      return result;
    },

    /** Aktuálne odhady (skončené vyradí). Pre API: posledný fix + cieľ, polohu počíta klient. */
    list(nowMs = now()) {
      const out = [];
      const tracks = natTracks() || [];
      for (const [hex, entry] of estimates) {
        // Model (trať, vietor) sa prepočíta, keď príde cieľ, vietor alebo po modelMaxAgeMs.
        const routeKey = entry.route?.destination?.code || '';
        wantHistory(hex, entry);
        const m = entry.model;
        if (!m || m.routeKey !== routeKey || nowMs - m.builtAtMs > modelMaxAgeMs || (!m.hadWind && windSamplerFor)) {
          entry.model = { ...buildEstimateModel(entry.fix, entry.route, { natTracks: tracks, windSamplerFor, nowMs, historyPoints: entry.histPoints }), routeKey };
        }
        const est = estimatePosition(entry.fix, entry.route, nowMs, entry.model);
        if (est.ended) {
          // Cieľ ešte čaká v rade (2026-10-05, naživo ~2 900 po naplnení z histórie): dlhý prelet bez
          // cieľa by po 2 h skončil skôr, než sa cieľ dohľadá — nezobraziť, ale ani nezahodiť.
          if (entry.routeState === 'queued' && !est.destination) continue;
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
      let anchoredExternal = 0;
      for (const entry of estimates.values()) if (entry.fix.via) anchoredExternal += 1;
      let historyRoutes = 0;
      for (const e of estimates.values()) if (e.histPoints) historyRoutes += 1;
      return { tracked: last.size, estimated: estimates.size, queue: queue.length, lastSnapshotSec, skippedPartial: skipped, externalApplied, anchoredExternal, historyQueue: histQueue.length, historyApplied: histApplied, historyRoutes };
    },
  };
}

function pickAirport(a) {
  if (!a) return null;
  return { code: a.code || '', icao: a.icao || null, name: a.name || '', lat: a.lat ?? null, lon: a.lon ?? null, country: a.country ?? null };
}
