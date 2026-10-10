import * as Cesium from 'cesium';

/**
 * Country boundaries — international land borders drawn on the globe with a
 * chokepoint/strike reveal (2026-09-18, user: „chcel by som to … aj s tými
 * hranicami" — the upstream "Iran War Infrastructure" reveal shows borders).
 *
 * A STANDALONE scene overlay (not a data-manager layer): the share-link token
 * space is full, and borders are ambient political context turned on with a
 * scene, not a persisted/shared toggle. It owns one CustomDataSource of amber
 * polylines draped on the terrain, loaded lazily on first show.
 *
 * Static bundled data (Natural Earth 1:50m admin-0 boundary lines — PUBLIC
 * DOMAIN, provenance in local_data/boundaries/SOURCE.md).
 */

const dataUrl = new URL('./local_data/boundaries/boundaries.geojsonl', import.meta.url).href;

export const COUNTRY_BOUNDARIES_ID = 'country-boundaries';

/** Flat political border line — always visible (map context), draped on the
 *  terrain. */
const LINE_COLOR = Cesium.Color.fromCssColorString('#f0574d').withAlpha(0.6);
const LINE_WIDTH = 1.4;

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

export function createCountryBoundaries({ viewer, url = dataUrl, fetch: fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  if (!viewer?.dataSources) {
    return { show: async () => 0, hide: () => {}, retain: async () => 0, release: () => {}, destroy: () => {}, get count() { return 0; }, get holders() { return []; } };
  }
  const ds = new Cesium.CustomDataSource(COUNTRY_BOUNDARIES_ID);
  ds.show = false;
  try { viewer.dataSources.add(ds); } catch { /* headless */ }
  let loaded = false;
  let loading = null;
  let count = 0;

  async function load() {
    const response = await doFetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const features = parseBoundariesGeojsonl(await response.text());
    if (!features.length) throw new Error('empty dataset');
    const lineMaterial = new Cesium.ColorMaterialProperty(LINE_COLOR);
    for (const feature of features) {
      const coords = feature.geometry.coordinates;
      const flat = [];
      for (const [lon, lat] of coords) flat.push(lon, lat);
      const positions = Cesium.Cartesian3.fromDegreesArray(flat);
      // Flat border line — always on (map context, „hranice nechaj").
      ds.entities.add({
        id: `${COUNTRY_BOUNDARIES_ID}:line:${feature.id}`,
        polyline: { positions, width: LINE_WIDTH, material: lineMaterial, clampToGround: true },
      });
    }
    count = features.length;
    loaded = true;
    viewer.scene?.requestRender?.();
    console.log(`[CountryBoundaries] Loaded ${features.length} border lines`);
  }

  // Držitelia (2026-09-19): hranice si môže vyžiadať scéna úžiny AJ vrstva
  // potrubí („hranice si vyhodil" — rúry sú cezhraničná infraštruktúra a bez
  // hraníc „kam tečie" nemá kontext). Kreslia sa, kým ich drží aspoň jeden;
  // uvoľnenie jedného držiteľa druhému hranice nezoberie.
  const holders = new Set();
  async function ensureLoaded() {
    if (!loaded && !loading) {
      loading = load().catch((err) => { console.error('[CountryBoundaries] load error:', err); }).finally(() => { loading = null; });
    }
    if (loading) await loading;
    return count;
  }
  async function retain(owner = 'scene') {
    holders.add(String(owner));
    ds.show = true;
    const n = await ensureLoaded();
    viewer.scene?.requestRender?.();
    return n;
  }
  function release(owner = 'scene') {
    holders.delete(String(owner));
    ds.show = holders.size > 0;
    viewer.scene?.requestRender?.();
  }
  /** Scéna: zapni (držiteľ 'scene'). */
  async function show() { return retain('scene'); }
  /** Scéna: pusti — hranice ostanú, ak ich drží vrstva potrubí. */
  function hide() { release('scene'); }
  function destroy() {
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
    holders.clear();
    loaded = false;
    loading = null;
  }

  return { show, hide, retain, release, destroy, get count() { return count; }, get holders() { return [...holders]; } };
}
