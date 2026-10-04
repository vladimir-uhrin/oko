// src/flightReplay.js
/**
 * @module flightReplay
 * @description Prehrávanie historického letu na glóbuse (2026-09-07):
 * trasa ako čiara zafarbená podľa výšky (od 2026-10-04 tá istá stupnica ako živá
 * trajektória: pri zemi oranžovo-červená → žltá → zelená → modrá → fialová), značka lietadla (rovnaká silueta a orientácia
 * ako živá flotila — iconOrientation.js) a hodiny prehrávania s rýchlosťou
 * 1×–300×. Jeden prehrávač na scénu; `load()` nahradí predošlý let.
 *
 * Cesium objekty sa stavajú cez injektovateľné továrne, nech sa logika
 * (čas, rýchlosť, koniec, follow) testuje v Node bez WebGL.
 */
import * as Cesium from 'cesium';
import { bridgeCoverageGaps, interpolateFix } from './data/flightHistory.js';
import { aircraftIcon } from './data/aircraftIcons.js';
import { screenProjectedRotation, stabilizeScreenRotation } from './data/iconOrientation.js';
import { trailAltitudeRgb } from './data/trailStyle.js';

export const REPLAY_SPEEDS = Object.freeze([1, 10, 60, 300]);
export const REPLAY_TRACK_WIDTH_PX = 3;
/**
 * RGB 0..1 pre výšku (m). Pure. 2026-10-04 (vlastník: „zjednotiť"): tá istá stupnica ako živá
 * trajektória sledovaného lietadla (data/trailStyle.js) — História letov aj video udalosti
 * (eventVideoCapture.js) tak čítajú výšku rovnakými farbami ako glóbus.
 */
export function altitudeRgb(altM) {
  return trailAltitudeRgb(altM);
}

/**
 * Stav prehrávača — čistá časť (hodiny, rýchlosť, koniec). Pure trieda.
 */
export class ReplayClock {
  constructor(startT, endT) {
    this.startT = startT;
    this.endT = endT;
    this.t = startT;
    this.speed = REPLAY_SPEEDS[1];
    this.playing = false;
  }

  /** Posuň o reálny čas dtMs; na konci zastaví. Vracia true, ak sa čas zmenil. */
  advance(dtMs) {
    if (!this.playing || !Number.isFinite(dtMs) || dtMs <= 0) return false;
    const next = Math.min(this.endT, this.t + (dtMs / 1000) * this.speed);
    const changed = next !== this.t;
    this.t = next;
    if (next >= this.endT) this.playing = false;
    return changed;
  }

  seek(tS) {
    this.t = Math.max(this.startT, Math.min(this.endT, Number(tS)));
  }

  seekFraction(f) {
    this.seek(this.startT + (this.endT - this.startT) * Math.max(0, Math.min(1, Number(f) || 0)));
  }

  get fraction() {
    const span = this.endT - this.startT;
    return span > 0 ? (this.t - this.startT) / span : 1;
  }

  play() {
    if (this.t >= this.endT) this.t = this.startT; // replay from start at the end
    this.playing = true;
  }

  pause() { this.playing = false; }

  setSpeed(x) {
    if (REPLAY_SPEEDS.includes(x)) this.speed = x;
  }
}

/**
 * Rozdeľ trasu na súvislé behy skutočných polôh a odhadu (bridgeCoverageGaps) — úsek medzi dvoma
 * polohami je odhad, keď je odhadom aspoň jeden jeho koniec; susedné behy zdieľajú koncový bod,
 * aby čiara nemala medzeru. Pure.
 * @returns {{estimated: boolean, fixes: object[]}[]}
 */
export function splitTrackRuns(fixes) {
  const runs = [];
  for (let i = 1; i < (fixes?.length ?? 0); i += 1) {
    const estimated = Boolean(fixes[i - 1].estimated || fixes[i].estimated);
    const last = runs[runs.length - 1];
    if (last && last.estimated === estimated) last.fixes.push(fixes[i]);
    else runs.push({ estimated, fixes: [fixes[i - 1], fixes[i]] });
  }
  return runs;
}

const positionsOf = (run) => run.fixes.map((f) => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(0, f.alt ?? 0)));

