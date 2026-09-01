// OKO Fáza 1b — SK terén merge: čisté helpery + kontraktové piny.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  geodeticTileBbox,
  maskCoversTile,
  mergeTerrainAvailability,
  parseTerrainTilePath,
  resolveKeylessTerrainUrl,
  SK_TERRAIN_CREDIT,
  SK_TERRAIN_UPSTREAM_URL,
  SK_TERRAIN_URL,
  tileRangesForLevel,
} from './skTerrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('parseTerrainTilePath prijíma len presné /z/x/y.terrain v medziach TMS', () => {
  assert.deepEqual(parseTerrainTilePath('/14/17900/12650.terrain'), { z: 14, x: 17900, y: 12650 });
  assert.deepEqual(parseTerrainTilePath('/0/1/0.terrain'), { z: 0, x: 1, y: 0 });

  // Geodetický TMS má 2^(z+1) stĺpcov a 2^z riadkov — presné hranice.
  assert.ok(parseTerrainTilePath('/14/32767/16383.terrain'));
  assert.equal(parseTerrainTilePath('/14/32768/0.terrain'), null);
  assert.equal(parseTerrainTilePath('/14/0/16384.terrain'), null);

  // Traversal, zlé tvary a nezmyselné zoomy sa odmietajú ako celok.
  for (const bad of [
    '/../14/0/0.terrain', '/14/../0.terrain', '/14/0/0.png', '/14/0/0',
    '/23/0/0.terrain', '/-1/0/0.terrain', '/14/0x1/0.terrain', '14/0/0.terrain',
    '/layer.json', '', null,
  ]) {
    assert.equal(parseTerrainTilePath(bad), null, `malo odmietnuť: ${bad}`);
  }
});

test('geodeticTileBbox počíta TMS bbox (y od juhu)', () => {
  assert.deepEqual(geodeticTileBbox(0, 0, 0), { west: -180, south: -90, east: 0, north: 90 });
  assert.deepEqual(geodeticTileBbox(0, 1, 0), { west: 0, south: -90, east: 180, north: 90 });
  assert.deepEqual(geodeticTileBbox(1, 2, 1), { west: 0, south: 0, east: 90, north: 90 });
  // SK-ish dlaždica: z10 nad Tatrami leží v [19°–22°E, 48°–50°N].
  const t = geodeticTileBbox(10, 1138, 787);
  assert.ok(t.west > 19 && t.east < 22 && t.south > 48 && t.north < 50, JSON.stringify(t));
});

test('maskCoversTile: celá dlaždica vo vnútri dát, s eróziou okraja', () => {
  // Maska 100×50 nad bbox [10..20]E × [40..45]N; platné stĺpce 20..79
  // (t.j. 12°–18°E), riadky všetky.
  const width = 100;
  const height = 50;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 20; x < 80; x++) mask[y * width + x] = 255;
  }
  const maskBbox = { west: 10, south: 40, east: 20, north: 45 };
  const covers = (tileBbox, opts = {}) => maskCoversTile({ mask, width, height, maskBbox, tileBbox, ...opts });

  assert.equal(covers({ west: 14, south: 41, east: 15, north: 42 }), true, 'hlboko vo vnútri');
  assert.equal(covers({ west: 11, south: 41, east: 12.5, north: 42 }), false, 'pretŕča do neplatných dát');
  assert.equal(covers({ west: 9, south: 41, east: 11, north: 42 }), false, 'pretŕča mimo masku');
  // Erózia: dlaždica tesne pri hrane platnosti (12°E; vzorka padne na
  // px 21, hrana je px 20) prejde bez marginu, s marginom 2 px už nie.
  const edge = { west: 12.06, south: 41, east: 13, north: 42 };
  assert.equal(covers(edge, { marginPx: 0 }), true);
  assert.equal(covers(edge, { marginPx: 2 }), false);
});

