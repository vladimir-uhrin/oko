/**
 * Idle render governor — the wave-2 flagship of the 2026-08-05 perf
 * investigation and the production idle-render measurements.
 *
 * The problem: Cesium's default render loop repaints every vsync forever, so
 * the app burned ~60% GPU + ~54% of a core with ZERO layers enabled and a
 * parked camera. The fix: flip the scene into Cesium's `requestRenderMode`
 * whenever nothing animates per frame, and return to the continuous loop the
 * moment something does.
 *
 * Architecture — a binary mode driven by ref-counted holds:
 *
 * - **Continuous mode** (`requestRenderMode = false`, today's behavior)
 *   while ANY hold is registered. Every per-frame animator — fleet
 *   interpolation, traffic sim, satellite motion, tracked-entity follow,
 *   style crossfades, CCTV projection — registers a hold for exactly the
 *   lifetime of its scene-loop listener or animation. While one is active,
 *   behavior is byte-identical to pre-governor main: the locked
 *   interpolation/tracking invariants are preserved by construction.
 * - **Idle mode** (`requestRenderMode = true`) when zero holds. Cesium
 *   auto-renders on camera input and tile loads; every other scene mutation
 *   must call `governorRequestRender()` for its one frame. Discrete
 *   mutators (layer poll ticks, slider writes, annotation changes) route
 *   through that.
 *
 * Holds are identity-keyed (a Set of owner ids), NOT a counter — a module
 * that double-holds or double-releases cannot corrupt the mode. Owners are
 * short stable strings ('flights', 'traffic', 'style-anim', …) so the
 * diagnostics read like a story.
 *
 * The governor is O(1) passive: no per-frame work of its own, ever.
 */

let _viewer = null;
let _installed = false;
const _holds = new Set();

/**
 * Strážca dlaždíc glóbusu v nečinnom režime (2026-09-20, KARTA): po prepnutí
 * podkladu vykreslí governor jeden snímok, dlaždice terénu/podkladu sa zaradia
 * do fronty — a keď ich RequestScheduler odloží bez jedinej aktívnej požiadavky,
 * Cesium už ďalší snímok nevyžiada (fronta sa spracúva len v snímku). Namerané:
 * 121 s bez snímku, glóbus čierny, 40 ručných renderov ho hneď dotiahlo. Kým
 * je glóbus nenačítaný, pýtame snímok každých TILE_WATCH_MS; po dotiahnutí je
 * tick prázdny (jedna vlastnosť na 0,4 s).
 */
export const TILE_WATCH_MS = 400;
let _tileWatch = null;
// unref: v Node (testy) nesmie interval držať proces nažive; v prehliadači je id číslo bez unref.
const defaultTimers = () => ({ setInterval: (fn, ms) => { const id = setInterval(fn, ms); id?.unref?.(); return id; }, clearInterval: (id) => clearInterval(id) });
let _timers = defaultTimers();
/**
 * Dobeh po načítaní (2026-10-07): keď sa glóbus práve dotiahol (tilesLoaded false → true), ostával na
 * obrazovke posledný snímok SPRED dotiahnutia — čierny glóbus s hviezdami, kým sa nepohla kamera
 * (zmerané: tilesLoaded true, mapa Stadia pripravená, obraz čierny; jeden requestRender ju ukázal).
 * Po dotiahnutí sa preto vyžiadajú ešte TILE_SETTLE_FRAMES snímky.
 */
export const TILE_SETTLE_FRAMES = 2;
let _settleLeft = 0;
function tileWatchTick() {
  const scene = _viewer?.scene;
  if (!scene || !scene.requestRenderMode) return;
  const globe = scene.globe;
  if (!globe?.show) return;
  if (globe.tilesLoaded === false) {
    _settleLeft = TILE_SETTLE_FRAMES;
    scene.requestRender?.();
  } else if (_settleLeft > 0) {
    _settleLeft -= 1;
    scene.requestRender?.();
  }
}
function syncTileWatch(idle) {
  if (idle && !_tileWatch) _tileWatch = _timers.setInterval(tileWatchTick, TILE_WATCH_MS);
  else if (!idle && _tileWatch) { _timers.clearInterval(_tileWatch); _tileWatch = null; }
}

