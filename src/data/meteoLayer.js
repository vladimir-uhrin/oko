// src/data/meteoLayer.js
// Meteorológia sveta — vrstva „GFS · vietor a teplota" (2026-09-08, prototyp
// „ako Windy, štýl OKO", používateľ: GPU častice, najprv prototyp).
//
// Čo robí: pre každý krok predpovede (3 h, +48 h) stiahne z proxy /api/meteo
// dva PNG rezy — vietor (R=u, G=v, B=rýchlosť) a teplotu (R) — a ukáže:
//   - farebné pole cez plochú drapériu (Cesium Primitive s vlastným Material
//     fabricom: textúra hodnôt × 1D rampa v identite OKO, meteoField.js),
//   - GPU častice vetra (windParticles.js) nad glóbusom,
//   - spodnú časovú os (meteoTimeline.js) s prehrávaním.
// Čipy v riadku vrstvy prepínajú pole (VIETOR / TEPLOTA) a častice; legenda
// je rampa. Podklad: pri zapnutí sa fotoreálny Google 3D vymení za GIBS
// Blue Marble (tlmený reliéf ako Windy), pri vypnutí sa vráti pôvodný.
//
// Dáta sú PREDPOVEĎ modelu (NOAA/NCEP GFS 0,25° cez NSF Unidata THREDDS),
// nie pozorovanie — riadok zdroja aj os to hovoria (beh, krok, vek).

import * as Cesium from 'cesium';
import { t, currentLanguage } from '../i18n.js';
import { governorRequestRender } from '../renderGovernor.js';
import { getActiveMapStack, onActiveMapStackChange } from './activeMapStack.js';
import {
  METEO_FIELDS, METEO_LAYER_ID, METEO_RAMPS, WIND_COMPONENT_RANGE,
  normalizeCatalog, rampLegend, rampRgbaTable, runLabel, sliceUrl, stepLabel,
} from './meteoField.js';
import { createWindParticles } from '../windParticles.js';
import { createMeteoTimeline, METEO_PLAY_INTERVAL_MS } from '../meteoTimeline.js';

export { METEO_LAYER_ID };
export const METEO_CATALOG_URL = '/api/meteo/catalog';
/** Výška drapérie nad elipsoidom (pod lietadlami, nad podkladom). */
export const METEO_DRAPE_HEIGHT_M = 2_000;
export const METEO_FIELD_ALPHA = 0.62;
/** Podklad vhodný pre polia — tlmený reliéf (Windy má šedomodrú mapu). */
export const METEO_BASEMAP_ID = 'gibs-blue-marble';
/** Koľko krokov dopredu prednačítať. */
export const METEO_PREFETCH_STEPS = 2;

/**
 * Cesium Material: hodnota z textúry (kanál `channel`, 0..1) → skutočná
 * hodnota (`decode`) → pozícia na rampe (`rampRange`) → farba z 1D rampy.
 * Pure (vracia definíciu fabricu, nie objekt Cesia).
 */
export function fieldMaterialFabric() {
  return {
    type: 'OkoMeteoField',
    uniforms: {
      image: Cesium.Material.DefaultImageId,
      ramp: Cesium.Material.DefaultImageId,
      channel: 0,
      decodeMin: 0,
      decodeMax: 1,
      rampMin: 0,
      rampMax: 1,
      alpha: METEO_FIELD_ALPHA,
    },
    source: `
      czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material material = czm_getDefaultMaterial(materialInput);
        vec4 px = texture(image, materialInput.st);
        float raw = channel < 0.5 ? px.r : (channel < 1.5 ? px.g : px.b);
        float value = decodeMin + raw * (decodeMax - decodeMin);
        float u = clamp((value - rampMin) / (rampMax - rampMin), 0.0, 1.0);
        vec4 c = texture(ramp, vec2(u, 0.5));
        material.diffuse = c.rgb;
        material.alpha = alpha;
        return material;
      }`,
  };
}

