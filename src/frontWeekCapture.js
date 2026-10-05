// src/frontWeekCapture.js
/**
 * @module frontWeekCapture
 * @description Scéna videa „Týždeň na fronte" v OKO (2026-10-03, vlastník: „video v štýle OKO + Rybar").
 * Načíta ju len nahrávanie (scripts/capture-front-week.mjs cez dev server) — appka ju nikdy nenačíta.
 * Nekreslí nič vlastné: obraz je tá istá KARTA frontu, akú vidí návštevník (reliéf, sídla, okupované
 * územie, sivá zóna, zmena za 7 dní, šípky a blesky z hlásenia GŠ) — modul len otvorí scénu frontu,
 * počká na vrstvy, skryje ovládanie a po snímkach nastavuje kameru. KARTA nepoužíva dlaždice Google.
 */
import * as Cesium from 'cesium';
import { overlapLosers } from './data/frontWeekVideo.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Šírka šesťuholníka mestečka v KARTE (ukraineBaseLayer HEX_PIN_PX.town) — podľa nej sa mestečká poznajú. */
const TOWN_PIN_PX = 13;
/** Časť id entity sídla v podklade Ukrajiny (`<vrstva>:place:<id>`). */
const PLACE_ID_MARK = ':place:';
/**
 * Od tejto výšky kamery (m) sa prekrývajúce popisy sídiel riedia podľa počtu obyvateľov — prehľad frontu
 * a prelety medzi zábermi; zábery smerov sú nižšie (do ~260 km) a ostávajú na riedení appky.
 */
const OVERVIEW_LABELS_MIN_M = 300_000;

/**
 * @param {object} viewer Cesium Viewer
 * @param {{sceneId?: string, timeoutMs?: number, townFarM?: number, changeDays?: number|null}} [opts]
 *   `changeDays`: odstup snímok zmeny územia (denné video 1; bez neho ako v appke 7)
 */
