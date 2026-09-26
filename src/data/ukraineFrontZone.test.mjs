// src/data/ukraineFrontZone.test.mjs — prifrontové pásmo a žiara línie (2026-09-26,
// vlastník: „teraz tam nevidno vôbec nič na frontovej línii"): pásmo sa odvodzuje
// z dnešnej línie kontaktu, len na ukrajinskej strane a na pevnine, intenzita klesá
// od línie; predvolený štýl ho kreslí so žiarou, KARTA nie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FRONT_ZONE_KM, FRONT_ZONE_RU_KM, contactLinePaths, frontZoneRaster } from './ukraineContactLine.js';

// Štvorec „okupovaného" územia 37,0–37,6 E × 48,0–48,4 N; celé okolie je „pevnina".
const occupied = [[37.0, 48.0], [37.6, 48.0], [37.6, 48.4], [37.0, 48.4], [37.0, 48.0]];
const index = [{ kind: 'occupied', ring: occupied }];
const land = [[[35.0, 46.5], [39.5, 46.5], [39.5, 50.0], [35.0, 50.0], [35.0, 46.5]]];
// Línia kontaktu = západná hrana štvorca (za ňou ukrajinská pevnina).
const paths = [[[37.0, 48.0], [37.0, 48.4]]];
const cellAt = (z, lon, lat) => z.values[Math.floor((z.bbox.north - lat) / z.cellDeg) * z.width + Math.floor((lon - z.bbox.west) / z.cellDeg)];

test('pásmo len na ukrajinskej strane, klesá od línie, končí na FRONT_ZONE_KM', () => {
  assert.equal(FRONT_ZONE_KM, 6);
  const z = frontZoneRaster(paths, index, { landRings: land });
  assert.ok(z && z.cells > 0);
  const kmLon = 1 / (111.32 * Math.cos((48.2 * Math.PI) / 180));
  const at1 = cellAt(z, 37.0 - 1 * kmLon, 48.2);
  const at4 = cellAt(z, 37.0 - 4 * kmLon, 48.2);
  const at8 = cellAt(z, 37.0 - 8 * kmLon, 48.2);
  assert.ok(at1 > at4 && at4 > 0, `1 km ${at1} > 4 km ${at4} > 0`);
  assert.equal(at8, 0, 'za 6 km nič');
  assert.equal(cellAt(z, 37.0 + 2 * kmLon, 48.2), 0, 'okupovaná strana bez pásma');
  // Žiadna bunka pásma v okupovanom štvorci.
  for (let r = 0; r < z.height; r += 1) for (let c = 0; c < z.width; c += 1) {
    if (!z.values[r * z.width + c]) continue;
    const lon = z.bbox.west + (c + 0.5) * z.cellDeg; const lat = z.bbox.north - (r + 0.5) * z.cellDeg;
    assert.ok(!(lon > 37.0 && lon < 37.6 && lat > 48.0 && lat < 48.4), `bunka ${lon},${lat} v okupovanom`);
  }
});

test('okupovaná strana (šrafy, vlastník: „tú hluché miesto by si mohol vyplniť šrafovaním"): len v ruskej kontrole, plná do polovice, do FRONT_ZONE_RU_KM', () => {
  assert.equal(FRONT_ZONE_RU_KM, 8);
  const z = frontZoneRaster(paths, index, { landRings: land });
  const kmLon = 1 / (111.32 * Math.cos((48.2 * Math.PI) / 180));
  const ru = (lon, lat) => z.ruValues[Math.floor((z.bbox.north - lat) / z.cellDeg) * z.width + Math.floor((lon - z.bbox.west) / z.cellDeg)];
  assert.ok(z.ruCells > 0);
  assert.equal(ru(37.0 + 2 * kmLon, 48.2), 255, '2 km za líniou = plná šrafa');
  assert.ok(ru(37.0 + 6 * kmLon, 48.2) > 0 && ru(37.0 + 6 * kmLon, 48.2) < 255, '6 km = slabne');
  assert.equal(ru(37.0 + 10 * kmLon, 48.2), 0, 'za 8 km nič');
  assert.equal(ru(37.0 - 2 * kmLon, 48.2), 0, 'ukrajinská strana bez šrafy');
  const none = frontZoneRaster(paths, index, { landRings: land, ruRadiusKm: 0 });
  assert.equal(none.ruCells, 0, 'ruRadiusKm 0 = bez šrafy (KARTA)');
});

test('pevnina orezáva pásmo (more, Rusko); bez línie nič', () => {
  const coast = [[[35.0, 46.5], [36.95, 46.5], [36.95, 50.0], [35.0, 50.0], [35.0, 46.5]]]; // pevnina končí 0,05° pred líniou
  const cut = frontZoneRaster(paths, index, { landRings: coast });
  const full = frontZoneRaster(paths, index, { landRings: land });
  assert.ok(cut.cells < full.cells, `${cut.cells} < ${full.cells}`);
  assert.equal(frontZoneRaster([], index), null);
  assert.equal(frontZoneRaster(null, index), null);
});

