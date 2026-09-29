// src/data/windowProjector.test.mjs
// Rýchle premietanie musí dať tie isté pixely ako Cesium (2026-09-29).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createWindowProjector, multiplyMatrix4 } from './windowProjector.js';

/** Cesium cesta pre 3D s perspektívou, krok po kroku (SceneTransforms.worldWithEyeOffsetToWindowCoordinates). */
function cesiumWindow(frustum, viewMatrix, width, height, p) {
  const ec = Cesium.Matrix4.multiplyByVector(viewMatrix, new Cesium.Cartesian4(p.x, p.y, p.z, 1), new Cesium.Cartesian4());
  const cc = Cesium.Matrix4.multiplyByVector(frustum.projectionMatrix, ec, new Cesium.Cartesian4());
  if (cc.z < 0) return undefined;
  const ndc = Cesium.Cartesian3.divideByScalar(cc, cc.w, new Cesium.Cartesian3());
  const vpt = Cesium.Matrix4.computeViewportTransformation({ x: 0, y: 0, width, height }, 0, 1, new Cesium.Matrix4());
  const wc = Cesium.Matrix4.multiplyByPoint(vpt, ndc, new Cesium.Cartesian3());
  return { x: wc.x, y: height - wc.y };
}

/** Kamera 1 000 km nad Viedňou, pozerá na východ 20° pod obzor — časť Zeme je za ňou. */
function cameraSetup() {
  const frustum = new Cesium.PerspectiveFrustum({ fov: Cesium.Math.toRadians(60), aspectRatio: 1366 / 800, near: 1, far: 5e8 });
  const eye = Cesium.Cartesian3.fromDegrees(16.4, 48.2, 1_000_000);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(eye);
  const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
  const upL = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
  const pitch = Cesium.Math.toRadians(-20);
  const dir = Cesium.Cartesian3.normalize(new Cesium.Cartesian3(
    east.x * Math.cos(pitch) + upL.x * Math.sin(pitch),
    east.y * Math.cos(pitch) + upL.y * Math.sin(pitch),
    east.z * Math.cos(pitch) + upL.z * Math.sin(pitch),
  ), new Cesium.Cartesian3());
  const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(dir, new Cesium.Cartesian3(upL.x, upL.y, upL.z), new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const up = Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3());
  const view = Cesium.Matrix4.computeView(eye, dir, up, right, new Cesium.Matrix4());
  return { frustum, view, center: Cesium.Cartesian3.add(eye, Cesium.Cartesian3.multiplyByScalar(dir, 800_000, new Cesium.Cartesian3()), new Cesium.Cartesian3()) };
}

test('multiplyMatrix4 = Cesium.Matrix4.multiply', () => {
  const a = Cesium.Matrix4.fromArray([...Array(16).keys()].map((i) => (i * 7 % 11) - 3.5));
  const b = Cesium.Matrix4.fromArray([...Array(16).keys()].map((i) => (i * 5 % 13) + 0.25));
  const expected = Cesium.Matrix4.multiply(a, b, new Cesium.Matrix4());
  const out = multiplyMatrix4(a, b, new Float64Array(16));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(out[i] - expected[i]) < 1e-9, `[${i}]`);
});

test('project = Cesium 3D perspektíva na tisícoch bodov (odchýlka < 1e-6 px), za kamerou false', () => {
  const { frustum, view, center } = cameraSetup();
  const proj = createWindowProjector();
  proj.prepare(frustum.projectionMatrix, view, 1366, 800);
  const out = { x: NaN, y: NaN };
  let compared = 0; let behind = 0; let maxDiff = 0;
  for (let lat = -80; lat <= 80; lat += 4) {
    for (let lon = -180; lon < 180; lon += 6) {
      for (const h of [0, 11_000, 400_000]) {
        const p = Cesium.Cartesian3.fromDegrees(lon, lat, h);
        const ref = cesiumWindow(frustum, view, 1366, 800, p);
        const ok = proj.project(p, out);
        if (!ref) { assert.equal(ok, false, `${lat},${lon}: za kamerou`); behind++; continue; }
        assert.equal(ok, true, `${lat},${lon}`);
        maxDiff = Math.max(maxDiff, Math.abs(out.x - ref.x), Math.abs(out.y - ref.y));
        compared++;
      }
    }
  }
  assert.ok(compared > 1000 && behind > 100, `${compared} porovnaných, ${behind} za kamerou`);
  assert.ok(maxDiff < 1e-6, `max odchýlka ${maxDiff} px`);
  // bod na osi pohľadu padne do stredu okna
  assert.equal(proj.project(center, out), true);
  assert.ok(Math.abs(out.x - 683) < 1e-6 && Math.abs(out.y - 400) < 1e-6, `${out.x},${out.y}`);
});

test('za kamerou sa out nemení', () => {
  const { frustum, view } = cameraSetup();
  const proj = createWindowProjector();
  proj.prepare(frustum.projectionMatrix, view, 100, 100);
  const out = { x: 7, y: 9 };
  // Lisabon je z kamery nad Viedňou pozerajúcej na východ za chrbtom
  assert.equal(proj.project(Cesium.Cartesian3.fromDegrees(-9.1, 38.7, 0), out), false);
  assert.deepEqual(out, { x: 7, y: 9 });
});
