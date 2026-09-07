import * as Cesium from 'cesium';

/**
 * Nočné svetlá miest viazané na terminátor (2026-09-06).
 *
 * Doplnok k `globeLighting.js`: tam sa zapína osvetlenie glóbusu Slnkom, tu
 * pribúda nad podklad druhá imagery vrstva — NASA GIBS „Black Marble"
 * (VIIRS, Suomi NPP), globálna kompozitná snímka Zeme v noci. Cesium ju
 * prelína PRESNE pozdĺž terminátora cez `dayAlpha`/`nightAlpha` na
 * `ImageryLayer`: denná strana ju nevidí vôbec, nočná naplno.
 *
 * ZÁVISLOSŤ NA OSVETLENÍ NIE JE VOLITEĽNÁ. Shader glóbusu má miešanie
 * day/night alfy pod `#if defined(APPLY_DAY_NIGHT_ALPHA) &&
 * defined(ENABLE_DAYNIGHT_SHADING)` — druhá podmienka je práve
 * `globe.enableLighting`. Bez zapnutého osvetlenia by sa `dayAlpha` ignorovala
 * a Black Marble by prekryl celú guľu vrátane dňa. Preto vrstvu pridáva a
 * odoberá ten istý prepínač ako terminátor (ui.js `_setDayNightEnabled`).
 *
 * Platí len pre GLOBE stacky. Google 3D fotoreál má glóbus skrytý
 * (`globe.show = false`), takže tam vrstva nemá čo osvetľovať — controller ju
 * pri prepnutí na fotoreál odoberá.
 */

/**
 * Black Marble je STATICKÁ kompozitná vrstva — na rozdiel od dennej mozaiky
 * `gibs-truecolor` nemá zmysel počítať jej deň. GetCapabilities uvádza
 * `<Default>2016-01-01</Default>`, ale reťazec `default` v pozícii času server
 * rozviaže sám (overené 2026-09-06: rovnaká dlaždica, 200, rovnaká veľkosť).
 * Preto tu NIE JE volanie `gibsImageryDay()` — dátum, ktorý vrstva nemá, by
 * vrátil HTTP 400 a vrstva by ostala prázdna.
 *
 * PORADIE INDEXOV: GIBS je WMTS REST, teda TileMatrix/TileRow/TileCol = z/y/x,
 * NIE z/x/y. Prehodené indexy vrátia 200 s cudzou dlaždicou — nie chybu, ale
 * rozhádzanú mapu.
 */
export const NIGHT_LIGHTS_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png';

/** Maximum vrstvy podľa GetCapabilities (~600 m/px). Bližšie Cesium zväčšuje. */
export const NIGHT_LIGHTS_MAX_LEVEL = 8;
export const NIGHT_LIGHTS_TILE_PX = 256;
export const NIGHT_LIGHTS_CREDIT = 'NASA EOSDIS GIBS / Worldview · VIIRS Black Marble (Suomi NPP)';

/** Denná strana vrstvu nevidí — pod ňou ostáva zvolený podklad. */
export const NIGHT_LIGHTS_DAY_ALPHA = 0;
/** Nočná strana ju vidí naplno; tmavé pozadie z nej vyreže `colorToAlpha`. */
export const NIGHT_LIGHTS_NIGHT_ALPHA = 1;

/**
 * Prah pre vyrezanie všetkého, čo v snímke NIE JE svetlo.
 *
 * Black Marble je nepriehľadný RGB obrázok (PNG bez alfa kanála) a okrem
 * miest nesie aj slabú „ambientnú" kresbu pevniny a oceánu — histogram
 * dlaždice (max. zložka RGB, % plochy, 2026-09-06): 12–23: 35 %, 24–35: 36 %,
 * 36–63: 19 %, 64+: 9,7 %. Prvé tri pásma sú pozadie a reliéf, svetlá miest
 * začínajú okolo 64. Bez rezu by nočná strana stratila podklad (sivá OSM by
 * ju nahradila tmavomodrou platňou — presne to sa stalo s prahom 36/255).
 * Glóbusový shader (GlobeFS `sampleAndBlend`) porovnáva maximálnu zložku
 * rozdielu voči cieľovej farbe na SUROVEJ hodnote textúry, teda v sRGB, bez
 * linearizácie (overené v Cesium 1.138 — „lineárny" prah 0.02 nevyrezal nič).
 * 0.25 ≈ 64/255 bol prvý prah, ladený na európskej dlaždici. 2026-09-07
 * používateľ: „čo sú tie fialové škvrny" nad Saharou a Arábiou — meranie
 * dlaždíc z=5: Sahara má 94 % pixelov v pásme 40–69/255 (India 73 %, Európa
 * 12 %, Atlantik 0 %) — to je fialovo-modrý „lesk" púšte v ročnom kompozite,
 * nie svetlá; skutočné svetlá začínajú pri 100. Prah 64 rezal toto pásmo
 * napoly (tvrdý rez GlobeFS bez prechodu → fľaky s ostrými okrajmi).
 * 0.39 ≈ 100/255: púšť zmizne celá, mestá ostanú; najslabšie vidiecke
 * svetlá 70–99 (3 % Európy) zmiznú tiež — čistejšia mapa.
 */
