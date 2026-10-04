/**
 * @module trailRenderer
 * @description Shared track-history renderer (PRD WS-F F4; rebuilt round 6,
 * 2026-07-06).
 *
 * One trail = one ENTITY polyline. Round 6 replaced the faded per-vertex
 * Primitive for two product invariants from the field:
 *  - "the line must ALWAYS be visible": the Primitive's depthFailAppearance
 *    did not reliably render segments below the photoreal mesh — entity
 *    polylines with `depthFailMaterial` DO (in-repo proof: CCTV's frustum
 *    wireframes read through geometry with exactly this), so occluded
 *    segments now draw dimmed instead of vanishing.
 *  - "show actual tracks, don't style them too much": the tail-fade is gone;
 *    the whole history renders at one readable alpha (dimmer where it passes
 *    behind/below geometry).
 *
 * Trails update at poll cadence (~15-60 s) plus once on history backfill, so
 * assigning a fresh positions array per update is cheap. `allowPicking` has
 * no entity equivalent; the polyline entity is excluded from clicks by never
 * carrying a pick id the layers' click handlers resolve.
 */
import * as Cesium from 'cesium';
import { registerPickOwner } from './pickRegistry.js';
import { altitudeBand, bandRgb, smoothTrail, splitByBand } from './trailStyle.js';

// Round 6: trail ENTITIES are pickable (the old Primitive had
// allowPicking:false). A trail hugs its aircraft, so an unclaimed pick would
// read as "empty space" in every layer's click handler and deselect the very
// plane being tracked. Claiming the 'gev-trail:' id namespace makes
// isOwnedByOtherLayer() true for every layer — clicking a trail is a no-op
// everywhere. Registered once at module load; the predicate is pure.
registerPickOwner('trails', (pickedId) => String(pickedId).startsWith('gev-trail:'));

/** @type {number} Uniquifier for trail entity ids (Cesium requires unique entity ids). */
let _trailSeq = 0;

/** @constant {number} Alpha where the trail passes the depth test. */
const TRAIL_ALPHA = 0.85;
/** @constant {number} Alpha where the trail is behind/below scene geometry —
 *  still visible, but readable as occluded. */
const TRAIL_OCCLUDED_ALPHA = 0.4;
/** @constant {number} Squared distance (m^2) below which consecutive points are merged. */
const MIN_SEGMENT_DISTANCE_SQ = 0.01;

/**
 * Create an always-visible polyline trail bound to a viewer.
 * @param {Cesium.Viewer} viewer - Viewer whose entity collection owns the trail.
 * @param {object} options - Trail options.
 * @param {string} options.color - CSS color string for the trail hue.
 * @param {number} [options.width=1.3] - Polyline width in pixels.
 * @param {boolean} [options.altitudeColors=false] - Lietadlá (2026-10-04): farba podľa výšky —
 *   čiara sa delí na úseky výškových pásiem (trailStyle.js), každý úsek je vlastná entita
 *   s depthFailMaterial, takže pravidlo „vždy viditeľná" platí ďalej. `color` sa vtedy nepoužije.
 * @param {boolean} [options.smooth=false] - Zaoblené zákruty (centripetálny Catmull-Rom cez body).
 * @returns {{setPositions: function(Cesium.Cartesian3[]): void, setVisible: function(boolean): void, clear: function(): void, destroy: function(): void}}
 *   Trail handle: setPositions replaces the geometry, setVisible temporarily
 *   hides it without discarding history, clear empties it, and destroy removes
 *   the entity permanently.
 */
export function createTrail(viewer, { color, width = 1.3, altitudeColors = false, smooth = false }) {
  if (altitudeColors) return createAltitudeTrail(viewer, { width, smooth });
  const baseColor = Cesium.Color.fromCssColorString(color);
  /** @type {Cesium.Cartesian3[]} Current deduped positions (owned copy). */
  let current = [];
  let destroyed = false;
  let visible = true;
  /** @type {Cesium.Entity|null} */
  let entity = null;

  function ensureEntity() {
    if (entity || destroyed || !viewer || viewer.isDestroyed()) return;
    entity = viewer.entities.add({
      id: `gev-trail:${++_trailSeq}`,
      show: visible,
      polyline: {
        // CallbackProperty so a positions swap never rebuilds the entity —
        // Cesium re-reads on change; `false` marks it non-constant.
        positions: new Cesium.CallbackProperty(() => current, false),
        width,
        material: baseColor.withAlpha(TRAIL_ALPHA),
        // The locked rule (round 6): a segment below the photoreal
        // mesh renders dimmed — it must never disappear into the ground.
        depthFailMaterial: baseColor.withAlpha(TRAIL_OCCLUDED_ALPHA),
        // Round 8: NONE draws straight 3D chords between waypoints — over a
        // sparse trans-oceanic trace a single segment spans hundreds of km
        // and tunnels through the planet. GEODESIC subdivides each segment
        // along the curved surface (heights interpolated), so long legs hug
        // the globe instead of chording through it.
        arcType: Cesium.ArcType.GEODESIC,
      },
    });
  }

  return {
    /**
     * Replace the trail geometry with a chronological position list
     * (oldest first). Fewer than 2 distinct positions clears the trail.
     * @param {Cesium.Cartesian3[]} cartesians - Positions, oldest -> newest.
     */
    setPositions(cartesians) {
      if (destroyed || !viewer || viewer.isDestroyed()) return;
      // Drop consecutive near-duplicates: zero-length segments add nothing.
      const positions = [];
      for (const position of Array.isArray(cartesians) ? cartesians : []) {
        if (!position) continue;
        const last = positions[positions.length - 1];
        if (last && Cesium.Cartesian3.distanceSquared(last, position) < MIN_SEGMENT_DISTANCE_SQ) continue;
        positions.push(position);
      }
      current = positions.length >= 2 ? positions : [];
      ensureEntity();
    },

    /** Temporarily hide/show the trail without discarding accumulated history. */
    setVisible(nextVisible) {
      visible = nextVisible !== false;
      if (entity) entity.show = visible;
    },

    /** Empty the trail without removing the entity (cheap re-arm). */
    clear() {
      current = [];
    },

    /** Remove the trail entity permanently (layer disable/teardown). */
    destroy() {
      destroyed = true;
      current = [];
      if (entity && viewer && !viewer.isDestroyed()) {
        try { viewer.entities.remove(entity); } catch { /* torn down */ }
      }
      entity = null;
    },
  };
}

