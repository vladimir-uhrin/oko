// src/data/operaRadar.test.mjs
// Radar Európy OPERA (2026-10-08): adresa súboru, projekcia LAEA overená na rohoch skutočného kompozitu,
// prepočet do zemepisnej mriežky (maximum okolia, priehľadné nodata), PNG z vlákna, služba s kruhom snímok
// a vrstva (druhá inštancia radaru SHMÚ). Správanie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { smoothDbzColor, laeaForward, operaBounds, operaCandidateTimes, operaFileUrl, operaGrid, parseLaeaProjdef, reprojectOpera } from './operaRadar.js';
import { encodePngRgba } from './operaRadarWorker.js';
import { createOperaRadarService, OPERA_CHECK_EVERY_MS } from './operaRadarService.js';
import { createOperaRadarLayer, OPERA_RADAR_LAYER_ID } from './operaRadarLayer.js';

// `where` skutočného kompozitu OPERA 2026-10-08 19:30 UTC (ODIM /where).
const WHERE = {
  projdef: '+proj=laea +lat_0=55.0 +lon_0=10.0 +x_0=1950000.0 +y_0=-2100000.0 +units=m +ellps=WGS84',
  xsize: 3800, ysize: 4400, xscale: 1000, yscale: 1000,
  LL_lon: -10.4345768386404, LL_lat: 31.7462153182675, UL_lon: -39.5357864125034, UL_lat: 67.0228327624372,
  UR_lon: 57.8119647501499, UR_lat: 67.6210371071631, LR_lon: 29.421038635578, LR_lat: 31.987650276733,
};

test('adresa súboru a kandidátske časy po 10 min', () => {
  const { url, iso } = operaFileUrl(Date.parse('2026-10-08T19:37:12Z'));
  assert.equal(url, 'https://s3.waw3-1.cloudferro.com/openradar-24h/2026/10/08/OPERA/COMP/OPERA@20261008T1930@0@DBZH.h5');
  assert.equal(iso, '2026-10-08T19:30:00.000Z');
  const c = operaCandidateTimes(Date.parse('2026-10-08T19:44:00Z'), 3);
  assert.deepEqual(c.map((t) => new Date(t).toISOString().slice(11, 16)), ['19:30', '19:20', '19:10']);
});

test('LAEA na elipsoide WGS84: rohy skutočného kompozitu sedia na metre s veľkosťou mriežky', () => {
  assert.deepEqual(parseLaeaProjdef(WHERE.projdef), { lat0: 55, lon0: 10, x0: 1950000, y0: -2100000 });
  assert.equal(parseLaeaProjdef('+proj=stere'), null);
  const g = operaGrid(WHERE);
  const W = g.xsize * g.xscale;
  const H = g.ysize * g.yscale;
  const close = ([x, y], [ex, ey]) => Math.abs(x - ex) < 2 && Math.abs(y - ey) < 2;
  assert.ok(close(g.forward(WHERE.UL_lat, WHERE.UL_lon), [g.xll, g.yll + H]));
  assert.ok(close(g.forward(WHERE.UR_lat, WHERE.UR_lon), [g.xll + W, g.yll + H]));
  assert.ok(close(g.forward(WHERE.LR_lat, WHERE.LR_lon), [g.xll + W, g.yll]));
  // Stred projekcie leží na x_0, y_0.
  const [x, y] = laeaForward(parseLaeaProjdef(WHERE.projdef))(55, 10);
  assert.ok(Math.abs(x - 1950000) < 1e-6 && Math.abs(y + 2100000) < 1e-6);
  assert.deepEqual(operaBounds(WHERE), { west: -40, east: 58, south: 31, north: 74 });
});

