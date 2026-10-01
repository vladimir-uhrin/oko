// src/eventVideoCapture.js
/**
 * @module eventVideoCapture
 * @description Scéna 3D videa udalosti v OKO (2026-10-01, vlastník: „chcel by som to v OKO style").
 * Načíta ju len nahrávanie videa (scripts/capture-event-video.mjs cez dev server) — appka ju nikdy
 * nenačíta. Rovnaký vzhľad ako Prehrávač letov: stopa zafarbená podľa výšky (flightReplay.altitudeRgb),
 * silueta lietadla (aircraftIcons, azúrová), očíslované značky momentov (eventMarkers); navyše záves
 * pod preletenou stopou (výška nad zemou je vidieť, aj pád), diery čiarkovane jantárovo a celá stopa
 * udalosti bledo len v úvode. Stav snímky prichádza z src/data/eventVideoScene.js (čistá časť).
 */
import * as Cesium from 'cesium';
import { altitudeRgb } from './flightReplay.js';
import { aircraftIcon } from './data/aircraftIcons.js';
import { numberedMarkerImage, reportedMarkerImage } from './eventMarkers.js';
import { screenProjectedRotation } from './data/iconOrientation.js';

const CYAN = [0.22, 0.82, 1.0];
const GAP_COLOR = [0.98, 0.75, 0.14, 0.95];

/**
 * @param {object} viewer Cesium Viewer
 * @param {{track: number[][], focusFrom: number, focusTo: number, gapS: number, moments: Array<{lat: number, lon: number, altM: number}>}} sc
 *   stopa [t, lat, lon, výška m] a momenty (eventVideoScene().sceneData())
 */
