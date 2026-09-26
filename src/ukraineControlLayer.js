// src/ukraineControlLayer.js
//
// ÚZEMNÁ KONTROLA modulu UKRAJINA — provizórium z Wikipédie (etapa 4C,
// 2026-09-19; plán docs/drafts/ukrajina-plan.md kap. 2.1 a 5.4 cesta C).
// Kreslí snímku `{points, summary, revisionAt}` z `/api/ukraine/events/control`:
//  - body sídiel a objektov ako PointPrimitive (modrá UA, tehlová RU, jantár
//    kontestované, fialová zmiešaná, sivá bez kontroly; veľkosť podľa triedy
//    populácie; infraštruktúra menšia s obrysom), výška raz z resolvera terénu;
//  - ODVODENÝ raster zón (`controlRaster` z čistého modulu) ako obdĺžnik
//    primknutý k terénu aj 3D dlaždiciam (entita rectangle bez výšky,
//    ImageMaterialProperty z plátna): ruská kontrola tlmená tehlová výplň, zóna
//    bojov 45° šrafovanie jantárom (ako Rybar), ukrajinské územie bez výplne;
//  - karta pri prechode myšou: meno, strana, druh, tlak z oblúka.
// Poctivosť: „podľa Wikipédie · stav k <revízia> · CC BY-SA", zóny odvodené —
// nie oficiálna línia frontu. Časová os prepína snímku podľa dňa kurzora.
// Etická čiara: sídla a objekty, nikdy jednotky (Wikipedia modul jednotky nemá).

import * as Cesium from 'cesium';
import { CONTROL_CODE, CONTROL_COLORS, CONTROL_RASTER_BBOX, controlRaster, controlSummary } from './data/ukraineControl.js';
import { fetchUkraineControl } from './data/ukraineEventsClient.js';
import { defaultTerrainSampler } from './data/ukraineBaseLayer.js';
import { CONTROL_STALE_DAYS, STALE_DIM, freshnessOf, viewedRefMs } from './data/ukraineFreshness.js';
import { currentLanguage, t } from './i18n.js';
import { geoImageMaterialFor } from './data/screenPatternMaterials.js';

export const UKRAINE_CONTROL_ID = 'ukraine-control';
export const CONTROL_RASTER_SCALE = 8; // px na bunku plátna (372 × 168 buniek → 2 976 × 1 344 px) — tenké pruhy aj zblízka
/**
 * Šírka pásu bojov (2026-09-24, vlastník: „stenši pás"): obe strany rovnako ďaleko ±5 km
 * a sporné sídlo do 4 km. Najužší pás bez prerušení na snímke Wikipédie 24. 9. 2026:
 * 578 buniek namiesto 845 (7/7 km), 0 priamych RU|UA hrán; pri 4,5 km už 3 diery.
 */
export const CONTROL_BAND_KM = 5;
export const CONTROL_CONTESTED_KM = 4;
const LIFT_BATCH = 200;
const HOVER_MS = 90;

const INERT = {
  id: UKRAINE_CONTROL_ID, show: async () => false, hide() {}, isShown: () => false, setSnapshot() {}, setPointsVisible() {}, setZonesVisible() {}, setRuFillVisible() {},
  setStyle() {}, getStyle: () => 'default', sideAt: () => null,
  getState: () => ({ shown: false, loading: false, error: null, day: null, revisionAt: null, summary: null, counts: null, points: 0, style: 'default' }),
  onChange() { return () => {}; }, destroy() {},
};

/** Farba CSS → [r,g,b]. Pure. */
export function cssRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

/**
 * Vykreslí raster zón na plátno: RU výplň, kontestované šrafovanie, UA nič.
 * Vracia to isté plátno (alebo null bez 2D kontextu). Nie je čisté (Canvas).
 */
