// Scéna nahrávania denného videa mimo Ukrajiny (2026-10-10, zemetrasenie v Paname): len podkladová mapa
// glóbusu (predvolene reliéf ASTER, bez kľúča a bez dlaždíc Google), bez vrstiev frontu. Rovnaké rozhranie
// ako installFrontWeekScene (frontWeekCapture.js), aby nahrávanie scripts/capture-front-day.mjs nič nerozlišovalo.
/* global Cesium */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function installWorldScene(viewer, { map = 'aster-relief', timeoutMs = 120_000 } = {}) {
  const gev = globalThis.__godsEyeView || {};
  viewer.scene.requestRenderMode = false;
  const ctrl = gev.mapStackController;
  if (ctrl?.getActiveId?.() !== map) await ctrl?.setStack?.(map);
  const started = Date.now();
  while (ctrl?.getActiveId?.() && ctrl.getActiveId() !== map) {
    if (Date.now() - started > timeoutMs) throw new Error(`mapa ${map} sa nezapla (aktívna ${ctrl.getActiveId()})`);
    await sleep(250);
  }
  // Vrstvy appky (lietadlá, lode…) do videa nepatria — nahrávanie ich skryje cez CSS a tu vypne entity.
  try { for (let i = 0; i < viewer.dataSources.length; i += 1) viewer.dataSources.get(i).show = false; } catch { /* */ }
  try { viewer.entities.show = false; } catch { /* */ }
  try { for (let i = 0; i < viewer.scene.primitives.length; i += 1) { const p = viewer.scene.primitives.get(i); if (p && p !== viewer.scene.globe && 'show' in p) p.show = false; } } catch { /* */ }
  return {
    info: { day: null, change: null, reportedAtText: null, map: ctrl?.getActiveId?.() || map },
    setView(c) {
      viewer.camera.cancelFlight();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.heightM),
        orientation: { heading: Cesium.Math.toRadians(c.headingDeg || 0), pitch: Cesium.Math.toRadians(c.pitchDeg), roll: 0 },
      });
    },
    settleLabels() {},
    project(list) {
      const out = {};
      const fn = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
      for (const [id, q] of Object.entries(list || {})) {
        const w = fn(viewer.scene, Cesium.Cartesian3.fromDegrees(q.lon, q.lat, q.heightM || 0));
        if (w) out[id] = { x: w.x, y: w.y };
      }
      return out;
    },
    viewRect() {
      const r = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
      if (!r) return null;
      const d = Cesium.Math.toDegrees;
      return [d(r.west), d(r.south), d(r.east), d(r.north)];
    },
    loaded() { return viewer.scene.globe.tilesLoaded; },
    render() {
      viewer.scene.requestRenderMode = false;
      viewer.scene.requestRender();
      viewer.render();
    },
  };
}
