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

/** Political border as a "fence" (Cesium wall): a red curtain standing on the
 *  border line (user „aby pri bočnom pohľade … bol akoby plot"). The fence shows
 *  ONLY in a middle band of camera distance (distanceDisplayCondition): from far /
 *  the whole planet only the flat line remains, and once you dive in very close
 *  the tall wall would swamp the ships/layers, so it collapses back to the line
 *  (user „pri určitej výške už iba čiara aby sa neprekrývali s loďami"). */
const WALL_HEIGHT_M = 18667; // top of the fence above the ellipsoid (2/3 of the former 28 km)
const WALL_COLOR = Cesium.Color.fromCssColorString('#f0574d').withAlpha(0.3); // translucent red curtain
const WALL_TOP_COLOR = Cesium.Color.fromCssColorString('#ff6a5e').withAlpha(0.85); // brighter top edge
const FENCE_MIN_DISTANCE_M = 300_000; // closer than this → fence off (line only), don't cover ships
const FENCE_MAX_DISTANCE_M = 1_300_000; // farther than this → fence off (line only)

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
    const lineMaterial = new Cesium.ColorMaterialProperty(LINE_COLOR);
    const wallMaterial = new Cesium.ColorMaterialProperty(WALL_COLOR);
    const fenceCondition = new Cesium.DistanceDisplayCondition(FENCE_MIN_DISTANCE_M, FENCE_MAX_DISTANCE_M);
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
      // Fence — pops up only when the camera is close enough.
      ds.entities.add({
        id: `${COUNTRY_BOUNDARIES_ID}:wall:${feature.id}`,
        wall: {
          positions,
          maximumHeights: new Array(coords.length).fill(WALL_HEIGHT_M),
          minimumHeights: new Array(coords.length).fill(0),
          material: wallMaterial,
          outline: true,
          outlineColor: WALL_TOP_COLOR,
          outlineWidth: 1,
          distanceDisplayCondition: fenceCondition,
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
