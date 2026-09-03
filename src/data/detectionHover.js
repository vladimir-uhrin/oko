import * as Cesium from 'cesium';
import { setDetectionHoverSubjects } from './detection.js';

/**
 * @module detectionHover
 * @description Pointer-hover inspect for detection contacts (OKO): moving the
 * mouse over an aircraft/vessel icon shows THAT contact's detection assembly
 * (bracket + callout) immediately, at any camera distance — the on-demand
 * complement to the ambient range gate in detectionPolicy. Pattern mirrors
 * the CCTV layer's throttled MOUSE_MOVE hover (cctv.js): event-driven,
 * ≥120 ms between scene.pick calls, so an idle pointer costs nothing and a
 * moving one tops out at ~8 picks/s.
 *
 * A scene.pick can't tell which layer owns a bare string id (flights and
 * military billboards both use raw icao24 strings), so the resolver emits
 * every plausible (layerId, sourceId) pair and detection.js matches against
 * its own objects — a wrong guess matches nothing and costs nothing.
 */

/** Min spacing between hover scene.pick calls (mirrors cctv.js pacing). */
export const DETECTION_HOVER_THROTTLE_MS = 120;
/** Pick window in px — icons are small; a forgiving target beats precision. */
export const DETECTION_HOVER_PICK_PX = 8;

/**
 * Resolve a scene.pick result into hover candidates for detection.js.
 * Pure — unit-tested without Cesium.
 * @param {*} picked - `scene.pick()` result (may be undefined).
 * @returns {Array<{layerId: string, sourceId: string}>}
 */
export function hoverCandidatesFromPick(picked) {
  const raw = picked?.id ?? picked?.primitive?.id;
  if (typeof raw === 'string' && raw) {
    // Trails hug their contacts and carry no layer identity of their own.
    if (raw.startsWith('gev-trail:')) return [];
    return [
      { layerId: 'flights', sourceId: raw },
      { layerId: 'military', sourceId: raw },
    ];
  }
  if (raw && typeof raw === 'object' && Object.hasOwn(raw, 'mmsi') && raw.mmsi != null) {
    return [{ layerId: 'ais-live-vessels', sourceId: String(raw.mmsi) }];
  }
  return [];
}

/** @type {?Cesium.ScreenSpaceEventHandler} */
let _handler = null;
let _canvasLeaveTarget = null;
let _onCanvasLeave = null;

/**
 * Installs the throttled hover pass. Idempotent; `destroyDetectionHover()`
 * removes it (viewer teardown).
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 * @param {*} [options.handler] - Injected ScreenSpaceEventHandler-like (tests).
 * @param {Function} [options.now] - Clock override (tests).
 */
export function installDetectionHover(viewer, {
  handler = null,
  now = () => performance.now(),
  onHover = null,
} = {}) {
  if (_handler || !viewer?.scene?.canvas) return;
  _handler = handler || new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let lastPickAt = 0;
  _handler.setInputAction((movement) => {
    const at = now();
    if (at - lastPickAt < DETECTION_HOVER_THROTTLE_MS) return;
    lastPickAt = at;
    const position = movement?.endPosition;
    if (!position) return;
    let picked = null;
    try {
      picked = viewer.scene.pick(position, DETECTION_HOVER_PICK_PX, DETECTION_HOVER_PICK_PX);
    } catch { /* pick can throw during scene teardown — treat as empty space */ }
    const candidates = hoverCandidatesFromPick(picked);
    setDetectionHoverSubjects(candidates);
    // Druhý konzument toho istého picku: kartička pod kurzorom. Zámerne tu a
    // nie vlastným handlerom — dva nezávislé MOUSE_MOVE picky by zdvojili
    // najdrahšiu operáciu hoveru (scene.pick) a mohli sa rozísť vo fáze.
    onHover?.(candidates, position);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // Pointer leaving the canvas stops MOUSE_MOVE events — without this the
  // last hovered contact would keep its lit assembly forever.
  _canvasLeaveTarget = viewer.scene.canvas;
  _onCanvasLeave = () => {
    setDetectionHoverSubjects(null);
    onHover?.([], null);
  };
  _canvasLeaveTarget.addEventListener?.('mouseleave', _onCanvasLeave);
}

/** Removes the hover pass and clears any lit hover subject. */
export function destroyDetectionHover() {
  if (_handler) {
    _handler.destroy?.();
    _handler = null;
  }
  if (_canvasLeaveTarget && _onCanvasLeave) {
    _canvasLeaveTarget.removeEventListener?.('mouseleave', _onCanvasLeave);
  }
  _canvasLeaveTarget = null;
  _onCanvasLeave = null;
  setDetectionHoverSubjects(null);
}
