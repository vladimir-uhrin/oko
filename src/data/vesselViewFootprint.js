/**
 * @module vesselViewFootprint
 * @description Výrez lodí na telefóne podľa toho, čo obrazovka naozaj ukazuje (2026-10-16).
 *
 * Cesium `computeViewRectangle` pri šikmom pohľade s obzorom berie za rohy obrazovky, ktoré
 * minú Zem, krajné body CELÉHO obzoru okolo kamery (sever/juh/východ/západ). Po úvodnom prelete
 * telefónu (260 km, sklon −42°, Bratislava) z toho bol výrez −22,7..57,0 E / 45,1..60,2 N —
 * ~20 900 lodí, 9 MB JSON (Baltské aj Severné more), hoci obrazovka na výšku ukazuje lievik
 * široký pár stoviek km. Tu sa výrez skladá z bodov na okrajoch obrazovky premietnutých na
 * elipsoid; lúč nad obzorom nahradí obzor v tom istom stĺpci obrazovky. Pás tesne pod obzorom
 * (lode v ňom splývajú do čiary) sa oreže vzdialenosťou od stredu záberu: najviac
 * PHONE_VIEW_CAP_FACTOR × vzdialenosť kamery od stredu, nikdy menej než PHONE_VIEW_CAP_MIN_M,
 * takže blízky záber ostáva celý a nízka kamera nad riekou vidí lode až po obzor. Úvodný prelet:
 * 12,3..21,9 E / 45,5..57,3 N, ~1 700 lodí, 0,8 MB (meranie 2026-10-16 na službe oko-api); bez
 * orezania 6 700 lodí, pri 2,5× 3 100 — orezaný je len pás ~40 px pod obzorom.
 */

import * as Cesium from 'cesium';
import { padVesselViewBounds } from './vesselLabels.js';

/** Orezanie od stredu záberu: násobok vzdialenosti kamery od stredu obrazovky. */
export const PHONE_VIEW_CAP_FACTOR = 2;
/** Orezanie nikdy bližšie než toto (m) — nízka kamera vidí obzor bližšie, nič sa jej neoreže. */
export const PHONE_VIEW_CAP_MIN_M = 300_000;
/** Bodov na hranu obrazovky (rohy a medzi nimi). */
const EDGE_SAMPLES = 5;
/** Polení pri hľadaní obzoru v stĺpci (844 px / 2^10 < 1 px). */
const HORIZON_STEPS = 10;
/** Pri póle sa výrez z dĺžok neposkladá — ostáva výrez Cesia. */
const POLE_LIMIT_DEG = 85;
const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

const _px = new Cesium.Cartesian2();
const _hit = new Cesium.Cartesian3();
const _carto = new Cesium.Cartographic();

/** Uhlová vzdialenosť dvoch bodov na guli (rad). Pure. */
function arcRad(lat1, lon1, lat2, lon2) {
  const s = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Bod vo vzdialenosti `arc` (rad) od (lat, lon) smerom k (lat2, lon2) po hlavnej kružnici. Pure. */
function towards(lat, lon, lat2, lon2, arc) {
  const bearing = Math.atan2(
    Math.sin(lon2 - lon) * Math.cos(lat2),
    Math.cos(lat) * Math.sin(lat2) - Math.sin(lat) * Math.cos(lat2) * Math.cos(lon2 - lon),
  );
  const outLat = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(bearing));
  const outLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(outLat));
  return { lat: outLat, lon: outLon };
}

/** Dĺžka do rozsahu −180..180 (stupne). */
function wrapLon(lon) {
  let out = lon;
  while (out > 180) out -= 360;
  while (out < -180) out += 360;
  return out;
}

