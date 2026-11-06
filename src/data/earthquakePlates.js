import * as Cesium from 'cesium';

/**
 * Hranice litosférických platní (2026-11-06, vlastník: „sprav" — vysvetliť, prečo sa otrasy
 * zhlukujú práve tam). Čip „Platne" vo vrstve Zemetrasenia; dáta PB2002 (ODC-By 1.0, pôvod
 * v local_data/plates/SOURCE.md) sa dotiahnu dynamickým importom až pri prvom zapnutí.
 *
 * Kreslenie ako hranice štátov (countryBoundaries.js): GroundPolylinePrimitive na teréne aj na
 * 3D Tiles (ClassificationType.BOTH), farba v uniforme materiálu, geometria sa stavia raz a potom
 * sa len prepína `show`. Jemný štýl (vkus vlastníka: tenké čiary): oceľovo modrá, subdukčné
 * zóny svetlejšie a hrubšie — farebne sa nebijú s červenými a oranžovými ohniskami.
 */

export const PLATE_LINE = Object.freeze({ color: '#9fb3c8', alpha: 0.42, width: 2.0 });
export const PLATE_SUBDUCTION = Object.freeze({ color: '#d4e2f0', alpha: 0.68, width: 2.6 });

/** Dáta → dve skupiny čiar (subdukcia / ostatné), každá ako zoznam plochých súradníc. Pure. */
export function splitPlateLines(lines) {
  const out = { subduction: [], other: [] };
  for (const line of Array.isArray(lines) ? lines : []) {
    const c = line?.c;
    if (!Array.isArray(c) || c.length < 4 || c.length % 2) continue;
    (line.s === 1 ? out.subduction : out.other).push(c);
  }
  return out;
}

const loadDefault = () => import('./local_data/plates/pb2002Boundaries.js').then((m) => m.PB2002_BOUNDARIES);

/**
 * @param {object} viewer Cesium.Viewer
 * @param {object} [o]
 * @param {() => Promise<Array>} [o.load] dáta (test: podvrh)
 * @param {Function} [o.createPrimitive] test: podvrh primitíva
 */
export function createPlateBoundaries(viewer, { load = loadDefault, createPrimitive = null } = {}) {
  const scene = viewer?.scene;
  let primitives = null; let building = null; let visible = false; let destroyed = false;

  const makePrimitive = createPrimitive || (({ flats, style }) => new Cesium.GroundPolylinePrimitive({
    geometryInstances: flats.map((flat) => new Cesium.GeometryInstance({
      geometry: new Cesium.GroundPolylineGeometry({ positions: Cesium.Cartesian3.fromDegreesArray(flat), width: style.width }),
    })),
    classificationType: Cesium.ClassificationType.BOTH,
    appearance: new Cesium.PolylineMaterialAppearance({
      material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString(style.color).withAlpha(style.alpha) }),
      translucent: true,
    }),
    allowPicking: false,
    asynchronous: true,
  }));

  async function build() {
    if (primitives || !scene?.groundPrimitives) return primitives;
    if (!building) {
      building = (async () => {
        const groups = splitPlateLines(await load());
        if (destroyed) return null;
        const built = {
          other: groups.other.length ? makePrimitive({ flats: groups.other, style: PLATE_LINE }) : null,
          subduction: groups.subduction.length ? makePrimitive({ flats: groups.subduction, style: PLATE_SUBDUCTION }) : null,
        };
        for (const prim of Object.values(built)) {
          if (!prim) continue;
          prim.show = visible;
          scene.groundPrimitives.add(prim);
        }
        primitives = built;
        return built;
      })().catch((error) => { building = null; throw error; });
    }
    return building;
  }

  function apply() {
    for (const prim of Object.values(primitives || {})) if (prim) prim.show = visible;
    scene?.requestRender?.();
  }

  return {
    /** Zapni čiary (prvé zapnutie dotiahne dáta a postaví geometriu). */
    async show() {
      visible = true;
      try { await build(); } catch { return false; }
      if (destroyed) return false;
      apply();
      return Boolean(primitives);
    },
    hide() { visible = false; apply(); },
    get visible() { return visible; },
    get built() { return Boolean(primitives); },
    destroy() {
      destroyed = true; visible = false;
      for (const prim of Object.values(primitives || {})) {
        if (!prim) continue;
        try { scene?.groundPrimitives?.remove(prim); } catch { /* scéna už zničená */ }
      }
      primitives = null; building = null;
    },
  };
}
