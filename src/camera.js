import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Úvodný pohľad OKA nad Bratislavou — jeden zdroj pravdy pre štart aj tlačidlo „domov"
 * (glóbus hore v strede, 2026-09-27: „ak stlačím túto ikonu, nech priletí nad BA do
 * polohy základnej"). Východne od centra nad Ružinovom, pohľad na ZJZ hore Dunajom.
 */
export const HOME_VIEW = Object.freeze({
  longitude: 17.1743,
  latitude: 48.1564,
  heightM: 1488,
  headingDeg: 241,
  pitchDeg: -12,
});

/**
 * Sklon úvodného pohľadu na výšku (mobil, 2026-09-30, vlastník: „daj −20°"). Cesium dáva 60° zorné
 * pole na DLHŠIU stranu, takže na výšku je nad obzorom ~18° oblohy (na šírku ~6°) a lietadlá
 * 50–300 km ďaleko pri Viedni pôsobili ako roj nad mestom. Strmší pohľad nechá obrazovku mestu.
 */
export const HOME_PORTRAIT_PITCH_DEG = -20;

/**
 * Sklon úvodného pohľadu podľa tvaru plátna (pure): na výšku HOME_PORTRAIT_PITCH_DEG,
 * inak (aj pri neznámej veľkosti) HOME_VIEW.pitchDeg.
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
export function homePitchDeg(width, height) {
  const w = Number(width);
  const h = Number(height);
  return w > 0 && h > w ? HOME_PORTRAIT_PITCH_DEG : HOME_VIEW.pitchDeg;
}

function homePitchFor(viewer) {
  const canvas = viewer?.canvas;
  return homePitchDeg(canvas?.clientWidth, canvas?.clientHeight);
}

/**
 * Prelet na úvodný pohľad (HOME_VIEW). Tvar volieb ako flyToGlobeView v locations.js.
 * @param {Cesium.Viewer} viewer
 * @param {{duration?: number, onComplete?: Function, onCancel?: Function}} [options]
 * @returns {{latitude: number, longitude: number, heightM: number}}
 */
export function flyToHomeView(viewer, options = {}) {
  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.longitude, HOME_VIEW.latitude, HOME_VIEW.heightM),
    orientation: {
      heading: Cesium.Math.toRadians(HOME_VIEW.headingDeg),
      pitch: Cesium.Math.toRadians(homePitchFor(viewer)),
      roll: 0.0,
    },
    duration: Number.isFinite(options.duration) && options.duration > 0 ? options.duration : 3.0,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    endTransform: Cesium.Matrix4.IDENTITY,
    // Cesium číta complete/cancel (nie onComplete/onCancel) — ako flyToGlobeView.
    complete: options.onComplete,
    cancel: options.onCancel,
  });
  return { latitude: HOME_VIEW.latitude, longitude: HOME_VIEW.longitude, heightM: HOME_VIEW.heightM };
}

/**
 * OKO first-load view: Bratislava with the Danube leading toward Žitný
 * ostrov. Same two-step shape as flyToAustin — start high, then a cinematic
 * settle onto the old town at an oblique angle (the city has full
 * photorealistic mesh; docs/SK-NOTES.md Fáza 0).
 */
export function flyToBratislava(viewer) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(17.1077, 48.1486, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  setTimeout(() => {
    viewer.camera.flyTo({
      // Camera NE of the centre, above the old town, looking SW at the castle
      // (2026-09-26, owner: „potrebujem súrne opraviť túto dlaždicu"): the
      // former view from the SW across the Danube had Google's coarse mesh
      // patch (south slope of the castle hill, the embankment, part of the
      // river — identical via Google direct and Cesium ion, unchanged at
      // 4× finer screen-space error) smeared across the middle of the first
      // frame every visitor sees. From this side the castle and the old town
      // are sharp and the patch stays out of the main frame.
      // 2026-09-27 (owner, screenshot „daj túto polohu zobrazenia ako úvodnú"): east of the
      // centre over Ružinov, looking WSW up the Danube — bridges, Petržalka, old town and the
      // castle in one frame.
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.longitude, HOME_VIEW.latitude, HOME_VIEW.heightM),
      orientation: {
        heading: Cesium.Math.toRadians(HOME_VIEW.headingDeg),
        pitch: Cesium.Math.toRadians(homePitchFor(viewer)),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}

/**
 * Set camera to Austin on load with a cinematic fly-in.
 */
export function flyToAustin(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 600),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}
