import * as Cesium from 'cesium';

/**
 * Deň/noc na Google 3D fotoreáli (2026-09-06, „prečo pri google 3d nefunguje
 * deň/noc" → „áno sprav").
 *
 * Fotoreálne dlaždice sú fotogrametria s tieňmi zapečenými do textúr a
 * materiál je unlit — Cesium ich neosvetľuje, a glóbus (kde žije terminátor
 * aj vrstva nočných svetiel) je pod nimi skrytý. Jediná cesta je vlastný
 * fragment shader na tilesete (`Cesium3DTileset.customShader`): z polohy
 * fragmentu vo svete sa spočíta normála, porovná so smerom Slnka
 * (`czm_sunDirectionWC`) a nočná strana sa stmaví TÝM ISTÝM vzorcom, akým
 * Cesium tmaví glóbus (`lambert * 5 + floor`). Svetlá miest sú Black Marble
 * ako JEDNA rovnobežková textúra (GIBS WMS 4096×2048, keyless, CORS `*`)
 * vzorkovaná podľa zemepisnej dĺžky/šírky fragmentu a pripočítaná na nočnej
 * strane — z výšky mesto svieti, zblízka je to mäkká žiara nad ulicami
 * (3 km/px, presnejšie dáta nemáme).
 *
 * Bez výškového prelínania: na glóbuse osvetlenie pod 1 500 km vyhasne, aby
 * bolo mesto čitateľné; tu je zotmenie mesta pointa. Podlaha 0,28 s chladným
 * nádychom drží ulice čitateľné aj v noci; svetlá sa zblízka pripočítavajú
 * len ako jemná žiara (viď PHOTOREAL_NIGHT_LIGHTS_GAIN). Výkon: pár operácií
 * na fragment, jedna textúra.
 *
 * Zdroj svetiel = ten istý produkt ako nightLights.js (NASA GIBS Black
 * Marble, DATA_SOURCES.md), kredit už je v Data attribution.
 */

/** Black Marble ako jeden rovnobežkový obrázok (GIBS WMS, statická 2016 kompozícia). */
export const PHOTOREAL_NIGHT_TEXTURE_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=4096&HEIGHT=2048&FORMAT=image/jpeg&TIME=2016-01-01';

/**
 * Jas nočnej strany. Glóbus má 0,3 natvrdo; fotoreál ide nižšie — 0,28 bolo
 * podľa používateľa „slabé" (2026-09-06 večer), noc má byť noc. Ulice drží
 * čitateľné žiara svetiel, nie podlaha.
 */
export const PHOTOREAL_NIGHT_FLOOR = 0.12;
/**
 * Zosilnenie pripočítaných svetiel PODĽA VZDIALENOSTI kamery od fragmentu.
 * Black Marble má 3 km/px: z výšky je to presná mapa svetiel (gain far),
 * zblízka by tá istá hodnota položila na celé mesto rovnomernú svetlú
 * platňu — namerané 2026-09-06 nad hradom: floor 0,35 + gain 0,9 dalo
 * 0,62 jasu dňa, teda „zamračený deň", nie noc. Zblízka preto len jemná
 * žiara (gain near), prechod medzi 3 a 300 km.
 */
export const PHOTOREAL_NIGHT_LIGHTS_GAIN = Object.freeze({ near: 0.4, far: 1.1 });
export const PHOTOREAL_NIGHT_LIGHTS_RANGE_M = Object.freeze({ near: 3_000, far: 300_000 });
/** Chladný nádych nočnej strany (mesačné svetlo) — pri plnom dni 1. */
export const PHOTOREAL_NIGHT_TINT = Object.freeze([0.55, 0.68, 1.0]);
/**
 * Prah, pod ktorým sa jas Black Marble berie ako ambientná kresba pevniny,
 * nie svetlo — ten istý dôvod ako `colorToAlpha` 0,25 v nightLights.js
 * (90 % pixelov je do 63/255). smoothstep 0,22→0,40 namiesto tvrdého rezu.
 */
export const PHOTOREAL_NIGHT_LIGHTS_CUTOFF = Object.freeze({ from: 0.22, to: 0.4 });

/**
 * GLSL fragment. `positionWC` = svetová poloha fragmentu (Cesium ju dodá,
 * keď ju shader menuje). Normála je geocentrická (normalize(p)) — od geodetickej
 * sa líši o < 0,2°, pre osvetlenie bezvýznamné. `czm_pi` je Cesium konštanta.
 */
