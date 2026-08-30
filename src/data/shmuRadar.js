import * as Cesium from 'cesium';

/**
 * SHMÚ precipitation radar overlay — Slovak 5-minute zmax composite (OKO).
 *
 * Live imagery layer: the dev-server proxy (`/api/shmu/radar`) decodes the
 * ODIM_H5 composite from opendata.shmu.sk (CC BY 4.0 — DATA_SOURCES.md) into
 * a latitude-linear PNG plus bounds metadata; this module drapes it as one
 * rectangle entity. An ENTITY at a fixed altitude — not a globe imagery
 * layer — deliberately: the default photoreal stack hides the Cesium globe
 * (`globe.show = false`), so a `viewer.imageryLayers` drape would be
 * invisible on the app's default view. A rectangle entity renders on every
 * stack, and a few km of altitude is semantically honest for a column-max
 * reflectivity product.
 *
 * Freshness: the proxy flags frames older than 20 min as `stale`; that state
 * is surfaced via getStats().error so the panel never presents an old frame
 * as current (CLAUDE.md rule 2 — data state must be visible).
 */

const META_URL = '/api/shmu/radar';
/** Drape altitude above the ellipsoid; clears terrain and city meshes. */
export const SHMU_RADAR_DRAPE_HEIGHT_M = 4000;
export const SHMU_RADAR_LAYER_ID = 'shmu-radar';
const ENTITY_ID = 'shmu-radar:overlay';

export function createShmuRadarLayer({ fetchImpl = null } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _dataSource = null;
  let _entity = null;
  let _enabled = false;
  let _iso = null;
  let _echoPixels = 0;
  let _lastUpdate = null;
  let _lastError = null;

  const layer = {
    id: SHMU_RADAR_LAYER_ID,
    name: 'Zrážkový radar (SHMÚ)',
    icon: '🌧️',
    source: 'SHMÚ — opendata.shmu.sk (CC BY 4.0)',
    updateInterval: 5 * 60 * 1000, // matches the upstream product cadence

    init(viewer) {
      _dataSource = new Cesium.CustomDataSource(SHMU_RADAR_LAYER_ID);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _entity = null;
      _enabled = false;
      _iso = null;
      _echoPixels = 0;
      _lastUpdate = null;
      _lastError = null;
      console.log('[Data:ShmuRadar] Initialized');
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update() {
      try {
        const response = await doFetch(META_URL);
        if (!response.ok) {
          _lastError = `SHMÚ proxy HTTP ${response.status}`;
          return false;
        }
        const meta = await response.json();
        if (!meta?.ok || !meta.bounds || !meta.png || !meta.iso) {
          _lastError = 'Malformed radar metadata';
          return false;
        }

        const { west, south, east, north } = meta.bounds;
        if (![west, south, east, north].every(Number.isFinite) || !(west < east && south < north)) {
          _lastError = 'Malformed radar bounds';
          return false;
        }

        if (meta.iso !== _iso) {
          const coordinates = Cesium.Rectangle.fromDegrees(west, south, east, north);
          const material = new Cesium.ImageMaterialProperty({
            image: meta.png,
            transparent: true,
          });
          if (!_entity) {
            _entity = _dataSource.entities.add({
              id: ENTITY_ID,
              rectangle: {
                coordinates,
                material,
                height: SHMU_RADAR_DRAPE_HEIGHT_M,
                heightReference: Cesium.HeightReference.NONE,
              },
            });
          } else {
            _entity.rectangle.coordinates = coordinates;
            _entity.rectangle.material = material;
          }
          _iso = meta.iso;
        }

        _echoPixels = Number.isFinite(meta.echoPixels) ? meta.echoPixels : 0;
        _lastUpdate = Date.now();
        // A served-but-old frame is DATA IN A DEGRADED STATE, not an error in
        // the transport sense — but the panel's error slot is the layer's one
        // honest "not current" channel, so stale rides there.
        _lastError = meta.stale ? `stale frame (${meta.iso})` : null;
        console.log(`[Data:ShmuRadar] Updated: ${meta.iso}, ${_echoPixels} echo px${meta.stale ? ' (STALE)' : ''}`);
        return true;
      } catch (e) {
        console.warn('[Data:ShmuRadar] Fetch error:', e);
        _lastError = 'SHMÚ radar network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _entity = null;
      _iso = null;
      _echoPixels = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _echoPixels,
        lastUpdate: _lastUpdate,
        error: _lastError,
      };
    },
  };
  return layer;
}

const shmuRadarLayer = createShmuRadarLayer();

export default shmuRadarLayer;
