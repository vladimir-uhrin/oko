import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AIRCRAFT_RECESSION_PARAMS,
  aircraftRecessionFactors,
  applyAircraftBillboardTreatment,
  applyAircraftModelTreatment,
  cameraLimbDistanceM,
} from './aircraftRecession.js';

const params = { ...DEFAULT_AIRCRAFT_RECESSION_PARAMS };
const cameraHeightM = 1_000_000;
const limb = cameraLimbDistanceM(cameraHeightM, params.earthRadiusM);

test('aircraft recession is a no-op below the limb-relative start threshold', () => {
  assert.deepEqual(
    aircraftRecessionFactors({ cameraDistanceM: limb * 0.49, cameraHeightM }, params),
    { scale: 1, alpha: 1, limbRatio: 0.49 },
  );
  assert.deepEqual(
    aircraftRecessionFactors({ cameraDistanceM: limb * 0.5, cameraHeightM }, params),
    { scale: 1, alpha: 1, limbRatio: 0.5 },
  );
});

test('aircraft recession reaches the tunable scale and haze floors at the limb', () => {
  const atLimb = aircraftRecessionFactors({ cameraDistanceM: limb, cameraHeightM }, params);
  assert.ok(Math.abs(atLimb.scale - 0.45) < 1e-12);
  assert.ok(Math.abs(atLimb.alpha - 0.35) < 1e-12);
  const beyond = aircraftRecessionFactors({ cameraDistanceM: limb * 1.2, cameraHeightM }, params);
  assert.ok(Math.abs(beyond.scale - 0.45) < 1e-12);
  assert.ok(Math.abs(beyond.alpha - 0.35) < 1e-12);
});

test('aircraft recession is a globe-view no-op instead of a global distance fade', () => {
  assert.deepEqual(
    aircraftRecessionFactors({ cameraDistanceM: 20_000_000, cameraHeightM: 5_000_000 }, params),
    { scale: 1, alpha: 1, limbRatio: null },
  );
});

test('globe-view transition eases to identity without a threshold pop', () => {
  let prior = null;
  for (let height = 3_500_000; height <= 4_500_000; height += 50_000) {
    const atLimbDistance = cameraLimbDistanceM(height, params.earthRadiusM);
    const current = aircraftRecessionFactors({
      cameraDistanceM: atLimbDistance,
      cameraHeightM: height,
    }, params);
    if (prior) {
      assert.ok(Math.abs(current.alpha - prior.alpha) <= 0.05, `${height}: alpha pop`);
      assert.ok(Math.abs(current.scale - prior.scale) <= 0.05, `${height}: scale pop`);
    }
    prior = current;
  }
  const start = aircraftRecessionFactors({
    cameraDistanceM: cameraLimbDistanceM(3_500_000, params.earthRadiusM),
    cameraHeightM: 3_500_000,
  }, params);
  const end = aircraftRecessionFactors({
    cameraDistanceM: cameraLimbDistanceM(4_500_000, params.earthRadiusM),
    cameraHeightM: 4_500_000,
  }, params);
  assert.ok(Math.abs(start.scale - params.scaleFloor) < 1e-12);
  assert.ok(Math.abs(start.alpha - params.alphaFloor) < 1e-12);
  assert.deepEqual(end, { scale: 1, alpha: 1, limbRatio: null });
});

test('aircraft billboard wire writes scale and alpha only for the far treatment', () => {
  const color = { withAlpha: (alpha) => ({ alpha }) };
  const near = { scale: 1.2, color: { alpha: 0.8 } };
  const nearResult = applyAircraftBillboardTreatment({
    billboard: near,
    baseScale: 1.2,
    baseAlpha: 0.8,
    baseColor: color,
    focusFactor: 1,
    cameraDistanceM: limb * 0.4,
    cameraHeightM,
    params,
  });
  assert.equal(nearResult.scaleWrites, 0);
  assert.equal(nearResult.alphaWrites, 0);

  const far = { scale: 1.2, color: { alpha: 0.8 } };
  const farResult = applyAircraftBillboardTreatment({
    billboard: far,
    baseScale: 1.2,
    baseAlpha: 0.8,
    baseColor: color,
    focusFactor: 0.5,
    cameraDistanceM: limb,
    cameraHeightM,
    params,
  });
  assert.equal(farResult.scaleWrites, 1);
  assert.equal(farResult.alphaWrites, 1);
  assert.ok(Math.abs(far.scale - (1.2 * 0.45)) < 1e-12);
  assert.ok(Math.abs(far.color.alpha - (0.8 * 0.20)) < 1e-12);
});

