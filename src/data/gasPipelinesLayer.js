// src/data/gasPipelinesLayer.js
/**
 * @module gasPipelinesLayer
 * @description Vrstva „Plynovody · EÚ a bývalý ZSSR“ (modul PLYN, etapa 5,
 * 2026-09-13; používateľ: „ropovody a plynovody aj s Ruskom a Ukrajinou").
 * Tranzitné plynovody z OSM snímku (`scripts/build-gas-pipelines.mjs`,
 * proxy `/api/gas/pipelines`) ako pozemné čiary: jantár = v prevádzke,
 * svetlejšie čiarkované = plánované/vo výstavbe, stlmené = odstavené,
 * hrúbka podľa priemeru (DN ≥ 900 mm chrbtica). Klik na čiaru = zvýraznenie
 * + karta v overlay (meno, prevádzkovateľ, priemer, dĺžka úseku, stav, OSM
 * id) a záznam v kontextovom paneli; klik do prázdna zbalí.
 *
 * Tvar podľa skEnergy.js (CustomDataSource, entity clampToGround, lenivé
 * načítanie pri prvom update) a gasFlowsLayer.js (overlay host, klik).
 * Statický snímok → `source` hovorí dátum snímku, nikdy „naživo“.
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { registerEntityContext, removeEntityContextsForLayer, selectEntityContext } from './contextStore.js';
import { clearOverlaySource, hitTestWorldOverlay, setOverlayEntries, setOverlaySourceVisible } from '../overlays/worldOverlay.js';
import { applyVesselOverlayPolicy } from './vesselLabels.js';
import {
  GAS_PIPELINE_ATTRIBUTION, GAS_PIPELINE_COLORS, OIL_PIPELINES_API, OIL_PIPELINES_META_API,
  fetchGasPipelines, pipelineDetails, pipelineKind, pipelineMidpoint, pipelineSourceLabel, pipelineStyle,
  pipelineTitle,
} from './gasPipelines.js';

export const GAS_PIPELINES_LAYER_ID = 'gas-pipelines';
export const GAS_PIPELINES_OVERLAY_SOURCE_ID = 'gas-pipelines';
/** Statický snímok: manažérsky tik raz za hodinu je lacný no-op po načítaní. */
export const GAS_PIPELINES_REFRESH_MS = 60 * 60 * 1000;

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * Karta vybraného úseku (variant „selected“ cez politiku kariet lodí):
 * meno, prevádzkovateľ, priemer a dĺžka, stav, OSM id, zdroj v päte.
 * @param {object} feature
 * @param {object} position Cartesian3 stredu úseku
 * @param {(k: string, v?: object) => string} translate
 * @param {string} lang
 * @param {{activate?: Function, source?: string}} [o]
 */
export function pipelineCard(feature, position, translate, lang, { activate = null, source = GAS_PIPELINE_ATTRIBUTION } = {}) {
  const props = feature?.properties || {};
  const details = pipelineDetails(props, translate, lang);
  details.push(source);
  return applyVesselOverlayPolicy({
    id: `${GAS_PIPELINES_LAYER_ID}:${feature.id}`,
    actionable: true,
    position,
    gapPx: 12,
    accent: 'rgba(255, 177, 77, 0.95)',
    title: pipelineTitle(props, translate),
    details,
    selected: true,
    priority: Number.MAX_SAFE_INTEGER,
    accessibilityLabel: `${pipelineTitle(props, translate)} · ${translate('gas.card-close')}`,
    activate,
  });
}

/**
 * @param {object} [o]
 * @param {typeof fetch|null} [o.fetchImpl]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: any) => object} [o.handlerFactory]
 * @param {object} [o.overlayHost]
 * @param {(k: string, v?: object) => string} [o.translate]
 * @param {() => string} [o.lang]
 * @param {() => number} [o.now]
 */
