// src/data/gasFlowsLayer.js
/**
 * @module gasFlowsLayer
 * @description Vrstva „Toky plynu“ na glóbuse (2026-09-13, etapa 4 modulu
 * PLYN): hraničné stanice z katalógu `gasFlows.js` ako body s popisom
 * (stanica + smer + GWh/d za posledný plynárenský deň), farba podľa stavu
 * (tečie / nula / bez dát), klik = karta v kontextovom paneli. Dáta berie
 * z tej istej proxy `/api/gas/flows` ako karta TOKY (cache 1 h), takže
 * ENTSOG nedostane ani jeden dopyt navyše. Súradnice sú približné polohy
 * staníc; karta aj kredit hovoria „predbežné, D−1“, nikdy „naživo“.
 *
 * Tvar podľa skEnergy.js (CustomDataSource, contextStore) a localGeojson.js
 * (vlastný klikací handler, natívny pick). Injektovateľné pre testy:
 * fetchImpl, dataSourceFactory, handlerFactory, translate, now.
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { registerEntityContext, removeEntityContextsForLayer, selectEntityContext } from './contextStore.js';
import { GAS_FLOW_POINTS, buildFlowsModel, fetchGasFlows } from './gasFlows.js';

export const GAS_FLOWS_LAYER_ID = 'gas-flows';
/** Proxy má TTL 1 h; vrstva sa pýta raz za 30 min (dostane cache). */
export const GAS_FLOWS_LAYER_REFRESH_MS = 30 * 60 * 1000;
/** Bod mierne nad terénom, aby nesplýval s podkladom na glóbusových stackoch. */
export const GAS_FLOW_STATION_HEIGHT_M = 30;

/** Farby: plyn = jantár ako v Energetike SR; nula stlmená; bez dát tmavá. */
export const GAS_FLOW_COLORS = Object.freeze({
  flow: '#ffb14d',
  zero: '#6f7f88',
  nodata: '#3d4a52',
});

/**
 * Smery zoskupené do staníc podľa mena a súradníc (Lanžhot vstup + výstup
 * = jedna stanica, Strandža 1 + 2 = jedna). Poradie = poradie katalógu.
 * @param {Array<{id: string, name: string, lat: number, lon: number, level: string}>} rows riadky z buildFlowsModel
 * @returns {Array<{key: string, name: string, lat: number, lon: number, rows: object[], level: string}>}
 */
export function groupStations(rows) {
  const stations = new Map();
  for (const row of rows || []) {
    if (!Number.isFinite(row?.lat) || !Number.isFinite(row?.lon)) continue;
    const key = `${row.lat.toFixed(2)},${row.lon.toFixed(2)}`;
    if (!stations.has(key)) stations.set(key, { key, name: row.name, lat: row.lat, lon: row.lon, rows: [], level: 'nodata' });
    stations.get(key).rows.push(row);
  }
  for (const s of stations.values()) {
    s.level = s.rows.some((r) => r.level === 'flow') ? 'flow' : (s.rows.some((r) => r.level === 'zero') ? 'zero' : 'nodata');
    if (s.rows.length > 1 && new Set(s.rows.map((r) => r.name)).size > 1) s.name = [...new Set(s.rows.map((r) => r.name))].join(' / ');
  }
  return [...stations.values()];
}

/** Popis bodu: meno stanice + jeden riadok na smer (`CZ → SK 24,6 GWh/d`). */
export function stationLabelText(station) {
  return [station.name, ...station.rows.map((r) => `${r.route} ${r.text}`)].join('\n');
}

export function stationColor(level) {
  return Cesium.Color.fromCssColorString(GAS_FLOW_COLORS[level] || GAS_FLOW_COLORS.nodata);
}

/**
 * Metadáta pre kontextový panel: čo je stanica, čo tečie, odkedy, poznámka.
 * @param {object} station
 * @param {(k: string, v?: object) => string} translate
 */
export function stationContextProperties(station, translate) {
  const props = {};
  station.rows.forEach((r, i) => {
    const prefix = station.rows.length > 1 ? `${r.route}` : translate('gas.flow-context-flow');
    props[prefix] = [r.text, r.mcmText, r.avg7Text].filter(Boolean).join(' · ');
    if (i === 0 && (r.dateText || r.statusText)) props[translate('gas.flow-context-day')] = [r.dateText, r.statusText].filter(Boolean).join(' · ');
    if (r.note && !props[translate('gas.flow-context-note')]) props[translate('gas.flow-context-note')] = r.note;
  });
  return props;
}

/**
 * @param {object} [o]
 * @param {typeof fetch|null} [o.fetchImpl]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: any) => object} [o.handlerFactory]
 * @param {(k: string, v?: object) => string} [o.translate]
 * @param {() => number} [o.now]
 */
