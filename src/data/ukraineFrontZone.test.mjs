// src/data/ukraineFrontZone.test.mjs — prifrontové pásmo a žiara línie (2026-09-26,
// vlastník: „teraz tam nevidno vôbec nič na frontovej línii"): pásmo sa odvodzuje
// z dnešnej línie kontaktu, len na ukrajinskej strane a na pevnine, intenzita klesá
// od línie; predvolený štýl ho kreslí so žiarou, KARTA nie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FRONT_ZONE_KM, contactLinePaths, frontZoneRaster } from './ukraineContactLine.js';

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
  assert.match(src, /frontZoneRaster\(_contact, _polyIndex, \{ landRings: UKRAINE_LAND_RINGS \}\)/, 'z dnešnej línie, orezané pevninou');
  const tl = readFileSync(new URL('../ukraineTimeline.js', import.meta.url), 'utf8');
  assert.match(tl, /sw\('is-ds-zone', translate\('ukraine\.ds\.zone'\)\)/);
  const { EN_STRINGS, SK_STRINGS } = await import('../i18nStrings.js');
  for (const k of ['ukraine.ds.zone', 'ukraine.ds.zone-tip']) { assert.ok(EN_STRINGS[k]); assert.ok(SK_STRINGS[k]); }
  assert.match(SK_STRINGS['ukraine.ds.zone-tip'], /odvodená geometria, nie mapa bojov/);
  const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.oko-ukr-tl-ds\.is-karta \.is-ds-zone \{ display: none; \}/);
});
