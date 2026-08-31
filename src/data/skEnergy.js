import * as Cesium from 'cesium';
import { t } from '../i18n.js';
import { registerEntityContext, removeEntityContextsForLayer } from './contextStore.js';

/**
 * SK energy infrastructure — bundled OSM snapshot (OKO, Fáza 4).
 *
 * Slovakia's 400/220 kV transmission grid and gas transmission pipelines as
 * ground-clamped polylines. Replaces the submarine-cables tile as the
 * infrastructure layer that actually shows something over a landlocked
 * country. Static bundled data (ODbL, © OpenStreetMap contributors —
 * provenance in local_data/sk_energy/SOURCE.md), loaded lazily on first
 * update; the `source` label says "snapshot" so the panel never presents it
 * as live (CLAUDE.md rule 2).
 *
 * Ground polylines classify against BOTH surfaces by default, so the lines
 * drape correctly on the photoreal tiles stack as well as the globe stacks —
 * at 686 features this needs none of the cables layer's batching machinery.
 */

const dataUrl = new URL('./local_data/sk_energy/sk-energy.geojsonl', import.meta.url).href;

export const SK_ENERGY_LAYER_ID = 'local-energy';

/** 400 kV backbone: bright electric cyan, widest. */
const POWER_400_COLOR = Cesium.Color.fromCssColorString('#3fd6ff').withAlpha(0.88);
/** 220 kV: same family, visibly lighter weight. */
const POWER_220_COLOR = Cesium.Color.fromCssColorString('#3fd6ff').withAlpha(0.62);
/** Gas transmission: amber — reads as "pipeline", not electricity. */
const GAS_COLOR = Cesium.Color.fromCssColorString('#ffb14d').withAlpha(0.85);

/**
 * Presentation for one feature. Exported for tests: the widths/colors encode
 * the legend (400 kV > 220 kV > n/a, gas distinct), so a regression here is
 * a silent legend lie.
 * @param {{kind?: string, voltage?: string|null}} properties
 * @returns {{color: Cesium.Color, width: number}}
 */
export function skEnergyStyle(properties = {}) {
  if (properties.kind === 'gas') return { color: GAS_COLOR, width: 2.2 };
  const voltage = String(properties.voltage || '');
  return voltage.includes('400000')
    ? { color: POWER_400_COLOR, width: 2.6 }
    : { color: POWER_220_COLOR, width: 1.8 };
}

/**
 * Human label for one feature's click card. Name wins; otherwise the card
 * says WHAT the line is — that doubles as the layer's legend (the colors
 * alone don't explain themselves to a first-time operator).
 * @param {{kind?: string, name?: string|null, voltage?: string|null}} properties
 * @returns {string}
 */
export function skEnergyLabel(properties = {}) {
  if (properties.name) return String(properties.name);
  // i18n sweep 2026-08-31: legenda cez t() — EN pár pre EN UI, SK pôvodné.
  if (properties.kind === 'gas') return t('energy.gas-transit');
  return String(properties.voltage || '').includes('400000')
    ? t('energy.line-400')
    : t('energy.line-220');
}

/**
 * Parse the bundled .geojsonl payload (one Feature per line).
 * Malformed lines are dropped, not fatal — exported for tests.
 * @param {string} text
 * @returns {Array<object>} LineString features with ≥2 positions.
 */
export function parseSkEnergyGeojsonl(text) {
  const features = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const feature = JSON.parse(trimmed);
      if (feature?.geometry?.type !== 'LineString') continue;
      if (!Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 2) continue;
      features.push(feature);
    } catch { /* drop malformed line */ }
  }
  return features;
}

export function createSkEnergyLayer({ url = dataUrl, fetchImpl = null } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _dataSource = null;
  let _loaded = false;
  /** @type {?Promise<void>} single-flight lazy load */
  let _loading = null;
  let _counts = { power: 0, gas: 0 };
  let _lastUpdate = null;
  let _lastError = null;

  async function load() {
    const response = await doFetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const features = parseSkEnergyGeojsonl(await response.text());
    if (!features.length) throw new Error('empty dataset');
    const counts = { power: 0, gas: 0 };
    for (const feature of features) {
      const properties = feature.properties || {};
      const { color, width } = skEnergyStyle(properties);
      const flat = [];
      for (const [lon, lat] of feature.geometry.coordinates) flat.push(lon, lat);
      const entity = _dataSource.entities.add({
        id: `local-energy:${feature.id}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width,
          material: new Cesium.ColorMaterialProperty(color),
          clampToGround: true,
        },
        properties: {
          kind: properties.kind ?? null,
          name: properties.name ?? null,
          operator: properties.operator ?? null,
          voltage: properties.voltage ?? null,
          substance: properties.substance ?? null,
        },
      });
      // Click card via the shared context store — same seam the bundled
      // point layers use. The label doubles as the legend (see skEnergyLabel).
      // The store hangs off `window` (see hasContextHost in contextStore.js),
      // so a DOM-less runtime simply skips cards instead of failing the load.
      const mid = feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)];
      if (typeof window !== 'undefined') registerEntityContext(entity, {
        id: `local-energy:${feature.id}`,
        layerId: SK_ENERGY_LAYER_ID,
        layerName: 'Energetika SR',
        source: '© OpenStreetMap contributors',
        dataSource: _dataSource,
        label: skEnergyLabel(properties),
        properties,
        latitude: Number(mid[1].toFixed(6)),
        longitude: Number(mid[0].toFixed(6)),
      });
      counts[properties.kind === 'gas' ? 'gas' : 'power'] += 1;
    }
    _counts = counts;
    _loaded = true;
    _lastUpdate = Date.now();
    _lastError = null;
    console.log(`[Data:SkEnergy] Loaded ${features.length} lines (${counts.power} power, ${counts.gas} gas)`);
  }

  const layer = {
    id: SK_ENERGY_LAYER_ID,
    name: 'Energetika SR',
    // Monochromatický glyf (žiadne emoji) — konzistentné s ▣/▰/▲ vrstvami.
    icon: '↯',
    source: '© OpenStreetMap contributors · ODbL · snapshot 2026-08',
    // Static bundle: nothing to poll. The manager still ticks; update() is a
    // cheap no-op once loaded.
    updateInterval: 60 * 60 * 1000,

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource(SK_ENERGY_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _loaded = false;
      _loading = null;
      _counts = { power: 0, gas: 0 };
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:SkEnergy] Initialized');
    },

    enable() {
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      if (_loaded) return true;
      if (!_loading) {
        _loading = load().catch((error) => {
          // Reset the single-flight slot so a later tick can retry.
          _loading = null;
          throw error;
        });
      }
      try {
        await _loading;
        return true;
      } catch (error) {
        _lastError = `SK energy load failed: ${error?.message || error}`;
        console.warn('[Data:SkEnergy]', _lastError);
        return false;
      }
    },

    destroy(viewer) {
      if (typeof window !== 'undefined') removeEntityContextsForLayer(SK_ENERGY_LAYER_ID);
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _loaded = false;
      _loading = null;
      _counts = { power: 0, gas: 0 };
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _counts.power + _counts.gas,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}

const skEnergyLayer = createSkEnergyLayer();

export default skEnergyLayer;