test('combined focus and haze product is clamped at the composed alpha floor', () => {
  const color = { withAlpha: (alpha) => ({ alpha }) };
  const billboard = { scale: 0.45, color: { alpha: 1 } };
  const result = applyAircraftBillboardTreatment({
    billboard,
    baseScale: 1,
    baseAlpha: 1,
    baseColor: color,
    focusFactor: 0.25,
    cameraDistanceM: limb,
    cameraHeightM,
    params,
  });
  assert.equal(result.alpha, 0.20);
  assert.equal(billboard.color.alpha, 0.20);
});

test('applyAircraftBillboardTreatment returns its documented module singleton', () => {
  const color = { withAlpha: (alpha) => ({ alpha }) };
  const billboard = { scale: 1, color: { alpha: 1 } };
  const input = {
    billboard,
    baseAlpha: 1,
    baseColor: color,
    focusFactor: 1,
    cameraDistanceM: 0,
    cameraHeightM,
    params,
  };
  const first = applyAircraftBillboardTreatment({ ...input, baseScale: 1 });
  const second = applyAircraftBillboardTreatment({ ...input, baseScale: 0.5 });
  assert.strictEqual(first, second);
  assert.equal(first.scale, 0.5, 'the prior reference reflects the next call');
});

test('ambient model presentation receives composed alpha without changing blend semantics', () => {
  const model = { color: { alpha: 1 }, colorBlendAmount: 0.9 };
  const color = { withAlpha: (alpha) => ({ alpha, rgb: 'amber' }) };
  assert.equal(applyAircraftModelTreatment({ model, baseColor: color, alpha: 0.2, params }), 1);
  assert.deepEqual(model.color, { alpha: 0.2, rgb: 'amber' });
  assert.equal(model.colorBlendAmount, 0.9);
  assert.equal(applyAircraftModelTreatment({ model, baseColor: color, alpha: 0.2, params }), 0);
});

test('modelHandoffScaleCap: na hranici modelov presne minimumPixelSize, ďalej ∝ 1/d, dno 14 px, neplatný vstup = bez stropu (2026-09-09 „lietadlá pri horizonte nie sú 3D")', async () => {
  const { modelHandoffScaleCap, MODEL_HANDOFF_FLOOR_PX } = await import('./aircraftRecession.js');
  const px = (cap, glyphPx, distanceScale) => cap * glyphPx * distanceScale;
  // Billboard 20 px × NearFarScalar ~2,95 (≈ 59 px) vs model 32 px na 150 km.
  const at150 = modelHandoffScaleCap({ cameraDistanceM: 150_000, modelAddDistM: 150_000, modelMinPx: 32, glyphPx: 20, distanceScale: 2.95 });
  assert.ok(Math.abs(px(at150, 20, 2.95) - 32) < 1e-9, 'na hranici = minimumPixelSize');
  const at300 = modelHandoffScaleCap({ cameraDistanceM: 300_000, modelAddDistM: 150_000, modelMinPx: 32, glyphPx: 20, distanceScale: 2.9 });
  assert.ok(Math.abs(px(at300, 20, 2.9) - 16) < 1e-9, 'dvojnásobná vzdialenosť = polovica');
  const at600 = modelHandoffScaleCap({ cameraDistanceM: 600_000, modelAddDistM: 150_000, modelMinPx: 32, glyphPx: 20, distanceScale: 2.8 });
  assert.ok(Math.abs(px(at600, 20, 2.8) - MODEL_HANDOFF_FLOOR_PX) < 1e-9, 'dno 14 px — ostáva klikateľné');
  const near = modelHandoffScaleCap({ cameraDistanceM: 50_000, modelAddDistM: 150_000, modelMinPx: 32, glyphPx: 20, distanceScale: 2.98 });
  assert.ok(px(near, 20, 2.98) > 90, 'pod hranicou strop neobmedzuje bežnú 3× ikonu (96 px > 59 px)');
  assert.equal(modelHandoffScaleCap({ cameraDistanceM: 0, modelAddDistM: 150_000, modelMinPx: 32, glyphPx: 20, distanceScale: 3 }), Number.POSITIVE_INFINITY);
  assert.equal(modelHandoffScaleCap({ cameraDistanceM: 1e5, modelAddDistM: NaN, modelMinPx: 32, glyphPx: 20, distanceScale: 3 }), Number.POSITIVE_INFINITY);
});

