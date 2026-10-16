// src/data/vesselViewFootprint.test.mjs
// Výrez lodí na telefóne podľa toho, čo obrazovka naozaj ukazuje (2026-10-16): skutočná kamera
// Cesia (bez WebGL) na telefóne na výšku 390 × 844, úvodný prelet a ďalšie pohľady.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { PHONE_VIEW_CAP_FACTOR, PHONE_VIEW_CAP_MIN_M, phoneVesselViewBounds } from './vesselViewFootprint.js';
import { padVesselViewBounds } from './vesselLabels.js';
import { START_AREA_VIEW, areaViewFor } from '../camera.js';

const W = 390;
const H = 844;

/** Kamera Cesia bez plátna: falošná scéna stačí na pickEllipsoid aj computeViewRectangle. */
function phoneCamera({ lon, lat, heightM, headingDeg = 0, pitchDeg, width = W, height = H }) {
  const scene = {
    canvas: { clientWidth: width, clientHeight: height },
    drawingBufferWidth: width * 2,
    drawingBufferHeight: height * 2,
    pixelRatio: 2,
    mapProjection: new Cesium.GeographicProjection(),
    mode: Cesium.SceneMode.SCENE3D,
    frameState: { mode: Cesium.SceneMode.SCENE3D },
    ellipsoid: Cesium.Ellipsoid.WGS84,
    preRender: new Cesium.Event(),
    postRender: new Cesium.Event(),
    screenSpaceCameraController: { minimumZoomDistance: 1 },
  };
  const camera = new Cesium.Camera(scene);
  camera.frustum.aspectRatio = width / height;
  camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightM),
    orientation: { heading: Cesium.Math.toRadians(headingDeg), pitch: Cesium.Math.toRadians(pitchDeg), roll: 0 },
  });
  return camera;
}

/** Úvodný prelet nad Bratislavu (camera.js START_AREA_VIEW.city). */
function startCityCamera() {
  const area = areaViewFor({ lat: 48.15, lon: 17.11, precision: 'city' });
  return phoneCamera({ lon: area.longitude, lat: area.latitude, heightM: area.heightM, headingDeg: area.headingDeg, pitchDeg: area.pitchDeg });
}

function cesiumBounds(camera) {
  const r = camera.computeViewRectangle(Cesium.Ellipsoid.WGS84);
  return padVesselViewBounds({
    west: Cesium.Math.toDegrees(r.west), south: Cesium.Math.toDegrees(r.south),
    east: Cesium.Math.toDegrees(r.east), north: Cesium.Math.toDegrees(r.north),
  });
}

function pickDeg(camera, x, y) {
  const hit = camera.pickEllipsoid(new Cesium.Cartesian2(x, y), Cesium.Ellipsoid.WGS84);
  if (!hit) return null;
  const c = Cesium.Cartographic.fromCartesian(hit);
  return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), hit };
}

function inBounds(b, p) {
  const lonOk = b.west <= b.east ? p.lon >= b.west && p.lon <= b.east : p.lon >= b.west || p.lon <= b.east;
  return lonOk && p.lat >= b.south && p.lat <= b.north;
}

/** Vzdialenosť po povrchu (m). */
function surfaceM(a, b) {
  const g = new Cesium.EllipsoidGeodesic(Cesium.Cartographic.fromDegrees(a.lon, a.lat), Cesium.Cartographic.fromDegrees(b.lon, b.lat));
  return g.surfaceDistance;
}

/**
 * Každý bod Zeme na obrazovke (mriežka po 10 px) bližšie k stredu záberu než orezanie musí byť vo
 * výreze — „bez straty lodí v blízkom zábere". Vráti počet skontrolovaných a chýbajúcich bodov.
 */
function coverage(camera, bounds) {
  const center = pickDeg(camera, W / 2, H / 2);
  const capM = Math.max(PHONE_VIEW_CAP_MIN_M, PHONE_VIEW_CAP_FACTOR * Cesium.Cartesian3.distance(camera.positionWC, center.hit));
  let checked = 0;
  const missing = [];
  for (let y = 0; y <= H; y += 10) {
    for (let x = 0; x <= W; x += 10) {
      const p = pickDeg(camera, x, y);
      if (!p || surfaceM(center, p) > capM * 0.98) continue;
      checked++;
      if (!inBounds(bounds, p)) missing.push({ x, y, ...p });
    }
  }
  return { checked, missing };
}

