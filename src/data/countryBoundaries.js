import * as Cesium from 'cesium';

/**
 * Country boundaries — international land borders drawn on the globe with a
 * chokepoint/strike reveal (2026-09-18, user: „chcel by som to … aj s tými
 * hranicami" — the upstream "Iran War Infrastructure" reveal shows borders).
 *
 * A STANDALONE scene overlay (not a data-manager layer): the share-link token
 * space is full, and borders are ambient political context turned on with a
 * scene (and since 2026-10-16 with zoom — zoomBorders.js), not a persisted/shared toggle.
 *
 * Static bundled data (Natural Earth 1:50m admin-0 boundary lines — PUBLIC
 * DOMAIN, provenance in local_data/boundaries/SOURCE.md). Od 2026-10-16 nesie každá čiara
 * `properties.l`/`r` (ISO2 štátu vľavo/vpravo, dopočítané v scripts/build-boundaries.mjs) a
 * `cls` ('international' | 'disputed'): sporné čiary a línie kontroly sú čiarkované ako na
 * mapách OSN; de facto čiara Krymu (Perekop) v datasete nie je.
 *
 * 2026-10-16 (hranice pri priblížení, vlastník: „nevidno, kde je napr. Slovensko"): z entít
 * s clampToGround na GroundPolylinePrimitive postavené VOPRED (prewarm) s priehľadným
 * materiálom. Meranie na dev serveri: geometria čiar na teréne sa po prvom zapnutí stavala
 * ~35 s — úlohy vo workeroch čakali za dekódovaním dlaždíc Google počas úvodného preletu, takže
 * po pristátí nad Slovenskom hranice chýbali. Primitíva sa stavajú hneď po vytvorení (pod úvodnou
 * obrazovkou); zapnutie a vypnutie len prelína alfu materiálu (FADE_MS), geometria sa neprestavuje.
 *
 * Domovská krajina (vlastník: „ak je IP napr. SK, treba trocha hranice zvýrazniť"): `highlight(iso2)`
 * postaví tretie primitívum z čiar, ktoré sa jej dotýkajú — hrubšie a sýtejšie, nad základnými.
 */

const dataUrl = new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url).href;

export const COUNTRY_BOUNDARIES_ID = 'country-boundaries';

/** Flat political border line — draped on terrain and 3D Tiles. */
export const LINE_COLOR_CSS = '#f0574d';
// 2026-10-16 (vlastník: „tá čiara hraníc je pod uhlom trhaná"): pri plochom pohľade (551 km, sklon −31°,
// Jadran → Balkán) sa 1,4 px čiara na teréne rozpadla na čiarky — šírka pod pixel pri šikmom priemete;
// delenie segmentov, typ klasifikácie ani vypnuté zaostrenie nepomohli, od 2,0 px je súvislá. 2,2 px
// s nižšou alfou 0,45 má podobnú váhu ako 1,4 px × 0,6 a ostáva jemná (porovnanie výrezov v scratchpade).
export const LINE_ALPHA = 0.45;
export const LINE_WIDTH = 2.2;
/** Sporné čiary: čiarka + medzera v px obrazovky (PolylineDash). */
export const DISPUTED_DASH_LENGTH = 14;
/** Domovská krajina podľa pripojenia: hrubšia a sýtejšia (alfa = LINE_ALPHA × boost, najviac HOME_ALPHA_MAX). */
export const HOME_WIDTH = 3.2;
export const HOME_ALPHA_BOOST = 1.7;
export const HOME_ALPHA_MAX = 0.85;
/** Prelínanie zapnutia/vypnutia (ms) — bez skoku stoviek čiar naraz. */
export const FADE_MS = 500;

// Stena hraníc („plot", Cesium wall 18,7 km) ZRUŠENÁ 2026-10-10 (vlastník: „tú stenu
// hraníc vypni všade"): distanceDisplayCondition sa meria k celej hranici, takže aj
// nad Bratislavou trčala na obzore červená stena vzdialenej hranice. Ostáva len
// plochá čiara.

/**
 * Parse the bundled .geojsonl payload into LineString features. Malformed lines
 * are skipped. Pure.
 * @param {string} text
 * @returns {Array<{id: number|string, geometry:{coordinates:number[][]}, properties: {l?: string|null, r?: string|null, cls?: string}}>}
 */
export function parseBoundariesGeojsonl(text) {
  const features = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const feature = JSON.parse(trimmed);
      if (feature?.geometry?.type !== 'LineString') continue;
      if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) continue;
      if (!feature.properties || typeof feature.properties !== 'object') feature.properties = {};
      features.push(feature);
    } catch {
      // drop malformed line
    }
  }
  return features;
}