export function installEventVideoScene(viewer, sc) {
  // Každá snímka sa naozaj nakreslí: v úspornom režime (requestRenderMode — appka ho zapína pri
  // nečinnosti) Cesium pri nehybnej kamere nekreslí a lietadlo by na videu stálo (naživo FZ1073:
  // spomalený pád so statickou kamerou dal tri rovnaké snímky).
  viewer.scene.requestRenderMode = false;
  const pos = (p) => Cesium.Cartesian3.fromDegrees(p[2], p[1], Math.max(0, p[3]));
  const prims = viewer.scene.primitives;
  const color = (rgb, a) => new Cesium.Color(rgb[0], rgb[1], rgb[2], a);

  // Celá stopa udalosti bledo — len v úvode (súvislosti v širokom zábere), potom dozneje.
  const ghost = prims.add(new Cesium.PolylineCollection());
  const ghostLines = [];
  const focusPts = sc.track.filter((p) => p[0] >= sc.focusFrom && p[0] <= sc.focusTo);
  for (let i = 1; i < focusPts.length; i += 1) {
    if (focusPts[i][0] - focusPts[i - 1][0] >= sc.gapS) continue;
    ghostLines.push(ghost.add({ positions: [pos(focusPts[i - 1]), pos(focusPts[i])], width: 3, material: Cesium.Material.fromType('Color', { color: color(CYAN, 0.45) }) }));
  }

  // Záves pod preletenou stopou (po úsekoch, zapína sa podľa preletenej časti).
  const wallInst = [];
  for (let i = 1; i < sc.track.length; i += 1) {
    const a = sc.track[i - 1];
    const b = sc.track[i];
    if (b[0] - a[0] >= sc.gapS) continue;
    wallInst.push(new Cesium.GeometryInstance({
      id: i,
      geometry: new Cesium.WallGeometry({ positions: [pos(a), pos(b)], minimumHeights: [0, 0] }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color(CYAN, 0.2)), show: new Cesium.ShowGeometryInstanceAttribute(false) },
    }));
  }
  const walls = wallInst.length
    ? prims.add(new Cesium.Primitive({ geometryInstances: wallInst, appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, flat: true }), asynchronous: false }))
    : null;
  let partialWall = null;

  // Stopa: úseky farbou výšky, diery čiarkovane.
  const lines = prims.add(new Cesium.PolylineCollection());
  const segs = [];
  for (let i = 1; i < sc.track.length; i += 1) {
    const a = sc.track[i - 1];
    const b = sc.track[i];
    const gap = b[0] - a[0] >= sc.gapS;
    const material = gap
      ? Cesium.Material.fromType('PolylineDash', { color: new Cesium.Color(...GAP_COLOR), dashLength: 20 })
      : Cesium.Material.fromType('Color', { color: color(altitudeRgb((a[3] + b[3]) / 2), 1) });
    segs.push({ i, gap, from: a[0], line: lines.add({ positions: [pos(a), pos(b)], width: gap ? 3 : 4, material, show: false }) });
  }
  const partial = lines.add({ positions: [pos(sc.track[0]), pos(sc.track[0])], width: 4, material: Cesium.Material.fromType('Color', { color: Cesium.Color.WHITE }), show: false });

  const bbs = prims.add(new Cesium.BillboardCollection());
  const marks = sc.moments.map((m, i) => (Number.isFinite(m.lat) && Number.isFinite(m.lon)
    ? bbs.add({ position: Cesium.Cartesian3.fromDegrees(m.lon, m.lat, Math.max(0, m.altM)), image: m.reported ? reportedMarkerImage(i + 1) : numberedMarkerImage(i + 1), width: 36, height: 36, show: false, disableDepthTestDistance: Number.POSITIVE_INFINITY })
    : null));
  const plane = bbs.add({
    position: pos(sc.track[0]), image: aircraftIcon('airliner', 128, false, 'cyan'), width: 60, height: 60,
    alignedAxis: Cesium.Cartesian3.ZERO, disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
  let lastRot = null;

  return {
    /** Stav snímky (eventVideoScene().frame(n), výšky v metroch). */
    apply(st) {
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(st.t * 1000));
      ghost.show = st.ghost > 0.02;
      for (const g of ghostLines) g.material.uniforms.color = color(CYAN, 0.45 * st.ghost);
      for (const s of segs) s.line.show = s.gap ? st.t >= s.from - 1e-6 : s.i <= st.flown;
      if (walls?.ready) {
        for (const inst of wallInst) {
          const attrs = walls.getGeometryInstanceAttributes(inst.id);
          if (attrs) attrs.show = Cesium.ShowGeometryInstanceAttribute.toValue(inst.id <= st.flown);
        }
      }
      const a = sc.track[st.flown];
      const p = Cesium.Cartesian3.fromDegrees(st.plane.lon, st.plane.lat, Math.max(0, st.plane.altM));
      if (partialWall) { prims.remove(partialWall); partialWall = null; }
      if (!st.plane.dim && a) {
        partial.positions = [pos(a), p];
        partial.material.uniforms.color = color(altitudeRgb(st.plane.altM), 1);
        partial.show = true;
        partialWall = prims.add(new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({
            geometry: new Cesium.WallGeometry({ positions: [pos(a), p], minimumHeights: [0, 0] }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color(CYAN, 0.2)) },
          }),
          appearance: new Cesium.PerInstanceColorAppearance({ translucent: true, flat: true }),
          asynchronous: false,
        }));
      } else {
        partial.show = false;
      }
      plane.position = p;
      plane.color = new Cesium.Color(1, 1, 1, st.plane.dim ? 0.5 : 1);
      marks.forEach((m, i) => {
        if (!m) return;
        const ms = st.moments[i];
        m.show = ms.show;
        m.scale = Number.isFinite(ms.pop) ? 1 + 0.5 * Math.sin(Math.PI * ms.pop) : 1;
      });
      const c = st.camera;
      viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.altM), new Cesium.HeadingPitchRange(Cesium.Math.toRadians(c.heading), Cesium.Math.toRadians(c.pitch), c.range));
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      if (c.lookDown) viewer.camera.lookDown(Cesium.Math.toRadians(c.lookDown));
      const next = screenProjectedRotation(viewer.scene, p, st.plane.trk, lastRot);
      lastRot = Number.isFinite(next) ? next : lastRot;
      plane.rotation = lastRot ?? 0;
    },
    /** Body (lat, lon, výška m) → poloha na obrazovke (pre popisy vo vrstve SVG). */
    project(list) {
      const out = {};
      const fn = Cesium.SceneTransforms.worldToWindowCoordinates || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
      for (const [id, q] of Object.entries(list)) {
        const w = fn(viewer.scene, Cesium.Cartesian3.fromDegrees(q.lon, q.lat, q.altM));
        if (w) out[id] = { x: w.x, y: w.y };
      }
      return out;
    },
    /** Dlaždice glóbu aj fotorealistickej 3D vrstvy načítané. */
    loaded() {
      const ts = globalThis.__godsEyeView?.tileset;
      return viewer.scene.globe.tilesLoaded && (!ts || ts.tilesLoaded);
    },
    render() {
      viewer.scene.requestRenderMode = false;
      viewer.scene.requestRender();
      viewer.render();
    },
  };
}