export function createGasPipelinesLayer({
  fetchImpl = null,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  overlayHost = DEFAULT_OVERLAY_HOST,
  translate = translateDefault,
  lang = () => currentLanguage(),
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _loaded = false;
  let _loading = null;
  let _meta = null;
  let _features = new Map();
  let _counts = { operating: 0, planned: 0, disused: 0 };
  /** Koľko úsekov je plyn a koľko ropa (etapa 2) — do stavu vrstvy a logu. */
  let _kinds = { gas: 0, oil: 0 };
  /** Meta ropného snímku; null, keď ropný build ešte nebežal. */
  let _oilMeta = null;
  let _lengthKm = 0;
  let _lastUpdate = null;
  let _error = null;
  let _selectedId = null;
  let _clickHandler = null;

  const material = (style) => {
    const color = Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha);
    return style.dashed
      ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 12 })
      : new Cesium.ColorMaterialProperty(color);
  };

  function applyStyle(entity, feature, selected) {
    const style = pipelineStyle(feature.properties);
    entity.polyline.width = selected ? style.width + 2 : style.width;
    entity.polyline.material = selected
      ? new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString(GAS_PIPELINE_COLORS.selected).withAlpha(0.95))
      : material(style);
  }

  function publishCard() {
    const record = _selectedId ? _features.get(_selectedId) : null;
    if (!_enabled || !record) {
      overlayHost.clearSource(GAS_PIPELINES_OVERLAY_SOURCE_ID);
      return;
    }
    const mid = pipelineMidpoint(record.feature.geometry.coordinates);
    const position = Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, 30);
    overlayHost.setEntries(GAS_PIPELINES_OVERLAY_SOURCE_ID, [
      pipelineCard(record.feature, position, translate, lang(), { activate: () => { selectPipeline(null); return true; }, source: pipelineSourceLabel(combinedMeta(), translate, lang()) }),
    ], { cohortLimit: 1, collisionCapacity: 1, moving: false });
    overlayHost.setVisible(GAS_PIPELINES_OVERLAY_SOURCE_ID, true);
    _viewer?.scene?.requestRender?.();
  }

  function selectPipeline(featureId) {
    const previous = _selectedId ? _features.get(_selectedId) : null;
    if (previous) applyStyle(previous.entity, previous.feature, false);
    const next = featureId ? _features.get(featureId) : null;
    _selectedId = next ? featureId : null;
    if (next) {
      applyStyle(next.entity, next.feature, true);
      if (typeof window !== 'undefined') {
        const mid = pipelineMidpoint(next.feature.geometry.coordinates);
        registerEntityContext(next.entity, {
          id: `${GAS_PIPELINES_LAYER_ID}:${featureId}`,
          layerId: GAS_PIPELINES_LAYER_ID,
          layerName: translate('layer.gas-pipelines.name'),
          source: pipelineSourceLabel(combinedMeta(), translate, lang()),
          dataSource: _dataSource,
          label: pipelineTitle(next.feature.properties, translate),
          properties: Object.fromEntries(pipelineDetails(next.feature.properties, translate, lang()).map((line, i) => [`${i + 1}`, line])),
          latitude: mid ? Number(mid.lat.toFixed(6)) : null,
          longitude: mid ? Number(mid.lon.toFixed(6)) : null,
        });
        selectEntityContext(next.entity);
      }
    }
    publishCard();
    _viewer?.scene?.requestRender?.();
  }

  async function load() {
    const { features: gasFeatures, meta } = await fetchGasPipelines({ fetcher: doFetch });
    if (!gasFeatures.length) throw new Error('empty snapshot');
    // Ropa (2026-09-19, etapa 2) je VOLITEĽNÁ: vlastný snímok, vlastná trasa,
    // a keď chýba (404 no_snapshot, lebo build ešte nebežal), plyn sa musí
    // nakresliť aj tak. Preto sa jej zlyhanie len zaloguje.
    let oilFeatures = [];
    try {
      const oil = await fetchGasPipelines({ fetcher: doFetch, url: OIL_PIPELINES_API, metaUrl: OIL_PIPELINES_META_API });
      oilFeatures = oil.features;
      _oilMeta = oil.meta;
    } catch (error) {
      _oilMeta = null;
      console.warn('[Data:GasPipelines] ropný snímok nedostupný, kreslím len plyn: ' + (error?.message || error));
    }
    // OSM way id sú jedinečné naprieč látkami, takže sa kľúče nezrazia.
    const features = oilFeatures.length ? [...gasFeatures, ...oilFeatures] : gasFeatures;
    _meta = meta;
    _features = new Map();
    // Po neúspešnom pokuse nesmú v zdroji ostať polovičné entity (Cesium by
    // pri opakovanom add() s tým istým id vyhodilo výnimku).
    _dataSource.entities.removeAll?.();
    const counts = { operating: 0, planned: 0, disused: 0 };
    const kinds = { gas: 0, oil: 0 };
    let km = 0;
    // ~15 000 úsekov: bez pozastavenia udalostí by každý add() prekresľoval.
    _dataSource.entities.suspendEvents?.();
    for (const raw of features) {
      // Úsek cez hranicu dlaždice môže prísť dvakrát s tým istým OSM id —
      // druhý výskyt dostane príponu, entity id musia byť jedinečné.
      let id = String(raw.id);
      if (_features.has(id)) { let k = 2; while (_features.has(`${id}#${k}`)) k += 1; id = `${id}#${k}`; }
      const feature = id === raw.id ? raw : { ...raw, id };
      const style = pipelineStyle(feature.properties);
      const flat = [];
      for (const [lon, lat] of feature.geometry.coordinates) flat.push(lon, lat);
      const entity = _dataSource.entities.add({
        id: `${GAS_PIPELINES_LAYER_ID}:${id}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: style.width,
          material: material(style),
          clampToGround: true,
        },
        properties: { status: style.status, kind: style.kind, name: feature.properties?.name ?? null },
      });
      entity.__gasPipeline = id;
      _features.set(id, { feature, entity });
      counts[style.status] += 1;
      kinds[style.kind] += 1;
      km += Number(feature.properties?.lengthKm) || 0;
    }
    _dataSource.entities.resumeEvents?.();
    _counts = counts;
    _kinds = kinds;
    _lengthKm = Math.round(km);
    _loaded = true;
    _lastUpdate = now();
    _error = null;
    console.log(`[Data:GasPipelines] Loaded ${features.length} segments (${counts.operating} operating, ${counts.planned} planned, ${counts.disused} disused), ${_lengthKm} km`);
  }

  /**
   * Popis zdroja pre chip: plyn a ropa sú DVA snímky toho istého zdroja (OSM,
   * ODbL), ale na mape sú jedna vrstva. Kilometre preto sčítavame — inak by
   * chip hlásil menej, než je nakreslené — a dátum berieme ten STARŠÍ, lebo
   * tvrdenie „dáta sú najviac takto staré“ musí platiť pre obe látky.
   * @returns {object|null}
   */
  function combinedMeta() {
    if (!_oilMeta) return _meta;
    if (!_meta) return _oilMeta;
    const dates = [_meta.snapshot, _oilMeta.snapshot].filter(Boolean).map(String).sort();
    const km = (Number(_meta.lengthKm) || 0) + (Number(_oilMeta.lengthKm) || 0);
    return { ..._meta, snapshot: dates[0] ?? null, lengthKm: km || null };
  }

  function installClick() {
    if (_clickHandler || !_viewer?.scene?.canvas) return;
    _clickHandler = handlerFactory(_viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const hit = overlayHost.hitTest?.(click.position?.x, click.position?.y, { sourceId: GAS_PIPELINES_OVERLAY_SOURCE_ID });
      if (hit?.entryId) { selectPipeline(null); return; }
      const picked = _viewer.scene.pick(click.position);
      const entity = picked?.id;
      if (entity?.__gasPipeline) {
        _viewer.selectedEntity = entity;
        selectPipeline(entity.__gasPipeline === _selectedId ? null : entity.__gasPipeline);
        return;
      }
      if (!picked && _selectedId) selectPipeline(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClick() {
    if (!_clickHandler) return;
    try { _clickHandler.destroy?.(); } catch { /* už zničený */ }
    _clickHandler = null;
  }

  const layer = {
    id: GAS_PIPELINES_LAYER_ID,
    get name() { return translate('layer.gas-pipelines.name'); },
    // Monochromatický glyf (žiadne emoji): rúra.
    icon: '⌇',
    get source() { return pipelineSourceLabel(combinedMeta(), translate, lang()); },
    updateInterval: GAS_PIPELINES_REFRESH_MS,

    init(viewer) {
      _viewer = viewer;
      _dataSource = dataSourceFactory(GAS_PIPELINES_LAYER_ID);
      _dataSource.show = false;
      viewer?.dataSources?.add?.(_dataSource);
      _loaded = false;
      _loading = null;
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      installClick();
      if (!_loaded && !_loading) void layer.update();
      else publishCard();
    },

    disable() {
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClick();
      if (_selectedId) selectPipeline(null);
      overlayHost.clearSource(GAS_PIPELINES_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(GAS_PIPELINES_OVERLAY_SOURCE_ID, false);
      if (_viewer?.selectedEntity?.__gasPipeline) _viewer.selectedEntity = undefined;
      _viewer?.scene?.requestRender?.();
    },

    async update() {
      if (_loaded) return true;
      if (!_loading) {
        _loading = load().catch((error) => { _loading = null; throw error; });
      }
      try {
        await _loading;
        return true;
      } catch (error) {
        _error = error?.code === 'no_snapshot' ? translate('gas.pipeline-no-snapshot') : (error?.message || String(error));
        console.warn('[Data:GasPipelines]', _error);
        return false;
      }
    },

    destroy(viewer) {
      layer.disable();
      if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_PIPELINES_LAYER_ID);
      const host = viewer || _viewer;
      if (_dataSource && host?.dataSources?.remove) host.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _features = new Map();
      _loaded = false;
      _loading = null;
      _meta = null;
      _oilMeta = null;
      _kinds = { gas: 0, oil: 0 };
    },

    getStats() {
      return {
        count: _features.size,
        lastUpdate: _lastUpdate,
        loading: Boolean(_loading) && !_loaded,
        error: _error,
        source: pipelineSourceLabel(combinedMeta(), translate, lang()),
        kinds: { ..._kinds },
        status: undefined,
      };
    },

    hasContact(id) {
      return _features.has(String(id).replace(`${GAS_PIPELINES_LAYER_ID}:`, ''));
    },

    selectPipeline,

    _getStateForTest() {
      return {
        enabled: _enabled, loaded: _loaded, error: _error, count: _features.size, counts: { ..._counts }, lengthKm: _lengthKm, selected: _selectedId,
        entities: _dataSource?.entities?.values?.length ?? null, hasClick: Boolean(_clickHandler), meta: _meta,
        kinds: { ..._kinds }, oilMeta: _oilMeta,
      };
    },
  };
  return layer;
}

const gasPipelinesLayer = createGasPipelinesLayer();
export default gasPipelinesLayer;
