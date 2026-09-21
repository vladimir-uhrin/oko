// src/data/meteoLayer.js
// Meteorológia sveta — vrstva „GFS · vietor a teplota" (2026-09-08, prototyp
// „ako Windy, štýl OKO", používateľ: GPU častice, najprv prototyp).
//
// Čo robí: pre každý krok predpovede (3 h, +72 h) stiahne z proxy /api/meteo
// dva PNG rezy — vietor (R=u, G=v, B=rýchlosť) a teplotu (R) — a ukáže:
//   - farebné pole cez plochú drapériu (Cesium Primitive s vlastným Material
//     fabricom: textúra hodnôt × 1D rampa v identite OKO, meteoField.js),
//   - GPU častice vetra (windParticles.js) nad glóbusom,
//   - spodnú časovú os (meteoTimeline.js) s prehrávaním.
// Čipy v riadku vrstvy prepínajú pole (VIETOR / TEPLOTA) a častice; legenda
// je rampa. Podklad: pri zapnutí sa fotoreálny Google 3D vymení za GIBS
// Blue Marble (tlmený reliéf ako Windy), pri vypnutí sa vráti pôvodný.
//
// Dáta sú PREDPOVEĎ modelu (NOAA/NCEP GFS 0,25° cez NSF Unidata THREDDS),
// nie pozorovanie — riadok zdroja aj os to hovoria (beh, krok, vek).

import * as Cesium from 'cesium';
import { t, currentLanguage } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { getActiveMapStack, onActiveMapStackChange } from './activeMapStack.js';
import {
  METEO_FIELD_ORDER, METEO_FIELDS, METEO_LAYER_ID, METEO_RAMPS, WIND_COMPONENT_RANGE,
  normalizeCatalog, rampLegend, rampRgbaTable, runLabel, sliceUrl, stepLabel,
} from './meteoField.js';
import { decodeChannel, downsample, isolines } from './meteoIsolines.js';
import { awaitImageDecode } from './imageDecode.js';
import { PLACE_POINT_HEIGHT_M, createPlaceHoverCard, createPlacePoints, loadPlaces, nearestWithinRadius, placeVisibleUntilM, sampleGrid } from './meteoPlaces.js';
import { createWindParticles } from '../windParticles.js';
import { createMeteoTimeline } from '../meteoTimeline.js';

export { METEO_LAYER_ID };
export const METEO_CATALOG_URL = '/api/meteo/catalog';
/**
 * Výška drapérie nad elipsoidom: 10 km — NAD celým terénom Google 3D dlaždíc
 * (Everest 8,8 km + okraje dlaždíc). Pri 2 km terén fotoreálu prerážal pole a
 * robil v ňom „diery" (používateľ 2026-09-09: „google zle zobrazuje vrstvy").
 * Z výšky kamery > 30 km je 10 km vizuálne to isté ako povrch.
 */
export const METEO_DRAPE_HEIGHT_M = 10_000;
export const METEO_FIELD_ALPHA = 0.62;
/**
 * Podklad pre polia: tmavá vektorová mapa s popiskami (Stadia Alidade Smooth
 * Dark) — presne to, čo robí Windy: farby poľa na nej svietia, Blue Marble
 * s nimi súperil („to je slabé", 2026-09-08 večer). Výplň je teraz v pokoji
 * priehľadná, takže popisy a pobrežia cez ňu čítať ide.
 */
export const METEO_BASEMAP_ID = 'stadia-dark';
/**
 * Stadia v bezkľúčovom režime obsluhuje LEN lokálny vývoj — overené 2026-09-20:
 * tá istá dlaždica vráti 200 s Origin `http://localhost:4173` a 401 s Origin
 * `https://oko.uhrin.digital`. Na doméne teda meteo ostávalo bez podkladu.
 * Preto sa podklad volí podľa hostiteľa a mimo localhostu padá na bezkľúčové
 * NASA GIBS (ten istý podklad, s akým prototyp začínal).
 *
 * Keď si v bezplatnom Stadia účte autorizuješ doménu, stačí ju pridať do
 * STADIA_KEYLESS_HOSTS — inak sa nič meniť nemusí (Stadia autorizuje Origin,
 * nie api_key v URL).
 */
export const METEO_BASEMAP_FALLBACK_ID = 'gibs-blue-marble';
export const STADIA_KEYLESS_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Ktorý podklad má meteo pýtať pre daného hostiteľa. Prázdny/neznámy hostiteľ
 * (testy, Node) → primárny, nech sa správanie nemení. Pure.
 * @param {string|null|undefined} hostname
 * @returns {string}
 */
