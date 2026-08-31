import * as Cesium from 'cesium';
import { governorRequestRender } from '../renderGovernor.js';

/**
 * SHMÚ precipitation radar overlay — Slovak 5-minute zmax composite (OKO).
 *
 * Live imagery layer: the dev-server proxy (`/api/shmu/radar`) decodes the
 * ODIM_H5 composite from opendata.shmu.sk (CC BY 4.0 — DATA_SOURCES.md) into
 * a latitude-linear PNG plus bounds metadata; this module drapes it as one
 * rectangle entity. An ENTITY at a fixed altitude — not a globe imagery
 * layer — deliberately: the default photoreal stack hides the Cesium globe
 * (`globe.show = false`), so a `viewer.imageryLayers` drape would be
 * invisible on the app's default view. A rectangle entity renders on every
 * stack, and a few km of altitude is semantically honest for a column-max
 * reflectivity product.
 *
 * Freshness: the proxy flags frames older than 20 min as `stale`; that state
 * is surfaced via getStats() so the panel never presents an old frame as
 * current (CLAUDE.md rule 2 — data state must be visible).
 *
 * Animation: the proxy serves the last ~30 min as immutable per-ISO frames;
 * while the layer is enabled, `createRadarFrameAnimator` loops them (hold on
 * the newest), each swap requesting exactly one governor frame.
 *
 * WHY PRIMITIVES, NOT A SWAPPED ENTITY MATERIAL: assigning a new material to
 * an entity rebuilds its appearance and re-uploads the 2270×1560 texture on
 * EVERY swap — the material renders its default WHITE until the texture
 * lands, which at a 750 ms cadence turns the drape into a solid white sheet
 * on slower GL stacks. One hidden Primitive per frame keeps every texture
 * resident; the loop just flips `show`, which costs nothing and can never
 * flash white. The 5-minute refresh reuses 6 of 7 primitives (only the new
 * slot uploads), and a removed slot's primitive is destroyed with its texture.
 */

const META_URL = '/api/shmu/radar';
/** Drape altitude above the ellipsoid; clears terrain and city meshes. */
export const SHMU_RADAR_DRAPE_HEIGHT_M = 4000;
export const SHMU_RADAR_LAYER_ID = 'shmu-radar';
/** Animation cadence: per-frame step, and how long the newest frame holds. */
export const SHMU_RADAR_FRAME_STEP_MS = 750;
export const SHMU_RADAR_LATEST_HOLD_MS = 2500;

/**
 * Frame-loop driver, timers injected so tests run it synchronously. Plays
 * 0…N-1 with `stepMs` between frames and `holdMs` on the newest one, calling
 * `onShowFrame(index)` for each. With ≤1 frame it does nothing — a single
 * image must not flicker or hold a timer.
 * @param {object} input
 * @param {() => number} input.getFrameCount
 * @param {(index: number) => void} input.onShowFrame
 * @param {number} [input.stepMs]
 * @param {number} [input.holdMs]
 * @param {Function} [input.schedule] setTimeout-compatible.
 * @param {Function} [input.cancel] clearTimeout-compatible.
 * @returns {{start: Function, stop: Function, running: () => boolean}}
 */
export function createRadarFrameAnimator({
  getFrameCount,
  onShowFrame,
  stepMs = SHMU_RADAR_FRAME_STEP_MS,
  holdMs = SHMU_RADAR_LATEST_HOLD_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (handle) => clearTimeout(handle),
} = {}) {
  let timer = null;
  let index = 0;

  const tick = () => {
    timer = null;
    const count = getFrameCount();
    if (count <= 1) {
      if (count === 1) onShowFrame(0);
      // Re-arm lazily: a later meta refresh may grow the ring.
      timer = schedule(tick, holdMs);
      return;
    }
    if (index >= count) index = 0;
    onShowFrame(index);
    const atLatest = index === count - 1;
    index = atLatest ? 0 : index + 1;
    timer = schedule(tick, atLatest ? holdMs : stepMs);
  };

  return {
    start() {
      if (timer !== null) return;
      index = 0;
      tick();
    },
    stop() {
      if (timer !== null) cancel(timer);
      timer = null;
    },
    running: () => timer !== null,
  };
}