test('skutočná línia z polygónu: pásmo vznikne a do ruskej kontroly nezasahuje', () => {
  const landUa = [[[35.0, 46.5], [39.5, 46.5], [39.5, 50.0], [35.0, 50.0], [35.0, 46.5]]];
  const derived = contactLinePaths(index, landUa);
  assert.ok(derived.length >= 1);
  const z = frontZoneRaster(derived, index, { landRings: landUa });
  assert.ok(z.cells > 100);
  const kmLon = 1 / (111.32 * Math.cos((48.2 * Math.PI) / 180));
  assert.equal(cellAt(z, 37.3, 48.2), 0, 'stred okupovaného štvorca');
  assert.ok(cellAt(z, 37.0 - 2 * kmLon, 48.2) > 0, 'západne od línie');
  assert.ok(cellAt(z, 37.6 + 2 * kmLon, 48.2) > 0, 'východne od línie (celý štvorec je obkolesený pevninou)');
});

test('vrstva: predvolený štýl má pásmo a žiaru, KARTA nie; legenda a texty v oboch jazykoch', async () => {
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  assert.match(src, /contactGlow: Object\.freeze\(\{ width: 18, alpha: 0\.6, power: 0\.14 \}\)/);
  assert.match(src, /zone: Object\.freeze\(\{ css: '#ff7a3d', maxAlpha: 0\.42 \}\)/);
  const karta = src.slice(src.indexOf('karta: Object.freeze({'), src.indexOf('});', src.indexOf('karta: Object.freeze({')));
  assert.doesNotMatch(karta, /zone:|contactGlow:/, 'KARTA ostáva jemná');
  assert.match(src, /new Cesium\.PolylineGlowMaterialProperty\(/);
  assert.match(src, /frontZoneRaster\(_contact, _polyIndex, \{ landRings: UKRAINE_LAND_RINGS, radiusKm: uaKm, ruRadiusKm: ruKm \}\)/, 'z dnešnej línie, orezané pevninou');
  assert.match(src, /const ruKm = band \? band\.ruKm : \(st\.zoneRu \? FRONT_ZONE_RU_KM : 0\);/);
  assert.match(src, /zoneRu: Object\.freeze\(\{ css: '#ff4b3e', lineAlpha: 0\.62, spacing: 8, thickness: 0\.22 \}\)/);
  assert.match(src, /material: mat, classificationType: Cesium\.ClassificationType\.BOTH/, 'jeden obdĺžnik, materiál OkoFrontZone');
  assert.doesNotMatch(src, /ImageMaterialProperty\(\{ image: zc/, 'nie ImageMaterialProperty (st pri veľkom obdĺžniku sedelo o km vedľa)');
  // Materiály: poloha z lúča a elipsoidu v OČNÝCH súradniciach, nie z materialInput.st.
  const mats = readFileSync(new URL('./screenPatternMaterials.js', import.meta.url), 'utf8');
  for (const type of ['OkoFrontZone', 'OkoGeoImage']) assert.ok(mats.includes(`'${type}'`), type);
  const shaders = mats.match(/source: `[\s\S]*?`/g).filter((s) => s.includes('rect.'));
  assert.equal(shaders.length, 2);
  for (const sh of shaders) {
    assert.match(sh, /czm_rayEllipsoidIntersectionInterval\(czm_ray\(vec3\(0\.0\), dirEC\), czm_view\[3\]\.xyz,/, 'lúč a stred Zeme v očných súradniciach');
    assert.match(sh, /atan\(p\.z, length\(p\.xy\) \* 0\.99330562\)/, 'geodetická šírka WGS84');
    assert.doesNotMatch(sh, /materialInput\.st/);
  }
  const ctl = readFileSync(new URL('../ukraineControlLayer.js', import.meta.url), 'utf8');
  assert.match(ctl, /material: geoImageMaterialFor\(canvas, b\) \|\| new Cesium\.ImageMaterialProperty/, 'aj raster Wikipédie presne');
  const tl = readFileSync(new URL('../ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /sw\('is-ds-zone', translate\('ukraine\.ds\.zone'\)\)/);
  assert.match(tl, /sw\('is-ds-zone-ru', translate\('ukraine\.ds\.zone-ru'\)\)/);
  const { EN_STRINGS, SK_STRINGS } = await import('../i18nStrings.js');
  for (const k of ['ukraine.ds.zone', 'ukraine.ds.zone-tip', 'ukraine.ds.zone-ru', 'ukraine.ds.zone-ru-tip']) { assert.ok(EN_STRINGS[k]); assert.ok(SK_STRINGS[k]); }
  assert.match(SK_STRINGS['ukraine.ds.zone-tip'], /odvodená geometria, nie mapa bojov/);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-tl-ds\.is-karta \.is-ds-zone \{ display: none; \}/);
  assert.match(css, /\.oko-ukr-tl-ds\.is-karta \.is-ds-zone-ru \{ display: none; \}/);
});

test('plátno pásma: R = ukrajinská strana, G = okupovaná, alfa 255 len kde niečo je', async () => {
  const { paintFrontZoneCanvas } = await import('../ukraineDeepStateLayer.js');
  let put = null;
  const ctx = { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { put = img; } };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const zone = { width: 3, height: 1, cells: 1, ruCells: 1, values: Uint8Array.from([200, 0, 0]), ruValues: Uint8Array.from([0, 255, 0]) };
  assert.equal(paintFrontZoneCanvas(zone, canvas), canvas);
  assert.deepEqual([...put.data], [200, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0]);
  assert.equal(paintFrontZoneCanvas({ ...zone, cells: 0, ruCells: 0 }, canvas), null);
  assert.equal(paintFrontZoneCanvas(zone, { getContext: () => null }), null);
});

test('KARTA ako vzorka Rybar: oranžovo šrafovaný pás cez obe strany línie, náhľad s okupovaným územím vpravo hore', async () => {
  const src = readFileSync(new URL('../ukraineDeepStateLayer.js', import.meta.url), 'utf8');
  const karta = src.slice(src.indexOf('karta: Object.freeze({'), src.indexOf('});', src.indexOf('karta: Object.freeze({')) + 3);
  assert.match(karta, /combatBand: Object\.freeze\(\{ css: '#f0922e', lineAlpha: 0\.9, fillAlpha: 0\.22, spacing: 7, thickness: 0\.36, uaKm: 3, ruKm: 5 \}\)/);
  const { combatBandMask, coarseOccupiedRings } = await import('../ukraineDeepStateLayer.js');
  const m = combatBandMask({ width: 3, height: 1, cells: 1, ruCells: 1, values: Uint8Array.from([90, 0, 0]), ruValues: Uint8Array.from([0, 40, 0]) });
  assert.deepEqual([...m.ruValues], [255, 255, 0], 'UA aj RU časť pásma = plná maska');
  assert.deepEqual([...m.values], [0, 0, 0], 'žiadny oranžový prechod, len šrafa');
  assert.equal(m.ruCells, 2);
  const rings = coarseOccupiedRings([
    { type: 'Polygon', kind: 'occupied', rings: [[[37, 48], [37.01, 48], [37.2, 48], [37.2, 48.2], [37, 48.2], [37, 48]]] },
    { type: 'Polygon', kind: 'liberated', rings: [[[36, 48], [36.2, 48], [36.2, 48.2], [36, 48]]] },
  ]);
  assert.equal(rings.length, 1, 'len ruská kontrola');
  assert.ok(!rings[0].some(([lon]) => lon === 37.01), 'blízke body sa riedia');
  const { kartaLegendItems } = await import('../ukraineKartaOverlay.js');
  const mirror = kartaLegendItems({ deepstate: { shown: true, source: 'mirror', features: 21 }, translate: (k) => k });
  const band = mirror.find((i) => i.key === 'contested');
  assert.ok(band && band.pattern === 'hatch' && band.colorCss === '#f0922e', 'pás v legende aj bez vrstvy Wikipédie');
  const { EN_STRINGS, SK_STRINGS } = await import('../i18nStrings.js');
  assert.match(SK_STRINGS['ukraine.karta.legend.contested'], /odvodený/);
  assert.doesNotMatch(SK_STRINGS['ukraine.karta.legend.contested'], /Wikipédia/, 'pás už nie je z Wikipédie');
  assert.ok(EN_STRINGS['ukraine.ds.band-tip'] && SK_STRINGS['ukraine.ds.band-tip']);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-karta-inset \{ top: 112px; right: 16px; width: 168px; padding: 8px; \}/, 'náhľad vpravo hore');
  assert.match(css, /\.oko-karta-inset-occupied \{ fill: rgba\(158, 44, 52, 0\.85\)/);
  const ov = readFileSync(new URL('../ukraineKartaOverlay.js', import.meta.url), 'utf8');
  assert.match(ov, /const ix = width - insetW - pad, iy = pad;/, 'aj v exporte vpravo hore');
  assert.match(ov, /deepstate\?\.occupiedOutline\?\.\(\)/);
});

test('scéna frontu sa otvára v KARTE a pri odchode vráti pôvodný podklad (vlastník: „Áno, front vždy v KARTE")', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(scene && mapStackController\.getActiveId\(\) !== 'karta'\) \{\n\s+autoKartaPrev = mapStackController\.getActiveId\(\);\n\s+try \{ void Promise\.resolve\(styleManager\._setMapStack\('karta'\)\)/);
  assert.match(main, /const runChokepointScene = \(id\) => \{\n\s+restoreAutoKarta\(\);/, 'úžina vráti podklad');
  assert.match(main, /ukraineTimeline\.onChange\(\(st\) => \{ if \(!st\?\.shown && autoKartaPrev\) restoreAutoKarta\(\); \}\);/, 'zatvorená os vráti podklad');
  assert.match(main, /onActiveMapStackChange\(\(stack\) => \{ if \(stack\?\.id !== 'karta'\) autoKartaPrev = null; \}\);/, 'ručná zmena podkladu sa nevracia');
});
