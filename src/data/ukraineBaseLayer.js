// src/data/ukraineBaseLayer.js
/**
 * @module ukraineBaseLayer
 * @description Podklad modulu UKRAJINA (etapa 1, 2026-09-19): sídla, cesty,
 * rieky a hranice oblastí zo statického OSM snímku (`/api/ukraine/base/*`,
 * `scripts/build-ukraine-base.mjs`) ako SAMOSTATNÝ prekryv — nie vrstva
 * správcu (tokeny odkazu sú plné, správca odmietne vrstvu bez tokenu; rovnaké
 * rozhodnutie ako hranice štátov). Zapína ho panel UKRAJINA a scény smerov.
 *
 * Štyri CustomDataSource (jeden na časť, čip = jedno `show`), lenivé načítanie
 * pri prvom zobrazení, obce (27 000 bodov) až pod ~260 km a len kohorta okolo
 * stredu pohľadu, riedenie popisov mriežkou po ustálení kamery, karta pri
 * prechode myšou (latinka + originál). Čisté výpočty žijú v ukraineBase.js.
 *
 * Výšky: body a popisky NIE cez `heightReference: CLAMP_TO_GROUND` — pri
 * streamovaní Google 3D dlaždíc by každá načítaná dlaždica prepočítavala výšku
 * ~3 000 entít (používateľ 2026-09-19 večer: „strašne vysoké hodnoty CPU";
 * prístavy sa tej istej pasci vyhýbajú vlastným vzorkovaním). Namiesto toho sa
 * výška zistí RAZ zo spoločného resolvera `/api/terrain/heights` (Re:Earth DEM,
 * dávky po 200, cache) a entita sa zdvihne; kým výška nepríde, sedí na
 * elipsoide a `disableDepthTestDistance` ju drží nad terénom. Čiary
 * `clampToGround` s klasifikáciou BOTH ako rúry (lacné, merané).
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { createLocalHoverCard } from './localHoverCard.js';
import { resolveEllipsoidalGround } from './terrainHeights.js';
import {
  CAMERA_SETTLE_MS,
  OBLAST_STYLE,
  PLACE_STYLE,
  RIVER_STYLE,
  UKRAINE_BASE_API,
  UKRAINE_BASE_PARTS,
  declutterLabels,
  inWindow,
  lineLabel,
  placeFlyView,
  placeImportance,
  placeLabel,
  placeLabelDisplayCondition,
  placeMapText,
  placePointDisplayCondition,
  riverDisplayCondition,
  roadStyle,
  selectVillageCohort,
  snapshotDateText,
  villagesWanted,
} from './ukraineBase.js';
import { buildPlaceIndex } from './ukraineReportPlaces.js';

export const UKRAINE_BASE_ID = 'ukraine-base';
export const UKRAINE_HOVER_DELAY_MS = 80;
export const UKRAINE_HOVER_PICK_PX = 7;
/** Núdzová výška čiar nad elipsoidom, keď GPU nevie pozemné čiary (ako rúry). */
export const FALLBACK_HEIGHT_M = 200;
const FONT = '"IBM Plex Mono", monospace';
const LABEL_OUTLINE = '#0b1622';
/**
 * Štýlové režimy podkladu (setStyle): KARTA = polovičné hrúbky čiar, menšie body
 * a popisy — používateľ 2026-09-20: „chcel som jemnejšie línie". Násobky sa
 * aplikujú pri vzniku entity aj spätne na už nakreslené.
 */
export const UKRAINE_BASE_STYLES = Object.freeze({
  default: Object.freeze({ line: 1, point: 1, font: 1 }),
  karta: Object.freeze({ line: 0.5, point: 0.72, font: 0.9 }),
});
/** Farby špendlíkov podľa strany (KARTA K3, ako vo vzorke): UA modrá, RU červená, sporné oranžová. */
export const SIDE_PIN_COLORS = Object.freeze({ ua: '#5b8fd0', ru: '#d0554a', contested: '#f0a53a' });
/** Žiarenie miest na KARTE: od tejto populácie, polomer z populácie, teplá červená. */
export const GLOW_MIN_POP = 10_000;
export const GLOW_COLOR = '#ff5a4a';
export const GLOW_ALPHA = 0.3;
export function glowRadiusPx(pop) { return Math.min(70, 26 + 14 * Math.log10(Math.max(1, (Number(pop) || 0) / 5000))); }
/** Radiálny gradient (biely stred → priehľadné) ako obrázok billboardu; farbu dodá billboard.color. */
export function defaultGlowImage(doc = globalThis.document) {
  if (!doc?.createElement) return null;
  const c = doc.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); if (!g) return null;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.4)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return c;
}

/** GPU vie pozemné čiary (hĺbková textúra)? Bez scény optimisticky áno. */
export function defaultGroundSupport(scene) {
  try { return scene ? Cesium.GroundPolylinePrimitive.isSupported(scene) : true; } catch { return true; }
}

/** Po tomto čase (ms) sa po neúspešnom vzorkovaní výšok skúsi znova. */
export const LIFT_RETRY_MS = 120_000;

