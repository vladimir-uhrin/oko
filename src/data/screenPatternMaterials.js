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

/**
 * Prifrontové pásmo jedným materiálom (2026-09-26): textúra nesie dve masky —
 * R = ukrajinská strana (oranžový prechod), G = okupovaná strana (červené šrafy 45°
 * v obrazovkových px; vlastník: „tú hluché miesto by si mohol vyplniť šrafovaním").
 *
 * Súradnice textúry sa NEberú z `materialInput.st`: pri veľkom pozemnom obdĺžniku
 * (≈ 5,7° × 4,8°) ich Cesium počíta sférickou aproximáciou a pásmo sedelo o pár km
 * vedľa polygónov (overené: raster 0 nezhôd, na mape oranžové fľaky v okupovanom
 * výbežku pri Lymane). Poloha fragmentu sa preto počíta priesečníkom lúča od kamery
 * (smer z `positionToEyeEC`) s elipsoidom WGS84 a z nej geodetická šírka/dĺžka
 * (1 − e² = 0,99330562) → presne podľa `rect` (západ, juh, východ, sever v radiánoch).
 * Samotné `positionToEyeEC` ako polohu použiť nejde — pri klasifikácii nie je
 * delené `w` (dĺžka nesedí, overené: celý obdĺžnik jednej farby); smer áno.
 * Terén sa zanedbá: pri výške 150 m a sklone −64° je to ~70 m.
 */
export const FRONT_ZONE_MATERIAL_TYPE = 'OkoFrontZone';
function frontZoneFabric(CesiumRef) {
  return {
    fabric: {
      type: FRONT_ZONE_MATERIAL_TYPE,
      uniforms: {
        image: 'czm_defaultImage',
        rect: new CesiumRef.Cartesian4(0, 0, 1, 1),
        zoneColor: new CesiumRef.Color(1.0, 0.48, 0.24, 0.42),
        hatchColor: new CesiumRef.Color(1.0, 0.29, 0.24, 0.62),
        // Výplň medzi šrafami (KARTA: oranžové pruhy na priesvitnej oranžovej ako Rybar; inak 0).
        hatchFill: new CesiumRef.Color(1.0, 0.29, 0.24, 0.0),
        spacing: HATCH_DEFAULTS.spacingPx,
        thickness: HATCH_DEFAULTS.thickness,
      },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  // czm_rayEllipsoidIntersectionInterval berie lúč a stred elipsoidu v OČNÝCH súradniciach
  // (vnútri ich prevedie cez czm_inverseModelView) — kamera je počiatok, stred Zeme czm_view[3].
  vec3 dirEC = normalize(-materialInput.positionToEyeEC);
  czm_raySegment hit = czm_rayEllipsoidIntersectionInterval(czm_ray(vec3(0.0), dirEC), czm_view[3].xyz, vec3(1.0 / 6378137.0, 1.0 / 6378137.0, 1.0 / 6356752.314245));
  vec3 p = czm_viewerPositionWC + max(hit.start, 0.0) * normalize(czm_inverseViewRotation * dirEC);
  float lon = atan(p.y, p.x);
  float lat = atan(p.z, length(p.xy) * 0.99330562);
  vec2 uv = vec2((lon - rect.x) / (rect.z - rect.x), (lat - rect.y) / (rect.w - rect.y));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { m.alpha = 0.0; return m; }
  vec4 s = texture(image, uv);
  float t = fract((gl_FragCoord.x + gl_FragCoord.y) / spacing);
  float d = min(t, 1.0 - t) * 2.0;
  float line = 1.0 - smoothstep(thickness, thickness + 0.25, d);
  float aUa = s.r * zoneColor.a;
  float aRu = s.g * mix(hatchFill.a, hatchColor.a, line);
  vec3 cRu = mix(hatchFill.rgb, hatchColor.rgb, line);
  float a = aUa + aRu * (1.0 - aUa);
  m.diffuse = a > 0.0 ? (zoneColor.rgb * aUa + cRu * aRu * (1.0 - aUa)) / a : zoneColor.rgb;
  m.alpha = a;
  return m;
}`,
    },
    translucent: true,
  };
}

/**
 * Obrázok presne podľa geodetických súradníc (2026-09-26): ten istý výpočet polohy
 * ako OkoFrontZone, textúra sa vykreslí tak, ako je (rgba). Pre raster zón
 * Wikipédie — ImageMaterialProperty na obdĺžniku 18° × 8° sedel o kilometre vedľa.
 */
export const GEO_IMAGE_MATERIAL_TYPE = 'OkoGeoImage';
function geoImageFabric(CesiumRef) {
  return {
    fabric: {
      type: GEO_IMAGE_MATERIAL_TYPE,
      uniforms: { image: 'czm_defaultImage', rect: new CesiumRef.Cartesian4(0, 0, 1, 1) },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec3 dirEC = normalize(-materialInput.positionToEyeEC);
  czm_raySegment hit = czm_rayEllipsoidIntersectionInterval(czm_ray(vec3(0.0), dirEC), czm_view[3].xyz, vec3(1.0 / 6378137.0, 1.0 / 6378137.0, 1.0 / 6356752.314245));
  vec3 p = czm_viewerPositionWC + max(hit.start, 0.0) * normalize(czm_inverseViewRotation * dirEC);
  float lon = atan(p.y, p.x);
  float lat = atan(p.z, length(p.xy) * 0.99330562);
  vec2 uv = vec2((lon - rect.x) / (rect.z - rect.x), (lat - rect.y) / (rect.w - rect.y));
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { m.alpha = 0.0; return m; }
  vec4 s = texture(image, uv);
  m.diffuse = s.rgb;
  m.alpha = s.a;
  return m;
}`,
    },
    translucent: true,
  };
}

