// src/data/vesselVoyageLine.js
/**
 * @module vesselVoyageLine
 * @description Čiara plavby VYBRANEJ lode do cieľového prístavu (2026-09-05).
 * Vzor prevzatý z routeLine.js (plán letu): entity polyline s CallbackProperty,
 * GEODESIC oblúk, `depthFailMaterial` (za horizontom stlmená, nikdy nezmizne)
 * a vlastný pick namespace, aby klik na čiaru nečítal ako „prázdny priestor"
 * a nezrušil práve vybranú loď.
 *
 * Čiara beží v nulovej výške (hladina mora) — pre plavidlo je to skutočná
 * dráha, nie plán vo výške ako pri lietadle. Je to PRIAMA veľkokružnica, nie
 * plavebná trasa: obchádzanie pevniny, prieplavy ani ľad nezohľadňuje. Karta
 * to hovorí vzdialenosťou „po veľkokružnici" a ETA s vlnovkou.
 */
import * as Cesium from 'cesium';
import { registerPickOwner } from './pickRegistry.js';

// Klik na čiaru plavby je no-op v každej vrstve — rovnaká ochrana ako trails.
registerPickOwner('voyage-lines', (pickedId) => String(pickedId).startsWith('gev-voyage:'));

/** Farba čiary plavby — tlmená námorná azúrová (ikony lodí sú sýtejšie). */
const VOYAGE_LINE_COLOR = '#5fd0e6';
const VOYAGE_LINE_ALPHA = 0.5;
const VOYAGE_LINE_OCCLUDED_ALPHA = 0.2;
const VOYAGE_LINE_WIDTH = 1.4;
const VOYAGE_DASH_LENGTH = 14;

let _voyageSeq = 0;

/**
 * Pozície čiary v stupňoch: loď → prístav, obe v nulovej výške. Pure.
 * @param {?{lat: number, lon: number}} from
 * @param {?{lat: number, lon: number}} to
 * @returns {number[][]|null} `[[lon, lat, 0], [lon, lat, 0]]`
 */
export function voyageLinePositionsDeg(from, to) {
  const values = [from?.lat, from?.lon, to?.lat, to?.lon];
  if (!values.every(Number.isFinite)) return null;
  return [[from.lon, from.lat, 0], [to.lon, to.lat, 0]];
}

/** História plavby (2026-10-10): predchádzajúce prístavy → loď, jantárová, aby sa neplietla s cieľom. */
export const HISTORY_LINE_STYLE = Object.freeze({ color: '#ffb347', alpha: 0.55, occludedAlpha: 0.2, dashLength: 8, width: 1.4 });

/**
 * Body histórie plavby: prístavy (chronologicky) a nakoniec loď; nezmyselné
 * body a duplicitné susedné body vypadnú. Pure.
 * @param {Array<{lat: number, lon: number}>} ports
 * @param {?{lat: number, lon: number}} vessel
 * @param {number} [maxPorts]
 * @returns {number[][]|null} `[[lon, lat, 0], …]`, aspoň 2 body
 */
export function historyLinePositionsDeg(ports, vessel, maxPorts = 8) {
  const pts = [];
  for (const p of (Array.isArray(ports) ? ports : []).slice(-maxPorts)) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev[0] - p.lon) < 1e-4 && Math.abs(prev[1] - p.lat) < 1e-4) continue;
    pts.push([p.lon, p.lat, 0]);
  }
  if (Number.isFinite(vessel?.lat) && Number.isFinite(vessel?.lon)) pts.push([vessel.lon, vessel.lat, 0]);
  return pts.length >= 2 ? pts : null;
}

/**
 * Handle čiary viazaný na viewer.
 * @param {Cesium.Viewer} viewer
 * @param {{color?: string, alpha?: number, occludedAlpha?: number, dashLength?: number, width?: number}} [style]
 * @returns {{setVoyage: function(?object, ?object): void, setPath: function(?number[][]): void, clear: function(): void, destroy: function(): void}}
 */
export function createVesselVoyageLine(viewer, style = {}) {
  const base = Cesium.Color.fromCssColorString(style.color || VOYAGE_LINE_COLOR);
  const alpha = Number.isFinite(style.alpha) ? style.alpha : VOYAGE_LINE_ALPHA;
  const occludedAlpha = Number.isFinite(style.occludedAlpha) ? style.occludedAlpha : VOYAGE_LINE_OCCLUDED_ALPHA;
  const dashLength = Number.isFinite(style.dashLength) ? style.dashLength : VOYAGE_DASH_LENGTH;
  const width = Number.isFinite(style.width) ? style.width : VOYAGE_LINE_WIDTH;
  /** @type {Cesium.Cartesian3[]} */
  let positions = [];
  let destroyed = false;
  /** @type {Cesium.Entity|null} */
  let entity = null;

  function ensureEntity() {
    if (entity || destroyed || !viewer || viewer.isDestroyed?.()) return;
    entity = viewer.entities.add({
      id: `gev-voyage:${++_voyageSeq}`,
      polyline: {
        width,
        arcType: Cesium.ArcType.GEODESIC,
        positions: new Cesium.CallbackProperty(() => positions, false),
        material: new Cesium.PolylineDashMaterialProperty({
          color: base.withAlpha(alpha),
          dashLength,
        }),
        depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
          color: base.withAlpha(occludedAlpha),
          dashLength,
        }),
      },
    });
  }

  return {
    /**
     * Prekreslí čiaru medzi loďou a prístavom; ktorýkoľvek chýbajúci koniec ju zhasne.
     * @param {?{lat: number, lon: number}} from
     * @param {?{lat: number, lon: number}} to
     */
    setVoyage(from, to) {
      if (destroyed) return;
      const degrees = voyageLinePositionsDeg(from, to);
      if (!degrees) { positions = []; return; }
      ensureEntity();
      positions = degrees.map(([lon, lat, height]) => Cesium.Cartesian3.fromDegrees(lon, lat, height));
    },
    /** Lomená čiara cez body `[[lon, lat, h], …]` (história plavby); null zhasne. */
    setPath(degrees) {
      if (destroyed) return;
      if (!Array.isArray(degrees) || degrees.length < 2) { positions = []; return; }
      ensureEntity();
      positions = degrees.map(([lon, lat, height]) => Cesium.Cartesian3.fromDegrees(lon, lat, height || 0));
    },
    clear() {
      positions = [];
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      positions = [];
      if (entity && viewer && !viewer.isDestroyed?.()) {
        try { viewer.entities.remove(entity); } catch { /* už preč */ }
      }
      entity = null;
    },
  };
}
