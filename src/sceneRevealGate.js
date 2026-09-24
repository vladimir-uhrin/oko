// src/sceneRevealGate.js
//
// "Reveal on approach" gate for a chokepoint scene (2026-09-18, user: „nech sa
// všetko objavuje iba pri určitom priblížení výške nad Hormuzom, nie na celej
// planéte"). While a strait scene is active it watches the camera's distance to
// the strait's centre; when the camera pulls back to a whole-planet view the
// scene overlays fade out, and they fade back in as you dive in — the way the
// upstream "chokehold on oil" reveal is meant to feel.
//
// It gates the FIXED chips (oil price, strait overview) by toggling a body class
// `oko-reveal-off` that dims anything marked `.oko-scene-overlay`; the
// map-anchored incident cards subscribe via `onChange` and hide themselves. The
// pure decision (`shouldReveal`) is tested without a globe.

import * as Cesium from 'cesium';

/** Reveal when the camera is within `thresholdMeters` of the scene centre. Pure. */
export function shouldReveal(distanceMeters, thresholdMeters) {
  return Number.isFinite(distanceMeters) && Number.isFinite(thresholdMeters) && distanceMeters <= thresholdMeters;
}

/**
 * @param {object} o
 * @param {object} o.viewer Cesium viewer (scene.camera.positionWC, scene.postRender)
 * @param {number} [o.revealWithinMeters] reveal distance from the scene centre
 * @param {(revealed:boolean)=>void} [o.onChange] called on each reveal↔hide flip
 * @param {Document} [o.documentRef] test seam
 */
export function createSceneRevealGate({
  viewer,
  revealWithinMeters = 1_500_000,
  onChange = () => {},
  documentRef,
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  ensureStyle(doc);
  let center = null; // Cartesian3 of the active scene centre
  let revealed = null; // null = not yet evaluated
  let removePostRender = null;

  function apply(next) {
    try { doc?.body?.classList?.toggle?.('oko-reveal-off', !next); } catch { /* headless */ }
  }

  function evaluate() {
    const camera = viewer?.scene?.camera;
    if (!center || !camera?.positionWC) return;
    let distance;
    try {
      // V 2D a Columbus je positionWC v premietnutom rámci (nie ECEF) — vzdialenosť
      // počítaj z kartografickej polohy, ktorá platí vo všetkých režimoch.
      const c = camera.positionCartographic;
      const pos = c && Number.isFinite(c.longitude) && Number.isFinite(c.latitude)
        ? Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, Number.isFinite(c.height) ? c.height : 0)
        : camera.positionWC;
      distance = Cesium.Cartesian3.distance(pos, center);
    } catch { return; }
    const next = shouldReveal(distance, revealWithinMeters);
    if (next === revealed) return;
    revealed = next;
    apply(next);
    try { onChange(next); } catch { /* subscriber threw — never break the render loop */ }
  }

  function ensureHook() {
    if (removePostRender) return;
    const postRender = viewer?.scene?.postRender;
    if (postRender?.addEventListener) {
      postRender.addEventListener(evaluate);
      removePostRender = () => postRender.removeEventListener(evaluate);
    }
  }

  /** Start gating for a scene centred at {lat, lon}. Re-arms on each scene. */
  function activate(centerLatLon) {
    const lat = centerLatLon?.lat;
    const lon = centerLatLon?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    try { center = Cesium.Cartesian3.fromDegrees(lon, lat); } catch { return; }
    revealed = null; // force a fresh decision + onChange on the next frame
    ensureHook();
    evaluate();
  }

  /** Stop gating and reveal everything (no scene active). */
  function deactivate() {
    center = null;
    revealed = null;
    apply(true);
  }

  function destroy() {
    deactivate();
    removePostRender?.();
    removePostRender = null;
  }

  return { activate, deactivate, destroy, evaluate, isRevealed: () => revealed === true };
}

function ensureStyle(doc) {
  if (!doc?.getElementById || doc.getElementById('oko-reveal-gate-style')) return;
  const style = doc.createElement('style');
  style.id = 'oko-reveal-gate-style';
  style.textContent = `
.oko-scene-overlay{transition:opacity .35s ease, transform .35s ease;}
body.oko-reveal-off .oko-scene-overlay:not([hidden]){opacity:0 !important;transform:translateY(10px);pointer-events:none !important;}
`;
  (doc.head || doc.documentElement)?.appendChild(style);
}
