// src/farGlobe.js — Zem z výšky (2026-10-16, vlastník ukázal NASA „Zem v noci": „toto je nádherné",
// „ešte aj vesmír je nádherný na tej fotke" → „ako to robia na mapách").
//
// Google 3D fotoreál je mesh — imagery vrstvy (nočné svetlá NASA) sa naň položiť nedajú a experimentálne
// draping v Cesiu 1.138 zamrzlo stránku pri pohľade na Európu. Mapy to riešia tak, že z výšky je Zem
// GLÓBUS s imagery a 3D mesh príde až zblízka. Tu rovnako: nad FAR_GLOBE_ENTER_M (1 000 km) sa Google
// tileset skryje a ukáže sa glóbus s NASA Blue Marble (deň) a NASA Black Marble naplno (noc, `dayAlpha` 0 /
// `nightAlpha` 1 — terminátor kreslí Cesium), pod FAR_GLOBE_EXIT_M (700 km) sa vráti fotoreál (hysteréza,
// nech na hranici nebliká). Počas preletu kamery (scene.tweens) ostáva fotoreál, aby si tileset prednačítal cieľ
// (preloadFlightDestinations) a pristátie bolo ostré. Vedľajší efekt: z výšky žiadne Google dlaždice.
//
// Osvetlenie: štandardné prelínanie 1 500–4 000 km (globeLighting.js) je pre mapy ulíc; nočná Zem z výšky
// potrebuje plnú noc už od ~1 000 km, preto diaľkový režim píše vlastné vzdialenosti a pri odchode ich
// vráti cez applyGlobeLighting. Vypnuté Deň/noc = bez nočnej vrstvy (len Blue Marble).
//
// Platí len pre podklad 'photoreal'; glóbusové podklady (OSM, Stadia, KARTA, Bing) majú glóbus vždy
// a riadi ich MapStackController. Pri prepnutí podkladu sa diaľkový režim stiahne a radič si glóbus
// nastaví sám. Čisté funkcie bez Cesia; zapojenie dostáva viewer a továrne vrstiev (testy bez WebGL).
import * as Cesium from 'cesium';
import { GLOBE_RADIUS_M, applyGlobeLighting, isGlobeLightingEnabled } from './globeLighting.js';
import { IMAGERY_ROLE, tagImageryRole } from './imageryOrder.js';

/** Deň: nad touto výškou kamery (m) sa ukáže glóbus; Blue Marble (500 m/px) je zblízka mäkšia než Google. */
export const FAR_GLOBE_ENTER_M = 1_000_000;
/** Deň: pod touto výškou (m) sa vráti fotoreál (hysteréza 300 km). */
export const FAR_GLOBE_EXIT_M = 700_000;
/** Noc (Slnko pod −6° nad cieľom): glóbus drží dlhšie, lebo fotoreál v noci je len stlmený denný obraz —
 *  ale len kým je OSTRÝ (vlastník: „musí to byť ostré"): Black Marble má 500 m/px a pri 600 km výšky je to
 *  ~1 texel na pixel (záber ≈ 1,15 × výška na 1 440 px); nižšie by sa dlaždice zväčšovali a mäkli. */
export const FAR_GLOBE_NIGHT_ENTER_M = 850_000;
export const FAR_GLOBE_NIGHT_EXIT_M = 600_000;
export const NIGHT_SUN_ELEVATION_DEG = -6;
/** Podklady, ktoré majú glóbus skrytý (len tam má diaľkový režim zmysel). */
export const FAR_GLOBE_STACKS = Object.freeze(['photoreal']);
/** Osvetlenie v diaľkovom režime (výšky nad povrchom): noc naplno už pod nočným prahom návratu. */
export const FAR_GLOBE_LIGHTING_M = Object.freeze({ fadeOut: 450_000, fadeIn: 560_000 });
/** Štart: preloader počká, kým má glóbus z výšky dlaždice (inak by sa ukázala čierna Zem), najviac toľko ms. */
export const FAR_GLOBE_READY_CAP_MS = 3000;
/**
 * Štýl nočnej vrstvy (ladené na snímkach 2026-10-16, Európa z 2 500 a 7 000 km): Cesium tlmí nočnú stranu
 * na 0,3 (GlobeFS `lambert * 5 + 0.3`) a tlmí ňou aj Black Marble — bez zosilnenia boli svetlá sivé a Zem
 * čierna. Jas 3,5 × 0,3 ≈ 1 vráti zlaté svetlá, gama 0,8 zdvihne slabšie mestá, kontrast drží tmavú zem.
 */
