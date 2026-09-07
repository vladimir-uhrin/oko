import * as Cesium from 'cesium';

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

/** Pod touto VÝŠKOU kamery (m nad povrchom) je osvetlenie vypnuté — mesto ostáva vo dne. */
export const LIGHTING_FADE_OUT_M = 1_500_000;
/** Od tejto VÝŠKY kamery (m nad povrchom) platí osvetlenie naplno — terminátor pri pohľade na svet. */
export const LIGHTING_FADE_IN_M = 4_000_000;

/**
 * Polomer Zeme (WGS84 rovníkový), ktorý treba k výškam PRIPOČÍTAŤ.
 *
 * Cesium v 3D meria `lightingFadeOutDistance`/`lightingFadeInDistance` od
 * STREDU Zeme (GlobeFS: `cameraDist = length(czm_view[3])`; polomer odčíta
 * len v 2D a Columbus view). Vlastné defaulty Cesia sú 1e7/2e7 — teda
 * ~3 600/13 600 km NAD povrchom. Holé 1,5/4 Mm sú pod polomerom, takže
 * prelínanie nikdy nenastalo a nočná strana bola tmavá aj pri 700 km
 * (2026-09-04 „tmavá mapa"; zmerané 2026-09-06 pri 800 km). Konštanty vyššie
 * ostávajú výšky — to je jazyk návrhu aj dokumentácie — a na glóbus sa píšu
 * cez `lightingFadeDistancesFromCentre()`.
 */
export const GLOBE_RADIUS_M = 6_378_137;

/**
 * Vzdialenosti pre glóbus v jeho vlastnej sústave (od stredu Zeme).
 * @returns {{ fadeOut: number, fadeIn: number }}
 */
export function lightingFadeDistancesFromCentre() {
  return { fadeOut: GLOBE_RADIUS_M + LIGHTING_FADE_OUT_M, fadeIn: GLOBE_RADIUS_M + LIGHTING_FADE_IN_M };
}

/**
 * Sila osvetlenia pre danú výšku kamery — 0 pod fade-out, 1 od fade-in,
 * lineárne medzi tým; to isté, čo počíta shader glóbusu. Pure. Používajú ju
 * vrstvy, ktoré majú ísť s terminátorom ruka v ruke (nočné svetlá miest:
 * pri vypnutom osvetlení by svietili cez denne jasnú mapu).
 * @param {number} heightM výška kamery nad povrchom (m); neplatná = 1 (pohľad na svet)
 * @returns {number} 0..1
 */
export function lightingFadeFactor(heightM) {
  if (!Number.isFinite(heightM)) return 1;
  const t = (heightM - LIGHTING_FADE_OUT_M) / (LIGHTING_FADE_IN_M - LIGHTING_FADE_OUT_M);
  return Math.min(1, Math.max(0, t));
}

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
  const { fadeOut, fadeIn } = lightingFadeDistancesFromCentre();
  globe.lightingFadeOutDistance = fadeOut;
  globe.lightingFadeInDistance = fadeIn;
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

/** Ako často si osvetlený glóbus vyžiada snímok, aby terminátor lezol aj v idle (m). */
export const DAY_NIGHT_TICK_MS = 60_000;

/**
 * Pusti hodiny scény v REÁLNOM čase a drž terminátor v pohybe (2026-09-06,
 * „nefunguje deň/noc").
 *
 * Cesium Viewer štartuje s `clock.shouldAnimate = false`: `currentTime`
 * ostane na čase načítania stránky a Slnko — teda terminátor — s ním.
 * Namerané: po hodine otvorenej appky 59 min driftu ≈ 15° dĺžky; po dni je
 * terminátor úplne mimo. `ClockStep.SYSTEM_CLOCK` + `shouldAnimate` znamená
 * „currentTime = systémový čas pri každom ticku" — žiadna animácia dát,
 * vrstvy čítajú `clock.currentTime` len ako argument `getValue` konštantných
 * vlastností (overené grepom: žiadne Sampled/availability), takže sa im nič
 * nezmení. Render governor v idle nekreslí sám od seba — preto minútový tik,
 * ktorý si vyžiada snímok LEN keď je osvetlenie zapnuté (0,25°/min pohybu
 * terminátora inak nevidno, kým sa nepohne kamera alebo dáta).
 * @param {object|null} viewer Cesium Viewer (alebo mock s `clock`).
 * @param {object} [deps]
 * @param {(reason: string) => void} [deps.requestRender]
 * @param {typeof setInterval} [deps.setIntervalImpl]
 * @param {typeof clearInterval} [deps.clearIntervalImpl]
 * @returns {(() => void)|null} zastavenie tiku; null bez hodín
 */
export function installDayNightClock(viewer, {
  requestRender = () => {},
  setIntervalImpl = (fn, ms) => globalThis.setInterval(fn, ms),
  clearIntervalImpl = (id) => globalThis.clearInterval(id),
} = {}) {
  const clock = viewer?.clock;
  if (!clock) return null;
  clock.clockStep = Cesium.ClockStep.SYSTEM_CLOCK;
  clock.multiplier = 1;
  clock.shouldAnimate = true;
  const id = setIntervalImpl(() => {
    if (isGlobeLightingEnabled(viewer.scene)) requestRender('day-night-tick');
  }, DAY_NIGHT_TICK_MS);
  return () => clearIntervalImpl(id);
}
