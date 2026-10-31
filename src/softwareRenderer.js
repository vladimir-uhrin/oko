// src/softwareRenderer.js — glóbus bez grafickej karty (2026-10-30, PageSpeed Insights na okolive.sk:
// „stránka prestala reagovať"). Servery PageSpeed/Lighthouse nemajú GPU a WebGL tam kreslí procesor
// (SwiftShader). Cesium so 60 snímkami/s a MSAA 4× tam držalo hlavné vlákno 3–6 s na úlohu (lokálne
// Lighthouse: 107 s skriptu Cesia, TBT 74 s), takže meranie spadlo. To isté by zažil človek
// s počítačom bez ovládača grafiky. Softvérové kreslenie preto beží úsporne: 1 snímka za sekundu,
// bez MSAA, s menším rozlíšením. Obsah stránky sa nemení.
//
// 2026-10-31 (profil procesora pod SwiftShader so 4× pomalším procesorom, okolive.sk): štvrtinu hlavného
// vlákna bralo čítanie hĺbky scény (readPixels — sampleHeight podlahy 3D modelov lietadiel na zemi
// a pickPosition cieľa kamery pre hlas) a pätinu prekladanie shaderov. Bez GPU preto flotila nemá 3D
// modely (flights.js, militaryFlights.js cez isSoftwareRenderActive), cieľ kamery sa berie z elipsoidu
// (gevActions.js), Slnko, Mesiac, hviezdy, atmosféra, hmla a FXAA sú vypnuté (main.js a nižšie).

// Názvy softvérových rasterizérov, ako ich hlási WebGL (RENDERER / UNMASKED_RENDERER_WEBGL).
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render driver|mesa offscreen/i;

/** Úsporný režim bez GPU je zapnutý (nastavuje applySoftwareRendererBudget). */
let _active = false;

/** Je to softvérové kreslenie bez GPU? (pure) */
export function isSoftwareRendererName(name) {
  return SOFTWARE_RE.test(String(name || ''));
}

/** Názov kresliaceho zariadenia z WebGL kontextu; '' keď sa nedá zistiť. */
export function webglRendererName(gl) {
  try {
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const unmasked = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return String(unmasked || gl.getParameter(gl.RENDERER) || '');
  } catch {
    return '';
  }
}

/** Beží glóbus v úspornom režime bez GPU? Vrstvy podľa toho vynechávajú drahé čítanie hĺbky scény. */
export function isSoftwareRenderActive() {
  return _active;
}

/** Testy: podstrčenie režimu bez skutočného WebGL kontextu. */
export function _setSoftwareRenderActiveForTest(value) {
  _active = value === true;
}

export const SOFTWARE_FRAME_RATE = 1;
export const SOFTWARE_RESOLUTION_SCALE = 0.5;

/**
 * Pri softvérovom kreslení prepne viewer do úsporného režimu. Vracia true, keď ho prepol.
 * @param {object} viewer Cesium.Viewer
 * @param {string} [rendererName] na testy; inak sa zistí z kontextu scény
 */
export function applySoftwareRendererBudget(viewer, rendererName) {
  const name = rendererName ?? webglRendererName(viewer?.scene?.context?._gl);
  if (!isSoftwareRendererName(name)) return false;
  _active = true;
  viewer.targetFrameRate = SOFTWARE_FRAME_RATE;
  viewer.resolutionScale = SOFTWARE_RESOLUTION_SCALE;
  viewer.useBrowserRecommendedResolution = true;
  const scene = viewer.scene;
  try { scene.msaaSamples = 1; } catch { /* starší Cesium */ }
  // Každý shader sa bez GPU prekladá procesorom a každý priechod kreslí procesor: atmosféra, hmla,
  // HDR a vyhladzovanie FXAA preč — obsah (glóbus, vrstvy, karty) sa nemení.
  try { if (scene.skyAtmosphere) scene.skyAtmosphere.show = false; } catch { /* bez atmosféry */ }
  try { if (scene.fog) scene.fog.enabled = false; } catch { /* bez hmly */ }
  try { if (scene.globe) scene.globe.showGroundAtmosphere = false; } catch { /* bez glóbusu */ }
  try { scene.highDynamicRange = false; } catch { /* starší Cesium */ }
  try { if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = false; } catch { /* bez post-processu */ }
  return true;
}
