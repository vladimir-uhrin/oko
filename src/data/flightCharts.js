// src/data/flightCharts.js
/**
 * @module flightCharts
 * @description Malé grafy CELÉHO letu pre sledovanú kartu (2026-09-12,
 * používateľ: „graf celkovej výšky letu a keď sa dá aj predpokladaná výška…
 * pekný malý graf" a „ďalší malý graf rýchlosti celkovej letu").
 *
 * Minulosť = fixy z lokálnej histórie letov (/api/history/track, 24 h surové
 * záznamy z vlastných pollov) zlúčené so živým 30-min radom karty; berie sa
 * len AKTUÁLNY úsek (po poslednej medzere > 30 min). Os x = podiel trasy
 * (keď karta má plauzibilnú trasu), inak čas od začiatku záznamu.
 *
 * Budúca výška je ODHAD a kreslí sa čiarkovane: v hladine drž výšku po bod
 * začiatku zostupu (pravidlo palca 3° ≈ 300 ft na NM), potom lineárne na
 * letisko; pri stúpaní pokračuj aktuálnou rýchlosťou stúpania po cestovnú
 * hladinu (najvyššia známa, inak typická); pri klesaní lineárne na cieľ.
 * Výška letiska nie je známa → cieľ 0 m. Rýchlosť sa NEODHADUJE (pravidlo 2:
 * odhad je vždy označený, nikdy sa netvári ako dáta).
 *
 * Bez DOM a Cesia — čisté vstupy, testovateľné v Node.
 */
import { formatAltitude, formatSpeed, formatSpeedDual } from '../units.js';

/** Bodov na graf (po celej osi x). */
export const FLIGHT_CHART_SAMPLES = 96;
/** Medzera medzi fixmi, ktorá delí úseky (ako LEG_GAP_S v histórii). */
export const FLIGHT_CHART_LEG_GAP_S = 30 * 60;
/** Pravidlo palca zostupu: 3° ≈ 300 ft na námornú míľu. */
export const DESCENT_FT_PER_NM = 300;
/** Prah stúpania/klesania (m/s) — rovnaký ako trendový glyf karty. */
export const CLIMB_DESCENT_THRESHOLD_MPS = 2.5;
/** Typická cestovná hladina, keď let stúpa a vyššiu ešte nevidel (m). */
export const CRUISE_GUESS_M = 11_000;
/** Najväčší podiel trasy, ktorý smie odhad stúpania zabrať, kým sa vyrovná. */
export const CLIMB_GUESS_MAX_FRACTION = 0.25;
const KM_PER_NM = 1.852;
const M_TO_FT = 3.28084;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/** Veľkokružnicová vzdialenosť (km). Pure. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const raw = [lat1, lon1, lat2, lon2];
  // Number(null) je 0 — chýbajúca súradnica nesmie byť rovník.
  if (raw.some((v) => v === null || v === undefined || v === '')) return null;
  const a = raw.map(Number);
  if (!a.every(Number.isFinite)) return null;
  const rad = Math.PI / 180;
  const dLat = (a[2] - a[0]) * rad;
  const dLon = (a[3] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(a[2] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Len aktuálny úsek letu: fixy po poslednej medzere väčšej než `gapS`;
 * prázdne, keď je medzera medzi posledným fixom a „teraz". Pure.
 * @param {Array<{t:number}>} fixes epoch s
 * @param {number} nowS
 */
export function currentLegFixes(fixes, nowS, gapS = FLIGHT_CHART_LEG_GAP_S) {
  const rows = (Array.isArray(fixes) ? fixes : [])
    .filter((f) => f && Number.isFinite(f.t) && f.t <= nowS + 60)
    .sort((a, b) => a.t - b.t);
  if (!rows.length) return [];
  if (nowS - rows[rows.length - 1].t > gapS) return [];
  let start = 0;
  for (let i = 1; i < rows.length; i += 1) if (rows[i].t - rows[i - 1].t > gapS) start = i;
  return rows.slice(start);
}

/**
 * Zlúči historické fixy (t v s, alt m, gs m/s, lat, lon), živé vzorky karty
 * ({epochMs, altitudeM, speedMps}) a aktuálny fix do jedného chronologického
 * radu; body v rovnakej 5-sekundovej chvíli sa spoja (živý fix dopĺňa). Pure.
 */
