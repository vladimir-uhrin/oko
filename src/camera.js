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
 * Úvodný pohľad pre nového návštevníka (2026-10-15, vlastník: „potrebujem, aby to bolo pri načítaní
 * hneď wow, aby neodišiel" — zo snímok vybral „Zemeguľa šikmo, SK"): šikmý pohľad na zemeguľu so
 * Slovenskom blízko stredu — zakrivenie Zeme, hviezdy, Európa s tisíckami lietadiel a lodí naživo.
 * Porovnanie output/qa-world/start/*.png: Bratislava a Tatry sú v noci tmavé, zemeguľa je silná
 * cez deň aj v noci. Tlačidlo s glóbusom hore ostáva na Bratislave (HOME_VIEW).
 */
export const START_VIEW = Object.freeze({
  longitude: 19.5,
  latitude: 30,
  heightM: 7_000_000,
  headingDeg: 0,
  pitchDeg: -72,
});

/** Stred Slovenska — kotva úvodného pohľadu na telefóne. */
export const START_SK = Object.freeze({ lat: 48.7, lon: 19.5 });

/**
 * Telefón na výšku (2026-10-15, vlastník: „na mobile prerob prvotný náhľad … najradšej by som tam mal
 * aj trocha slnka"): kamera za Slovenskom, natočená smerom k Slnku a sklonená k obzoru — cez deň
 * slnkom zaliata Zem, v noci žiariaci okraj Zeme pri terminátore (tam Slnko práve vychádza/zapadá).
 * Výška a sklon vybrané zo snímok output/qa-world/start/telefon-*.png.
 */
// Z 8 000 km je okraj Zeme ~64° pod vodorovnou rovinou: sklon −78° pri 60° zornom poli dá dole celú
// Zem a hore (~¼ obrazu) okraj s terminátorom smerom k Slnku; stred záberu je ~16° (1 780 km) pred
// kamerou — preto je kamera o toľko „za" Slovenskom. (Prvá voľba 5 200 km / −34° mala Zem len v páse dole.)
export const START_PORTRAIT_SUN = Object.freeze({ heightM: 8_000_000, backKm: 1_780, pitchDeg: -78 });

/**
 * Bod, nad ktorým je Slnko v zenite (pure, presnosť ~1–2°): deklinácia z dňa v roku, dĺžka z UTC
 * času (rovnica času zanedbaná — na rámovanie pohľadu stačí).
 * @param {number} nowMs
 * @returns {{lat: number, lon: number}}
 */
