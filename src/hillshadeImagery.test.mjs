// src/hillshadeImagery.test.mjs — tieňovanie normál (KARTA): svetlo, rampa,
// preklopenie Y, zosilnenie, lem proti švom, provider s injekciou fetch/canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import { HILLSHADE_DEFAULTS, HillshadeImageryProvider, KARTA_PALETTE, createHillshadeImageryProvider, lightVector, reliefTileUrl, shadeNormalTile, shadeNormals, shadePixel } from './hillshadeImagery.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('svetlo: 315°/45° = zo severozápadu (x záporné = západ, y kladné = sever), jednotkový vektor', () => {
  const [x, y, z] = lightVector(315, 45);
  assert.ok(near(x, -0.5) && near(y, 0.5) && near(z, Math.SQRT1_2), `${x} ${y} ${z}`);
  assert.ok(near(Math.hypot(x, y, z), 1));
  const east = lightVector(90, 0);
  assert.ok(near(east[0], 1) && near(east[1], 0, 1e-12) && near(east[2], 0));
});

test('rampa: rovina = stredný tón, svah k svetlu svetlejší, svah od svetla tmavší; amp zvýrazní, flipY otočí sever a juh', () => {
  const L = lightVector(315, 45);
  const flat = shadePixel(0, 0, 1, L);
  assert.deepEqual(flat.map(Math.round), KARTA_PALETTE.mid);
  const towards = shadePixel(-0.3, 0.3, 0.9, L); // sklon k SZ
  const away = shadePixel(0.3, -0.3, 0.9, L); // sklon k JV
  assert.ok(lum(towards) > lum(flat) && lum(away) < lum(flat));
  const amped = shadePixel(-0.3, 0.3, 0.9, L, { amp: 3 });
  assert.ok(lum(amped) > lum(towards), 'väčšie zosilnenie = svetlejší osvetlený svah');
  const flipped = shadePixel(-0.3, 0.3, 0.9, L, { flipY: true });
  const southFacing = shadePixel(-0.3, -0.3, 0.9, L);
  assert.deepEqual(flipped.map(Math.round), southFacing.map(Math.round), 'flipY = ako keby normála mierila na juh');
  assert.ok(lum(shadePixel(0, 0, -1, L)) <= lum(KARTA_PALETTE.shadow) + 1, 'odvrátená normála = tieň');
});

test('shadeNormals: RGBA dáta na mieste, alfa vždy 255, 128/128/255 = rovina', () => {
  const data = new Uint8ClampedArray([128, 128, 255, 40, 90, 160, 220, 0]);
  const out = shadeNormals(data, { flipY: false });
  assert.equal(out, data);
  assert.deepEqual([...data.slice(0, 3)].map(Math.round), KARTA_PALETTE.mid);
  assert.equal(data[3], 255); assert.equal(data[7], 255);
  assert.ok(lum([...data.slice(4, 7)]) > lum(KARTA_PALETTE.mid), 'normála k SZ (r<128, g>128) je pri flipY:false osvetlená');
});

function fakeCanvasFactory(log) {
  return (w, h) => {
    const ctx = {
      filter: 'none', calls: [], last: null,
      drawImage(...args) { this.calls.push(['drawImage', ...args.slice(1)]); },
      getImageData(x, y, cw, ch) { return { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4).fill(128).map((v, i) => (i % 4 === 2 ? 255 : v)) }; },
      putImageData(id) { this.last = id; },
    };
    const canvas = { width: w, height: h, getContext: () => ctx, ctx };
    log.push(canvas);
    return canvas;
  };
}

test('shadeNormalTile: pracovné plátno s lemom (clamp okrajov, 8 pásov) → rozmazanie → tieňovanie; bez vyhladenia žiadny lem', () => {
  const made = [];
  const out = shadeNormalTile({ width: 256, height: 256 }, { createCanvas: fakeCanvasFactory(made), smooth: 1.4, margin: 4, flipY: false });
  assert.equal(made.length, 2);
  assert.equal(made[0].width, 264, 'pracovné plátno = 256 + 2×4');
  assert.equal(made[0].ctx.calls.filter((c) => c[0] === 'drawImage').length, 9, '8 lemov + samotný obrázok');
  assert.equal(out, made[1]);
  assert.equal(out.width, 256);
  assert.equal(out.ctx.calls[0][1], -4, 'výstup kreslí pracovné plátno posunuté o lem');
  assert.deepEqual([...out.ctx.last.data.slice(0, 3)].map(Math.round), KARTA_PALETTE.mid, 'rovina = stredný tón');
  const made2 = [];
  shadeNormalTile({ width: 256, height: 256 }, { createCanvas: fakeCanvasFactory(made2), smooth: 0 });
  assert.equal(made2[0].width, 256, 'bez vyhladenia bez lemu');
  assert.equal(made2[0].ctx.calls.length, 1);
});

test('reliefTileUrl dosadí z/x/y (aj {level})', () => {
  assert.equal(reliefTileUrl('/api/relief/{z}/{x}/{y}.png', 2478, 1406, 12), '/api/relief/12/2478/1406.png');
  assert.equal(reliefTileUrl('https://h/{level}/{x}/{y}.png', 1, 2, 3), 'https://h/3/1/2.png');
});

test('provider: Web Mercator 256 px, stropy, kredit, requestImage = fetch cez Resource s request objektom → tieňované plátno; fronta (undefined) prejde ďalej', async () => {
  const made = [];
  const fetched = [];
  const provider = createHillshadeImageryProvider({
    url: '/api/relief/{z}/{x}/{y}.png', credit: 'Mapzen terrain tiles', maximumLevel: 15,
    shading: { amp: 2, flipY: true },
    fetchImage: (resource) => { fetched.push({ url: resource.url, hasRequest: Boolean(resource.request) }); return fetched.length === 2 ? undefined : Promise.resolve({ width: 256, height: 256 }); },
    createCanvas: fakeCanvasFactory(made),
  });
  assert.ok(provider instanceof HillshadeImageryProvider);
  assert.ok(provider.tilingScheme instanceof Cesium.WebMercatorTilingScheme);
  assert.equal(provider.tileWidth, 256); assert.equal(provider.tileHeight, 256);
  assert.equal(provider.maximumLevel, 15); assert.equal(provider.minimumLevel, 0);
  assert.equal(provider.credit.html, 'Mapzen terrain tiles');
  assert.equal(provider.hasAlphaChannel, false);
  assert.equal(provider.ready, true);
  assert.equal(provider.shading.amp, 2); assert.equal(provider.shading.flipY, true); assert.equal(provider.shading.smooth, HILLSHADE_DEFAULTS.smooth);
  const request = new Cesium.Request({ throttle: true });
  const canvas = await provider.requestImage(2478, 1406, 12, request);
  assert.equal(fetched[0].url, '/api/relief/12/2478/1406.png');
  assert.equal(fetched[0].hasRequest, true, 'Resource nesie request → RequestScheduler škrtí ako pri iných podkladoch');
  assert.equal(canvas.width, 256);
  assert.equal(canvas.ctx.last.data[3], 255);
  assert.equal(provider.requestImage(1, 1, 1), undefined, 'škrtenie prejde ako undefined');
  provider.setShading({ amp: 4 });
  assert.equal(provider.shading.amp, 4);
  assert.throws(() => createHillshadeImageryProvider({}), /url/);
});