export function mergeTrackSamples(fixes, samples, now = null) {
  const out = [];
  for (const f of Array.isArray(fixes) ? fixes : []) {
    if (!f || !Number.isFinite(f.t)) continue;
    out.push({ t: f.t, alt: num(f.alt), gs: num(f.gs), lat: num(f.lat), lon: num(f.lon) });
  }
  for (const s of Array.isArray(samples) ? samples : []) {
    if (!s || !Number.isFinite(s.epochMs)) continue;
    out.push({ t: s.epochMs / 1000, alt: num(s.altitudeM), gs: num(s.speedMps), lat: null, lon: null });
  }
  if (now && Number.isFinite(now.epochMs)) {
    out.push({ t: now.epochMs / 1000, alt: num(now.altitudeM), gs: num(now.speedMps), lat: num(now.lat), lon: num(now.lon) });
  }
  out.sort((a, b) => a.t - b.t);
  const merged = [];
  for (const r of out) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.t - r.t) < 5) {
      merged[merged.length - 1] = {
        t: prev.t,
        alt: r.alt ?? prev.alt,
        gs: r.gs ?? prev.gs,
        lat: r.lat ?? prev.lat,
        lon: r.lon ?? prev.lon,
      };
    } else merged.push(r);
  }
  return merged;
}

/**
 * Rad `n` hodnôt po osi x ∈ [0, 1]: priemer bodov v koši, medzery medzi
 * známymi košmi lineárne doplnené, mimo známeho rozsahu null. Pure.
 * @param {Array<{x:number, v:number|null}>} points
 * @param {number} n
 */
export function bucketSeries(points, n = FLIGHT_CHART_SAMPLES) {
  const sums = new Array(n).fill(0);
  const counts = new Array(n).fill(0);
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.v)) continue;
    const i = Math.max(0, Math.min(n - 1, Math.round(p.x * (n - 1))));
    sums[i] += p.v;
    counts[i] += 1;
  }
  const out = new Array(n).fill(null);
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i += 1) {
    if (counts[i]) { out[i] = sums[i] / counts[i]; if (first < 0) first = i; last = i; }
  }
  if (first < 0) return out;
  let prev = first;
  for (let i = first + 1; i <= last; i += 1) {
    if (out[i] === null) continue;
    for (let j = prev + 1; j < i; j += 1) out[j] = out[prev] + ((out[i] - out[prev]) * (j - prev)) / (i - prev);
    prev = i;
  }
  return out;
}

/**
 * Odhad budúcej výšky po osi trasy (x ∈ [xNow, 1]) — viď hlavička modulu.
 * Vráti body {x, v} (m). Pure.
 */
export function forecastAltitude({ xNow, altitudeM, verticalRateMps, speedMps, totalKm, cruiseAltM }) {
  const alt = num(altitudeM);
  if (!Number.isFinite(xNow) || alt === null || !(totalKm > 0) || xNow >= 1) return [];
  const vr = num(verticalRateMps) ?? 0;
  const gs = num(speedMps);
  const points = [{ x: xNow, v: alt }];
  if (vr < -CLIMB_DESCENT_THRESHOLD_MPS) {
    points.push({ x: 1, v: 0 });
    return points;
  }
  let cruise = Math.max(alt, num(cruiseAltM) ?? 0);
  let x = xNow;
  let level = alt;
  if (vr > CLIMB_DESCENT_THRESHOLD_MPS && gs > 0) {
    if (cruise <= alt) cruise = Math.max(alt, CRUISE_GUESS_M);
    const climbKm = ((cruise - alt) / vr) * gs / 1000;
    const climbFraction = Math.min(CLIMB_GUESS_MAX_FRACTION, climbKm / totalKm);
    x = Math.min(1, xNow + climbFraction);
    level = climbFraction < climbKm / totalKm ? alt + (cruise - alt) * (climbFraction / (climbKm / totalKm)) : cruise;
    points.push({ x, v: level });
  }
  const descentKm = ((level * M_TO_FT) / DESCENT_FT_PER_NM) * KM_PER_NM;
  const xTod = 1 - descentKm / totalKm;
  if (xTod > x) points.push({ x: xTod, v: level });
  points.push({ x: 1, v: 0 });
  return points;
}

/** Rad z lomenej čiary {x, v} pre indexy i s x_i ≥ xFrom; inde null. Pure. */
function sampleLine(points, n, xFrom) {
  const out = new Array(n).fill(null);
  if (points.length < 2) return out;
  for (let i = 0; i < n; i += 1) {
    const x = i / (n - 1);
    if (x < xFrom - 1e-9) continue;
    let a = points[0];
    let b = points[points.length - 1];
    for (let k = 0; k < points.length - 1; k += 1) {
      if (x >= points[k].x && x <= points[k + 1].x) { a = points[k]; b = points[k + 1]; break; }
    }
    const span = b.x - a.x;
    out[i] = span > 0 ? a.v + ((b.v - a.v) * (x - a.x)) / span : b.v;
  }
  return out;
}

const normalize = (series, max) => series.map((v) => (v === null ? null : Math.max(0, Math.min(1, v / max))));
const maxOf = (...series) => series.flat().reduce((m, v) => (v !== null && v > m ? v : m), 0);

