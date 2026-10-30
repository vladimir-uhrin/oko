// src/softwareRenderer.js — glóbus bez grafickej karty (2026-10-30, PageSpeed Insights na okolive.sk:
// „stránka prestala reagovať"). Servery PageSpeed/Lighthouse nemajú GPU a WebGL tam kreslí procesor
// (SwiftShader). Cesium so 60 snímkami/s a MSAA 4× tam držalo hlavné vlákno 3–6 s na úlohu (lokálne
// Lighthouse: 107 s skriptu Cesia, TBT 74 s), takže meranie spadlo. To isté by zažil človek
// s počítačom bez ovládača grafiky. Softvérové kreslenie preto beží úsporne: 1 snímka za sekundu,
// bez MSAA, s menším rozlíšením. Obsah stránky sa nemení.

// Názvy softvérových rasterizérov, ako ich hlási WebGL (RENDERER / UNMASKED_RENDERER_WEBGL).
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render driver|mesa offscreen/i;

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
  viewer.targetFrameRate = SOFTWARE_FRAME_RATE;
  viewer.resolutionScale = SOFTWARE_RESOLUTION_SCALE;
  viewer.useBrowserRecommendedResolution = true;
  try { viewer.scene.msaaSamples = 1; } catch { /* starší Cesium */ }
  return true;
}