/**
 * Trajektória lietadla farbená podľa výšky (2026-10-04). Pool entít — jedna na úsek výškového
 * pásma; prebytočné sa skryjú, nemažú (ďalšia poloha ich zvyčajne znova použije). Prepočet beží
 * len pri setPositions (nová poloha z dotazu / doplnenie histórie), nikdy pri každom snímku.
 */
function createAltitudeTrail(viewer, { width, smooth }) {
  const seq = ++_trailSeq;
  /** @type {Cesium.Entity[]} */
  const pool = [];
  let used = 0;
  let destroyed = false;
  let visible = true;
  const scratchCarto = new Cesium.Cartographic();

  function entityAt(i) {
    if (pool[i]) return pool[i];
    const entity = viewer.entities.add({
      id: i === 0 ? `gev-trail:${seq}` : `gev-trail:${seq}:${i}`,
      show: false,
      polyline: { positions: [], width, arcType: Cesium.ArcType.GEODESIC },
    });
    pool[i] = entity;
    return entity;
  }

  function hideFrom(index) {
    for (let i = index; i < pool.length; i += 1) pool[i].show = false;
  }

  /** Jedna časť čiary (plná alebo čiarkovaná) → úseky pásiem od indexu `next` v poole. */
  function drawPart(points, dashed, next) {
    if (points.length < 2) return next;
    const positions = smooth
      ? smoothTrail(points).map((p) => (p instanceof Cesium.Cartesian3 ? p : new Cesium.Cartesian3(p.x, p.y, p.z)))
      : points;
    const bands = positions.map((p) => {
      const carto = Cesium.Cartographic.fromCartesian(p, Cesium.Ellipsoid.WGS84, scratchCarto);
      return altitudeBand(carto ? carto.height : 0);
    });
    for (const run of splitByBand(bands)) {
      const entity = entityAt(next);
      next += 1;
      const [r, g, b] = bandRgb(run.band);
      const color = new Cesium.Color(r, g, b, TRAIL_ALPHA);
      const dim = new Cesium.Color(r, g, b, TRAIL_OCCLUDED_ALPHA);
      entity.polyline.positions = positions.slice(run.start, run.end + 1);
      // Odhad bez signálu (2026-10-04) čiarkovane — nie je to nameraná trasa.
      entity.polyline.material = dashed ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 14 }) : color;
      // Pravidlo z kola 6: úsek pod fotoreálnym mestom sa kreslí stlmene, nikdy nezmizne.
      entity.polyline.depthFailMaterial = dashed ? new Cesium.PolylineDashMaterialProperty({ color: dim, dashLength: 14 }) : dim;
      entity.show = visible;
    }
    return next;
  }

  return {
    /**
     * @param {Cesium.Cartesian3[]} cartesians
     * @param {{dashed?: [number, number|null]|null}} [options] čiarkovaný úsek (indexy vo vstupe,
     *   koniec null = po koniec) — odhadovaná poloha bez signálu.
     */
    setPositions(cartesians, { dashed = null } = {}) {
      if (destroyed || !viewer || viewer.isDestroyed()) return;
      const input = Array.isArray(cartesians) ? cartesians : [];
      // Bez dvojbodov, ale s pamäťou pôvodného indexu (čiarkovaný úsek je v pôvodných indexoch).
      const positions = [];
      const origin = [];
      input.forEach((position, index) => {
        if (!position) return;
        const last = positions[positions.length - 1];
        if (last && Cesium.Cartesian3.distanceSquared(last, position) < MIN_SEGMENT_DISTANCE_SQ) return;
        positions.push(position);
        origin.push(index);
      });
      if (positions.length < 2) {
        used = 0;
        hideFrom(0);
        return;
      }
      let next = 0;
      const from = Array.isArray(dashed) && Number.isFinite(dashed[0]) ? origin.findIndex((o) => o >= dashed[0]) : -1;
      if (from < 0) {
        next = drawPart(positions, false, next);
      } else {
        const toOrig = dashed[1];
        let to = positions.length - 1;
        if (Number.isFinite(toOrig)) {
          for (let i = origin.length - 1; i >= 0; i -= 1) if (origin[i] <= toOrig) { to = i; break; }
        }
        to = Math.max(from, to);
        next = drawPart(positions.slice(0, from + 1), false, next);
        next = drawPart(positions.slice(from, to + 1), true, next);
        next = drawPart(positions.slice(to), false, next);
      }
      used = next;
      hideFrom(used);
    },

    setVisible(nextVisible) {
      visible = nextVisible !== false;
      for (let i = 0; i < used; i += 1) pool[i].show = visible;
    },

    clear() {
      used = 0;
      hideFrom(0);
    },

    destroy() {
      destroyed = true;
      if (viewer && !viewer.isDestroyed()) {
        for (const entity of pool) {
          try { viewer.entities.remove(entity); } catch { /* torn down */ }
        }
      }
      pool.length = 0;
      used = 0;
    },
  };
}