/**
 * Výrez lodí pre telefón: body okrajov obrazovky na elipsoide (nad obzorom → obzor v stĺpci),
 * orezané vzdialenosťou od stredu záberu, s rezervou padVesselViewBounds. Cez 180° poludník
 * vráti west > east (server to tak berie). Bez kamery, rozmeru, zásahu Zeme alebo pri póle null
 * — vtedy ostáva výrez Cesia.
 * @param {Cesium.Camera} camera
 * @param {number} width šírka plátna (CSS px, ako pickEllipsoid)
 * @param {number} height výška plátna (CSS px)
 * @param {{capFactor?: number, capMinM?: number}} [options]
 * @returns {{west: number, south: number, east: number, north: number}|null} stupne
 */
export function phoneVesselViewBounds(camera, width, height, { capFactor = PHONE_VIEW_CAP_FACTOR, capMinM = PHONE_VIEW_CAP_MIN_M } = {}) {
  if (!camera || typeof camera.pickEllipsoid !== 'function' || !(width > 0) || !(height > 0)) return null;
  const ellipsoid = Cesium.Ellipsoid.WGS84;
  /** Bod Zeme pod pixelom (rad) alebo null; cartesian ostáva v _hit. */
  const pick = (x, y) => {
    _px.x = x;
    _px.y = y;
    const hit = camera.pickEllipsoid(_px, ellipsoid, _hit);
    if (!hit) return null;
    const carto = ellipsoid.cartesianToCartographic(hit, _carto);
    return carto ? { lat: carto.latitude, lon: carto.longitude } : null;
  };

  // Stred záberu; obrazovka v strede nad obzorom → bod pod kamerou.
  let center = pick(width / 2, height / 2);
  let slantM;
  if (center) {
    slantM = Cesium.Cartesian3.distance(camera.positionWC, _hit);
  } else {
    const at = camera.positionCartographic;
    if (!at || !Number.isFinite(at.height)) return null;
    center = { lat: at.latitude, lon: at.longitude };
    slantM = Math.max(0, at.height);
  }
  const capArc = Math.max(capMinM, capFactor * slantM) / EARTH_RADIUS_M;

  let count = 0;
  let minDLon = Infinity;
  let maxDLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const add = (point) => {
    let p = point;
    if (arcRad(center.lat, center.lon, p.lat, p.lon) > capArc) p = towards(center.lat, center.lon, p.lat, p.lon, capArc);
    const lat = p.lat / DEG;
    const dLon = wrapLon((p.lon - center.lon) / DEG);
    count++;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (dLon < minDLon) minDLon = dLon;
    if (dLon > maxDLon) maxDLon = dLon;
  };
  const sample = (x, y) => {
    const direct = pick(x, y);
    if (direct) { add(direct); return; }
    // Lúč nad obzorom: obzor v tom istom stĺpci (polenie k spodku obrazovky).
    if (!pick(x, height)) return; // celý stĺpec je nebo
    let sky = y;
    let ground = height;
    for (let step = 0; step < HORIZON_STEPS; step++) {
      const mid = (sky + ground) / 2;
      if (pick(x, mid)) ground = mid;
      else sky = mid;
    }
    const horizon = pick(x, ground);
    if (horizon) add(horizon);
  };

  add(center);
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const f = i / (EDGE_SAMPLES - 1);
    sample(f * width, 0);
    sample(f * width, height);
    sample(0, f * height);
    sample(width, f * height);
  }
  if (count < 4 || maxLat > POLE_LIMIT_DEG || minLat < -POLE_LIMIT_DEG) return null;

  // Rezerva (šikmý pohľad nad terénom) v dĺžkach voči stredu, potom späť do −180..180.
  const padded = padVesselViewBounds({ west: minDLon, south: minLat, east: maxDLon, north: maxLat });
  const lon0 = center.lon / DEG;
  if (padded.east - padded.west >= 359) return { west: -180, south: padded.south, east: 180, north: padded.north };
  return { west: wrapLon(padded.west + lon0), south: padded.south, east: wrapLon(padded.east + lon0), north: padded.north };
}