/**
 * One frame's drape primitive: a surface-parallel rectangle at the drape
 * altitude with the frame's DECODED image element as its (translucent)
 * material. The element — never the URL — goes into the Material: a URL makes
 * Cesium re-fetch the PNG on its own, and any transient failure of that second
 * fetch (dev-server 504, network blip) yields a 0×0 texture whose creation
 * throws inside the render loop and stops rendering permanently. An
 * HTMLImageElement is uploaded as-is; no fetch can fail. Injectable so
 * DOM-less tests substitute a stub instead of touching GL-adjacent paths.
 * @param {{rectangle: Cesium.Rectangle, image: HTMLImageElement}} input
 * @returns {Cesium.Primitive}
 */
export function createRadarFramePrimitive({ rectangle, image }) {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.RectangleGeometry({
        rectangle,
        height: SHMU_RADAR_DRAPE_HEIGHT_M,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
      }),
    }),
    appearance: new Cesium.EllipsoidSurfaceAppearance({
      material: Cesium.Material.fromType('Image', { image }),
    }),
    asynchronous: false,
    show: false,
  });
}

/**
 * Resolve with the frame's image element once it is truly usable (loaded AND
 * decoded, width>0), or null if it cannot load. The element is what the
 * primitive's Material consumes — see createRadarFramePrimitive for why a URL
 * must never reach the Material. A frame that fails to preload is skipped
 * this round and retried on the next poll.
 * @param {string} url
 * @returns {Promise<HTMLImageElement|null>}
 */
