/**
 * @module routeLine
 * @description Trasová čiara SLEDOVANÉHO letu (FR24 idiom): plný segment
 * origin → lietadlo (preletené), čiarkovaný lietadlo → cieľ (zostávajúce).
 * Kreslí sa výhradne pre plauzibilnú adsbdb trasu — rovnaký gate ako
 * riadok trasy na karte (routePlausible), takže čiara a karta si nikdy
 * neprotirečia.
 *
 * Celá čiara letí v konštantnej letovej hladine lietadla: je to PLÁN, nie
 * výškový profil — konce sa nezabárajú do terénu (letiská majú rôzne
 * elevácie a entity polyline sa po častiach clampovať nedá) a nepotrebujeme
 * žiadne terénne dopyty. Vzor prevzatý z trailRenderer: entity polyline s
 * CallbackProperty, GEODESIC oblúk, depthFailMaterial (za terénom stlmená,
 * nikdy nezmizne) a claimnutý pick namespace, aby klik na čiaru nečítal ako
 * "prázdny priestor" a nedeselektoval práve sledované lietadlo.
 */
import * as Cesium from 'cesium';
import { registerPickOwner } from './pickRegistry.js';

// Klik na čiaru plánu je no-op v každej vrstve — rovnaká ochrana ako trails.
registerPickOwner('route-lines', (pickedId) => String(pickedId).startsWith('gev-route:'));

/** Fallback letová hladina, keď render výška ešte nie je známa (m). */
export const ROUTE_LINE_DEFAULT_ALTITUDE_M = 10_000;
/** Farba čiary — akcent sledovaného letu (tracked cyan). */
const ROUTE_LINE_COLOR = '#39d0ff';
/** Alfa nad terénom / za terénom (trail idiom: stlmiť, nie schovať). */
const ROUTE_LINE_ALPHA = 0.7;
const ROUTE_LINE_OCCLUDED_ALPHA = 0.28;
const ROUTE_LINE_WIDTH = 1.3;

/** @type {number} Uniquifier entity id (Cesium vyžaduje unikátne). */
let _routeSeq = 0;

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Geometria čiary v stupňoch: {flown, remaining} ako [lon, lat, h] trojice,
 * alebo null, keď čokoľvek chýba — čiara sa radšej nenakreslí, než by mala
 * hádať.
 * @param {{origin:object, destination:object, lat:number, lon:number, altitudeM?:number}|null} info
 * @returns {{flown:number[][], remaining:number[][]}|null}
 */
export function routeLinePositionsDeg(info) {
  const originLat = finite(info?.origin?.lat);
  const originLon = finite(info?.origin?.lon);
  const destLat = finite(info?.destination?.lat);
  const destLon = finite(info?.destination?.lon);
  const planeLat = finite(info?.lat);
  const planeLon = finite(info?.lon);
  if (originLat === null || originLon === null) return null;
  if (destLat === null || destLon === null) return null;
  if (planeLat === null || planeLon === null) return null;
  const altitude = finite(info?.altitudeM) ?? ROUTE_LINE_DEFAULT_ALTITUDE_M;
  return {
    flown: [[originLon, originLat, altitude], [planeLon, planeLat, altitude]],
    remaining: [[planeLon, planeLat, altitude], [destLon, destLat, altitude]],
  };
}

/**
 * Handle čiary viazaný na viewer: setSegments prekreslí, clear vyprázdni
 * (entity ostávajú na ďalší poll), destroy odstráni.
 * @param {Cesium.Viewer} viewer Viewer, ktorého entity kolekcia čiaru vlastní.
 * @returns {{setSegments: function(object|null): void, clear: function(): void, destroy: function(): void}}
 */
export function createTrackedRouteLine(viewer) {
  const baseColor = Cesium.Color.fromCssColorString(ROUTE_LINE_COLOR);
  /** @type {Cesium.Cartesian3[]} */
  let flown = [];
  /** @type {Cesium.Cartesian3[]} */
  let remaining = [];
  let destroyed = false;
  /** @type {Cesium.Entity[]} */
  let entities = [];

  function ensureEntities() {
    if (entities.length || destroyed || !viewer || viewer.isDestroyed()) return;
    const shared = {
      width: ROUTE_LINE_WIDTH,
      arcType: Cesium.ArcType.GEODESIC,
    };
    entities = [
      viewer.entities.add({
        id: `gev-route:${++_routeSeq}:flown`,
        polyline: {
          ...shared,
          positions: new Cesium.CallbackProperty(() => flown, false),
          material: baseColor.withAlpha(ROUTE_LINE_ALPHA),
          depthFailMaterial: baseColor.withAlpha(ROUTE_LINE_OCCLUDED_ALPHA),
        },
      }),
      viewer.entities.add({
        id: `gev-route:${++_routeSeq}:remaining`,
        polyline: {
          ...shared,
          positions: new Cesium.CallbackProperty(() => remaining, false),
          // Zostávajúci úsek je čiarkovaný — plán, nie história.
          material: new Cesium.PolylineDashMaterialProperty({
            color: baseColor.withAlpha(ROUTE_LINE_ALPHA),
            dashLength: 16,
          }),
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
            color: baseColor.withAlpha(ROUTE_LINE_OCCLUDED_ALPHA),
            dashLength: 16,
          }),
        },
      }),
    ];
  }

  function toCartesians(triples) {
    return triples.map(([lon, lat, height]) => Cesium.Cartesian3.fromDegrees(lon, lat, height));
  }

  return {
    setSegments(geometry) {
      if (destroyed) return;
      if (!geometry) {
        flown = [];
        remaining = [];
        return;
      }
      ensureEntities();
      flown = toCartesians(geometry.flown);
      remaining = toCartesians(geometry.remaining);
    },
    clear() {
      flown = [];
      remaining = [];
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      flown = [];
      remaining = [];
      if (viewer && !viewer.isDestroyed()) {
        for (const entity of entities) viewer.entities.remove(entity);
      }
      entities = [];
    },
  };
}