export const FAR_GLOBE_NIGHT_STYLE = Object.freeze({ brightness: 3.5, contrast: 1.1, gamma: 0.8 });
export const FAR_GLOBE_DAY_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
export const FAR_GLOBE_NIGHT_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';
export const FAR_GLOBE_DAY_CREDIT = 'NASA EOSDIS GIBS / Worldview · Blue Marble (MODIS)';
export const FAR_GLOBE_NIGHT_CREDIT = 'NASA EOSDIS GIBS / Worldview · VIIRS Black Marble (Suomi NPP)';

/**
 * Chce sa glóbus z výšky? (pure; `far` = doterajší stav kvôli hysteréze, `flying` = prelet kamery)
 * @param {{heightM?: number, stackId?: string|null, far?: boolean, flying?: boolean, stacks?: readonly string[], enterM?: number, exitM?: number}} o
 * @returns {boolean}
 */
export function farGlobeWanted({
  heightM, stackId = null, far = false, flying = false, night = false,
  stacks = FAR_GLOBE_STACKS, enterM = night ? FAR_GLOBE_NIGHT_ENTER_M : FAR_GLOBE_ENTER_M, exitM = night ? FAR_GLOBE_NIGHT_EXIT_M : FAR_GLOBE_EXIT_M,
} = {}) {
  if (!stacks.includes(stackId)) return false;
  if (flying) return false;
  if (!Number.isFinite(heightM)) return far;
  return far ? heightM > exitM : heightM > enterM;
}

/**
 * Výška Slnka (°) nad bodom na povrchu pod kamerou v daný čas — rozhoduje deň/noc pre prahy.
 * Smer Slnka v inerciálnej sústave (Simon 1994) → pevná sústava Zeme cez TEME→pseudo-fixed (len rotácia
 * Zeme; ICRF→fixed by sťahovalo tabuľky IAU a v Node padalo na sieti — pre prah −6° je presnosť zbytočná),
 * uhol k normále elipsoidu v bode.
 * @param {object} cartographic Cesium.Cartographic (poloha kamery)
 * @param {object} julianDate Cesium.JulianDate
 * @returns {number} stupne; NaN bez vstupov
 */
export function sunElevationDegAt(cartographic, julianDate) {
  if (!cartographic || !julianDate) return NaN;
  const sunInertial = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate, new Cesium.Cartesian3());
  const toFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(julianDate, new Cesium.Matrix3());
  const sunFixed = Cesium.Matrix3.multiplyByVector(toFixed, sunInertial, new Cesium.Cartesian3());
  const dir = Cesium.Cartesian3.normalize(sunFixed, new Cesium.Cartesian3());
  const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(cartographic, new Cesium.Cartesian3());
  return Cesium.Math.toDegrees(Math.asin(Math.max(-1, Math.min(1, Cesium.Cartesian3.dot(normal, dir)))));
}

function defaultCreateDayLayer() {
  return new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    url: FAR_GLOBE_DAY_URL, tileWidth: 256, tileHeight: 256, maximumLevel: 8, credit: FAR_GLOBE_DAY_CREDIT,
  }));
}
function defaultCreateNightLayer() {
  return new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    url: FAR_GLOBE_NIGHT_URL, tileWidth: 256, tileHeight: 256, maximumLevel: 8, credit: FAR_GLOBE_NIGHT_CREDIT,
  }), { dayAlpha: 0, nightAlpha: 1 });
}

const NOOP = Object.freeze({ far: false, whenReady: Promise.resolve(false), check() { return false; }, destroy() {} });

/**
 * Zapojenie: po vykreslení (najviac raz za `minIntervalMs`) rozhodne a prepne; kým je glóbus z výšky
 * aktívny, drží prísne osvetlenie a nočnú vrstvu podľa Deň/noc.
 * @param {object} o
 * @param {object} o.viewer Cesium.Viewer (scene.globe, scene.camera, scene.tweens, scene.postRender, imageryLayers)
 * @param {{show: boolean}|null} o.tileset Google fotoreál (null = diaľkový režim netreba)
 * @param {() => string|null} o.getStackId aktívny podklad
 * @param {() => object} [o.createDayLayer] továreň dennej vrstvy (testy)
 * @param {() => object} [o.createNightLayer] továreň nočnej vrstvy (testy)
 * @param {(scene: object) => boolean} [o.isNight] noc nad cieľom (predvolene Slnko pod −6°, testy injektujú)
 * @param {(far: boolean) => void} [o.onFarChange] volá sa pri vstupe (true) a odchode (false) — napr. jas lietadiel
 * @param {(fn: Function, ms: number) => unknown} [o.setTimer]
 * @returns {{far: boolean, whenReady: Promise<boolean>, check: (force?: boolean) => boolean, destroy: () => void}}
 *   `whenReady`: glóbus z výšky má dlaždice (alebo režim netreba / strop) — štart naň počká.
 */