test('prepočet: búrka sa prenesie na správne miesto (Bratislava), nodata ostane priehľadné, maximum okolia', () => {
  const g = operaGrid(WHERE);
  const values = new Float64Array(g.xsize * g.ysize).fill(-9999000);
  const top = g.yll + g.ysize * g.yscale;
  const [bx, by] = g.forward(48.15, 17.11);
  const col = Math.floor((bx - g.xll) / 1000);
  const row = Math.floor((top - by) / 1000);
  for (let dr = -4; dr <= 4; dr += 1) for (let dc = -4; dc <= 4; dc += 1) values[(row + dr) * g.xsize + col + dc] = 47; // búrka 9 × 9 km
  values[(row + 50) * g.xsize + col] = -8888000; // undetect
  const out = reprojectOpera(values, WHERE, { gain: 1, offset: 0, nodata: -9999000, undetect: -8888000 }, { deg: 0.1 });
  assert.equal(out.width, 980);
  assert.equal(out.height, 430);
  const c = Math.floor((17.11 - out.bounds.west) / 0.1);
  const r = Math.floor((out.bounds.north - 48.15) / 0.1);
  const at = (rr, cc) => out.rgba[(rr * out.width + cc) * 4 + 3];
  let found = false;
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) if (at(r + dr, c + dc) > 0) found = true;
  assert.ok(found, 'ozvena pri Bratislave');
  assert.ok(out.echoPixels >= 1 && out.echoPixels <= 6, `ozvena len pri búrke (${out.echoPixels})`);
  assert.equal(at(r + 20, c + 20), 0);
});

test('vyhladenie: plynulá farba medzi zastávkami palety, mäkký okraj zrážok', () => {
  assert.equal(smoothDbzColor(5), null);
  assert.deepEqual(smoothDbzColor(8), [96, 208, 130, 150]);
  const mid = smoothDbzColor(17.5); // medzi 15 (zelená) a 20 (žltá)
  assert.ok(mid[0] > 46 && mid[0] < 250, 'farba je medzi zastávkami, nie skok');
  assert.deepEqual(smoothDbzColor(70), [255, 255, 255, 255]);
  // okraj búrky: výstupné body na okraji majú nižšiu priehľadnosť než stred
  const g = operaGrid(WHERE);
  const values = new Float64Array(g.xsize * g.ysize).fill(-8888000);
  const top = g.yll + g.ysize * g.yscale;
  const [bx, by] = g.forward(48.15, 17.11);
  const col = Math.floor((bx - g.xll) / 1000);
  const row = Math.floor((top - by) / 1000);
  for (let dr = -20; dr <= 20; dr += 1) for (let dc = -20; dc <= 20; dc += 1) values[(row + dr) * g.xsize + col + dc] = 40;
  const out = reprojectOpera(values, WHERE, { gain: 1, offset: 0, nodata: -9999000, undetect: -8888000 }, { deg: 0.01 });
  const c = Math.floor((17.11 - out.bounds.west) / 0.01);
  const r = Math.floor((out.bounds.north - 48.15) / 0.01);
  const alpha = (rr, cc) => out.rgba[(rr * out.width + cc) * 4 + 3];
  let edge = c;
  while (alpha(r, edge + 1) > 0) edge += 1;
  assert.ok(alpha(r, edge) < alpha(r, c), `okraj (${alpha(r, edge)}) je priehľadnejší než stred (${alpha(r, c)})`);
});

test('PNG z vlákna má správnu hlavičku a rozmery', () => {
  const rgba = new Uint8ClampedArray(3 * 2 * 4).fill(255);
  const png = encodePngRgba(rgba, 3, 2);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 3);
  assert.equal(png.readUInt32BE(20), 2);
  const idatLen = png.readUInt32BE(33);
  assert.equal(zlib.inflateSync(png.subarray(41, 41 + idatLen)).length, (3 * 4 + 1) * 2);
});

function fakeService({ available, now }) {
  const fetched = [];
  const saved = [];
  const svc = createOperaRadarService({
    fetchBuffer: async (url) => { fetched.push(url); const stamp = /OPERA@(\d{8}T\d{4})@/.exec(url)[1]; return available.has(stamp) ? { status: 200, buffer: new ArrayBuffer(8) } : { status: 404 }; },
    decode: async () => ({ png: Buffer.from('png'), bounds: { west: -40, east: 58, south: 31, north: 74 }, echoPixels: 5 }),
    store: { load: async () => [], save: async (f) => { saved.push(f.iso); } },
    now: () => now.t,
    ringSize: 3,
  });
  return { svc, fetched, saved };
}

