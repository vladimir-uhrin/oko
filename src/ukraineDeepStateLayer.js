// src/ukraineDeepStateLayer.js
//
// DEEPSTATE vrstva modulu UKRAJINA (etapa 4A predbežne, 2026-09-19): snímka
// z `/api/ukraine/events/deepstate?at=` (náš denný archív odpovede
// deepstatemap.live `/api/history/last`, čistý model ukraineDeepState.js):
//  - polygóny okupované / šedá zóna / oslobodené / od 2014 (Krym, ORDLO, Tuzla)
//    ako entity `polygon` bez výšky (primknuté k terénu aj 3D dlaždiciam,
//    `classificationType: BOTH`) s tlmenou výplňou OKO farieb + obrys ako
//    `polyline clampToGround` (obrys primknutého polygónu Cesium nekreslí);
//  - body smerov útokov (jantár) a letísk RU/BY (objekty) ako PointPrimitive
//    s výškou raz z resolvera terénu; karta pri prechode myšou (EN/UK meno).
// Vlastná symbolika (licencia DeepState zakazuje „identické objekty"), značky
// jednotiek zámerne vynechané (etická čiara), legenda: „stav k … · DeepStateMap.live
// · zámerné oneskorenie 2–3 dni · nekomerčné hobby použitie, súhlas sa žiada".
// Časová os prepína snímku podľa dňa kurzora; pred prvým archivovaným dňom
// (19. 9. 2026) história nie je — API histórie je za autorizáciou.

import * as Cesium from 'cesium';
import { DEEPSTATE_COLORS, DEEPSTATE_FILL_ALPHA, deepstateStampText, deepstateMirrorRepo } from './data/ukraineDeepState.js';
import { frontZoneMaterialFor, geoImageMaterialFor, hatchMaterialFor } from './data/screenPatternMaterials.js';
import { CHANGE_DAYS, FRONT_ZONE_KM, FRONT_ZONE_RU_KM, changeAreaPolygons, contactLinePaths, daysBetween, frontZoneRaster, occupiedChangeRaster, pathLengthKm, shiftDay } from './data/ukraineContactLine.js';
import { UKRAINE_LAND_RINGS } from './data/ukraineLand.js';
import { fetchUkraineDeepState } from './data/ukraineEventsClient.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { currentLanguage, t } from './i18n.js';

export const UKRAINE_DEEPSTATE_ID = 'ukraine-deepstate';
const LIFT_BATCH = 200;
const HOVER_MS = 90;
const INERT = {
  id: UKRAINE_DEEPSTATE_ID, show: async () => false, hide() {}, isShown: () => false, setSnapshot() {}, loadLatest: async () => {},
  setStyle() {}, getStyle: () => 'default', sideAt: () => null, frontKm: () => null, contactPaths: () => [],
  getState: () => ({ shown: false, loading: false, error: null, day: null, at: null, stampText: '', counts: null, areaKm2: null, features: 0, style: 'default', source: null }),
  onChange() { return () => {}; }, destroy() {},
};

