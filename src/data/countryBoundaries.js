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
 * DOMAIN, provenance in local_data/boundaries/SOURCE.md).
 *
 * 2026-10-16 (hranice pri priblížení, vlastník: „nevidno, kde je napr. Slovensko"): z entít
 * s clampToGround na JEDEN GroundPolylinePrimitive postavený VOPRED (prewarm) s priehľadným
 * materiálom. Meranie na dev serveri: geometria čiar na teréne sa po prvom zapnutí stavala
 * ~35 s — úlohy vo workeroch čakali za dekódovaním dlaždíc Google počas úvodného preletu, takže
 * po pristátí nad Slovenskom hranice chýbali. Primitívum sa stavia hneď po vytvorení (pod úvodnou
 * obrazovkou); zapnutie a vypnutie len prelína alfu materiálu (FADE_MS), geometria sa neprestavuje.
 */

const dataUrl = new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url).href;

export const COUNTRY_BOUNDARIES_ID = 'country-boundaries';

/** Flat political border line — draped on terrain and 3D Tiles. */
export const LINE_COLOR_CSS = '#f0574d';
export const LINE_ALPHA = 0.6;
export const LINE_WIDTH = 1.4;
/** Prelínanie zapnutia/vypnutia (ms) — bez skoku 393 čiar naraz. */
export const FADE_MS = 500;

// Stena hraníc („plot", Cesium wall 18,7 km) ZRUŠENÁ 2026-10-10 (vlastník: „tú stenu
// hraníc vypni všade"): distanceDisplayCondition sa meria k celej hranici, takže aj
// nad Bratislavou trčala na obzore červená stena vzdialenej hranice. Ostáva len
// plochá čiara.

/**
 * Parse the bundled .geojsonl payload into LineString features. Malformed lines
 * are skipped. Pure.
 * @param {string} text
 * @returns {Array<{geometry:{coordinates:number[][]}}>}
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
      features.push(feature);
    } catch {
      // drop malformed line
    }
  }
  return features;
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

/** Jedno primitívum pre všetky hranice; farba cez uniform materiálu (mení sa bez prestavby). */
function defaultCreatePrimitive({ instances, color }) {
  return new Cesium.GroundPolylinePrimitive({
    geometryInstances: instances,
    classificationType: Cesium.ClassificationType.BOTH,
    appearance: new Cesium.PolylineMaterialAppearance({ material: Cesium.Material.fromType('Color', { color }) }),
    asynchronous: true,
  });
}

const NOOP = Object.freeze({
  show: async () => 0, hide: () => {}, retain: async () => 0, release: () => {}, prewarm: async () => 0, destroy: () => {},
  get count() { return 0; }, get holders() { return []; }, get alpha() { return 0; }, get visible() { return false; },
});

/**
 * @param {object} o
 * @param {object} o.viewer Cesium.Viewer (scene.groundPrimitives, scene.postRender)
 * @param {string} [o.url]
 * @param {Function} [o.fetch]
 * @param {(o: {instances: object[], color: object}) => object} [o.createPrimitive] továreň (testy bez WebGL)
 * @param {() => number} [o.now]
 */
export function createCountryBoundaries({ viewer, url = dataUrl, fetch: fetchImpl, createPrimitive = defaultCreatePrimitive, now = () => (globalThis.performance?.now?.() ?? Date.now()) } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const scene = viewer?.scene;
  if (!scene?.groundPrimitives || !scene?.postRender) return NOOP;
  const baseColor = Cesium.Color.fromCssColorString(LINE_COLOR_CSS);
  let primitive = null;
  let loaded = false;
  let loading = null;
  let count = 0;
  let alpha = 0;
  let target = 0;
  let fading = false;
  let lastTick = 0;

  const setAlpha = (value) => {
    alpha = value;
    const uniforms = primitive?.appearance?.material?.uniforms;
    if (uniforms) uniforms.color = baseColor.withAlpha(value);
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
    if (!primitive || fading || alpha === target) return;
    fading = true;
    lastTick = now();
    scene.postRender.addEventListener(onPostRender);
    scene.requestRender?.();
  };

  async function load() {
    const response = await doFetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const features = parseBoundariesGeojsonl(await response.text());
    if (!features.length) throw new Error('empty dataset');
    const instances = features.map((feature) => {
      const flat = [];
      for (const [lon, lat] of feature.geometry.coordinates) flat.push(lon, lat);
      return new Cesium.GeometryInstance({
        geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width: LINE_WIDTH }),
        id: `${COUNTRY_BOUNDARIES_ID}:line:${feature.id}`,
      });
    });
    // Priehľadné: geometria sa postaví hneď, farba príde až s držiteľom.
    primitive = createPrimitive({ instances, color: baseColor.withAlpha(0) });
    scene.groundPrimitives.add(primitive);
    count = features.length;
    loaded = true;
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
  function destroy() {
    if (fading) scene.postRender.removeEventListener(onPostRender);
    fading = false;
    try { if (primitive) scene.groundPrimitives.remove(primitive); } catch { /* */ }
    primitive = null;
    holders.clear();
    loaded = false;
    loading = null;
    count = 0;
    alpha = 0;
    target = 0;
  }

  return {
    show, hide, retain, release, prewarm, destroy,
    get count() { return count; },
    get holders() { return [...holders]; },
    /** Aktuálna alfa čiar (0 = neviditeľné). */
    get alpha() { return alpha; },
    /** Chce ich niekto (cieľová alfa > 0)? */
    get visible() { return target > 0; },
  };
}