test('applyAircraftBillboardTreatment: scaleCap zreže škálu a factors.scale je efektívny činiteľ (prezentácia ho zopakuje)', () => {
  const color = { withAlpha: (alpha) => ({ alpha }) };
  const bb = { scale: 1, color: { alpha: 1 } };
  const capped = applyAircraftBillboardTreatment({
    billboard: bb, baseScale: 2, baseAlpha: 1, baseColor: color, focusFactor: 1,
    cameraDistanceM: 1000, cameraHeightM: 5000, scaleCap: 0.5,
  });
  assert.equal(capped.scale, 0.5);
  assert.equal(bb.scale, 0.5);
  assert.ok(Math.abs(capped.factors.scale - 0.25) < 1e-12, 'efektívny činiteľ = strop / základ');
  const free = applyAircraftBillboardTreatment({
    billboard: bb, baseScale: 2, baseAlpha: 1, baseColor: color, focusFactor: 1,
    cameraDistanceM: 1000, cameraHeightM: 5000, scaleCap: Number.POSITIVE_INFINITY,
  });
  assert.equal(free.scale, 2, 'Infinity = bez stropu');
  const omitted = applyAircraftBillboardTreatment({
    billboard: bb, baseScale: 2, baseAlpha: 1, baseColor: color, focusFactor: 1,
    cameraDistanceM: 1000, cameraHeightM: 5000,
  });
  assert.equal(omitted.scale, 2, 'vynechaný parameter = bez stropu');
});

test('modelHorizonReachM: limb(kamera) + limb(cestovná hladina), dno = statický polomer, strop (2026-09-09 „siluety modelov až po obzor")', async () => {
  const { modelHorizonReachM, cameraLimbDistanceM } = await import('./aircraftRecession.js');
  const R = 6_378_137;
  const expected = cameraLimbDistanceM(7_500, R) + cameraLimbDistanceM(12_500, R);
  assert.ok(expected > 700_000 && expected < 720_000, 'z 7,5 km ≈ 309 + 399 km');
  assert.ok(Math.abs(modelHorizonReachM(7_500, { minM: 150_000, maxM: 900_000 }) - expected) < 1e-6);
  assert.equal(modelHorizonReachM(100_000, { minM: 150_000, maxM: 900_000 }), 900_000, 'strop');
  assert.ok(modelHorizonReachM(100, { minM: 150_000, maxM: 900_000 }) > 430_000, 'aj zo zeme vidno cestovnú hladinu ~435 km');
  assert.equal(modelHorizonReachM(100, { minM: 150_000, maxM: 900_000, cruiseAltM: 1 }), 150_000, 'dno: aspoň statický polomer');
  assert.equal(modelHorizonReachM(NaN, { minM: 150_000, maxM: 900_000 }), 150_000);
  assert.equal(modelHorizonReachM(0, { minM: 400_000, maxM: 900_000 }), 400_000);
});

test('modelAutoCap: strop rastie s počtom strojov na obrazovke od základu po tvrdý strop (2026-09-09 „automaticky")', async () => {
  const { modelAutoCap } = await import('./aircraftRecession.js');
  assert.equal(modelAutoCap(40, 150, 600), 150, 'málo strojov = základný strop');
  assert.equal(modelAutoCap(320, 150, 600), 320, 'všetko na obrazovke dostane model');
  assert.equal(modelAutoCap(900, 150, 600), 600, 'tvrdý strop');
  assert.equal(modelAutoCap(NaN, 150, 600), 150);
  assert.equal(modelAutoCap(500, 350, 300), 350, 'strop nikdy pod základ');
});

test('nízka kamera (2026-09-30): ikona sa zmenšuje podľa vzdialenosti, pri vysokej kamere nič', async () => {
  const { aircraftLowCameraScale } = await import('./aircraftRecession.js');
  const floor = DEFAULT_AIRCRAFT_RECESSION_PARAMS.scaleFloor;
  assert.equal(aircraftLowCameraScale(5_000, 1_488), 1, 'blízko plná veľkosť');
  assert.ok(Math.abs(aircraftLowCameraScale(60_000, 1_488) - floor) < 1e-12, 'od 60 km na podlahe');
  assert.ok(Math.abs(aircraftLowCameraScale(300_000, 1_488) - floor) < 1e-12);
  const mid = aircraftLowCameraScale(35_000, 1_488);
  assert.ok(mid < 1 && mid > floor, `35 km medzi: ${mid}`);
  assert.equal(aircraftLowCameraScale(60_000, 60_000), 1, 'kamera nad 60 km bez zmeny');
  assert.equal(aircraftLowCameraScale(NaN, 1_488), 1);
  assert.equal(aircraftLowCameraScale(60_000, undefined), 1);
  // úvodný pohľad: stroj 45 km ďaleko je pod limbovým pásmom (pomer ~0,33), napriek tomu menší
  const f = aircraftRecessionFactors({ cameraDistanceM: 45_000, cameraHeightM: 1_488 });
  assert.ok(f.limbRatio < DEFAULT_AIRCRAFT_RECESSION_PARAMS.startLimbRatio);
  assert.ok(f.scale < 0.65, `45 km pri nízkej kamere: ${f.scale}`);
  assert.equal(f.alpha, 1, 'priehľadnosť sa nemení');
  // vysoká kamera: pôvodné správanie bez zmeny
  assert.deepEqual(
    aircraftRecessionFactors({ cameraDistanceM: limb * 0.49, cameraHeightM }, params),
    { scale: 1, alpha: 1, limbRatio: 0.49 },
  );
});