export function basemapForHost(hostname) {
  const h = String(hostname || '').trim().toLowerCase();
  if (!h) return METEO_BASEMAP_ID;
  if (STADIA_KEYLESS_HOSTS.includes(h) || h.endsWith('.localhost')) return METEO_BASEMAP_ID;
  return METEO_BASEMAP_FALLBACK_ID;
}
/** Koľko krokov dopredu prednačítať. */
export const METEO_PREFETCH_STEPS = 2;
/** Trvanie jedného kroku pri plynulom prehrávaní (ms) — 3 h predpovede za 2,4 s. */
export const METEO_PLAY_STEP_MS = 2_400;
/** Útlm podľa výšky kamery: plné pole nad 30 km, nič pod 12 km (drapéria je 10 km nad elipsoidom). */
export const METEO_FADE_IN_HEIGHT_M = 30_000;
export const METEO_FADE_OUT_HEIGHT_M = 12_000;

/**
 * Cesium Material: hodnota z textúry (kanál `channel`, 0..1) → skutočná
 * hodnota (`decode`) → pozícia na rampe (`rampRange`) → farba z 1D rampy.
 * Pure (vracia definíciu fabricu, nie objekt Cesia).
 */
export function fieldMaterialFabric() {
  return {
    type: 'OkoMeteoField',
    uniforms: {
      image: Cesium.Material.DefaultImageId,
      imageNext: Cesium.Material.DefaultImageId,
      mixT: 0,
      ramp: Cesium.Material.DefaultImageId,
      channel: 0,
      decodeMin: 0,
      decodeMax: 1,
      rampMin: 0,
      rampMax: 1,
      alpha: METEO_FIELD_ALPHA,
    },
    source: `
      czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        // Interpolácia v čase ako Windy: hodnota = mix(krok, ďalší krok, mixT).
        vec4 px = mix(texture(image, materialInput.st), texture(imageNext, materialInput.st), mixT);
        float raw = channel < 0.5 ? px.r : (channel < 1.5 ? px.g : px.b);
        float value = decodeMin + raw * (decodeMax - decodeMin);
        float u = clamp((value - rampMin) / (rampMax - rampMin), 0.0, 1.0);
        vec4 c = texture(ramp, vec2(u, 0.5));
        material.diffuse = c.rgb;
        // Rampa nesie alfu (zrážky/oblačnosť sú bez javu priehľadné).
        material.alpha = c.a * alpha;
        return material;
      }`,
  };
}

/** Rampa ako canvas 256×1 (Cesium Material berie canvas ako image). */
export function rampCanvas(doc, stops, range) {
  const canvas = doc.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const table = rampRgbaTable(stops, range, 256);
  const img = ctx.createImageData(256, 1);
  img.data.set(table);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Obal primitívu, ktorý sa kreslí LEN vo farebnom prechode. Cesium totiž
 * primitív s `allowPicking: false` nevynechá z pick prechodu — bez pick
 * príkazu prepadne na bežný farebný príkaz a NAMAĽUJE svoje farby do pick
 * framebufferu (Scene.executeCommand). Drapéria bez hĺbkového testu tak
 * prepísala celú obrazovku a scene.pick vracal undefined pre všetko —
 * lietadlá sa nedali klikať ani hoverovať (2026-09-09, overené v prehliadači:
 * 0/51 zásahov s drapériou, 48/48 s týmto obalom). Preskakuje aj hĺbkový
 * prechod (pickPosition), kde drapéria nemá čo robiť. Pure okrem delegovania.
 * @param {{update: Function, destroy?: Function, isDestroyed?: Function, show: boolean}} primitive
 */
export function renderPassOnly(primitive) {
  return {
    get show() { return primitive.show; },
    set show(value) { primitive.show = value; },
    get inner() { return primitive; },
    update(frameState) {
      const passes = frameState?.passes;
      if (passes && (passes.pick || passes.depth || passes.pickVoxel)) return;
      primitive.update(frameState);
    },
    isDestroyed() { return typeof primitive.isDestroyed === 'function' ? primitive.isDestroyed() : false; },
    destroy() { return typeof primitive.destroy === 'function' ? primitive.destroy() : undefined; },
  };
}

/**
 * Drapéria celého sveta s meteo materiálom. Injektovateľné v testoch.
 * @param {{image: HTMLImageElement|HTMLCanvasElement, ramp: HTMLCanvasElement, field: object}} input
 */
export function createFieldPrimitive({ image, imageNext = null, ramp, field }) {
  const material = new Cesium.Material({ fabric: fieldMaterialFabric() });
  material.uniforms.image = image;
  material.uniforms.imageNext = imageNext || image;
  material.uniforms.mixT = 0;
  material.uniforms.ramp = ramp;
  material.uniforms.channel = field.channel;
  material.uniforms.decodeMin = field.decode[0];
  material.uniforms.decodeMax = field.decode[1];
  material.uniforms.rampMin = field.rampRange[0];
  material.uniforms.rampMax = field.rampRange[1];
  material.uniforms.alpha = Number.isFinite(field.alpha) ? field.alpha : METEO_FIELD_ALPHA;
  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        // GFS mriežka začína na 0° E a riadok 0 je 90° N; obrázok je
        // uložený sever hore, PNG ide na obdĺžnik 0..360 → Cesium chce
        // -180..180, preto proxy stĺpce posúva o 180° (viď meteoProxy).
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
        height: METEO_DRAPE_HEIGHT_M,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        granularity: Cesium.Math.toRadians(2),
      }),
    }),
    // Bez pick id; samotné allowPicking:false ale NESTAČÍ — viď renderPassOnly.
    allowPicking: false,
    appearance: new Cesium.EllipsoidSurfaceAppearance({
      material,
      flat: true,
      translucent: true,
      // Bez hĺbkového testu: pole sa kreslí NAD terénom (Google 3D dlaždice —
      // hrubé koreňové dlaždice pri pohľade z vesmíru vyčnievajú aj nad 10 km
      // a robili v poli diery). Odvrátenú pologuľu odreže orezanie zadných
      // stien, takže cez guľu nepresvitá pole z druhej strany.
      renderState: {
        depthTest: { enabled: false },
        depthMask: false,
        cull: { enabled: true, face: Cesium.CullFace.BACK },
        blending: Cesium.BlendingState.ALPHA_BLEND,
      },
    }),
    asynchronous: false,
    show: false,
  });
  return { primitive: renderPassOnly(primitive), material };
}

