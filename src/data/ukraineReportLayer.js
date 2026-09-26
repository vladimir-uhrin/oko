// src/data/ukraineReportLayer.js
/**
 * @module ukraineReportLayer
 * @description „Strety" na mape (modul UKRAJINA, etapa 2, 2026-09-19): značka
 * skrížených mečov + počet útokov za deň pri každom smere frontu, z denného
 * hlásenia Generálneho štábu ZSU (ArmyInform, CC BY 4.0) cez
 * `/api/ukraine/report`. Kotva = stred presetu smeru (sídlo), nikdy jednotky.
 * Samostatný prekryv ako podklad (tokeny odkazu sú plné); zapína ho panel
 * UKRAJINA (čip STRETY) a ukazuje sa spolu s podkladom.
 *
 * Karta pri prechode myšou: smer, počet útokov, čas hlásenia, odsek hlásenia
 * v origináli (ukrajinsky) a strojový preklad na požiadanie (MyMemory cez
 * /api/translate, `from=uk`), vždy so štítkom „jednostranné oficiálne hlásenie".
 *
 * Sídla z odsekov (otvorená položka etapy 2, dorobené 2026-09-19): mená za
 * „у районі / в напрямках / поблизу" v genitíve → nominatív → index sídel podkladu
 * (`placeIndex`, ukraineBaseLayer.getPlaceIndex; geokódovanie v prehliadači) →
 * malý bod + popisok vo farbe intenzity smeru, jedno sídlo raz aj keď ho menujú
 * dva smery (zmienky sa sčítajú). Karta: „sídlo menované v hlásení", smer(y) a
 * počty, poznámka, že nejde o líniu frontu ani polohu jednotky.
 */
import * as Cesium from 'cesium';
import { currentLanguage, t as translateDefault } from '../i18n.js';
import { translateText as translateTextDefault } from '../translate.js';
import { frontSceneByGsDirection, frontSceneLabel, listFrontScenes } from '../ukraineFrontScenes.js';
import { createLocalHoverCard } from './localHoverCard.js';
import { placeLabel } from './ukraineBase.js';
import { defaultTerrainSampler } from './ukraineBaseLayer.js';
import { fetchUkraineReport, reportByScene } from './ukraineReport.js';
import { directionAnchor, directionPlaces, placeKey } from './ukraineReportPlaces.js';
import { ARROW_CSS, ARROW_LODS, ARROW_MAX_KM, ARROW_OUTLINE_CSS, arrowScale, attackArrowPath, attackArrowPolygon } from './ukraineAttackArrows.js';

export const UKRAINE_REPORT_ID = 'ukraine-report';
export const REPORT_REFRESH_MS = 30 * 60_000;
export const REPORT_HOVER_DELAY_MS = 80;
export const REPORT_HOVER_PICK_PX = 9;
/** Značky vidno až po tejto vzdialenosti kamery (m) — aj z pohľadu na celý front. */
export const REPORT_FAR_M = 3_600_000;
/** Sídla z odsekov: bod do 700 km, popisok do 260 km (zďaleka by to bol len mrak bodiek). */
export const REPORT_PLACE_FAR_M = 700_000;
export const REPORT_PLACE_LABEL_FAR_M = 260_000;
/**
 * Značka smeru sedí nad sídlom kotvy (px), aby bod a meno sídla ostali viditeľné:
 * polovica ikony 11 + polovica popisku 8 + odstup rozmiestnenia 2 = 21 → 22.
 */
export const REPORT_MARKER_DY = -22;
const FONT = '"IBM Plex Mono", monospace';

/** Skrížené meče, jednofarebné (svetlé s tmavým obrysom), ako data URI. */
export const REPORT_MARKER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">'
  + '<g fill="none" stroke="#0b1622" stroke-width="4.2" stroke-linecap="round"><path d="M4 4l14 14M18 4L4 18"/><path d="M3 8l5-5M14 3l5 5M3 14l5 5M14 19l5-5"/></g>'
  + '<g fill="none" stroke="#f1f5f8" stroke-width="2" stroke-linecap="round"><path d="M4 4l14 14M18 4L4 18"/><path d="M3 8l5-5M14 3l5 5M3 14l5 5M14 19l5-5" stroke-width="1.4"/></g></svg>';
