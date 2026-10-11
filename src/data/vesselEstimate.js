// src/data/vesselEstimate.js
/**
 * @module vesselEstimate
 * @description Odhad súčasnej polohy lode mimo dosahu (2026-10-11, bod 4 zo
 * zoznamu vylepšení; MINERVA ZEN: posledná poloha 10. 10. pri USA, kde je teraz?).
 *
 * Z poslednej známej polohy, rýchlosti a kurzu (alebo smerom k známemu cieľu)
 * dopočíta, kde loď asi je. Je to ODHAD — vždy tak označený, s kruhom
 * neistoty, ktorý rastie s časom (pravidlo 2: modelované ≠ merané). Pri cieli
 * loď na ňom zastane („asi v cieli od …"). Nad 72 h sa neodhaduje.
 *
 * Čisté funkcie + jeden zdieľaný kresliaci modul (značka, čiara, kruh) pre
 * všetky lodné vrstvy a hľadanie.
 */
import * as Cesium from 'cesium';
import { greatCircleKm } from './vesselDestination.js';

const KN_TO_KMH = 1.852;
const R = 6371.0088;
/** Pod touto vekovou hranicou polohy odhad netreba (loď je „čerstvá"). */
export const ESTIMATE_MIN_AGE_MS = 30 * 60 * 1000;
/** Nad touto hranicou je odhad už len dohad — nekreslí sa. */
export const ESTIMATE_MAX_AGE_MS = 72 * 3600 * 1000;
export const ESTIMATE_MIN_SPEED_KN = 1;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Bod vo vzdialenosti `km` od (lat, lon) v smere `bearing` (°). Pure. */
export function destinationPoint(lat, lon, bearingDeg, km) {
  const d = km / R;
  const b = rad(bearingDeg);
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 };
}

/** Počiatočný kurz z A do B (°). Pure. */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1); const p2 = rad(lat2); const dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Odhad polohy „teraz". Null, keď je poloha čerstvá, stará nad 72 h, alebo
 * loď stojí. Pure.
 * @param {{lat:number, lon:number, t:number, speedKn?:number|null, course?:number|null}} base posledná známa poloha (t v ms)
 * @param {{destination?: {lat:number, lon:number, name?:string}|null, nowMs?: number}} [o]
 * @returns {?{lat:number, lon:number, baseT:number, hours:number, distanceKm:number, radiusKm:number, method:'destination'|'course', arrived:boolean, arrivedAt:number|null}}
 */
export function estimateVesselPosition(base, { destination = null, nowMs = Date.now() } = {}) {
  if (!base || !Number.isFinite(base.lat) || !Number.isFinite(base.lon) || !Number.isFinite(base.t)) return null;
  const ageMs = nowMs - base.t;
  if (ageMs < ESTIMATE_MIN_AGE_MS || ageMs > ESTIMATE_MAX_AGE_MS) return null;
  const speed = Number(base.speedKn);
  if (!Number.isFinite(speed) || speed < ESTIMATE_MIN_SPEED_KN) return null;
  const hours = ageMs / 3_600_000;
  const run = speed * KN_TO_KMH * hours;
  let point;
  let method;
  let arrived = false;
  let arrivedAt = null;
  if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lon)) {
    const toGo = greatCircleKm(base.lat, base.lon, destination.lat, destination.lon);
    method = 'destination';
    if (toGo !== null && run >= toGo) {
      point = { lat: destination.lat, lon: destination.lon };
      arrived = true;
      arrivedAt = base.t + (toGo / (speed * KN_TO_KMH)) * 3_600_000;
    } else {
      point = destinationPoint(base.lat, base.lon, initialBearing(base.lat, base.lon, destination.lat, destination.lon), run);
    }
  } else if (Number.isFinite(base.course) && base.course >= 0 && base.course < 360) {
    method = 'course';
    point = destinationPoint(base.lat, base.lon, base.course, run);
  } else {
    return null;
  }
  // Neistota: základ 3 km + 10 % prejdenej dráhy (rýchlosť/kurz sa menia), bez cieľa viac.
  const radiusKm = Math.round(3 + run * (method === 'destination' ? 0.1 : 0.2));
  return { lat: point.lat, lon: point.lon, baseT: base.t, hours, distanceKm: run, radiusKm, method, arrived, arrivedAt };
}

/**
 * Riadok karty: „Odhad teraz 34,9° S 75,4° Z ±40 km (z polohy spred 19 h)" alebo
 * „Odhad: asi v cieli Wilmington od ~11. 10. 06:00 UTC". Pure.
 */