/** Načíta PNG ako dekódovaný <img> (null pri chybe). */
export function loadImage(url, doc = globalThis.document) {
  return new Promise((resolve) => {
    const img = doc.createElement('img');
    img.decoding = 'async';
    // Dekódovanie smie zdržať, nesmie rozhodovať — viď imageDecode.js.
    img.onload = () => { awaitImageDecode(img).then(() => resolve(img)); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Výška izobar nad elipsoidom (nad drapériou 10 km, pod lietadlami v cestovnej hladine). */
export const ISOLINE_HEIGHT_M = 12_000;
/** Podvzorkovanie mriežky pre izočiary (0,25° → 0,5°): 4× menej práce, čiary ostanú hladké. */
export const ISOLINE_DOWNSAMPLE = 2;

/**
 * Obrázok rezu → mriežka hodnôt (dekódovaný kanál). Kreslí do canvasu, číta pixely.
 * @param {HTMLImageElement} image
 * @param {Document} doc
 * @param {number} channel
 * @param {[number, number]} decode
 * @returns {{values: Float32Array, cols: number, rows: number}}
 */
export function imageToGrid(image, doc, channel, decode) {
  const canvas = doc.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { values: decodeChannel(data, channel, decode), cols: canvas.width, rows: canvas.height };
}

/**
 * Izočiary → Cesium PolylineCollection (biele tenké, zvýraznená hladina hrubšia).
 * @param {Array<{level: number, points: Array<[number, number]>}>} lines
 * @param {{isolines: {step: number, emphasis?: number}}} field
 */
export function createIsolinePrimitive(lines, field) {
  const root = new Cesium.PrimitiveCollection();
  const polylines = new Cesium.PolylineCollection();
  const labels = new Cesium.LabelCollection();
  const labelStride = ISOLINE_LABEL_STRIDE_POINTS;
  for (const line of lines) {
    const flat = [];
    for (const [lon, lat] of line.points) flat.push(lon, lat, ISOLINE_HEIGHT_M);
    const emphasised = field.isolines?.emphasis !== undefined && Math.abs(line.level - field.isolines.emphasis) < 1e-6;
    polylines.add({
      positions: Cesium.Cartesian3.fromDegreesArrayHeights(flat),
      width: emphasised ? 2.6 : 1.4,
      material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(emphasised ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)') }),
    });
    // Popisky hodnôt ako Windy: na dlhých čiarach každých ~stride bodov, na kratších v strede.
    for (const idx of isolineLabelIndices(line.points.length, labelStride)) {
      const [lon, lat] = line.points[idx];
      labels.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, ISOLINE_HEIGHT_M + 500),
        text: String(line.level),
        font: `${emphasised ? 'bold ' : ''}11px "JetBrains Mono", "Consolas", monospace`,
        fillColor: emphasised ? Cesium.Color.WHITE : Cesium.Color.fromCssColorString('#cfeeff'),
        outlineColor: Cesium.Color.fromCssColorString('rgba(3,12,18,0.9)'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: new Cesium.NearFarScalar(2_000_000, 1.0, 20_000_000, 0.7),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }
  root.add(polylines);
  root.add(labels);
  root.show = true;
  return root;
}

/** Každých `stride` bodov ≥ stride od konca; krátka čiara (≥ minPoints) dostane stred. Pure. */
export const ISOLINE_LABEL_STRIDE_POINTS = 90;
export function isolineLabelIndices(length, stride = ISOLINE_LABEL_STRIDE_POINTS, minPoints = 24) {
  if (length < minPoints) return [];
  if (length < stride * 1.5) return [Math.floor(length / 2)];
  const out = [];
  for (let i = Math.floor(stride / 2); i < length - stride / 4; i += stride) out.push(i);
  return out;
}

/**
 * @param {object} [options] test seams
 */
export function createMeteoLayer({
  fetchImpl = null,
  imageLoader = loadImage,
  primitiveFactory = createFieldPrimitive,
  isolineFactory = createIsolinePrimitive,
  gridReader = imageToGrid,
  particlesFactory = createWindParticles,
  timelineFactory = createMeteoTimeline,
  pointsFactory = createPlacePoints,
  hoverFactory = createPlaceHoverCard,
  doc = globalThis.document,
  win = globalThis.window,
  requestFrame = (cb) => globalThis.requestAnimationFrame(cb),
  cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _catalog = null;
  let _index = 0;
  let _field = 'wind';
  let _particlesOn = true;
  let _particles = null;
  let _timeline = null;
  let _drape = null; // { primitive, material }
  let _ramps = {}; // fieldId → canvas
  const _images = new Map(); // url → Promise<img|null>
  let _lastError = null;
  let _lastUpdate = null;
  let _stale = false;
  let _playTimer = null;
  let _previousStack = null;
  let _meteoStackId = null; // ktorý podklad sme si naozaj vypýtali (Stadia vs GIBS)
  let _rowListener = null;
  let _unsubStack = null;
  let _loadToken = 0;
  let _heightFade = 1; // 1 = pohľad zhora, 0 = kamera pod/pri drapérii (pole aj častice zhasnú)
  let _preRender = null;
  let _isolines = null; // Cesium.PrimitiveCollection alebo null
  let _grid = null; // mriežka aktuálneho poľa (izočiary + hodnoty pri mestách)
  let _places = null; // zoznam miest (null = nenačítané)
  let _placePoints = null; // Cesium.PointPrimitiveCollection
  let _hover = null; // DOM karta mesta (meteoPlaces.js)
  let _hoverTimer = null;
  let _leaveTimer = null;
  let _pointer = null;
  let _hoverPlace = null;
  let _fieldGrids = {}; // fieldId → mriežka aktuálneho kroku (pre kartu mesta)
  let _windGrid = null; // { u, v } mriežky aktuálneho kroku
  let _gridLoads = new Set();
  let _canvasListeners = null;
  const _placeScratch = new Cesium.Cartesian3();
  let _fraction = 0; // podiel cesty k ďalšiemu kroku (0..1) pri prehrávaní
  let _playFrame = null;
  let _playLastMs = 0;
  let _stepPending = false; // krok sa načítava po prekročení 1,0
  let _currentImages = { wind: null, windNext: null, field: null, fieldNext: null };

  const lang = () => (currentLanguage?.() === 'en' ? 'en' : 'sk');

  function clearIsolines() {
    if (_isolines && _viewer?.scene?.primitives) _viewer.scene.primitives.remove(_isolines);
    _isolines = null;
  }

  /** Izobary pre polia s `isolines` (tlak): mriežka z obrázka → marching squares → polylines. */
  function clearPlaces() {
    if (_placePoints && _viewer?.scene?.primitives) _viewer.scene.primitives.remove(_placePoints);
    _placePoints = null;
  }

  /** Body miest nad polom (Windy má popisky; my body + karta pri myši). Načítanie miest raz. */
  function updatePlaces() {
    if (!_viewer || !_enabled) return;
    if (_places === null) {
      _places = [];
      loadPlaces(doFetch).then((list) => { _places = list; if (_enabled) updatePlaces(); }).catch((error) => { console.warn('[Data:Meteo] places failed:', error?.message || error); });
      return;
    }
    if (!_places.length || _placePoints) return;
    _placePoints = pointsFactory(_places);
    _viewer.scene.primitives.add(_placePoints);
  }

  // ---- karta mesta pri myši (vzor earthquakes.js) ----
  function gridFor(fieldId) {
    if (_fieldGrids[fieldId]) return _fieldGrids[fieldId];
    const iso = _catalog?.steps[_index];
    if (!iso || _gridLoads.has(fieldId)) return null;
    _gridLoads.add(fieldId);
    imageFor(fieldId, iso).then((img) => {
      _gridLoads.delete(fieldId);
      if (!img || _catalog?.steps[_index] !== iso) return;
      const field = METEO_FIELDS[fieldId];
      _fieldGrids[fieldId] = gridReader(img, doc, field.channel, field.decode);
      if (_hoverPlace) _hover?.update(placeValues(_hoverPlace));
    }).catch(() => { _gridLoads.delete(fieldId); });
    return null;
  }

  function windGrids() {
    if (_windGrid) return _windGrid;
    const img = _currentImages.wind;
    if (!img) return null;
    try {
      _windGrid = { u: gridReader(img, doc, 0, WIND_COMPONENT_RANGE), v: gridReader(img, doc, 1, WIND_COMPONENT_RANGE) };
    } catch { _windGrid = null; }
    return _windGrid;
  }

  /** Hodnoty všetkých polí v meste: undefined = načítava sa, NaN = nedostupné. */
  function placeValues(place) {
    const out = {};
    for (const id of ['temp', 'pressure', 'precip', 'clouds', 'gust']) {
      const g = gridFor(id);
      out[id] = g ? sampleGrid(g, place.lat, place.lon) : undefined;
    }
    const w = windGrids();
    out.wind = w ? { u: sampleGrid(w.u, place.lat, place.lon), v: sampleGrid(w.v, place.lat, place.lon) } : undefined;
    return out;
  }

  function clearHover() {
    clearTimeout(_hoverTimer); clearTimeout(_leaveTimer);
    _hoverTimer = null; _pointer = null; _hoverPlace = null;
    _hover?.hide();
  }

  /** Najbližšie viditeľné (pred obzorom) mesto k bodu obrazovky v okruhu. */
  function nearestPlaceToScreen(x, y) {
    const scene = _viewer?.scene;
    if (!scene || !_places?.length) return null;
    const camHeight = scene.camera?.positionCartographic?.height ?? Infinity;
    const occluder = scene.globe?.ellipsoid ? new Cesium.EllipsoidalOccluder(scene.globe.ellipsoid, scene.camera.positionWC) : null;
    const candidates = [];
    for (const p of _places) {
      if (camHeight > placeVisibleUntilM(p.pop, p.capital)) continue;
      const world = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, PLACE_POINT_HEIGHT_M, undefined, _placeScratch);
      if (occluder && !occluder.isPointVisible(world)) continue;
      const win = Cesium.SceneTransforms.worldToWindowCoordinates?.(scene, world) || Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(scene, world);
      if (win) candidates.push({ place: p, x: win.x, y: win.y });
    }
    return nearestWithinRadius(candidates, x, y);
  }

  function hoverAtPointer() {
    _hoverTimer = null;
    if (!_enabled || !_pointer || !_viewer?.scene?.canvas || !_places?.length) return;
    const bounds = _viewer.scene.canvas.getBoundingClientRect();
    const x = _pointer.x - bounds.left;
    const y = _pointer.y - bounds.top;
    // Presný pick na 3 px bodku je ťažký („nič sa nedeje"), tak nájdeme
    // NAJBLIŽŠIE viditeľné mesto v okruhu od kurzora (2026-09-09).
    const place = nearestPlaceToScreen(x, y);
    if (place) {
      clearTimeout(_leaveTimer);
      _hoverPlace = place;
      const iso = _catalog?.steps[_index];
      _hover?.show(place, _pointer, placeValues(place), iso ? stepLabel(iso, _catalog?.run, lang()) : '');
    } else leaveHover();
  }

  function moveHover(e) {
    if (e.buttons || e.pointerType === 'touch') { clearHover(); return; }
    _pointer = { x: e.clientX, y: e.clientY };
    if (!_hoverTimer) _hoverTimer = setTimeout(hoverAtPointer, 80);
  }

  function leaveHover() {
    clearTimeout(_leaveTimer);
    _leaveTimer = setTimeout(() => { if (!_hover?.isHovered()) clearHover(); }, 220);
  }

  function attachHover() {
    const canvas = _viewer?.scene?.canvas;
    if (!canvas?.addEventListener || _canvasListeners) return;
    if (!_hover) _hover = hoverFactory({ document: doc });
    canvas.addEventListener('pointermove', moveHover);
    canvas.addEventListener('pointerleave', leaveHover);
    canvas.addEventListener('pointerdown', clearHover);
    const removeMove = _viewer.camera?.moveStart?.addEventListener?.(clearHover) || null;
    _canvasListeners = { canvas, removeMove };
  }

  function detachHover() {
    clearHover();
    if (!_canvasListeners) return;
    const { canvas, removeMove } = _canvasListeners;
    canvas.removeEventListener('pointermove', moveHover);
    canvas.removeEventListener('pointerleave', leaveHover);
    canvas.removeEventListener('pointerdown', clearHover);
    removeMove?.();
    _canvasListeners = null;
  }

  function updateIsolines(field, image) {
    clearIsolines();
    _grid = null;
    if (!image || !_viewer) return;
    try {
      const full = gridReader(image, doc, field.channel, field.decode);
      _grid = full;
      _fieldGrids[field.id] = full;
      if (!field.isolines) return;
      const g = downsample(full.values, full.cols, full.rows, ISOLINE_DOWNSAMPLE);
      const dlon = 360 / (g.cols - 1);
      const dlat = -180 / (g.rows - 1);
      const lines = isolines(g.values, g.cols, g.rows, { step: field.isolines.step, min: field.decode[0] + 1, max: field.decode[1] - 1 }, { lon0: -180, lat0: 90, dlon, dlat });
      _isolines = isolineFactory(lines, field);
      _viewer.scene.primitives.add(_isolines);
    } catch (error) {
      console.warn('[Data:Meteo] isolines failed:', error?.message || error);
      _isolines = null;
    }
  }

  function stepsForTimeline() {
    if (!_catalog) return [];
    let lastDay = '';
    return _catalog.steps.map((iso) => {
      const label = stepLabel(iso, _catalog.run, lang());
      const day = label.split(' ').slice(0, 2).join(' ');
      const tick = day !== lastDay ? day : '';
      lastDay = day;
      return { label, day: tick };
    });
  }

  function imageFor(fieldId, iso) {
    const url = sliceUrl(fieldId, iso);
    if (!_images.has(url)) _images.set(url, imageLoader(url, doc));
    return _images.get(url);
  }

  function prefetch() {
    if (!_catalog) return;
    for (let k = 1; k <= METEO_PREFETCH_STEPS; k += 1) {
      const iso = _catalog.steps[_index + k];
      if (!iso) break;
      void imageFor('wind', iso);
      if (_field !== 'wind') void imageFor(_field, iso);
    }
  }

  async function applyStep() {
    if (!_viewer || !_enabled || !_catalog) return;
    const iso = _catalog.steps[_index];
    if (!iso) return;
    const token = ++_loadToken;
    const nextIso = _catalog.steps[_index + 1] || null;
    _timeline?.setStatus(t('meteo.loading'));
    const [windImg, fieldImg, windNext, fieldNext] = await Promise.all([
      imageFor('wind', iso),
      _field === 'wind' ? imageFor('wind', iso) : imageFor(_field, iso),
      nextIso ? imageFor('wind', nextIso) : Promise.resolve(null),
      nextIso ? (_field === 'wind' ? imageFor('wind', nextIso) : imageFor(_field, nextIso)) : Promise.resolve(null),
    ]);
    if (token !== _loadToken || !_enabled) return;
    _currentImages = { wind: windImg, windNext, field: fieldImg, fieldNext };
    _fieldGrids = {};
    _windGrid = null;
    _gridLoads = new Set();
    if (!windImg || !fieldImg) {
      _lastError = t('meteo.slice-failed');
      _timeline?.setStatus(_lastError);
      return;
    }
    _lastError = null;
    const field = METEO_FIELDS[_field];
    if (!_drape) {
      _drape = primitiveFactory({ image: fieldImg, imageNext: fieldNext || fieldImg, ramp: _ramps[_field], field });
      _viewer.scene.primitives.add(_drape.primitive);
    } else {
      _drape.material.uniforms.image = fieldImg;
      _drape.material.uniforms.imageNext = fieldNext || fieldImg;
      _drape.material.uniforms.mixT = 0;
      _drape.material.uniforms.ramp = _ramps[_field];
      _drape.material.uniforms.channel = field.channel;
      _drape.material.uniforms.decodeMin = field.decode[0];
      _drape.material.uniforms.decodeMax = field.decode[1];
      _drape.material.uniforms.rampMin = field.rampRange[0];
      _drape.material.uniforms.rampMax = field.rampRange[1];
    }
    _drape.material.uniforms.alpha = fieldAlphaNow();
    _drape.primitive.show = _heightFade > 0.02;
    _fraction = 0;
    if (_hoverPlace) _hover?.update(placeValues(_hoverPlace));
    updateIsolines(field, fieldImg);
    updatePlaces();
    if (_particles && _particlesOn) {
      _particles.setWind(windImg, { uRange: WIND_COMPONENT_RANGE, vRange: WIND_COMPONENT_RANGE, next: windNext, clear: _playFrame === null });
      _particles.start();
    }
    _timeline?.setStatus(_catalog.stale ? t('meteo.stale') : t('meteo.forecast'));
    governorRequestRender('meteo');
    prefetch();
  }

  function requestBasemap() {
    const active = getActiveMapStack();
    const id = active?.id || null;
    if (id === 'photoreal' || id === null) {
      _previousStack = id;
      _meteoStackId = basemapForHost(win?.location?.hostname);
      win?.dispatchEvent?.(new CustomEvent('gev:request-map-stack', { detail: { id: _meteoStackId, reason: 'meteo' } }));
    } else {
      _previousStack = null;
    }
  }

  function restoreBasemap() {
    if (!_previousStack) return;
    const active = getActiveMapStack();
    if (active?.id === (_meteoStackId || METEO_BASEMAP_ID)) {
      win?.dispatchEvent?.(new CustomEvent('gev:request-map-stack', { detail: { id: _previousStack, reason: 'meteo-restore' } }));
    }
    _previousStack = null;
  }

  /** Alfa poľa pre aktuálne pole × útlm podľa výšky kamery. */
  function fieldAlphaNow() {
    const field = METEO_FIELDS[_field];
    return (Number.isFinite(field?.alpha) ? field.alpha : METEO_FIELD_ALPHA) * _heightFade;
  }

  /**
   * Útlm pri nízkej kamere (2026-09-08 noc): drapéria je 2 km nad elipsoidom, pri
   * kamere pod ňou zakryla celú obrazovku bielou. Windy je 2D a pozerá vždy zhora;
   * my pole aj častice od 20 km nadol stlmíme a pod 5 km zhasneme.
   */
  function syncHeightFade() {
    const h = _viewer?.scene?.camera?.positionCartographic?.height;
    if (!Number.isFinite(h)) return;
    const fade = Math.max(0, Math.min(1, (h - METEO_FADE_OUT_HEIGHT_M) / (METEO_FADE_IN_HEIGHT_M - METEO_FADE_OUT_HEIGHT_M)));
    if (Math.abs(fade - _heightFade) < 0.01) return;
    _heightFade = fade;
    if (_drape) { _drape.material.uniforms.alpha = fieldAlphaNow(); _drape.primitive.show = _enabled && fade > 0.02; }
    if (_isolines) _isolines.show = fade > 0.02;
    _particles?.setVisible(fade > 0.05);
  }

  /** Plynulé prehrávanie (Windy): mixT a častice idú spojito medzi krokmi, krok sa prepne až pri 1,0. */
  function applyFraction(f) {
    _fraction = f;
    if (_drape) _drape.material.uniforms.mixT = _currentImages.fieldNext ? f : 0;
    _particles?.setMix(_currentImages.windNext ? f : 0);
    governorRequestRender('meteo');
  }

  function stopPlay() {
    if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
    if (_playFrame !== null) { cancelFrame(_playFrame); _playFrame = null; }
    applyFraction(0);
  }

  function startPlay() {
    stopPlay();
    _playLastMs = 0;
    const tick = (nowMs) => {
      _playFrame = requestFrame(tick);
      if (!_catalog || !_enabled) return;
      const dt = _playLastMs ? Math.min(100, nowMs - _playLastMs) : 16;
      _playLastMs = nowMs;
      const f = _fraction + dt / METEO_PLAY_STEP_MS;
      if (f < 1 || !_currentImages.fieldNext) { applyFraction(Math.min(f, 0.999)); return; }
      // Kým sa nový krok načítava, drž mix na konci (0,999) a NEPREPÍNAJ znova —
      // inak by sa index posúval každý snímok až po dokončenie fetchu.
      if (_stepPending) { applyFraction(0.999); return; }
      _stepPending = true;
      const next = (_index + 1) % _catalog.steps.length;
      _index = next;
      _timeline?.setIndex(next);
      applyStep().finally(() => { _stepPending = false; });
    };
    _playFrame = requestFrame(tick);
  }

  const layer = {
    id: METEO_LAYER_ID,
    name: 'Meteorológia · vietor a teplota (GFS)',
    icon: '≋',
    get source() {
      const run = _catalog ? runLabel(_catalog.run, lang()) : (lang() === 'en' ? 'GFS 0.25°' : 'GFS 0,25°');
      return `NOAA/NCEP ${run} · NSF Unidata THREDDS · ${t('meteo.forecast')}`;
    },
    updateInterval: 30 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _catalog = null;
      _index = 0;
      _lastError = null;
      _ramps = {};
      for (const id of METEO_FIELD_ORDER) _ramps[id] = rampCanvas(doc, METEO_RAMPS[id], METEO_FIELDS[id].rampRange);
      if (!_timeline && doc?.body) {
        _timeline = timelineFactory(doc, {
          t,
          onIndex: (i) => { _index = i; void applyStep(); },
          onPlay: (playing) => (playing ? startPlay() : stopPlay()),
        });
      }
      _unsubStack = onActiveMapStackChange?.(() => { /* podklad sa mení mimo nás — nič */ }) || null;
      if (viewer?.scene?.preRender?.addEventListener && !_preRender) {
        _preRender = () => syncHeightFade();
        viewer.scene.preRender.addEventListener(_preRender);
      }
      console.log('[Data:Meteo] Initialized');
    },

    enable() {
      _enabled = true;
      requestBasemap();
      _timeline?.show();
      attachHover();
      if (!_particles && _viewer?.container && _particlesOn) {
        try {
          _particles = particlesFactory(_viewer.container, _viewer);
          _particles.setRamp(rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange), METEO_FIELDS.wind.rampRange);
        } catch (error) {
          console.warn('[Data:Meteo] particles unavailable:', error?.message || error);
          _particles = null;
        }
      }
      if (_catalog) void applyStep();
      else void this.update();
    },

    disable() {
      _enabled = false;
      _loadToken += 1;
      stopPlay();
      _timeline?.hide();
      if (_drape) _drape.primitive.show = false;
      clearIsolines();
      clearPlaces();
      detachHover();
      _grid = null;
      _fieldGrids = {};
      _windGrid = null;
      _particles?.stop();
      restoreBasemap();
      governorRequestRender('meteo');
    },

    async update() {
      try {
        const response = await doFetch(METEO_CATALOG_URL);
        if (!response?.ok) { _lastError = `meteo proxy HTTP ${response?.status}`; return false; }
        const catalog = normalizeCatalog(await response.json());
        if (!catalog) { _lastError = t('meteo.catalog-failed'); return false; }
        const runChanged = _catalog?.run !== catalog.run;
        _catalog = catalog;
        _stale = catalog.stale;
        _lastUpdate = new Date();
        _lastError = null;
        if (runChanged) _images.clear();
        _timeline?.setSteps(stepsForTimeline(), runLabel(catalog.run, lang()));
        if (_index >= catalog.steps.length) _index = 0;
        _timeline?.setIndex(_index);
        _rowListener?.();
        if (_enabled) void applyStep();
        return true;
      } catch (error) {
        _lastError = String(error?.message || error);
        return false;
      }
    },

    /**
     * Čipy: pole (wind/temp) a častice.
     * @param {{field?: string, particles?: boolean}} params
     */
    setParams(params = {}) {
      let changed = false;
      if (params.field && METEO_FIELDS[params.field] && params.field !== _field) { _field = params.field; changed = true; }
      if (typeof params.particles === 'boolean' && params.particles !== _particlesOn) {
        _particlesOn = params.particles;
        if (_particlesOn) {
          if (!_particles && _viewer?.container) {
            _particles = particlesFactory(_viewer.container, _viewer);
            _particles.setRamp(rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange), METEO_FIELDS.wind.rampRange);
          }
        } else _particles?.stop();
        changed = true;
      }
      if (changed && _enabled) void applyStep();
      _rowListener?.();
      return true;
    },

    getParams() { return { field: _field, particles: _particlesOn }; },

    setRowControlsListener(fn) { _rowListener = typeof fn === 'function' ? fn : null; },

    getRowControls() {
      const field = METEO_FIELDS[_field];
      return {
        chips: [
          ...METEO_FIELD_ORDER.map((id) => ({ id: `field-${id}`, label: t(`meteo.chip-${id}`), active: _field === id, params: { field: id } })),
          { id: 'particles', label: t('meteo.chip-particles'), active: _particlesOn, params: { particles: !_particlesOn }, disabled: _particles ? !_particles.isSupported() : false },
        ],
        legend: rampLegend(METEO_RAMPS[_field], field.unit),
      };
    },

    getStats() {
      return {
        count: _catalog?.steps.length || 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },

    /** Test seam. */
    _getStateForTest() {
      return { enabled: _enabled, index: _index, field: _field, particlesOn: _particlesOn, catalog: _catalog, drape: Boolean(_drape), previousStack: _previousStack, fraction: _fraction, places: _places?.length ?? null, points: Boolean(_placePoints), hover: _hoverPlace?.name ?? null, grid: Boolean(_grid) };
    },

    destroy(viewer) {
      this.disable();
      if (_drape) { viewer?.scene?.primitives?.remove?.(_drape.primitive); _drape = null; }
      clearIsolines();
      clearPlaces();
      detachHover();
      _hover?.destroy(); _hover = null;
      _particles?.destroy(); _particles = null;
      _timeline?.destroy(); _timeline = null;
      _unsubStack?.(); _unsubStack = null;
      if (_preRender) { viewer?.scene?.preRender?.removeEventListener?.(_preRender); _preRender = null; }
      _images.clear();
    },
  };

  return layer;
}

export default createMeteoLayer();