export async function installFrontWeekScene(viewer, { sceneId = 'front', timeoutMs = 120_000, townFarM = 420_000, changeDays = null } = {}) {
  const gev = globalThis.__godsEyeView || {};
  // Každá snímka sa naozaj nakreslí (úsporný režim pri nehybnej kamere nekreslí — pasca z videa udalostí).
  viewer.scene.requestRenderMode = false;
  await gev.frontScenes?.apply?.(sceneId);
  const started = Date.now();
  const state = () => ({
    stack: gev.mapStackController?.getActiveId?.() || null,
    deep: gev.ukraineDeepState?.getState?.() || {},
    report: gev.ukraineReport?.getState?.() || {},
    base: gev.ukraineBase?.getState?.() || {},
  });
  const ready = (s) => s.stack === 'karta' && s.base.loaded && !s.base.loading
    && s.deep.shown && !s.deep.loading && !s.deep.changeLoading && Boolean(s.deep.day)
    && s.report.shown && !s.report.loading;
  const waitReady = async () => {
    while (!ready(state())) {
      if (Date.now() - started > timeoutMs) throw new Error(`front scéna sa nenačítala: ${JSON.stringify({ stack: state().stack, deep: { shown: state().deep.shown, loading: state().deep.loading, day: state().deep.day, error: state().deep.error }, report: { shown: state().report.shown, loading: state().report.loading, error: state().report.error } })}`);
      await sleep(250);
    }
  };
  await waitReady();
  // Denné video (2026-10-05): zmena územia za `changeDays` (1), nie za týždeň — vrstva prepočíta raster zmeny.
  if (Number.isFinite(changeDays) && gev.ukraineDeepState?.setChangeDays) {
    await gev.ukraineDeepState.setChangeDays(changeDays);
    await waitReady();
  }
  // Prehľad celého frontu bez stoviek bodiek mestečiek: ich body a šesťuholníky sa kreslia len do
  // `townFarM` (v zábere smeru ostávajú); mestá a popisy sa nemenia. Len v tejto stránke nahrávania.
  let thinned = 0;
  try {
    const far = new Cesium.DistanceDisplayCondition(0, townFarM);
    for (let i = 0; i < viewer.dataSources.length; i += 1) {
      for (const e of viewer.dataSources.get(i).entities.values) {
        if (!String(e.id).includes(':place:') || !e.billboard || !e.point) continue;
        const w = e.billboard.width?.getValue?.(viewer.clock.currentTime);
        if (w !== TOWN_PIN_PX) continue;
        e.point.distanceDisplayCondition = far;
        e.billboard.distanceDisplayCondition = far;
        thinned += 1;
      }
    }
  } catch { /* riedenie je len úprava vzhľadu — bez neho sa nahráva ďalej */ }
  // Prehľad z výšky: mriežkové riedenie appky pustí dva popisy miest v susedných bunkách cez seba (KYIV pod
  // BROVARY). V zábere nad `OVERVIEW_LABELS_MIN_M` preto z prekrývajúcich sa popisov ostane ľudnatejšie mesto.
  const popById = new Map();
  try {
    const index = await gev.ukraineBase?.getPlaceIndex?.();
    for (const list of index?.values?.() || []) for (const p of list) if (p.id !== null && p.id !== undefined) popById.set(String(p.id), p.pop || 0);
  } catch { /* bez počtu obyvateľov sa neriedi — poradie by bolo náhodné */ }
  const hiddenByCapture = new Set();
  const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
  function thinOverviewLabels() {
    const time = viewer.clock.currentTime;
    for (const e of hiddenByCapture) if (e.label) e.label.show = true;
    hiddenByCapture.clear();
    if (!popById.size || viewer.camera.positionCartographic.height < OVERVIEW_LABELS_MIN_M) return;
    const boxes = [];
    for (let i = 0; i < viewer.dataSources.length; i += 1) {
      for (const e of viewer.dataSources.get(i).entities.values) {
        const id = String(e.id);
        const at = id.indexOf(PLACE_ID_MARK);
        if (at < 0 || !e.label || e.label.show?.getValue?.(time) === false) continue;
        const pos = e.position?.getValue?.(time);
        if (!pos) continue;
        const ddc = e.label.distanceDisplayCondition?.getValue?.(time);
        if (ddc && Cesium.Cartesian3.distance(viewer.camera.positionWC, pos) > ddc.far) continue;
        const w = toWindow(viewer.scene, pos);
        if (!w || w.x < -200 || w.y < 0 || w.x > viewer.canvas.clientWidth || w.y > viewer.canvas.clientHeight) continue;
        const text = String(e.label.text?.getValue?.(time) || '');
        const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(e.label.font?.getValue?.(time) || ''))?.[1]) || 13;
        const off = e.label.pixelOffset?.getValue?.(time)?.x ?? 8;
        boxes.push({ e, priority: popById.get(id.slice(at + PLACE_ID_MARK.length)) ?? 0, x0: w.x + off - 6, x1: w.x + off + text.length * px * 0.68 + 6, y0: w.y - px * 0.8, y1: w.y + px * 0.8 });
      }
    }
    for (const i of overlapLosers(boxes)) { boxes[i].e.label.show = false; hiddenByCapture.add(boxes[i].e); }
  }
  // Let kamery, ktorý scéna spustila, by sa bil s nastavovaním kamery po snímkach.
  viewer.camera.cancelFlight();
  viewer.trackedEntity = undefined;
  viewer.clock.shouldAnimate = false;
  const s0 = state();
  return {
    info: { thinnedTowns: thinned, day: s0.deep.day, stampText: s0.deep.stampText || null, change: s0.deep.change || null, reportedAtText: s0.report.report?.reportedAtText || null, counts: s0.deep.counts || null },
    /** Kamera: poloha nad bodom [lon, lat] vo výške `heightM`, sklon a kurz v stupňoch. */
    setView(c) {
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.heightM),
        orientation: { heading: Cesium.Math.toRadians(c.headingDeg || 0), pitch: Cesium.Math.toRadians(c.pitchDeg), roll: 0 },
      });
    },
    /**
     * Riedenie popisov sídiel pre práve nastavenú kameru. Appka ho robí až po ustálení kamery (moveEnd + 250 ms);
     * pri nahrávaní sa kamera hýbe každou snímkou, takže by ostalo riedenie z iného pohľadu a popisy by sa
     * prekrývali (KYIV pod BROVARY). Nahrávanie ho volá pri príchode kamery do záberu.
     */
    settleLabels() {
      try { gev.ukraineBase?.refresh?.(); thinOverviewLabels(); } catch { /* riedenie je len vzhľad */ }
    },
    /** Body (lon, lat) → poloha na obrazovke (pre popisy vo vrstve SVG). */
    project(list) {
      const out = {};
      const fn = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
      for (const [id, q] of Object.entries(list || {})) {
        const w = fn(viewer.scene, Cesium.Cartesian3.fromDegrees(q.lon, q.lat, q.heightM || 0));
        if (w) out[id] = { x: w.x, y: w.y };
      }
      return out;
    },
    /** Rohy pohľadu na zemi [W, S, E, N] v stupňoch (pre obdĺžnik v náhľade Ukrajiny), inak null. */
    viewRect() {
      const r = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      if (!r) return null;
      const d = Cesium.Math.toDegrees;
      return [d(r.west), d(r.south), d(r.east), d(r.north)];
    },
    /** Dlaždice reliéfu načítané a vrstvy frontu nič nedoťahujú. */
    loaded() {
      const s = state();
      return viewer.scene.globe.tilesLoaded && !s.deep.loading && !s.deep.changeLoading && !s.report.loading && !s.base.loading;
    },
    render() {
      viewer.scene.requestRenderMode = false;
      viewer.scene.requestRender();
      viewer.render();
    },
  };
}