/** Druhy DeepState, ktoré znamenajú ruskú kontrolu (pre stranu sídla). */
export const DEEPSTATE_RU_KINDS = Object.freeze(['occupied', 'ordlo', 'crimea', 'tuzla']);
/** Štýly vrstvy: KARTA = tenšie obrysy, sivá zóna šrafovaná (K3, vzorka). */
// Šrafovaná sivá zóna aj v bežnom štýle (2026-09-23, používateľ: „to šrafované
// mi zmizlo"): kým DeepState kreslí, raster Wikipédie so žltou zónou bojov sa
// skryje (dve výplne naraz by boli neprehľadné) a plná sivá zóna ho nenahradila —
// na mape nezostalo nič šrafované. Teraz šrafuje aktuálnu sivú zónu DeepState;
// je užšia než naša odvodená 7 km zóna, lebo je to ich meraná nikoho zem.
//
// Druhé kolo (to isté popoludnie, „šrafovanie je také ledabolo a skús inú farbu,
// táto zaniká"): sivé 1 px čiary s rozstupom 9 px pôsobili na satelitnom podklade
// ako jemná textúra terénu, nie ako zámerné šrafovanie. Bežný štýl preto kreslí
// JANTÁROVÉ čiary (v OKU = sporné / smer útoku, ako zóna bojov z Wikipédie, ktorú
// používateľ zakrúžkoval) s výrazným okrajom. Tretie kolo („jemnejšie šrafovanie"):
// hrubé pruhy pôsobili ako výstražná páska, preto tenké husté čiary — jemné, no
// dosť sýte (alfa 0,78), aby znova nezanikli ako tie sivé. KARTA ostáva
// sivá a jemná — tú používateľ schválil podľa vzorky a na svetlom reliéfe funguje.
export const DEEPSTATE_STYLES = Object.freeze({
  default: Object.freeze({
    greyWidth: 1.6, width: 1.8, greyOutline: 0.9, outline: 0.9, hatch: true,
    greyCss: '#ffb547', greyHatch: Object.freeze({ lineAlpha: 0.78, fillAlpha: 0.06, spacing: 8, thickness: 0.2 }),
    // Oslobodené: modrá šrafa OPAČNÝM smerom (135°), nie plná výplň — plná modrá
    // vyzerala ako jazero/rieka (2026-09-24). Okraj tenký a svetlý, nie „rieka".
    liberatedHatch: Object.freeze({ lineAlpha: 0.42, fillAlpha: 0.03, spacing: 10, thickness: 0.16, direction: -1 }),
    recentHatch: Object.freeze({ lineAlpha: 0.62, fillAlpha: 0.06, spacing: 7, thickness: 0.2, direction: -1 }),
    liberatedOutline: 0.5, liberatedWidth: 1.0,
    // Línia kontaktu (odvodená z polygónov): jasná červená s tmavým lemom — nad
    // satelitom aj šrafou ju oko nájde prvú (ako línia na mapách ISW/NYT).
    contact: Object.freeze({ css: '#ff4b3e', alpha: 0.95, width: 4, outlineCss: '#0b1622', outlineAlpha: 0.85, outlineWidth: 1 }),
    // 2026-09-26 („teraz tam nevidno vôbec nič na frontovej línii"): žiara pod líniou
    // (vidno ju z pohľadu na smer aj zblízka) a prifrontové pásmo na ukrajinskej strane
    // odvodené z dnešnej línie (frontZoneRaster) — namiesto 44 dní starého pásu Wikipédie.
    contactGlow: Object.freeze({ width: 18, alpha: 0.6, power: 0.14 }),
    zone: Object.freeze({ css: '#ff7a3d', maxAlpha: 0.42 }),
    // Okupovaná strana pri línii: červené šrafy v obrazovkových px orezané maskou (≤ 8 km).
    zoneRu: Object.freeze({ css: '#ff4b3e', lineAlpha: 0.62, spacing: 8, thickness: 0.22 }),
    // Zmena za 7 dní (2026-09-26): novo obsadené = hustá karmínová šrafa s výplňou
    // (nad pásmom, zIndex 8), oslobodené = plná modrá; obe odvodené z dvoch snímok.
    change: Object.freeze({ gainedCss: '#ff2d55', gainedLine: 0.9, gainedFill: 0.3, lostCss: '#2f9bff', lostAlpha: 0.55, spacing: 5, thickness: 0.42 }),
  }),
  karta: Object.freeze({
    greyWidth: 0.7, width: 1.6, greyOutline: 0.6, outline: 0.95, hatch: true,
    // Sivá zóna DeepState na KARTE ako „územie bojov" u Rybara (2026-09-26, vlastník:
    // „so sivou zónou ako Rybar!"): oranžová šrafa s výplňou, rovnaký vzhľad ako pás bojov.
    greyCss: '#f0922e', greyHatch: Object.freeze({ lineAlpha: 0.92, fillAlpha: 0.26, spacing: 6, thickness: 0.4 }),
    // 2026-09-26 (vlastník so vzorkou Rybar: „frontová línia ostré hrany a nie je vidno
    // ani šedá zóna"): hranu frontu robí SÁM obrys polygónu — plná tmavočervená
    // výplň s ostrým tmavým obrysom, odvodená línia kontaktu sa v KARTE nekreslí
    // (kľukatila sa v páse bojov ako pílka). Pásmo sa z nej ďalej počíta.
    contact: null,
    // 2026-09-26 („sprav" — ako Rybar): tmavá bordová namiesto lososovej.
    fillCss: Object.freeze({ occupied: '#8e2330', crimea: '#7f2530', ordlo: '#7f2530', tuzla: '#7f2530' }),
    fillAlpha: Object.freeze({ occupied: 0.64, crimea: 0.52, ordlo: 0.52, tuzla: 0.52 }),
    outlineCss: Object.freeze({ occupied: '#3d0a0e', crimea: '#3d0a0e', ordlo: '#3d0a0e', tuzla: '#3d0a0e' }),
    // Ukrajinská strana tónovaná do tmavomodra (mapa je dvojfarebná ako u Rybara):
    // pevnina UA mínus ruská kontrola (a sivá zóna archívu) mínus pás bojov. Odvodené.
    uaTint: Object.freeze({ css: '#2f6aa3', alpha: 0.3 }),
    // Oslobodené územie (aj z roku 2022) na KARTE bez obrysov — čiary naprieč celou
    // Charkivskou oblasťou mapu rušili (2026-09-26, mirror celej mapy); jemná výplň ostáva.
    noLiberatedOutline: true,
    // 2026-09-26 (vlastník so vzorkou mapy Rybar: „ja som to chcel takto"): územie bojov
    // ako oranžovo šrafovaný pás CEZ obe strany línie (3 km k UA, 5 km do okupovaného),
    // odvodené z dnešnej línie DeepState — mirror sivú zónu nemá.
    // Sivá zóna ako u Rybara (2026-09-26, vlastník: „so sivou zónou ako Rybar!“): pás bojov
    // hlavne na ukrajinskej strane línie (6 km; do okupovaného 2,5 km), hustejšia a
    // výraznejšia šrafa — mirror sivú zónu nemá, toto je jej odvodená náhrada.
    combatBand: Object.freeze({ css: '#f0922e', lineAlpha: 0.92, fillAlpha: 0.26, spacing: 6, thickness: 0.4, uaKm: 6, ruKm: 2.5 }),
    // KARTA (2026-09-26, vlastník: „hmlovinu prerob na jasnejšiu, svetlejšiu s jasnými
    // vymedzeniami približnými"): namiesto rozmazaného rastra VEKTOROVÉ plochy — obrys po
    // hranách buniek 0,01° zaoblený (približný), svetlá výplň a jasná svetlá hrana.
    change: Object.freeze({ mode: 'vector', lostCss: '#8fd3ff', lostFill: 0.45, lostLine: '#e6f6ff', gainedCss: '#ff6b78', gainedFill: 0.4, gainedLine: '#ffd6da', lineWidth: 2 }),
  }),
});

/** Rozlíšenie plátna tónu ukrajinskej strany (px na stupeň; 150 ≈ 0,5–0,75 km na px). */
export const UA_TINT_PX_PER_DEG = 150;
/** Obdĺžnik prstencov [W, S, E, N] s okrajom `pad` (°); prázdne = null. Pure. */
export function ringsBBox(rings, pad = 0.05) {
  let w = 180; let s = 90; let e = -180; let n = -90;
  for (const ring of rings || []) for (const [x, y] of ring || []) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return e > w && n > s ? [w - pad, s - pad, e + pad, n + pad] : null;
}
/**
 * Plátno tónu ukrajinskej strany pre KARTU (2026-09-26, ako Rybar): pevnina
 * Ukrajiny vyplnená farbou `css` s krytím `alpha`, potom vyrezané (destination-out)
 * ruské a sivé polygóny a pás bojov (plátno `bandCanvas` v obdĺžniku `bandBBox`).
 * Vektorové cesty s vyhladením — hrana nie je zubatá ako pri rastri buniek.
 * Vracia { canvas, bbox } alebo null. Nie je čisté (Canvas).
 */
export function paintUaTintCanvas(canvas, { landRings, cutRings = [], bandCanvas = null, bandBBox = null, css, alpha, pxPerDeg = UA_TINT_PX_PER_DEG }) {
  const ctx = canvas?.getContext?.('2d');
  const bb = ringsBBox(landRings);
  if (!ctx || !bb) return null;
  const [west, south, east, north] = bb;
  canvas.width = Math.ceil((east - west) * pxPerDeg);
  canvas.height = Math.ceil((north - south) * pxPerDeg);
  const X = (lon) => (lon - west) * pxPerDeg;
  const Y = (lat) => (north - lat) * pxPerDeg;
  const trace = (ring) => { ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(X(lon), Y(lat)) : ctx.moveTo(X(lon), Y(lat)))); ctx.closePath(); };
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = css;
  for (const ring of landRings) { ctx.beginPath(); trace(ring); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  for (const rings of cutRings) { if (!rings?.length) continue; ctx.beginPath(); rings.forEach(trace); ctx.fill('evenodd'); }
  if (bandCanvas && bandBBox) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bandCanvas, X(bandBBox.west), Y(bandBBox.north), (bandBBox.east - bandBBox.west) * pxPerDeg, (bandBBox.north - bandBBox.south) * pxPerDeg);
  }
  ctx.globalCompositeOperation = 'source-over';
  return { canvas, bbox: { west, south, east, north } };
}