test('úvodný prelet na telefóne (260 km, −42°): výrez je lievik obrazovky, nie celý obzor — 9 MB → 0,8 MB', () => {
  assert.equal(START_AREA_VIEW.city.heightM, 260_000);
  const camera = startCityCamera();
  const cesium = cesiumBounds(camera);
  const phone = phoneVesselViewBounds(camera, W, H);
  // Pred opravou (meranie 2026-10-16 na QA serveri): bbox=-22.7387,45.0974,56.9587,60.2071.
  assert.ok(cesium.east - cesium.west > 75, `výrez Cesia po obzor: ${cesium.west}..${cesium.east}`);
  assert.ok(phone, 'výrez telefónu');
  assert.ok(phone.east - phone.west < 11, `šírka ${phone.west}..${phone.east}`);
  assert.ok(phone.west > 11 && phone.east < 23, `${phone.west}..${phone.east} (len okolie poludníka Bratislavy)`);
  assert.ok(phone.north < 58, `sever ${phone.north}: pás pod obzorom (Švédsko, Fínsko) orezaný`);
  assert.ok(phone.north > 55, `sever ${phone.north}: poľské pobrežie v hornej časti obrazovky ostáva`);
  assert.ok(phone.south <= 45.6, `juh ${phone.south}: spodok obrazovky (Chorvátsko) ostáva`);
  assert.ok(inBounds(phone, { lat: 48.15, lon: 17.11 }), 'Bratislava (miesto návštevníka) je vo výreze');
  const { checked, missing } = coverage(camera, phone);
  assert.ok(checked > 1500, String(checked));
  assert.deepEqual(missing.slice(0, 3), [], `${missing.length} bodov blízkeho záberu mimo výrezu`);
});

test('pohľad zhora bez obzoru: výrez ako doteraz (nič sa neoreže)', () => {
  const camera = phoneCamera({ lon: 17.11, lat: 48.15, heightM: 500_000, pitchDeg: -90 });
  const phone = phoneVesselViewBounds(camera, W, H);
  const cesium = cesiumBounds(camera);
  for (const side of ['west', 'south', 'east', 'north']) {
    assert.ok(Math.abs(phone[side] - cesium[side]) < 0.05, `${side}: ${phone[side]} vs ${cesium[side]}`);
  }
  const { checked, missing } = coverage(camera, phone);
  assert.ok(checked > 3000);
  assert.equal(missing.length, 0);
});

test('nízka kamera nad Dunajom (2 km, pohľad na východ): lode až po obzor, orezanie najmenej 300 km', () => {
  const camera = phoneCamera({ lon: 17.11, lat: 48.10, heightM: 2000, headingDeg: 90, pitchDeg: -15 });
  const phone = phoneVesselViewBounds(camera, W, H);
  const { checked, missing } = coverage(camera, phone);
  assert.ok(checked > 1000);
  assert.equal(missing.length, 0);
  // Najvzdialenejší bod Zeme v stĺpci stredu obrazovky (tesne pod obzorom, ~160 km) je vo výreze,
  // hoci 2 × vzdialenosť kamery od stredu záberu je len ~15 km — platí orezanie PHONE_VIEW_CAP_MIN_M.
  let horizon = null;
  for (let y = 0; y <= H; y += 0.05) { horizon = pickDeg(camera, W / 2, y); if (horizon) break; }
  const center = pickDeg(camera, W / 2, H / 2);
  assert.ok(PHONE_VIEW_CAP_FACTOR * Cesium.Cartesian3.distance(camera.positionWC, center.hit) < 20_000);
  assert.ok(horizon && surfaceM({ lat: 48.10, lon: 17.11 }, horizon) > 80_000, 'bod pri obzore je ďaleko');
  assert.ok(inBounds(phone, horizon), 'obzor vo výreze');
  assert.ok(phone.east > 19 && phone.west > 16.5, `${phone.west}..${phone.east}: smerom pohľadu, nie dozadu`);
});

test('výrez cez 180° poludník: west > east a obsahuje stred záberu', () => {
  const camera = phoneCamera({ lon: 179.5, lat: 50, heightM: 800_000, headingDeg: 90, pitchDeg: -40 });
  const phone = phoneVesselViewBounds(camera, W, H);
  assert.ok(phone.west > phone.east, `${phone.west}..${phone.east}`);
  const center = pickDeg(camera, W / 2, H / 2);
  assert.ok(inBounds(phone, center));
  assert.equal(coverage(camera, phone).missing.length, 0);
});

test('bez Zeme na obrazovke, bez kamery alebo rozmeru: null (ostáva výrez Cesia)', () => {
  const sky = phoneCamera({ lon: 17.11, lat: 48.15, heightM: 260_000, pitchDeg: 35 });
  assert.equal(phoneVesselViewBounds(sky, W, H), null);
  assert.equal(phoneVesselViewBounds(null, W, H), null);
  assert.equal(phoneVesselViewBounds({ positionCartographic: { height: 1 } }, W, H), null, 'falošná kamera bez pickEllipsoid');
  assert.equal(phoneVesselViewBounds(startCityCamera(), 0, H), null);
  assert.equal(phoneVesselViewBounds(startCityCamera(), undefined, undefined), null);
});

test('pól na obrazovke: null (výrez z dĺžok by pól vynechal)', () => {
  const camera = phoneCamera({ lon: 17.11, lat: 80, heightM: 1_500_000, pitchDeg: -60 });
  assert.equal(phoneVesselViewBounds(camera, W, H), null);
});