export const PHOTOREAL_NIGHT_FRAGMENT = `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  vec3 p = fsInput.attributes.positionWC;
  vec3 n = normalize(p);
  float lambert = max(dot(n, czm_sunDirectionWC), 0.0);
  float daylight = clamp(lambert * 5.0 + u_nightFloor, 0.0, 1.0);
  float nightBlend = 1.0 - clamp(lambert * 5.0, 0.0, 1.0);
  float lon = atan(p.y, p.x);
  float lat = asin(clamp(n.z, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * czm_pi) + 0.5, lat / czm_pi + 0.5);
  vec3 lights = texture(u_nightLights, uv).rgb;
  float lum = max(max(lights.r, lights.g), lights.b);
  lights *= smoothstep(u_lightsCutoff.x, u_lightsCutoff.y, lum);
  float dist = length(czm_viewerPositionWC - p);
  float gain = mix(u_lightsGain.x, u_lightsGain.y, smoothstep(u_lightsRange.x, u_lightsRange.y, dist));
  vec3 tint = mix(u_nightTint, vec3(1.0), daylight);
  // Sodíkové/LED mestá sú z výšky teplé; Black Marble po JPEG je skôr sivá.
  const vec3 warm = vec3(1.0, 0.88, 0.68);
  material.diffuse = material.diffuse * daylight * tint + lights * warm * gain * nightBlend;
}
`;

/**
 * Postav shader. Textúra sa načíta lenivo pri prvom snímku (Cesium volá
 * `update` sám, keď je shader na tilesete).
 * @param {object} [options]
 * @param {string} [options.lightsUrl]
 * @returns {Cesium.CustomShader}
 */
export function buildPhotorealNightShader({
  lightsUrl = PHOTOREAL_NIGHT_TEXTURE_URL,
  // Injektovateľné pre testy: TextureUniform aj CustomShader začnú textúru
  // sťahovať hneď v konštruktore (potrebujú `document`) — v Node sa nedajú
  // postaviť, testy overujú OPTIONS, nie WebGL objekt.
  textureFactory = (url) => new Cesium.TextureUniform({ url, repeat: true }),
  shaderFactory = (options) => new Cesium.CustomShader(options),
} = {}) {
  return shaderFactory({
    uniforms: {
      u_nightLights: {
        type: Cesium.UniformType.SAMPLER_2D,
        value: textureFactory(lightsUrl),
      },
      u_nightFloor: { type: Cesium.UniformType.FLOAT, value: PHOTOREAL_NIGHT_FLOOR },
      u_lightsGain: {
        type: Cesium.UniformType.VEC2,
        value: new Cesium.Cartesian2(PHOTOREAL_NIGHT_LIGHTS_GAIN.near, PHOTOREAL_NIGHT_LIGHTS_GAIN.far),
      },
      u_lightsRange: {
        type: Cesium.UniformType.VEC2,
        value: new Cesium.Cartesian2(PHOTOREAL_NIGHT_LIGHTS_RANGE_M.near, PHOTOREAL_NIGHT_LIGHTS_RANGE_M.far),
      },
      u_nightTint: { type: Cesium.UniformType.VEC3, value: new Cesium.Cartesian3(...PHOTOREAL_NIGHT_TINT) },
      u_lightsCutoff: {
        type: Cesium.UniformType.VEC2,
        value: new Cesium.Cartesian2(PHOTOREAL_NIGHT_LIGHTS_CUTOFF.from, PHOTOREAL_NIGHT_LIGHTS_CUTOFF.to),
      },
    },
    fragmentShaderText: PHOTOREAL_NIGHT_FRAGMENT,
  });
}

/**
 * Jediný zapisovač `tileset.customShader` pre deň/noc. Shader sa postaví raz
 * a recykluje (textúra ostáva na GPU); vypnutie ho z tilesetu odoberie, ale
 * nezničí — prepínač Deň/noc sa klikne aj desaťkrát za večer.
 * @param {object|null} tileset Cesium3DTileset (alebo mock).
 * @param {boolean} enabled
 * @param {object} [deps]
 * @param {() => object} [deps.shaderFactory]
 * @returns {boolean} je shader nasadený?
 */
export function applyPhotorealNight(tileset, enabled, { shaderFactory = buildPhotorealNightShader } = {}) {
  if (!tileset || typeof tileset !== 'object') return false;
  if (!enabled) {
    if (tileset.customShader && tileset.customShader === tileset.gevNightShader) tileset.customShader = undefined;
    return false;
  }
  if (!tileset.gevNightShader) tileset.gevNightShader = shaderFactory();
  if (tileset.customShader !== tileset.gevNightShader) tileset.customShader = tileset.gevNightShader;
  return true;
}

/** Je na tilesete náš shader? (QA/testy) */
export function hasPhotorealNight(tileset) {
  return !!tileset?.gevNightShader && tileset.customShader === tileset.gevNightShader;
}
