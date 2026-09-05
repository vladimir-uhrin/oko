import * as Cesium from 'cesium';
import { holdContinuousRender, releaseContinuousRender, governorRequestRender } from './renderGovernor.js';

/**
 * Guľa / plátno — prepnutie Cesium scény medzi 3D glóbusom a plochou 2D mapou
 * (Web Mercator, Cesium default; volí sa pri štarte, tu sa nemení).
 *
 * Prečo nie holé `scene.morphTo2D()`: render governor drží scénu v
 * requestRenderMode, takže bez podržania súvislého renderu morph nikdy
 * nedobehne a scéna ostane v MORPHING (živý nález 2026-09-05). Preto sa na
 * čas morfu drží hold a uvoľní sa na `morphComplete`; ohraničený záložný
 * časovač chráni pred únikom holdu, keby udalosť neprišla.
 *
 * Čo v plátne platí a čo nie: horizontový cull, rotácia ikon a podpis pózy
 * kamery majú guardy v iconOrientation.js. 3D modely lodí/lietadiel sa
 * sploštia, náklon a cinematic kamera sú 3D-only, fotoreál v 2D nerenderuje.
 */

/** Trvanie morfu (s). 0 = okamžite (completeMorph). */
export const SCENE_MORPH_S = 1.0;
/** Záložné uvoľnenie holdu, ak `morphComplete` nepríde (ms nad trvanie morfu). */
export const MORPH_HOLD_GRACE_MS = 800;
const HOLD_ID = 'scene-morph';
/**
 * Screen-space error glóbusu v plátne. Cesium v 2D pri rovnakej výške volí
 * o úroveň hrubšie dlaždice než v 3D (živé meranie 2026-09-05: 3 200 km →
 * úroveň 4 pri SSE 2, úroveň 5 pri SSE 1), takže rastrové popisky štátov
 * zapečené v Stadia/OSM dlaždiciach vyzerali dvojnásobné („názvy štátov sa
 * neprispôsobujú zoomovaniu"). Cena: ~3× dlaždíc, len kým je plátno zapnuté.
 * Pri návrate na guľu sa vráti pôvodná hodnota.
 */
export const FLAT_MAP_SCREEN_SPACE_ERROR = 1;
let _savedScreenSpaceError = null;

/**
 * Aktuálny režim ako reťazec.
 * @param {object|null} scene
 * @returns {'globe'|'flat'|'columbus'|'morphing'|'unknown'}
 */
export function currentSceneMode(scene) {
  switch (scene?.mode) {
    case Cesium.SceneMode.SCENE3D: return 'globe';
    case Cesium.SceneMode.SCENE2D: return 'flat';
    case Cesium.SceneMode.COLUMBUS_VIEW: return 'columbus';
    case Cesium.SceneMode.MORPHING: return 'morphing';
    default: return 'unknown';
  }
}

/**
 * Prepni scénu na plátno (flat=true) alebo späť na guľu.
 * @param {object|null} scene Cesium Scene (alebo mock s mode/morphTo2D/morphTo3D).
 * @param {boolean} flat
 * @param {{durationS?: number, setTimeoutImpl?: Function}} [opts]
 * @returns {boolean} true ak sa morph spustil alebo scéna už v cieľovom režime je
 */
export function applySceneMode(scene, flat, { durationS = SCENE_MORPH_S, setTimeoutImpl = null } = {}) {
  if (!scene || typeof scene.morphTo2D !== 'function' || typeof scene.morphTo3D !== 'function') return false;
  const target = flat ? Cesium.SceneMode.SCENE2D : Cesium.SceneMode.SCENE3D;
  if (scene.mode === target) return true;

  holdContinuousRender(HOLD_ID);
  let released = false;
  let remover = null;
  const release = () => {
    if (released) return;
    released = true;
    try { remover?.(); } catch { /* už odpojené */ }
    releaseContinuousRender(HOLD_ID);
    // Governor forwarduje na nainštalovaný viewer; scénu si vyžiadame aj
    // priamo, nech posledný snímok morfu nezávisí od toho, či je governor
    // nainštalovaný (testy, headless).
    scene.requestRender?.();
    governorRequestRender('scene-morph');
  };
  if (scene.morphComplete?.addEventListener) {
    remover = scene.morphComplete.addEventListener(release);
  }
  const dur = Number.isFinite(durationS) && durationS >= 0 ? durationS : SCENE_MORPH_S;
  // Jemnejšie dlaždice v plátne (popisky), pôvodná hodnota späť na guli.
  const globe = scene.globe;
  if (globe && Number.isFinite(globe.maximumScreenSpaceError)) {
    if (flat) {
      if (_savedScreenSpaceError === null) _savedScreenSpaceError = globe.maximumScreenSpaceError;
      globe.maximumScreenSpaceError = FLAT_MAP_SCREEN_SPACE_ERROR;
    } else if (_savedScreenSpaceError !== null) {
      globe.maximumScreenSpaceError = _savedScreenSpaceError;
      _savedScreenSpaceError = null;
    }
  }
  if (flat) scene.morphTo2D(dur); else scene.morphTo3D(dur);
  if (dur === 0) {
    scene.completeMorph?.();
    release();
    return true;
  }
  const timer = setTimeoutImpl || (typeof setTimeout === 'function' ? setTimeout : null);
  if (timer) timer(release, dur * 1000 + MORPH_HOLD_GRACE_MS);
  else release(); // bez časovača (DOM-less) neriskuj únik holdu
  return true;
}