test('resolveKeylessTerrainUrl: proxy keď layer.json odpovie, inak priamy upstream', async () => {
  const okProbe = await resolveKeylessTerrainUrl({ fetchImpl: async () => ({ ok: true }) });
  assert.deepEqual(okProbe, { url: SK_TERRAIN_URL, merged: true });

  const notOk = await resolveKeylessTerrainUrl({ fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(notOk, { url: SK_TERRAIN_UPSTREAM_URL, merged: false });

  const dead = await resolveKeylessTerrainUrl({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(dead, { url: SK_TERRAIN_UPSTREAM_URL, merged: false });

  const custom = await resolveKeylessTerrainUrl({
    fetchImpl: async (url) => ({ ok: String(url).startsWith('/api/sk-terrain') }),
    localUrl: '/api/sk-terrain',
    upstreamUrl: 'https://example.invalid',
  });
  assert.equal(custom.url, '/api/sk-terrain');
});

test('tileRangesForLevel: presné behy po riadkoch + zvislé zlúčenie, žiadny bounding box', () => {
  assert.deepEqual(tileRangesForLevel([]), []);
  assert.deepEqual(tileRangesForLevel(null), []);
  // Jeden riadok s dierou → dva behy (bounding box by dieru zaklamal).
  assert.deepEqual(
    tileRangesForLevel([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 4, y: 5 }]),
    [{ startX: 1, startY: 5, endX: 2, endY: 5 }, { startX: 4, startY: 5, endX: 4, endY: 5 }],
  );
  // Dva susedné riadky s identickými behmi → jeden obdĺžnik (zvislé zlúčenie).
  assert.deepEqual(
    tileRangesForLevel([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 6 }, { x: 2, y: 6 }]),
    [{ startX: 1, startY: 5, endX: 2, endY: 6 }],
  );
  // Nesusedné riadky sa nezlučujú ani pri zhodných behoch.
  assert.deepEqual(
    tileRangesForLevel([{ x: 1, y: 5 }, { x: 1, y: 7 }]),
    [{ startX: 1, startY: 5, endX: 1, endY: 5 }, { startX: 1, startY: 7, endX: 1, endY: 7 }],
  );
  // Duplicitné a nevalidné vstupy sa ignorujú bez pádu.
  assert.deepEqual(
    tileRangesForLevel([{ x: 3, y: 2 }, { x: 3, y: 2 }, { x: -1, y: 2 }, { x: 'a', y: 2 }, null]),
    [{ startX: 3, startY: 2, endX: 3, endY: 2 }],
  );
  // Sanita: rekonštrukcia z obdĺžnikov = pôvodná množina (na náhodnej vzorke).
  const tiles = [];
  for (let y = 100; y < 104; y++) for (let x = 200; x < 240; x++) if ((x + y) % 7 !== 0) tiles.push({ x, y });
  const ranges = tileRangesForLevel(tiles);
  const rebuilt = new Set();
  for (const r of ranges) for (let y = r.startY; y <= r.endY; y++) for (let x = r.startX; x <= r.endX; x++) rebuilt.add(`${x},${y}`);
  assert.equal(rebuilt.size, tiles.length);
  for (const t of tiles) assert.ok(rebuilt.has(`${t.x},${t.y}`));
});

test('mergeTerrainAvailability: rozšíri maxzoom a doplní z15+, upstream úrovne nedotknuté', () => {
  const upstream = {
    format: 'quantized-mesh-1.0',
    maxzoom: 14,
    available: Array.from({ length: 15 }, (_, z) => [{ startX: 0, startY: 0, endX: 2 ** (z + 1) - 1, endY: 2 ** z - 1 }]),
  };
  const overlay = {
    maxzoom: 16,
    available: {
      15: [{ startX: 35800, startY: 25100, endX: 36000, endY: 25200 }],
      16: [{ startX: 71600, startY: 50200, endX: 72000, endY: 50400 }],
    },
  };
  const merged = mergeTerrainAvailability(upstream, overlay);
  assert.equal(merged.maxzoom, 16);
  assert.equal(merged.available.length, 17);
  assert.deepEqual(merged.available[15], overlay.available[15]);
  assert.deepEqual(merged.available[16], overlay.available[16]);
  // Upstream úrovne 0–14 ostávajú referenčne tie isté (nedotknuté).
  for (let z = 0; z <= 14; z++) assert.equal(merged.available[z], upstream.available[z]);
  // Vstup sa nemutuje.
  assert.equal(upstream.available.length, 15);
  assert.equal(upstream.maxzoom, 14);

  // Overlay úroveň ≤ upstream maxzoom sa ignoruje (tam platí plná availability).
  const clash = mergeTerrainAvailability(upstream, { available: { 14: [{ startX: 1, startY: 1, endX: 1, endY: 1 }] } });
  assert.equal(clash, upstream, 'bez novej úrovne sa vracia upstream nezmenený');

  // Diera v úrovniach: z16 bez z15 → z15 je prázdne pole, nie undefined.
  const gap = mergeTerrainAvailability(upstream, { available: { 16: overlay.available[16] } });
  assert.deepEqual(gap.available[15], []);
  assert.deepEqual(gap.available[16], overlay.available[16]);

  // Fail-open na smetiach.
  assert.equal(mergeTerrainAvailability(upstream, null), upstream);
  assert.equal(mergeTerrainAvailability(upstream, { available: 'x' }), upstream);
  assert.equal(mergeTerrainAvailability(upstream, { available: { 15: [] } }), upstream);
  assert.equal(mergeTerrainAvailability(null, overlay), null);
  const noAvail = { maxzoom: 14 };
  assert.equal(mergeTerrainAvailability(noAvail, overlay), noAvail, 'upstream bez available sa nefalšuje');
});

test('kontraktové piny: proxy registrácia, klientský merge hook, watcher ignore', () => {
  const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
  // Proxy je zaregistrovaná a importuje zdieľaný parser — jedna validácia cesty.
  assert.match(viteConfig, /skTerrainProxy\(\),/);
  assert.match(viteConfig, /import \{ mergeTerrainAvailability, parseTerrainTilePath, SK_TERRAIN_UPSTREAM_URL \} from '\.\/src\/data\/skTerrain\.js';/);
  // Lokálna dlaždica je na disku gzip — hlavička je súčasť kontraktu buildu.
  assert.match(viteConfig, /'Content-Encoding': 'gzip'/);
  // layer.json musí prechádzať availability mergeom — bez neho Cesium
  // dlaždice z15+ nikdy nepýta (upstream maxzoom je 14).
  assert.match(viteConfig, /mergeTerrainAvailability\(JSON\.parse\(body\.toString\('utf8'\)\), JSON\.parse\(overlayRaw\)\)/);
  // LEKCIA (2026-08-31): chokidar nad .gev-cache zabil dev server (EBUSY na
  // súbore zamknutom downloaderom) — watcher ich musí ignorovať.
  assert.match(viteConfig, /ignored: \['\*\*\/\.gev-cache\/\*\*', '\*\*\/qa-shots\/\*\*'\]/);

  const controller = fs.readFileSync(path.join(ROOT, 'src', 'mapStackController.js'), 'utf8');
  assert.match(controller, /resolveKeylessTerrainUrl\(\{ upstreamUrl: REEARTH_TERRAIN_URL \}\)/);
  assert.match(controller, /SK_TERRAIN_CREDIT/);
  assert.ok(SK_TERRAIN_CREDIT.includes('ÚGKK'), 'atribúcia CC BY musí menovať ÚGKK');

  // Build skript používa zdieľané helpery — prune logika má jeden domov.
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-sk-terrain.mjs'), 'utf8');
  assert.match(build, /import \{ geodeticTileBbox, maskCoversTile, tileRangesForLevel \} from '\.\.\/src\/data\/skTerrain\.js';/);
  // Hi-res pipeline (DMR 6.0 vložky) zdieľa tie isté helpery — jeden domov.
  const hires = fs.readFileSync(path.join(ROOT, 'scripts', 'build-sk-terrain-hires.mjs'), 'utf8');
  assert.match(hires, /import \{ geodeticTileBbox, maskCoversTile, tileRangesForLevel \} from '\.\.\/src\/data\/skTerrain\.js';/);
  assert.match(hires, /sk-availability\.json/);
});
