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
 * Etapa 2 (2026-09-19): ropovody z vlastného snímku (`/api/oil/pipelines`)
 * v tej istej vrstve, orchideovou farbou. Etapa 3: dva čipy PLYN / ROPA
 * (voľby `gas`/`oil` v tokene `0`, každá látka vo vlastnom CustomDataSource,
 * aby vypnutie bolo jedno `show` a nie 18 000 entít) a hover karta — prejdenie
 * myšou cez rúru ukáže meno, trasu z OSM a pri plynovodoch napojených na
 * hraničný bod ENTSOG aj živý tok (D−1), pri rope poctivé „nie je verejné".
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
  GAS_PIPELINE_ATTRIBUTION, GAS_PIPELINE_COLORS, OIL_PIPELINE_COLORS, OIL_PIPELINES_API, OIL_PIPELINES_META_API,
  fetchGasPipelines, pipelineDetails, pipelineMidpoint, pipelineSelectedStyle, pipelineSourceLabel, pipelineStyle,
  pipelineTitle,
} from './gasPipelines.js';
import { fetchGasFlows } from './gasFlows.js';
import { createPipelineHoverCard } from './pipelineHoverCard.js';

export const GAS_PIPELINES_LAYER_ID = 'gas-pipelines';
export const GAS_PIPELINES_OVERLAY_SOURCE_ID = 'gas-pipelines';
/** Statický snímok: manažérsky tik raz za hodinu je lacný no-op po načítaní. */
export const GAS_PIPELINES_REFRESH_MS = 60 * 60 * 1000;
/** Látky = zdroje entít; poradie je poradie čipov a legendy. */
export const PIPELINE_KINDS = Object.freeze(['gas', 'oil']);
/** Hover: pauza po pohybe kurzora pred pickom (ako zemetrasenia). */
export const PIPELINE_HOVER_DELAY_MS = 80;
/** Hover: pick obdĺžnik v px — 1,4 px čiara sa presným 3×3 pickom netrafí. */
export const PIPELINE_HOVER_PICK_PX = 7;
/** Živé toky ENTSOG pre hover: proxy má cache 1 h, klient si drží 30 min. */
export const PIPELINE_FLOWS_TTL_MS = 30 * 60 * 1000;

/** Núdzová výška čiar bez podpory pozemných primitív (metre nad elipsoidom). */
export const FALLBACK_HEIGHT_M = 200;

/**
 * Stráž podpory pozemných čiar (vzor traffic.js): bez hĺbkovej textúry
 * GroundPolylinePrimitive nekreslí nič. Falošná scéna v testoch túto otázku
 * nevie zodpovedať — výnimka znamená „predpokladaj áno".
 * @param {object|null|undefined} scene
 * @returns {boolean}
 */
export function defaultGroundSupport(scene) {
  try { return Boolean(Cesium.GroundPolylinePrimitive.isSupported(scene)); } catch { return true; }
}

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