export function estimateLine(estimate, destinationName = '', t = (k) => k, lang = 'sk') {
  if (!estimate) return '';
  const dec = (v) => (lang === 'sk' ? Math.abs(v).toFixed(2).replace('.', ',') : Math.abs(v).toFixed(2));
  if (estimate.arrived && Number.isFinite(estimate.arrivedAt)) {
    const d = new Date(estimate.arrivedAt);
    const when = `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
    return t('vessel.estimate-arrived', { port: destinationName || '?', when });
  }
  const ns = estimate.lat >= 0 ? (lang === 'sk' ? 'S' : 'N') : (lang === 'sk' ? 'J' : 'S');
  const ew = estimate.lon >= 0 ? (lang === 'sk' ? 'V' : 'E') : (lang === 'sk' ? 'Z' : 'W');
  const hours = estimate.hours >= 48 ? `${Math.round(estimate.hours / 24)} d` : `${Math.round(estimate.hours)} h`;
  return t('vessel.estimate-now', { pos: `${dec(estimate.lat)}° ${ns} ${dec(estimate.lon)}° ${ew}`, radius: estimate.radiusKm, age: hours });
}

// ── Kreslenie (zdieľané) ─────────────────────────────────────────────────────
const _graphics = new Map(); // key → entities[]
let _viewer = null;

/** Pripoj viewer (raz, z main.js). */
export function attachVesselEstimateViewer(viewer) { _viewer = viewer; }

/** Zhasni odhad pre kľúč (napr. „gfw:241190000"). */
export function clearVesselEstimate(key) {
  const list = _graphics.get(key);
  if (list && _viewer?.entities) for (const e of list) { try { _viewer.entities.remove(e); } catch { /* */ } }
  _graphics.delete(key);
  _viewer?.scene?.requestRender?.();
}

/**
 * Nakresli odhad: prerušovaná čiara z poslednej polohy, kruh neistoty a značka
 * s textom „ODHAD". Kľúč nahrádza predošlý odhad tej istej lode.
 */
export function showVesselEstimate(key, base, estimate, label = '') {
  clearVesselEstimate(key);
  if (!_viewer?.entities || !estimate) return;
  const color = Cesium.Color.fromCssColorString('#ffd166');
  const list = [];
  try {
    list.push(_viewer.entities.add({
      id: `gev-voyage:estimate-line:${key}`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([base.lon, base.lat, estimate.lon, estimate.lat]),
        width: 1.6, arcType: Cesium.ArcType.GEODESIC,
        material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.8), dashLength: 10 }),
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.3), dashLength: 10 }),
      },
    }));
    list.push(_viewer.entities.add({
      id: `gev-voyage:estimate-area:${key}`,
      position: Cesium.Cartesian3.fromDegrees(estimate.lon, estimate.lat, 0),
      ellipse: {
        semiMajorAxis: estimate.radiusKm * 1000, semiMinorAxis: estimate.radiusKm * 1000,
        material: color.withAlpha(0.12), outline: true, outlineColor: color.withAlpha(0.6), height: 0,
      },
    }));
    list.push(_viewer.entities.add({
      id: `gev-voyage:estimate-point:${key}`,
      position: Cesium.Cartesian3.fromDegrees(estimate.lon, estimate.lat, 0),
      point: { pixelSize: 10, color: Cesium.Color.TRANSPARENT, outlineColor: color, outlineWidth: 2.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: {
        text: label, font: '12px "JetBrains Mono", monospace', fillColor: color,
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#06121a').withAlpha(0.85),
        pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    }));
  } catch { /* headless */ }
  _graphics.set(key, list);
  _viewer.scene?.requestRender?.();
}

/**
 * Loď nájdená hľadaním, ktorú žiadna vrstva nemá (2026-10-11): posledná známa
 * poloha (značka s časom) + odhad teraz smerom k cieľu, kamera nad oboma.
 * @param {{name?:string, mmsi?:string, position:{lat:number, lon:number, t:number, speedKn?:number, course?:number}}} ship
 * @param {object|null} info /api/vessel-info (destinationPort)
 * @param {{translate?: Function, lang?: string, nowMs?: number}} [o]
 * @returns {object|null} odhad alebo null
 */
export function showRemoteVessel(ship, info, { translate = (k) => k, lang = 'sk', nowMs = Date.now(), destination: destOverride = null } = {}) {
  const p = ship?.position;
  if (!_viewer?.entities || !p || !Number.isFinite(p.lat)) return null;
  clearVesselEstimate('remote');
  const d = new Date(p.t);
  const when = `${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
  const destination = info?.destinationPort && Number.isFinite(info.destinationPort.lat) ? info.destinationPort : destOverride;
  const estimate = estimateVesselPosition(p, { destination, nowMs });
  if (estimate) showVesselEstimate('remote', p, estimate, `${translate('vessel.estimate-label')} · ±${estimate.radiusKm} km`);
  const list = _graphics.get('remote') || [];
  try {
    list.push(_viewer.entities.add({
      id: 'gev-voyage:remote-last',
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      point: { pixelSize: 10, color: Cesium.Color.fromCssColorString('#5fd0e6'), outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: `${ship.name || ship.mmsi || ''} · ${when}`, font: '12px "JetBrains Mono", monospace', fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#06121a').withAlpha(0.85), pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
  } catch { /* */ }
  _graphics.set('remote', list);
  const target = estimate || p;
  const spanKm = estimate ? Math.max(200, estimate.distanceKm * 2.2) : 400;
  try {
    _viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees((p.lon + target.lon) / 2, (p.lat + target.lat) / 2, Math.min(6_000_000, spanKm * 1000)), duration: 2.5 });
  } catch { /* */ }
  return estimate;
}