export function installFarGlobe({
  viewer, tileset, getStackId,
  createDayLayer = defaultCreateDayLayer, createNightLayer = defaultCreateNightLayer,
  isNight = (sc) => sunElevationDegAt(sc?.camera?.positionCartographic, viewer?.clock?.currentTime) < NIGHT_SUN_ELEVATION_DEG,
  onFarChange = null,
  now = Date.now, minIntervalMs = 250, readyCapMs = FAR_GLOBE_READY_CAP_MS, setTimer = globalThis.setTimeout,
} = {}) {
  const scene = viewer?.scene;
  if (!tileset || !scene?.globe || !scene?.postRender?.addEventListener || !viewer?.imageryLayers || typeof getStackId !== 'function') return NOOP;
  let far = false;
  let lastAt = -Infinity;
  let dayLayer = null;
  let nightLayer = null;
  let resolveReady = () => {};
  let readySettled = false;
  const whenReady = new Promise((resolve) => { resolveReady = (value) => { if (!readySettled) { readySettled = true; resolve(value); } }; });
  setTimer(() => resolveReady(false), readyCapMs);

  const tightLighting = () => {
    const globe = scene.globe;
    const fadeOut = GLOBE_RADIUS_M + FAR_GLOBE_LIGHTING_M.fadeOut;
    const fadeIn = GLOBE_RADIUS_M + FAR_GLOBE_LIGHTING_M.fadeIn;
    if (globe.lightingFadeOutDistance !== fadeOut) globe.lightingFadeOutDistance = fadeOut;
    if (globe.lightingFadeInDistance !== fadeIn) globe.lightingFadeInDistance = fadeIn;
    // Bez Deň/noc by Cesium nočnú vrstvu kreslilo všade (dayAlpha platí len s osvetlením) — skryť.
    const lit = isGlobeLightingEnabled(scene);
    if (nightLayer && nightLayer.show !== lit) { nightLayer.show = lit; scene.requestRender?.(); }
  };

  const enter = () => {
    far = true;
    tileset.show = false;
    dayLayer = tagImageryRole(createDayLayer(), IMAGERY_ROLE.base);
    viewer.imageryLayers.add(dayLayer, 0);
    nightLayer = tagImageryRole(createNightLayer(), IMAGERY_ROLE.nightLights);
    nightLayer.dayAlpha = 0;
    nightLayer.nightAlpha = 1;
    nightLayer.brightness = FAR_GLOBE_NIGHT_STYLE.brightness;
    nightLayer.contrast = FAR_GLOBE_NIGHT_STYLE.contrast;
    nightLayer.gamma = FAR_GLOBE_NIGHT_STYLE.gamma;
    viewer.imageryLayers.add(nightLayer); // navrch — nad prípadné prekryvy NASA
    scene.globe.show = true;
    tightLighting();
    scene.requestRender?.();
    try { onFarChange?.(true); } catch { /* doplnok (jas lietadiel) nesmie zhodiť režim */ }
  };

  /** @param {{hideGlobe: boolean}} o hideGlobe = podklad je stále fotoreál (radič glóbus nespravuje) */
  const exit = ({ hideGlobe }) => {
    far = false;
    for (const layer of [nightLayer, dayLayer]) {
      if (!layer) continue;
      try { viewer.imageryLayers.remove(layer, true); } catch { /* už odstránená */ }
    }
    dayLayer = null;
    nightLayer = null;
    if (hideGlobe) {
      scene.globe.show = false;
      tileset.show = true;
    }
    applyGlobeLighting(scene, isGlobeLightingEnabled(scene)); // štandardné vzdialenosti späť
    scene.requestRender?.();
    try { onFarChange?.(false); } catch { /* doplnok */ }
  };

  const check = (force = false) => {
    const t = now();
    if (!force && t - lastAt < minIntervalMs) return far;
    lastAt = t;
    const stackId = getStackId();
    const heightM = scene.camera?.positionCartographic?.height;
    const flying = (scene.tweens?.length ?? 0) > 0;
    let night = false;
    try { night = isNight(scene) === true; } catch { night = false; }
    const wanted = farGlobeWanted({ heightM, stackId, far, flying, night });
    if (wanted && !far) enter();
    else if (!wanted && far) exit({ hideGlobe: FAR_GLOBE_STACKS.includes(stackId) });
    else if (far) tightLighting();
    // Štart: Zem z výšky je „pripravená", keď má glóbus dlaždice; bez režimu niet na čo čakať.
    if (!readySettled) {
      if (!far && !flying) resolveReady(false);
      else if (far && scene.globe.tilesLoaded === true) resolveReady(true);
    }
    return far;
  };
  const onPostRender = () => { check(false); };
  scene.postRender.addEventListener(onPostRender);

  return {
    get far() { return far; },
    whenReady,
    check,
    destroy() {
      scene.postRender.removeEventListener?.(onPostRender);
      resolveReady(false);
      if (far) exit({ hideGlobe: FAR_GLOBE_STACKS.includes(getStackId()) });
    },
  };
}