export function createGasFlowsLayer({
  fetchImpl = null,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  translate = translateDefault,
  lang = () => currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _loading = false;
  let _error = null;
  let _lastUpdate = null;
  let _payload = null;
  let _model = null;
  let _stations = [];
  let _clickHandler = null;
  let _updateToken = 0;

  function rebuildEntities() {
    if (!_dataSource || !_model?.ok) return;
    if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_FLOWS_LAYER_ID);
    _dataSource.entities.removeAll();
    const rows = _model.groups.flatMap((g) => g.rows);
    _stations = groupStations(rows);
    for (const station of _stations) {
      const color = stationColor(station.level);
      const entity = _dataSource.entities.add({
        id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
        position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, GAS_FLOW_STATION_HEIGHT_M),
        point: {
          pixelSize: station.level === 'flow' ? 10 : 7,
          color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: stationLabelText(station),
          font: '500 11px "JetBrains Mono", monospace',
          fillColor: Cesium.Color.fromCssColorString('#d6f3fa'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#040c10').withAlpha(0.72),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(12, 0),
          scaleByDistance: new Cesium.NearFarScalar(200_000, 1.0, 4_000_000, 0.65),
          translucencyByDistance: new Cesium.NearFarScalar(1_500_000, 1.0, 9_000_000, 0.15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { level: station.level, name: station.name },
      });
      entity.__gasFlowStation = station.key;
      if (typeof window !== 'undefined') {
        registerEntityContext(entity, {
          id: `${GAS_FLOWS_LAYER_ID}:${station.key}`,
          layerId: GAS_FLOWS_LAYER_ID,
          layerName: translate('layer.gas-flows.name'),
          source: _model.sourceLine,
          dataSource: _dataSource,
          label: `${station.name} · ${station.rows.map((r) => `${r.route} ${r.text}`).join(' · ')}`,
          properties: stationContextProperties(station, translate),
          latitude: Number(station.lat.toFixed(6)),
          longitude: Number(station.lon.toFixed(6)),
        });
      }
    }
    _viewer?.scene?.requestRender?.();
  }

  async function load() {
    const token = ++_updateToken;
    _loading = true;
    try {
      const payload = await fetchGasFlows({ fetcher: doFetch });
      if (token !== _updateToken) return false;
      _payload = payload;
      _model = buildFlowsModel(payload, { lang: lang(), translate, nowMs: now() });
      if (!_model.ok) throw new Error('empty flows payload');
      _error = null;
      _lastUpdate = now();
      rebuildEntities();
      return true;
    } catch (error) {
      if (token === _updateToken) _error = error?.message || String(error);
      return false;
    } finally {
      if (token === _updateToken) _loading = false;
    }
  }

  function installClick() {
    if (_clickHandler || !_viewer?.scene?.canvas) return;
    _clickHandler = handlerFactory(_viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const picked = _viewer.scene.pick(click.position);
      const entity = picked?.id;
      if (!entity || !entity.__gasFlowStation) return;
      _viewer.selectedEntity = entity;
      if (typeof window !== 'undefined') selectEntityContext(entity);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClick() {
    if (!_clickHandler) return;
    try { _clickHandler.destroy?.(); } catch { /* už zničený */ }
    _clickHandler = null;
  }

  const layer = {
    id: GAS_FLOWS_LAYER_ID,
    get name() { return translate('layer.gas-flows.name'); },
    // Monochromatický glyf (žiadne emoji): vlnky = tok.
    icon: '≋',
    get source() { return _model?.sourceLine || 'ENTSOG Transparency Platform'; },
    updateInterval: GAS_FLOWS_LAYER_REFRESH_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = dataSourceFactory(GAS_FLOWS_LAYER_ID);
      _dataSource.show = false;
      viewer?.dataSources?.add?.(_dataSource);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      installClick();
      if (!_model) void load();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClick();
      if (_viewer?.selectedEntity?.__gasFlowStation) _viewer.selectedEntity = undefined;
      _viewer?.scene?.requestRender?.();
    },

    async update() {
      return load();
    },

    destroy(viewer) {
      layer.disable();
      if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_FLOWS_LAYER_ID);
      const host = viewer || _viewer;
      if (_dataSource && host?.dataSources?.remove) host.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _payload = null;
      _model = null;
      _stations = [];
    },

    getStats() {
      return {
        count: _stations.filter((s) => s.level !== 'nodata').length,
        lastUpdate: _lastUpdate,
        loading: _loading,
        error: _error,
        source: _model?.sourceLine
          ? `${translate('gas.flows-note').split(';')[0]} · ${_model.sourceLine}`
          : translate('gas.flows-note').split(';')[0],
        status: _model?.freshness?.stale ? 'stale' : undefined,
      };
    },

    hasContact(id) {
      return _stations.some((s) => `${GAS_FLOWS_LAYER_ID}:${s.key}` === String(id));
    },

    _getStateForTest() {
      return {
        enabled: _enabled, loading: _loading, error: _error, stations: _stations.length,
        entities: _dataSource?.entities?.values?.length ?? null, hasClick: Boolean(_clickHandler), catalogue: GAS_FLOW_POINTS.length,
      };
    },
  };
  return layer;
}

const gasFlowsLayer = createGasFlowsLayer();
export default gasFlowsLayer;
