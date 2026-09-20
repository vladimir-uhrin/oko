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
/** Rozstup čiar (px) a hrúbka ako podiel medzery (0..1). */
export const HATCH_DEFAULTS = Object.freeze({ spacingPx: 9, thickness: 0.22 });

/** Zaregistruje šrafovací materiál (raz na proces). Vracia false bez cache materiálov. */
export function ensureHatchMaterial(CesiumRef = Cesium) {
  const cache = CesiumRef?.Material?._materialCache;
  if (!cache?.addMaterial) return false;
  if (cache.getMaterial?.(HATCH_MATERIAL_TYPE)) return true;
  cache.addMaterial(HATCH_MATERIAL_TYPE, {
    fabric: {
      type: HATCH_MATERIAL_TYPE,
      uniforms: {
        lineColor: new CesiumRef.Color(0.72, 0.7, 0.67, 0.55),
        fillColor: new CesiumRef.Color(0.72, 0.7, 0.67, 0.1),
        spacing: HATCH_DEFAULTS.spacingPx,
        thickness: HATCH_DEFAULTS.thickness,
      },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  float t = fract((gl_FragCoord.x + gl_FragCoord.y) / spacing);
  float d = min(t, 1.0 - t) * 2.0;
  float line = 1.0 - smoothstep(thickness, thickness + 0.25, d);
  float a = mix(fillColor.a, lineColor.a, line);
  vec3 rgb = mix(fillColor.rgb, lineColor.rgb, line);
  m.diffuse = rgb;
  m.alpha = a;
  return m;
}`,
    },
    translucent: true,
  });
  return true;
}

/** MaterialProperty pre entity: 45° šrafovanie danou farbou (čiary + slabá výplň). */
export class HatchMaterialProperty {
  /**
   * @param {object} [o]
   * @param {Cesium.Color} [o.lineColor]
   * @param {Cesium.Color} [o.fillColor]
   * @param {number} [o.spacing] px
   * @param {number} [o.thickness] 0..1
   */
  constructor({ lineColor = null, fillColor = null, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness } = {}) {
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
  getType() { return HATCH_MATERIAL_TYPE; }
  getValue(time, result) { const r = result || {}; Object.assign(r, this._uniforms); return r; }
  equals(other) { return other === this; }
}

/** Šrafovací materiál z CSS farby (čiary alfa `lineAlpha`, výplň `fillAlpha`); bez cache = null. */
export function hatchMaterialFor(css, { lineAlpha = 0.55, fillAlpha = 0.1, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness } = {}) {
  if (!ensureHatchMaterial(Cesium)) return null;
  const base = Cesium.Color.fromCssColorString(css);
  return new HatchMaterialProperty({ lineColor: base.withAlpha(lineAlpha), fillColor: base.withAlpha(fillAlpha), spacing, thickness });
}
