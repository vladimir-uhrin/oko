// src/data/quakeAlert.js
/**
 * Upozornenie na otras citeľný na Slovensku (2026-11-06, vlastník: „sprav"). Čistá logika pre
 * strážcu na serveri (src/auth/server/quakeWatch.js): ktorý otras sa hlási a čo príde do telefónu.
 *
 * PRAVIDLO: magnitúda >= 3, otras nie starší ako 2 h a ODHAD citeľného dosahu z magnitúdy
 * (earthquakeFeltRadiusM — ten istý ako slabý kruh na mape) siaha aspoň k jednej obci SR
 * (polohy obcí z local_data/volby/obce-geo.json, GeoNames CC BY 4.0). Je to odhad, nie meranie —
 * text upozornenia to hovorí. Jeden otras (USGS aj EMSC riešenie) sa hlási len raz.
 */
import { earthquakeFeltRadiusM, distanceKm } from './earthquakeCatalog.js';

export const QUAKE_ALERT_KEY = 'quake:sk';
export const QUAKE_ALERT_MIN_MAG = 3;
export const QUAKE_ALERT_MAX_AGE_MS = 2 * 3_600_000;

/** Krajské mestá (2. pád) — „~140 km od Bratislavy". */
export const SK_REFERENCE_CITIES = Object.freeze([
  ['Bratislavy', 48.1486, 17.1077], ['Trnavy', 48.3774, 17.5872], ['Nitry', 48.3069, 18.0864], ['Trenčína', 48.8945, 18.0444],
  ['Žiliny', 49.2231, 18.7394], ['Banskej Bystrice', 48.7363, 19.1462], ['Prešova', 48.9984, 21.2339], ['Košíc', 48.7164, 21.2611],
]);

/**
 * Body Slovenska z obce-geo.json (`rows: [kód, šírka, dĺžka, presnosť]`) → [[lat, lon], …]. Pure.
 * @param {{rows?: Array}} json
 */
export function slovakiaPointsFromObce(json) {
  const out = [];
  for (const row of Array.isArray(json?.rows) ? json.rows : []) {
    const lat = Number(row?.[1]); const lon = Number(row?.[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat > 47 && lat < 50 && lon > 16 && lon < 23) out.push([lat, lon]);
  }
  return out;
}

/**
 * Dosah otrasu na Slovensko. Pure.
 * @param {{lat:number, lon:number, mag:number}} event
 * @param {Array<[number, number]>} points body SR
 * @returns {{distanceKm: number, feltKm: number, felt: boolean, city: {name: string, km: number}}|null}
 */
export function slovakiaReach(event, points) {
  if (!event || !Number.isFinite(event.lat) || !Number.isFinite(event.lon) || !Array.isArray(points) || !points.length) return null;
  let best = Infinity;
  for (const [lat, lon] of points) {
    const d = distanceKm(event, { lat, lon });
    if (d < best) best = d;
  }
  let city = null;
  for (const [name, lat, lon] of SK_REFERENCE_CITIES) {
    const km = distanceKm(event, { lat, lon });
    if (!city || km < city.km) city = { name, km };
  }
  const feltKm = earthquakeFeltRadiusM(event.mag) / 1000;
  return { distanceKm: best, feltKm, felt: best <= feltKm, city: { name: city.name, km: Math.round(city.km) } };
}

/**
 * Otrasy, o ktorých treba poslať upozornenie (zoradené od najstaršieho). Pure.
 * @param {Array<object>} events spojené otrasy (mergeEarthquakeCatalogs)
 * @param {{points: Array, now: number, notified: Set<string>}} o
 * @returns {Array<{event: object, reach: object}>}
 */
export function quakeAlertCandidates(events, { points, now, notified }) {
  const out = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!Number.isFinite(event?.mag) || event.mag < QUAKE_ALERT_MIN_MAG) continue;
    if (!Number.isFinite(event.time) || event.time > now + 60_000 || now - event.time > QUAKE_ALERT_MAX_AGE_MS) continue;
    const ids = solutionIds(event);
    if (ids.some(id => notified.has(id))) continue;
    const reach = slovakiaReach(event, points);
    if (reach?.felt) out.push({ event, reach });
  }
  return out.sort((a, b) => a.event.time - b.event.time);
}

/** Všetky ID riešení otrasu (USGS:…, EMSC:…) — podľa nich sa otras hlási len raz. Pure. */
export function solutionIds(event) {
  const ids = Array.isArray(event?.solutions) ? event.solutions.map(s => s?.id).filter(Boolean) : [];
  return ids.length ? ids : [event?.id].filter(Boolean);
}

const decimal = (value) => Number(value).toFixed(1).replace('.', ',');
const ago = (ms) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 60 ? `pred ${min} min` : `pred ${Math.floor(min / 60)} h ${min % 60} min`;
};

/**
 * Text upozornenia (po slovensky ako ostatné upozornenia OKO). Pure.
 * @returns {{title: string, body: string, tag: string, url: string}}
 */
export function quakePushPayload(event, reach, now) {
  const place = String(event?.place || '').trim();
  const title = `Zemetrasenie M${decimal(event.mag)}${place ? ` · ${place}` : ''}`.slice(0, 120);
  const parts = [ago(now - event.time)];
  if (reach?.city) parts.push(`${reach.city.km} km od ${reach.city.name}`);
  parts.push('otrasy môžu byť citeľné aj na Slovensku (odhad OKO z magnitúdy)');
  return { title, body: parts.join(' · '), tag: `quake:${event.id}`, url: `/?quake=${encodeURIComponent(event.id)}` };
}
