// src/data/screenPatternMaterials.js
/**
 * @module screenPatternMaterials
 * @description Vzory v OBRAZOVKOVÝCH pixeloch pre pozemné polygóny (KARTA K3,
 * 2026-09-20): šrafovanie 45° cez gl_FragCoord, takže hustota čiar nezávisí
 * od priblíženia (ako šrafovanie „územia bojov" v schválenej vzorke). Fabric
 * materiál sa registruje raz do cache Cesia; entity ho dostanú cez
 * HatchMaterialProperty (vzor ColorMaterialProperty: getType/getValue).
 * V Node bez DOM `Material.fromType` padá — registrácia je bez GL v poriadku,
 * vrstvy dávajú fallback na farbu, keď cache chýba.
 */
import * as Cesium from 'cesium';

export const HATCH_MATERIAL_TYPE = 'OkoHatch45';
/** Opačný smer (135°) — oslobodené územia, aby sa nepletli so šedou zónou (45°). */
export const HATCH_MATERIAL_TYPE_135 = 'OkoHatch135';
/** Rozstup čiar (px) a hrúbka ako podiel medzery (0..1). */
export const HATCH_DEFAULTS = Object.freeze({ spacingPx: 9, thickness: 0.22 });

/** Fabric šrafy s daným výrazom smeru (napr. `gl_FragCoord.x - gl_FragCoord.y` = 135°). */
function hatchFabric(CesiumRef, type, axis) {
  return {
    fabric: {
      type,
      uniforms: {
        lineColor: new CesiumRef.Color(0.72, 0.7, 0.67, 0.55),
        fillColor: new CesiumRef.Color(0.72, 0.7, 0.67, 0.1),
        spacing: HATCH_DEFAULTS.spacingPx,
        thickness: HATCH_DEFAULTS.thickness,
      },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  float t = fract((${axis}) / spacing);
  float d = min(t, 1.0 - t) * 2.0;
  float line = 1.0 - smoothstep(thickness, thickness + 0.25, d);
  m.diffuse = mix(fillColor.rgb, lineColor.rgb, line);
  m.alpha = mix(fillColor.a, lineColor.a, line);
  return m;
}`,
    },
    translucent: true,
  };
}

/** Zaregistruje oba šrafovacie materiály (raz na proces). Vracia false bez cache materiálov. */
export function ensureHatchMaterial(CesiumRef = Cesium) {
  const cache = CesiumRef?.Material?._materialCache;
  if (!cache?.addMaterial) return false;
  if (!cache.getMaterial?.(HATCH_MATERIAL_TYPE)) cache.addMaterial(HATCH_MATERIAL_TYPE, hatchFabric(CesiumRef, HATCH_MATERIAL_TYPE, 'gl_FragCoord.x + gl_FragCoord.y'));
  if (!cache.getMaterial?.(HATCH_MATERIAL_TYPE_135)) cache.addMaterial(HATCH_MATERIAL_TYPE_135, hatchFabric(CesiumRef, HATCH_MATERIAL_TYPE_135, 'gl_FragCoord.x - gl_FragCoord.y'));
  return true;
}

/** MaterialProperty pre entity: šrafovanie 45° (`direction` −1 = 135°) danou farbou (čiary + slabá výplň). */
export class HatchMaterialProperty {
  /**
   * @param {object} [o]
   * @param {Cesium.Color} [o.lineColor]
   * @param {Cesium.Color} [o.fillColor]
   * @param {number} [o.spacing] px
   * @param {number} [o.thickness] 0..1
   * @param {number} [o.direction] 1 = 45°, −1 = 135°
   */
  constructor({ lineColor = null, fillColor = null, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness, direction = 1 } = {}) {
    this._type = direction < 0 ? HATCH_MATERIAL_TYPE_135 : HATCH_MATERIAL_TYPE;
    this._uniforms = {
      lineColor: lineColor || new Cesium.Color(0.72, 0.7, 0.67, 0.55),
      fillColor: fillColor || new Cesium.Color(0.72, 0.7, 0.67, 0.1),
      spacing,
      thickness,
    };
    this._definitionChanged = new Cesium.Event();
  }
  get isConstant() { return true; }
  get definitionChanged() { return this._definitionChanged; }
  getType() { return this._type; }
  getValue(time, result) { const r = result || {}; Object.assign(r, this._uniforms); return r; }
  /**
   * Hodnotová rovnosť (typ + uniformy): Cesium zlúči plochy s rovnakou šrafou do
   * jednej dávky (StaticGroundGeometryPerMaterialBatch pýta `equals`) — pri
   * identite by každý polygón bol vlastný GroundPrimitive.
   */
  equals(other) {
    if (other === this) return true;
    if (!(other instanceof HatchMaterialProperty) || other._type !== this._type) return false;
    const a = this._uniforms; const b = other._uniforms;
    return Cesium.Color.equals(a.lineColor, b.lineColor) && Cesium.Color.equals(a.fillColor, b.fillColor) && a.spacing === b.spacing && a.thickness === b.thickness;
  }
}

/** Šrafovací materiál z CSS farby (čiary alfa `lineAlpha`, výplň `fillAlpha`); bez cache = null. */
export function hatchMaterialFor(css, { lineAlpha = 0.55, fillAlpha = 0.1, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness, direction = 1 } = {}) {
  if (!ensureHatchMaterial(Cesium)) return null;
  const base = Cesium.Color.fromCssColorString(css);
  return new HatchMaterialProperty({ lineColor: base.withAlpha(lineAlpha), fillColor: base.withAlpha(fillAlpha), spacing, thickness, direction });
}
