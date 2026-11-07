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
  GAS_PIPELINE_ATTRIBUTION, GAS_PIPELINE_COLORS, OIL_PIPELINE_COLORS, OIL_PIPELINES_API, OIL_PIPELINES_META_API, PIPELINE_GHOST, PIPELINE_GROUP_MAX,
  fetchGasPipelines, parsePipelinesGeojsonl, pipelineDetails, pipelineFenceSpec, pipelineGroupKey, pipelineGroupSummary, pipelineMidpoint, pipelineSelectedStyle, pipelineSourceLabel, pipelineStyle,
  pipelineTitle, selectGhostCohort,
} from './gasPipelines.js';
import { regionDisplayName } from './trackedCardModel.js';
import { fetchGasFlows } from './gasFlows.js';
import { createPipelineHoverCard } from './pipelineHoverCard.js';
import { resolveEllipsoidalGround } from './terrainHeights.js';

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
/** Ťuknutie prstom: väčší pick obdĺžnik (prst je menej presný než kurzor). */
export const PIPELINE_TOUCH_PICK_PX = 21;
/** Živé toky ENTSOG pre hover: proxy má cache 1 h, klient si drží 30 min. */
export const PIPELINE_FLOWS_TTL_MS = 30 * 60 * 1000;

/** Núdzová výška čiar bez podpory pozemných primitív (metre nad elipsoidom). */
export const FALLBACK_HEIGHT_M = 200;
/** Duch: pauza po pohybe kamery pred novou kohortou (moveEnd chodí v dávkach). */
export const PIPELINE_GHOST_DEBOUNCE_MS = 250;
/** Výber celej trasy (etapa 6): najviac entít zvýraznenia naraz. */
export const PIPELINE_SELECTION_MAX = 300;

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

/**
 * Elipsoidné výšky terénu pre body [lon, lat] zo spoločného resolvera
 * (`/api/terrain/heights`, Re:Earth). Geoidná núdzovka resolvera (proxy
 * nedostupná) sa vracia ako null — duch na geoide by bol pod horami, radšej
 * žiadny a skúsiť neskôr.
 * @param {number[][]} points
 * @returns {Promise<Array<number|null>>}
 */
export async function defaultTerrainSampler(points) {
  const resolved = await resolveEllipsoidalGround(points.map(([lon, lat]) => ({ lat, lon })));
  return points.map((_, i) => { const r = resolved[i]; return r && r.source === 'reearth' && Number.isFinite(r.ellipsoid) ? r.ellipsoid : null; });
}

const DEFAULT_OVERLAY_HOST = Object.freeze({
  setEntries: setOverlayEntries,
  setVisible: setOverlaySourceVisible,
  clearSource: clearOverlaySource,
  hitTest: hitTestWorldOverlay,
});

/**
 * Profil vrstvy (ELEKTRINA, 2026-11-06): to isté telo — zdroje na druh, čipy,
 * výber celej trasy, hover karta so živým tokom, duch cez terén, plot — kreslí
 * aj vedenia ≥ 220 kV (`powerGridLayer.js`). Profil nesie všetko, čo je
 * látkovo špecifické: id a mená, druhy a ich farby, snímky, štýl, texty
 * karty, továreň hover karty a zdroj živých tokov. Plyn + ropa je predvolený.
 * `sources[].fallback(doFetch)` = núdzový snímok, keď povinný zdroj chýba
 * (elektrina: bundlovaný extrakt Slovenska).
 */