test('služba: studený štart doplní kruh, chýbajúca snímka sa nepýta stále, potom len nová', async () => {
  const now = { t: Date.parse('2026-10-08T19:44:00Z') };
  const available = new Set(['20261008T1930', '20261008T1920', '20261008T1900', '20261008T1850']);
  const { svc, fetched } = fakeService({ available, now });
  await svc.ensureFresh();
  const meta = svc.meta();
  // 19:10 chýba (404) — kruh sa doplní 19:30, 19:20 a 19:00, 18:50 už netreba.
  assert.deepEqual(meta.frames.map((f) => f.iso.slice(11, 16)), ['19:00', '19:20', '19:30']);
  assert.equal(meta.iso, '2026-10-08T19:30:00.000Z');
  assert.equal(meta.stale, false);
  assert.match(meta.frames[0].png, /^\/api\/opera\/radar\/frame\//);
  const n = fetched.length;
  await svc.ensureFresh();
  assert.equal(fetched.length, n, 'do 2 min sa nič nepýta');
  now.t += 10 * 60_000; // ďalšia snímka (oneskorenie zdroja ~10–15 min)
  assert.ok(10 * 60_000 > OPERA_CHECK_EVERY_MS);
  available.add('20261008T1940');
  await svc.ensureFresh();
  assert.equal(svc.meta().iso, '2026-10-08T19:40:00.000Z');
  assert.equal(svc.meta().frames.length, 3, 'kruh drží 3 snímky');
  assert.ok(svc.frame('2026-10-08T19:40:00.000Z'));
  now.t += 60 * 60_000;
  assert.equal(svc.meta().stale, true, 'snímka staršia než 45 min je stale');
});

test('vrstva Európy je druhá inštancia radaru: vlastné id, adresa a zdroj', async () => {
  const urls = [];
  const layer = createOperaRadarLayer({ fetchImpl: async (u) => { urls.push(u); return { ok: false, status: 503 }; } });
  assert.equal(layer.id, OPERA_RADAR_LAYER_ID);
  assert.match(layer.source, /EUMETNET OPERA/);
  layer.init({ scene: { primitives: { add() {}, remove() {} } } });
  await layer.update();
  assert.deepEqual(urls, ['/api/opera/radar']);
  assert.match(layer.getStats().error, /503/);
});

test('studený štart: odpoveď stačí po PRVEJ snímke, zvyšok kruhu sa doplní na pozadí; bez snímok sa nečaká naveky', async () => {
  const now = { t: Date.parse('2026-10-08T19:44:00Z') };
  let release;
  const gate = new Promise((r) => { release = r; });
  let decodes = 0;
  const svc = createOperaRadarService({
    fetchBuffer: async () => ({ status: 200, buffer: new ArrayBuffer(8) }),
    decode: async () => { decodes += 1; if (decodes > 1) await gate; return { png: Buffer.from('p'), bounds: {}, echoPixels: 1 }; },
    now: () => now.t,
    ringSize: 3,
  });
  const ok = await svc.whenAnyFrame();
  assert.equal(ok, true);
  assert.equal(svc.meta().frames.length, 1, 'prvá snímka je hneď k dispozícii');
  release();
  await svc.ensureFresh();
  const empty = createOperaRadarService({ fetchBuffer: async () => ({ status: 404 }), decode: async () => ({}), now: () => now.t });
  assert.equal(await empty.whenAnyFrame(), true);
  assert.equal(empty.meta(), null);
  assert.equal(await Promise.race([empty.whenAnyFrame(), new Promise((r) => setTimeout(() => r('visí'), 200))]), true, 'po nedávnom neúspechu sa nečaká naveky');
});

test('mobil / slabšie zariadenie: len posledných 6 snímok radaru Európy', async () => {
  const { operaFrameBudget, createOperaRadarLayer } = await import('./operaRadarLayer.js');
  assert.equal(operaFrameBudget({ width: 390 }), 6);
  assert.equal(operaFrameBudget({ width: 1440, deviceMemory: 4 }), 6);
  assert.equal(operaFrameBudget({ width: 1440, deviceMemory: 8 }), null);
  assert.equal(operaFrameBudget({ width: 1440 }), null, 'bez údaja o pamäti (Firefox, Safari) všetky');
  const frames = Array.from({ length: 12 }, (_, i) => ({ iso: new Date(Date.parse('2026-10-09T09:00:00Z') + i * 600_000).toISOString(), png: `/f${i}` }));
  const made = [];
  const layer = createOperaRadarLayer({
    maxFrames: () => 6,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, iso: frames[11].iso, png: '/p', bounds: { west: -40, south: 31, east: 58, north: 74 }, frames }) }),
    primitiveFactory: () => { const p = { show: false }; made.push(p); return p; },
  });
  layer.init({ scene: { primitives: { add() {}, remove() {} } } });
  assert.equal(await layer.update(), true);
  assert.equal(made.length, 6, 'načítaných len 6 snímok');
  layer.destroy();
});
