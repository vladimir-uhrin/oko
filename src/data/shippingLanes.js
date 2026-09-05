import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { registerEntityContext, removeEntityContextsForLayer } from './contextStore.js';

/**
 * Global shipping lanes / maritime routes — bundled snapshot based on CIA World Oceans map.
 *
 * Provides global maritime corridors across all oceans and chokepoints (Hormuz, Suez,
 * Malacca, Panama, Gibraltar, Bab el-Mandeb, etc.). Solves the "deaf ocean" issue
 * where terrestrial AIS has no reception.
 *
 * Static bundled data (U.S. Government work / Public domain — provenance in
 * local_data/shipping_lanes/SOURCE.md), loaded lazily on first update.
 */

const dataUrl = new URL('./local_data/shipping_lanes/shipping-lanes.geojsonl', import.meta.url).href;

export const SHIPPING_LANES_LAYER_ID = 'local-shipping-lanes';

/** Major route: bright oceanic cyan, prominent width. */
const MAJOR_COLOR = Cesium.Color.fromCssColorString('#39d5ff').withAlpha(0.85);
/** Secondary (middle) route: deeper azure, medium weight. */
const MIDDLE_COLOR = Cesium.Color.fromCssColorString('#00b4d8').withAlpha(0.70);
/** Minor route: deep maritime blue, hairline. */
const MINOR_COLOR = Cesium.Color.fromCssColorString('#0077b6').withAlpha(0.55);

/**
 * Presentation style for one shipping lane feature.
 * @param {{kind?: string}} properties
 * @returns {{color: Cesium.Color, width: number}}
 */
export function shippingLanesStyle(properties = {}) {
  const kind = String(properties.kind || properties.type || '').toLowerCase();
  if (kind === 'major') return { color: MAJOR_COLOR, width: 2.6 };
  if (kind === 'middle') return { color: MIDDLE_COLOR, width: 1.8 };
  return { color: MINOR_COLOR, width: 1.2 };
}

/**
 * Human label for click context card and HUD inspection.
 * @param {{kind?: string, name?: string|null}} properties
 * @returns {string}
 */
export function shippingLanesLabel(properties = {}) {
  if (properties.name) return String(properties.name);
  const kind = String(properties.kind || properties.type || '').toLowerCase();
  if (kind === 'major') return t('shipping.lane-major');
  if (kind === 'middle') return t('shipping.lane-middle');
  return t('shipping.lane-minor');
}

/**
 * Parse the bundled .geojsonl payload.
 * Malformed lines are skipped gracefully.
 * @param {string} text
 * @returns {Array<object>}
 */
export function parseShippingLanesGeojsonl(text) {
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

export function createShippingLanesLayer({ url = dataUrl, fetchImpl = null } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _dataSource = null;
  let _loaded = false;
  let _loading = null;
  let _counts = { major: 0, middle: 0, minor: 0 };
  let _lastUpdate = null;
  let _lastError = null;

  async function load() {
    const response = await doFetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const features = parseShippingLanesGeojsonl(await response.text());
    if (!features.length) throw new Error('empty dataset');

    const counts = { major: 0, middle: 0, minor: 0 };
    for (const feature of features) {
      const properties = feature.properties || {};
      const { color, width } = shippingLanesStyle(properties);
      const flat = [];
      for (const [lon, lat] of feature.geometry.coordinates) {
        flat.push(lon, lat);
      }

      const entity = _dataSource.entities.add({
        id: `${SHIPPING_LANES_LAYER_ID}:${feature.id}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width,
          material: new Cesium.ColorMaterialProperty(color),
          clampToGround: true,
        },
        properties: {
          kind: properties.kind ?? null,
          type: properties.type ?? null,
        },
      });

      const midIdx = Math.floor(feature.geometry.coordinates.length / 2);
      const mid = feature.geometry.coordinates[midIdx];
      if (typeof window !== 'undefined') {
        registerEntityContext(entity, {
          id: `${SHIPPING_LANES_LAYER_ID}:${feature.id}`,
          layerId: SHIPPING_LANES_LAYER_ID,
          layerName: t('layer.local-shipping-lanes.name'),
          source: 'P. Benden — z CIA World Oceans · CC BY 4.0',
          dataSource: _dataSource,
          label: shippingLanesLabel(properties),
          properties,
          latitude: Number(mid[1].toFixed(5)),
          longitude: Number(mid[0].toFixed(5)),
        });
      }

      const k = String(properties.kind || properties.type || 'minor').toLowerCase();
      if (counts[k] !== undefined) counts[k] += 1;
      else counts.minor += 1;
    }

    _counts = counts;
    _loaded = true;
    _lastUpdate = Date.now();
    _lastError = null;
    console.log(`[Data:ShippingLanes] Loaded ${features.length} lanes (${counts.major} major, ${counts.middle} middle, ${counts.minor} minor)`);
  }

  const layer = {
    id: SHIPPING_LANES_LAYER_ID,
    name: 'Námorné koridory',
    icon: '∿',
    source: 'P. Benden — z CIA World Oceans · CC BY 4.0',
    updateInterval: 60 * 60 * 1000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource(SHIPPING_LANES_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _loaded = false;
      _loading = null;
    },

    async enable() {
      if (_dataSource) _dataSource.show = true;
      if (!_loaded && !_loading) {
        _loading = load().catch((err) => {
          _lastError = err.message;
          console.error('[Data:ShippingLanes] Load error:', err);
        }).finally(() => {
          _loading = null;
        });
      }
      if (_loading) await _loading;
    },

    disable() {
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      if (_dataSource?.show && !_loaded && !_loading) {
        _loading = load().catch((err) => {
          _lastError = err.message;
        }).finally(() => {
          _loading = null;
        });
        await _loading;
      }
    },

    destroy(viewer) {
      if (_dataSource && viewer?.dataSources) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      removeEntityContextsForLayer(SHIPPING_LANES_LAYER_ID);
      _loaded = false;
      _loading = null;
    },

    isLoaded() {
      return _loaded;
    },

    isUpdating() {
      return Boolean(_loading);
    },

    getStatus() {
      if (_lastError) return { state: 'error', message: _lastError };
      if (_loaded) return { state: 'ready', count: _counts.major + _counts.middle + _counts.minor };
      if (_loading) return { state: 'loading' };
      return { state: 'idle' };
    },
  };

  return layer;
}

export default createShippingLanesLayer();