export const REPORT_MARKER_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(REPORT_MARKER_SVG)}`;

/**
 * Farba počtu podľa intenzity: neuvedené = tlmená, 0 = sivá, 1–9 = svetlá,
 * 10–24 = jantárová, 25+ = červená. Pure.
 * @param {number|null} attacks
 */
export function reportIntensityColor(attacks) {
  if (attacks === null || attacks === undefined) return '#8a97a3';
  const n = Number(attacks);
  if (n <= 0) return '#8aa0b6';
  if (n < 10) return '#e6eef4';
  if (n < 25) return '#ffb547';
  return '#f87171';
}

/** Text značky: číslo, „0", alebo „—" keď hlásenie počet neuvádza. Pure. */
export function reportMarkerText(attacks) {
  if (attacks === null || attacks === undefined) return '—';
  return String(Math.max(0, Math.round(Number(attacks))));
}

// ── Blesky pri sídlach (KARTA K4) ───────────────────────────────────────────
/** Dohľad blesku (m) a pásmo doznievania/zmenšenia — aby pri oddialení sídla nesplynuli do fľakov. */
export const REPORT_BOLT_FAR_M = 460_000;
export const REPORT_BOLT_FADE_FROM = 0.6;
export const REPORT_BOLT_FAR_SCALE = 0.6;
/** Veľkosť blesku (px): základ + jemne podľa intenzity útokov a počtu zmienok. Pure. */
export function boltSizePx(attacks, mentions = 1) {
  const a = (attacks === null || attacks === undefined) ? 0 : Math.max(0, Number(attacks));
  const size = 15 + Math.min(8, Math.log2(1 + a) * 2.2) + Math.min(3, (Number(mentions) || 1) - 1);
  return Math.round(size);
}
/** YYYY-MM-DD → „23. 9. 2026" (bez dňa „?"). Pure. */
export function dayText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ''));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : '?';
}
/** Tmavý lem popisku sídla (px): KARTA 2 (má podložku), bežný štýl 4 — nad šrafou a ortofotom. Pure. */
export function placeLabelOutlinePx(style) { return style === 'karta' ? 2 : 4; }
/** Vodorovný odstup popisku od kotvy: pri blesku od jeho polovice, inak 8 px. Pure. */
export function placeLabelOffsetX(useBolt, boltSize = 0) { return useBolt ? Math.round(boltSize / 2) + 4 : 8; }

// ── Rozmiestnenie popiskov v obrazovke (KARTA: proti prekryvom) ──────────────
export const LABEL_CHAR_PX = 6.6;   // šírka znaku Plex Mono 11px
export const LABEL_H_PX = 16;       // výška pilulky popisku
export const LABEL_W_PAD = 12;      // podložka + obrys k šírke textu
export const LABEL_PLACEMENTS = Object.freeze(['right', 'left', 'up', 'down']);
/** Obrazovkový obdĺžnik popisku pre danú polohu voči kotve (x,y). Pure. */
export function labelBox(item, placement) {
  const off = item.off ?? 8; const w = item.w; const h = item.h;
  switch (placement) {
    case 'left': return { x: item.x - off - w, y: item.y - h / 2, w, h };
    case 'up': return { x: item.x - w / 2, y: item.y - off - h, w, h };
    case 'down': return { x: item.x - w / 2, y: item.y + off, w, h };
    default: return { x: item.x + off, y: item.y - h / 2, w, h }; // right
  }
}
/**
 * Greedy rozmiestnenie popiskov: podľa priority zhora skúša polohy (vpravo,
 * vľavo, hore, dole), vezme prvú bez prekryvu; keď žiadna nesadne, popisok
 * skryje (kotva/blesk ostane). `fixed` prvky (krížené meče) sa nehýbu a nikdy
 * neskrývajú — sú len prekážky. Pure.
 * @returns {Record<string, 'right'|'left'|'up'|'down'|null>}
 */
export function deconflictLabels(items, { pad = 2 } = {}) {
  const overlap = (a, b) => !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y);
  const placed = [];
  const result = {};
  const order = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const it of order) {
    if (it.fixed) { placed.push(labelBox(it, it.fixed)); result[it.key] = it.fixed; continue; }
    let chosen = null;
    for (const p of (it.candidates || LABEL_PLACEMENTS)) {
      const box = labelBox(it, p);
      if (!placed.some((pb) => overlap(box, pb))) { chosen = p; placed.push(box); break; }
    }
    result[it.key] = chosen;
  }
  return result;
}
/** Projektor svet → okno (px) zo scény; null keď za horizontom. */
function defaultReportProjector(scene) {
  const fn = Cesium.SceneTransforms?.worldToWindowCoordinates || Cesium.SceneTransforms?.wgs84ToWindowCoordinates;
  if (!fn || !scene) return () => null;
  const scratch = new Cesium.Cartesian2();
  return (position) => { try { const o = fn(scene, position, scratch); return o ? { x: o.x, y: o.y } : null; } catch { return null; } };
}
/** Aplikuje polohu popisku na Cesium label (pixelOffset + originy + show). */
export function applyLabelPlacement(label, placement, off) {
  if (!label) return;
  if (placement === null) { label.show = false; return; }
  label.show = true;
  const P = (x, y) => new Cesium.Cartesian2(x, y);
  const H = Cesium.HorizontalOrigin; const V = Cesium.VerticalOrigin;
  if (placement === 'left') { label.pixelOffset = P(-off, 0); label.horizontalOrigin = H.RIGHT; label.verticalOrigin = V.CENTER; }
  else if (placement === 'up') { label.pixelOffset = P(0, -off); label.horizontalOrigin = H.CENTER; label.verticalOrigin = V.BOTTOM; }
  else if (placement === 'down') { label.pixelOffset = P(0, off); label.horizontalOrigin = H.CENTER; label.verticalOrigin = V.TOP; }
  else { label.pixelOffset = P(off, 0); label.horizontalOrigin = H.LEFT; label.verticalOrigin = V.CENTER; }
}
/** Cesta blesku v štvorci 0..28 (smerom dole). */
const BOLT_PATH = Object.freeze([[15, 3], [8, 16], [13, 16], [11, 25], [20, 12], [14, 12], [17, 3]]);
/**
 * Blesk (kontakt v sídle) sfarbený intenzitou, s tmavou svätožiarou a svetlým
 * rámom — ako obrázok billboardu. Farbu pečie priamo (billboard.color biely),
 * cachuje sa podľa css. Vráti plátno alebo null bez document.
 */
export function defaultBoltImage(css, doc = globalThis.document, dpr = (globalThis.devicePixelRatio || 2)) {
  if (!doc?.createElement) return null;
  const S = 28;
  const scale = Math.max(1, Math.min(3, dpr));
  const c = doc.createElement('canvas');
  c.width = Math.round(S * scale); c.height = Math.round(S * scale);
  const g = c.getContext?.('2d');
  if (!g) return null;
  g.scale(scale, scale);
  g.beginPath();
  BOLT_PATH.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.save();
  g.shadowColor = 'rgba(6,12,20,0.95)'; g.shadowBlur = 3; g.shadowOffsetY = 0.5;
  g.fillStyle = css; g.fill();
  g.restore();
  g.lineWidth = 0.9; g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke();
  return c;
}

/**
 * @param {object} o
 * @param {object} o.viewer
 * @param {Function} [o.fetchImpl] fetchUkraineReport
 * @param {ReadonlyArray} [o.scenes]
 * @param {Function} [o.translate]
 * @param {() => string} [o.lang]
 * @param {Function} [o.translateText]
 * @param {(id: string) => object} [o.dataSourceFactory]
 * @param {(canvas: object) => object} [o.handlerFactory]
 * @param {(o: object) => object} [o.hoverFactory]
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 * @param {() => number} [o.now]
 */
export function createUkraineReportLayer({
  viewer,
  fetchImpl = fetchUkraineReport,
  scenes = listFrontScenes(),
  translate = translateDefault,
  lang = () => currentLanguage(),
  translateText = translateTextDefault,
  dataSourceFactory = (id) => new Cesium.CustomDataSource(id),
  handlerFactory = (canvas) => new Cesium.ScreenSpaceEventHandler(canvas),
  hoverFactory = (o) => createLocalHoverCard(o),
  terrainSampler = defaultTerrainSampler,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  now = () => Date.now(),
  /** Async poskytovateľ indexu sídel (ukraineBaseLayer.getPlaceIndex); bez neho sa sídla z odsekov nekreslia. */
  placeIndex = null,
  /** Odovzdá podkladu OSM id nakreslených sídiel (ukraineBaseLayer.setReservedPlaces), aby skryl svoj bod + popisok; [] = uvoľniť. */
  reservePlaces = null,
  /** Obrázok blesku (KARTA K4) podľa css farby; bez neho ostane bod aj v štýle karta. */
  boltImageFactory = defaultBoltImage,
  /** Projektor svet → okno (px) pre rozmiestnenie popiskov (KARTA); testy dajú vlastný. */
  projectorFactory = defaultReportProjector,
  /** Pauza po pohybe kamery pred prepočtom rozmiestnenia (ms). */
  settleMs = 200,
  /** Vzdialenosť sídla k línii kontaktu (km) — ukraineDeepStateLayer.frontKm(lon, lat, { reportDay }); bez nej kotva = ťažisko sídiel. */
  frontKm = null,
  /** Deň snímky línie (YYYY-MM-DD) pre vetu na karte. */
  frontDay = null,
  /** Najbližší bod línie kontaktu — ukraineDeepStateLayer.nearestContactPoint(lon, lat, { reportDay }); bez neho sa šípky nekreslia. */
  contactPoint = null,
  /** Strana bodu podľa DeepState (ukraineDeepStateLayer.sideAt): sídlo v okupovanom území šípku nedostane. */
  sideAt = null,
} = {}) {
  const inert = {
    id: UKRAINE_REPORT_ID, show: async () => false, hide() {}, setEnabled() {}, isEnabled: () => true, isShown: () => false,
    refresh: async () => null, getState: () => ({ shown: false, enabled: true, loading: false, error: 'no-viewer', report: null, byScene: {}, fetchedAt: null, placesCount: 0, placesUnresolved: 0 }),
    setStyle() {}, getStyle: () => 'default', relayout() {}, reanchor() {},
    onChange: () => () => {}, destroy() {},
  };
  if (!viewer?.dataSources) return inert;
  const scene = viewer.scene || null;
  const camera = viewer.camera || null;
  const ds = dataSourceFactory(UKRAINE_REPORT_ID);
  ds.show = false;
  try { viewer.dataSources.add(ds); } catch { /* headless */ }

  let _shown = false;
  let _enabled = true;
  let _loading = null;
  let _error = null;
  let _report = null;
  let _byScene = new Map();
  let _fetchedAt = 0;
  const _records = new Map(); // sceneId → { entity, scene, entry }
  const _placeRecords = new Map(); // „meno|lat,lon" → { kind: 'place', entity, place, hits: [{scene, entry}], mentions }
  const _scenePlaces = new Map(); // sceneId → sídla odseku (kotva značky; reanchor po zmene línie)
  let _placesToken = 0;
  let _placesUnresolved = 0;
  let _reservationKey = '';
  const _byEntityId = new Map();
  const _listeners = new Set();
  let _handler = null;
  let _hover = null;
  let _hoverTimer = null;
  let _pointer = null;
  let _canvasLeave = null;
  let _destroyed = false;
  const _translations = new Map(); // text → translated
  // Štýl blesku pri sídlach (KARTA K4): v 'karta' sídla z hlásenia = blesk intenzity, inak bod.
  let _styleMode = 'default';
  const _boltImgCache = new Map(); // css → obrázok | null
  // Rozmiestnenie popiskov (KARTA): projekcia + prepočet po ustálení kamery.
  const _project = typeof projectorFactory === 'function' ? projectorFactory(scene) : () => null;
  let _cameraTimer = null;
  let _removeMoveEnd = null;

  const requestRender = () => { try { scene?.requestRender?.(); } catch { /* headless */ } };
  function emit() {
    const state = getState();
    for (const fn of _listeners) { try { fn(state); } catch (error) { console.warn('[UkraineReport] listener error:', error); } }
  }
  function applyVisibility() {
    ds.show = _shown && _enabled;
    if (!ds.show) _hover?.hide?.();
    applyReservation();
    requestRender();
  }
  /** Podklad skryje svoje body/popisky sídiel, ktoré kreslíme my — len kým sme viditeľní. */
  function applyReservation() {
    if (typeof reservePlaces !== 'function') return;
    const ids = ds.show ? [..._placeRecords.values()].map((r) => r.place.id).filter((id) => id !== null && id !== undefined) : [];
    const key = ids.join(',');
    if (key === _reservationKey) return;
    _reservationKey = key;
    try { reservePlaces(ids); } catch (error) { console.warn('[UkraineReport] reservePlaces failed:', error?.message || error); }
  }

  /** Šípky smerov útoku preč (entity aj väzby na kartu). */
  function clearArrows() {
    for (const rec of _placeRecords.values()) {
      for (const e of rec.arrowEntities || []) { try { _byEntityId.delete(e.id); ds.entities.remove(e); } catch { /* */ } }
      rec.arrowEntities = null; rec.arrow = null;
    }
  }
  /**
   * Šípky smerov útoku (KARTA, 2026-09-26, vzorka Rybar): od najbližšieho bodu
   * DNEŠNEJ línie kontaktu (DeepState) k sídlu, pri ktorom hlásenie GŠ uvádza
   * útoky (blesk). Sídlo v okupovanom území šípku nedostane (ukazovala by do tyla),
   * ďaleko od línie (> ARROW_MAX_KM) tiež. Dve čiary: tmavý lem pod farebnou
   * šípkou (PolylineArrow), hrúbka podľa počtu útokov. Odvodená geometria — karta
   * sídla to hovorí.
   */
  function drawArrows() {
    clearArrows();
    if (_destroyed || typeof contactPoint !== 'function') return;
    const reportDay = typeof _report?.reportedAt === 'string' ? _report.reportedAt.slice(0, 10) : null;
    const visible = _styleMode === 'karta';
    for (const rec of _placeRecords.values()) {
      if (!rec.entity || !(rec.attacks > 0)) continue;
      let side = null;
      try { side = typeof sideAt === 'function' ? sideAt(rec.lon, rec.lat) : null; } catch { side = null; }
      if (side === 'ru') continue;
      let cp = null;
      try { cp = contactPoint(rec.lon, rec.lat, { reportDay }); } catch { cp = null; }
      if (!cp || !(cp.km <= ARROW_MAX_KM)) continue;
      // Telo šípky = pozemný polygón v km (rastie s mapou ako u Rybara; materiál
      // PolylineArrow na primknutých čiarach Cesium nekreslí), tmavý obrys = čiara okolo.
      // Dve úrovne detailu (ARROW_LODS): zblízka pôvodná, z pohľadu na smer väčšia.
      const made = [];
      for (const lod of ARROW_LODS) {
        const path = attackArrowPath(cp, rec, { name: rec.place?.name, lenMinKm: lod.lenMinKm, lenMaxKm: lod.lenMaxKm });
        const ring = path ? attackArrowPolygon(path, { scale: arrowScale(rec.attacks) * lod.scale }) : null;
        if (!ring) continue;
        const positions = ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
        const base = lod.id === 'near' ? `${rec.entity.id}:arrow` : `${rec.entity.id}:arrow:${lod.id}`;
        const ddc = () => new Cesium.DistanceDisplayCondition(lod.near, Math.min(lod.far, REPORT_BOLT_FAR_M));
        const arrow = ds.entities.add({
          id: base,
          polygon: { hierarchy: new Cesium.PolygonHierarchy(positions), material: Cesium.Color.fromCssColorString(ARROW_CSS).withAlpha(0.92), classificationType: Cesium.ClassificationType.BOTH, zIndex: 13, show: visible, distanceDisplayCondition: ddc() },
        });
        const outline = ds.entities.add({
          id: `${base}:outline`,
          polyline: { positions: [...positions, positions[0]], width: 2, material: Cesium.Color.fromCssColorString(ARROW_OUTLINE_CSS).withAlpha(0.9), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, zIndex: 14, show: visible, distanceDisplayCondition: ddc() },
        });
        made.push(outline, arrow);
      }
      if (!made.length) continue;
      rec.arrowEntities = made;
      rec.arrow = { km: Math.round(cp.km * 10) / 10 };
      for (const e of made) _byEntityId.set(e.id, rec);
    }
  }
  function clearPlaces() {
    clearArrows();
    _scenePlaces.clear();
    for (const record of _placeRecords.values()) { try { ds.entities.remove(record.entity); } catch { /* */ } }
    _placeRecords.clear();
    _placesUnresolved = 0;
    applyReservation();
  }
  function draw() {
    for (const record of _records.values()) { try { ds.entities.remove(record.entity); } catch { /* */ } }
    _records.clear();
    clearPlaces();
    _byEntityId.clear();
    _placesToken += 1; // rozbehnuté drawPlaces() zo starého hlásenia sa zahodí
    if (!_report) return;
    for (const sc of scenes) {
      const entry = _byScene.get(sc.id);
      if (!entry || !sc.center) continue;
      const color = Cesium.Color.fromCssColorString(reportIntensityColor(entry.attacks));
      const entityId = `${UKRAINE_REPORT_ID}:${sc.id}`;
      // Bez CLAMP_TO_GROUND (pri streamovaní dlaždíc drahé — viď ukraineBaseLayer):
      // výška sa zistí raz z resolvera terénu nižšie.
      const entity = ds.entities.add({
        id: entityId,
        position: Cesium.Cartesian3.fromDegrees(sc.center.lon, sc.center.lat),
        billboard: {
          image: REPORT_MARKER_URI,
          width: 22,
          height: 22,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_FAR_M),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          pixelOffset: new Cesium.Cartesian2(0, REPORT_MARKER_DY),
        },
        label: {
          text: reportMarkerText(entry.attacks),
          font: `700 13px ${FONT}`,
          fillColor: color,
          outlineColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.9),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.72),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          pixelOffset: new Cesium.Cartesian2(16, REPORT_MARKER_DY),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_FAR_M),
        },
      });
      // Stred záberu je len dočasná poloha — drawPlaces() značku presunie na front
      // (kotva zo sídiel odseku), keď je index sídel k dispozícii.
      const record = { kind: 'direction', entity, scene: sc, entry, lon: sc.center.lon, lat: sc.center.lat, lifted: false, anchor: null, anchorFront: false, anchorKm: null, anchorDisplaced: false };
      _records.set(sc.id, record);
      _byEntityId.set(entityId, record);
    }
    requestRender();
    void liftMarkers();
    void drawPlaces();
  }

  /** Sídla menované v odsekoch smerov → body (index sídel z podkladu, geokódovanie v prehliadači, nič sa neukladá). */
  async function drawPlaces() {
    if (!_report || typeof placeIndex !== 'function') return;
    const token = _placesToken;
    let index = null;
    try { index = await placeIndex(); } catch (error) { console.warn('[UkraineReport] place index unavailable:', error?.message || error); return; }
    if (_destroyed || token !== _placesToken || !(index instanceof Map) || !index.size) return;
    const found = new Map();
    let unresolved = 0;
    for (const sc of scenes) {
      const entry = _byScene.get(sc.id);
      if (!entry || !sc.center) continue;
      const result = directionPlaces(entry.texts, index, sc.center);
      unresolved += result.unresolved.length;
      _scenePlaces.set(sc.id, result.places);
      for (const p of result.places) {
        // Kľúč = meno + poloha: 66 Novoselivok je 66 rôznych sídiel, nie jedno.
        const key = `${placeKey(p.name)}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        const rec = found.get(key);
        if (rec) { rec.mentions += p.mentions; rec.hits.push({ scene: sc, entry }); continue; }
        found.set(key, { kind: 'place', place: p, mentions: p.mentions, hits: [{ scene: sc, entry }], lon: p.lon, lat: p.lat, lifted: false, entity: null });
      }
    }
    _placesUnresolved = unresolved;
    placeAnchors();
    const outline = Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.9);
    for (const [key, rec] of found) {
      const attacks = Math.max(...rec.hits.map((h) => (Number.isFinite(h.entry.attacks) ? h.entry.attacks : -1)));
      const colorCss = reportIntensityColor(attacks >= 0 ? attacks : null);
      const color = Cesium.Color.fromCssColorString(colorCss);
      const entityId = `${UKRAINE_REPORT_ID}:place:${key}`;
      const label = placeLabel({ name: rec.place.name, en: rec.place.en, lang: 'uk', cls: rec.place.cls });
      const text = rec.mentions > 1 ? `${label.text} ×${rec.mentions}` : label.text;
      // KARTA K4: sídlo z hlásenia = blesk (kontakt) sfarbený intenzitou; inde ostáva bod.
      let boltImg = _boltImgCache.get(colorCss);
      if (boltImg === undefined) { try { boltImg = boltImageFactory?.(colorCss) || null; } catch { boltImg = null; } _boltImgCache.set(colorCss, boltImg); }
      rec.boltSize = boltSizePx(attacks >= 0 ? attacks : null, rec.mentions);
      rec.attacks = attacks >= 0 ? attacks : 0; // priorita rozmiestnenia popiskov
      rec.hasBolt = Boolean(boltImg);
      const useBolt = _styleMode === 'karta' && rec.hasBolt;
      const options = {
        id: entityId,
        position: Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat),
        point: {
          pixelSize: 7,
          color,
          outlineColor: outline,
          outlineWidth: 2,
          show: !useBolt,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_PLACE_FAR_M),
        },
        label: {
          text,
          font: `500 11px ${FONT}`,
          fillColor: color,
          outlineColor: outline,
          // Na KARTE tmavá podložka, aby amber popisok bojov čítal nad hustými
          // podkladovými popiskami; obrys tenší, podložku netreba prehlušiť.
          // V bežnom štýle hrubší tmavý lem (2026-09-24: meno sa strácalo v šrafe).
          outlineWidth: placeLabelOutlinePx(_styleMode),
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          showBackground: _styleMode === 'karta',
          backgroundColor: Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.72),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          pixelOffset: new Cesium.Cartesian2(placeLabelOffsetX(useBolt, rec.boltSize), 0),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_PLACE_LABEL_FAR_M),
        },
      };
      if (boltImg) {
        options.billboard = {
          image: boltImg,
          width: rec.boltSize,
          height: rec.boltSize,
          show: useBolt,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, REPORT_BOLT_FAR_M),
          translucencyByDistance: new Cesium.NearFarScalar(REPORT_BOLT_FAR_M * REPORT_BOLT_FADE_FROM, 1, REPORT_BOLT_FAR_M, 0),
          scaleByDistance: new Cesium.NearFarScalar(REPORT_BOLT_FAR_M * REPORT_BOLT_FADE_FROM, 1, REPORT_BOLT_FAR_M, REPORT_BOLT_FAR_SCALE),
        };
      }
      rec.entity = ds.entities.add(options);
      _placeRecords.set(key, rec);
      _byEntityId.set(entityId, rec);
    }
    // Zdroj obcí podkladu vzniká neskôr než tento zdroj a kreslí sa nad ním — bod
    // sídla by pod bodom obce nešiel ani vybrať (pick vracia vrchný). Preto hore.
    try { viewer.dataSources.raiseToTop?.(ds); } catch { /* headless */ }
    applyReservation();
    drawArrows();
    layoutLabels();
    requestRender();
    emit();
    void liftMarkers();
  }

  /**
   * Značky smerov na front: kotva zo sídiel odseku (pri línii, keď ju poznáme,
   * inak ťažisko). Bez sídiel ostáva stred záberu. Vracia počet presunutých.
   */
  function placeAnchors() {
    const anchors = []; // kotvy už umiestnených značiek — dve značky nesmú stáť na sebe
    let moved = 0;
    // Línia len zo snímky blízkeho dňa k hláseniu (deň rozhodne vrstva DeepState).
    const reportDay = typeof _report?.reportedAt === 'string' ? _report.reportedAt.slice(0, 10) : null;
    const fk = typeof frontKm === 'function' ? (lon, lat) => frontKm(lon, lat, { reportDay }) : null;
    let lineDay = null;
    try { lineDay = typeof frontDay === 'function' ? frontDay() : null; } catch { lineDay = null; }
    // Smery s najmenej sídlami vyberajú prvé (majú najmenej možností); inak by
    // skorší smer zobral jediné sídlo neskoršieho a značky by stáli na sebe.
    const order = scenes.filter((sc) => _records.get(sc.id)?.entity && _scenePlaces.get(sc.id)?.length)
      .map((sc, i) => ({ sc, i, n: _scenePlaces.get(sc.id).length }))
      .sort((a, b) => a.n - b.n || a.i - b.i)
      .map((o) => o.sc);
    for (const sc of order) {
      const marker = _records.get(sc.id);
      const places = _scenePlaces.get(sc.id);
      const anchor = directionAnchor(places, { avoid: anchors, frontKm: fk });
      if (!anchor) continue;
      anchors.push(anchor);
      marker.anchor = placeLabel({ name: anchor.name, en: anchor.en, lang: 'uk', cls: anchor.cls }).text;
      marker.anchorFront = anchor.front;
      marker.anchorKm = anchor.frontKm;
      marker.anchorDay = anchor.front ? lineDay : null;
      marker.anchorDisplaced = anchor.displaced;
      if (marker.lon === anchor.lon && marker.lat === anchor.lat) continue;
      marker.lon = anchor.lon; marker.lat = anchor.lat; marker.lifted = false;
      try { marker.entity.position = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat); moved += 1; } catch { /* entita už preč */ }
    }
    return moved;
  }
  /** Po zmene línie (nová snímka DeepState) prepočíta kotvy značiek. */
  function reanchor() {
    if (_destroyed || !_scenePlaces.size) return;
    const moved = placeAnchors();
    // Nová línia = nové šípky, aj keď kotvy značiek ostali.
    drawArrows();
    emit();
    if (!moved) { requestRender(); return; }
    void liftMarkers();
    layoutLabels();
    requestRender();
  }

  /** Jednorazový zdvih značiek a sídiel na výšku terénu (jedna dávka, cache resolvera). */
  async function liftMarkers() {
    const pending = [..._records.values(), ..._placeRecords.values()].filter((r) => r.entity && !r.lifted && !r.lifting);
    if (!pending.length || typeof terrainSampler !== 'function') return;
    pending.forEach((r) => { r.lifting = true; });
    const coords = pending.map((r) => [r.lon, r.lat]);
    let heights;
    try { heights = await terrainSampler(coords); } catch { heights = null; }
    pending.forEach((r) => { r.lifting = false; });
    if (_destroyed || !Array.isArray(heights)) return;
    let lifted = 0;
    let moved = false;
    pending.forEach((r, i) => {
      // Značku smeru medzitým presunul drawPlaces() na front → výška patrí starému bodu.
      if (r.lon !== coords[i][0] || r.lat !== coords[i][1]) { moved = true; return; }
      if (!Number.isFinite(heights[i])) return;
      try { r.entity.position = Cesium.Cartesian3.fromDegrees(r.lon, r.lat, heights[i]); r.lifted = true; lifted += 1; } catch { /* entita už preč */ }
    });
    if (lifted) requestRender();
    if (moved) void liftMarkers();
  }

  /** Prepne bod/blesk a odstup popisku jedného sídla podľa aktuálneho štýlu. */
  function applyPlaceStyle(rec) {
    const e = rec.entity;
    if (!e) return;
    const useBolt = _styleMode === 'karta' && rec.hasBolt;
    try {
      for (const a of rec.arrowEntities || []) { const on = _styleMode === 'karta'; if (a.polygon) a.polygon.show = on; if (a.polyline) a.polyline.show = on; }
      if (e.point) e.point.show = !useBolt;
      if (e.billboard) e.billboard.show = useBolt;
      if (e.label) {
        e.label.pixelOffset = new Cesium.Cartesian2(placeLabelOffsetX(useBolt, rec.boltSize || 0), 0);
        e.label.showBackground = _styleMode === 'karta';
        e.label.outlineWidth = placeLabelOutlinePx(_styleMode);
      }
    } catch { /* entita už preč */ }
  }
  /** Štýl blesku ('karta' = sídla z hlásenia ako blesky intenzity, inak body). */
  function setStyle(mode) {
    const next = mode === 'karta' ? 'karta' : 'default';
    if (next === _styleMode) return;
    _styleMode = next;
    for (const rec of _placeRecords.values()) applyPlaceStyle(rec);
    layoutLabels();
    requestRender();
    emit();
  }

  const labelWidthPx = (text) => String(text || '').length * LABEL_CHAR_PX + LABEL_W_PAD;
  /**
   * Rozmiestni popisky sídiel v obrazovke tak, aby sa neprekrývali (oba štýly):
   * krížené meče sú pevné prekážky, sídla si podľa priority (viac útokov/zmienok)
   * hľadajú voľnú polohu, nezmestené sa skryjú (bod/blesk ostane).
   */
  function layoutLabels() {
    // Rozmiestnenie v OBOCH štýloch (vlastník 2026-09-24: „odsunutie tých, ktoré sa
    // prekrývajú“ aj v bežnom štýle). Skrytá vrstva = pôvodná poloha (vpravo, bez skrytia).
    const bolts = _styleMode === 'karta';
    if (!_shown) {
      for (const rec of _placeRecords.values()) {
        if (rec.entity?.label) applyLabelPlacement(rec.entity.label, 'right', placeLabelOffsetX(false, 0));
      }
      return;
    }
    const width = scene?.canvas?.clientWidth || scene?.canvas?.width || 0;
    const height = scene?.canvas?.clientHeight || scene?.canvas?.height || 0;
    // Bez rozmerov plátna (headless) → nechaj polohu z applyPlaceStyle.
    if (!width || !height) return;
    const camPos = camera?.positionWC || null;
    const items = [];
    const recByKey = new Map();
    // Krížené meče smerov = pevné prekážky (nikdy sa nehýbu ani neskrývajú).
    for (const rec of _records.values()) {
      if (!rec.entity) continue;
      const p = _project(Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat));
      if (!p) continue;
      // Ikona (22 px) aj číslo značky sedia REPORT_MARKER_DY nad sídlom kotvy; písmo 13 px, nie 11.
      const my = p.y + REPORT_MARKER_DY;
      items.push({ key: `m:${rec.scene.id}:icon`, x: p.x, y: my, w: 22, h: 22, off: -11, fixed: 'right', priority: Number.POSITIVE_INFINITY });
      items.push({ key: `m:${rec.scene.id}`, x: p.x, y: my, w: Math.round(labelWidthPx(rec.entity.label?.text) * 13 / 11), h: LABEL_H_PX + 2, off: 16, fixed: 'right', priority: Number.POSITIVE_INFINITY });
    }
    // Sídla: len tie v dosahu popisku (DDC) a na obrazovke.
    for (const rec of _placeRecords.values()) {
      const label = rec.entity?.label;
      if (!label) continue;
      const pos = Cesium.Cartesian3.fromDegrees(rec.lon, rec.lat);
      const withinDdc = camPos ? Cesium.Cartesian3.distance(camPos, pos) < REPORT_PLACE_LABEL_FAR_M : true;
      const p = withinDdc ? _project(pos) : null;
      if (!p || p.x < -80 || p.y < -80 || p.x > width + 80 || p.y > height + 80) {
        applyLabelPlacement(label, 'right', placeLabelOffsetX(bolts && rec.hasBolt, rec.boltSize || 0));
        continue;
      }
      items.push({ key: `p:${rec.entity.id}`, x: p.x, y: p.y, w: labelWidthPx(label.text), h: LABEL_H_PX, off: placeLabelOffsetX(bolts && rec.hasBolt, rec.boltSize || 0), priority: (rec.attacks || 0) * 2 + (rec.mentions || 1) });
      recByKey.set(`p:${rec.entity.id}`, rec);
    }
    const placement = deconflictLabels(items, { pad: 2 });
    for (const [key, rec] of recByKey) {
      applyLabelPlacement(rec.entity.label, placement[key] ?? null, placeLabelOffsetX(bolts && rec.hasBolt, rec.boltSize || 0));
    }
    requestRender();
  }

  function scheduleLayout() {
    if (_cameraTimer) clearTimer(_cameraTimer);
    _cameraTimer = setTimer(() => { _cameraTimer = null; layoutLabels(); }, settleMs);
  }
  function installCamera() {
    if (_removeMoveEnd || !camera?.moveEnd?.addEventListener) return;
    _removeMoveEnd = camera.moveEnd.addEventListener(scheduleLayout);
  }

  // Historické hlásenie z archívu (časová os, etapa 3c): kým je nastavené,
  // značky kreslia jeho počty a živé načítanie sa nedotýka zobrazenia.
  let _override = null;
  let _live = null;
  function setOverride(report) {
    const next = report && typeof report === 'object' ? report : null;
    if (next === _override) return;
    if (next && !_override) _live = _report;
    _override = next;
    _report = next || _live;
    _byScene = reportByScene(_report, frontSceneByGsDirection);
    draw();
    emit();
  }
  function load({ force = false } = {}) {
    if (_loading) return _loading;
    if (_override) return Promise.resolve(_override);
    if (!force && _report && now() - _fetchedAt < REPORT_REFRESH_MS) return Promise.resolve(_report);
    _loading = Promise.resolve(fetchImpl())
      .then((report) => {
        if (_destroyed) return null;
        _report = report && typeof report === 'object' ? report : null;
        _byScene = reportByScene(_report, frontSceneByGsDirection);
        _fetchedAt = now();
        _error = _report ? null : 'empty';
        draw();
        return _report;
      })
      .catch((error) => {
        _error = error?.message || String(error);
        console.warn('[UkraineReport] load failed:', _error);
        return _report;
      })
      .finally(() => { _loading = null; emit(); });
    emit();
    return _loading;
  }

  // ── Karta pri prechode myšou ──────────────────────────────────────────────
  function attacksText(entry) {
    return entry.attacks === null
      ? translate('ukraine.report.unknown')
      : (entry.attacks === 0 ? translate('ukraine.report.none') : translate('ukraine.report.attacks', { n: entry.attacks }));
  }
  /** Karta sídla z odsekov: zmienky, smer(y) s počtami, čas hlásenia, poznámka o povahe údaja. */
  function placeModelFor(record) {
    const { place, hits, mentions } = record;
    const label = placeLabel({ name: place.name, en: place.en, lang: 'uk', cls: place.cls });
    const details = [translate('ukraine.report.place-mentions', { n: mentions })];
    for (const h of hits) details.push(`${frontSceneLabel(h.scene, translate)} · ${attacksText(h.entry)}`);
    if (_report?.reportedAtText) details.push(translate('ukraine.report.summary', { total: _report.total ?? '?', time: _report.reportedAtText }));
    if (record.arrow) details.push(translate('ukraine.report.arrow-note'));
    details.push(translate('ukraine.report.place-note'));
    details.push(translate('ukraine.report.claim'));
    return {
      layerId: 'ukraine-report',
      kindText: translate('ukraine.report.place-kind'),
      title: label.text && label.text !== place.name ? `${label.text} · ${place.name}` : place.name,
      details,
      source: translate('ukraine.report.source'),
    };
  }
  function hoverModelFor(record, translated = null) {
    if (record.kind === 'place') return placeModelFor(record);
    const { entry, scene: sc } = record;
    const language = lang();
    const details = [attacksText(entry)];
    if (record.anchor) {
      details.push(record.anchorFront
        ? translate('ukraine.report.anchor-front', { place: record.anchor, km: record.anchorKm, day: dayText(record.anchorDay) })
        : translate('ukraine.report.anchor', { place: record.anchor }));
      if (record.anchorDisplaced) details.push(translate('ukraine.report.anchor-displaced'));
    }
    if (_report?.reportedAtText) details.push(`${translate('ukraine.report.summary', { total: _report.total ?? '?', time: _report.reportedAtText })}`);
    const text = entry.texts.join(' ');
    if (translated && translated !== text) {
      details.push(translated);
      details.push(`${translate('ukraine.report.translated')} · ${translate('ukraine.report.original')}: ${text}`);
    } else if (text) {
      details.push(text);
      if (language !== 'uk') details.push(translate('ukraine.report.original'));
    }
    details.push(translate('ukraine.report.claim'));
    return {
      layerId: 'ukraine-report',
      kindText: translate('ukraine.report.kind'),
      title: frontSceneLabel(sc, translate),
      details,
      source: translate('ukraine.report.source'),
    };
  }

  function pickRecord(position) {
    if (!scene?.pick) return null;
    let picked = null;
    try { picked = scene.pick(position, REPORT_HOVER_PICK_PX, REPORT_HOVER_PICK_PX); } catch { picked = null; }
    const entity = picked?.id;
    const entityId = typeof entity === 'string' ? entity : entity?.id;
    return entityId ? (_byEntityId.get(entityId) || null) : null;
  }

  function showCard(record, at) {
    const key = record.entity.id;
    if (record.kind === 'place') { _hover.show(hoverModelFor(record), at, key); return; }
    const text = record.entry.texts.join(' ');
    const cached = _translations.get(text) || null;
    _hover.show(hoverModelFor(record, cached), at, key);
    const language = lang();
    if (!cached && text && language !== 'uk' && typeof translateText === 'function') {
      Promise.resolve(translateText(text, language, { from: 'uk' })).then((out) => {
        if (_destroyed || !out || out === text) return;
        _translations.set(text, out);
        if (_hover?.current?.() === key && _pointer) {
          // Rovnaká identita = len presun; preto skryť a ukázať znova s prekladom.
          _hover.hide();
          _hover.show(hoverModelFor(record, out), { x: _pointer.x, y: _pointer.y }, key);
        }
      }).catch(() => {});
    }
  }

  function runHover() {
    _hoverTimer = null;
    if (!ds.show || !_pointer || !_hover) return;
    if (_hover.isHovered?.()) return;
    const record = pickRecord(_pointer.cartesian);
    if (!record) { if (_hover.current?.()?.startsWith?.(`${UKRAINE_REPORT_ID}:`)) _hover.hide(); return; }
    showCard(record, { x: _pointer.x, y: _pointer.y });
  }

  function installHover() {
    if (_handler || !scene?.canvas) return;
    try {
      _hover = hoverFactory({ translate: (key, vars) => (key === 'local.hover-hint' ? translate('ukraine.report.linkout') : translate(key, vars)) });
      _handler = handlerFactory(scene.canvas);
      _handler.setInputAction((movement) => {
        const end = movement?.endPosition;
        if (!end) return;
        _pointer = { cartesian: end, x: end.x, y: end.y };
        if (_hoverTimer) clearTimer(_hoverTimer);
        _hoverTimer = setTimer(runHover, REPORT_HOVER_DELAY_MS);
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      _handler.setInputAction((click) => {
        if (!ds.show || !click?.position) return;
        const record = pickRecord(click.position);
        if (!record || !_report?.url) return;
        try { globalThis.open?.(_report.url, '_blank', 'noopener'); } catch { /* */ }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      if (scene.canvas.addEventListener) {
        _canvasLeave = () => { _pointer = null; if (!_hover?.isHovered?.() && _hover?.current?.()?.startsWith?.(`${UKRAINE_REPORT_ID}:`)) _hover.hide(); };
        scene.canvas.addEventListener('pointerleave', _canvasLeave);
      }
    } catch (error) {
      console.warn('[UkraineReport] hover unavailable:', error?.message || error);
    }
  }

  // ── Verejné API ───────────────────────────────────────────────────────────
  async function show() {
    if (_destroyed) return false;
    _shown = true;
    applyVisibility();
    installHover();
    installCamera();
    const report = await load();
    if (_destroyed) return false;
    applyVisibility();
    return Boolean(report);
  }
  function hide() {
    _shown = false;
    applyVisibility();
    emit();
  }
  function setEnabled(on) {
    _enabled = Boolean(on);
    applyVisibility();
    emit();
  }
  function getState() {
    const byScene = {};
    for (const [id, entry] of _byScene) byScene[id] = { attacks: entry.attacks, unknown: entry.unknown, gs: [...entry.gs] };
    return { shown: _shown, enabled: _enabled, loading: Boolean(_loading), error: _error, report: _report, byScene, fetchedAt: _fetchedAt || null, placesCount: _placeRecords.size, arrows: [..._placeRecords.values()].filter((r) => r.arrow).length, placesUnresolved: _placesUnresolved };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (_cameraTimer) clearTimer(_cameraTimer);
    if (_removeMoveEnd) { try { _removeMoveEnd(); } catch { /* */ } _removeMoveEnd = null; }
    if (_hoverTimer) clearTimer(_hoverTimer);
    if (_handler) { try { _handler.destroy(); } catch { /* */ } _handler = null; }
    if (_canvasLeave && scene?.canvas?.removeEventListener) scene.canvas.removeEventListener('pointerleave', _canvasLeave);
    _hover?.destroy?.();
    try { viewer.dataSources.remove(ds, true); } catch { /* */ }
    _records.clear();
    _placeRecords.clear();
    _byEntityId.clear();
    _listeners.clear();
  }

  return {
    id: UKRAINE_REPORT_ID,
    show,
    hide,
    setEnabled,
    isEnabled: () => _enabled,
    isShown: () => _shown,
    refresh: () => load({ force: true }),
    setOverride,
    isOverridden: () => Boolean(_override),
    setStyle,
    getStyle: () => _styleMode,
    relayout: () => layoutLabels(),
    reanchor,
    getState,
    onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, records: _records, placeRecords: _placeRecords, byEntityId: _byEntityId, hover: _hover, camera, styleMode: _styleMode }),
  };
}