/** Farba sivej zóny pre štýl (KARTA = pôvodná sivá). Pure. */
export function deepstateGreyCss(style) {
  return (style && style.greyCss) || DEEPSTATE_COLORS.grey;
}

/** Index polygónov pre rýchle „v ktorej zóne je bod": vonkajší prstenec + bbox. Pure. */
export function buildPolyIndex(features) {
  const out = [];
  for (const f of features || []) {
    if (f?.type !== 'Polygon' || !Array.isArray(f.rings?.[0]) || f.rings[0].length < 4) continue;
    let w = 180, s = 90, e = -180, n = -90;
    for (const [lon, lat] of f.rings[0]) { if (lon < w) w = lon; if (lon > e) e = lon; if (lat < s) s = lat; if (lat > n) n = lat; }
    out.push({ kind: f.kind, ring: f.rings[0], bbox: [w, s, e, n] });
  }
  return out;
}
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * Strana bodu podľa polygónov DeepState: okupované → 'ru', sivá zóna → 'contested',
 * inak `fallback` (vrstva dáva 'ua', keď snímka má okupované polygóny — všetko mimo
 * nich DeepState považuje za územie pod kontrolou UA; bez snímky null). Pure.
 */
export function sideFromPolygons(index, lon, lat, { fallback = null } = {}) {
  if (!Array.isArray(index) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  let grey = false;
  for (const p of index) {
    const [w, s, e, n] = p.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (!pointInRing(lon, lat, p.ring)) continue;
    if (DEEPSTATE_RU_KINDS.includes(p.kind)) return 'ru';
    if (p.kind === 'grey') grey = true;
  }
  return grey ? 'contested' : fallback;
}

/** Najväčší odstup dňa snímky DeepState od dňa hlásenia, keď sa línia ešte použije na kotvy. */
export const FRONT_MAX_DAY_GAP = 3;
/**
 * Hodí sa snímka dňa `snapshotDay` k hláseniu dňa `reportDay` (YYYY-MM-DD)? Snímka
 * smie byť najviac FRONT_MAX_DAY_GAP dní staršia a najviac deň novšia (DeepState
 * mešká). Bez dňa hlásenia áno; bez dňa snímky nie. Pure.
 */
export function deepstateDayFits(snapshotDay, reportDay, maxGap = FRONT_MAX_DAY_GAP) {
  if (!reportDay) return true;
  const s = Date.parse(`${String(snapshotDay || '').slice(0, 10)}T00:00:00Z`);
  const r = Date.parse(`${String(reportDay).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(r)) return false;
  const gap = (r - s) / 86_400_000;
  return gap >= -1 && gap <= maxGap;
}

/** Polomery (km) a počet smerov vzorkovania pre frontDistanceKm. */
export const FRONT_SAMPLE_RADII_KM = Object.freeze([1, 2, 3, 5, 8, 12, 18, 24]);
export const FRONT_SAMPLE_DIRS = 8;
/**
 * Približná vzdialenosť bodu k línii kontaktu (km): najmenší polomer, na ktorom
 * sa strana podľa polygónov (ru / sporné / ostatné) líši od strany bodu. Hranice
 * medzi dvoma ruskými druhmi (okupované × ORDLO × Krym) stranu nemenia, takže
 * sa ako front nerátajú. Bez zmeny do posledného polomeru Infinity. Pure.
 */
export function frontDistanceKm(index, lon, lat, { radii = FRONT_SAMPLE_RADII_KM, dirs = FRONT_SAMPLE_DIRS } = {}) {
  if (!Array.isArray(index) || !index.length || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const side = (x, y) => sideFromPolygons(index, x, y, { fallback: 'other' });
  const here = side(lon, lat);
  const kmLat = 1 / 111.32;
  const kmLon = 1 / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  for (const r of radii) {
    for (let k = 0; k < dirs; k += 1) {
      const a = (2 * Math.PI * k) / dirs;
      if (side(lon + Math.cos(a) * r * kmLon, lat + Math.sin(a) * r * kmLat) !== here) return r;
    }
  }
  return Infinity;
}

/**
 * Raster prifrontového pásma → plátno pre materiál OkoFrontZone (1 px = 1 bunka,
 * riadok 0 = sever): R = ukrajinská strana (prechod), G = okupovaná strana (šrafy),
 * alfa 255 všade, kde niečo je (inak by prehliadač pri premultiplikácii RGB zahodil).
 * Prázdne pásmo alebo bez 2D kontextu = null. Nie je čisté (Canvas).
 */
export function paintFrontZoneCanvas(zone, canvas) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !zone || !(zone.cells || zone.ruCells)) return null;
  canvas.width = zone.width; canvas.height = zone.height;
  const img = ctx.createImageData(zone.width, zone.height);
  const ru = zone.ruValues || new Uint8Array(zone.values.length);
  for (let i = 0; i < zone.values.length; i += 1) {
    const u = zone.values[i]; const r = ru[i];
    if (!u && !r) continue;
    const o = i * 4;
    img.data[o] = u; img.data[o + 1] = r; img.data[o + 2] = 0; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Pás bojov pre KARTA: jedna maska cez obe strany (G = 255, kde je UA alebo RU časť
 * pásma; R = 0), aby materiál kreslil len oranžovú šrafu s výplňou. Pure.
 */
export function combatBandMask(zone) {
  const n = zone.values.length;
  const g = new Uint8Array(n);
  let cells = 0;
  for (let i = 0; i < n; i += 1) if (zone.values[i] || zone.ruValues?.[i]) { g[i] = 255; cells += 1; }
  return { ...zone, values: new Uint8Array(n), ruValues: g, cells: 0, ruCells: cells };
}

/**
 * Hrubý obrys ruskej kontroly pre prehľadovú mapku KARTY (2026-09-26, vzorka Rybar
 * „aj s malým náhľadom"): vonkajšie prstence ruských druhov, body riedené na krok
 * ≥ `stepDeg`, prstence s menej než 4 bodmi preč. Pure.
 */
export function coarseOccupiedRings(features, { stepDeg = 0.06 } = {}) {
  const out = [];
  for (const f of features || []) {
    if (f?.type !== 'Polygon' || !DEEPSTATE_RU_KINDS.includes(f.kind) || !Array.isArray(f.rings?.[0])) continue;
    const ring = f.rings[0];
    const kept = [];
    for (const p of ring) {
      const last = kept[kept.length - 1];
      if (!last || Math.abs(p[0] - last[0]) >= stepDeg || Math.abs(p[1] - last[1]) >= stepDeg) kept.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
    }
    if (kept.length >= 4) out.push(kept);
  }
  return out;
}

/** Pozície kruhu [lon,lat] → Cartesian3 (bez výšky = primknuté). */
export function ringPositions(ring) {
  return ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineDeepStateLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchDeepState = fetchUkraineDeepState,
  terrainSampler = defaultTerrainSampler,
  documentRef = null,
  now = () => Date.now(),
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const ds = new Cesium.CustomDataSource(UKRAINE_DEEPSTATE_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  points.show = false;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip oko-ukr-ds-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const heightCache = new Map();
  const hKey = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const posFor = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heightCache.get(hKey(p)) ?? 0);
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _snapshot = null;
  let _polyIndex = [];
  const _frontCache = new Map(); // "lon,lat" → km k línii pre aktuálnu snímku
  let _contact = []; // úseky línie kontaktu [[lon,lat],…] pre aktuálnu snímku
  let _insetRings = null; // hrubý obrys okupovaného pre prehľadovú mapku (lenivo)
  let _sideBand = undefined; // raster pásu FRONT_ZONE_KM pre stranu z mirroru (lenivo; null = nedá sa)
  const _sideCache = new Map(); // "lon,lat" → strana z mirroru mimo polygónov
  const _zones = new Map(); // `${uaKm}|${ruKm}` → raster pásma pre aktuálnu snímku (null = prázdne)
  let _prev = null; // staršia snímka pre zmenu za týždeň: { day, forDay, index }
  let _change = null; // raster rozdielu (occupiedChangeRaster) + fromDay/toDay
  let _changeTask = null; // bežiaci dopyt staršej snímky
  // Odstup snímok zmeny v dňoch: appka 7 (zmena za týždeň); denné video „Deň na fronte" (2026-10-05) 1.
  let _changeDays = CHANGE_DAYS;
  let _style = 'default';
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _liftChain = Promise.resolve();
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  // Atribúcia v riadku kreditov (a tým aj na zdieľanom obrázku) — len kým vrstva
  // naozaj kreslí; text podľa zdroja snímky (licencia DeepState §3: textový odkaz).
  let _creditSource = null;
  function syncCredit() {
    const draws = _shown && Boolean(_snapshot?.features?.length);
    const src = draws ? (_snapshot.source === 'mirror' ? `mirror:${deepstateMirrorRepo(_snapshot.mirror)}` : 'archive') : null;
    if (src === _creditSource) return;
    _creditSource = src;
    ds.credit = src ? new Cesium.Credit(src === 'archive' ? 'DeepStateMap.live' : `DeepStateMap.live (via mirror ${deepstateMirrorRepo(_snapshot.mirror)})`, true) : undefined;
  }
  /**
   * Obdĺžnik zmeny za týždeň nad plochami a pásmom (zIndex 8): R = oslobodené
   * (plná farba), G = obsadené (šrafy) — ten istý materiál OkoFrontZone ako pásmo.
   * Kreslí sa len k snímke, pre ktorú bol rozdiel spočítaný.
   */
  function addChangeEntity() {
    const prefix = `${UKRAINE_DEEPSTATE_ID}:change`;
    for (const e of ds.entities.values.filter((x) => String(x.id).startsWith(prefix))) ds.entities.remove(e);
    const st = DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default;
    const cfg = st.change;
    if (!cfg || !_change || _change.toDay !== _snapshot?.day || !(_change.cells || _change.ruCells)) return;
    if (cfg.mode === 'vector') {
      // KARTA: zaoblené plochy s jasnou hranou (changeAreaPolygons), výplň nad pásom, hrana nad líniou.
      const areas = changeAreaPolygons(_change);
      const pos = (ring) => ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      let k = 0;
      for (const [kind, list, fillCss, fillAlpha, lineCss] of [['change-lost', areas.lost, cfg.lostCss, cfg.lostFill, cfg.lostLine], ['change-gained', areas.gained, cfg.gainedCss, cfg.gainedFill, cfg.gainedLine]]) {
        for (const rings of list) {
          k += 1;
          const outer = pos(rings[0]);
          ds.entities.add({
            id: `${prefix}:${k}`,
            polygon: { hierarchy: new Cesium.PolygonHierarchy(outer, rings.slice(1).map((r) => new Cesium.PolygonHierarchy(pos(r)))), material: Cesium.Color.fromCssColorString(fillCss).withAlpha(fillAlpha), classificationType: Cesium.ClassificationType.BOTH, zIndex: 8 },
            properties: { deepstate: { kind } },
          });
          for (let h = 0; h < rings.length; h += 1) {
            const line = h ? pos(rings[h]) : outer;
            ds.entities.add({
              id: `${prefix}:${k}:line:${h}`,
              polyline: { positions: [...line, line[0]], width: cfg.lineWidth, material: Cesium.Color.fromCssColorString(lineCss).withAlpha(0.95), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, zIndex: 11 },
              properties: { deepstate: { kind } },
            });
          }
        }
      }
      requestRender();
      return;
    }
    const canvas = paintFrontZoneCanvas(_change, doc.createElement('canvas'));
    const mat = canvas ? frontZoneMaterialFor(canvas, _change.bbox, { zoneCss: cfg.lostCss, zoneAlpha: cfg.lostAlpha, hatchCss: cfg.gainedCss, hatchAlpha: cfg.gainedLine, hatchFillAlpha: cfg.gainedFill, spacing: cfg.spacing, thickness: cfg.thickness }) : null;
    if (!mat) return;
    const b = _change.bbox;
    ds.entities.add({
      id: `${UKRAINE_DEEPSTATE_ID}:change`,
      rectangle: { coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), material: mat, classificationType: Cesium.ClassificationType.BOTH, zIndex: 8 },
      properties: { deepstate: { kind: 'change' } },
    });
  }
  /** Bunka rastra zmeny pod bodom: 'gained' | 'lost' | null. */
  function changeAt(lon, lat) {
    if (!_change || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const c = Math.floor((lon - _change.bbox.west) / _change.cellDeg);
    const r = Math.floor((_change.bbox.north - lat) / _change.cellDeg);
    if (c < 0 || r < 0 || c >= _change.width || r >= _change.height) return null;
    const idx = r * _change.width + c;
    return _change.ruValues[idx] ? 'gained' : _change.values[idx] ? 'lost' : null;
  }
  /**
   * Zmena za týždeň: stiahne snímku spred CHANGE_DAYS dní (proxy pri chýbajúcom dni
   * padne na starší súbor — skutočný rozsah nesie `fromDay`), spočíta rastrový
   * rozdiel a prekreslí obdĺžnik. Kým beží, stav hlási `changeLoading`; keď sa
   * medzitým zmení deň snímky, výsledok sa zahodí.
   */
  async function loadChange() {
    const day = _snapshot?.day;
    if (!day || !_snapshot?.features?.length) { _prev = null; _change = null; return; }
    const wantDay = shiftDay(day, -_changeDays);
    if (!wantDay || (_prev?.forDay === day && _prev?.days === _changeDays && _change?.toDay === day)) return;
    const task = (async () => {
      let snap = null;
      try { snap = await fetchDeepState(wantDay); } catch { snap = null; }
      if (_destroyed || _snapshot?.day !== day) return;
      const usable = snap && Array.isArray(snap.features) && snap.day && snap.day < day;
      _prev = { day: usable ? snap.day : null, forDay: day, days: _changeDays, index: usable ? buildPolyIndex(snap.features) : [] };
      let change = null;
      try { change = _prev.index.length ? occupiedChangeRaster(_polyIndex, _prev.index) : null; } catch { change = null; }
      if (change) { change.fromDay = _prev.day; change.toDay = day; change.days = daysBetween(_prev.day, day); }
      _change = change;
      addChangeEntity();
      requestRender();
    })();
    _changeTask = task;
    emit();
    try { await task; } finally { if (_changeTask === task) _changeTask = null; if (!_destroyed) emit(); }
  }
  function rebuild() {
    ds.entities.removeAll();
    points.removeAll();
    syncCredit();
    if (!_snapshot?.features?.length) { requestRender(); return; }
    const st = DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default;
    let n = 0;
    for (const f of _snapshot.features) {
      const colour = Cesium.Color.fromCssColorString(st.fillCss?.[f.kind] || DEEPSTATE_COLORS[f.kind] || '#8a97a3');
      if (f.type === 'Polygon' && Array.isArray(f.rings) && f.rings.length) {
        const alpha = st.fillAlpha?.[f.kind] ?? DEEPSTATE_FILL_ALPHA[f.kind] ?? 0.2;
        const outlineColour = st.outlineCss?.[f.kind] ? Cesium.Color.fromCssColorString(st.outlineCss[f.kind]) : colour;
        const outer = ringPositions(f.rings[0]);
        const holes = f.rings.slice(1).map((r) => new Cesium.PolygonHierarchy(ringPositions(r)));
        n += 1;
        // Sivá zóna na KARTE: šrafovanie 45° v obrazovkových px (ako „územie bojov" vo vzorke); bez cache materiálov výplň.
        const greyColour = Cesium.Color.fromCssColorString(deepstateGreyCss(st));
        const libHatch = f.kind === 'liberated' ? st.liberatedHatch : f.kind === 'liberated-recent' ? st.recentHatch : null;
        const material = (st.hatch && f.kind === 'grey') ? (hatchMaterialFor(deepstateGreyCss(st), st.greyHatch) || greyColour.withAlpha(alpha))
          : libHatch ? (hatchMaterialFor(DEEPSTATE_COLORS[f.kind], libHatch) || colour.withAlpha(alpha))
            : colour.withAlpha(alpha);
        const lib = Boolean(libHatch);
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:poly:${n}`,
          polygon: { hierarchy: new Cesium.PolygonHierarchy(outer, holes), material, classificationType: Cesium.ClassificationType.BOTH },
          properties: { deepstate: { kind: f.kind, en: f.en, uk: f.uk, areaKm2: f.areaKm2, description: f.description || null } },
        });
        if (!(st.noLiberatedOutline && (f.kind === 'liberated' || f.kind === 'liberated-recent'))) ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:line:${n}`,
          polyline: { positions: outer, width: f.kind === 'grey' ? st.greyWidth : (lib ? st.liberatedWidth : st.width), material: f.kind === 'grey' ? greyColour.withAlpha(st.greyOutline) : outlineColour.withAlpha(lib ? st.liberatedOutline : st.outline), clampToGround: true, classificationType: Cesium.ClassificationType.BOTH },
        });
      } else if (f.type === 'Point' && Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
        const attack = f.kind === 'attack';
        points.add({
          position: posFor(f),
          color: colour.withAlpha(attack ? 0.95 : 0.85),
          pixelSize: attack ? 8 : 5,
          outlineColor: attack ? Cesium.Color.fromCssColorString('#0b1622').withAlpha(0.9) : Cesium.Color.BLACK.withAlpha(0.7),
          outlineWidth: attack ? 2 : 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          id: { ukraineDeepState: f },
        });
      }
    }
    // Prifrontové pásmo (len štýly so `zone`): jeden primknutý obdĺžnik, materiál
    // OkoFrontZone si polohu berie z geodetických súradníc fragmentu (nie zo st).
    let bandForTint = null; // pás bojov KARTY → výrez z tónu ukrajinskej strany
    // Skutočná sivá zóna (archív z API alebo mirror celej mapy) nahrádza odvodený pás.
    const hasGrey = _snapshot.features.some((f) => f.kind === 'grey');
    if ((st.zone || st.combatBand) && _contact.length && !hasGrey) {
      // Predvolený štýl: oranžový prechod na UA strane + červená šrafa v okupovanom.
      // KARTA: jeden oranžovo šrafovaný pás cez obe strany (maska = UA ∪ RU časť).
      const band = st.combatBand;
      const uaKm = band ? band.uaKm : FRONT_ZONE_KM;
      const ruKm = band ? band.ruKm : (st.zoneRu ? FRONT_ZONE_RU_KM : 0);
      const key = `${uaKm}|${ruKm}`;
      if (!_zones.has(key)) { let z = null; try { z = frontZoneRaster(_contact, _polyIndex, { landRings: UKRAINE_LAND_RINGS, radiusKm: uaKm, ruRadiusKm: ruKm }); } catch { z = null; } _zones.set(key, z); }
      const _zone = _zones.get(key);
      const zc = _zone ? paintFrontZoneCanvas(band ? combatBandMask(_zone) : _zone, doc.createElement('canvas')) : null;
      const mat = !zc ? null : band
        ? frontZoneMaterialFor(zc, _zone.bbox, { zoneAlpha: 0, hatchCss: band.css, hatchAlpha: band.lineAlpha, hatchFillAlpha: band.fillAlpha, spacing: band.spacing, thickness: band.thickness })
        : frontZoneMaterialFor(zc, _zone.bbox, { zoneCss: st.zone.css, zoneAlpha: st.zone.maxAlpha, hatchCss: st.zoneRu?.css, hatchAlpha: st.zoneRu ? st.zoneRu.lineAlpha : 0, spacing: st.zoneRu?.spacing, thickness: st.zoneRu?.thickness });
      if (band && zc) bandForTint = { canvas: zc, bbox: _zone.bbox };
      if (mat) {
        const b = _zone.bbox;
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:zone`,
          rectangle: { coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), material: mat, classificationType: Cesium.ClassificationType.BOTH },
          properties: { deepstate: { kind: band ? 'band' : 'zone' } },
        });
      }
    }
    addChangeEntity();
    // Tón ukrajinskej strany (KARTA, ako Rybar): jeden pozemný obdĺžnik s plátnom cez
    // OkoGeoImage (presne zarovnané). Bez vlastností = bez karty pri prechode myšou
    // (inak by nad celou Ukrajinou visela bublina).
    if (st.uaTint) {
      const cutRings = _snapshot.features.filter((f) => f.type === 'Polygon' && (DEEPSTATE_RU_KINDS.includes(f.kind) || f.kind === 'grey') && Array.isArray(f.rings)).map((f) => f.rings);
      let tint = null;
      try { tint = paintUaTintCanvas(doc.createElement('canvas'), { landRings: UKRAINE_LAND_RINGS, cutRings, bandCanvas: bandForTint?.canvas, bandBBox: bandForTint?.bbox, css: st.uaTint.css, alpha: st.uaTint.alpha }); } catch { tint = null; }
      const mat = tint ? geoImageMaterialFor(tint.canvas, tint.bbox) : null;
      if (mat) {
        const b = tint.bbox;
        ds.entities.add({ id: `${UKRAINE_DEEPSTATE_ID}:ua-tint`, rectangle: { coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north), material: mat, classificationType: Cesium.ClassificationType.BOTH } });
      }
    }
    // Línia kontaktu nad plochami (zIndex), primknutá k terénu aj 3D dlaždiciam.
    const cs = st.contact;
    if (cs && _contact.length && st.contactGlow) {
      const glow = new Cesium.PolylineGlowMaterialProperty({ color: Cesium.Color.fromCssColorString(cs.css).withAlpha(st.contactGlow.alpha), glowPower: st.contactGlow.power, taperPower: 1 });
      _contact.forEach((path, k) => {
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:contact-glow:${k}`,
          polyline: { positions: ringPositions(path), width: st.contactGlow.width, material: glow, clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, zIndex: 9 },
          properties: { deepstate: { kind: 'contact', km: Math.round(pathLengthKm(path)) } },
        });
      });
    }
    if (cs && _contact.length) {
      const lineColor = Cesium.Color.fromCssColorString(cs.css).withAlpha(cs.alpha);
      const material = cs.outlineWidth > 0
        ? new Cesium.PolylineOutlineMaterialProperty({ color: lineColor, outlineColor: Cesium.Color.fromCssColorString(cs.outlineCss).withAlpha(cs.outlineAlpha), outlineWidth: cs.outlineWidth })
        : lineColor;
      _contact.forEach((path, k) => {
        ds.entities.add({
          id: `${UKRAINE_DEEPSTATE_ID}:contact:${k}`,
          polyline: { positions: ringPositions(path), width: cs.width, material, clampToGround: true, classificationType: Cesium.ClassificationType.BOTH, zIndex: 10 },
          properties: { deepstate: { kind: 'contact', km: Math.round(pathLengthKm(path)) } },
        });
      });
    }
    points.show = _shown;
    requestRender();
    void lift();
  }
  function lift() {
    if (typeof terrainSampler !== 'function') return Promise.resolve();
    _liftChain = _liftChain.then(async () => {
      if (_destroyed || !_shown || !_snapshot) return;
      const pending = []; const seen = new Set();
      for (const f of _snapshot.features) {
        if (f.type !== 'Point') continue;
        const k = hKey(f); if (heightCache.has(k) || seen.has(k)) continue; seen.add(k); pending.push({ k, lon: f.lon, lat: f.lat });
      }
      for (let i = 0; i < pending.length && !_destroyed; i += LIFT_BATCH) {
        const batch = pending.slice(i, i + LIFT_BATCH);
        let heights = null;
        try { heights = await terrainSampler(batch.map((p) => [p.lon, p.lat])); } catch { heights = null; }
        if (!Array.isArray(heights)) break;
        batch.forEach((p, j) => { if (Number.isFinite(heights[j])) heightCache.set(p.k, heights[j]); });
      }
      if (_destroyed) return;
      for (let i = 0; i < points.length; i += 1) { const pt = points.get(i); const f = pt.id?.ukraineDeepState; if (f && heightCache.has(hKey(f))) pt.position = posFor(f); }
      requestRender();
    }).catch(() => {});
    return _liftChain;
  }

  /** 'YYYY-MM-DD' → 'D.M.YYYY' pre texty (mirror pozná len deň). */
  const dayText = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${+m[3]}.${+m[2]}.${m[1]}` : '—'; };
  // ── karta pri prechode myšou (body aj polygóny) ──────────────────────────
  function tipTextFor(info) {
    if (!info) return '';
    // Línia kontaktu: odvodená, s dĺžkou úseku.
    if (info.kind === 'contact' && Number.isFinite(info.km)) return translate('ukraine.ds.contact-km', { km: info.km });
    if (info.kind === 'zone') return translate('ukraine.ds.zone-tip', { km: FRONT_ZONE_KM });
    if (info.kind === 'zone-ru') return translate('ukraine.ds.zone-ru-tip', { km: FRONT_ZONE_RU_KM });
    if (info.kind === 'band') { const b = (DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).combatBand; return translate('ukraine.ds.band-tip', { ua: b?.uaKm ?? 3, ru: b?.ruKm ?? 5 }); }
    if (info.kind === 'change-gained' || info.kind === 'change-lost') return translate(info.kind === 'change-gained' ? 'ukraine.ds.gained-tip' : 'ukraine.ds.lost-tip', { from: dayText(_change?.fromDay), to: dayText(_change?.toDay) });
    const kindText = translate(`ukraine.ds.${info.kind}`);
    const name = lang === 'uk' ? (info.uk || info.en) : (info.en || info.uk);
    const parts = [kindText];
    if (name && !/^(Occupied|Unknown status|Liberated|Direction of attack)\b/i.test(name)) parts.push(name);
    if (Number.isFinite(info.areaKm2) && info.areaKm2 >= 1) parts.push(`≈ ${Math.round(info.areaKm2).toLocaleString(lang === 'sk' ? 'sk-SK' : 'en-GB')} km²`);
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let info = null;
        try {
          const picked = scene.pick(pos, 6, 6);
          const f = picked?.id?.ukraineDeepState || picked?.primitive?.id?.ukraineDeepState;
          if (f && typeof f === 'object') info = f;
          else if (picked?.id?.properties?.deepstate) info = picked.id.properties.deepstate.getValue?.() || picked.id.properties.deepstate;
          // Pásmo je jeden obdĺžnik pre obe strany — strana podľa polygónov pod kurzorom.
          // Obdĺžnik zmeny kryje celé okupované územie: mimo zmenených buniek sa
          // pozrie, čo je pod ním (drillPick), aby polygóny a pásmo ostali čitateľné.
          if (info?.kind === 'change') {
            const cart = scene.camera.pickEllipsoid(pos);
            const cg = cart ? Cesium.Cartographic.fromCartesian(cart) : null;
            const at = cg ? changeAt(Cesium.Math.toDegrees(cg.longitude), Cesium.Math.toDegrees(cg.latitude)) : null;
            if (at) info = { kind: at === 'gained' ? 'change-gained' : 'change-lost' };
            else {
              info = null;
              for (const p of scene.drillPick(pos, 4, 6, 6) || []) {
                const g = p?.id?.ukraineDeepState || p?.primitive?.id?.ukraineDeepState;
                const q = g && typeof g === 'object' ? g : (p?.id?.properties?.deepstate?.getValue?.() || p?.id?.properties?.deepstate || null);
                if (q && q.kind && q.kind !== 'change') { info = q; break; }
              }
            }
          }
          if (info?.kind === 'zone') {
            const cart = scene.camera.pickEllipsoid(pos);
            const cg = cart ? Cesium.Cartographic.fromCartesian(cart) : null;
            if (cg && sideFromPolygons(_polyIndex, Cesium.Math.toDegrees(cg.longitude), Cesium.Math.toDegrees(cg.latitude)) === 'ru') info = { kind: 'zone-ru' };
          }
        } catch { info = null; }
        if (info && info.kind) {
          tip.textContent = tipTextFor(info);
          tip.style.setProperty('--ukr-accent', info.kind === 'change-gained' ? ((DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).change?.gainedCss || '#ff2d55') : info.kind === 'change-lost' ? ((DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).change?.lostCss || '#2f9bff') : info.kind === 'grey' ? deepstateGreyCss(DEEPSTATE_STYLES[_style]) : ((info.kind === 'contact' ? (DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).contact.css : info.kind === 'zone' ? ((DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).zone?.css || '#ff7a3d') : info.kind === 'zone-ru' ? ((DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).zoneRu?.css || '#ff4b3e') : info.kind === 'band' ? ((DEEPSTATE_STYLES[_style] || DEEPSTATE_STYLES.default).combatBand?.css || '#f0922e') : (DEEPSTATE_COLORS[info.kind] || '#8a97a3'))));
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function setSnapshot(snapshot) {
    _snapshot = snapshot && Array.isArray(snapshot.features) ? snapshot : null;
    _polyIndex = buildPolyIndex(_snapshot?.features);
    _frontCache.clear();
    // Línia kontaktu sa počíta raz na snímku (~30–50 ms pri 3–11 tis. vrcholoch).
    try { _contact = contactLinePaths(_polyIndex, UKRAINE_LAND_RINGS); } catch { _contact = []; }
    _zones.clear(); // pásma sa počítajú lenivo pri prvom kreslení v štýle, ktorý ich má (~70 ms)
    _insetRings = null;
    _sideBand = undefined;
    _sideCache.clear();
    _error = null;
    if (_change && _change.toDay !== _snapshot?.day) _change = null; // rozdiel patrí k inému dňu
    rebuild();
    emit();
    void loadChange();
  }
  /** Štýl 'default' | 'karta' (K3): tenšie obrysy, sivá zóna šrafovaná. */
  function setStyle(mode) {
    const next = DEEPSTATE_STYLES[mode] ? mode : 'default';
    if (next === _style) return;
    _style = next;
    if (_snapshot) rebuild();
    emit();
  }
  /** Strana bodu podľa polygónov snímky: 'ru' | 'contested' | 'ua' (mimo polygónov, keď snímka má okupované) | null bez snímky. */
  function sideAt(lon, lat) {
    const hasOccupied = _polyIndex.some((p) => DEEPSTATE_RU_KINDS.includes(p.kind));
    // Mirror nesie len okupované územie, šedú zónu nie — tesne pri línii preto
    // stranu nevieme (inak by špendlíky v šedej zóne zmodreli ako UA).
    // Neúplný mirror = len okupované územie (cyterat); mirror celej mapy má sivú zónu ako archív.
    const partial = _snapshot?.source === 'mirror' && !_polyIndex.some((p) => p.kind === 'grey');
    const side = sideFromPolygons(_polyIndex, lon, lat, { fallback: hasOccupied && !partial ? 'ua' : null });
    if (side !== null || !partial || !hasOccupied) return side;
    return mirrorUaSide(lon, lat) ? 'ua' : null;
  }
  /**
   * Strana z mirroru mimo okupovaného (2026-09-26, šesťuholníky ako Rybar): na
   * pevnine Ukrajiny a ďalej než FRONT_ZONE_KM od dnešnej línie = ukrajinská strana
   * (tak ju kreslí aj DeepState); v odvodenom páse pri línii (náhrada sivej zóny)
   * stranu nevieme. Cache do ďalšej snímky.
   */
  function mirrorUaSide(lon, lat) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const key = `${lon.toFixed(4)},${lat.toFixed(4)}`;
    if (_sideCache.has(key)) return _sideCache.get(key);
    let ua = UKRAINE_LAND_RINGS.some((ring) => pointInRing(lon, lat, ring));
    if (ua && _contact.length) {
      if (_sideBand === undefined) { try { _sideBand = frontZoneRaster(_contact, _polyIndex, { landRings: UKRAINE_LAND_RINGS, radiusKm: FRONT_ZONE_KM, ruRadiusKm: 0 }); } catch { _sideBand = null; } }
      const z = _sideBand;
      if (z) {
        const c = Math.floor((lon - z.bbox.west) / z.cellDeg);
        const r = Math.floor((z.bbox.north - lat) / z.cellDeg);
        if (c >= 0 && r >= 0 && c < z.width && r < z.height && z.values[r * z.width + c] > 0) ua = false;
      }
    }
    _sideCache.set(key, ua);
    return ua;
  }
  /**
   * Vzdialenosť k línii (km) podľa aktuálnej snímky; null bez ruských polygónov
   * a keď vrstva nekreslí (skrytá vrstva drží snímku iného dňa — časová os ju
   * vtedy nemení) a keď je snímka z iného dňa než hlásenie (`reportDay`; po
   * zatvorení osi v prehrávaní ostane snímka dňa kurzora). Cache do ďalšej snímky.
   */
  function frontKm(lon, lat, { reportDay = null } = {}) {
    if (!_shown) return null;
    if (!deepstateDayFits(_snapshot?.day, reportDay)) return null;
    if (!_polyIndex.some((p) => DEEPSTATE_RU_KINDS.includes(p.kind))) return null;
    const key = `${Number(lon).toFixed(4)},${Number(lat).toFixed(4)}`;
    if (!_frontCache.has(key)) _frontCache.set(key, frontDistanceKm(_polyIndex, lon, lat));
    return _frontCache.get(key);
  }
  /**
   * Najbližší bod dnešnej línie kontaktu k bodu ({ lon, lat, km }); rovnaké
   * brány ako frontKm. Pre šípky smerov útoku (ukraineReportLayer, KARTA).
   */
  function nearestContactPoint(lon, lat, { reportDay = null } = {}) {
    if (!_shown || !_contact.length || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (!deepstateDayFits(_snapshot?.day, reportDay)) return null;
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180); const ky = 111.32;
    let best = null; let bestD = Infinity;
    for (const path of _contact) {
      for (let i = 1; i < path.length; i += 1) {
        const ax = (path[i - 1][0] - lon) * kx; const ay = (path[i - 1][1] - lat) * ky;
        const bx = (path[i][0] - lon) * kx; const by = (path[i][1] - lat) * ky;
        const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + t * dx; const py = ay + t * dy; const d = Math.hypot(px, py);
        if (d < bestD) { bestD = d; best = { lon: lon + px / kx, lat: lat + py / ky, km: d }; }
      }
    }
    return best;
  }
  async function loadLatest(day = null) {
    if (_loading) return;
    _loading = true; emit();
    try { const snap = await fetchDeepState(day || new Date(now()).toISOString().slice(0, 10)); if (!_destroyed) setSnapshot(snap); }
    catch (error) { _error = error?.status === 404 ? 'missing' : (error?.message || String(error)); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show({ day = null, load = true } = {}) {
    if (_destroyed) return false;
    _shown = true;
    syncCredit();
    ds.show = true; points.show = true;
    installHandler();
    requestRender();
    emit();
    if (load && !_snapshot) await loadLatest(day);
    else void lift();
    return true;
  }
  function hide() {
    if (!_shown) return;
    _shown = false;
    syncCredit();
    ds.show = false; points.show = false; tip.hidden = true;
    requestRender();
    emit();
  }
  function getState() {
    return {
      shown: _shown, loading: _loading, error: _error,
      day: _snapshot?.day || null, at: _snapshot?.at || null, stampText: deepstateStampText(_snapshot), datetime: _snapshot?.datetime || null,
      contact: _contact.length, contactKm: Math.round(_contact.reduce((sum, path) => sum + pathLengthKm(path), 0)), zoneCells: [..._zones.values()].reduce((a, z) => a + (z?.cells || 0), 0), zoneRuCells: [..._zones.values()].reduce((a, z) => a + (z?.ruCells || 0), 0),
      counts: _snapshot?.counts || null, areaKm2: _snapshot?.areaKm2 || null, features: _snapshot?.features?.length || 0, snapshots: _snapshot?.snapshots ?? null,
      style: _style, requestedAt: _snapshot?.requestedAt || null,
      // Zdroj snímky: náš archív z API (`archive`) alebo mirror cyterat (`mirror`, len okupované).
      source: _snapshot?.source || (_snapshot ? 'archive' : null), mirror: _snapshot?.mirror || null, atApprox: Boolean(_snapshot?.atApprox),
      fallbackDays: _snapshot?.fallbackDays ?? 0, upstreamUnavailable: Boolean(_snapshot?.upstreamUnavailable),
      // Zmena za týždeň (odvodená z dvoch snímok): null kým nie je spočítaná alebo patrí inému dňu.
      change: _change && _change.toDay === _snapshot?.day
        ? { days: _change.days, fromDay: _change.fromDay, toDay: _change.toDay, gainedKm2: _change.gainedKm2, lostKm2: _change.lostKm2, gainedCells: _change.ruCells, lostCells: _change.cells }
        : null,
      changeLoading: Boolean(_changeTask),
    };
  }
  function destroy() {
    _destroyed = true;
    hide();
    if (handler) { try { handler.destroy(); } catch { /* */ } handler = null; }
    if (hoverTimer) clearTimeout(hoverTimer);
    try { scene.primitives.remove(points); viewer.dataSources.remove(ds, true); tip.remove(); } catch { /* */ }
    listeners.clear();
  }
  return {
    id: UKRAINE_DEEPSTATE_ID,
    show, hide, isShown: () => _shown, setSnapshot, loadLatest, getState,
    /**
     * Odstup snímok pre zmenu územia (dni). Appka ho nemení (7); nastavuje ho nahrávanie denného videa
     * (src/frontWeekCapture.js `changeDays`), aby mapa ukázala zmenu za deň, nie za týždeň. Vráti promise prepočtu.
     */
    setChangeDays(days) {
      const n = Math.max(1, Math.round(Number(days) || CHANGE_DAYS));
      if (n === _changeDays) return Promise.resolve();
      _changeDays = n;
      return loadChange();
    },
    getChangeDays: () => _changeDays,
    setStyle, getStyle: () => _style, sideAt, frontKm, nearestContactPoint,
    /** Hrubý obrys ruskej kontroly pre prehľadovú mapku (prázdne bez snímky). */
    occupiedOutline: () => { if (!_snapshot?.features?.length) return []; if (!_insetRings) _insetRings = coarseOccupiedRings(_snapshot.features); return _insetRings; },
    /** Úseky línie kontaktu aktuálnej snímky (kópia). */
    contactPaths: () => _contact.map((p) => p.slice()),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ ds, points, tip, polyIndex: _polyIndex }),
  };
}