export function subsolarPoint(nowMs) {
  const d = new Date(nowMs);
  const dayOfYear = (nowMs - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000;
  const lat = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  let lon = (12 - hours) * 15;
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

const RAD = Math.PI / 180;
/** Azimut z bodu A na bod B po veľkej kružnici (°, pure). */
export function bearingDegrees(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
/** Bod vo vzdialenosti km v smere azimutu (pure). */
export function offsetPoint(lat, lon, bearingDeg, km) {
  const d = km / 6371;
  const b = bearingDeg * RAD;
  const la1 = lat * RAD;
  const lo1 = lon * RAD;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / RAD, lon: ((lo2 / RAD + 540) % 360) - 180 };
}

/** Telefón: pohľad zo Slovenska smerom k Slnku v čase nowMs (pure). */
export function portraitSunView(nowMs, { anchor = START_SK, cfg = START_PORTRAIT_SUN } = {}) {
  const sun = subsolarPoint(nowMs);
  const heading = bearingDegrees(anchor.lat, anchor.lon, sun.lat, sun.lon);
  const back = offsetPoint(anchor.lat, anchor.lon, heading + 180, cfg.backKm);
  return { longitude: back.lon, latitude: back.lat, heightM: cfg.heightM, headingDeg: heading, pitchDeg: cfg.pitchDeg };
}

/** Úvodný pohľad podľa tvaru plátna (pure): na výšku k Slnku, inak START_VIEW. */
export function startViewFor(width, height, nowMs = Date.now()) {
  const w = Number(width);
  const h = Number(height);
  return w > 0 && h > w ? portraitSunView(nowMs) : START_VIEW;
}

/** Ako dlho po skrytí úvodnej obrazovky ostane celá Zem, kým kamera poletí k návštevníkovi (ms). */
export const START_GLOBE_DWELL_MS = 4500;
/** Prelet zo zemegule nad oblasť návštevníka (s). */
export const START_FLY_DURATION_S = 7;
/** Nad oblasťou: výška a sklon podľa presnosti polohy z IP (mesto / len krajina). */
export const START_AREA_VIEW = Object.freeze({
  city: Object.freeze({ heightM: 260_000, pitchDeg: -42, backKm: 230 }),
  country: Object.freeze({ heightM: 1_100_000, pitchDeg: -55, backKm: 650 }),
});

/**
 * Pohľad nad oblasť návštevníka (pure): kamera južne od miesta, pohľad na sever, miesto v strede.
 * @param {{lat:number, lon:number, precision:'city'|'country'}} geo
 * @returns {{longitude:number, latitude:number, heightM:number, headingDeg:number, pitchDeg:number}|null}
 */
export function areaViewFor(geo) {
  if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return null;
  const cfg = START_AREA_VIEW[geo.precision];
  if (!cfg) return null;
  const at = offsetPoint(geo.lat, geo.lon, 180, cfg.backKm);
  return { longitude: at.lon, latitude: at.lat, heightM: cfg.heightM, headingDeg: 0, pitchDeg: cfg.pitchDeg };
}

/**
 * Úvod pre nového návštevníka (2026-10-15, vlastník: „na určitý čas sa zobrazí celá Zem ako teraz
 * a podľa IP adresy priletí k miestu, odkiaľ sa užívateľ pripojil"): zemeguľa hneď pod úvodnou
 * obrazovkou; po jej skrytí START_GLOBE_DWELL_MS celá Zem a potom prelet nad oblasť z polohy
 * pripojenia (locate — server, hlavičky Cloudflare, nič sa neukladá). Bez polohy ostane zemeguľa.
 * Dotyk, koliesko, klávesa či pohyb kamery návštevníkom úvod zastaví.
 * @param {Cesium.Viewer} viewer
 * @param {object} [o]
 * @param {Promise<unknown>} [o.whenReady] skrytie úvodnej obrazovky
 * @param {() => Promise<object|null>} [o.locate] približná poloha návštevníka
 * @param {(geo: object) => void} [o.onArrive] po prelete (hláška „vaša oblasť podľa pripojenia")
 * @param {number} [o.nowMs]
 */
export function showStartView(viewer, { whenReady = Promise.resolve(), locate = null, onArrive = null, nowMs = Date.now(), win = globalThis.window, dwellMs = START_GLOBE_DWELL_MS } = {}) {
  const canvas = viewer?.canvas;
  const view = startViewFor(canvas?.clientWidth, canvas?.clientHeight, nowMs);
  const orient = (v) => ({ heading: Cesium.Math.toRadians(v.headingDeg), pitch: Cesium.Math.toRadians(v.pitchDeg), roll: 0 });
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(view.longitude, view.latitude, view.heightM), orientation: orient(view) });
  const placed = Cesium.Cartesian3.clone(viewer.camera.positionWC);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { viewer.camera.cancelFlight(); } catch { /* bez preletu */ }
    for (const type of INTERACTION_EVENTS) win?.removeEventListener?.(type, stop, true);
  };
  for (const type of INTERACTION_EVENTS) win?.addEventListener?.(type, stop, { capture: true, passive: true });
  const geoPromise = typeof locate === 'function' ? Promise.resolve().then(locate).catch(() => null) : Promise.resolve(null);
  void Promise.resolve(whenReady)
    .then(() => new Promise((resolve) => setTimeout(resolve, dwellMs)))
    .then(() => geoPromise)
    .then((geo) => {
      // Návštevník už sám hýbal kamerou alebo pohľad obnovil odkaz — nechať tak.
      if (stopped || Cesium.Cartesian3.distance(placed, viewer.camera.positionWC) > 1000) { stop(); return; }
      const area = areaViewFor(geo);
      if (!area) { stop(); return; }
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(area.longitude, area.latitude, area.heightM),
        orientation: orient(area),
        duration: START_FLY_DURATION_S,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => { if (!stopped) { stop(); try { onArrive?.(geo); } catch { /* hláška je doplnok */ } } },
        cancel: () => stop(),
      });
    });
  return view;
}

/** Vstupy návštevníka, ktoré úvodný prelet zastavia. */
const INTERACTION_EVENTS = Object.freeze(['pointerdown', 'wheel', 'keydown', 'touchstart']);

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
