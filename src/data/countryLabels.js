// src/data/countryLabels.js — názvy štátov pri priblížení (2026-10-16, vlastník: po hraniciach „nevidno, kde je
// napr. Slovensko" → názvy ako ďalší krok). Body popisiek a odporúčané úrovne priblíženia dáva Natural Earth
// (local_data/natural_earth/country-labels.json, public domain), mená v jazyku používateľa dáva prehliadač
// (`Intl.DisplayNames`, záloha anglické meno). Ukazujú sa spolu s hranicami (zoomBorders.js → setVisible) a
// v rámci toho podľa priblíženia: Natural Earth MIN_LABEL/MAX_LABEL sú úrovne webovej mapy, výška kamery sa
// na ne prepočíta odhadom (cameraZoomLevel). Domovská krajina podľa pripojenia je svetlejšia a väčšia.
import * as Cesium from 'cesium';

export const COUNTRY_LABELS_ID = 'country-labels';
const dataUrl = new URL('./local_data/natural_earth/country-labels.json', import.meta.url).href;

/**
 * Odhad úrovne priblíženia webovej mapy z výšky kamery: rozlíšenie webovej mapy je 156 543·cos(lat)/2^z m/px,
 * zvislý záber kamery (FOV 60°, ~900 px) ≈ 1,15·výška → 2^z ≈ 1,22·10^8·cos(lat)/výška.
 */
export const ZOOM_SCALE_M = 1.22e8;
export function cameraZoomLevel(heightM, latRad = 0) {
  if (!(heightM > 0)) return 0;
  const cos = Math.max(0.15, Math.cos(latRad || 0));
  return Math.log2((ZOOM_SCALE_M * cos) / heightM);
}

/** Mikroštáty (Natural Earth TINY > 0) o úroveň neskôr: pri pohľade na Európu (2 500 km ≈ úroveň 5) by Vatikán,
 *  San Maríno či Lichtenštajnsko prekrývali mená susedov — šikmý 3D záber je hustejší než rovná webová mapa. */
export const TINY_LEVEL_BIAS = 1;
/** Je popiska štátu pri tejto úrovni viditeľná? (pure) */
export function labelVisible(rec, zoom) {
  const min = (rec.minLabel ?? 0) + (rec.tiny > 0 ? TINY_LEVEL_BIAS : 0);
  return zoom >= min && zoom <= (rec.maxLabel ?? 10);
}

/**
 * Meno štátu v jazyku (`Intl.DisplayNames`), záloha anglické meno; pure okrem injektovateľného konštruktora.
 * @param {string} iso2
 * @param {string} lang
 * @param {{fallback?: string, DisplayNames?: Function}} [o]
 */
export function displayName(iso2, lang, { fallback = '', DisplayNames = globalThis.Intl?.DisplayNames } = {}) {
  if (typeof DisplayNames === 'function') {
    try {
      const name = new DisplayNames([lang], { type: 'region' }).of(iso2);
      if (name && name !== iso2) return name;
    } catch { /* neznámy kód alebo jazyk */ }
  }
  return fallback || iso2;
}

/** Riedené verzálky ako v HUD: „Slovensko" → „S L O V E N S K O" (medzi slovami dve medzery). Pure. */
export function spaced(text) {
  return String(text || '').toUpperCase().split(/\s+/).filter(Boolean).map((w) => [...w].join(' ')).join('   ');
}

const NOOP = Object.freeze({ load: async () => 0, setVisible() {}, setHome() {}, refresh() {}, destroy() {}, get count() { return 0; }, get shown() { return 0; }, get visible() { return false; } });

/**
 * @param {object} o
 * @param {object} o.scene Cesium.Scene (primitives, camera, postRender, canvas)
 * @param {string} [o.lang] jazyk mien ('sk' | 'en')
 * @param {string} [o.url]
 * @param {Function} [o.fetch]
 * @param {object} [o.CesiumRef] injektovateľné Cesium (testy bez WebGL)
 * @param {() => number} [o.now]
 */