function defaultTrackFactory(fixes) {
  const runs = splitTrackRuns(fixes);
  if (!runs.length) return null;
  const collection = new Cesium.PrimitiveCollection();
  // Skutočné polohy: plná čiara zafarbená podľa výšky.
  const solid = runs.filter((r) => !r.estimated).map((run) => new Cesium.GeometryInstance({
    geometry: new Cesium.PolylineGeometry({
      positions: positionsOf(run),
      colors: run.fixes.map((f) => { const [r, g, b] = altitudeRgb(f.alt ?? 0); return new Cesium.Color(r, g, b, 0.95); }),
      colorsPerVertex: true,
      width: REPLAY_TRACK_WIDTH_PX,
      arcType: Cesium.ArcType.NONE,
    }),
  }));
  if (solid.length) {
    collection.add(new Cesium.Primitive({
      geometryInstances: solid,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      asynchronous: false,
    }));
  }
  // Odhad cez dieru v pokrytí (oceán): čiarkovane, bledo — nie je to nameraná trasa.
  const dashed = runs.filter((r) => r.estimated).map((run) => new Cesium.GeometryInstance({
    geometry: new Cesium.PolylineGeometry({
      positions: positionsOf(run),
      width: REPLAY_TRACK_WIDTH_PX - 1,
      vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
      arcType: Cesium.ArcType.NONE,
    }),
  }));
  if (dashed.length) {
    collection.add(new Cesium.Primitive({
      geometryInstances: dashed,
      appearance: new Cesium.PolylineMaterialAppearance({
        material: Cesium.Material.fromType('PolylineDash', { color: new Cesium.Color(0.86, 0.93, 1.0, 0.75), dashLength: 14 }),
      }),
      asynchronous: false,
    }));
  }
  return collection;
}

/**
 * @param {object} viewer Cesium Viewer
 * @param {object} [deps]
 * @param {Function} [deps.trackFactory] (fixes) → Primitive|null
 * @param {Function} [deps.requestFrame] rAF náhrada (test)
 * @param {Function} [deps.cancelFrame]
 * @param {Function} [deps.now] ms
 */
