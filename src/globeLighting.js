/**
 * Deň/noc na glóbuse — Flightradar-style terminátor (2026-09-05).
 *
 * Cesium osvetľuje glóbus podľa REÁLNEJ polohy Slnka (viewer.clock beží v
 * reálnom čase, Slnko sa v appke už počíta pre celestialRing). Zapnutie je
 * jeden príznak; podstatné je ladenie vzdialeností: pri pohľade na svet má byť
 * terminátor vidieť, pri priblížení na mesto NIE — nočná ulica by bola
 * nečitateľná čierna. Preto osvetlenie plne platí od LIGHTING_FADE_IN_M a pod
 * LIGHTING_FADE_OUT_M je vypnuté (Cesium medzi nimi lineárne prelína).
 *
 * Platí len pre GLÓBUS (OSM, Bing, Stadia). Google 3D fotoreál má tiene
 * zapečené v dlaždiciach a glóbus pod ním je skrytý — tam terminátor nie je.
 * Voľba je session-only (ako priezor), bez share-link kľúča.
 */

/** Pod touto výškou kamery (m) je osvetlenie vypnuté — mesto ostáva vo dne. */
export const LIGHTING_FADE_OUT_M = 1_500_000;
/** Od tejto výšky kamery (m) platí osvetlenie naplno — terminátor pri pohľade na svet. */
export const LIGHTING_FADE_IN_M = 4_000_000;

/**
 * Zapni/vypni osvetlenie glóbusu podľa Slnka. Bezpečné bez DOM aj bez
 * atmosféry (staršie/mockované scény): nastaví len to, čo scéna má.
 * @param {object|null} scene Cesium Scene (alebo mock s `globe`).
 * @param {boolean} enabled
 * @returns {boolean} výsledný stav (false ak scéna nemá glóbus)
 */
export function applyGlobeLighting(scene, enabled) {
  const globe = scene?.globe;
  if (!globe) return false;
  const on = enabled === true;
  globe.enableLighting = on;
  // Ladenie vzdialeností sa píše vždy — aj pri vypnutí — nech je stav
  // deterministický a re-zapnutie nezdedí cudzie hodnoty.
  globe.lightingFadeOutDistance = LIGHTING_FADE_OUT_M;
  globe.lightingFadeInDistance = LIGHTING_FADE_IN_M;
  // Atmosféra podľa Slnka: limb potemnie na nočnej strane. Vlastnosti
  // pribudli v novších Cesiumoch — nastaviť len ak existujú.
  if ('dynamicAtmosphereLighting' in globe) globe.dynamicAtmosphereLighting = on;
  if ('dynamicAtmosphereLightingFromSun' in globe) globe.dynamicAtmosphereLightingFromSun = on;
  scene.requestRender?.();
  return on;
}

/**
 * Prečítaj stav osvetlenia zo scény (pre testy a HUD).
 * @param {object|null} scene
 * @returns {boolean}
 */
export function isGlobeLightingEnabled(scene) {
  return scene?.globe?.enableLighting === true;
}