function preloadFrameImage(url) {
  return new Promise((resolve) => {
    // DOM-less tests: a truthy sentinel stands in for the element.
    if (typeof Image === 'undefined') { resolve({ testImage: url }); return; }
    const img = new Image();
    img.onload = () => {
      const decoded = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
      decoded.then(() => resolve(img.naturalWidth > 0 ? img : null));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function createShmuRadarLayer({ fetchImpl = null, primitiveFactory = createRadarFramePrimitive } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  let _viewer = null;
  let _enabled = false;
  let _iso = null;
  let _product = null;
  let _stale = false;
  let _echoPixels = 0;
  let _lastUpdate = null;
  let _lastError = null;
  /** Animation ring mirrors the proxy's `frames` (oldest→newest). */
  let _frameIsos = [];
  /** @type {Map<string, object>} iso → primitive (texture stays resident). */
  let _primitives = new Map();
  let _currentIso = null;

  const setFrameVisible = (iso, visible) => {
    const primitive = iso ? _primitives.get(iso) : null;
    if (primitive) primitive.show = visible;
  };

  const showFrame = (index) => {
    const iso = _frameIsos[index];
    if (!iso || iso === _currentIso) return;
    setFrameVisible(_currentIso, false);
    setFrameVisible(iso, _enabled);
    _currentIso = iso;
    // Discrete scene mutation under the render governor contract — one frame.
    governorRequestRender('shmu-radar');
  };

  const animator = createRadarFrameAnimator({
    getFrameCount: () => _frameIsos.length,
    onShowFrame: showFrame,
  });

  const layer = {
    id: SHMU_RADAR_LAYER_ID,
    name: 'Zrážkový radar (SHMÚ)',
    // Monochromatický glyf v štýle ostatných vrstiev (▣/▰/▲) — žiadne emoji,
    // nech panel drží jednotný HUD vzhľad.
    icon: '▧',
    // Live label: once a frame lands, the row says WHICH product and WHEN —
    // a radar image without its valid time is not an observation.
    get source() {
      return _iso
        ? `SHMÚ ${_product || 'radar'} · ${_iso.slice(11, 16)} UTC (CC BY 4.0)`
        : 'SHMÚ — opendata.shmu.sk (CC BY 4.0)';
    },
    updateInterval: 5 * 60 * 1000, // matches the upstream product cadence

    init(viewer) {
      _viewer = viewer;
      _enabled = false;
      _iso = null;
      _product = null;
      _stale = false;
      _echoPixels = 0;
      _lastUpdate = null;
      _lastError = null;
      _frameIsos = [];
      _primitives = new Map();
      _currentIso = null;
      console.log('[Data:ShmuRadar] Initialized');
    },

    enable() {
      _enabled = true;
      // The loop starts at the oldest frame right away — the last ~30 min
      // replay is the whole point of enabling a radar.
      _currentIso = null;
      animator.start();
    },

    disable() {
      _enabled = false;
      animator.stop();
      setFrameVisible(_currentIso, false);
      governorRequestRender('shmu-radar');
    },

    async update() {
      try {
        const response = await doFetch(META_URL);
        if (!response.ok) {
          _lastError = `SHMÚ proxy HTTP ${response.status}`;
          return false;
        }
        const meta = await response.json();
        if (!meta?.ok || !meta.bounds || !meta.png || !meta.iso) {
          _lastError = 'Malformed radar metadata';
          return false;
        }

        const { west, south, east, north } = meta.bounds;
        if (![west, south, east, north].every(Number.isFinite) || !(west < east && south < north)) {
          _lastError = 'Malformed radar bounds';
          return false;
        }

        // Animation ring from the proxy; a ring-less meta (older server)
        // degrades to a single-frame "loop".
        const metaFrames = Array.isArray(meta.frames) && meta.frames.length
          ? meta.frames.filter((f) => f?.iso && f?.png)
          : [{ iso: meta.iso, png: meta.png }];
        const nextIsos = metaFrames.map((f) => f.iso);
        if (nextIsos.join('|') !== _frameIsos.join('|')) {
          const rectangle = Cesium.Rectangle.fromDegrees(west, south, east, north);
          const next = new Set(nextIsos);
          // Slots that fell out of the ring: destroy primitive + texture.
          for (const [iso, primitive] of _primitives) {
            if (next.has(iso)) continue;
            if (iso === _currentIso) _currentIso = null;
            primitive.show = false;
            _viewer?.scene?.primitives?.remove?.(primitive);
            _primitives.delete(iso);
          }
          // New slots: preload+decode FIRST, then a hidden primitive. The ring
          // (and the animator's world) only ever contains proven-good frames.
          const ready = [];
          for (const frame of metaFrames) {
            if (_primitives.has(frame.iso)) {
              ready.push(frame.iso);
              continue;
            }
            const image = await preloadFrameImage(frame.png);
            if (image) {
              const primitive = primitiveFactory({ rectangle, image });
              _primitives.set(frame.iso, primitive);
              _viewer?.scene?.primitives?.add?.(primitive);
              ready.push(frame.iso);
            } else {
              console.warn(`[Data:ShmuRadar] frame ${frame.iso} failed to preload — skipped this round`);
            }
          }
          _frameIsos = ready;
          // …and the visible frame stays valid even after pruning.
          if (_enabled && !_currentIso) showFrame(_frameIsos.length - 1);
          governorRequestRender('shmu-radar');
        }
        _iso = meta.iso;

        _echoPixels = Number.isFinite(meta.echoPixels) ? meta.echoPixels : 0;
        _product = typeof meta.product === 'string' ? meta.product : null;
        // Freshness = the PRODUCT's valid time, not our fetch time — the
        // panel's age readout then reports how old the weather is, which is
        // the only age an operator cares about.
        const productMs = Date.parse(meta.iso);
        _lastUpdate = Number.isFinite(productMs) ? productMs : Date.now();
        // Served-but-old is a first-class feed state (`stale`), not an error:
        // layerFeedState() maps it to the STALE chip while transport errors
        // keep their own channel.
        _stale = meta.stale === true;
        _lastError = null;
        console.log(`[Data:ShmuRadar] Updated: ${meta.iso}, ${_echoPixels} echo px${_stale ? ' (STALE)' : ''}`);
        return true;
      } catch (e) {
        console.warn('[Data:ShmuRadar] Fetch error:', e);
        _lastError = 'SHMÚ radar network error';
        return false;
      }
    },

    destroy(viewer) {
      _enabled = false;
      animator.stop();
      for (const primitive of _primitives.values()) {
        (viewer || _viewer)?.scene?.primitives?.remove?.(primitive);
      }
      _primitives = new Map();
      _frameIsos = [];
      _currentIso = null;
      _viewer = null;
      _iso = null;
      _product = null;
      _stale = false;
      _echoPixels = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getStats() {
      return {
        count: _echoPixels,
        lastUpdate: _lastUpdate,
        error: _lastError,
        stale: _stale,
      };
    },
  };
  return layer;
}

const shmuRadarLayer = createShmuRadarLayer();

export default shmuRadarLayer;