export function paintControlCanvas(raster, canvas, { scale = CONTROL_RASTER_SCALE, ruAlpha = 0.30, hatchAlpha = 0.6, uaAlpha = 0.0, soft = 0, band = 'hatch', bandSoft = 3, createCanvas = null } = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx || !raster) return null;
  const w = raster.width * scale; const h = raster.height * scale;
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  const [rr, rg, rb] = cssRgb(CONTROL_COLORS.ru); const [ur, ug, ub] = cssRgb(CONTROL_COLORS.ua);
  const paintFills = (g, s) => {
    g.fillStyle = `rgba(${rr}, ${rg}, ${rb}, ${ruAlpha})`;
    for (let row = 0; row < raster.height; row += 1) {
      let runStart = -1;
      for (let col = 0; col <= raster.width; col += 1) {
        const code = col < raster.width ? raster.cells[row * raster.width + col] : -1;
        if (code === CONTROL_CODE.ru) { if (runStart < 0) runStart = col; continue; }
        if (runStart >= 0) { g.fillRect(runStart * s, row * s, (col - runStart) * s, s); runStart = -1; }
      }
    }
    if (uaAlpha > 0) {
      g.fillStyle = `rgba(${ur}, ${ug}, ${ub}, ${uaAlpha})`;
      for (let row = 0; row < raster.height; row += 1) for (let col = 0; col < raster.width; col += 1) if (raster.cells[row * raster.width + col] === CONTROL_CODE.ua) g.fillRect(col * s, row * s, s, s);
    }
  };
  // Mäkké okraje (KARTA K3): výplne 1 px na bunku do pomocného plátna, potom
  // zväčšené s vyhladzovaním a rozmazaním — zóny prestanú byť schodovité.
  // Šrafovanie ostáva ostré. Bez továrne na plátno (testy) sa kreslí naostro.
  const off = soft > 0 && typeof createCanvas === 'function' ? createCanvas() : null;
  const og = off?.getContext?.('2d');
  if (og) {
    off.width = raster.width; off.height = raster.height;
    og.clearRect(0, 0, raster.width, raster.height);
    paintFills(og, 1);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    // Rozmazanie je v px výstupného plátna — prepočet na 4 px/bunku drží vzhľad KARTY.
    if ('filter' in ctx) ctx.filter = `blur(${(soft * scale) / 4}px)`;
    ctx.drawImage(off, 0, 0, w, h);
    ctx.restore();
  } else {
    paintFills(ctx, scale);
  }
  // Mäkký pás (predvolený štýl od 2026-09-26, vlastník: „tie zelené pruhy sprav
  // lepšie"): kontestované bunky ako jedna priesvitná jantárová stuha s rozmazaným
  // okrajom namiesto šikmých pruhov, ktoré sa nad zeleným terénom čítali ako
  // zeleno-žlté schodovité čiary. Bez továrne na plátno (testy) ostrá výplň.
  if (band === 'soft') {
    const [hr, hg, hb] = cssRgb(CONTROL_COLORS.contested);
    const fill = `rgba(${hr}, ${hg}, ${hb}, ${hatchAlpha * 0.5})`;
    const paintBand = (g, s) => {
      g.fillStyle = fill;
      for (let row = 0; row < raster.height; row += 1) {
        let runStart = -1;
        for (let col = 0; col <= raster.width; col += 1) {
          const code = col < raster.width ? raster.cells[row * raster.width + col] : -1;
          if (code === CONTROL_CODE.contested) { if (runStart < 0) runStart = col; continue; }
          if (runStart >= 0) { g.fillRect(runStart * s, row * s, (col - runStart) * s, s); runStart = -1; }
        }
      }
    };
    const offBand = bandSoft > 0 && typeof createCanvas === 'function' ? createCanvas() : null;
    const bg = offBand?.getContext?.('2d');
    if (bg) {
      offBand.width = raster.width; offBand.height = raster.height;
      bg.clearRect(0, 0, raster.width, raster.height);
      paintBand(bg, 1);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if ('filter' in ctx) ctx.filter = `blur(${(bandSoft * scale) / 4}px)`;
      ctx.drawImage(offBand, 0, 0, w, h);
      ctx.restore();
    } else paintBand(ctx, scale);
    return canvas;
  }
  // Šrafovanie (KARTA): orežeme na kontestované bunky, potom diagonály cez celé plátno.
  ctx.save();
  ctx.beginPath();
  let any = false;
  for (let row = 0; row < raster.height; row += 1) for (let col = 0; col < raster.width; col += 1) if (raster.cells[row * raster.width + col] === CONTROL_CODE.contested) { ctx.rect(col * scale, row * scale, scale, scale); any = true; }
  if (any) {
    ctx.clip();
    const [hr, hg, hb] = cssRgb(CONTROL_COLORS.contested);
    ctx.fillStyle = `rgba(${hr}, ${hg}, ${hb}, ${hatchAlpha * 0.25})`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(${hr}, ${hg}, ${hb}, ${hatchAlpha})`;
    // Tenké pruhy (1/8 bunky ≈ 0,5 km) o čosi hustejšie — pás pôsobí ľahko aj zblízka.
    ctx.lineWidth = Math.max(1, scale * 0.14);
    const step = scale * 2;
    ctx.beginPath();
    for (let x = -h; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); }
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

/**
 * Strana najbližšieho sídla z bodov Wikipédie do `maxKm` (settlement/rural), inak null.
 * Pure. Pre špendlíky podkladu na KARTE (K3).
 * @returns {'ua'|'ru'|'contested'|null}
 */
export function nearestSide(points, lon, lat, maxKm = 3) {
  if (!Array.isArray(points) || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best = null; let bestD = maxKm;
  for (const p of points) {
    if (p.kind !== 'settlement' && p.kind !== 'rural') continue;
    const dLat = (p.lat - lat) * 111.32; if (Math.abs(dLat) > bestD) continue;
    const dLon = (p.lon - lon) * 111.32 * cosLat; if (Math.abs(dLon) > bestD) continue;
    const d = Math.hypot(dLat, dLon);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return null;
  if (best.side === 'ua' || best.side === 'ru') return best.side;
  if (best.side === 'contested' || best.side === 'mixed') return 'contested';
  return null;
}

/**
 * Krytie výplní zón pre štýl a vek snímky. Pri zastaranej snímke sa RU výplň
 * stlmí o STALE_DIM — tá istá hodnota ako vzorka v legende osi a KARTY, aby mapa
 * a legenda nikdy nesedeli každá inak.
 *
 * Šrafovanie zóny bojov sa NEstlmuje: pôvodne ustúpilo spolu s výplňou, no na
 * doméne bolo potom nevýrazné (používateľ 2026-09-23: „to šrafovanie je
 * nevýrazné teraz") a zóna bojov je presne to, čo človek na mape hľadá. Vek
 * zdroja naďalej hovorí bledšia výplň, značka ZASTARANÉ a riadok ZDROJE. Pure.
 * @param {{ruAlpha: number}} style prvok CONTROL_STYLES
 * @param {boolean} stale
 * @returns {{ruAlpha: number, hatchAlpha: number}}
 */
export function controlZoneAlphas(style, stale) {
  const dim = stale ? STALE_DIM : 1;
  return { ruAlpha: style.ruAlpha * dim, hatchAlpha: CONTROL_HATCH_ALPHA };
}
/** Krytie šrafovania zóny bojov (predvolené v paintControlCanvas). */
export const CONTROL_HATCH_ALPHA = 0.6;

/**
 * Štýlové režimy rastra zón: predvolený = mäkká stuha pásu bojov (`band: 'soft'`),
 * KARTA = mäkké okraje výplní, šrafovaný pás ako vo vzorke, slabšia RU výplň, body
 * Wikipédie skryté (špendlíky podkladu ich nahradia).
 */
export const CONTROL_STYLES = Object.freeze({
  default: Object.freeze({ soft: 0, ruAlpha: 0.30, points: true, band: 'soft', bandSoft: 3 }),
  karta: Object.freeze({ soft: 3, ruAlpha: 0.26, points: false, band: 'hatch', bandSoft: 0 }),
});

/**
 * Body Wikipédie po vrstvách (2026-09-26, vlastník: „mestá bodky sú veľmi rušivé",
 * potom „je to hrôza" — aj 414 bodov pri fronte bolo priveľa): pri pohľade na smer
 * (~160 km) ostanú len body, ktoré nesú informáciu navyše k polygónom — „front" =
 * sporné/zmiešané sídla, infraštruktúra a väčšie mestá (size ≥ 16); UA/RU sídla
 * do `cells` buniek rastra (0,05° ≈ 5 km) od pásu bojov sú „near" a ukážu sa pod
 * NEAR_*_FAR_M, ostatné („rear") pod REAR_*_FAR_M (vzdialenosť kamery; sídlo vs
 * dedina), vždy s dobehom priesvitnosti. Pure.
 * @returns {'front'|'near'|'rear'}
 */
export const NEAR_SETTLEMENT_FAR_M = 120_000;
export const NEAR_RURAL_FAR_M = 70_000;
export const REAR_SETTLEMENT_FAR_M = 90_000;
export const REAR_RURAL_FAR_M = 55_000;
export function controlPointRelevance(p, raster, { cells = 2 } = {}) {
  if (!p) return 'rear';
  if (p.side === 'contested' || p.side === 'mixed') return 'front';
  if (p.kind !== 'settlement' && p.kind !== 'rural') return 'front';
  if ((Number(p.size) || 0) >= 16) return 'front';
  if (!raster?.cells || !raster.bbox) return 'near';
  const { bbox, cellDeg, width, height } = raster;
  const col = Math.floor((p.lon - bbox.west) / cellDeg);
  const row = Math.floor((bbox.north - p.lat) / cellDeg);
  if (col < 0 || row < 0 || col >= width || row >= height) return 'near';
  for (let r = Math.max(0, row - cells); r <= Math.min(height - 1, row + cells); r += 1) {
    for (let c = Math.max(0, col - cells); c <= Math.min(width - 1, col + cells); c += 1) {
      if (raster.cells[r * width + c] === CONTROL_CODE.contested) return 'near';
    }
  }
  return 'rear';
}
/** Vzdialenosť kamery (m), po ktorú sa bod kreslí; null = vždy. Pure. */
export function controlPointFarM(p, tier) {
  if (tier === 'front') return null;
  const rural = p?.kind === 'rural';
  if (tier === 'near') return rural ? NEAR_RURAL_FAR_M : NEAR_SETTLEMENT_FAR_M;
  return rural ? REAR_RURAL_FAR_M : REAR_SETTLEMENT_FAR_M;
}

/** Veľkosť bodu podľa triedy populácie a druhu. Pure. */
export function controlPointSize(p) {
  if (p.kind !== 'settlement' && p.kind !== 'rural') return 4;
  const s = Number(p.size) || 4;
  if (s >= 24) return 9;
  if (s >= 16) return 7.5;
  if (s >= 12) return 6;
  if (s >= 8) return 5;
  return 3.5;
}

/**
 * @param {object} o
 * @param {import('cesium').Viewer} o.viewer
 */
export function createUkraineControlLayer({
  viewer,
  translate = t,
  lang = currentLanguage(),
  fetchControl = fetchUkraineControl,
  terrainSampler = defaultTerrainSampler,
  documentRef = null,
  now = () => Date.now(),
} = {}) {
  const doc = documentRef || viewer?.container?.ownerDocument;
  const scene = viewer?.scene;
  if (!scene || !doc?.createElement) return INERT;

  const points = scene.primitives.add(new Cesium.PointPrimitiveCollection());
  points.show = false;
  const ds = new Cesium.CustomDataSource(UKRAINE_CONTROL_ID);
  viewer.dataSources.add(ds);
  ds.show = false;
  const canvas = doc.createElement('canvas');
  let zoneEntity = null;
  const tip = doc.createElement('div');
  tip.className = 'oko-ukr-ctl-tip';
  tip.hidden = true;
  viewer.container.appendChild(tip);
  const heightCache = new Map();
  const hKey = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const posFor = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, heightCache.get(hKey(p)) ?? 0);
  const requestRender = () => { try { scene.requestRender?.(); } catch { /* */ } };

  let _shown = false;
  let _pointsVisible = true;
  let _zonesVisible = true;
  let _ruFill = true; // mirror DeepState kreslí okupované sám; pás bojov z Wikipédie ostáva
  let _snapshot = null;
  let _raster = null;
  let _frontPoints = 0;
  let _style = 'default';
  let _loading = false;
  let _error = null;
  let _destroyed = false;
  let _liftChain = Promise.resolve();
  let handler = null; let hoverTimer = null;
  const listeners = new Set();
  const emit = () => { const s = getState(); for (const fn of listeners) { try { fn(s); } catch { /* */ } } };

  function rebuild() {
    points.removeAll();
    if (zoneEntity) { try { ds.entities.remove(zoneEntity); } catch { /* */ } zoneEntity = null; }
    _raster = null;
    if (!_snapshot?.points?.length) { requestRender(); return; }
    // Raster najprv — o tom, ktoré body sa kreslia zďaleka, rozhoduje blízkosť pásu bojov.
    _raster = controlRaster(_snapshot.points, { bbox: CONTROL_RASTER_BBOX, bandKm: CONTROL_BAND_KM, contestedKm: CONTROL_CONTESTED_KM });
    _frontPoints = 0;
    for (const p of _snapshot.points) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      const colour = CONTROL_COLORS[p.side] || CONTROL_COLORS.none;
      const infra = p.kind !== 'settlement' && p.kind !== 'rural';
      const tier = controlPointRelevance(p, _raster);
      if (tier === 'front') _frontPoints += 1;
      const farM = controlPointFarM(p, tier);
      points.add({
        position: posFor(p),
        color: Cesium.Color.fromCssColorString(colour).withAlpha(infra ? 0.75 : (p.kind === 'rural' ? 0.6 : 0.95)),
        pixelSize: p.side === 'contested' ? controlPointSize(p) + 3 : controlPointSize(p),
        outlineColor: p.side === 'contested' ? Cesium.Color.fromCssColorString(CONTROL_COLORS.ru).withAlpha(0.9) : Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: p.side === 'contested' ? 2 : 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        // Body pri páse a v tyle až zblízka, s dobehom — pri pohľade na smer ostane len front.
        ...(farM ? { distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farM), translucencyByDistance: new Cesium.NearFarScalar(farM * 0.6, 1, farM, 0) } : {}),
        id: { ukraineControl: p },
      });
    }
    const st = CONTROL_STYLES[_style] || CONTROL_STYLES.default;
    const alphas = controlZoneAlphas(st, snapshotFreshness().stale);
    const painted = paintControlCanvas(_raster, canvas, { soft: st.soft, band: st.band, bandSoft: st.bandSoft, ...alphas, ...(_ruFill ? {} : { ruAlpha: 0 }), createCanvas: () => doc.createElement('canvas') });
    if (painted) {
      const b = _raster.bbox;
      zoneEntity = ds.entities.add({
        id: `${UKRAINE_CONTROL_ID}:zones`,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north),
          // Presne podľa geodetických súradníc (ImageMaterialProperty na 18° × 8° sedel o km vedľa).
          material: geoImageMaterialFor(canvas, b) || new Cesium.ImageMaterialProperty({ image: canvas, transparent: true }),
          classificationType: Cesium.ClassificationType.BOTH,
          show: _zonesVisible,
        },
      });
    }
    points.show = pointsShown();
    requestRender();
    void lift();
  }
  const pointsShown = () => _shown && _pointsVisible && (CONTROL_STYLES[_style] || CONTROL_STYLES.default).points;
  /** Štýl 'default' | 'karta' (K3): prekreslí raster mäkko a skryje body Wikipédie. */
  function setStyle(mode) {
    const next = CONTROL_STYLES[mode] ? mode : 'default';
    if (next === _style) return;
    _style = next;
    if (_snapshot) rebuild(); else points.show = pointsShown();
    emit();
  }
  /** Strana najbližšieho sídla z bodov Wikipédie (do 3 km), inak null. */
  function sideAt(lon, lat, { maxKm = 3 } = {}) { return nearestSide(_snapshot?.points, lon, lat, maxKm); }
  function lift() {
    if (typeof terrainSampler !== 'function') return Promise.resolve();
    _liftChain = _liftChain.then(async () => {
      if (_destroyed || !_shown || !_snapshot) return;
      const pending = [];
      const seen = new Set();
      for (const p of _snapshot.points) { const k = hKey(p); if (heightCache.has(k) || seen.has(k)) continue; seen.add(k); pending.push({ k, lon: p.lon, lat: p.lat }); }
      for (let i = 0; i < pending.length && !_destroyed; i += LIFT_BATCH) {
        const batch = pending.slice(i, i + LIFT_BATCH);
        let heights = null;
        try { heights = await terrainSampler(batch.map((p) => [p.lon, p.lat])); } catch { heights = null; }
        if (!Array.isArray(heights)) break;
        batch.forEach((p, j) => { if (Number.isFinite(heights[j])) heightCache.set(p.k, heights[j]); });
      }
      if (_destroyed) return;
      for (let i = 0; i < points.length; i += 1) { const pt = points.get(i); const p = pt.id?.ukraineControl; if (p && heightCache.has(hKey(p))) pt.position = posFor(p); }
      requestRender();
    }).catch(() => {});
    return _liftChain;
  }

  // ── karta pri prechode myšou ─────────────────────────────────────────────
  function tipText(p) {
    const parts = [p.name || p.link || '', translate(`ukraine.ctl.${p.side || 'none'}`)];
    const kind = translate(`ukraine.ctl.kind.${p.kind}`);
    if (kind && kind !== `ukraine.ctl.kind.${p.kind}`) parts.push(kind);
    if (p.pressure && p.direction) parts.push(translate('ukraine.ctl.pressure', { side: translate(`ukraine.ctl.${p.pressure}`), dir: p.direction }));
    return parts.filter(Boolean).join(' · ');
  }
  function installHandler() {
    if (handler || !scene.canvas) return;
    handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction((e) => {
      if (!_shown || !_pointsVisible || hoverTimer) return;
      const pos = Cesium.Cartesian2.clone(e.endPosition);
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        let p = null;
        try { const picked = scene.pick(pos, 6, 6); p = picked?.id?.ukraineControl || picked?.primitive?.id?.ukraineControl || null; } catch { p = null; }
        if (p && typeof p === 'object') {
          tip.textContent = tipText(p);
          tip.style.setProperty('--ukr-accent', CONTROL_COLORS[p.side] || CONTROL_COLORS.none);
          tip.style.transform = `translate(${Math.round(pos.x + 14)}px, ${Math.round(pos.y + 14)}px)`;
          tip.hidden = false;
        } else tip.hidden = true;
      }, HOVER_MS);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  // ── verejné API ──────────────────────────────────────────────────────────
  function setSnapshot(snapshot) {
    _snapshot = snapshot && Array.isArray(snapshot.points) ? snapshot : null;
    _error = null;
    rebuild();
    emit();
  }
  async function loadLatest(day = null) {
    if (_loading) return;
    _loading = true; emit();
    try { const snap = await fetchControl(day || new Date(now()).toISOString().slice(0, 10)); if (!_destroyed) setSnapshot(snap); }
    catch (error) { _error = error?.message || String(error); }
    finally { _loading = false; if (!_destroyed) emit(); }
  }
  async function show({ day = null, load = true } = {}) {
    if (_destroyed) return false;
    _shown = true;
    ds.show = _zonesVisible;
    points.show = pointsShown();
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
    ds.show = false; points.show = false; tip.hidden = true;
    requestRender();
    emit();
  }
  function setPointsVisible(on) { _pointsVisible = Boolean(on); points.show = pointsShown(); requestRender(); emit(); }
  /**
   * Vek snímky voči PREZERANÉMU dňu (`requestedAt` z odpovede servera), nie voči
   * dnešku — pri prehrávaní histórie by inak bola každá stará snímka „zastaraná".
   */
  function snapshotFreshness() {
    return freshnessOf(_snapshot?.revisionAt, viewedRefMs(_snapshot?.requestedAt, now()), CONTROL_STALE_DAYS);
  }
  /** RU výplň rastra zapnutá/vypnutá (šrafovaný pás bojov ostáva); prekreslí zóny. */
  function setRuFillVisible(on) {
    const next = Boolean(on);
    if (next === _ruFill) return;
    _ruFill = next;
    if (_snapshot) rebuild();
    emit();
  }
  function setZonesVisible(on) { _zonesVisible = Boolean(on); ds.show = _shown && _zonesVisible; if (zoneEntity?.rectangle) zoneEntity.rectangle.show = _zonesVisible; requestRender(); emit(); }
  function getState() {
    return {
      shown: _shown, loading: _loading, error: _error, pointsVisible: _pointsVisible, zonesVisible: _zonesVisible,
      day: _snapshot?.day || null, revisionAt: _snapshot?.revisionAt || null, snapshots: _snapshot?.snapshots ?? null,
      summary: _snapshot ? (_snapshot.summary || controlSummary(_snapshot.points)) : null, counts: _raster?.counts || null, points: _snapshot?.points?.length || 0, frontPoints: _frontPoints,
      revisions: _snapshot?.revisions || null, style: _style,
      requestedAt: _snapshot?.requestedAt || null, ...snapshotFreshness(),
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
    id: UKRAINE_CONTROL_ID,
    show, hide, isShown: () => _shown, setSnapshot, loadLatest, setPointsVisible, setZonesVisible, setRuFillVisible, getState,
    setStyle, getStyle: () => _style, sideAt,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy,
    _getStateForTest: () => ({ points, ds, canvas, raster: _raster, zoneEntity, tip }),
  };
}
