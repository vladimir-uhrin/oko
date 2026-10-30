// src/wheelZoom.js — pokojnejší zoom kolieskom (2026-10-30, vlastník: „keď skrolujem, zemeguľa sa veľmi rýchlo
// približuje a vzďaľuje, je to nepohodlné").
//
// Cesium má predvolene zoomFactor 5 a dobeh zoomu (inertiaZoom) 0,8. Zmerané v prehliadači skutočnými udalosťami
// kolieska (deltaY 100 = jedno cvaknutie vo Windows), rovnaké pri 2 000 km aj 50 km:
//   predvolené (5 / 0,8):  1 cvaknutie ×0,77, 5 rýchlych ×0,44 bližšie, ×2,14 ďalej — a kamera ešte dobieha;
//   OKO (4 / 0,5):         1 cvaknutie ×0,89, 5 rýchlych ×0,61 bližšie, ×1,64 ďalej — po pustení skoro stojí.
// Slabšie varianty (3 / 0,6 → ×0,68 na päť cvaknutí, 2 / 0,5 → ×0,79) robili cestu od zemegule k mestu zdĺhavou.
// Len pre jemný ukazovateľ (myš, touchpad): zoomFactor riadi aj pinch na telefóne, a ten je v poriadku.

export const WHEEL_ZOOM_FACTOR = 4;
export const WHEEL_ZOOM_INERTIA = 0.5;

/**
 * Nastaví ovládač kamery pre počítač. Pure voči DOM (ukazovateľ je vstup).
 * @param {object|null} controller Cesium ScreenSpaceCameraController
 * @param {{ coarsePointer?: boolean }} [options] primárne dotykové zariadenie = bez zmeny
 * @returns {boolean} či sa nastavenie zmenilo
 */
export function applyWheelZoom(controller, { coarsePointer = false } = {}) {
  if (!controller || coarsePointer) return false;
  controller.zoomFactor = WHEEL_ZOOM_FACTOR;
  controller.inertiaZoom = WHEEL_ZOOM_INERTIA;
  return true;
}