/** Debug trail of the most recent one-shot render requests (idle mode only). */
const _recentRequests = [];
const RECENT_REQUEST_CAP = 16;

function applyMode() {
  if (!_installed || !_viewer?.scene) return;
  const continuous = _holds.size > 0;
  const scene = _viewer.scene;
  if (scene.requestRenderMode === !continuous) return;
  scene.requestRenderMode = !continuous;
  if (!continuous) {
    // Entering idle: render one settling frame so anything the last
    // continuous frame mutated is on screen before the loop stops.
    scene.requestRender?.();
  }
  syncTileWatch(!continuous);
}

/**
 * Install the governor on the viewer. Idempotent. Before install,
 * hold/release still record into the holds set (and apply at install time);
 * requests are safe no-ops — so modules can call all three unconditionally
 * in tests without a viewer.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function installRenderGovernor(viewer, { timers = null } = {}) {
  if (!viewer?.scene) throw new TypeError('installRenderGovernor requires a Cesium viewer');
  _viewer = viewer;
  _installed = true;
  if (timers) _timers = timers;
  // Never let Cesium re-render on simulation-time deltas behind our back —
  // idle means idle. All re-renders are camera/tiles (Cesium-native) or
  // explicit requests.
  viewer.scene.maximumRenderTimeChange = Infinity;
  applyMode();
}

/**
 * Register a continuous-render hold. Idempotent per owner.
 * Call where the owner's per-frame work BEGINS (scene listener installed,
 * animation starts, tracking begins).
 * @param {string} ownerId Short stable id, e.g. 'flights', 'traffic'.
 * @returns {void}
 */
export function holdContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.add(ownerId);
  applyMode();
}

/**
 * Release a hold. Safe when never held.
 * Call where the owner's per-frame work ENDS (listener removed, animation
 * settled, tracking stopped, layer disabled).
 * @param {string} ownerId
 * @returns {void}
 */
export function releaseContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.delete(ownerId);
  applyMode();
}

/**
 * One-shot render request for a discrete scene mutation (layer tick, slider
 * write, annotation change). Always forwards to scene.requestRender() — in
 * continuous mode that is a harmless flag set (and forwarding closes the
 * request-then-last-release race); only idle-mode requests are recorded in
 * diagnostics. Cheap enough to call unconditionally after any mutation.
 * @param {string} [reason] For diagnostics only.
 * @returns {void}
 */
export function governorRequestRender(reason = 'unspecified') {
  if (!_installed || !_viewer?.scene) return;
  if (_holds.size === 0) {
    _recentRequests.push({ reason, at: Date.now() });
    if (_recentRequests.length > RECENT_REQUEST_CAP) _recentRequests.shift();
  }
  _viewer.scene.requestRender?.();
}

/**
 * @returns {{installed: boolean, mode: 'continuous'|'idle', holds: string[],
 *   recentRequests: Array<{reason: string, at: number}>}}
 */
export function getRenderGovernorDiagnostics() {
  return {
    installed: _installed,
    mode: _holds.size > 0 ? 'continuous' : 'idle',
    holds: [..._holds].sort(),
    recentRequests: [..._recentRequests],
  };
}

/** Test seam: reset module state between unit tests. */
export function _resetRenderGovernorForTest() {
  if (_tileWatch) { try { _timers.clearInterval(_tileWatch); } catch { /* */ } _tileWatch = null; }
  _timers = defaultTimers();
  _viewer = null;
  _installed = false;
  _holds.clear();
  _recentRequests.length = 0;
  _settleLeft = 0;
}
/** Test seam: je strážca dlaždíc aktívny? */
export function _isTileWatchArmedForTest() { return _tileWatch !== null; }