export function createCountryLabels({ scene, lang = 'sk', url = dataUrl, fetch: fetchImpl, CesiumRef = Cesium, now = Date.now, minIntervalMs = 250 } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  if (!scene?.primitives || !scene?.postRender || !scene?.camera) return NOOP;
  const labels = new CesiumRef.LabelCollection();
  scene.primitives.add(labels);
  /** @type {Array<{rec: object, label: object, pos: object}>} */
  let items = [];
  let visible = false;
  let home = null;
  let loaded = false;
  let loading = null;
  let lastAt = -Infinity;
  let shownCount = 0;

  const fill = CesiumRef.Color.fromCssColorString('rgba(227, 246, 252, 0.82)');
  const fillHome = CesiumRef.Color.fromCssColorString('rgba(255, 255, 255, 0.98)');
  const outline = CesiumRef.Color.fromCssColorString('rgba(5, 12, 20, 0.85)');
  const FONT = '500 12px "JetBrains Mono", "SF Mono", monospace';
  const FONT_HOME = '600 13px "JetBrains Mono", "SF Mono", monospace';

  const styleItem = (item) => {
    const isHome = home && item.rec.iso2 === home;
    item.label.font = isHome ? FONT_HOME : FONT;
    item.label.fillColor = isHome ? fillHome : fill;
  };

  async function load() {
    if (loaded) return items.length;
    if (!loading) {
      loading = (async () => {
        const response = await doFetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const records = Array.isArray(data?.labels) ? data.labels : [];
        for (const rec of records) {
          if (!/^[A-Z]{2}$/.test(rec?.iso2 || '') || !Number.isFinite(rec.lon) || !Number.isFinite(rec.lat)) continue;
          const pos = CesiumRef.Cartesian3.fromDegrees(rec.lon, rec.lat, 0);
          const label = labels.add({
            id: `${COUNTRY_LABELS_ID}:${rec.iso2}`,
            position: pos,
            text: spaced(displayName(rec.iso2, lang, { fallback: rec.nameEn })),
            font: FONT,
            fillColor: fill,
            outlineColor: outline,
            outlineWidth: 3,
            style: CesiumRef.LabelStyle.FILL_AND_OUTLINE,
            horizontalOrigin: CesiumRef.HorizontalOrigin.CENTER,
            verticalOrigin: CesiumRef.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: false,
          });
          items.push({ rec, label, pos });
        }
        loaded = true;
        for (const item of items) styleItem(item);
        refresh(true);
      })().catch((err) => { console.error('[CountryLabels] load error:', err); }).finally(() => { loading = null; });
    }
    await loading;
    return items.length;
  }

  /** Podľa výšky kamery a zakrytia glóbusom; raz za minIntervalMs (force = hneď). */
  function refresh(force = false) {
    const t = now();
    if (!force && t - lastAt < minIntervalMs) return;
    lastAt = t;
    if (!loaded) return;
    const carto = scene.camera.positionCartographic;
    const zoom = cameraZoomLevel(carto?.height, carto?.latitude);
    let occluder = null;
    if (visible && CesiumRef.EllipsoidalOccluder && scene.camera.positionWC) {
      try { occluder = new CesiumRef.EllipsoidalOccluder(CesiumRef.Ellipsoid.WGS84, scene.camera.positionWC); } catch { occluder = null; }
    }
    let n = 0;
    for (const item of items) {
      const show = visible && labelVisible(item.rec, zoom) && (!occluder || occluder.isPointVisible(item.pos));
      if (item.label.show !== show) item.label.show = show;
      if (show) n += 1;
    }
    shownCount = n;
    scene.requestRender?.();
  }
  const onPostRender = () => { if (visible) refresh(false); };
  scene.postRender.addEventListener(onPostRender);

  return {
    load,
    /** Zapnutie spolu s hranicami (zoomBorders). */
    setVisible(on) {
      const next = Boolean(on);
      if (next === visible) return;
      visible = next;
      if (visible) void load();
      refresh(true);
    },
    /** Domovská krajina (ISO2) — svetlejšia a väčšia popiska. */
    setHome(iso2) {
      const code = String(iso2 || '').toUpperCase();
      home = /^[A-Z]{2}$/.test(code) ? code : null;
      for (const item of items) styleItem(item);
      scene.requestRender?.();
    },
    refresh: () => refresh(true),
    destroy() {
      scene.postRender.removeEventListener?.(onPostRender);
      try { scene.primitives.remove(labels); } catch { /* */ }
      items = [];
      loaded = false;
      shownCount = 0;
    },
    get count() { return items.length; },
    get shown() { return shownCount; },
    get visible() { return visible; },
    get home() { return home; },
  };
}