/**
 * Elipsoidné výšky terénu pre body [lon, lat] zo spoločného resolvera
 * (`/api/terrain/heights`, Re:Earth). Geoidná núdzovka sa vracia ako null —
 * radšej bod na elipsoide než „presne" na geoide. Rovnaké ako pri rúrach.
 * @param {number[][]} points
 * @returns {Promise<Array<number|null>>}
 */
export async function defaultTerrainSampler(points) {
  const resolved = await resolveEllipsoidalGround(points.map(([lon, lat]) => ({ lat, lon })));
  return points.map((_, i) => { const r = resolved[i]; return r && r.source === 'reearth' && Number.isFinite(r.ellipsoid) ? r.ellipsoid : null; });
}

/** Premietnutie do okna (Cesium 1.124: worldToWindowCoordinates; starší názov ako záloha). */
function defaultProjector(scene) {
  const fn = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  const scratch = new Cesium.Cartesian2();
  return (position) => {
    try {
      const out = fn(scene, position, scratch);
      return out ? { x: out.x, y: out.y } : null;
    } catch { return null; }
  };
}

/**
 * @param {object} o
 * @param {object} o.viewer Cesium Viewer (alebo náhrada v testoch)
 * @param {Function} [o.fetchImpl]
 * @param {string} [o.api]
 * @param {Function} [o.translate]
 * @param {() => string} [o.lang]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: object) => object} [o.handlerFactory]
 * @param {(o: object) => object} [o.hoverFactory]
 * @param {(scene: object) => boolean} [o.groundSupport]
 * @param {(scene: object) => (position: object) => ({x:number,y:number}|null)} [o.projectorFactory]
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 */
export function createUkraineBaseLayer({
  viewer,
  fetchImpl = null,
  api = UKRAINE_BASE_API,
  translate = translateDefault,
  lang = () => currentLanguage(),
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  hoverFactory = (o) => createLocalHoverCard(o),
  groundSupport = defaultGroundSupport,
  terrainSampler = defaultTerrainSampler,
  projectorFactory = defaultProjector,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  glowImageFactory = defaultGlowImage,
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const inert = {
    id: UKRAINE_BASE_ID, show: async () => false, hide() {}, toggle: async () => false, isShown: () => false,
    setPart() {}, getParts: () => ({ ...defaultParts() }), loadMeta: async () => null, getPlaceIndex: async () => new Map(), setReservedPlaces() {}, setStyle() {}, getStyle: () => 'default', setSideResolver() {}, refreshSides() {},
    getState: () => ({ shown: false, loading: false, loaded: false, error: 'no-viewer', meta: null, parts: defaultParts(), counts: emptyCounts(), villagesLoaded: false, snapshotDate: null }),
    onChange: () => () => {}, refresh() {}, destroy() {},
  };
  if (!viewer?.dataSources) return inert;

  const scene = viewer.scene || null;
  const camera = viewer.camera || null;
  const ground = groundSupport(scene);
  const project = projectorFactory(scene);

  /** @type {Record<string, object>} časť → CustomDataSource */
  const sources = {};
  for (const part of UKRAINE_BASE_PARTS) {
    const ds = dataSourceFactory(`${UKRAINE_BASE_ID}:${part}`);
    ds.show = false;
    try { viewer.dataSources.add(ds); } catch { /* headless */ }
    sources[part] = ds;
  }

  let _shown = false;
  let _loaded = false;
  let _loading = null;
  let _error = null;
  let _meta = null;
  let _metaPromise = null;
  const _parts = defaultParts();
  const _counts = emptyCounts();
  /** Záznamy sídiel (mestá + mestečká) a kohorty obcí: id → record. */
  const _placeRecords = new Map();
  const _villageRecords = new Map();
  /** OSM id sídiel, ktoré kreslí iná vrstva (hlásenie GŠ): bod aj popisok podkladu sa skryjú, aby nevyhrávali výber myšou. */
  let _reserved = new Set();
  let _villageFeatures = null;
  let _placeFeatures = null; // mestá a mestečká (pre index mien hlásenia GŠ)
  let _placeIndex = null;
  let _villagesPromise = null;
  /** entity.id → record (karta pri prechode myšou). */
  const _byEntityId = new Map();
  /** Popisky bez záznamu (rieky, oblasti) — zdvíhajú sa raz po načítaní. */
  const _looseLabels = [];
  // Strana sídla (KARTA K3): resolver z vrstiev KONTROLA/DeepState (main.js); špendlíky
  // podľa strany a žiarenie miest sa kreslia len v štýle 'karta'.
  let _sideResolver = null;
  let _glowImage = undefined; // undefined = ešte neskúšané, null = nedostupné
  const glowImage = () => { if (_glowImage === undefined) { try { _glowImage = glowImageFactory?.() || null; } catch { _glowImage = null; } } return _glowImage; };
  // Štýl (UKRAINE_BASE_STYLES): položky { entity, line?, point?, font? } so ZÁKLADNÝMI hodnotami.
  let _styleMode = 'default';
  const _styled = new Set();
  const styleScale = () => UKRAINE_BASE_STYLES[_styleMode] || UKRAINE_BASE_STYLES.default;
  const fontString = ({ px, weight, italic }, scale) => `${italic ? 'italic ' : ''}${weight} ${Math.round(px * scale * 10) / 10}px ${FONT}`;
  function applyStyleItem(item) {
    const s = styleScale();
    try {
      if (item.line != null && item.entity.polyline) item.entity.polyline.width = item.line * s.line;
      if (item.point != null && item.entity.point) item.entity.point.pixelSize = item.point * s.point;
      if (item.font && item.entity.label) item.entity.label.font = fontString(item.font, s.font);
    } catch { /* entita už preč */ }
  }
  function registerStyle(entity, base) {
    const item = { entity, ...base };
    _styled.add(item);
    if (_styleMode !== 'default') applyStyleItem(item);
    return item;
  }
  /** Prepne štýl podkladu ('default' | 'karta') a prepočíta hrúbky, body a písma všetkých entít. */
  function setStyle(mode) {
    const next = UKRAINE_BASE_STYLES[mode] ? mode : 'default';
    if (next === _styleMode) return;
    _styleMode = next;
    for (const item of _styled) applyStyleItem(item);
    refreshSides();
    requestRender();
    emit();
  }
  /** Farba bodu sídla: v štýle karta podľa strany (resolver), inak farba triedy. */
  function pinColorFor(record) {
    const base = (PLACE_STYLE[record.props.cls] || PLACE_STYLE.village).color;
    if (_styleMode !== 'karta' || typeof _sideResolver !== 'function') return base;
    let side = null;
    try { side = _sideResolver(record.lon, record.lat, record.props); } catch { side = null; }
    return SIDE_PIN_COLORS[side] || base;
  }
  function applySide(record) {
    const css = pinColorFor(record);
    if (record.pinCss === css) return;
    record.pinCss = css;
    try { if (record.entity.point) record.entity.point.color = Cesium.Color.fromCssColorString(css).withAlpha(0.95); } catch { /* */ }
  }
  /** Žiarenie mesta (billboard pod špendlíkom) — len karta, mestá a mestečká od GLOW_MIN_POP. */
  function applyGlow(record) {
    const wants = _styleMode === 'karta' && (record.cls === 'city' || record.cls === 'town') && (Number(record.props.pop) || 0) >= GLOW_MIN_POP;
    if (!wants) { if (record.glow) record.glow.show = false; return; }
    if (!record.glow) {
      const image = glowImage();
      if (!image) return;
      const r = glowRadiusPx(record.props.pop);
      record.glow = sources.places.entities.add({
        id: `${UKRAINE_BASE_ID}:glow:${record.id}`,
        position: record.position,
        billboard: {
          image, width: 2 * r, height: 2 * r,
          color: Cesium.Color.fromCssColorString(GLOW_COLOR).withAlpha(GLOW_ALPHA),
          distanceDisplayCondition: ddc([0, 1_500_000]),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
        },
      });
    }
    record.glow.show = true;
  }
  /** Nastaví zdroj strany sídla (lon, lat, props) → 'ua'|'ru'|'contested'|null a prefarbí špendlíky. */
  function setSideResolver(fn) {
    _sideResolver = typeof fn === 'function' ? fn : null;
    refreshSides();
  }
  /** Prefarbí všetky špendlíky a žiarenia podľa aktuálneho štýlu a resolvera (po zmene dát kontroly). */
  function refreshSides() {
    for (const record of _placeRecords.values()) { applySide(record); applyGlow(record); }
    for (const record of _villageRecords.values()) applySide(record);
    requestRender();
  }
  let _liftFailedAt = 0;
  let _liftSamples = 0;
  const _listeners = new Set();
  let _cameraTimer = null;
  let _removeMoveEnd = null;
  let _handler = null;
  let _hover = null;
  let _hoverTimer = null;
  let _pointer = null;
  let _canvasLeave = null;
  let _destroyed = false;

  const requestRender = () => { try { scene?.requestRender?.(); } catch { /* headless */ } };

  function emit() {
    const state = getState();
    for (const fn of _listeners) { try { fn(state); } catch (error) { console.warn('[UkraineBase] listener error:', error); } }
  }

  function applyVisibility() {
    for (const part of UKRAINE_BASE_PARTS) sources[part].show = _shown && Boolean(_parts[part]);
    if (!_shown) _hover?.hide?.();
    requestRender();
  }

  // ── Materiály a entity ────────────────────────────────────────────────────
  const color = (css, alpha) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
  const ddc = ([near, far]) => new Cesium.DistanceDisplayCondition(near, far);
  const roadMaterials = new Map();
  const roadMaterial = (cls) => {
    if (!roadMaterials.has(cls)) { const s = roadStyle(cls); roadMaterials.set(cls, new Cesium.ColorMaterialProperty(color(s.color, s.alpha))); }
    return roadMaterials.get(cls);
  };
  const riverMaterial = new Cesium.ColorMaterialProperty(color(RIVER_STYLE.color, RIVER_STYLE.alpha));
  const oblastMaterial = new Cesium.PolylineDashMaterialProperty({ color: color(OBLAST_STYLE.color, OBLAST_STYLE.alpha), dashLength: OBLAST_STYLE.dashLength });

  function polylineFor(coordinates, { width, material, displayCondition }) {
    const flat = [];
    if (ground) for (const [lon, lat] of coordinates) flat.push(lon, lat);
    else for (const [lon, lat] of coordinates) flat.push(lon, lat, FALLBACK_HEIGHT_M);
    const polyline = {
      positions: ground ? Cesium.Cartesian3.fromDegreesArray(flat) : Cesium.Cartesian3.fromDegreesArrayHeights(flat),
      width,
      material,
      clampToGround: ground,
    };
    if (ground) polyline.classificationType = Cesium.ClassificationType.BOTH;
    if (displayCondition) polyline.distanceDisplayCondition = ddc(displayCondition);
    return polyline;
  }

  function labelFor(text, { fontPx, weight = 500, colorCss, italic = false, displayCondition, offsetX = 8, uppercase = false, background = false }) {
    const label = {
      text: uppercase ? text.toUpperCase() : text,
      font: `${italic ? 'italic ' : ''}${weight} ${fontPx}px ${FONT}`,
      fillColor: Cesium.Color.fromCssColorString(colorCss),
      outlineColor: Cesium.Color.fromCssColorString(LABEL_OUTLINE).withAlpha(0.9),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(offsetX, -1),
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
    if (displayCondition) {
      label.distanceDisplayCondition = ddc(displayCondition);
      // Jemné doznievanie tesne pred hranicou viditeľnosti, nie ostrý strih.
      label.translucencyByDistance = new Cesium.NearFarScalar(displayCondition[1] * 0.55, 1, displayCondition[1], 0.15);
    }
    if (background) {
      label.showBackground = true;
      label.backgroundColor = Cesium.Color.fromCssColorString(LABEL_OUTLINE).withAlpha(0.72);
      label.backgroundPadding = new Cesium.Cartesian2(5, 3);
    }
    return label;
  }

  /** Bod + popisok sídla; record si drží entitu, dôležitosť a pozíciu pre riedenie. */
  function addPlace(ds, feature) {
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    const style = PLACE_STYLE[props.cls] || PLACE_STYLE.village;
    const text = placeMapText(props);
    if (!text) return null;
    const position = Cesium.Cartesian3.fromDegrees(lon, lat);
    const entityId = `${UKRAINE_BASE_ID}:place:${props.id}`;
    const entity = ds.entities.add({
      id: entityId,
      position,
      point: {
        pixelSize: style.pointPx,
        color: Cesium.Color.fromCssColorString(style.color).withAlpha(0.95),
        outlineColor: Cesium.Color.fromCssColorString(LABEL_OUTLINE).withAlpha(0.85),
        outlineWidth: props.cls === 'village' ? 1 : 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: ddc(placePointDisplayCondition(props.cls)),
      },
      label: labelFor(text, { fontPx: style.fontPx, weight: style.weight, colorCss: style.color, displayCondition: placeLabelDisplayCondition(props.cls), background: props.cls === 'city' }),
    });
    const record = { id: props.id, kind: 'place', cls: props.cls, props, lon, lat, position, entity, importance: placeImportance(props), labelFar: placeLabelDisplayCondition(props.cls)[1], labelShown: true, lifted: false, reservedHidden: false };
    _byEntityId.set(entityId, record);
    record.styleItem = registerStyle(entity, { point: style.pointPx, font: { px: style.fontPx, weight: style.weight, italic: false } });
    record.pinCss = style.color;
    applySide(record);
    if (props.cls !== 'village') applyGlow(record);
    applyReservedTo(record);
    return record;
  }

  function applyReservedTo(record) {
    const hide = _reserved.has(String(record.id));
    if (record.reservedHidden === hide) return;
    record.reservedHidden = hide;
    record.entity.show = !hide;
  }
  /** Sídla prevzaté inou vrstvou (hlásenie GŠ kreslí vlastný bod + popisok); prázdny zoznam = uvoľniť. */
  function setReservedPlaces(ids) {
    _reserved = new Set((Array.isArray(ids) ? ids : []).filter((id) => id !== null && id !== undefined).map(String));
    for (const record of _placeRecords.values()) applyReservedTo(record);
    for (const record of _villageRecords.values()) applyReservedTo(record);
    requestRender();
  }

  /**
   * Zdvihni záznamy na výšku terénu (raz, dávkovo, s cache resolvera). Záznam
   * bez výšky (proxy nedostupná) ostáva na elipsoide a skúsi sa znova po
   * LIFT_RETRY_MS. Nikdy nespúšťa nič pri každom snímku ani pri každej dlaždici.
   * @param {Array<{lon:number, lat:number, entity:object, position:object, lifted?:boolean}>} records
   */
  let _liftChain = Promise.resolve(0);
  function liftRecords(records) {
    // Jedna dávka po druhej (resolver sám delí po 200 a posiela sekvenčne):
    // druhá dávka po zlyhaní prvej vidí odklad a proxy nezahltí.
    _liftChain = _liftChain.then(() => liftRecordsNow(records)).catch(() => 0);
    return _liftChain;
  }
  async function liftRecordsNow(records) {
    const pending = records.filter((r) => r && !r.lifted);
    if (!pending.length || typeof terrainSampler !== 'function' || _destroyed) return 0;
    if (_liftFailedAt && now() - _liftFailedAt < LIFT_RETRY_MS) return 0;
    let heights;
    try { heights = await terrainSampler(pending.map((r) => [r.lon, r.lat])); } catch { heights = null; }
    if (_destroyed) return 0;
    if (!Array.isArray(heights)) { _liftFailedAt = now(); return 0; }
    let lifted = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const h = heights[i];
      const r = pending[i];
      if (!Number.isFinite(h)) continue;
      r.position = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, h);
      try { r.entity.position = r.position; } catch { /* entita už preč */ }
      r.lifted = true;
      lifted += 1;
    }
    if (!lifted) _liftFailedAt = now();
    _liftSamples += pending.length;
    if (lifted) requestRender();
    return lifted;
  }

  function removeRecord(ds, record) {
    _byEntityId.delete(record.entity.id);
    if (record.styleItem) _styled.delete(record.styleItem);
    if (record.glow) { try { ds.entities.remove(record.glow); } catch { /* */ } record.glow = null; }
    try { ds.entities.remove(record.entity); } catch { /* už preč */ }
  }

  function buildPlaces(collection) {
    const ds = sources.places;
    for (const feature of collection?.features || []) {
      if (feature?.geometry?.type !== 'Point') continue;
      const record = addPlace(ds, feature);
      if (record) _placeRecords.set(record.id, record);
    }
    _counts.places = _placeRecords.size;
    void liftRecords([..._placeRecords.values()]);
  }

  /** Popisok bez záznamu (rieka, oblasť): zapamätať na jednorazový zdvih. */
  function looseLabel(entity, lon, lat) {
    const item = { entity, lon, lat, position: Cesium.Cartesian3.fromDegrees(lon, lat), lifted: false };
    _looseLabels.push(item);
    return item;
  }

  function buildRoads(collection) {
    const ds = sources.roads;
    let n = 0;
    for (const feature of collection?.features || []) {
      if (feature?.geometry?.type !== 'LineString' || feature.geometry.coordinates.length < 2) continue;
      const props = feature.properties || {};
      const style = roadStyle(props.cls);
      const entityId = `${UKRAINE_BASE_ID}:road:${n}`;
      const entity = ds.entities.add({ id: entityId, polyline: polylineFor(feature.geometry.coordinates, { width: style.width, material: roadMaterial(props.cls), displayCondition: [0, style.farM] }) });
      registerStyle(entity, { line: style.width });
      _byEntityId.set(entityId, { kind: 'road', props, entity });
      n += 1;
    }
    _counts.roads = n;
  }

  function midpoint(coords) {
    return coords[Math.floor(coords.length / 2)];
  }

  function buildRivers(collection) {
    const ds = sources.rivers;
    let n = 0;
    const labelled = new Set();
    for (const feature of collection?.features || []) {
      if (feature?.geometry?.type !== 'LineString' || feature.geometry.coordinates.length < 2) continue;
      const props = feature.properties || {};
      const entityId = `${UKRAINE_BASE_ID}:river:${n}`;
      const entity = ds.entities.add({ id: entityId, polyline: polylineFor(feature.geometry.coordinates, { width: RIVER_STYLE.width, material: riverMaterial, displayCondition: riverDisplayCondition(props.km) }) });
      registerStyle(entity, { line: RIVER_STYLE.width });
      _byEntityId.set(entityId, { kind: 'river', props, entity });
      n += 1;
      // Popisok veľkej rieky raz (na najdlhšom úseku, ktorý príde prvý — build ich radí za sebou).
      const key = String(props.name || '').toLowerCase();
      if (Number(props.km) >= RIVER_STYLE.bigKm && key && !labelled.has(key)) {
        labelled.add(key);
        const [lon, lat] = midpoint(feature.geometry.coordinates);
        const label = ds.entities.add({
          id: `${UKRAINE_BASE_ID}:river-label:${n}`,
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          label: labelFor(lineLabel(props).text, { fontPx: 10.5, weight: 500, colorCss: RIVER_STYLE.color, italic: true, displayCondition: [0, 700_000], offsetX: 4 }),
        });
        registerStyle(label, { font: { px: 10.5, weight: 500, italic: true } });
        looseLabel(label, lon, lat);
      }
    }
    _counts.rivers = n;
  }

  function buildOblasts(collection) {
    const ds = sources.oblasts;
    let n = 0;
    for (const feature of collection?.features || []) {
      if (feature?.geometry?.type !== 'LineString' || feature.geometry.coordinates.length < 2) continue;
      registerStyle(ds.entities.add({ id: `${UKRAINE_BASE_ID}:oblast:${n}`, polyline: polylineFor(feature.geometry.coordinates, { width: OBLAST_STYLE.width, material: oblastMaterial, displayCondition: [0, OBLAST_STYLE.farM] }) }), { line: OBLAST_STYLE.width });
      n += 1;
    }
    for (const oblast of collection?.oblasts || []) {
      if (!Array.isArray(oblast.center)) continue;
      const text = lineLabel(oblast).text;
      if (!text) continue;
      const label = ds.entities.add({
        id: `${UKRAINE_BASE_ID}:oblast-label:${oblast.id}`,
        position: Cesium.Cartesian3.fromDegrees(oblast.center[0], oblast.center[1]),
        label: labelFor(text, { fontPx: 10, weight: 600, colorCss: OBLAST_STYLE.color, displayCondition: [OBLAST_STYLE.labelNearM, OBLAST_STYLE.labelFarM], offsetX: 0, uppercase: true }),
      });
      registerStyle(label, { font: { px: 10, weight: 600, italic: false } });
      looseLabel(label, oblast.center[0], oblast.center[1]);
    }
    _counts.oblasts = n;
    void liftRecords(_looseLabels);
  }

  // ── Načítanie ─────────────────────────────────────────────────────────────
  /**
   * Nikdy `cache: 'force-cache'` na API trasu: keď raz prehliadač uloží HTML
   * fallback dev servera (Vite bez pluginu počas reštartu konfigurácie), vracia
   * ho navždy bez revalidácie — meta sa preto vždy revaliduje (ETag), súbory
   * idú s verziou snímku v URL a bežnou cache.
   */
  async function fetchJson(url, { cache = 'default' } = {}) {
    const response = await doFetch(url, { cache });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const body = await response.json(); if (body?.error) detail = String(body.error); } catch { /* bez tela */ }
      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }
    const type = typeof response.headers?.get === 'function' ? String(response.headers.get('content-type') || '') : '';
    if (type && !/json/i.test(type)) throw new Error(`not_json (${type.split(';')[0]})`);
    return response.json();
  }

  const versioned = (name) => `${api}/${name}${_meta?.snapshot ? `?v=${encodeURIComponent(_meta.snapshot)}` : ''}`;

  /** Meta snímku (dátum, počty) — lacné, panel ju ukáže aj bez zapnutého podkladu. */
  function loadMeta() {
    if (_meta) return Promise.resolve(_meta);
    if (!_metaPromise) {
      _metaPromise = fetchJson(`${api}/meta`, { cache: 'no-cache' })
        .then((meta) => { _meta = meta && typeof meta === 'object' ? meta : null; _error = null; return _meta; })
        .catch((error) => { _error = error?.message || String(error); return null; })
        .finally(() => { _metaPromise = null; emit(); });
    }
    return _metaPromise;
  }

  function load() {
    if (_loaded) return Promise.resolve(true);
    if (_loading) return _loading;
    _loading = (async () => {
      const meta = await loadMeta();
      if (!meta) return false;
      const [places, roads, rivers, oblasts] = await Promise.all(['places', 'roads', 'rivers', 'oblasts'].map((name) => fetchJson(versioned(name))));
      if (_destroyed) return false;
      _placeFeatures = (places?.features || []).filter((f) => f?.geometry?.type === 'Point');
      _placeIndex = null;
      buildPlaces(places);
      buildRoads(roads);
      buildRivers(rivers);
      buildOblasts(oblasts);
      _loaded = true;
      _error = null;
      console.log(`[UkraineBase] Loaded snapshot ${meta.snapshot}: ${_counts.places} places, ${_counts.roads} road lines, ${_counts.rivers} river lines, ${_counts.oblasts} oblast borders`);
      return true;
    })().catch((error) => {
      _error = error?.message || String(error);
      console.error('[UkraineBase] load error:', error);
      return false;
    }).finally(() => { _loading = null; requestRender(); emit(); });
    return _loading;
  }

  function loadVillages() {
    if (_villageFeatures) return Promise.resolve(_villageFeatures);
    if (!_villagesPromise) {
      _villagesPromise = fetchJson(versioned('villages'))
        .then((collection) => { _villageFeatures = (collection?.features || []).filter((f) => f?.geometry?.type === 'Point'); return _villageFeatures; })
        .catch((error) => { console.warn('[UkraineBase] villages unavailable:', error?.message || error); return null; })
        .finally(() => { _villagesPromise = null; if (!_destroyed) { refresh(); emit(); } });
    }
    return _villagesPromise;
  }

  // ── Kamera: kohorta obcí + riedenie popisov ───────────────────────────────
  function cameraInfo() {
    const carto = camera?.positionCartographic;
    if (!carto) return null;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    let rect = null;
    try {
      const r = camera.computeViewRectangle?.();
      if (r) rect = [Cesium.Math.toDegrees(r.west), Cesium.Math.toDegrees(r.south), Cesium.Math.toDegrees(r.east), Cesium.Math.toDegrees(r.north)];
    } catch { rect = null; }
    if (!rect) {
      // Bez obdĺžnika (horizont v zábere): ±1° na 100 km výšky okolo kamery.
      const span = Math.max(0.4, (carto.height / 100_000) * 1.0);
      rect = [lon - span, lat - span, lon + span, lat + span];
    }
    return { lon, lat, height: carto.height, rect };
  }

  function syncVillages(info) {
    const ds = sources.places;
    const wanted = _shown && _parts.places && info && villagesWanted(info.height) && inWindow(info.lon, info.lat);
    if (!wanted) {
      if (_villageRecords.size) {
        for (const record of _villageRecords.values()) removeRecord(ds, record);
        _villageRecords.clear();
        _counts.villagesCohort = 0;
      }
      return;
    }
    if (!_villageFeatures) { void loadVillages(); return; }
    const cohort = selectVillageCohort(_villageFeatures, info.rect, { lon: info.lon, lat: info.lat });
    const keep = new Set();
    const fresh = [];
    for (const feature of cohort) {
      const id = feature.properties?.id;
      keep.add(id);
      if (!_villageRecords.has(id)) {
        const record = addPlace(ds, feature);
        if (record) { _villageRecords.set(id, record); fresh.push(record); }
      }
    }
    for (const [id, record] of _villageRecords) {
      if (!keep.has(id)) { removeRecord(ds, record); _villageRecords.delete(id); }
    }
    _counts.villagesCohort = _villageRecords.size;
    if (fresh.length) void liftRecords(fresh);
  }

  function declutter(info) {
    if (!info || !scene?.canvas) return;
    const width = scene.canvas.clientWidth || scene.canvas.width || 0;
    const height = scene.canvas.clientHeight || scene.canvas.height || 0;
    if (!width || !height) return;
    const candidates = [];
    const all = [..._placeRecords.values(), ..._villageRecords.values()];
    for (const record of all) {
      // Popisky za hranicou DDC sú skryté aj tak — nech neblokujú bunku; rezervované (skryté) tiež nie.
      if (record.labelFar < info.height || record.reservedHidden) continue;
      const p = project(record.position);
      if (!p) continue;
      candidates.push({ id: record.entity.id, importance: record.importance, x: p.x, y: p.y });
    }
    const visible = declutterLabels(candidates, { width, height });
    const considered = new Set(candidates.map((c) => c.id));
    for (const record of all) {
      const show = considered.has(record.entity.id) ? visible.has(record.entity.id) : true;
      if (record.labelShown !== show) {
        record.labelShown = show;
        if (record.entity.label) record.entity.label.show = show;
      }
    }
  }

  /** Prepočet kohorty obcí a riedenia pre aktuálnu kameru (volá sa po ustálení; testy priamo). */
  function refresh() {
    if (_destroyed || !_shown) return;
    const info = cameraInfo();
    syncVillages(info);
    declutter(info);
    requestRender();
  }

  function scheduleRefresh() {
    if (_cameraTimer) clearTimer(_cameraTimer);
    _cameraTimer = setTimer(() => { _cameraTimer = null; refresh(); }, CAMERA_SETTLE_MS);
  }

  function installCamera() {
    if (_removeMoveEnd || !camera?.moveEnd?.addEventListener) return;
    _removeMoveEnd = camera.moveEnd.addEventListener(scheduleRefresh);
  }

  // ── Karta pri prechode myšou ──────────────────────────────────────────────
  function hoverModelFor(record) {
    const language = lang();
    const { dateText } = snapshotDateText(_meta, { lang: language });
    const source = dateText ? translate('ukraine.source', { date: dateText }) : 'OpenStreetMap';
    if (record.kind === 'place') {
      const { text, original } = placeLabel(record.props);
      const details = [];
      if (original) details.push(original);
      if (record.props.pop) details.push(translate('ukraine.place.population', { n: new Intl.NumberFormat(language === 'sk' ? 'sk-SK' : 'en-GB').format(record.props.pop) }));
      return { layerId: 'ukraine-places', kindText: translate(`ukraine.place.${record.cls}`), title: text, details, source };
    }
    if (record.kind === 'river') {
      const { text, original } = lineLabel(record.props);
      const details = [];
      if (original) details.push(original);
      if (record.props.km) details.push(translate('ukraine.river.length', { km: record.props.km }));
      return { layerId: 'ukraine-rivers', kindText: translate('ukraine.river'), title: text, details, source };
    }
    if (record.kind === 'road') {
      const cls = record.props.cls || 'secondary';
      const title = record.props.ref || translate(`ukraine.road.${cls}`);
      const details = record.props.ref ? [translate(`ukraine.road.${cls}`)] : [];
      return { layerId: 'ukraine-roads', kindText: translate('ukraine.road'), title, details, source };
    }
    return null;
  }

  function pickRecord(position) {
    if (!scene?.pick) return null;
    let picked = null;
    try { picked = scene.pick(position, UKRAINE_HOVER_PICK_PX, UKRAINE_HOVER_PICK_PX); } catch { picked = null; }
    const entity = picked?.id;
    const entityId = typeof entity === 'string' ? entity : entity?.id;
    if (!entityId) return null;
    return _byEntityId.get(entityId) || null;
  }

  function runHover() {
    _hoverTimer = null;
    if (!_shown || !_pointer || !_hover) return;
    if (_hover.isHovered?.()) return;
    const record = pickRecord(_pointer.cartesian);
    if (!record) { _hover.hide(); return; }
    const model = hoverModelFor(record);
    if (!model) { _hover.hide(); return; }
    _hover.show(model, { x: _pointer.x, y: _pointer.y }, record.entity.id);
  }

  /** Klik na sídlo = prelet k nemu (šikmo z juhu, výška podľa triedy); nič iné klik nerobí. */
  function flyToRecord(record) {
    if (record?.kind !== 'place' || typeof camera?.flyTo !== 'function') return false;
    const view = placeFlyView(record.lon, record.lat, record.cls);
    try {
      if (viewer.trackedEntity !== undefined) viewer.trackedEntity = undefined;
      camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(view.lon, view.lat, view.heightM),
        orientation: { heading: Cesium.Math.toRadians(view.headingDeg), pitch: Cesium.Math.toRadians(view.pitchDeg), roll: 0 },
        duration: 1.8,
      });
      return true;
    } catch { return false; }
  }

  function installHover() {
    if (_handler || !scene?.canvas) return;
    try {
      // Päta karty: lokálne vrstvy sľubujú „klik = karta a prelet"; tu klik
      // robí len prelet k sídlu, tak to päta aj hovorí.
      const hoverTranslate = (key, vars) => (key === 'local.hover-hint' ? translate('ukraine.hover-hint') : translate(key, vars));
      _hover = hoverFactory({ translate: hoverTranslate });
      _handler = handlerFactory(scene.canvas);
      _handler.setInputAction((movement) => {
        const end = movement?.endPosition;
        if (!end) return;
        _pointer = { cartesian: end, x: end.x, y: end.y };
        if (_hoverTimer) clearTimer(_hoverTimer);
        _hoverTimer = setTimer(runHover, UKRAINE_HOVER_DELAY_MS);
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      _handler.setInputAction((click) => {
        if (!_shown || !click?.position) return;
        const record = pickRecord(click.position);
        if (record?.kind === 'place' && flyToRecord(record)) _hover?.hide?.();
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      if (scene.canvas.addEventListener) {
        _canvasLeave = () => { _pointer = null; if (!_hover?.isHovered?.()) _hover?.hide?.(); };
        scene.canvas.addEventListener('pointerleave', _canvasLeave);
      }
    } catch (error) {
      console.warn('[UkraineBase] hover unavailable:', error?.message || error);
    }
  }

  // ── Verejné API ───────────────────────────────────────────────────────────
  async function show() {
    if (_destroyed) return false;
    _shown = true;
    applyVisibility();
    installCamera();
    installHover();
    emit();
    const ok = await load();
    if (_destroyed) return false;
    applyVisibility();
    if (ok) refresh();
    return ok;
  }

  function hide() {
    _shown = false;
    if (_cameraTimer) { clearTimer(_cameraTimer); _cameraTimer = null; }
    applyVisibility();
    emit();
  }

  function setPart(part, on) {
    if (!UKRAINE_BASE_PARTS.includes(part)) return;
    _parts[part] = Boolean(on);
    applyVisibility();
    if (part === 'places') refresh();
    emit();
  }

  function getState() {
    const { dateText } = snapshotDateText(_meta, { lang: lang() });
    return {
      shown: _shown,
      loading: Boolean(_loading),
      loaded: _loaded,
      error: _error,
      meta: _meta,
      parts: { ..._parts },
      counts: { ..._counts },
      villagesLoaded: Boolean(_villageFeatures),
      reservedPlaces: _reserved.size,
      style: _styleMode,
      snapshotDate: dateText,
    };
  }

  function destroy() {
    _destroyed = true;
    hide();
    if (_hoverTimer) clearTimer(_hoverTimer);
    if (_removeMoveEnd) { try { _removeMoveEnd(); } catch { /* */ } _removeMoveEnd = null; }
    if (_handler) { try { _handler.destroy(); } catch { /* */ } _handler = null; }
    if (_canvasLeave && scene?.canvas?.removeEventListener) scene.canvas.removeEventListener('pointerleave', _canvasLeave);
    _hover?.destroy?.();
    for (const part of UKRAINE_BASE_PARTS) { try { viewer.dataSources.remove(sources[part], true); } catch { /* */ } }
    _placeRecords.clear();
    _villageRecords.clear();
    _styled.clear();
    _byEntityId.clear();
    _listeners.clear();
  }

  /**
   * Index ukrajinských mien sídel (mestá + obce) pre geokódovanie hlásenia GŠ
   * (ukraineReportPlaces.js). Obce sa dotiahnu, ak ešte nie sú (1,1 MB gz); index
   * sa stavia raz na snímok. Geokódovanie beží v prehliadači — ODbL derivát sa neukladá.
   */
  async function getPlaceIndex() {
    if (_placeIndex) return _placeIndex;
    if (!_placeFeatures) await load();
    const villages = _villageFeatures || (await loadVillages()) || [];
    if (_destroyed) return new Map();
    const index = buildPlaceIndex([...(_placeFeatures || []), ...villages]);
    if (index.size) _placeIndex = index; // prázdny (snímok chýba) sa necachuje — ďalší pokus po načítaní
    return index;
  }

  return {
    id: UKRAINE_BASE_ID,
    show,
    hide,
    toggle: () => (_shown ? (hide(), Promise.resolve(false)) : show()),
    isShown: () => _shown,
    setPart,
    getParts: () => ({ ..._parts }),
    loadMeta,
    getPlaceIndex,
    setReservedPlaces,
    setStyle,
    getStyle: () => _styleMode,
    setSideResolver,
    refreshSides,
    getState,
    onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
    refresh,
    destroy,
    /** Len pre testy. */
    _getStateForTest: () => ({ sources, placeRecords: _placeRecords, villageRecords: _villageRecords, byEntityId: _byEntityId, looseLabels: _looseLabels, liftSamples: _liftSamples, ground, hover: _hover }),
  };
}

function defaultParts() {
  return { places: true, roads: true, rivers: true, oblasts: true };
}
function emptyCounts() {
  return { places: 0, villagesCohort: 0, roads: 0, rivers: 0, oblasts: 0 };
}
