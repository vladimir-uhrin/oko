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

/** Political border line — a visible red (as in the upstream reveal), draped on
 *  the terrain. Distinct from the cyan shipping lanes; not so heavy it fights the
 *  data layers. */
const LINE_COLOR = Cesium.Color.fromCssColorString('#f0574d').withAlpha(0.72);
const LINE_WIDTH = 1.6;

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
    return { show: async () => 0, hide: () => {}, destroy: () => {}, get count() { return 0; } };
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
    const material = new Cesium.ColorMaterialProperty(LINE_COLOR);
    for (const feature of features) {
      const flat = [];
      for (const [lon, lat] of feature.geometry.coordinates) flat.push(lon, lat);
      ds.entities.add({
        id: `${COUNTRY_BOUNDARIES_ID}:${feature.id}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: LINE_WIDTH,
          material,
          clampToGround: true,
        },
      });
    }
    count = features.length;
    loaded = true;
    viewer.scene?.requestRender?.();
    console.log(`[CountryBoundaries] Loaded ${features.length} border lines`);
  }

  async function show() {
    ds.show = true;
    if (!loaded && !loading) {
      loading = load().catch((err) => { console.error('[CountryBoundaries] load error:', err); }).finally(() => { loading = null; });
    }
    if (loading) await loading;
    viewer.scene?.requestRender?.();
    return count;
  }
  function hide() { ds.show = false; viewer.scene?.requestRender?.(); }
  function destroy() {
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
    loaded = false;
    loading = null;
  }

  return { show, hide, destroy, get count() { return count; } };
}