export function createFlightReplay(viewer, {
  trackFactory = defaultTrackFactory,
  requestFrame = (cb) => globalThis.requestAnimationFrame?.(cb),
  cancelFrame = (id) => globalThis.cancelAnimationFrame?.(id),
  now = () => performance.now(),
} = {}) {
  let fixes = [];
  let estimatedGaps = 0;
  let clock = null;
  let trackPrimitive = null;
  let marker = null;
  let follow = false;
  let frameId = null;
  let lastFrameMs = 0;
  let lastRotation = null;
  const listeners = new Set();
  const scratchPos = new Cesium.Cartesian3();
  let currentPos = null;

  function positionAt(tS) {
    const p = interpolateFix(fixes, tS);
    if (!p) return null;
    return { p, cartesian: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(0, p.alt ?? 0), Cesium.Ellipsoid.WGS84, scratchPos) };
  }

  function emit() {
    const state = api.getState();
    for (const fn of listeners) { try { fn(state); } catch (error) { console.warn('[FlightReplay] listener', error); } }
  }

  function render() {
    viewer?.scene?.requestRender?.();
  }

  function stopLoop() {
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
  }

  function loop() {
    frameId = null;
    if (!clock?.playing) return;
    const nowMs = now();
    const dt = lastFrameMs ? nowMs - lastFrameMs : 0;
    lastFrameMs = nowMs;
    if (clock.advance(dt)) { render(); emit(); }
    if (clock.playing) frameId = requestFrame(loop);
  }

  function clear() {
    stopLoop();
    if (trackPrimitive) { viewer?.scene?.primitives?.remove?.(trackPrimitive); trackPrimitive = null; }
    if (marker) {
      if (viewer?.trackedEntity === marker) viewer.trackedEntity = undefined;
      viewer?.entities?.remove?.(marker);
      marker = null;
    }
    fixes = [];
    estimatedGaps = 0;
    clock = null;
    currentPos = null;
    lastRotation = null;
  }

  const api = {
    /**
     * Nahraj let. Vracia false pod 2 fixy.
     * @param {Array<object>} nextFixes chronologické fixy
     * @param {{kind?: string}} [options]
     */
    load(nextFixes, { kind = 'airliner' } = {}) {
      clear();
      if (!Array.isArray(nextFixes) || nextFixes.length < 2) return false;
      // Diery v pokrytí za letu (oceán) doplní odhad po veľkej kružnici — značka aj čiara idú po
      // nej, nie priamkou cez Zem; odhad sa kreslí čiarkovane a vzorka nesie `estimated`.
      const bridged = bridgeCoverageGaps(nextFixes);
      fixes = bridged.fixes;
      estimatedGaps = bridged.gaps;
      clock = new ReplayClock(fixes[0].t, fixes[fixes.length - 1].t);
      trackPrimitive = trackFactory(fixes);
      if (trackPrimitive) viewer?.scene?.primitives?.add?.(trackPrimitive);
      const image = aircraftIcon(kind, 64, false, 'cyan');
      marker = viewer?.entities?.add?.({
        id: `gev-replay:${fixes[0].t}`,
        position: new Cesium.CallbackProperty(() => currentPos, false),
        billboard: {
          image,
          width: 30,
          height: 30,
          alignedAxis: Cesium.Cartesian3.ZERO,
          rotation: new Cesium.CallbackProperty(() => {
            const p = currentPos && positionAt(clock.t)?.p;
            if (!p || !viewer?.scene) return lastRotation ?? 0;
            const next = screenProjectedRotation(viewer.scene, currentPos, p.trk ?? 0, lastRotation);
            lastRotation = stabilizeScreenRotation(lastRotation, next);
            return lastRotation ?? 0;
          }, false),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2e4, 1.4, 6e6, 0.6),
        },
      }) ?? null;
      api.seek(clock.startT);
      return true;
    },

    /** Nastav čas (epoch s) a prekresli značku. */
    seek(tS) {
      if (!clock) return;
      clock.seek(tS);
      const at = positionAt(clock.t);
      currentPos = at ? Cesium.Cartesian3.clone(at.cartesian) : null;
      render();
      emit();
    },

    seekFraction(f) {
      if (!clock) return;
      clock.seekFraction(f);
      api.seek(clock.t);
    },

    play() {
      if (!clock) return;
      clock.play();
      lastFrameMs = 0;
      stopLoop();
      frameId = requestFrame(loop);
      emit();
    },

    pause() {
      if (!clock) return;
      clock.pause();
      stopLoop();
      emit();
    },

    toggle() { if (clock?.playing) api.pause(); else api.play(); },

    setSpeed(x) { clock?.setSpeed(x); emit(); },

    /** Kamera sleduje značku (Cesium trackedEntity), inak voľná. */
    setFollow(on) {
      follow = on === true;
      if (!viewer || !marker) return;
      viewer.trackedEntity = follow ? marker : (viewer.trackedEntity === marker ? undefined : viewer.trackedEntity);
      render();
    },

    /** Zarámuj celú trasu. */
    frame(duration = 1.2) {
      if (!fixes.length || !viewer?.camera) return;
      const points = fixes.map((f) => Cesium.Cartesian3.fromDegrees(f.lon, f.lat, Math.max(0, f.alt ?? 0)));
      const sphere = Cesium.BoundingSphere.fromPoints(points);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration,
        offset: new Cesium.HeadingPitchRange(0, -Math.PI / 3, sphere.radius * 2.6 + 50_000),
      });
    },

    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Stav pre UI. */
    getState() {
      if (!clock) return { loaded: false, playing: false, t: null, fraction: 0, speed: REPLAY_SPEEDS[1], follow, sample: null };
      const at = positionAt(clock.t);
      return {
        loaded: true,
        playing: clock.playing,
        t: clock.t,
        startT: clock.startT,
        endT: clock.endT,
        fraction: clock.fraction,
        speed: clock.speed,
        follow,
        sample: at?.p ?? null,
        fixes: fixes.filter((f) => !f.estimated).length,
        estimatedGaps,
      };
    },

    /** Posuň hodiny manuálne o dt ms (test seam; produkcia ide cez rAF). */
    _advanceForTest(dtMs) {
      if (clock?.advance(dtMs)) { api.seek(clock.t); }
    },

    destroy() {
      clear();
      listeners.clear();
    },
  };
  return api;
}