/** Čiary, ktoré sa dotýkajú štátu `iso2` (vľavo alebo vpravo). Pure. */
export function homeLines(features, iso2) {
  const code = String(iso2 || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return [];
  return features.filter((f) => f.properties?.l === code || f.properties?.r === code);
}

/** Alfa domovských čiar z alfy základných. Pure. */
export function homeAlpha(baseAlpha) {
  return Math.min(HOME_ALPHA_MAX, baseAlpha * HOME_ALPHA_BOOST);
}

/**
 * Krok prelínania alfy (pure): k cieľu rýchlosťou `span / fadeMs`, nikdy cez cieľ.
 * @param {number} current
 * @param {number} target
 * @param {number} dtMs
 */
export function fadeStep(current, target, dtMs, { fadeMs = FADE_MS, span = LINE_ALPHA } = {}) {
  if (!(dtMs > 0) || current === target) return current;
  const step = (span * dtMs) / fadeMs;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * Jedno primitívum pre skupinu čiar; farba cez uniform materiálu (mení sa bez prestavby).
 * `dash` = čiarkovaný materiál (sporné hranice), medzery priehľadné.
 */
function defaultCreatePrimitive({ instances, color, dash = false }) {
  const material = dash
    ? Cesium.Material.fromType('PolylineDash', { color, gapColor: Cesium.Color.TRANSPARENT, dashLength: DISPUTED_DASH_LENGTH })
    : Cesium.Material.fromType('Color', { color });
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: Cesium.ClassificationType.BOTH,
    appearance: new Cesium.PolylineMaterialAppearance({ material, translucent: true }),
    allowPicking: false,
    asynchronous: true,
  });
}

const NOOP = Object.freeze({
  show: async () => 0, hide: () => {}, retain: async () => 0, release: () => {}, prewarm: async () => 0, highlight: () => {}, destroy: () => {},
  get count() { return 0; }, get holders() { return []; }, get alpha() { return 0; }, get visible() { return false; }, get home() { return null; },
});

/**
 * @param {object} o
 * @param {object} o.viewer Cesium.Viewer (scene.groundPrimitives, scene.postRender)
 * @param {string} [o.url]
 * @param {Function} [o.fetch]
 * @param {(o: {instances: object[], color: object, dash?: boolean, kind: 'solid'|'dashed'|'home'}) => object} [o.createPrimitive] továreň (testy bez WebGL)
 * @param {() => number} [o.now]
 */