export const NIGHT_LIGHTS_BACKGROUND_THRESHOLD = 0.39;

/**
 * Zosilnenie svetiel PODĽA KONTRASTU PODKLADU. Nočnú stranu Cesium tlmí
 * natvrdo na 0,3 (GlobeFS: `lambert * 5.0 + 0.3`) a tlmí ňou VŠETKO, svetlá
 * vrátane — na svetlej OSM mal Soul po zotmení rovnaký jas ako more (namerané
 * 112,103,89 vs. 108,107,105) a mestá vyzerali ako hnedé fľaky. `brightness`
 * sa aplikuje pred osvetlením (`mix(vec3(0), color, brightness)`, bez orezu),
 * takže 3 × 0,3 ≈ 0,9 na svetlej mape. Na tmavých podkladoch (Stadia Dark,
 * Blue Marble, satelit) je nočná strana o triedu tmavšia a trojka mestá
 * prepáli do bielych plachiet — tam stačí menej. Kontrast dodáva
 * contactPalette.js (descriptor podkladu `contactContrast`), ten istý, ktorý
 * farbí siluety kontaktov. Denná strana vrstvu nevidí (dayAlpha 0).
 */
export const NIGHT_LIGHTS_BRIGHTNESS = Object.freeze({ light: 3.0, dark: 1.8 });

/**
 * Zosilnenie pre kontrast; neznámy kontrast = 'dark' (bezpečnejší default,
 * rovnako ako v contactPalette).
 * @param {'light'|'dark'|string|null|undefined} contrast
 * @returns {number}
 */
export function nightLightsBrightnessFor(contrast) {
  return contrast === 'light' ? NIGHT_LIGHTS_BRIGHTNESS.light : NIGHT_LIGHTS_BRIGHTNESS.dark;
}

/**
 * Provider pre nočné svetlá. Keyless, CORS, dáta NASA (DATA_SOURCES.md).
 * @returns {Cesium.UrlTemplateImageryProvider}
 */
export function createNightLightsProvider() {
  return new Cesium.UrlTemplateImageryProvider({
    url: NIGHT_LIGHTS_URL,
    tileWidth: NIGHT_LIGHTS_TILE_PX,
    tileHeight: NIGHT_LIGHTS_TILE_PX,
    maximumLevel: NIGHT_LIGHTS_MAX_LEVEL,
    credit: NIGHT_LIGHTS_CREDIT,
  });
}

/**
 * Nastav vrstve terminátorové miešanie, vyrezanie pozadia a zosilnenie.
 * Jediný zapisovač týchto piatich vlastností — testy pinnú, že sa nastavujú spolu (samotná
 * `nightAlpha` bez `dayAlpha` by svetlá rozsvietila aj cez deň).
 *
 * Bezpečné aj nad testovacím dvojníkom: zapisuje len to, čo objekt unesie.
 * Volá sa aj pri prepnutí podkladu (kontrast sa mení) — je idempotentná.
 * @param {object|null} layer Cesium ImageryLayer (alebo mock).
 * @param {'light'|'dark'|string} [contrast] kontrast podkladu (contactPalette)
 * @returns {object|null} tá istá vrstva
 */
export function styleNightLightsLayer(layer, contrast = 'dark') {
  if (!layer) return null;
  layer.dayAlpha = NIGHT_LIGHTS_DAY_ALPHA;
  layer.nightAlpha = NIGHT_LIGHTS_NIGHT_ALPHA;
  layer.colorToAlpha = Cesium.Color.BLACK;
  layer.colorToAlphaThreshold = NIGHT_LIGHTS_BACKGROUND_THRESHOLD;
  layer.brightness = nightLightsBrightnessFor(contrast);
  return layer;
}