/** Zaregistruje šrafovacie materiály (raz na proces). Vracia false bez cache materiálov. */
export function ensureHatchMaterial(CesiumRef = Cesium) {
  const cache = CesiumRef?.Material?._materialCache;
  if (!cache?.addMaterial) return false;
  if (!cache.getMaterial?.(HATCH_MATERIAL_TYPE)) cache.addMaterial(HATCH_MATERIAL_TYPE, hatchFabric(CesiumRef, HATCH_MATERIAL_TYPE, 'gl_FragCoord.x + gl_FragCoord.y'));
  if (!cache.getMaterial?.(HATCH_MATERIAL_TYPE_135)) cache.addMaterial(HATCH_MATERIAL_TYPE_135, hatchFabric(CesiumRef, HATCH_MATERIAL_TYPE_135, 'gl_FragCoord.x - gl_FragCoord.y'));
  if (!cache.getMaterial?.(FRONT_ZONE_MATERIAL_TYPE)) cache.addMaterial(FRONT_ZONE_MATERIAL_TYPE, frontZoneFabric(CesiumRef));
  if (!cache.getMaterial?.(GEO_IMAGE_MATERIAL_TYPE)) cache.addMaterial(GEO_IMAGE_MATERIAL_TYPE, geoImageFabric(CesiumRef));
  return true;
}

/** MaterialProperty obrázka v geodetickom obdĺžniku (radiány). */
export class GeoImageMaterialProperty {
  constructor({ image, rect } = {}) {
    this._uniforms = { image, rect };
    this._definitionChanged = new Cesium.Event();
  }
  get isConstant() { return true; }
  get definitionChanged() { return this._definitionChanged; }
  getType() { return GEO_IMAGE_MATERIAL_TYPE; }
  getValue(time, result) { const r = result || {}; Object.assign(r, this._uniforms); return r; }
  equals(other) { return other === this; }
}

/** Obrázok (plátno) presne na `bbox` v stupňoch; bez cache materiálov (Node) = null. */
export function geoImageMaterialFor(image, bbox) {
  if (!image || !bbox || !ensureHatchMaterial(Cesium)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  return new GeoImageMaterialProperty({ image, rect: new Cesium.Cartesian4(rad(bbox.west), rad(bbox.south), rad(bbox.east), rad(bbox.north)) });
}

/** MaterialProperty prifrontového pásma (textúra R/G + geodetický obdĺžnik v radiánoch). */
export class FrontZoneMaterialProperty {
  constructor({ image, rect, zoneColor, hatchColor, hatchFill = null, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness } = {}) {
    this._uniforms = { image, rect, zoneColor, hatchColor, hatchFill: hatchFill || hatchColor.withAlpha(0), spacing, thickness };
    this._definitionChanged = new Cesium.Event();
  }
  get isConstant() { return true; }
  get definitionChanged() { return this._definitionChanged; }
  getType() { return FRONT_ZONE_MATERIAL_TYPE; }
  getValue(time, result) { const r = result || {}; Object.assign(r, this._uniforms); return r; }
  equals(other) { return other === this; }
}

/**
 * Materiál pásma pre raster s `bbox` v stupňoch; farby z CSS a krytia. Bez cache
 * materiálov (Node) = null.
 */
export function frontZoneMaterialFor(image, bbox, { zoneCss = '#ff7a3d', zoneAlpha = 0.42, hatchCss = '#ff4b3e', hatchAlpha = 0.62, hatchFillAlpha = 0, spacing = HATCH_DEFAULTS.spacingPx, thickness = HATCH_DEFAULTS.thickness } = {}) {
  if (!image || !bbox || !ensureHatchMaterial(Cesium)) return null;
  const rad = (d) => (d * Math.PI) / 180;
  return new FrontZoneMaterialProperty({
    image,
    rect: new Cesium.Cartesian4(rad(bbox.west), rad(bbox.south), rad(bbox.east), rad(bbox.north)),
    zoneColor: Cesium.Color.fromCssColorString(zoneCss).withAlpha(zoneAlpha),
    hatchColor: Cesium.Color.fromCssColorString(hatchCss).withAlpha(hatchAlpha),
    hatchFill: Cesium.Color.fromCssColorString(hatchCss).withAlpha(hatchFillAlpha),
    spacing, thickness,
  });
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