/** `true`/`false`, `'1'`/`'0'`, `'true'`/`'false'` → boolean; iné → null (ignoruje sa). */
function normalizeFlag(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return null;
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
 * @param {(o: object) => object} [o.hoverFactory] hover karta (test: falošná)
 * @param {Function} [o.flowsFetcher] `fetchGasFlows`-kompatibilný (test: falošný)
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 */
export function createGasPipelinesLayer({
  fetchImpl = null,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  overlayHost = DEFAULT_OVERLAY_HOST,
  translate = translateDefault,
  lang = () => currentLanguage(),
  now = () => Date.now(),
  hoverFactory = (o) => createPipelineHoverCard(o),
  flowsFetcher = fetchGasFlows,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  groundSupport = defaultGroundSupport,
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  /** Jeden CustomDataSource na látku: čip = jedno `show`, nie slučka cez entity. */
  let _sources = { gas: null, oil: null };
  /** Zdroj s jedinou entitou zvýraznenia (etapa 4) — základná dávka sa pri kliku nemení. */
  let _selection = null;
  /** GPU vie pozemné čiary (hĺbková textúra); inak núdzovka nad elipsoidom. */
  let _groundSupported = true;
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
  /** Voľby látok (etapa 3) — trvalý stav cez token `0`, viď layerState.js. */
  let _params = { gas: true, oil: true };
  let _rowControlsListener = null;
  let _lengthKm = 0;
  let _lastUpdate = null;
  let _error = null;
  let _selectedId = null;
  let _clickHandler = null;
  // Hover (etapa 3)
  let _hover = null;
  let _hoverTimer = null;
  let _leaveTimer = null;
  let _pointer = null;
  let _hoverListeners = null;
  let _removeCameraHover = null;
  // Živé toky ENTSOG pre hover karty — jedna odpoveď proxy pre všetky rúry.
  let _flows = null;
  let _flowsAt = 0;
  let _flowsPromise = null;

  /**
   * Materiál (etapa 4, MERANÉ): plná čiara = PolylineOutline s tmavým obrysom
   * (na pozemnej čiare kreslí — overené pixelmi), plánovaná = čiarkovanie
   * s tmavou medzerou (obrys a čiarky sú dva materiály, nespoja sa).
   */
  const material = (style) => {
    const color = Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha);
    if (style.dashed) {
      const gapColor = style.gapColor ? Cesium.Color.fromCssColorString(style.gapColor).withAlpha(0.35) : Cesium.Color.TRANSPARENT;
      return new Cesium.PolylineDashMaterialProperty({ color, gapColor, dashLength: 12 });
    }
    if (style.outline) {
      return new Cesium.PolylineOutlineMaterialProperty({
        color,
        outlineColor: Cesium.Color.fromCssColorString(style.outline.color).withAlpha(style.outline.alpha),
        outlineWidth: style.outline.width,
      });
    }
    return new Cesium.ColorMaterialProperty(color);
  };

  const sourceFor = (kind) => _sources[kind === 'oil' ? 'oil' : 'gas'];
  const eachSource = (fn) => { for (const kind of PIPELINE_KINDS) if (_sources[kind]) fn(_sources[kind], kind); };

  /** Látka je viditeľná = vrstva zapnutá A jej čip zapnutý; výber ide s vrstvou. */
  function applySourceVisibility() {
    eachSource((source, kind) => { source.show = _enabled && Boolean(_params[kind]); });
    if (_selection) _selection.show = _enabled;
  }

  /**
   * Polyline pre entitu: na terén, keď to GPU vie (GroundPolylinePrimitive
   * potrebuje hĺbkovú textúru); inak 200 m nad elipsoidom ako priznaná
   * núdzovka — nad horami to bude pod zemou, ale čiara existuje a chip to hlási.
   */
  function polylineFor(coordinates, style) {
    const flat = [];
    if (_groundSupported) {
      for (const [lon, lat] of coordinates) flat.push(lon, lat);
    } else {
      for (const [lon, lat] of coordinates) flat.push(lon, lat, FALLBACK_HEIGHT_M);
    }
    const polyline = {
      positions: _groundSupported ? Cesium.Cartesian3.fromDegreesArray(flat) : Cesium.Cartesian3.fromDegreesArrayHeights(flat),
      width: style.width,
      material: material(style),
      clampToGround: _groundSupported,
    };
    if (_groundSupported) {
      // BOTH zámerne (nie podľa podkladu ako káble): 21 000 entít sa pri zmene
      // classificationType prestaví celé (~750 ms zamrznutie, etapa 0) a úspora
      // je pod 1 ms na snímok. Na fotoreáli (glóbus skrytý) BOTH klasifikuje
      // dlaždice, na glóbuse terén — viditeľnosť je v oboch prípadoch správna.
      polyline.classificationType = Cesium.ClassificationType.BOTH;
    }
    if (style.displayCondition) {
      polyline.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(style.displayCondition[0], style.displayCondition[1]);
    }
    return polyline;
  }

  /**
   * Výber = JEDNA entita vo vlastnom zdroji (etapa 4). Predtým sa menila šírka
   * a materiál základnej entity, čo prestavovalo celú dávku ~770 tisíc vrcholov
   * dvakrát na každý klik (namerané zamrznutie). Základné entity sa nedotýkajú.
   */
  function renderSelection(record) {
    if (!_selection) return;
    _selection.entities.removeAll?.();
    if (!record) return;
    const style = pipelineSelectedStyle(record.feature.properties);
    const entity = _selection.entities.add({
      id: `${GAS_PIPELINES_LAYER_ID}:selected`,
      polyline: polylineFor(record.feature.geometry.coordinates, style),
    });
    entity.__gasPipelineSelection = record.feature.id;
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
    const next = featureId ? _features.get(featureId) : null;
    _selectedId = next ? featureId : null;
    renderSelection(next);
    if (next) {
      if (typeof window !== 'undefined') {
        const mid = pipelineMidpoint(next.feature.geometry.coordinates);
        registerEntityContext(next.entity, {
          id: `${GAS_PIPELINES_LAYER_ID}:${featureId}`,
          layerId: GAS_PIPELINES_LAYER_ID,
          layerName: translate('layer.gas-pipelines.name'),
          source: pipelineSourceLabel(combinedMeta(), translate, lang()),
          dataSource: sourceFor(pipelineStyle(next.feature.properties).kind),
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
      // Meta len k úsekom, ktoré sa naozaj nakreslia: prázdny ropný súbor s meta
      // by inak pripočítal do chipu kilometre, ktoré na mape nie sú.
      _oilMeta = oilFeatures.length ? oil.meta : null;
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
    eachSource((source) => source.entities.removeAll?.());
    const counts = { operating: 0, planned: 0, disused: 0 };
    const kinds = { gas: 0, oil: 0 };
    let km = 0;
    // ~21 000 úsekov: bez pozastavenia udalostí by každý add() prekresľoval.
    eachSource((source) => source.entities.suspendEvents?.());
    for (const raw of features) {
      // Úsek cez hranicu dlaždice môže prísť dvakrát s tým istým OSM id —
      // druhý výskyt dostane príponu, entity id musia byť jedinečné.
      let id = String(raw.id);
      if (_features.has(id)) { let k = 2; while (_features.has(`${id}#${k}`)) k += 1; id = `${id}#${k}`; }
      const feature = id === raw.id ? raw : { ...raw, id };
      const style = pipelineStyle(feature.properties);
      const entity = sourceFor(style.kind).entities.add({
        id: `${GAS_PIPELINES_LAYER_ID}:${id}`,
        polyline: polylineFor(feature.geometry.coordinates, style),
        properties: { status: style.status, kind: style.kind, name: feature.properties?.name ?? null },
      });
      entity.__gasPipeline = id;
      _features.set(id, { feature, entity });
      counts[style.status] += 1;
      kinds[style.kind] += 1;
      km += Number(feature.properties?.lengthKm) || 0;
    }
    eachSource((source) => source.entities.resumeEvents?.());
    _counts = counts;
    _kinds = kinds;
    _lengthKm = Math.round(km);
    _loaded = true;
    _lastUpdate = now();
    _error = null;
    console.log(`[Data:GasPipelines] Loaded ${features.length} segments (gas ${kinds.gas}, oil ${kinds.oil}; ${counts.operating} operating, ${counts.planned} planned, ${counts.disused} disused), ${_lengthKm} km`);
    // Legenda v riadku vrstvy hlási počty na látku — až teraz sú známe.
    _rowControlsListener?.();
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

  // ── Hover (etapa 3) ─────────────────────────────────────────────────────
  /**
   * Živé toky ENTSOG: jedna odpoveď proxy pre všetky hover karty, 30 min.
   * Vracia payload alebo null (chyba) — karta z null urobí „nedostupné".
   */
  function loadFlows() {
    if (_flows && now() - _flowsAt < PIPELINE_FLOWS_TTL_MS) return Promise.resolve(_flows);
    if (_flowsPromise) return _flowsPromise;
    _flowsPromise = Promise.resolve()
      .then(() => flowsFetcher({ fetcher: doFetch }))
      .then((payload) => { _flows = payload || null; _flowsAt = now(); _flowsPromise = null; return _flows; })
      .catch((error) => { _flowsPromise = null; console.warn('[Data:GasPipelines] živé toky nedostupné: ' + (error?.message || error)); return null; });
    return _flowsPromise;
  }

  function clearHover() {
    if (_hoverTimer) { clearTimer(_hoverTimer); _hoverTimer = null; }
    if (_leaveTimer) { clearTimer(_leaveTimer); _leaveTimer = null; }
    _hover?.hide();
  }

  function hoverAtPointer() {
    _hoverTimer = null;
    if (!_enabled || !_hover || !_pointer || !_viewer?.scene?.pick) return;
    let picked = null;
    try { picked = _viewer.scene.pick(new Cesium.Cartesian2(_pointer.x, _pointer.y), PIPELINE_HOVER_PICK_PX, PIPELINE_HOVER_PICK_PX); } catch { picked = null; }
    const id = picked?.id?.__gasPipeline;
    const record = id ? _features.get(id) : null;
    if (!record) { if (!_hover.isHovered()) _hover.hide(); return; }
    const flowIds = _hover.show(record.feature, _pointer);
    if (flowIds.length) {
      void loadFlows().then((payload) => { _hover?.setFlows(record.feature, payload); });
    }
  }

  function moveHover(e) {
    if (e.buttons || e.pointerType === 'touch') { clearHover(); return; }
    _pointer = { x: e.clientX, y: e.clientY };
    if (!_hoverTimer) _hoverTimer = setTimer(hoverAtPointer, PIPELINE_HOVER_DELAY_MS);
  }

  function leaveHover() {
    if (_leaveTimer) clearTimer(_leaveTimer);
    _leaveTimer = setTimer(() => { _leaveTimer = null; if (!_hover?.isHovered()) clearHover(); }, 220);
  }

  function installHover() {
    const canvas = _viewer?.scene?.canvas;
    if (_hoverListeners || !canvas?.addEventListener) return;
    // Dátum snímku do päty karty (pravidlo 2: statický snímok sa hlási dátumom).
    _hover = _hover || hoverFactory({ translate, lang, snapshotDate: () => combinedMeta()?.snapshot ?? null });
    _hoverListeners = { pointermove: moveHover, pointerleave: leaveHover, pointerdown: clearHover };
    for (const [type, fn] of Object.entries(_hoverListeners)) canvas.addEventListener(type, fn);
    _removeCameraHover = _viewer?.camera?.moveStart?.addEventListener?.(clearHover) || null;
  }

  function removeHover() {
    clearHover();
    const canvas = _viewer?.scene?.canvas;
    if (_hoverListeners && canvas?.removeEventListener) {
      for (const [type, fn] of Object.entries(_hoverListeners)) canvas.removeEventListener(type, fn);
    }
    _hoverListeners = null;
    _removeCameraHover?.();
    _removeCameraHover = null;
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
      _groundSupported = groundSupport(viewer?.scene);
      if (!_groundSupported) console.warn('[Data:GasPipelines] GroundPolylinePrimitive unsupported — čiary 200 m nad elipsoidom');
      _sources = {
        gas: dataSourceFactory(GAS_PIPELINES_LAYER_ID),
        oil: dataSourceFactory(`${GAS_PIPELINES_LAYER_ID}-oil`),
      };
      eachSource((source) => { source.show = false; viewer?.dataSources?.add?.(source); });
      _selection = dataSourceFactory(`${GAS_PIPELINES_LAYER_ID}-selected`);
      _selection.show = false;
      viewer?.dataSources?.add?.(_selection);
      _loaded = false;
      _loading = null;
    },

    enable() {
      _enabled = true;
      applySourceVisibility();
      installClick();
      installHover();
      if (!_loaded && !_loading) void layer.update();
      else publishCard();
    },

    disable() {
      _enabled = false;
      applySourceVisibility();
      removeClick();
      removeHover();
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
      _hover?.destroy?.();
      _hover = null;
      if (typeof window !== 'undefined') removeEntityContextsForLayer(GAS_PIPELINES_LAYER_ID);
      const host = viewer || _viewer;
      eachSource((source) => { if (host?.dataSources?.remove) host.dataSources.remove(source, true); });
      if (_selection && host?.dataSources?.remove) host.dataSources.remove(_selection, true);
      _selection = null;
      _sources = { gas: null, oil: null };
      _viewer = null;
      _features = new Map();
      _loaded = false;
      _loading = null;
      _meta = null;
      _oilMeta = null;
      _kinds = { gas: 0, oil: 0 };
      _flows = null;
      _flowsAt = 0;
      _flowsPromise = null;
    },

    /**
     * Voľby látok (etapa 3): `{ gas?: boolean, oil?: boolean }`. Neznáme kľúče
     * a nezmyselné hodnoty sa ignorujú; vypnutie látky zbalí výber aj hover,
     * ak patrili jej. Manažér volá po kliku na čip aj pri obnove z odkazu.
     */
    setParams(params = {}) {
      let changed = false;
      for (const kind of PIPELINE_KINDS) {
        if (!Object.hasOwn(params || {}, kind)) continue;
        const value = normalizeFlag(params[kind]);
        if (value === null || value === _params[kind]) continue;
        _params = { ..._params, [kind]: value };
        changed = true;
      }
      if (!changed) return true;
      applySourceVisibility();
      const selected = _selectedId ? _features.get(_selectedId) : null;
      if (selected && !_params[pipelineStyle(selected.feature.properties).kind]) selectPipeline(null);
      clearHover();
      _rowControlsListener?.();
      _viewer?.scene?.requestRender?.();
      return true;
    },

    getParams() {
      return { ..._params };
    },

    /** Čipy PLYN / ROPA + legenda s počtami a farbami látok. */
    getRowControls() {
      const colors = { gas: GAS_PIPELINE_COLORS.operating, oil: OIL_PIPELINE_COLORS.operating };
      return {
        chips: PIPELINE_KINDS.map((kind) => ({
          id: `kind-${kind}`,
          label: translate(`gas.pipeline-chip-${kind}`),
          title: translate(`gas.pipeline-chip-${kind}-hint`),
          active: Boolean(_params[kind]),
          params: { [kind]: !_params[kind] },
        })),
        legend: PIPELINE_KINDS.map((kind) => ({
          label: translate(`gas.pipeline-chip-${kind}`),
          count: _kinds[kind],
          color: colors[kind],
          blurb: translate(`gas.pipeline-chip-${kind}-hint`),
        })),
      };
    },

    setRowControlsListener(listener) {
      _rowControlsListener = typeof listener === 'function' ? listener : null;
    },

    getStats() {
      return {
        count: _features.size,
        lastUpdate: _lastUpdate,
        loading: Boolean(_loading) && !_loaded,
        error: _error,
        // Núdzovka bez pozemných čiar sa hlási v zdroji (pravidlo 2).
        source: pipelineSourceLabel(combinedMeta(), translate, lang()) + (_groundSupported ? '' : ` · ${translate('gas.pipeline-no-ground')}`),
        kinds: { ..._kinds },
        status: undefined,
      };
    },

    hasContact(id) {
      return _features.has(String(id).replace(`${GAS_PIPELINES_LAYER_ID}:`, ''));
    },

    selectPipeline,

    _getStateForTest() {
      const entities = PIPELINE_KINDS.reduce((n, kind) => n + (_sources[kind]?.entities?.values?.length ?? 0), 0);
      return {
        enabled: _enabled, loaded: _loaded, error: _error, count: _features.size, counts: { ..._counts }, lengthKm: _lengthKm, selected: _selectedId,
        entities: _sources.gas || _sources.oil ? entities : null, hasClick: Boolean(_clickHandler), meta: _meta,
        kinds: { ..._kinds }, oilMeta: _oilMeta, params: { ..._params },
        sources: { gas: _sources.gas?.show ?? null, oil: _sources.oil?.show ?? null, selected: _selection?.show ?? null },
        selectionEntities: _selection?.entities?.values?.length ?? null, groundSupported: _groundSupported,
        hover: { installed: Boolean(_hoverListeners), timer: Boolean(_hoverTimer), flowsCached: Boolean(_flows) },
      };
    },
  };
  return layer;
}

const gasPipelinesLayer = createGasPipelinesLayer();
export default gasPipelinesLayer;