export const GAS_PIPELINES_PROFILE = Object.freeze({
  id: GAS_PIPELINES_LAYER_ID,
  nameKey: 'layer.gas-pipelines.name',
  icon: '⌇',
  logTag: 'GasPipelines',
  kinds: PIPELINE_KINDS,
  sources: Object.freeze([
    Object.freeze({ key: 'gas', required: true }),
    Object.freeze({ key: 'oil', url: OIL_PIPELINES_API, metaUrl: OIL_PIPELINES_META_API, required: false }),
  ]),
  styleFor: pipelineStyle,
  selectedStyleFor: pipelineSelectedStyle,
  fenceSpecFor: pipelineFenceSpec,
  groupKeyFor: pipelineGroupKey,
  groupMax: PIPELINE_GROUP_MAX,
  titleFor: pipelineTitle,
  detailsFor: pipelineDetails,
  sourceLabel: pipelineSourceLabel,
  kindColors: Object.freeze({ gas: GAS_PIPELINE_COLORS.operating, oil: OIL_PIPELINE_COLORS.operating }),
  chipLabelKey: (kind) => `gas.pipeline-chip-${kind}`,
  chipHintKey: (kind) => `gas.pipeline-chip-${kind}-hint`,
  cardAccent: 'rgba(255, 177, 77, 0.95)',
  attribution: GAS_PIPELINE_ATTRIBUTION,
  noSnapshotKey: 'gas.pipeline-no-snapshot',
  noGroundKey: 'gas.pipeline-no-ground',
  hoverFactory: (o) => createPipelineHoverCard(o),
  flowsFetcher: fetchGasFlows,
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
export function pipelineCard(feature, position, translate, lang, { activate = null, profile = GAS_PIPELINES_PROFILE, source = profile.attribution, group = null, regionName = undefined } = {}) {
  const props = feature?.properties || {};
  const details = profile.detailsFor(props, translate, lang, regionName ? { regionName } : {});
  // Celá trasa (etapa 6): úsek je fragment; karta povie, aká veľká je trasa.
  if (group && group.count > 1) {
    details.push(`${translate('gas.pipeline-group')}: ${translate('gas.pipeline-group-value', { n: group.count, km: new Intl.NumberFormat(lang === 'sk' ? 'sk-SK' : 'en-GB').format(group.lengthKm) })}`);
  }
  details.push(source);
  return applyVesselOverlayPolicy({
    id: `${profile.id}:${feature.id}`,
    actionable: true,
    position,
    gapPx: 12,
    accent: profile.cardAccent,
    title: profile.titleFor(props, translate),
    details,
    selected: true,
    priority: Number.MAX_SAFE_INTEGER,
    accessibilityLabel: `${profile.titleFor(props, translate)} · ${translate('gas.card-close')}`,
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
 * @param {(scene: object) => boolean} [o.groundSupport]
 * @param {((points: number[][]) => Promise<Array<number|null>>)|null} [o.terrainSampler] výšky pre ducha (test: falošný; null = bez ducha)
 */
export function createGasPipelinesLayer({
  profile = GAS_PIPELINES_PROFILE,
  fetchImpl = null,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  overlayHost = DEFAULT_OVERLAY_HOST,
  translate = translateDefault,
  lang = () => currentLanguage(),
  now = () => Date.now(),
  hoverFactory = profile.hoverFactory,
  flowsFetcher = profile.flowsFetcher,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  groundSupport = defaultGroundSupport,
  terrainSampler = defaultTerrainSampler,
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const LOG = `[Data:${profile.logTag}]`;
  const emptyKinds = () => Object.fromEntries(profile.kinds.map((kind) => [kind, 0]));
  const nullKinds = () => Object.fromEntries(profile.kinds.map((kind) => [kind, null]));
  let _viewer = null;
  /** Jeden CustomDataSource na látku: čip = jedno `show`, nie slučka cez entity. */
  let _sources = nullKinds();
  /** Zdroj s jedinou entitou zvýraznenia (etapa 4) — základná dávka sa pri kliku nemení. */
  let _selection = null;
  /** GPU vie pozemné čiary (hĺbková textúra); inak núdzovka nad elipsoidom. */
  let _groundSupported = true;
  /** Koľko entít dostalo plot (etapa 5). */
  let _fenceCount = 0;
  /** Skupiny = celé trasy (etapa 6): kľúč → id úsekov; id → kľúč. */
  let _groups = new Map();
  let _groupKeyById = new Map();
  // Duch (etapa 5): zdroj statických čiar s depthFailMaterial pre kohortu pri kamere.
  let _ghost = null;
  /** id → { positions: Cartesian3[]|null, at } — null = vzorkovanie zlyhalo, skúsi sa znova po retryMs. */
  let _ghostHeights = new Map();
  let _ghostRecords = null;
  let _ghostTimer = null;
  let _ghostToken = 0;
  let _removeGhostMove = null;
  let _ghostSamples = 0;
  let _enabled = false;
  let _loaded = false;
  let _loading = null;
  let _meta = null;
  let _features = new Map();
  let _counts = { operating: 0, planned: 0, disused: 0 };
  /** Koľko úsekov je plyn a koľko ropa (etapa 2) — do stavu vrstvy a logu. */
  let _kinds = emptyKinds();
  /** Meta voliteľných snímkov (ropa); prázdne, keď ich build ešte nebežal. */
  let _extraMetas = [];
  /** Voľby látok (etapa 3) — trvalý stav cez token `0`, viď layerState.js. */
  let _params = Object.fromEntries(profile.kinds.map((kind) => [kind, true]));
  let _rowControlsListener = null;
  let _lengthKm = 0;
  let _lengthKmRaw = 0;
  /** Bunky (elektrina): index zo servera, bunky v pamäti (LRU poradie) → id úsekov. */
  let _cellIndex = null;
  let _cellIds = new Map();
  let _cellTimer = null;
  let _cellToken = 0;
  let _removeCellMove = null;
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
  /** Posledný typ ukazovateľa na plátne (pointerdown): 'touch' = telefón/tablet. */
  let _lastPointerType = 'mouse';
  /** Výber otvorený ťuknutím ukazuje plnú kartu namiesto malej v overlay. */
  let _touchCard = false;
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

  const sourceFor = (kind) => _sources[kind] || _sources[profile.kinds[0]];
  const eachSource = (fn) => { for (const kind of profile.kinds) if (_sources[kind]) fn(_sources[kind], kind); };

  /** Látka je viditeľná = vrstva zapnutá A jej čip zapnutý; výber ide s vrstvou. */
  function applySourceVisibility() {
    eachSource((source, kind) => { source.show = _enabled && Boolean(_params[kind]); });
    if (_selection) _selection.show = _enabled;
    if (_ghost) _ghost.show = _enabled;
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
    // Etapa 6: zvýrazní sa CELÁ trasa (relácia alebo meno + prevádzkovateľ),
    // kliknutý úsek prvý; strop chráni pred stovkami entít pri veľkej relácii.
    const ids = [record.feature.id, ...groupIdsOf(record.feature.id).filter((id) => id !== record.feature.id)].slice(0, PIPELINE_SELECTION_MAX);
    for (const id of ids) {
      const member = _features.get(id);
      if (!member) continue;
      const style = profile.selectedStyleFor(member.feature.properties);
      const entity = _selection.entities.add({
        id: `${profile.id}:selected:${id}`,
        polyline: polylineFor(member.feature.geometry.coordinates, style),
      });
      entity.__gasPipelineSelection = id;
    }
  }

  // ── Skupiny = celé trasy (etapa 6) ──────────────────────────────────────
  /** id úsekov v skupine úseku (vrátane neho); bez skupiny len on sám. */
  function groupIdsOf(id) {
    const key = _groupKeyById.get(id);
    return key ? (_groups.get(key) || [id]) : [id];
  }

  /** Súhrn skupiny pre karty: null, keď úsek trasu netvorí. */
  function groupSummaryOf(id) {
    const ids = groupIdsOf(id);
    if (ids.length < 2) return null;
    const members = ids.map((member) => _features.get(member)?.feature).filter(Boolean);
    const summary = pipelineGroupSummary(members);
    // Elektrina: hranice, ktoré prekračuje ktorýkoľvek úsek trasy — úsek ležiaci
    // celý v jednej krajine tak ukáže tok na hranici svojej trasy (Győr–Bős → HU-SK).
    if (typeof profile.groupFlowIdsFor === 'function') summary.flowIds = profile.groupFlowIdsFor(members);
    return summary;
  }

  function buildGroups() {
    _groups = new Map();
    _groupKeyById = new Map();
    for (const [id, { feature }] of _features) {
      const key = profile.groupKeyFor(feature.properties);
      if (!key) continue;
      if (!_groups.has(key)) _groups.set(key, []);
      _groups.get(key).push(id);
    }
    // Samotár trasu netvorí; menná skupina nad stropom = meno je prakticky
    // všeobecné → nespája.
    for (const [key, ids] of _groups) {
      if (ids.length < 2 || (key.startsWith('name:') && ids.length > profile.groupMax)) { _groups.delete(key); continue; }
      for (const id of ids) _groupKeyById.set(id, key);
    }
  }

  // ── Plot (etapa 5) ──────────────────────────────────────────────────────
  /** Stena vo farbe látky od elipsoidu po `heightM`, len v strednom pásme (DDC). */
  function wallFor(coordinates, fence) {
    const flat = [];
    for (const [lon, lat] of coordinates) flat.push(lon, lat);
    const color = Cesium.Color.fromCssColorString(fence.color);
    return {
      positions: Cesium.Cartesian3.fromDegreesArray(flat),
      maximumHeights: new Array(coordinates.length).fill(fence.heightM),
      minimumHeights: new Array(coordinates.length).fill(0),
      material: new Cesium.ColorMaterialProperty(color.withAlpha(fence.alpha)),
      outline: true,
      outlineColor: color.withAlpha(fence.topAlpha),
      outlineWidth: 1,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(fence.near, fence.far),
    };
  }

  // ── Duch (etapa 5) ──────────────────────────────────────────────────────
  /** Duch potrebuje pozemné čiary (inak niet čo dopĺňať) a resolver výšok. */
  function ghostSupported() {
    return _groundSupported && typeof terrainSampler === 'function';
  }

  /** Stredy úsekov ako {x,y,z} pre čistú kohortu — raz po načítaní, nie na každý pohyb. */
  function buildGhostRecords() {
    _ghostRecords = [];
    for (const [id, { feature }] of _features) {
      const mid = pipelineMidpoint(feature.geometry.coordinates);
      if (!mid) continue;
      const c = Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat);
      _ghostRecords.push({ id, mid: { x: c.x, y: c.y, z: c.z }, points: feature.geometry.coordinates.length, widthClass: profile.styleFor(feature.properties).widthClass });
    }
  }

  function clearGhostTimer() {
    if (_ghostTimer) { clearTimer(_ghostTimer); _ghostTimer = null; }
  }

  function scheduleGhost() {
    if (!_enabled || !_loaded || !_ghost || !ghostSupported()) return;
    clearGhostTimer();
    _ghostTimer = setTimer(() => { _ghostTimer = null; void refreshGhost(); }, PIPELINE_GHOST_DEBOUNCE_MS);
  }

  /** Cartesian3 s výškou pre úsek; null, keď chýba viac než jeden vrchol. */
  function ghostPositions(coordinates, heights) {
    const positions = [];
    coordinates.forEach(([lon, lat], i) => {
      const h = heights[i];
      if (!Number.isFinite(h)) return;
      positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, h + PIPELINE_GHOST.liftM));
    });
    return positions.length >= 2 && positions.length >= coordinates.length - 1 ? positions : null;
  }

  async function refreshGhost() {
    if (!_enabled || !_ghost || !_ghostRecords || !_viewer?.scene?.camera) return;
    const camera = _viewer.scene.camera;
    const cam = camera.positionWC;
    const height = camera.positionCartographic?.height;
    const token = ++_ghostToken;
    const ids = Number.isFinite(height) && height > PIPELINE_GHOST.maxDistanceM
      ? []
      : selectGhostCohort(_ghostRecords, cam).filter((id) => _params[profile.styleFor(_features.get(id).feature.properties).kind]);
    // Chýbajúce alebo neúspešné (po retryMs) výšky sa navzorkujú z terénu.
    const missing = ids.filter((id) => { const c = _ghostHeights.get(id); return !c || (!c.positions && now() - c.at > PIPELINE_GHOST.retryMs); });
    if (missing.length) {
      const points = [];
      const owners = [];
      for (const id of missing) {
        for (const [lon, lat] of _features.get(id).feature.geometry.coordinates) { points.push([lon, lat]); owners.push(id); }
      }
      let heights = null;
      try { heights = await terrainSampler(points); } catch (error) { heights = null; console.warn(LOG + ' duch: výšky terénu zlyhali: ' + (error?.message || error)); }
      if (token !== _ghostToken) return; // kamera sa medzitým pohla — platí novšia kohorta
      _ghostSamples += points.length;
      const byOwner = new Map();
      for (const id of missing) byOwner.set(id, []);
      if (Array.isArray(heights)) heights.forEach((h, i) => byOwner.get(owners[i]).push(h));
      const at = now();
      for (const id of missing) {
        const coordinates = _features.get(id).feature.geometry.coordinates;
        _ghostHeights.set(id, { positions: Array.isArray(heights) ? ghostPositions(coordinates, byOwner.get(id)) : null, at });
      }
    }
    // Zosúladiť nakreslené s kohortou: odobrať cudzie, pridať chýbajúce s výškou.
    const wanted = new Set(ids.filter((id) => _ghostHeights.get(id)?.positions));
    for (const entity of [...(_ghost.entities.values || [])]) {
      if (!wanted.has(entity.__gasPipelineGhost)) _ghost.entities.remove?.(entity) ?? _ghost.entities.removeById?.(entity.id);
    }
    const present = new Set((_ghost.entities.values || []).map((e) => e.__gasPipelineGhost));
    for (const id of wanted) {
      if (present.has(id)) continue;
      const { feature } = _features.get(id);
      const style = profile.styleFor(feature.properties);
      const entity = _ghost.entities.add({
        id: `${profile.id}:ghost:${id}`,
        polyline: {
          positions: _ghostHeights.get(id).positions,
          width: Math.max(1, style.width - PIPELINE_GHOST.widthDelta),
          arcType: Cesium.ArcType.NONE,
          // Viditeľná časť sa nekreslí (to robí pozemná čiara); depthFail = len za terénom.
          material: Cesium.Color.TRANSPARENT,
          depthFailMaterial: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(style.color).withAlpha(PIPELINE_GHOST.alpha),
            gapColor: Cesium.Color.TRANSPARENT,
            dashLength: PIPELINE_GHOST.dashLength,
          }),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, PIPELINE_GHOST.maxDistanceM),
        },
      });
      entity.__gasPipelineGhost = id;
    }
    _viewer.scene.requestRender?.();
  }

  function installGhostMove() {
    if (_removeGhostMove || !ghostSupported()) return;
    _removeGhostMove = _viewer?.scene?.camera?.moveEnd?.addEventListener?.(scheduleGhost) || null;
  }

  function removeGhostMove() {
    clearGhostTimer();
    _ghostToken += 1;
    _removeGhostMove?.();
    _removeGhostMove = null;
  }

  function publishCard() {
    const record = _selectedId ? _features.get(_selectedId) : null;
    // Ťuknutie na telefóne ukazuje plnú kartu (showTouchCard) — malá karta by ju duplikovala.
    if (!_enabled || !record || _touchCard) {
      overlayHost.clearSource(profile.id);
      return;
    }
    const mid = pipelineMidpoint(record.feature.geometry.coordinates);
    const position = Cesium.Cartesian3.fromDegrees(mid.lon, mid.lat, 30);
    overlayHost.setEntries(profile.id, [
      pipelineCard(record.feature, position, translate, lang(), { profile, activate: () => { selectPipeline(null); return true; }, source: profile.sourceLabel(combinedMeta(), translate, lang()), group: groupSummaryOf(record.feature.id), regionName: (iso) => regionDisplayName(iso, lang()) }),
    ], { cohortLimit: 1, collisionCapacity: 1, moving: false });
    overlayHost.setVisible(profile.id, true);
    _viewer?.scene?.requestRender?.();
  }

  function selectPipeline(featureId) {
    const next = featureId ? _features.get(featureId) : null;
    _selectedId = next ? featureId : null;
    if (!next && _touchCard) { _touchCard = false; clearHover(); }
    renderSelection(next);
    if (next) {
      if (typeof window !== 'undefined') {
        const mid = pipelineMidpoint(next.feature.geometry.coordinates);
        registerEntityContext(next.entity, {
          id: `${profile.id}:${featureId}`,
          layerId: profile.id,
          layerName: translate(profile.nameKey),
          source: profile.sourceLabel(combinedMeta(), translate, lang()),
          dataSource: sourceFor(profile.styleFor(next.feature.properties).kind),
          label: profile.titleFor(next.feature.properties, translate),
          properties: Object.fromEntries(profile.detailsFor(next.feature.properties, translate, lang()).map((line, i) => [`${i + 1}`, line])),
          latitude: mid ? Number(mid.lat.toFixed(6)) : null,
          longitude: mid ? Number(mid.lon.toFixed(6)) : null,
        });
        selectEntityContext(next.entity);
      }
    }
    publishCard();
    _viewer?.scene?.requestRender?.();
  }

  /** Snímok jedného zdroja profilu; povinný zdroj smie mať núdzovku (`fallback`). */
  async function loadSource(source) {
    const opts = { fetcher: doFetch };
    if (source.url) opts.url = source.url;
    if (source.metaUrl) opts.metaUrl = source.metaUrl;
    try {
      return await fetchGasPipelines(opts);
    } catch (error) {
      if (typeof source.fallback !== 'function') throw error;
      console.warn(LOG + ' snímok ' + source.key + ' nedostupný (' + (error?.message || error) + ') — núdzový snímok');
      return source.fallback(doFetch);
    }
  }

  /**
   * Vloží úseky ako entity (spoločné pre celý snímok aj pre bunku). Úsek cez
   * hranicu dlaždice môže prísť dvakrát s tým istým OSM id — druhý výskyt
   * dostane príponu, entity id musia byť jedinečné.
   * @returns {string[]} id vložených úsekov
   */
  function insertFeatures(list, cellId = null) {
    const ids = [];
    // ~21 000 úsekov: bez pozastavenia udalostí by každý add() prekresľoval.
    eachSource((source) => source.entities.suspendEvents?.());
    for (const raw of list) {
      let id = String(raw.id);
      if (_features.has(id)) { let k = 2; while (_features.has(`${id}#${k}`)) k += 1; id = `${id}#${k}`; }
      const feature = id === raw.id ? raw : { ...raw, id };
      const style = profile.styleFor(feature.properties);
      const fence = _groundSupported ? profile.fenceSpecFor(feature.properties) : null;
      const entity = sourceFor(style.kind).entities.add({
        id: `${profile.id}:${id}`,
        polyline: polylineFor(feature.geometry.coordinates, style),
        // Plot (etapa 5) na tej istej entite: čip látky ho skryje spolu s čiarou.
        ...(fence ? { wall: wallFor(feature.geometry.coordinates, fence) } : {}),
        properties: { status: style.status, kind: style.kind, name: feature.properties?.name ?? null },
      });
      if (fence) _fenceCount += 1;
      entity.__gasPipeline = id;
      entity.__pipelineLayer = profile.id;
      _features.set(id, { feature, entity, cellId, kind: style.kind, status: style.status });
      _counts[style.status] += 1;
      if (!_cellIndex) _kinds[style.kind] += 1;
      _lengthKmRaw += Number(feature.properties?.lengthKm) || 0;
      ids.push(id);
    }
    eachSource((source) => source.entities.resumeEvents?.());
    _lengthKm = Math.round(_lengthKmRaw);
    return ids;
  }

  /** Odstráni úseky (uvoľnenie bunky); vybraný úsek medzi nimi zbalí. */
  function removeFeatures(ids) {
    eachSource((source) => source.entities.suspendEvents?.());
    for (const id of ids) {
      const record = _features.get(id);
      if (!record) continue;
      if (id === _selectedId) selectPipeline(null);
      sourceFor(record.kind).entities.remove?.(record.entity);
      _counts[record.status] -= 1;
      _lengthKmRaw -= Number(record.feature.properties?.lengthKm) || 0;
      _features.delete(id);
      _ghostHeights.delete(id);
    }
    eachSource((source) => source.entities.resumeEvents?.());
    _lengthKm = Math.max(0, Math.round(_lengthKmRaw));
  }

  /** Po zmene množiny úsekov: duch, skupiny trás, prekreslenie. */
  function afterFeaturesChanged() {
    buildGhostRecords();
    buildGroups();
    scheduleGhost();
    _viewer?.scene?.requestRender?.();
  }

  // ── Bunky (elektrina, 2026-11-06) ───────────────────────────────────────
  /** Výhľad kamery v stupňoch pre výber buniek; null bez kamery. */
  function currentView() {
    const camera = _viewer?.scene?.camera || _viewer?.camera;
    const carto = camera?.positionCartographic;
    if (!carto) return null;
    const view = { lon: Cesium.Math.toDegrees(carto.longitude), lat: Cesium.Math.toDegrees(carto.latitude) };
    let rect = null;
    try { rect = camera.computeViewRectangle?.(_viewer.scene.globe?.ellipsoid); } catch { rect = null; }
    if (rect) {
      Object.assign(view, { west: Cesium.Math.toDegrees(rect.west), south: Cesium.Math.toDegrees(rect.south), east: Cesium.Math.toDegrees(rect.east), north: Cesium.Math.toDegrees(rect.north) });
    }
    // Stred výhľadu = bod Zeme pod stredom obrazovky (pri šikmom pohľade sa pozeráme
    // ďalej než pod kameru). NIE stred obdĺžnika: ten je na glóbuse nesúmerný —
    // 2026-11-06 z 2 500 km nad 49° s. š. mal obdĺžnik 37,8–55,7° a „stred" 46,8°,
    // takže sa načítal Balkán a husté Nemecko v strede obrazovky chýbalo.
    try {
      const canvas = _viewer.scene.canvas;
      const hit = camera.pickEllipsoid?.(new Cesium.Cartesian2((canvas.clientWidth || canvas.width) / 2, (canvas.clientHeight || canvas.height) / 2), _viewer.scene.globe?.ellipsoid);
      if (hit) {
        const c = Cesium.Cartographic.fromCartesian(hit);
        view.lon = Cesium.Math.toDegrees(c.longitude);
        view.lat = Cesium.Math.toDegrees(c.latitude);
      }
    } catch { /* bez stredu = poloha kamery */ }
    return view;
  }

  function scheduleCells() {
    if (!_enabled || !_cellIndex) return;
    if (_cellTimer) clearTimer(_cellTimer);
    _cellTimer = setTimer(() => { _cellTimer = null; void refreshCells(); }, profile.cells.debounceMs ?? 400);
  }

  async function refreshCells() {
    if (!_enabled || !_cellIndex) return;
    const token = ++_cellToken;
    const maxResident = profile.cells.maxResident?.() ?? 30_000;
    const wanted = profile.cells.select(_cellIndex.cells, currentView(), { maxResident });
    const wantedSet = new Set(wanted);
    const residentCount = () => [..._cellIds.values()].reduce((n, ids) => n + ids.length, 0);
    const sizeOf = new Map(_cellIndex.cells.map((c) => [c.id, c.count]));
    // Uvoľni bunky mimo výhľadu, kým by sa nové nezmestili pod strop (najstaršie prvé).
    const evictFor = (incoming) => {
      for (const id of [..._cellIds.keys()]) {
        if (residentCount() + incoming <= maxResident) return;
        if (wantedSet.has(id)) continue;
        removeFeatures(_cellIds.get(id));
        _cellIds.delete(id);
      }
    };
    let changed = false;
    for (const cellId of wanted) {
      if (_cellIds.has(cellId)) { const ids = _cellIds.get(cellId); _cellIds.delete(cellId); _cellIds.set(cellId, ids); continue; } // LRU: posuň dozadu
      let list = null;
      try {
        const response = await doFetch(profile.cells.cellUrl(cellId, _meta?.snapshot));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        list = parsePipelinesGeojsonl(await response.text());
      } catch (error) {
        console.warn(`${LOG} bunka ${cellId} nedostupná: ${error?.message || error}`);
        continue;
      }
      if (token !== _cellToken || !_enabled) { if (changed) afterFeaturesChanged(); return; } // novší pohyb kamery má prednosť
      evictFor(sizeOf.get(cellId) ?? list.length);
      _cellIds.set(cellId, insertFeatures(list, cellId));
      changed = true;
    }
    if (changed) {
      _lastUpdate = now();
      afterFeaturesChanged();
      _rowControlsListener?.();
    }
  }

  function installCellMove() {
    if (_removeCellMove || !_cellIndex) return;
    _removeCellMove = _viewer?.scene?.camera?.moveEnd?.addEventListener?.(scheduleCells) || null;
  }

  function removeCellMove() {
    if (_cellTimer) { clearTimer(_cellTimer); _cellTimer = null; }
    _cellToken += 1;
    _removeCellMove?.();
    _removeCellMove = null;
  }

  /** Index buniek; null = profil bunky nemá alebo index chýba (núdzovka zdrojov). */
  async function loadCellIndex() {
    if (!profile.cells) return null;
    try {
      const response = await doFetch(profile.cells.indexUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = await response.json();
      return Array.isArray(index?.cells) && index.cells.length ? index : null;
    } catch (error) {
      console.warn(`${LOG} index buniek nedostupný (${error?.message || error}) — celý snímok / núdzovka`);
      return null;
    }
  }

  async function load() {
    // Po neúspešnom pokuse nesmú v zdroji ostať polovičné entity (Cesium by
    // pri opakovanom add() s tým istým id vyhodilo výnimku).
    eachSource((source) => source.entities.removeAll?.());
    _features = new Map();
    _cellIds = new Map();
    _counts = { operating: 0, planned: 0, disused: 0 };
    _kinds = emptyKinds();
    _lengthKmRaw = 0;
    _lengthKm = 0;
    _fenceCount = 0;
    _ghostHeights = new Map();
    const index = await loadCellIndex();
    if (index) {
      _cellIndex = index;
      _meta = index.meta || null;
      _extraMetas = [];
      // Legenda hlási celý snímok (nie len bunky v pamäti).
      for (const kind of profile.kinds) _kinds[kind] = Number(index.totals?.[kind]) || 0;
      _loaded = true;
      _lastUpdate = now();
      _error = null;
      console.log(`${LOG} Index: ${index.cells.length} buniek, ${index.features} úsekov (${profile.kinds.map((kind) => `${kind} ${_kinds[kind]}`).join(', ')})`);
      _rowControlsListener?.();
      installCellMove();
      if (profile.prefetchFlows) void loadFlows();
      await refreshCells();
      return;
    }
    _cellIndex = null;
    const [primary, ...optional] = profile.sources;
    const { features: primaryFeatures, meta } = await loadSource(primary);
    if (!primaryFeatures.length) throw new Error('empty snapshot');
    // Ropa (2026-09-19, etapa 2) je VOLITEĽNÁ: vlastný snímok, vlastná trasa,
    // a keď chýba (404 no_snapshot, lebo build ešte nebežal), plyn sa musí
    // nakresliť aj tak. Preto sa jej zlyhanie len zaloguje.
    let features = primaryFeatures;
    const extraMetas = [];
    for (const source of optional) {
      try {
        const extra = await loadSource(source);
        // Meta len k úsekom, ktoré sa naozaj nakreslia: prázdny ropný súbor s meta
        // by inak pripočítal do chipu kilometre, ktoré na mape nie sú.
        if (extra.features.length) { features = [...features, ...extra.features]; extraMetas.push(extra.meta); }
      } catch (error) {
        console.warn(LOG + ' snímok ' + source.key + ' nedostupný, kreslím bez neho: ' + (error?.message || error));
      }
    }
    // OSM way id sú jedinečné naprieč látkami, takže sa kľúče nezrazia.
    _extraMetas = extraMetas;
    _meta = meta;
    insertFeatures(features);
    _loaded = true;
    _lastUpdate = now();
    _error = null;
    afterFeaturesChanged();
    const counts = _counts;
    const kinds = _kinds;
    console.log(`${LOG} Loaded ${features.length} segments (${profile.kinds.map((kind) => `${kind} ${kinds[kind]}`).join(', ')}; ${counts.operating} operating, ${counts.planned} planned, ${counts.disused} disused), ${_lengthKm} km`);
    // Legenda v riadku vrstvy hlási počty na látku — až teraz sú známe.
    _rowControlsListener?.();
    // Elektrina: obnova tokov v proxy trvá minúty — pýta sa hneď po načítaní,
    // aby prvý hover nečakal.
    if (profile.prefetchFlows) void loadFlows();
  }

  /**
   * Popis zdroja pre chip: plyn a ropa sú DVA snímky toho istého zdroja (OSM,
   * ODbL), ale na mape sú jedna vrstva. Kilometre preto sčítavame — inak by
   * chip hlásil menej, než je nakreslené — a dátum berieme ten STARŠÍ, lebo
   * tvrdenie „dáta sú najviac takto staré“ musí platiť pre obe látky.
   * @returns {object|null}
   */
  function combinedMeta() {
    const metas = [_meta, ..._extraMetas].filter(Boolean);
    if (metas.length <= 1) return metas[0] ?? null;
    const dates = metas.map((m) => m.snapshot).filter(Boolean).map(String).sort();
    const km = metas.reduce((sum, m) => sum + (Number(m.lengthKm) || 0), 0);
    return { ...metas[0], snapshot: dates[0] ?? null, lengthKm: km || null };
  }

  /**
   * Pick v obdĺžniku okolo bodu: tenká pozemná čiara sa presným 3×3 pickom netrafí
   * (pasca etapy 3), prst je ešte menej presný než myš (2026-11-07, telefón).
   */
  function pickAt(position, sizePx) {
    try { return _viewer.scene.pick(new Cesium.Cartesian2(position?.x ?? 0, position?.y ?? 0), sizePx, sizePx); } catch { return _viewer.scene.pick(position); }
  }

  /**
   * Plná karta po ťuknutí (2026-11-07, telefón): hover na dotykovom displeji
   * neexistuje, takže živý tok (ENTSOG / Energy-Charts) bol na telefóne
   * nedostupný — malá karta v overlay ho nemá. Ťuknutie preto otvorí tú istú
   * kartu ako prejdenie myšou, pri mieste ťuknutia; malá karta sa vtedy nekreslí.
   */
  function showTouchCard(record, position) {
    if (!_hover || !record) return;
    const rect = _viewer?.scene?.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
    const at = { x: (rect.left || 0) + (position?.x || 0), y: (rect.top || 0) + (position?.y || 0) };
    const flowIds = _hover.show(record.feature, at, { group: groupSummaryOf(record.feature.id) });
    if (flowIds.length) void loadFlows().then((payload) => { _hover?.setFlows(record.feature, payload); });
  }

  function installClick() {
    if (_clickHandler || !_viewer?.scene?.canvas) return;
    _clickHandler = handlerFactory(_viewer.scene.canvas);
    _clickHandler.setInputAction((click) => {
      if (!_enabled) return;
      const hit = overlayHost.hitTest?.(click.position?.x, click.position?.y, { sourceId: profile.id });
      if (hit?.entryId) { selectPipeline(null); return; }
      const touch = _lastPointerType === 'touch';
      const picked = pickAt(click.position, touch ? PIPELINE_TOUCH_PICK_PX : PIPELINE_HOVER_PICK_PX);
      const entity = picked?.id;
      if (entity?.__gasPipeline && entity.__pipelineLayer === profile.id) {
        _viewer.selectedEntity = entity;
        const next = entity.__gasPipeline === _selectedId ? null : entity.__gasPipeline;
        _touchCard = touch && Boolean(next) && Boolean(_hover);
        selectPipeline(next);
        if (_touchCard) showTouchCard(_features.get(next), click.position);
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
    if (typeof flowsFetcher !== 'function') return Promise.resolve(null);
    if (_flows && now() - _flowsAt < PIPELINE_FLOWS_TTL_MS) return Promise.resolve(_flows);
    if (_flowsPromise) return _flowsPromise;
    _flowsPromise = Promise.resolve()
      .then(() => flowsFetcher({ fetcher: doFetch }))
      .then((payload) => { _flows = payload || null; _flowsAt = now(); _flowsPromise = null; return _flows; })
      .catch((error) => { _flowsPromise = null; console.warn(LOG + ' živé toky nedostupné: ' + (error?.message || error)); return null; });
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
    const id = picked?.id?.__pipelineLayer === profile.id ? picked.id.__gasPipeline : null;
    const record = id ? _features.get(id) : null;
    if (!record) { if (!_hover.isHovered()) _hover.hide(); return; }
    const flowIds = _hover.show(record.feature, _pointer, { group: groupSummaryOf(record.feature.id) });
    if (flowIds.length) {
      void loadFlows().then((payload) => { _hover?.setFlows(record.feature, payload); });
    }
  }

  function moveHover(e) {
    if (e.buttons || e.pointerType === 'touch') { clearHover(); return; }
    _pointer = { x: e.clientX, y: e.clientY };
    if (!_hoverTimer) _hoverTimer = setTimer(hoverAtPointer, PIPELINE_HOVER_DELAY_MS);
  }

  function leaveHover(e) {
    // Dotyk: pointerleave chodí po každom zdvihnutí prsta — karta otvorená ťuknutím musí ostať.
    if (e?.pointerType === 'touch') return;
    if (_leaveTimer) clearTimer(_leaveTimer);
    _leaveTimer = setTimer(() => { _leaveTimer = null; if (!_hover?.isHovered()) clearHover(); }, 220);
  }

  function installHover() {
    const canvas = _viewer?.scene?.canvas;
    if (_hoverListeners || !canvas?.addEventListener) return;
    // Dátum snímku do päty karty (pravidlo 2: statický snímok sa hlási dátumom).
    _hover = _hover || hoverFactory({ translate, lang, snapshotDate: () => combinedMeta()?.snapshot ?? null });
    // pointerdown si pamätá typ ukazovateľa: dotyk → ťuknutie otvorí plnú kartu (showTouchCard).
    _hoverListeners = { pointermove: moveHover, pointerleave: leaveHover, pointerdown: (e) => { _lastPointerType = e?.pointerType || 'mouse'; clearHover(); } };
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
    id: profile.id,
    get name() { return translate(profile.nameKey); },
    // Monochromatický glyf (žiadne emoji): rúra.
    icon: profile.icon,
    get source() { return profile.sourceLabel(combinedMeta(), translate, lang()); },
    updateInterval: GAS_PIPELINES_REFRESH_MS,

    init(viewer) {
      _viewer = viewer;
      _groundSupported = groundSupport(viewer?.scene);
      if (!_groundSupported) console.warn(LOG + ' GroundPolylinePrimitive unsupported — čiary 200 m nad elipsoidom');
      // Prvý druh = zdroj s holým id vrstvy (kontextový panel ho pozná), ďalšie s príponou.
      _sources = Object.fromEntries(profile.kinds.map((kind, i) => [kind, dataSourceFactory(i === 0 ? profile.id : `${profile.id}-${kind}`)]));
      eachSource((source) => { source.show = false; viewer?.dataSources?.add?.(source); });
      _selection = dataSourceFactory(`${profile.id}-selected`);
      _selection.show = false;
      viewer?.dataSources?.add?.(_selection);
      _ghost = dataSourceFactory(`${profile.id}-ghost`);
      _ghost.show = false;
      viewer?.dataSources?.add?.(_ghost);
      _loaded = false;
      _loading = null;
    },

    enable() {
      _enabled = true;
      applySourceVisibility();
      installClick();
      installHover();
      installGhostMove();
      installCellMove();
      if (!_loaded && !_loading) void layer.update();
      else { publishCard(); scheduleGhost(); scheduleCells(); }
    },

    disable() {
      _enabled = false;
      applySourceVisibility();
      removeClick();
      removeHover();
      removeGhostMove();
      removeCellMove();
      if (_selectedId) selectPipeline(null);
      overlayHost.clearSource(profile.id);
      overlayHost.setVisible(profile.id, false);
      if (_viewer?.selectedEntity?.__gasPipeline && _viewer.selectedEntity.__pipelineLayer === profile.id) _viewer.selectedEntity = undefined;
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
        _error = error?.code === 'no_snapshot' ? translate(profile.noSnapshotKey) : (error?.message || String(error));
        console.warn(LOG, _error);
        return false;
      }
    },

    destroy(viewer) {
      layer.disable();
      _hover?.destroy?.();
      _hover = null;
      if (typeof window !== 'undefined') removeEntityContextsForLayer(profile.id);
      const host = viewer || _viewer;
      eachSource((source) => { if (host?.dataSources?.remove) host.dataSources.remove(source, true); });
      if (_selection && host?.dataSources?.remove) host.dataSources.remove(_selection, true);
      _selection = null;
      if (_ghost && host?.dataSources?.remove) host.dataSources.remove(_ghost, true);
      _ghost = null;
      _ghostHeights = new Map();
      _ghostRecords = null;
      _fenceCount = 0;
      _groups = new Map();
      _groupKeyById = new Map();
      _sources = nullKinds();
      _viewer = null;
      _features = new Map();
      _cellIndex = null;
      _cellIds = new Map();
      _loaded = false;
      _loading = null;
      _meta = null;
      _extraMetas = [];
      _kinds = emptyKinds();
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
      for (const kind of profile.kinds) {
        if (!Object.hasOwn(params || {}, kind)) continue;
        const value = normalizeFlag(params[kind]);
        if (value === null || value === _params[kind]) continue;
        _params = { ..._params, [kind]: value };
        changed = true;
      }
      if (!changed) return true;
      applySourceVisibility();
      const selected = _selectedId ? _features.get(_selectedId) : null;
      if (selected && !_params[profile.styleFor(selected.feature.properties).kind]) selectPipeline(null);
      clearHover();
      scheduleGhost();
      _rowControlsListener?.();
      _viewer?.scene?.requestRender?.();
      return true;
    },

    getParams() {
      return { ..._params };
    },

    /** Čipy PLYN / ROPA + legenda s počtami a farbami látok. */
    getRowControls() {
      const colors = profile.kindColors;
      return {
        chips: profile.kinds.map((kind) => ({
          id: `kind-${kind}`,
          label: translate(profile.chipLabelKey(kind)),
          title: translate(profile.chipHintKey(kind)),
          active: Boolean(_params[kind]),
          params: { [kind]: !_params[kind] },
        })),
        legend: profile.kinds.map((kind) => ({
          label: translate(profile.chipLabelKey(kind)),
          count: _kinds[kind],
          color: colors[kind],
          blurb: translate(profile.chipHintKey(kind)),
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
        source: profile.sourceLabel(combinedMeta(), translate, lang()) + (_groundSupported ? '' : ` · ${translate(profile.noGroundKey)}`),
        kinds: { ..._kinds },
        status: undefined,
      };
    },

    hasContact(id) {
      return _features.has(String(id).replace(`${profile.id}:`, ''));
    },

    selectPipeline,

    _getStateForTest() {
      const entities = profile.kinds.reduce((n, kind) => n + (_sources[kind]?.entities?.values?.length ?? 0), 0);
      return {
        enabled: _enabled, loaded: _loaded, error: _error, count: _features.size, counts: { ..._counts }, lengthKm: _lengthKm, selected: _selectedId,
        entities: profile.kinds.some((kind) => _sources[kind]) ? entities : null, hasClick: Boolean(_clickHandler), meta: _meta,
        kinds: { ..._kinds }, oilMeta: _extraMetas[0] ?? null, extraMetas: [..._extraMetas], params: { ..._params },
        sources: { ...Object.fromEntries(profile.kinds.map((kind) => [kind, _sources[kind]?.show ?? null])), selected: _selection?.show ?? null, ghost: _ghost?.show ?? null },
        selectionEntities: _selection?.entities?.values?.length ?? null, groundSupported: _groundSupported,
        fences: _fenceCount, groups: _groups.size,
        cells: _cellIndex ? { indexed: _cellIndex.cells.length, resident: [..._cellIds.keys()], listening: Boolean(_removeCellMove), timer: Boolean(_cellTimer) } : null,
        ghost: { supported: ghostSupported(), drawn: _ghost?.entities?.values?.length ?? null, cached: _ghostHeights.size, samples: _ghostSamples, listening: Boolean(_removeGhostMove), timer: Boolean(_ghostTimer) },
        hover: { installed: Boolean(_hoverListeners), timer: Boolean(_hoverTimer), flowsCached: Boolean(_flows) },
      };
    },
  };
  return layer;
}

const gasPipelinesLayer = createGasPipelinesLayer();
export default gasPipelinesLayer;