/** Rampa ako canvas 256×1 (Cesium Material berie canvas ako image). */
export function rampCanvas(doc, stops, range) {
  const canvas = doc.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const table = rampRgbaTable(stops, range, 256);
  const img = ctx.createImageData(256, 1);
  img.data.set(table);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Drapéria celého sveta s meteo materiálom. Injektovateľné v testoch.
 * @param {{image: HTMLImageElement|HTMLCanvasElement, ramp: HTMLCanvasElement, field: object}} input
 */
export function createFieldPrimitive({ image, ramp, field }) {
  const material = new Cesium.Material({ fabric: fieldMaterialFabric() });
  material.uniforms.image = image;
  material.uniforms.ramp = ramp;
  material.uniforms.channel = field.channel;
  material.uniforms.decodeMin = field.decode[0];
  material.uniforms.decodeMax = field.decode[1];
  material.uniforms.rampMin = field.rampRange[0];
  material.uniforms.rampMax = field.rampRange[1];
  const primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        // GFS mriežka začína na 0° E a riadok 0 je 90° N; obrázok je
        // uložený sever hore, PNG ide na obdĺžnik 0..360 → Cesium chce
        // -180..180, preto proxy stĺpce posúva o 180° (viď meteoProxy).
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
        height: METEO_DRAPE_HEIGHT_M,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        granularity: Cesium.Math.toRadians(2),
      }),
    }),
    appearance: new Cesium.EllipsoidSurfaceAppearance({ material, flat: true, translucent: true }),
    asynchronous: false,
    show: false,
  });
  return { primitive, material };
}