export function createCountryBoundaries({ viewer, url = dataUrl, fetch: fetchImpl, createPrimitive = defaultCreatePrimitive, now = () => (globalThis.performance?.now?.() ?? Date.now()) } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const scene = viewer?.scene;
  if (!scene?.groundPrimitives || !scene?.postRender) return NOOP;
  const baseColor = Cesium.Color.fromCssColorString(LINE_COLOR_CSS);
  /** @type {Array<{id: number|string, geometry: {coordinates: number[][]}, properties: object}>} */
  let features = [];
  const primitives = { solid: null, dashed: null, home: null };
  let loaded = false;
  let loading = null;
  let count = 0;
  let alpha = 0;
  let target = 0;
  let fading = false;
  let lastTick = 0;
  let homeIso2 = null;

  const applyColor = (prim, value) => {
    const uniforms = prim?.appearance?.material?.uniforms;
    if (uniforms) uniforms.color = baseColor.withAlpha(value);
  };
  const setAlpha = (value) => {
    alpha = value;
    applyColor(primitives.solid, value);
    applyColor(primitives.dashed, value);
    applyColor(primitives.home, homeAlpha(value));
  };
  const onPostRender = () => {
    const t = now();
    const dt = t - lastTick; // prelínanie beží od okamihu požiadavky (fadeTo), nie od prvého snímku
    lastTick = t;
    const next = fadeStep(alpha, target, dt);
    if (next !== alpha) setAlpha(next);
    if (next === target) {
      fading = false;
      scene.postRender.removeEventListener(onPostRender);
    }
    scene.requestRender?.();
  };
  /** Cieľová alfa; prelínanie beží po snímkach, kým je čo meniť. */
  const fadeTo = (value) => {
    target = value;
    if (!loaded || fading || alpha === target) return;
    fading = true;
    lastTick = now();
    scene.postRender.addEventListener(onPostRender);
    scene.requestRender?.();
  };

  const instanceOf = (feature, width) => {
    const flat = [];
    for (const [lon, lat] of feature.geometry.coordinates) flat.push(lon, lat);
    return new Cesium.GeometryInstance({
      geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width }),
      id: `${COUNTRY_BOUNDARIES_ID}:line:${feature.id}`,
    });
  };
  const build = (kind, list, width, color, dash) => {
    if (!list.length) return null;
    const prim = createPrimitive({ instances: list.map((f) => instanceOf(f, width)), color, dash, kind });
    scene.groundPrimitives.add(prim);
    return prim;
  };
  /** Domovská krajina: tretie primitívum nad základnými; pri zmene sa staré odstráni. */
  const rebuildHome = () => {
    if (primitives.home) {
      try { scene.groundPrimitives.remove(primitives.home); } catch { /* */ }
      primitives.home = null;
    }
    if (!loaded || !homeIso2) return;
    primitives.home = build('home', homeLines(features, homeIso2), HOME_WIDTH, baseColor.withAlpha(homeAlpha(alpha)), false);
    scene.requestRender?.();
  };

  async function load() {
    const response = await doFetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    features = parseBoundariesGeojsonl(await response.text());
    if (!features.length) throw new Error('empty dataset');
    // Priehľadné: geometria sa postaví hneď, farba príde až s držiteľom.
    const transparent = baseColor.withAlpha(0);
    primitives.solid = build('solid', features.filter((f) => f.properties.cls !== 'disputed'), LINE_WIDTH, transparent, false);
    primitives.dashed = build('dashed', features.filter((f) => f.properties.cls === 'disputed'), LINE_WIDTH, transparent, true);
    count = features.length;
    loaded = true;
    rebuildHome();
    if (target > 0) fadeTo(target); // vyžiadané ešte počas načítania
    scene.requestRender?.();
    console.log(`[CountryBoundaries] Loaded ${features.length} border lines`);
  }

  // Držitelia (2026-09-19): hranice si môže vyžiadať scéna úžiny AJ vrstva
  // potrubí („hranice si vyhodil" — rúry sú cezhraničná infraštruktúra a bez
  // hraníc „kam tečie" nemá kontext), od 2026-10-16 aj priblíženie ('zoom').
  // Kreslia sa, kým ich drží aspoň jeden; uvoľnenie jedného držiteľa druhému hranice nezoberie.
  const holders = new Set();
  async function ensureLoaded() {
    if (!loaded && !loading) {
      loading = load().catch((err) => { console.error('[CountryBoundaries] load error:', err); }).finally(() => { loading = null; });
    }
    if (loading) await loading;
    return count;
  }
  /** Postav geometriu vopred (pod úvodnou obrazovkou); hranice ostanú priehľadné, kým ich niekto nevyžiada. */
  async function prewarm() { return ensureLoaded(); }
  async function retain(owner = 'scene') {
    holders.add(String(owner));
    fadeTo(LINE_ALPHA);
    return ensureLoaded();
  }
  function release(owner = 'scene') {
    holders.delete(String(owner));
    if (holders.size === 0) fadeTo(0);
  }
  /** Scéna: zapni (držiteľ 'scene'). */
  async function show() { return retain('scene'); }
  /** Scéna: pusti — hranice ostanú, ak ich drží iný držiteľ. */
  function hide() { release('scene'); }
  /** Domovská krajina (ISO2 z pripojenia) — jej hranice hrubšie a sýtejšie; null = bez zvýraznenia. */
  function highlight(iso2) {
    const code = String(iso2 || '').toUpperCase();
    const next = /^[A-Z]{2}$/.test(code) ? code : null;
    if (next === homeIso2) return;
    homeIso2 = next;
    rebuildHome();
  }
  function destroy() {
    if (fading) scene.postRender.removeEventListener(onPostRender);
    fading = false;
    for (const key of Object.keys(primitives)) {
      try { if (primitives[key]) scene.groundPrimitives.remove(primitives[key]); } catch { /* */ }
      primitives[key] = null;
    }
    holders.clear();
    features = [];
    loaded = false;
    loading = null;
    count = 0;
    alpha = 0;
    target = 0;
  }

  return {
    show, hide, retain, release, prewarm, highlight, destroy,
    get count() { return count; },
    get holders() { return [...holders]; },
    /** Aktuálna alfa čiar (0 = neviditeľné). */
    get alpha() { return alpha; },
    /** Chce ich niekto (cieľová alfa > 0)? */
    get visible() { return target > 0; },
    /** Zvýraznená domovská krajina (ISO2) alebo null. */
    get home() { return homeIso2; },
  };
}