/**
 * Model grafov výšky a rýchlosti celého letu. Null, keď nie sú aspoň 2 body.
 * @param {object} p
 * @param {Array<object>} [p.fixes] historické fixy (t s, alt, gs, lat, lon)
 * @param {Array<{epochMs:number, altitudeM:number, speedMps:number}>} [p.samples] živý rad karty
 * @param {{epochMs:number, altitudeM?:number, speedMps?:number, verticalRateMps?:number, lat?:number, lon?:number}} p.now
 * @param {?{origin:{lat:number, lon:number, code?:string}, destination:{lat:number, lon:number, code?:string}}} [p.route]
 * @param {?{fractionDone:number, totalKm:number}} [p.progress]
 * @param {(key:string, vars?:object) => string} [p.translate]
 * @returns {?{mode:'route'|'time', altitude:{past:Array<number|null>, future:Array<number|null>, maxM:number, xNow:number, label:string}, speed:{past:Array<number|null>, maxMps:number, xNow:number, label:string}, axis:{left:string, right:string}, forecast:boolean}}
 */
export function buildFlightCharts({ fixes = [], samples = [], now, route = null, progress = null, translate = (k) => k, samplesN = FLIGHT_CHART_SAMPLES } = {}) {
  if (!now || !Number.isFinite(now.epochMs)) return null;
  const nowS = now.epochMs / 1000;
  const rows = mergeTrackSamples(currentLegFixes(fixes, nowS), samples, now);
  if (rows.length < 2) return null;
  const totalKm = num(progress?.totalKm);
  const routeCapable = Boolean(route?.origin && route?.destination && totalKm > 0 && Number.isFinite(num(progress?.fractionDone)));
  const t0 = rows[0].t;
  const spanS = Math.max(1, nowS - t0);
  const series = (byRoute) => {
    const xNowLocal = byRoute ? Math.max(0, Math.min(1, num(progress.fractionDone))) : 1;
    let lastX = 0;
    const altPts = [];
    const gsPts = [];
    for (const r of rows) {
      let x;
      if (!byRoute) x = Math.max(0, Math.min(1, (r.t - t0) / spanS));
      else {
        const flown = haversineKm(route.origin.lat, route.origin.lon, r.lat, r.lon);
        // živé vzorky bez polohy: po osi trasy ostávajú za posledným známym x
        x = flown === null ? lastX : Math.max(0, Math.min(1, flown / totalKm));
        lastX = x;
        x = Math.min(x, xNowLocal);
      }
      altPts.push({ x, v: r.alt });
      gsPts.push({ x, v: r.gs });
    }
    const altPast = bucketSeries(altPts, samplesN);
    const gsPast = bucketSeries(gsPts, samplesN);
    const known = Math.max(altPast.filter((v) => v !== null).length, gsPast.filter((v) => v !== null).length);
    return { altPast, gsPast, xNow: xNowLocal, known };
  };
  let routeMode = routeCapable;
  let built = series(routeMode);
  // Stroj na letisku (x ≈ 0 celý záznam) by po osi trasy dal jediný kôš —
  // vtedy os času ukáže aspoň priebeh záznamu (2026-09-12, EWG20X na zemi v HAM).
  if (built.known < 2 && routeMode) { routeMode = false; built = series(false); }
  const { altPast, gsPast, xNow } = built;
  if (built.known < 2) return null;
  const cruiseAltM = maxOf(altPast);
  const forecastPts = routeMode
    ? forecastAltitude({ xNow, altitudeM: now.altitudeM, verticalRateMps: now.verticalRateMps, speedMps: now.speedMps, totalKm, cruiseAltM })
    : [];
  const altFuture = sampleLine(forecastPts, samplesN, xNow);
  const altMax = Math.max(1, maxOf(altPast, altFuture));
  const gsMax = Math.max(1, maxOf(gsPast));
  const nowAlt = num(now.altitudeM);
  const nowGs = num(now.speedMps);
  const axis = routeMode
    ? { left: String(route.origin.code || '').toUpperCase(), right: String(route.destination.code || '').toUpperCase() }
    : { left: new Date(t0 * 1000).toISOString().slice(11, 16), right: translate('chart.now') };
  return {
    mode: routeMode ? 'route' : 'time',
    forecast: forecastPts.length >= 2,
    forecastLabel: forecastPts.length >= 2 ? translate('chart.forecast') : '',
    titles: { altitude: translate('chart.altitude'), speed: translate('chart.speed') },
    axis,
    altitude: {
      past: normalize(altPast, altMax),
      future: normalize(altFuture, altMax),
      maxM: altMax,
      xNow,
      label: translate('chart.altitude-label', {
        max: formatAltitude(altMax),
        now: nowAlt === null ? '—' : formatAltitude(nowAlt),
      }),
    },
    speed: {
      past: normalize(gsPast, gsMax),
      maxMps: gsMax,
      xNow,
      label: translate('chart.speed-label', {
        max: formatSpeed(gsMax),
        now: nowGs === null ? '—' : formatSpeedDual(nowGs),
      }),
    },
  };
}