/** Načíta PNG ako dekódovaný <img> (null pri chybe). */
export function loadImage(url, doc = globalThis.document) {
  return new Promise((resolve) => {
    const img = doc.createElement('img');
    img.decoding = 'async';
    img.onload = () => (typeof img.decode === 'function' ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img));
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * @param {object} [options] test seams
 */
export function createMeteoLayer({
  fetchImpl = null,
  imageLoader = loadImage,
  primitiveFactory = createFieldPrimitive,
  particlesFactory = createWindParticles,
  timelineFactory = createMeteoTimeline,
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _catalog = null;
  let _index = 0;
  let _field = 'wind';
  let _particlesOn = true;
  let _particles = null;
  let _timeline = null;
  let _drape = null; // { primitive, material }
  let _ramps = {}; // fieldId → canvas
  const _images = new Map(); // url → Promise<img|null>
  let _lastError = null;
  let _lastUpdate = null;
  let _stale = false;
  let _playTimer = null;
  let _previousStack = null;
  let _rowListener = null;
  let _unsubStack = null;
  let _loadToken = 0;

  const lang = () => (currentLanguage?.() === 'en' ? 'en' : 'sk');

  function stepsForTimeline() {
    if (!_catalog) return [];
    let lastDay = '';
    return _catalog.steps.map((iso) => {
      const label = stepLabel(iso, _catalog.run, lang());
      const day = label.split(' ').slice(0, 2).join(' ');
      const tick = day !== lastDay ? day : '';
      lastDay = day;
      return { label, day: tick };
    });
  }

  function imageFor(fieldId, iso) {
    const url = sliceUrl(fieldId, iso);
    if (!_images.has(url)) _images.set(url, imageLoader(url, doc));
    return _images.get(url);
  }

  function prefetch() {
    if (!_catalog) return;
    for (let k = 1; k <= METEO_PREFETCH_STEPS; k += 1) {
      const iso = _catalog.steps[_index + k];
      if (!iso) break;
      void imageFor('wind', iso);
      if (_field !== 'wind') void imageFor(_field, iso);
    }
  }

  async function applyStep() {
    if (!_viewer || !_enabled || !_catalog) return;
    const iso = _catalog.steps[_index];
    if (!iso) return;
    const token = ++_loadToken;
    _timeline?.setStatus(t('meteo.loading'));
    const [windImg, fieldImg] = await Promise.all([
      imageFor('wind', iso),
      _field === 'wind' ? imageFor('wind', iso) : imageFor(_field, iso),
    ]);
    if (token !== _loadToken || !_enabled) return;
    if (!windImg || !fieldImg) {
      _lastError = t('meteo.slice-failed');
      _timeline?.setStatus(_lastError);
      return;
    }
    _lastError = null;
    const field = METEO_FIELDS[_field];
    if (!_drape) {
      _drape = primitiveFactory({ image: fieldImg, ramp: _ramps[_field], field });
      _viewer.scene.primitives.add(_drape.primitive);
    } else {
      _drape.material.uniforms.image = fieldImg;
      _drape.material.uniforms.ramp = _ramps[_field];
      _drape.material.uniforms.channel = field.channel;
      _drape.material.uniforms.decodeMin = field.decode[0];
      _drape.material.uniforms.decodeMax = field.decode[1];
      _drape.material.uniforms.rampMin = field.rampRange[0];
      _drape.material.uniforms.rampMax = field.rampRange[1];
    }
    _drape.primitive.show = true;
    if (_particles && _particlesOn) {
      _particles.setWind(windImg, { uRange: WIND_COMPONENT_RANGE, vRange: WIND_COMPONENT_RANGE });
      _particles.start();
    }
    _timeline?.setStatus(_catalog.stale ? t('meteo.stale') : t('meteo.forecast'));
    governorRequestRender('meteo');
    prefetch();
  }

  function requestBasemap() {
    const active = getActiveMapStack();
    const id = active?.id || null;
    if (id === 'photoreal' || id === null) {
      _previousStack = id;
      win?.dispatchEvent?.(new CustomEvent('gev:request-map-stack', { detail: { id: METEO_BASEMAP_ID, reason: 'meteo' } }));
    } else {
      _previousStack = null;
    }
  }

  function restoreBasemap() {
    if (!_previousStack) return;
    const active = getActiveMapStack();
    if (active?.id === METEO_BASEMAP_ID) {
      win?.dispatchEvent?.(new CustomEvent('gev:request-map-stack', { detail: { id: _previousStack, reason: 'meteo-restore' } }));
    }
    _previousStack = null;
  }

  function stopPlay() {
    if (_playTimer) { clearInterval(_playTimer); _playTimer = null; }
  }

  function startPlay() {
    stopPlay();
    _playTimer = setInterval(() => {
      if (!_catalog) return;
      const next = (_index + 1) % _catalog.steps.length;
      _index = next;
      _timeline?.setIndex(next);
      void applyStep();
    }, METEO_PLAY_INTERVAL_MS);
  }

  const layer = {
    id: METEO_LAYER_ID,
    name: 'Meteorológia · vietor a teplota (GFS)',
    icon: '≋',
    get source() {
      const run = _catalog ? runLabel(_catalog.run, lang()) : (lang() === 'en' ? 'GFS 0.25°' : 'GFS 0,25°');
      return `NOAA/NCEP ${run} · NSF Unidata THREDDS · ${t('meteo.forecast')}`;
    },
    updateInterval: 30 * 60 * 1000,

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _catalog = null;
      _index = 0;
      _lastError = null;
      _ramps = {
        wind: rampCanvas(doc, METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange),
        temp: rampCanvas(doc, METEO_RAMPS.temp, METEO_FIELDS.temp.rampRange),
      };
      if (!_timeline && doc?.body) {
        _timeline = timelineFactory(doc, {
          t,
          onIndex: (i) => { _index = i; void applyStep(); },
          onPlay: (playing) => (playing ? startPlay() : stopPlay()),
        });
      }
      _unsubStack = onActiveMapStackChange?.(() => { /* podklad sa mení mimo nás — nič */ }) || null;
      console.log('[Data:Meteo] Initialized');
    },

    enable() {
      _enabled = true;
      requestBasemap();
      _timeline?.show();
      if (!_particles && _viewer?.container && _particlesOn) {
        try {
          _particles = particlesFactory(_viewer.container, _viewer);
          _particles.setRamp(rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange), METEO_FIELDS.wind.rampRange);
        } catch (error) {
          console.warn('[Data:Meteo] particles unavailable:', error?.message || error);
          _particles = null;
        }
      }
      if (_catalog) void applyStep();
      else void this.update();
    },

    disable() {
      _enabled = false;
      _loadToken += 1;
      stopPlay();
      _timeline?.hide();
      if (_drape) _drape.primitive.show = false;
      _particles?.stop();
      restoreBasemap();
      governorRequestRender('meteo');
    },

    async update() {
      try {
        const response = await doFetch(METEO_CATALOG_URL);
        if (!response?.ok) { _lastError = `meteo proxy HTTP ${response?.status}`; return false; }
        const catalog = normalizeCatalog(await response.json());
        if (!catalog) { _lastError = t('meteo.catalog-failed'); return false; }
        const runChanged = _catalog?.run !== catalog.run;
        _catalog = catalog;
        _stale = catalog.stale;
        _lastUpdate = new Date();
        _lastError = null;
        if (runChanged) _images.clear();
        _timeline?.setSteps(stepsForTimeline(), runLabel(catalog.run, lang()));
        if (_index >= catalog.steps.length) _index = 0;
        _timeline?.setIndex(_index);
        _rowListener?.();
        if (_enabled) void applyStep();
        return true;
      } catch (error) {
        _lastError = String(error?.message || error);
        return false;
      }
    },

    /**
     * Čipy: pole (wind/temp) a častice.
     * @param {{field?: string, particles?: boolean}} params
     */
    setParams(params = {}) {
      let changed = false;
      if (params.field && METEO_FIELDS[params.field] && params.field !== _field) { _field = params.field; changed = true; }
      if (typeof params.particles === 'boolean' && params.particles !== _particlesOn) {
        _particlesOn = params.particles;
        if (_particlesOn) {
          if (!_particles && _viewer?.container) {
            _particles = particlesFactory(_viewer.container, _viewer);
            _particles.setRamp(rampRgbaTable(METEO_RAMPS.wind, METEO_FIELDS.wind.rampRange), METEO_FIELDS.wind.rampRange);
          }
        } else _particles?.stop();
        changed = true;
      }
      if (changed && _enabled) void applyStep();
      _rowListener?.();
      return true;
    },

    getParams() { return { field: _field, particles: _particlesOn }; },

    setRowControlsListener(fn) { _rowListener = typeof fn === 'function' ? fn : null; },

    getRowControls() {
      const field = METEO_FIELDS[_field];
      return {
        chips: [
          { id: 'field-wind', label: t('meteo.chip-wind'), active: _field === 'wind', params: { field: 'wind' } },
          { id: 'field-temp', label: t('meteo.chip-temp'), active: _field === 'temp', params: { field: 'temp' } },
          { id: 'particles', label: t('meteo.chip-particles'), active: _particlesOn, params: { particles: !_particlesOn }, disabled: _particles ? !_particles.isSupported() : false },
        ],
        legend: rampLegend(METEO_RAMPS[_field], field.unit),
      };
    },

    getStats() {
      return {
        count: _catalog?.steps.length || 0,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },

    /** Test seam. */
    _getStateForTest() {
      return { enabled: _enabled, index: _index, field: _field, particlesOn: _particlesOn, catalog: _catalog, drape: Boolean(_drape), previousStack: _previousStack };
    },

    destroy(viewer) {
      this.disable();
      if (_drape) { viewer?.scene?.primitives?.remove?.(_drape.primitive); _drape = null; }
      _particles?.destroy(); _particles = null;
      _timeline?.destroy(); _timeline = null;
      _unsubStack?.(); _unsubStack = null;
      _images.clear();
    },
  };

  return layer;
}

export default createMeteoLayer();
